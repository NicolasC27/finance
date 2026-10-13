/**
 * Right-click menus of the page contents.
 *
 * A page gives an element its entries with the action `use:contextActions={() => [ … ]}` (types in
 * contextMenuModel.ts); the provider runs when the menu opens. A right click, the Menu key or
 * Shift + F10 on a focused element, or a long press of a finger, then gathers the entries of every
 * element with actions from the target up (nearest first, separated) and shows them:
 * - inside a tile (TileCanvas), in the block menu, above the block entries;
 * - elsewhere, in the shared menu (ContextMenu.svelte, mounted once in App.svelte).
 * Without any entry the browser keeps its own menu; Shift + right click always keeps it, and so does
 * a text field (paste, spelling). A long press never opens it on a slider (the held thumb drags).
 */

import { cleanItems, composeMenu, isMenuKey, isTextField, LONG_PRESS_MS, LONG_PRESS_SLOP, stepIndex, typeAhead, type MenuAction, type MenuInput, type MenuItem, type MenuProvider } from './contextMenuModel';

export { SEPARATOR, type MenuAction, type MenuItem, type MenuInput, type MenuProvider, type MenuSubmenu } from './contextMenuModel';

const ATTR = 'data-context-actions';

const providers = new WeakMap<Element, MenuProvider>();

/** Element the focus goes back to when a menu closes (a focusable SVG segment counts). */
export type MenuTrigger = HTMLElement | SVGElement;

/** The shared menu on screen: its entries, the pointer point and the element focused before. */
export interface OpenMenu {
	items: MenuItem[];
	x: number;
	y: number;
	trigger: MenuTrigger | null;
	/** Opened from the keyboard: the first entry takes the focus. */
	keyboard: boolean;
}

export const contextMenuState = $state<{ open: OpenMenu | null }>({ open: null });

/** Svelte action: the element offers these entries in its right-click menu. */
export function contextActions(node: Element, provider: MenuProvider) {
	providers.set(node, provider);
	node.setAttribute(ATTR, '');
	return {
		update(next: MenuProvider) {
			providers.set(node, next);
		},
		destroy() {
			providers.delete(node);
			node.removeAttribute(ATTR);
		}
	};
}

/**
 * Nearest element with entries, from a target up; null when none, or when the target is a text
 * field (the browser menu stays there: paste, spelling).
 */
function nearestHost(target: EventTarget | null): Element | null {
	return target instanceof Element && !isTextField(target as HTMLElement) ? target.closest(`[${ATTR}]`) : null;
}

/** Does the target, or one of its ancestors, offer entries? */
export function hasActions(target: EventTarget | null): boolean {
	return nearestHost(target) !== null;
}

/** A finger held on the target opens its menu: it offers entries and is no slider (a held thumb drags). */
export function holdOpensMenu(target: EventTarget | null): boolean {
	return hasActions(target) && (target as Element).closest('[role="slider"], input[type="range"]') === null;
}

/** Entries of every element with actions from the target up, nearest first, in one menu. */
export function collectActions(target: EventTarget | null): MenuItem[] {
	const groups: (readonly MenuInput[])[] = [];
	for (let el = nearestHost(target); el; el = el.parentElement?.closest(`[${ATTR}]`) ?? null) {
		const provider = providers.get(el);
		if (provider) groups.push(provider());
	}
	return composeMenu(groups);
}

/** Element focused now, which gets the focus back when the menu closes (null: nothing focused). */
export function focusedTrigger(): MenuTrigger | null {
	const active = document.activeElement;
	return (active instanceof HTMLElement || active instanceof SVGElement) && active !== document.body ? active : null;
}

/** Opens the shared menu (outside tiles); nothing happens without an entry. */
export function openContextMenu(items: readonly MenuInput[], x: number, y: number, keyboard = false): void {
	const clean = cleanItems(items);
	if (clean.length === 0) return;
	contextMenuState.open = { items: clean, x, y, keyboard, trigger: focusedTrigger() };
}

