<script lang="ts">
	import { tick } from 'svelte';
	import CategoryMark from './CategoryMark.svelte';
	import { isSeparator, isSubmenu, placeSubmenu, type MenuAction, type MenuItem, type MenuSubmenu } from '$lib/contextMenuModel';
	import { focusMenu, menuKeydown, portal } from '$lib/contextMenu.svelte';

	/**
	 * Entries of a right-click menu (shared menu and block menu of a tile): actions with their
	 * shortcut on the right, separators, and submenus that open beside the menu (hover, click,
	 * → or Entrée; ← or Échap closes them). The owner closes its menu and runs the action in `pick`.
	 */
	let { items, pick }: { items: readonly MenuItem[]; pick: (action: MenuAction) => void } = $props();

	const CLOSE_DELAY = 220;

	let openIndex = $state<number | null>(null);
	let anchor = $state<DOMRect | null>(null);
	let trigger: HTMLElement | null = null;
	let subEl = $state<HTMLElement | null>(null);
	let subW = $state(0);
	let subH = $state(0);
	let closeTimer: ReturnType<typeof setTimeout> | undefined;

	const open = $derived(openIndex !== null ? (items[openIndex] as MenuSubmenu | undefined) : undefined);
	const subItems = $derived((open?.items ?? []).filter((s): s is MenuAction | { separator: true } => !!s));
	const subStyle = $derived.by(() => {
		if (!anchor) return '';
		const p = placeSubmenu(anchor, subW, subH, window.innerWidth, window.innerHeight);
		return `left: ${p.left}px; top: ${p.top}px;${subW === 0 ? ' visibility: hidden;' : ''}`;
	});

	/** Opens the submenu of entry `i` beside its button; with `focus`, its first entry takes the focus. */
	function openSub(i: number, button: HTMLElement, focus: boolean): void {
		clearTimeout(closeTimer);
		trigger = button;
		anchor = button.getBoundingClientRect();
		openIndex = i;
		if (focus) void tick().then(() => subEl && focusMenu(subEl, true));
	}

	/** Closes the submenu; `back` returns the focus to the entry that opened it. */
	function closeSub(back = false): void {
		clearTimeout(closeTimer);
		openIndex = null;
		if (back) trigger?.focus({ preventScroll: true });
	}

	/** Pointer on another entry: the submenu closes after a short delay (time to reach it diagonally). */
	function leaveTowards(i: number): void {
		if (i < 0 || openIndex === null || openIndex === i) return;
		clearTimeout(closeTimer);
		closeTimer = setTimeout(() => (openIndex = null), CLOSE_DELAY);
	}

	function onTriggerKey(e: KeyboardEvent, i: number): void {
		if (e.key !== 'ArrowRight' && e.key !== 'Enter' && e.key !== ' ') return;
		e.preventDefault();
		e.stopPropagation();
		openSub(i, e.currentTarget as HTMLElement, true);
	}

	/** Escape while a submenu is open closes only the submenu, wherever the focus is. */
	$effect(() => {
		if (openIndex === null) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== 'Escape') return;
			e.preventDefault();
			e.stopImmediatePropagation();
			closeSub(true);
		};
		window.addEventListener('keydown', onKey, true);
		return () => window.removeEventListener('keydown', onKey, true);
	});

	function onSubKey(e: KeyboardEvent): void {
		if (e.key === 'ArrowLeft') {
			e.preventDefault();
			e.stopPropagation();
			closeSub(true);
			return;
		}
		if (subEl) menuKeydown(e, subEl);
	}

	function choose(action: MenuAction): void {
		if (action.disabled) return;
		clearTimeout(closeTimer);
		openIndex = null;
		pick(action);
	}
</script>

