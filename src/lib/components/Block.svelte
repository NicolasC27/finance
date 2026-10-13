<script lang="ts">
	import { getContext, type Snippet } from 'svelte';
	import { isElementShown, type BlockElement, type BlockShow, type BlockSize } from '$lib/layoutModel';
	import { isFullscreen, layoutState, registerBlock, setFullscreen, setNaturalHeight, unregisterBlock } from '$lib/layout.svelte';
	import { TILE_CONTEXT, type TileContext } from './TileCanvas.svelte';
	import { tileOuterHeight } from '$lib/tileMeasure';

	/**
	 * Page block shown as a tile of its page canvas (TileCanvas): card, or bare container whose
	 * content brings its own cards.
	 *
	 * Usage:
	 * `<Block page="dashboard" id="donut" defaults={IDS} title="Dépenses du mois" size="S"
	 * elements={[{ id: 'legende', label: 'Légende' }]}>{#snippet children(show, size, box)}
	 * …{#if show('legende')}…{/if}{/snippet}</Block>`
	 *
	 * - `size` (S / M / L / XL) is the default width share used to build the page's first tiles.
	 * - `elements` are optional parts the user can hide from the block menu; the content asks
	 *   `show(id)`. The snippet also gets the width bucket of the tile (inner grids) and, once the
	 *   page has user-defined tiles, the content box in px (charts can fill their tile; null otherwise).
	 * - Gestures, menu and keyboard belong to the canvas; the block forwards its pointer, menu and key
	 *   events, measures its natural content height and follows its tile rectangle.
	 * - Fullscreen shows even for a stored block (palette commands open blocks by id).
	 * - Outside a TileCanvas the block is a plain card.
	 */
	interface Props {
		page: string;
		id: string;
		/** Default block order of the page (kept for older callers; the canvas has it). */
		defaults?: readonly string[];
		title?: string;
		size?: BlockSize;
		/** Former size choices (ignored: tiles are resized to the pixel). */
		sizes?: readonly BlockSize[];
		elements?: readonly BlockElement[];
		class?: string;
		style?: string;
		bare?: boolean;
		children: Snippet<[BlockShow, BlockSize | undefined, { w: number; h: number } | null]>;
	}
	let { page, id, title = '', size, elements = [], class: cls = '', style = '', bare = false, children }: Props = $props();

	const ctx = getContext<TileContext | undefined>(TILE_CONTEXT);

	const prefs = $derived(layoutState.blocks[`${page}:${id}`]);
	const full = $derived(isFullscreen(page, id));
	const label = $derived(title || 'Bloc');
	const tiled = $derived(!!ctx?.tiled);
	const stored = $derived(!!ctx?.stored(id));
	const rect = $derived(ctx?.rect(id) ?? null);
	const lifted = $derived(ctx?.lift(id) ?? null);
	const landing = $derived(!!ctx?.landing(id));
	const tileSize = $derived(ctx ? ctx.size(id) : size);
	const framed = $derived(!bare);

	let host = $state<HTMLElement | null>(null);
	/** Entrance animation over: a block moved in the DOM (reading order follows the tiles) must not replay it. */
	let settled = $state(false);
	let body = $state<HTMLElement | null>(null);
	let content = $state<HTMLElement | null>(null);
	let bodyBox = $state<{ w: number; h: number } | null>(null);

	const box = $derived(tiled && ctx?.fixedHeights && bodyBox ? bodyBox : null);

	/** Visibility of one optional element, read by the block content. */
	const show: BlockShow = (elementId) => isElementShown(prefs, elementId, elements);

	const tileStyle = $derived.by(() => {
		if (!tiled) return '';
		if (!rect) return 'left: 0; top: 0; width: 100%; visibility: hidden;';
		const base = `left: ${rect.x}px; top: ${rect.y}px; width: ${rect.w}px; height: ${rect.h}px;`;
		return lifted ? `${base} transform: translate(${lifted.dx}px, ${lifted.dy}px) scale(1.015);` : base;
	});

	$effect(() => {
		const timer = setTimeout(() => (settled = true), 1500);
		return () => clearTimeout(timer);
	});

	/** First rectangle taken at once (two frames without transition): a block that appears late lands in place, no slide from the corner. */
	let placed = $state(false);
	$effect(() => {
		if (placed || !rect) return;
		let frame = requestAnimationFrame(() => (frame = requestAnimationFrame(() => (placed = true))));
		return () => cancelAnimationFrame(frame);
	});

	$effect(() => {
		registerBlock(page, id, { title: label, elements, size });
		return () => unregisterBlock(page, id);
	});

	/** Natural content height (outer, padding and border included) reported to the canvas. */
	$effect(() => {
		if (!content || !host) return;
		const el = content;
		const section = host;
		const ro = new ResizeObserver(() => setNaturalHeight(page, id, tileOuterHeight(section, el.getBoundingClientRect().height)));
		ro.observe(el);
		return () => ro.disconnect();
	});

	$effect(() => {
		if (!body) return;
		const el = body;
		const ro = new ResizeObserver(() => {
			const w = el.clientWidth;
			const h = el.clientHeight;
			if (!bodyBox || Math.abs(bodyBox.w - w) > 1 || Math.abs(bodyBox.h - h) > 1) bodyBox = { w, h };
		});
		ro.observe(el);
		return () => ro.disconnect();
	});

	$effect(() => {
		if (!full) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') setFullscreen(page, id, false);
		};
		window.addEventListener('keydown', onKey);
		const prev = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		return () => {
			window.removeEventListener('keydown', onKey);
			document.body.style.overflow = prev;
		};
	});

	function onPointerDown(e: PointerEvent) {
		if (ctx && host) ctx.pointerDown(e, id, host);
	}

	function onContextMenu(e: MouseEvent) {
		if (ctx && host) ctx.contextMenu(e, id, host);
	}

	function onKeyDown(e: KeyboardEvent) {
		if (ctx && host && e.target === host) ctx.keyDown(e, id, host);
	}

	/** Elements whose double-click belongs to them (fields, buttons, interactive charts), never to the block. */
	const INTERACTIVE = 'button, a, input, select, textarea, label, summary, [role="button"], [role="application"], [role="slider"], [role="switch"], [contenteditable="true"]';

	/** Double-click on an empty area of the block: fullscreen on, or off when already fullscreen. */
	function onDoubleClick(e: MouseEvent) {
		if ((e.target as Element | null)?.closest(INTERACTIVE)) return;
		window.getSelection()?.removeAllRanges();
		setFullscreen(page, id, !full);
	}

	function openMenuFromButton(e: MouseEvent) {
		const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
		ctx?.openMenu(id, box.left, box.bottom + 4);
	}
