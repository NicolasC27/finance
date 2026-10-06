<script lang="ts">
	import { getCategory } from '$lib/categories';
	import { merchantLogo } from '$lib/merchantLogos';
	import type { CategoryId } from '$lib/types';
	import { uiState } from '$lib/ui.svelte';
	import BrandMark from './BrandMark.svelte';
	import CategoryMark from './CategoryMark.svelte';

	/**
	 * Mark of an operation: the logo of its brand when the label names a known one and « Logos des
	 * marques » is on, otherwise the mark of its category.
	 */
	let { label, id, size = 24, title = false }: { label: string; id: CategoryId; size?: number; /** Category name as a tooltip, when the row does not write it. */ title?: boolean } = $props();

	const logo = $derived(uiState.brandLogos ? merchantLogo(label) : null);
</script>

{#if logo}
	<BrandMark {logo} color={getCategory(id).color} {size} {title} />
{:else}
	<CategoryMark {id} {size} {title} />
{/if}
