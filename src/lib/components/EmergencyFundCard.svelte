<script lang="ts">
	import type { CategoryId } from '$lib/types';
	import { categorize } from '$lib/categories';
	import { subcategorize } from '$lib/subcategories';
	import { budgetState } from '$lib/budget.svelte';
	import { getMerchantCategoryMap } from '$lib/store.svelte';
	import { getBudgetTransactions } from '$lib/transfers.svelte';
	import { monthTotals, isBudgetFlow } from '$lib/totals';
	import { signedAmount } from '$lib/data';
	import { formatEUR } from '$lib/sensitiveFormat';
	import { getAccountsView, getCryptoTotal, getEmployeeSavingsTotal, getNatixisCashCounted } from '$lib/wealth.svelte';
	import { persistJson } from '$lib/storage';
	import { coverage, readTarget, referenceSpending, type EmergencyTarget } from '$lib/emergencyFund';

	/**
	 * Emergency fund (dashboard): months of usual spending covered by the available savings (current
	 * accounts and savings accounts), against a target range (3 to 6 months, adjustable). Usual
	 * spending: last 12 complete months, internal transfers and vehicle purchases out, one-off months
	 * capped. Locked savings (employee savings, crypto) are shown apart, never counted.
	 */
	let { showDetails = true }: { showDetails?: boolean } = $props();

	const KEY = 'budget:emergency-target';
	const load = (): EmergencyTarget => {
		try {
			return readTarget(JSON.parse(localStorage.getItem(KEY) ?? 'null'));
		} catch {
			return readTarget(null);
		}
	};
	let target = $state(load());
	let editing = $state(false);

	const monthKey = new Date().toISOString().slice(0, 7);
	const monthly = $derived.by(() => {
		const txs = getBudgetTransactions();
		const mm = getMerchantCategoryMap();
		const catOf = (tx: Parameters<typeof categorize>[0]): CategoryId => categorize(tx, budgetState.overrides, undefined, mm);
		const months = [...new Set(txs.filter(isBudgetFlow).map((t) => t.booking_date.slice(0, 7)))].filter((m) => m < monthKey).sort().slice(-12);
		return months.map((m) => {
			const purchase = txs.filter((t) => t.booking_date.startsWith(m) && isBudgetFlow(t) && subcategorize(t, budgetState.overrides, undefined, mm) === 'achat-vehicule').reduce((s, t) => s - signedAmount(t), 0);
			return Math.max(0, monthTotals(txs, m, catOf).expenses - purchase);
		});
	});
	const reference = $derived(referenceSpending(monthly));
	const accounts = $derived(getAccountsView().filter((a) => (a.kind === 'courant' || a.kind === 'livret') && a.balance > 0));
	const available = $derived(Math.round(accounts.reduce((s, a) => s + a.balance, 0) * 100) / 100);
	const locked = $derived({ salariale: getEmployeeSavingsTotal() + getNatixisCashCounted(), crypto: getCryptoTotal() });
	const cov = $derived(coverage(available, reference, target));
	const scaleMax = $derived(Math.max(target.max + 2, Math.ceil((cov.months ?? 0) + 1)));
	const pos = (m: number) => `${Math.min(100, (m / scaleMax) * 100)}%`;
	const STATE = { below: { text: 'sous la cible', color: 'var(--amber)' }, within: { text: 'dans la cible', color: 'var(--accent)' }, above: { text: 'au-dessus de la cible', color: 'var(--accent)' }, unknown: { text: 'pas assez de mois', color: 'var(--text-secondary)' } } as const;

	function saveTarget(min: number, max: number) {
		target = readTarget({ min, max });
		persistJson(KEY, target);
	}
	const fmtMonths = (m: number) => m.toLocaleString('fr-FR', { maximumFractionDigits: 1 });
</script>