export function closeContextMenu(): void {
	contextMenuState.open = null;
}

/** Gives the focus back to the element focused before the menu, unless an action put it elsewhere. */
export function restoreFocus(trigger: MenuTrigger | null): void {
	queueMicrotask(() => {
		const active = document.activeElement;
		if (active && active !== document.body && active.isConnected) return;
		if (trigger?.isConnected) trigger.focus({ preventScroll: true });
	});
}

/** Runs a picked entry (the menu is already closed), then gives the focus back when it was lost. */
export function runMenuAction(action: MenuAction, trigger: MenuTrigger | null): void {
	if (action.disabled) return;
	action.onSelect();
	restoreFocus(trigger);
}

/** Svelte action: moves the node to <body>, out of any ancestor that would clip or shift it. */
export function portal(node: HTMLElement) {
	document.body.appendChild(node);
	return {
		destroy() {
			node.remove();
		}
	};
}

const ENTRY = '[role="menuitem"]:not(:disabled), [role="menuitemcheckbox"]:not(:disabled), input:not(:disabled)';

/** Entries of a menu panel the keyboard moves between, in screen order (its submenus apart). */
export function menuEntries(panel: HTMLElement): HTMLElement[] {
	return [...panel.querySelectorAll<HTMLElement>(ENTRY)].filter((el) => el.closest('[role="menu"]') === panel && el.getClientRects().length > 0);
}

let typed = '';
let typedAt = 0;

/**
 * Keyboard inside a menu panel: arrows, Home and End move the focus, a letter jumps to the next
 * entry starting with it (several letters typed quickly spell a label). Every key stays in the
 * menu: page shortcuts never fire behind it.
 */
export function menuKeydown(e: KeyboardEvent, panel: HTMLElement): void {
	e.stopPropagation();
	if (e.key === 'Tab') {
		e.preventDefault();
		return;
	}
	const entries = menuEntries(panel);
	const current = entries.indexOf(document.activeElement as HTMLElement);
	const step = stepIndex(entries.length, current, e.key);
	if (step !== null) {
		e.preventDefault();
		entries[step]?.focus();
		return;
	}
	if (e.key.length !== 1 || e.key === ' ' || e.ctrlKey || e.metaKey || e.altKey) return;
	const now = Date.now();
	typed = now - typedAt > 600 ? e.key : typed + e.key;
	typedAt = now;
	const hit = typeAhead(
		entries.map((el) => el.getAttribute('aria-label') ?? el.closest('label')?.textContent ?? el.textContent ?? ''),
		current,
		typed
	);
	if (hit >= 0) {
		e.preventDefault();
		entries[hit]?.focus();
	}
}

/** Key that closes a whole menu, the focus going back to its trigger: Échap (once no submenu is open) or Tab. */
export function closesMenu(e: KeyboardEvent): boolean {
	return e.key === 'Tab' || (e.key === 'Escape' && !document.querySelector('[data-menu-sub]'));
}

/** Focuses the first entry of a panel (keyboard opening), else the panel itself so the arrows work. */
export function focusMenu(panel: HTMLElement, firstEntry: boolean): void {
	const first = firstEntry ? menuEntries(panel)[0] : undefined;
	(first ?? panel).focus({ preventScroll: true });
}

/** Element inside a tile of a TileCanvas: its block menu shows the entries. */
function inTile(target: EventTarget | null): boolean {
	return target instanceof Element && target.closest('[data-tile]') !== null;
}

/** How long after the release the click of a gesture is awaited (the browser sends it right away). */
const RELEASE_CLICK_MS = 120;

/**
 * Swallows the click the browser sends when the pointer of a gesture is released (a long press that
 * opened a menu, a dragged tile): a link or a button under it must not act. `released`: called while
 * the release itself is handled (a drag dropped on pointerup), the click comes next; otherwise the
 * pointer is still down (held finger, drag cancelled with Escape) and its release is awaited.
 */