</script>

{#if !ctx}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<section class="{framed ? 'card p-4' : ''} {cls}" {style} data-block="{page}:{id}" ondblclick={onDoubleClick}>
		{@render children(show, size, null)}
	</section>
{:else if !stored}
	<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
	<section
		bind:this={host}
		class="tile {framed ? 'card p-4' : ''} {cls}"
		class:tile-tiled={tiled}
		class:tile-lifted={!!lifted}
		class:tile-landing={landing}
		class:tile-unplaced={tiled && !placed}
		class:tile-settled={settled}
		style="{tileStyle} {style}"
		data-block="{page}:{id}"
		data-tile={id}
		tabindex="0"
		role="group"
		aria-label={label}
		aria-roledescription="bloc"
		onpointerdown={onPointerDown}
		oncontextmenu={onContextMenu}
		onkeydown={onKeyDown}
		ondblclick={onDoubleClick}
	>
		{#if full}
			<div class="flex min-h-24 items-center justify-center text-sm text-secondary">{label} · affiché en plein écran</div>
		{:else}
			<div class="tile-body" bind:this={body}>
				<div class="tile-content" bind:this={content}>
					{@render children(show, tileSize, box)}
				</div>
			</div>
		{/if}
		<button type="button" class="tile-more" title="Options du bloc (ou clic droit) · double-clic : plein écran" aria-label="Options du bloc {label}" onclick={openMenuFromButton}>
			<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>
		</button>
	</section>
{/if}

{#if full}
	<div class="block-fullscreen fixed inset-0 z-[80] overflow-auto" role="dialog" aria-modal="true" aria-label={label}>
		<div class="flex min-h-full flex-col px-4 py-3 sm:px-6">
			<div class="mb-3 flex items-center justify-between gap-3">
				<p class="label-xs">{label}</p>
				<button type="button" class="btn btn-secondary btn-sm" onclick={() => setFullscreen(page, id, false)}>
					Fermer <kbd class="kbd ml-1">Échap</kbd>
				</button>
			</div>
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<section class="card flex-1 p-4 sm:p-5" data-fullscreen="true" ondblclick={onDoubleClick} title="Double-clic : quitter le plein écran">
				{@render children(show, 'XL', null)}
			</section>
		</div>
	</div>
{/if}

<style>
	.block-fullscreen {
		background-color: var(--bg);
		animation: block-fullscreen-in var(--motion-slow) var(--ease-out);
	}
	@keyframes block-fullscreen-in {
		from {
			opacity: 0;
			transform: scale(0.985);
		}
	}

	.tile {
		position: relative;
		min-width: 0;
		outline: none;
	}
	.tile:focus-visible {
		box-shadow: 0 0 0 2px var(--accent);
	}

	/* Tiled: absolute rectangle from the tree, content scrolls inside */
	.tile-tiled {
		position: absolute;
		display: flex;
		flex-direction: column;
		transition:
			left 220ms cubic-bezier(0.2, 0.6, 0.2, 1),
			top 220ms cubic-bezier(0.2, 0.6, 0.2, 1),
			width 220ms cubic-bezier(0.2, 0.6, 0.2, 1),
			height 220ms cubic-bezier(0.2, 0.6, 0.2, 1),
			background-color 200ms ease,
			border-color 200ms ease;
	}
	.tile-tiled > .tile-body {
		flex: 1 1 auto;
		min-height: 0;
		overflow: auto;
		scrollbar-width: thin;
	}
	/* Contains the margins of its children, so the measured natural height is the real one */
	.tile-content {
		display: flow-root;
	}
	:global(.tile-canvas-gesture) .tile-tiled,
	:global(.tile-canvas-placing) .tile-tiled,
	.tile-unplaced,
	.tile-landing {
		transition: none;
	}
	.tile-settled {
		animation: none !important;
	}
	.tile-lifted {
		z-index: 50;
		opacity: 0.88;
		box-shadow: 0 22px 48px -14px rgb(0 0 0 / 0.5);
		cursor: grabbing;
		transition: none;
	}

	/* Options button (also the right click), on the top edge: on hover with a mouse, always on touch screens */
	.tile-more {
		position: absolute;
		top: -11px;
		right: 12px;
		z-index: 6;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		border: 1px solid var(--hairline);
		border-radius: 999px;
		background-color: var(--surface);
		color: var(--text-secondary);
		cursor: pointer;
		opacity: 0;
		transition: opacity 140ms ease;
	}
	.tile:hover > .tile-more,
	.tile:focus-within > .tile-more {
		opacity: 1;
	}
	.tile-more:hover {
		color: var(--text);
	}
	@media (hover: none) {
		.tile-more {
			opacity: 0.8;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.tile-tiled {
			transition: none;
		}
	}
</style>
