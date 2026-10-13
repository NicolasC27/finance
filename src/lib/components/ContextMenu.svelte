<script lang="ts">
	import { tick, untrack } from 'svelte';
	import ContextMenuItems from './ContextMenuItems.svelte';
	import { clampToViewport, type MenuAction } from '$lib/contextMenuModel';
	import { closeContextMenu, closesMenu, contextMenuState, focusMenu, insideMenu, installContextMenus, menuKeydown, restoreFocus, runMenuAction } from '$lib/contextMenu.svelte';
	import { route } from '$lib/router.svelte';
	import { uiState } from '$lib/ui.svelte';

	/**
	 * Shared right-click menu of the page contents outside tiles (mounted once in App.svelte; entries
	 * given by `use:contextActions`, see contextMenu.svelte.ts). It sits inside the window, takes the
	 * focus (its first entry when opened from the keyboard) and closes on Échap or Tab (focus back to
	 * the element it came from), an outside click, a scroll, a resize, a page change or a lost window.
	 * Page shortcuts stay quiet while it is open.
	 */

	let panel = $state<HTMLElement | null>(null);
	let w = $state(0);
	let h = $state(0);

	const open = $derived(contextMenuState.open);
	const position = $derived.by(() => {
		if (!open) return '';
		const p = clampToViewport(open.x, open.y, w, h, window.innerWidth, window.innerHeight);
		return `left: ${p.left}px; top: ${p.top}px;`;
	});

	$effect(() => installContextMenus());

	$effect(() => {
		void route.path;
		closeContextMenu();
	});

	$effect(() => {
		const menu = open;
		if (!menu) return;
		untrack(() => uiState.dialogDepth++);
		void tick().then(() => panel && focusMenu(panel, menu.keyboard));
		const onDown = (e: PointerEvent) => {
			if (!insideMenu(e.target, panel)) closeContextMenu();
		};
		const onKey = (e: KeyboardEvent) => {
			if (!closesMenu(e)) return;
			e.preventDefault();
			e.stopImmediatePropagation();
			closeContextMenu();
			restoreFocus(menu.trigger);
		};
		const onScroll = (e: Event) => {
			if (!insideMenu(e.target, panel)) closeContextMenu();
		};
		document.addEventListener('pointerdown', onDown, true);
		window.addEventListener('keydown', onKey, true);
		window.addEventListener('scroll', onScroll, true);
		window.addEventListener('resize', closeContextMenu);
		window.addEventListener('blur', closeContextMenu);
		return () => {
			untrack(() => (uiState.dialogDepth = Math.max(0, uiState.dialogDepth - 1)));
			document.removeEventListener('pointerdown', onDown, true);
			window.removeEventListener('keydown', onKey, true);
			window.removeEventListener('scroll', onScroll, true);
			window.removeEventListener('resize', closeContextMenu);
			window.removeEventListener('blur', closeContextMenu);
		};
	});

	function pick(action: MenuAction): void {
		const trigger = open?.trigger ?? null;
		closeContextMenu();
		runMenuAction(action, trigger);
	}
</script>

{#if open}
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div bind:this={panel} bind:offsetWidth={w} bind:offsetHeight={h} class="ctx-panel ctx-root" style={position} role="menu" tabindex="-1" aria-label="Actions" onkeydown={(e) => panel && menuKeydown(e, panel)} oncontextmenu={(e) => e.preventDefault()}>
		<ContextMenuItems items={open.items} {pick} />
	</div>
{/if}

<style>
	.ctx-root {
		transform-origin: top left;
		animation: ctx-in var(--motion-base) var(--ease-spring);
	}
	@keyframes ctx-in {
		from {
			opacity: 0;
			transform: scale(0.95) translateY(-3px);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.ctx-root {
			animation: none;
		}
	}
	:global([data-context-actions]) {
		-webkit-touch-callout: none;
	}
	:global([data-context-actions] :is(input, textarea, [contenteditable])) {
		-webkit-touch-callout: default;
	}
</style>
