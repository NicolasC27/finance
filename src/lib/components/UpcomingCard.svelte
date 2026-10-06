<script lang="ts">
	import { confidenceStyle, confidenceLabel } from '$lib/forecast';
	import { formatDate, formatEUR, sensitiveEUR } from '$lib/format';
	import { getSchedule } from '$lib/schedule.svelte';
	import { KIND_COLORS, KIND_LABELS, scheduleTotal } from '$lib/schedule';

	/**
	 * 'À venir' card (Dashboard): total of the schedule's deadlines within 30 days (direct debits,
	 * loans, taxes…) and the next ones; the full spending forecast stays on the Budget page.
	 */
	let {
		showTotal = true,
		showList = true,
		showConfidence = true
	}: {
		/** Total of the deadlines within 30 days (block element). */
		showTotal?: boolean;
		/** Next payments list (block element). */
		showList?: boolean;
		/** Reliability chip of each payment (block element). */
		showConfidence?: boolean;
	} = $props();

	const within30 = $derived(getSchedule(30).filter((i) => i.amount !== undefined));
	const total30 = $derived(scheduleTotal(within30));
	const kinds = $derived([...new Set(within30.map((i) => KIND_LABELS[i.kind].toLowerCase()))].join(', '));
	const next = $derived(getSchedule(90).slice(0, 4));
</script>

{#if (showTotal && within30.length > 0) || (showList && next.length > 0)}
	<div class="grid gap-4 {showTotal && showList ? '@xl:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]' : ''}">
		<!-- Total of the deadlines within 30 days -->
		{#if showTotal && within30.length > 0}
		<div>
			<p class="label-xs">À venir sous 30 jours</p>
			<p class="amount-md mt-1.5">{formatEUR(total30)}</p>
			<p class="meta-xs mt-1">{within30.length} échéance{within30.length > 1 ? 's' : ''} ({kinds})</p>
			<a href="/budget" class="mt-3 inline-block text-xs font-medium transition-colors hover:underline" style="color: var(--accent);" title="Prévision de toutes les dépenses du mois, courses et dépenses variables comprises">
				Toutes les dépenses prévues
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
