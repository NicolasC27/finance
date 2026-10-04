<script lang="ts">
	import OdometerAmount from './OdometerAmount.svelte';
	import Sparkline from './Sparkline.svelte';
	import { formatPct } from '$lib/format';

	/** Stat card: label + odometer amount (SPEC v12 §1) + sparkline + arrowed change. */
	let {
		label,
		value,
		variation = undefined,
		variationLabel = 'vs mois précédent',
		favorableUp = true,
		hint = '',
		sparkline = undefined,
		sparklineColor = 'var(--accent)',
		stagger = 0,
		fill = false
	}: {
		label: string;
		value: number;
		/** Change in % vs the comparison period (`variationLabel`). */
		variation?: number;
		/** Comparison base shown after the change ('vs août', 'vs le 3 sept.'). */
		variationLabel?: string;
		/** true = an increase is favourable (teal), false = a decrease is favourable. */
		favorableUp?: boolean;
		hint?: string;
		/** Trend of the period (mini curve). */
		sparkline?: number[];
		sparklineColor?: string;
		/** Entrance delay in ms (stagger). */
		stagger?: number;
		/** Stretch to the height of its container (a tile of its own). */
		fill?: boolean;
	} = $props();

	/**
	 * Favourable change → champagne, unfavourable → --debit (neutral); amber stays reserved for
	 * overruns.
	 */
	const favorable = $derived(
		variation === undefined ? true : favorableUp ? variation >= 0 : variation <= 0
	);
</script>

<div class="card fade-slide p-4 {fill ? 'h-full' : ''}" style="--stagger: {stagger}ms;">
	<div class="flex items-start justify-between gap-3">
		<div class="min-w-0">
			<p class="label-xs">{label}</p>
			<p class="stat-amount mt-1">
				<OdometerAmount {value} />
			</p>
			{#if variation !== undefined}
				<p
					class="meta-xs mt-1 flex flex-wrap items-center gap-1"
					style="color: {favorable ? 'var(--accent)' : 'var(--debit)'};"
				>
					<span class="whitespace-nowrap">
						<span aria-hidden="true">{variation >= 0 ? '▲' : '▼'}</span>
						<span class="tabular">{formatPct(Math.abs(variation), 1)}</span>
					</span>
					<span class="text-secondary">{variationLabel}</span>
				</p>
			{:else if hint}
				<p class="meta-xs mt-1">{hint}</p>
			{/if}
		</div>
		{#if sparkline}
			<Sparkline values={sparkline} color={sparklineColor} />
		{/if}
	</div>
</div>
