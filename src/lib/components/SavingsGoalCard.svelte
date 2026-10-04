<script lang="ts">
	import type { Transaction } from '$lib/types';
	import { categorize } from '$lib/categories';
	import { budgetState } from '$lib/budget.svelte';
	import { getMerchantCategoryMap } from '$lib/store.svelte';
	import { monthTotals } from '$lib/totals';
	import { formatEUR, formatMonth } from '$lib/format';
	import BudgetRing from './BudgetRing.svelte';

	/**
	 * Monthly savings target (`budget:savings-target`): savings of the displayed month (income −
	 * spending, same convention as the Analyse page), remaining amount, days left and projected pace
	 * at the end of the month.
	 */
	let {
		transactions,
		monthKey,
		showRing = true,
		showPace = true
	}: {
		transactions: Transaction[];
		monthKey: string;
		/** Progress ring towards the goal (block element). */
		showRing?: boolean;
		/** « Au rythme actuel » end-of-month line (block element). */
		showPace?: boolean;
	} = $props();

	const KEY = 'budget:savings-target';
	function load(): number | null {
		try {
			const v = Number(localStorage.getItem(KEY));
			return Number.isFinite(v) && v > 0 ? v : null;
		} catch {
			return null;
		}
	}
	let target = $state<number | null>(load());
	let editing = $state(false);
	let draft = $state('');
	function save() {
		const v = Number(draft.replace(/\s/g, '').replace(',', '.'));
		target = Number.isFinite(v) && v > 0 ? Math.round(v) : null;
		try {
			if (target) localStorage.setItem(KEY, String(target));
			else localStorage.removeItem(KEY);
		} catch {
		}
		editing = false;
	}

	// Same totals as the rest of the app (totals.ts): savings & transfers are neither income nor
	// spending
	const totals = $derived(monthTotals(transactions, monthKey, (tx) => categorize(tx, budgetState.overrides, undefined, getMerchantCategoryMap())));
	const savings = $derived(totals.net);

	const today = new Date();
	const isCurrent = $derived(monthKey === `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`);
	const daysInMonth = $derived(new Date(Number(monthKey.slice(0, 4)), Number(monthKey.slice(5, 7)), 0).getDate());
	const dayOfMonth = $derived(isCurrent ? today.getDate() : daysInMonth);
	const daysLeft = $derived(Math.max(0, daysInMonth - dayOfMonth));
	/**
	 * Pace (current month): income ALREADY received − spending extrapolated over the month. The old
	 * formula also extrapolated the net, so early in the month, before the salary, a small deficit
	 * became a huge one 'at month end'. null until some income has arrived: no invented projection.
	 */
	const pace = $derived.by((): number | null => {
		if (!isCurrent) return savings;
		if (totals.income <= 0 || dayOfMonth <= 0) return null;
		return Math.round(totals.income - (totals.expenses / dayOfMonth) * daysInMonth);
	});
	const ratio = $derived(target ? Math.max(0, savings) / target : 0);
	const remaining = $derived(target ? Math.max(0, target - savings) : 0);
</script>

<div class="flex h-full flex-col">
	<div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
		<h2 class="label-xs">Objectif d'épargne</h2>
		<button type="button" class="meta-xs cursor-pointer whitespace-nowrap hover:underline" onclick={() => { draft = target ? String(target) : ''; editing = true; }}>{target ? `${formatEUR(target)} / mois · modifier` : 'fixer un objectif'}</button>
	</div>
	{#if editing}
		<form class="mt-2 flex flex-wrap items-center gap-2" onsubmit={(e) => { e.preventDefault(); save(); }}>
			<input type="text" inputmode="numeric" class="input-surface tabular w-28" placeholder="1 200" bind:value={draft} aria-label="Objectif mensuel en euros" />
			<span class="meta-xs">€ / mois</span>
			<button type="submit" class="btn btn-primary btn-sm">OK</button>
			<button type="button" class="btn btn-secondary btn-sm" onclick={() => (editing = false)}>Annuler</button>
		</form>
	{/if}
	<div class="mt-2 flex items-center gap-4">
		{#if target && showRing}
			<BudgetRing {ratio} color={savings < 0 ? 'var(--amber)' : 'var(--accent)'} size={56} stroke={6} over={false}>
				{Math.round(ratio * 100)} %
			</BudgetRing>
		{/if}
		<div class="min-w-0">
			<p class="stat-amount tabular" style="color: {savings >= 0 ? 'var(--accent)' : 'var(--amber)'};">{savings >= 0 ? '+' : '−'}{formatEUR(Math.abs(savings))}</p>
			<p class="meta-xs">mis de côté en <span class="capitalize">{formatMonth(monthKey)}</span>{#if target} · reste {formatEUR(remaining)}{/if}</p>
		</div>
	</div>
	{#if isCurrent && showPace}
		<p class="meta-xs mt-2">
			{daysLeft} jour{daysLeft > 1 ? 's' : ''} restant{daysLeft > 1 ? 's' : ''} ·
			{#if pace === null}
				projection dès l'arrivée des revenus du mois
			{:else}
				au rythme actuel : <span class="tabular font-medium" style="color: {target && pace >= target ? 'var(--accent)' : 'var(--text)'};">{pace >= 0 ? '+' : '−'}{formatEUR(Math.abs(pace))}</span> en fin de mois{#if target && pace < target} ({formatEUR(target - pace)} sous l'objectif){/if}
			{/if}
		</p>
	{/if}
</div>
