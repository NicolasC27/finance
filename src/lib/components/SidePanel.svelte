<script lang="ts">
	import type { Snippet } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { modal } from '$lib/actions/modal';
	import { isTopPanel, panelClosed, panelOpened, sidePanelState } from '$lib/sidePanel.svelte';
	import { PANEL_SLIDE_MS } from '$lib/sidePanelLayout';

	/**
	 * Right-hand panel for forms, options and imports.
	 * - Desktop (≥ 1024 px): slides in from the right over the page, which does not move and stays
	 *   usable (no backdrop, no focus trap). × or Escape closes it; a click on the page does not.
	 *   The slide sits in the very block that `open` toggles: nested one block deeper, Svelte would
	 *   treat it as a non-local transition and skip it on open and close.
	 * - Narrow screens: fullscreen overlay with a dimmed backdrop and a focus trap, as before.
	 * `footer` is pinned under the scrolling body.
	 */
	let {
		open,
		title,
		onClose,
		width = 420,
		children,
		footer = undefined
	}: { open: boolean; title: string; onClose: () => void; width?: number; children: Snippet; footer?: Snippet } = $props();

	const panelId = `side-panel-${Math.random().toString(36).slice(2, 9)}`;
	const titleId = `${panelId}-title`;
	const reduceMotion = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
	const duration = reduceMotion ? 0 : PANEL_SLIDE_MS;
	const docked = $derived(sidePanelState.wide);

	let drawer = $state<HTMLElement | null>(null);

	/** Open desktop panels are tracked, so Escape closes the most recent one. */
	$effect(() => {
		if (open && docked) panelOpened(panelId);
		else panelClosed(panelId);
		return () => panelClosed(panelId);
	});

	/**
	 * Desktop panel: the focus moves in on open and back to the opener on close; Escape closes the
	 * most recent panel unless a dialog above already handled it.
	 */
	$effect(() => {
		if (!open || !docked) return;
		const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		queueMicrotask(() => drawer?.focus());
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== 'Escape' || e.defaultPrevented || !isTopPanel(panelId)) return;
			e.preventDefault();
			onClose();
		};
		window.addEventListener('keydown', onKey);
		return () => {
			window.removeEventListener('keydown', onKey);
			const active = document.activeElement;
			if (opener && document.contains(opener) && (!active || active === document.body || !!drawer?.contains(active))) opener.focus();
		};
	});
</script>

{#if open && docked}
	<div
		bind:this={drawer}
		class="side-panel-docked fixed top-0 right-0 z-40 flex h-full flex-col border-l outline-none"
		style="width: {width}px; border-color: var(--border); background-color: var(--surface);"
		role="dialog"
		aria-modal="false"
		aria-labelledby={titleId}
		tabindex="-1"
		transition:fly={{ x: width, duration, easing: cubicOut, opacity: 1 }}
	>
		{@render panelBody()}
	</div>
{:else if open}
	<div
		class="side-panel-backdrop fixed inset-0 z-50 flex justify-end"
		role="presentation"
		transition:fade={{ duration: reduceMotion ? 0 : 150 }}
		onclick={(e) => {
			if (e.target === e.currentTarget) onClose();
		}}
	>
		<div
			class="side-panel-drawer flex h-full w-full flex-col border-l"
			style="border-color: var(--border); background-color: var(--surface); --panel-width: {width}px;"
			role="dialog"
			aria-modal="true"
			aria-labelledby={titleId}
			tabindex="-1"
			use:modal={{ onEscape: onClose }}
		>
			{@render panelBody()}
		</div>
	</div>
{/if}

{#snippet panelBody()}
	<div class="flex items-center justify-between gap-3 border-b px-4 py-3" style="border-color: var(--border-subtle);">
		<h2 id={titleId} class="label-xs">{title}</h2>
		<button type="button" class="cursor-pointer text-secondary transition-colors hover:text-[var(--text)]" aria-label="Fermer" title="Fermer (Échap)" onclick={onClose}>
			<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true">
				<path d="M6 6l12 12M18 6L6 18" />
			</svg>
		</button>
	</div>
	<div class="min-h-0 flex-1 overflow-y-auto px-4 py-3 text-[13px]">
		{@render children()}
	</div>
	{#if footer}
		<div class="border-t px-4 py-3" style="border-color: var(--border-subtle);">
			{@render footer()}
		</div>
	{/if}
{/snippet}

<style>
	.side-panel-docked {
		box-shadow: -12px 0 32px -18px rgb(0 0 0 / 0.35);
	}

	.side-panel-backdrop {
		background-color: color-mix(in srgb, var(--bg) 55%, transparent);
		backdrop-filter: blur(4px);
	}

	.side-panel-drawer {
		box-shadow: var(--shadow-soft, 0 1px 2px rgba(0, 0, 0, 0.25));
		animation: side-panel-slide 200ms cubic-bezier(0.2, 0.6, 0.2, 1) backwards;
	}

	@media (min-width: 640px) {
		.side-panel-drawer {
			width: var(--panel-width);
			max-width: 100vw;
		}
	}

	@keyframes side-panel-slide {
		from {
			transform: translateX(24px);
			opacity: 0;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.side-panel-drawer {
			animation: none;
		}
	}
</style>
