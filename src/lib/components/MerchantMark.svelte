<script lang="ts">
	import { getCategory } from '$lib/categories';
	import { gaugeTitle } from '$lib/envelopes';
	import { envelopeUse } from '$lib/envelopes.svelte';
	import { merchantLogo } from '$lib/merchantLogos';
	import type { CategoryId } from '$lib/types';
	import { uiState } from '$lib/ui.svelte';
	import BrandMark from './BrandMark.svelte';
	import CategoryMark from './CategoryMark.svelte';

	/**
	 * Mark of an operation: the logo of its brand when the label names a known one and « Logos des
	 * marques » is on, otherwise the mark of its category. `month` ('YYYY-MM' of the operation) adds
	 * the envelope gauge of its category when it is the current month.
	 */
	let {
		label,
		id,
		size = 24,
		title = false,
		month
	}: { label: string; id: CategoryId; size?: number; /** Category name as a tooltip, when the row does not write it. */ title?: boolean; month?: string } = $props();

	const logo = $derived(uiState.brandLogos ? merchantLogo(label) : null);
	const gauge = $derived(logo ? envelopeUse(id, month) : null);
</script>

{#if logo}
	<BrandMark {logo} color={getCategory(id).color} {size} {gauge} title={gauge ? `${logo.name} · ${gaugeTitle(getCategory(id).label, gauge)}` : title ? logo.name : undefined} />
{:else}
	<CategoryMark {id} {size} {title} {month} />
{/if}
