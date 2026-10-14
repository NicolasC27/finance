<script lang="ts">
	import { getCategory } from '$lib/categories';
	import { gaugeTitle } from '$lib/envelopes';
	import { envelopeUse } from '$lib/envelopes.svelte';
	import type { CategoryId } from '$lib/types';
	import CategoryIcon from './CategoryIcon.svelte';
	import Mark from './Mark.svelte';

	/**
	 * Mark of a budget category: its icon on a tint of its colour (operation lists, category pickers).
	 * With the `month` of an operation of the current month, the tint shows the envelope gauge.
	 */
	let {
		id,
		size = 24,
		title = false,
		month
	}: { id: CategoryId; size?: number; /** Category name as a tooltip, when the row does not write it. */ title?: boolean; /** 'YYYY-MM' of the operation the mark stands for. */ month?: string } = $props();

	const category = $derived(getCategory(id));
	const gauge = $derived(envelopeUse(id, month));
</script>

<Mark color={category.color} {size} {gauge} title={gauge ? gaugeTitle(category.label, gauge) : title ? category.label : undefined}>
	<CategoryIcon {id} size={Math.round(size * 0.62)} />
</Mark>