{#snippet entry(action: MenuAction, i: number)}
	<button type="button" role="menuitem" class="ctx-item" class:ctx-danger={action.danger} disabled={action.disabled} onclick={() => choose(action)} onpointerenter={() => leaveTowards(i)}>
		{#if action.category}<CategoryMark id={action.category} size={16} />{/if}
		<span class="min-w-0 flex-1 truncate">{action.label}</span>
		{#if action.hint}<kbd class="kbd ctx-hint">{action.hint}</kbd>{/if}
	</button>
{/snippet}

{#each items as item, i (i)}
	{#if isSeparator(item)}
		<div class="ctx-sep" role="separator"></div>
	{:else if isSubmenu(item)}
		<button
			type="button"
			role="menuitem"
			class="ctx-item"
			aria-haspopup="menu"
			aria-expanded={openIndex === i}
			disabled={item.disabled}
			onclick={(e) => (openIndex === i ? closeSub() : openSub(i, e.currentTarget, false))}
			onpointerenter={(e) => e.pointerType === 'mouse' && openSub(i, e.currentTarget, false)}
			onkeydown={(e) => onTriggerKey(e, i)}
		>
			{#if item.category}<CategoryMark id={item.category} size={16} />{/if}
			<span class="min-w-0 flex-1 truncate">{item.label}</span>
			<svg class="ctx-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
		</button>
	{:else}
		{@render entry(item, i)}
	{/if}
{/each}

{#if open}
	<div
		bind:this={subEl}
		bind:offsetWidth={subW}
		bind:offsetHeight={subH}
		use:portal
		class="ctx-panel ctx-sub"
		style={subStyle}
		role="menu"
		tabindex="-1"
		aria-label={open.label}
		data-menu-sub
		onkeydown={onSubKey}
		onpointerenter={() => clearTimeout(closeTimer)}
	>
		{#each subItems as sub, k (k)}
			{#if isSeparator(sub)}
				<div class="ctx-sep" role="separator"></div>
			{:else}
				{@render entry(sub, -1)}
			{/if}
		{/each}
	</div>
{/if}

<style>
	:global(.ctx-panel) {
		position: fixed;
		z-index: 86;
		min-width: 200px;
		max-width: min(320px, calc(100vw - 16px));
		max-height: calc(100vh - 16px);
		overflow-y: auto;
		padding: 5px;
		border: 1px solid var(--hairline);
		border-radius: 12px;
		background-color: color-mix(in srgb, var(--surface) 94%, transparent);
		backdrop-filter: blur(14px) saturate(1.2);
		box-shadow:
			0 18px 44px -18px rgb(0 0 0 / 0.55),
			0 0 0 1px color-mix(in srgb, var(--accent) 8%, transparent);
		text-align: left;
		outline: none;
		scrollbar-width: thin;
	}
	.ctx-sub {
		z-index: 87;
		animation: ctx-sub-in var(--motion-fast) ease-out;
	}
	@keyframes ctx-sub-in {
		from {
			opacity: 0;
		}
	}
	.ctx-item {
		display: flex;
		width: 100%;
		align-items: center;
		gap: 8px;
		padding: 5px 8px;
		border-radius: 7px;
		font-size: 12px;
		line-height: 1.3;
		text-align: left;
		cursor: pointer;
		transition: background-color var(--motion-fast) ease;
	}
	.ctx-item:hover:not(:disabled),
	.ctx-item:focus-visible,
	.ctx-item[aria-expanded='true'] {
		background-color: var(--surface-2);
		outline: none;
	}
	.ctx-item:disabled {
		opacity: 0.45;
		cursor: default;
	}
	.ctx-danger {
		color: var(--accent-2);
	}
	.ctx-hint {
		flex-shrink: 0;
		margin-left: 8px;
	}
	.ctx-chevron {
		flex-shrink: 0;
		color: var(--text-secondary);
	}
	.ctx-sep {
		margin: 4px 2px;
		border-top: 1px solid var(--border-subtle);
	}
	@media (prefers-reduced-motion: reduce) {
		.ctx-sub {
			animation: none;
		}
	}
</style>
