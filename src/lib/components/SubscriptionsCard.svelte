<script lang="ts">
	import { budgetState } from '$lib/budget.svelte';
	import { getBudgetTransactions } from '$lib/transfers.svelte';
	import { getMerchantCategoryMap } from '$lib/store.svelte';
	import { isPending, sortByDate, signedAmount } from '$lib/data';
	import { detectRecurring, normalizeLabel, type RecurringItem } from '$lib/forecast';
	import { latestMerchantQuery } from '$lib/merchantSearch';
	import { getCategory, isWealthMovement } from '$lib/categories';
	import { flowKind } from '$lib/flow';
	import { formatDate, formatEUR, formatEURCompact } from '$lib/format';
	import { uiState } from '$lib/ui.svelte';
	import { navigate } from '$lib/router.svelte';
	import { priceRise, abnormalRise, periodsPerYear, type PriceRise, type Occurrence } from '$lib/priceRises';
	import { sectorInflation, RECENT_INFLATION } from '$lib/inflation';
	import { PRICE_ITEM_BY_CATEGORY, PRICE_ITEM_LABELS } from '$lib/personalInflation';

	/**
	 * Subscriptions & direct debits: the detected FIXED CHARGES (regular interval, stable amount or
	 * SEPA direct debit, see RecurringItem.fixed), monthly equivalent, and alerts:
	 * - 'a changé': the last occurrence deviates by more than 5 % from the median;
	 * - 'en retard': the expected date is exceeded by more than half an interval compared to the LAST
	 * IMPORTED OPERATION (not today: a two-month-old import marked everything late);
	 * - 'hausse': the price rose faster than the inflation of its item over a year (last amount vs the
	 * one 10 to 14 months ago).
	 * Regular buying habits (groceries, coffees, withdrawals) and ended subscriptions are listed
	 * separately, collapsed.
	 * The summary line, the cadence / one-year / alert columns and that second list follow the
	 * « Éléments affichés » of the Analyse block.
	 */
	let {
		showSummary = true,
		showCadence = true,
		showYear = true,
		showAlerts = true,
		showOtherList = true
	}: { showSummary?: boolean; showCadence?: boolean; showYear?: boolean; showAlerts?: boolean; showOtherList?: boolean } = $props();
	const confirmed = $derived(getBudgetTransactions().filter((tx) => !isPending(tx) && !isWealthMovement(tx)));
	const lastIso = $derived(sortByDate(confirmed)[confirmed.length - 1]?.booking_date ?? '');

	interface Row extends RecurringItem {
		lastAmount: number;
		changedPct: number | null;
		late: boolean;
		/** One-year increase and reference inflation (item of the category). */
		hausse: PriceRise | null;
		inflation: number;
		posteLabel: string;
		anormale: boolean;
	}
	const recentYear = Number(RECENT_INFLATION.mois.slice(0, 4));
	/**
	 * One-year inflation of a category's item (energy for electricity…), otherwise the average
	 * inflation.
	 */
	function inflationFor(categoryId: RecurringItem['categoryId']): { taux: number; label: string } {
		const priceItem = PRICE_ITEM_BY_CATEGORY[categoryId];
		const t = priceItem && priceItem !== 'ensemble' ? sectorInflation(recentYear, priceItem) : null;
		return t !== null && priceItem ? { taux: t, label: PRICE_ITEM_LABELS[priceItem].toLowerCase() } : { taux: RECENT_INFLATION.taux, label: 'ensemble des prix' };
	}
	const items = $derived(
		lastIso ? detectRecurring(confirmed, budgetState.overrides, lastIso, getMerchantCategoryMap()).filter((r) => r.kind === 'debit' && flowKind(r.categoryId) === 'expense') : []
	);
	/** Last real occurrence per key (amount paid last time). */
	const rows = $derived.by((): Row[] => {
		const lastByKey = new Map<string, { date: string; amount: number }>();
		const occByKey = new Map<string, Occurrence[]>();
		for (const tx of confirmed) {
			if (signedAmount(tx) >= 0) continue;
			const k = normalizeLabel(tx);
			const prev = lastByKey.get(k);
			if (!prev || tx.booking_date >= prev.date) lastByKey.set(k, { date: tx.booking_date, amount: Math.abs(signedAmount(tx)) });
			const occ = occByKey.get(k) ?? [];
			occ.push({ date: tx.booking_date, montant: Math.abs(signedAmount(tx)) });
			occByKey.set(k, occ);
		}
		const ref = new Date(`${lastIso}T00:00:00`).getTime();
		return items
			.filter((r) => r.fixed && r.active)
			.map((r) => {
				const lastAmount = lastByKey.get(r.key)?.amount ?? r.medianAmount;
				const changedPct = r.medianAmount > 0 ? Math.round(((lastAmount - r.medianAmount) / r.medianAmount) * 100) : null;
				const expected = new Date(`${r.expectedDate}T00:00:00`).getTime();
				const late = ref - expected > (r.intervalDays * 86_400_000) / 2;
				const rise = priceRise(occByKey.get(r.key) ?? [], periodsPerYear(r.cadence));
				const infl = inflationFor(r.categoryId);
				return { ...r, lastAmount, changedPct: changedPct !== null && Math.abs(changedPct) >= 5 ? changedPct : null, late, hausse: rise, inflation: infl.taux, posteLabel: infl.label, anormale: !late && !!rise && abnormalRise(rise, infl.taux) };
			})
			.sort((a, b) => b.monthly - a.monthly);
	});
	const monthlyTotal = $derived(rows.filter((r) => !r.late).reduce((s, r) => s + r.monthly, 0));
	const alerts = $derived(rows.filter((r) => r.late || r.changedPct !== null || r.anormale).length);
	/** Increases faster than inflation: count and yearly extra cost. */
	const rises = $derived(rows.filter((r) => r.anormale));
	const extraCost = $derived(Math.round(rises.reduce((s, r) => s + (r.hausse?.coutAn ?? 0), 0)));
	const SHORT_MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
	const monthYear = (iso: string) => `${SHORT_MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
	const pct = (n: number) => `${n > 0 ? '+' : ''}${n.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`;
	function riseTitle(r: Row): string {
		const h = r.hausse!;
		return `${formatEUR(h.avant)} (${monthYear(h.dateAvant)}) → ${formatEUR(h.apres)} (${monthYear(h.dateApres)}) : ${pct(h.hausse)}, soit ${pct(h.parAn)} par an et ${h.coutAn >= 0 ? '+' : '−'}${formatEUR(Math.abs(h.coutAn))} par an. Inflation (${r.posteLabel}) : ${pct(r.inflation)} sur un an.`;
	}
	/** Regular buying habits: real, but not subscriptions. */
	const habits = $derived(items.filter((r) => !r.fixed && r.active).sort((a, b) => b.monthly - a.monthly));
	/** Fixed charges that no longer occur (cancelled / ended). */
	const ended = $derived(items.filter((r) => r.fixed && !r.active));
	let showOthers = $state(false);

	function open(r: Row) {
		uiState.txSearch = latestMerchantQuery(confirmed.filter((tx) => normalizeLabel(tx) === r.key)) || r.label;
		navigate('/transactions');
	}
	const CADENCE: Record<string, string> = { hebdomadaire: 'hebdo', mensuelle: 'mensuel', trimestrielle: 'trimestriel' };
</script>

<div class="mb-3 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
	<h2 class="label-xs">Abonnements & prélèvements</h2>
	{#if showSummary}<p class="meta-xs">{rows.length} charge{rows.length > 1 ? 's' : ''} fixe{rows.length > 1 ? 's' : ''} · ≈ <span class="font-medium" style="color: var(--text);">{formatEUR(monthlyTotal)}</span> / mois{#if alerts > 0}&nbsp;· <span style="color: var(--amber);">{alerts} à vérifier</span>{/if}{#if rises.length > 0}&nbsp;· <span style="color: var(--amber);" title="Prix en hausse plus rapide que l'inflation de leur poste, sur un an">{rises.length} hausse{rises.length > 1 ? 's' : ''} &gt; inflation, +{formatEURCompact(extraCost)} / an</span>{/if}</p>{/if}
</div>
{#if rows.length === 0}
	<p class="meta-xs">Aucun abonnement ni prélèvement détecté : il faut au moins trois échéances régulières, au même montant (ou prélevées).</p>
{:else}
	<!-- Local horizontal scroll on mobile (the page overflowed by ~80 px) -->
	<div class="overflow-x-auto">
	<table class="w-full min-w-[500px] text-xs">
		<thead>
			<tr class="text-left" style="color: var(--text-secondary);">
				<th class="py-1 pr-3 font-medium">Libellé</th>
				<th class="py-1 pr-3 font-medium">Catégorie</th>
				{#if showCadence}<th class="py-1 pr-3 font-medium">Cadence</th>{/if}
				<th class="tabular py-1 pr-3 text-right font-medium">Montant</th>
				<th class="tabular py-1 pr-3 text-right font-medium">/ mois</th>
				<th class="tabular py-1 pr-3 text-right font-medium">Dernier</th>
				{#if showYear}<th class="tabular py-1 pr-3 text-right font-medium" title="Prix actuel contre celui d'il y a environ un an">Sur 1 an</th>{/if}
				{#if showAlerts}<th class="py-1 font-medium">Alerte</th>{/if}
			</tr>
		</thead>
		<tbody class="rows">
			{#each rows as r (r.key)}
				<tr class="row row-hover border-t" style="border-color: var(--border-subtle);">
					<td class="py-1.5 pr-3"><button type="button" class="cursor-pointer text-left font-medium hover:underline" onclick={() => open(r)}>{r.label}</button></td>
					<td class="py-1.5 pr-3 whitespace-nowrap text-secondary"><span class="mr-1.5 inline-block h-2 w-2 rounded-full align-middle" style="background-color: {getCategory(r.categoryId).color};"></span>{getCategory(r.categoryId).label}</td>
					{#if showCadence}<td class="py-1.5 pr-3 text-secondary">{CADENCE[r.cadence] ?? r.cadence}</td>{/if}
					<td class="tabular py-1.5 pr-3 text-right">{formatEUR(r.lastAmount)}</td>
					<td class="tabular py-1.5 pr-3 text-right font-medium">{formatEUR(r.monthly)}{#if r.stableShare < 0.75}<span class="meta-xs" title="Montant variable (prélèvement) : médiane"> ~</span>{/if}</td>
					<td class="tabular py-1.5 pr-3 text-right whitespace-nowrap text-secondary">{formatDate(r.lastDate)}</td>
					{#if showYear}
						<td class="tabular py-1.5 pr-3 text-right">
							{#if r.hausse && r.anormale}
								<span class="chip chip-amber tabular" title={riseTitle(r)}>{pct(r.hausse.hausse)}</span>
							{:else if r.hausse && Math.abs(r.hausse.hausse) >= 1}
								<span class="text-secondary" title={riseTitle(r)}>{pct(r.hausse.hausse)}</span>
							{:else if r.hausse}
								<span class="text-secondary" title={riseTitle(r)}>=</span>
							{/if}
						</td>
					{/if}
					{#if showAlerts}
						<td class="py-1.5">
							{#if r.late}
								<span class="chip chip-amber" title="Échéance attendue le {formatDate(r.expectedDate)}, absente des opérations importées : arrêté ou résilié ?">en retard</span>
							{:else if r.changedPct !== null && !r.anormale}
								<span class="chip chip-amber" title="Dernier montant {formatEUR(r.lastAmount)} vs médiane {formatEUR(r.medianAmount)}">{r.changedPct > 0 ? '+' : ''}{r.changedPct} %</span>
							{/if}
						</td>
					{/if}
				</tr>
			{/each}
		</tbody>
	</table>
	</div>
{/if}
{#if showOtherList && (habits.length > 0 || ended.length > 0)}
	<!-- Left out of the list, but visible: nothing is hidden without saying so -->
	<button type="button" class="meta-xs mt-2 cursor-pointer hover:underline" aria-expanded={showOthers} onclick={() => (showOthers = !showOthers)}>
		{showOthers ? '▾' : '▸'}
		{#if habits.length > 0}{habits.length} dépense{habits.length > 1 ? 's' : ''} régulière{habits.length > 1 ? 's' : ''} non fixe{habits.length > 1 ? 's' : ''} (courses, sorties…){/if}{#if habits.length > 0 && ended.length > 0}&nbsp;· {/if}{#if ended.length > 0}{ended.length} terminé{ended.length > 1 ? 's' : ''}{/if}
	</button>
	{#if showOthers}
		<ul class="meta-xs mt-1 space-y-0.5">
			{#each habits as h (h.key)}
				<li>{h.label} — {CADENCE[h.cadence] ?? h.cadence}, ≈ {formatEUR(h.monthly)} / mois (montants ou dates irréguliers)</li>
			{/each}
			{#each ended as e (e.key)}
				<li>{e.label} — terminé, dernier le {formatDate(e.lastDate)}</li>
			{/each}
		</ul>
	{/if}
{/if}
