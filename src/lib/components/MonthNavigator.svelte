<script lang="ts">
	import { budgetState, shiftMonth } from '$lib/budget.svelte';
	import { formatMonth } from '$lib/format';

	/** ‹ month › navigation, limited to the months present in the data. */
	let { months }: { months: string[] } = $props();

	const index = $derived(months.indexOf(budgetState.selectedMonth));
	const canPrev = $derived(index > 0);
	const canNext = $derived(index >= 0 && index < months.length - 1);
</script>

<div class="flex items-center gap-1">
	<button
		type="button"
		class="press flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border transition-colors duration-200 disabled:cursor-default disabled:opacity-30 hover:enabled:bg-[var(--surface-hover)]"
		style="border-color: var(--hairline);"
		disabled={!canPrev}
		onclick={() => shiftMonth(months, -1)}
		aria-label="Mois précédent"
	>
		<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
			<path d="M15 6l-6 6 6 6" />
		</svg>
	</button>
	<span class="min-w-36 text-center text-sm font-medium">
		{budgetState.selectedMonth ? formatMonth(budgetState.selectedMonth) : '—'}
	</span>
	<button
		type="button"
		class="press flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border transition-colors duration-200 disabled:cursor-default disabled:opacity-30 hover:enabled:bg-[var(--surface-hover)]"
		style="border-color: var(--hairline);"
		disabled={!canNext}
		onclick={() => shiftMonth(months, 1)}
		aria-label="Mois suivant"
	>
		<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
			<path d="M9 6l6 6-6 6" />
		</svg>
	</button>
</div>