<div class="flex items-baseline justify-between gap-2">
	<h2 class="label-xs">Épargne de précaution</h2>
	<span class="chip" style="color: {STATE[cov.state].color}; background-color: color-mix(in srgb, {STATE[cov.state].color} 14%, transparent);">{STATE[cov.state].text}</span>
</div>
{#if cov.months === null}
	<p class="meta-xs mt-2">Il faut au moins un mois complet de dépenses pour calculer la couverture.</p>
{:else}
	<p class="mt-1.5"><span class="amount-md tabular">{fmtMonths(cov.months)} mois</span> <span class="meta-xs">de dépenses couverts</span></p>
	<div class="relative mt-2 h-2 rounded-full" style="background-color: var(--surface-2);" role="img" aria-label="{fmtMonths(cov.months)} mois couverts, cible de {target.min} à {target.max} mois">
		<div class="absolute inset-y-0 rounded-full" style="left: {pos(target.min)}; width: calc({pos(target.max)} - {pos(target.min)}); background-color: color-mix(in srgb, var(--accent) 22%, transparent);"></div>
		<div class="absolute inset-y-0 left-0 rounded-full transition-[width] duration-500" style="width: {pos(cov.months)}; background-color: {STATE[cov.state].color}; opacity: 0.85;"></div>
		{#each [target.min, target.max] as m (m)}
			<div class="absolute -top-1 -bottom-1 w-0.5 -translate-x-1/2 rounded-full" style="left: {pos(m)}; background-color: var(--text);" aria-hidden="true"></div>
		{/each}
	</div>
	<div class="meta-xs relative mt-1 h-4" aria-hidden="true">
		<span class="absolute left-0">0</span>
		{#each [target.min, target.max] as m (m)}<span class="absolute -translate-x-1/2" style="left: {pos(m)};">{m}</span>{/each}
		<span class="absolute right-0">{scaleMax} mois</span>
	</div>
	<p class="meta-xs">Cible : {target.min} à {target.max} mois</p>
	{#if cov.state === 'below'}<p class="meta-xs mt-1.5" style="color: var(--amber);">Il manque {formatEUR(cov.missing)} pour atteindre {target.min} mois.</p>{/if}
	{#if showDetails}
		<p class="meta-xs mt-1.5">Disponible {formatEUR(available)} ({accounts.length} compte{accounts.length > 1 ? 's' : ''} courant{accounts.length > 1 ? 's' : ''} et livret{accounts.length > 1 ? 's' : ''}) ÷ dépenses habituelles {formatEUR(reference)} par mois (moyenne des {monthly.length} derniers mois, achats de véhicule et mois exceptionnels écartés).</p>
		{#if locked.salariale > 0 || locked.crypto > 0}<p class="meta-xs mt-0.5">Non compté (bloqué ou volatil) : {locked.salariale > 0 ? `épargne salariale ${formatEUR(locked.salariale)}` : ''}{locked.salariale > 0 && locked.crypto > 0 ? ' · ' : ''}{locked.crypto > 0 ? `crypto ${formatEUR(locked.crypto)}` : ''}.</p>{/if}
	{/if}
{/if}
{#if editing}
	<div class="meta-xs mt-2 flex items-center gap-1.5">
		Cible de
		<input type="number" min="1" max="36" class="input-surface tabular w-12 !px-1.5 !py-0.5 text-xs" value={target.min} aria-label="Cible minimale (mois)" onchange={(e) => saveTarget(Number((e.target as HTMLInputElement).value), target.max)} />
		à
		<input type="number" min="1" max="36" class="input-surface tabular w-12 !px-1.5 !py-0.5 text-xs" value={target.max} aria-label="Cible maximale (mois)" onchange={(e) => saveTarget(target.min, Number((e.target as HTMLInputElement).value))} />
		mois
		<button type="button" class="cursor-pointer hover:underline" onclick={() => (editing = false)}>OK</button>
	</div>
{:else}
	<button type="button" class="meta-xs mt-2 cursor-pointer hover:underline" onclick={() => (editing = true)}>Changer la cible</button>
{/if}
