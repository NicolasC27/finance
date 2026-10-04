<script lang="ts">
	import type { Snippet } from 'svelte';
	import { isSectionCollapsed, toggleSectionCollapse } from '$lib/ui.svelte';

	/**
	 * Persisted collapsible section (SPEC v13 §B): clickable header (1.5 stroke chevron rotating 90°
	 * in 200 ms, accent shift on hover), height-animated collapse/expand (~250 ms, signature easing,
	 * via grid-template-rows 0fr/1fr, see app.css), state persisted in `budget:ui-collapse`.
	 * Accessibility: button + aria-expanded + aria-controls.
	 */

	interface Props {
		/** Persistence key ('goals', 'advisor', 'forecast', 'categories'…). */
		id: string;
		/** Section title (style kept via titleClass). */
		title: string;
		/** Classes of the wrapping <section> (card or bare section). */
		class?: string;
		/** Inline style of the <section> (e.g. --stagger of entrance animations). */
		style?: string;
		/** Title classes (label-xs by default, existing style). */
		titleClass?: string;
		/** Margin under the header (mb-3 by default; mb-0 inside a padded card). */
		headerClass?: string;
		/** Actions on the right of the header (outside the collapse button). */
		actions?: Snippet;
		/** Always-visible intro content (under the header, outside the collapse). */
		intro?: Snippet;
		children: Snippet;
	}

	let {
		id,
		title,
		class: cls = '',
		style = '',
		titleClass = 'label-xs',
		headerClass = 'mb-3',
		actions,
		intro,
		children
	}: Props = $props();

	const collapsed = $derived(isSectionCollapsed(id));
</script>

<section class={cls} {style}>
	<div class="flex {headerClass} items-center justify-between gap-3">
		<button
			type="button"
			class="collapse-toggle"
			aria-expanded={!collapsed}
			aria-controls="section-{id}"
			onclick={() => toggleSectionCollapse(id)}
		>
			<span class={titleClass}>{title}</span>
			<svg
				class="collapse-chevron"
				class:open={!collapsed}
				width="13"
				height="13"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="1.5"
				stroke-linecap="round"
				stroke-linejoin="round"
				aria-hidden="true"
			>
				<path d="m9 6 6 6-6 6" />
			</svg>
		</button>
		{@render actions?.()}
	</div>
	{@render intro?.()}
	<div id="section-{id}" class="collapse-grid" class:closed={collapsed}>
		<div class="collapse-inner">
			{@render children()}
		</div>
	</div>
</section>
