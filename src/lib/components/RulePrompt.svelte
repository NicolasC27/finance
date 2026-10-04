<script lang="ts">
	import { rulesState, acceptRule, declineRule } from '$lib/rules.svelte';
	import { getCategory } from '$lib/categories';

	/** Discreet 'Toujours catégoriser … ?' toast after an override (once per keyword). */

	const prompt = $derived(rulesState.prompt);
	const category = $derived(prompt ? getCategory(prompt.categoryId) : null);
</script>

{#if prompt && category}
	<div
		class="toast-in fixed right-4 bottom-20 z-40 w-[calc(100vw-2rem)] max-w-sm rounded-xl border p-3.5 shadow-2xl lg:bottom-6"
		style="border-color: var(--hairline); background-color: var(--surface);"
		role="status"
	>
		<p class="text-[13px] leading-snug">
			Toujours catégoriser <strong>« {prompt.label} »</strong> en
			<strong style="color: {category.color};">{category.label}</strong> ?
		</p>
		<div class="mt-2.5 flex items-center gap-2">
			<button
				type="button"
				class="btn btn-primary text-xs"
				onclick={acceptRule}
			>
				Oui
			</button>
			<button
				type="button"
				class="btn btn-secondary text-xs"
				onclick={declineRule}
			>
				Non, juste celle-ci
			</button>
		</div>
	</div>
{/if}
