<script lang="ts">
	import { tick } from 'svelte';
	import { uiState, showToast } from '$lib/ui.svelte';
	import { navigate, route } from '$lib/router.svelte';
	import { ESSENTIAL_PAGES, MODULES, moduleMeta, type ModuleId } from '$lib/modules';
	import { modulesState, setModuleActive } from '$lib/modules.svelte';

	/**
	 * Modules menu, at the pointer: right-click on the sidebar, « + Modules », long press on « Plus »
	 * (mobile), Menu key or Shift+F10 on a sidebar link. Every module with its tick (description as
	 * tooltip): one click switches it on or off at once, with an undo toast; the essential pages are
	 * greyed out. Right-clicked on an optional module: « Retirer <module> » comes first. Escape or a
	 * click outside closes it; arrows move between entries. Opened from a button at the bottom of the
	 * screen (`above`), it grows upwards so it never covers the finger that opened it.
	 */

	let menu = $state<HTMLDivElement | null>(null);
	let width = $state(0);
	let height = $state(0);

	const anchor = $derived(uiState.modulesMenu);
	const target = $derived(anchor?.target && modulesState.active.includes(anchor.target) ? moduleMeta(anchor.target) : null);

	const position = $derived.by(() => {
		if (!anchor || typeof window === 'undefined') return '';
		const x = Math.max(8, Math.min(anchor.x, window.innerWidth - width - 8));
		if (anchor.above && anchor.y - height >= 8) return `left: ${x}px; bottom: ${window.innerHeight - anchor.y}px;`;
		const y = Math.max(8, Math.min(anchor.above ? 8 : anchor.y, window.innerHeight - height - 8));
		return `left: ${x}px; top: ${y}px;`;
	});

	function close() {
		uiState.modulesMenu = null;
	}

	/** Switches a module and offers to undo; leaving the page of a module just removed. */
	function toggle(id: ModuleId, on: boolean) {
		const message = setModuleActive(id, on);
		if (!on && route.path === moduleMeta(id).route) navigate('/');
		showToast(message, 'Annuler', () => setModuleActive(id, !on));
	}

	function removeTarget(id: ModuleId) {
		close();
		toggle(id, false);
	}

	function openAllSettings() {
		close();
		uiState.settingsSection = 'modules';
		uiState.settingsOpen = true;
	}

	/** Entries the arrows move between (essential pages excluded: they cannot be switched). */
	function entries(): HTMLElement[] {
		return menu ? [...menu.querySelectorAll<HTMLElement>('[data-entry]:not([disabled])')] : [];
	}

	/** On open: focus on the first entry; Escape, outside pointer and arrows handled at window level. */
	$effect(() => {
		if (!anchor) return;
		void tick().then(() => entries()[0]?.focus());
		const onPointerDown = (e: PointerEvent) => {
			if (menu && !menu.contains(e.target as Node)) close();
		};
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				e.preventDefault();
				e.stopImmediatePropagation();
				close();
				return;
			}
			if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
			const list = entries();
			if (!list.length) return;
			e.preventDefault();
			const i = list.indexOf(document.activeElement as HTMLElement);
			const next = e.key === 'ArrowDown' ? (i + 1) % list.length : (i - 1 + list.length) % list.length;
			list[next]?.focus();
		};
		window.addEventListener('pointerdown', onPointerDown, true);
		window.addEventListener('keydown', onKeyDown, true);
		window.addEventListener('blur', close);
		window.addEventListener('resize', close);
		return () => {
			window.removeEventListener('pointerdown', onPointerDown, true);
			window.removeEventListener('keydown', onKeyDown, true);
			window.removeEventListener('blur', close);
			window.removeEventListener('resize', close);
		};
	});
</script>

{#if anchor}
	<div bind:this={menu} bind:offsetWidth={width} bind:offsetHeight={height} class="modules-menu" style={position} role="menu" aria-label="Modules">
		<p class="modules-menu-title">Modules</p>
		{#if target}
			<button type="button" role="menuitem" class="modules-menu-item" data-entry onclick={() => removeTarget(target.id)}>Retirer {target.label}</button>
			<div class="modules-menu-sep" aria-hidden="true"></div>
		{/if}
		{#each ESSENTIAL_PAGES as p (p.route)}
			<button type="button" role="menuitemcheckbox" aria-checked="true" class="modules-menu-check" disabled title="Toujours affiché : page essentielle">
				<span class="modules-menu-box" aria-hidden="true">✓</span>{p.label}
			</button>
		{/each}
		{#each MODULES as m (m.id)}
			{@const active = modulesState.active.includes(m.id)}
			<button type="button" role="menuitemcheckbox" aria-checked={active} class="modules-menu-check" data-entry title={m.description} onclick={() => toggle(m.id, !active)}>
				<span class="modules-menu-box" aria-hidden="true">{active ? '✓' : ''}</span>{m.label}
			</button>
		{/each}
		<div class="modules-menu-sep" aria-hidden="true"></div>
		<button type="button" role="menuitem" class="modules-menu-item" data-entry onclick={openAllSettings}>Tous les réglages des modules…</button>
	</div>
{/if}

<style>
	.modules-menu {
		position: fixed;
		z-index: 85;
		min-width: 210px;
		padding: 6px;
		border: 1px solid var(--hairline);
		border-radius: 10px;
		background-color: var(--surface);
		box-shadow: var(--shadow-soft);
		text-align: left;
		animation: modules-menu-in 120ms ease-out backwards;
	}

	.modules-menu-title {
		margin: 2px 6px 6px;
		font-size: 12px;
		font-weight: 600;
	}

	.modules-menu-sep {
		margin: 5px 0;
		border-top: 1px solid var(--border-subtle);
	}

	.modules-menu-item,
	.modules-menu-check {
		display: flex;
		width: 100%;
		align-items: center;
		gap: 8px;
		padding: 5px 6px;
		border-radius: 6px;
		font-size: 12px;
		text-align: left;
		cursor: pointer;
	}

	.modules-menu-item:hover:not(:disabled),
	.modules-menu-check:hover:not(:disabled),
	.modules-menu-item:focus-visible,
	.modules-menu-check:focus-visible {
		background-color: var(--surface-2);
		outline: none;
	}

	.modules-menu-check:disabled {
		color: var(--text-3);
		cursor: default;
	}

	.modules-menu-box {
		display: inline-flex;
		width: 14px;
		height: 14px;
		flex-shrink: 0;
		align-items: center;
		justify-content: center;
		border: 1px solid var(--hairline);
		border-radius: 4px;
		font-size: 10px;
		color: var(--accent);
	}

	.modules-menu-check[aria-checked='true'] .modules-menu-box {
		border-color: var(--accent);
	}

	@keyframes modules-menu-in {
		from {
			opacity: 0;
			transform: translateY(-2px);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.modules-menu {
			animation: none;
		}
	}
</style>