export function swallowClickAfterRelease(released = false): void {
	const stop = (e: Event) => {
		e.stopPropagation();
		e.preventDefault();
	};
	const arm = () => {
		window.removeEventListener('pointerup', arm, true);
		window.removeEventListener('pointercancel', arm, true);
		window.addEventListener('click', stop, { capture: true, once: true });
		setTimeout(() => window.removeEventListener('click', stop, { capture: true }), RELEASE_CLICK_MS);
	};
	if (released) {
		arm();
		return;
	}
	window.addEventListener('pointerup', arm, true);
	window.addEventListener('pointercancel', arm, true);
}

/**
 * Listeners of the shared menu, outside tiles (installed once by ContextMenu.svelte): right click,
 * Menu key or Shift + F10, long press of a finger. Returns the cleanup.
 */
export function installContextMenus(): () => void {
	let quietUntil = 0;
	let press: (() => void) | null = null;

	const onContextMenu = (e: MouseEvent) => {
		press?.();
		if (e.defaultPrevented || e.shiftKey || inTile(e.target)) return;
		if (Date.now() < quietUntil) {
			e.preventDefault();
			return;
		}
		const items = collectActions(e.target);
		if (items.length === 0) return;
		e.preventDefault();
		openContextMenu(items, e.clientX, e.clientY);
	};

	const onKeyDown = (e: KeyboardEvent) => {
		if (e.defaultPrevented || !isMenuKey(e) || inTile(e.target)) return;
		const target = e.target instanceof Element ? e.target : null;
		const items = collectActions(target);
		if (!target || items.length === 0) return;
		e.preventDefault();
		quietUntil = Date.now() + 600;
		const r = target.getBoundingClientRect();
		openContextMenu(items, r.left + Math.min(16, r.width / 2), r.bottom + 2, true);
	};

	const onPointerDown = (e: PointerEvent) => {
		press?.();
		if (e.pointerType === 'mouse') quietUntil = 0;
		if (e.pointerType === 'mouse' || e.button !== 0 || inTile(e.target) || !holdOpensMenu(e.target)) return;
		const target = e.target;
		const x0 = e.clientX;
		const y0 = e.clientY;
		const timer = setTimeout(() => {
			stop();
			const items = collectActions(target);
			if (items.length === 0) return;
			swallowClickAfterRelease();
			quietUntil = Date.now() + 800;
			openContextMenu(items, x0, y0);
		}, LONG_PRESS_MS);
		const onMove = (ev: PointerEvent) => {
			if (Math.hypot(ev.clientX - x0, ev.clientY - y0) > LONG_PRESS_SLOP) stop();
		};
		const stop = () => {
			clearTimeout(timer);
			press = null;
			window.removeEventListener('pointermove', onMove, true);
			window.removeEventListener('pointerup', stop, true);
			window.removeEventListener('pointercancel', stop, true);
		};
		press = stop;
		window.addEventListener('pointermove', onMove, true);
		window.addEventListener('pointerup', stop, true);
		window.addEventListener('pointercancel', stop, true);
	};

	document.addEventListener('contextmenu', onContextMenu);
	window.addEventListener('keydown', onKeyDown);
	document.addEventListener('pointerdown', onPointerDown, true);
	return () => {
		press?.();
		document.removeEventListener('contextmenu', onContextMenu);
		window.removeEventListener('keydown', onKeyDown);
		document.removeEventListener('pointerdown', onPointerDown, true);
	};
}

/** Target inside a menu panel or inside the submenu it opened (moved to <body>, `data-menu-sub`). */
export function insideMenu(target: EventTarget | null, panel: HTMLElement | null): boolean {
	if (!(target instanceof Node)) return false;
	if (panel?.contains(target)) return true;
	return target instanceof Element && target.closest('[data-menu-sub]') !== null;
}
