<script lang="ts">
	import { budgetState } from '$lib/budget.svelte';
	import { getBudgetTransactions } from '$lib/transfers.svelte';
	import { isPending, sortByDate } from '$lib/data';
	import { detectRecurring, forecastTotals, forecastRefIso, confidenceStyle, confidenceLabel } from '$lib/forecast';
	import { formatDate, formatEUR, sensitiveEUR } from '$lib/format';
	import { getSchedule } from '$lib/schedule.svelte';
	import { KIND_COLORS, KIND_LABELS } from '$lib/schedule';
	import { getMerchantCategoryMap } from '$lib/store.svelte';
	import { flowKind } from '$lib/flow';

	/** 'À venir' card (Dashboard): expected spending within 30 days + the next deadlines of the schedule. */
	let {
		showTotal = true,
		showList = true,
		showConfidence = true
	}: {
		/** Expected total within 30 days (block element). */
		showTotal?: boolean;
		/** Next payments list (block element). */
		showList?: boolean;
		/** Reliability chip of each payment (block element). */
		showConfidence?: boolean;
	} = $props();

	// Budget scope (v13): internal transfers excluded from upcoming payments
	// Computed portage entries excluded: recurrence detection works on bank data
	const confirmed = $derived(getBudgetTransactions().filter((tx) => !isPending(tx) && tx.source !== 'portage'));
	// Same reference as ForecastSection: max(dataset, today).
	const fromIso = $derived(forecastRefIso(sortByDate(confirmed)[confirmed.length - 1]?.booking_date ?? ''));
	// Upcoming payments = LIVE FIXED charges (subscriptions, direct debits, rent): not Saturday
	// groceries, not a cancelled subscription, not savings
	const recurring = $derived(
		detectRecurring(confirmed, budgetState.overrides, fromIso, getMerchantCategoryMap()).filter((r) => r.kind === 'debit' && r.active && r.fixed && flowKind(r.categoryId) === 'expense')
	);
	const next = $derived(getSchedule(90).slice(0, 4));
	const total30 = $derived(fromIso ? forecastTotals(confirmed, budgetState.overrides, fromIso, 30, getMerchantCategoryMap()) : null);
</script>

{#if (showTotal && total30 && recurring.length > 0) || (showList && next.length > 0)}
	<div class="grid gap-4 {showTotal && showList ? '@xl:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]' : ''}">
		<!-- Total expected within 30 days, with a range -->
		{#if showTotal && total30 && recurring.length > 0}
		<div>
			<p class="label-xs">À venir sous 30 jours</p>
			<p class="amount-md mt-1.5">{formatEUR(total30.expected)}</p>
			<p class="meta-xs mt-1">
				entre <span class="tabular">{formatEUR(total30.low)}</span> et <span class="tabular">{formatEUR(total30.high)}</span>
				· {recurring.length} échéance{recurring.length > 1 ? 's' : ''} détectée{recurring.length > 1 ? 's' : ''}
			</p>
			<a href="/budget" class="mt-3 inline-block text-xs font-medium transition-colors hover:underline" style="color: var(--accent);">
				Voir le détail des prévisions
			</a>
		</div>
		{/if}
		<!-- Next deadlines of the schedule (debits, loans, taxes, car, savings, goals) -->
		{#if showList && next.length > 0}
		<div>
			<ul class="divide-y divide-[var(--border-subtle)]">
				{#each next as item (item.id)}
					<li class="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
						<span class="h-2 w-2 shrink-0 rounded-full" style="background-color: {KIND_COLORS[item.kind]};" title={KIND_LABELS[item.kind]}></span>
						<div class="min-w-0 flex-1">
							<p class="truncate text-sm font-medium">{item.label}</p>
							<p class="meta-xs mt-0.5">{KIND_LABELS[item.kind]} · {formatDate(item.date)}</p>
						</div>
						{#if item.amount !== undefined}<span class="tabular shrink-0 text-sm font-semibold">{item.sensitive ? sensitiveEUR(item.amount) : formatEUR(item.amount)}</span>{/if}
						{#if showConfidence && item.confidence}
							<span class="chip shrink-0" style={confidenceStyle(item.confidence)}>
								{confidenceLabel(item.confidence)}
							</span>
						{/if}
					</li>
				{/each}
			</ul>
			<a href="/echeancier" class="mt-2 inline-block text-xs font-medium transition-colors hover:underline" style="color: var(--accent);">Voir l'échéancier</a>
		</div>
		{/if}
	</div>
{/if}
