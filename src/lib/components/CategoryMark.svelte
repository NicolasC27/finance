<script lang="ts">
	import { getCategory } from '$lib/categories';
	import type { CategoryId } from '$lib/types';
	import CategoryIcon from './CategoryIcon.svelte';
	import Mark from './Mark.svelte';

	/** Mark of a budget category: its icon on a tint of its colour (operation lists, category pickers). */
	let { id, size = 24, title = false }: { id: CategoryId; size?: number; /** Category name as a tooltip, when the row does not write it. */ title?: boolean } = $props();

	const category = $derived(getCategory(id));
</script>

<Mark color={category.color} {size} title={title ? category.label : undefined}>
	<CategoryIcon {id} size={Math.round(size * 0.62)} />
</Mark>
