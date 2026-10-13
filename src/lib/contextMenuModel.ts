/**
 * Right-click menus, pure part (no DOM, no runes): entry types, how the entries of nested elements
 * are merged, where a menu and its submenu sit inside the window, keyboard moves and type-ahead.
 * The Svelte action, the shared store and the listeners live in contextMenu.svelte.ts.
 */

import type { CategoryId } from './types';

/** Entry the user picks. */
export interface MenuAction {
	label: string;
	onSelect: () => void;
	disabled?: boolean;
	/** Destructive entry (red). */
	danger?: boolean;
	/** Shortcut that does the same, shown on the right (« G », « Entrée »). */
	hint?: string;
	/** Category mark drawn before the label (category lists). */
	category?: CategoryId;
}

/** Entry that opens a list beside the menu (one level only: a submenu holds actions and separators). */
export interface MenuSubmenu {
	label: string;
	items: readonly (MenuAction | MenuSeparator | false | null | undefined)[];
	disabled?: boolean;
	category?: CategoryId;
}

export interface MenuSeparator {
	readonly separator: true;
}

export type MenuItem = MenuAction | MenuSubmenu | MenuSeparator;

/** What a provider returns: falsy entries are dropped, so a page can write `cond && { … }`. */
export type MenuInput = MenuItem | false | null | undefined;

/** Called when the menu opens (never before), so the entries read the state of that moment. */
export type MenuProvider = () => readonly MenuInput[];

/** Thin line between two groups of entries. */
export const SEPARATOR: MenuSeparator = { separator: true };

/** Hold time of a finger that opens the menu (ms) and how far it may drift meanwhile (px). */
export const LONG_PRESS_MS = 500;
export const LONG_PRESS_SLOP = 8;

/** Gap kept between a menu and the window edges (px). */
export const MENU_MARGIN = 8;

export function isSeparator(item: MenuItem): item is MenuSeparator {
	return 'separator' in item;
}

export function isSubmenu(item: MenuItem): item is MenuSubmenu {
	return 'items' in item;
}

/** Separators only between entries: none first, none last, never two in a row. */
function tidySeparators<T extends MenuItem>(items: readonly T[]): T[] {
	const out: T[] = [];
	for (const item of items) {
		if (isSeparator(item) && (out.length === 0 || isSeparator(out[out.length - 1]!))) continue;
		out.push(item);
	}
	while (out.length > 0 && isSeparator(out[out.length - 1]!)) out.pop();
	return out;
}

/** Entries of one provider: falsy ones dropped, submenus with nothing to pick removed, separators tidied. */
export function cleanItems(input: readonly MenuInput[]): MenuItem[] {
	const out: MenuItem[] = [];
	for (const item of input) {
		if (!item) continue;
		if (isSubmenu(item)) {
			const sub = tidySeparators(item.items.filter((s): s is MenuAction | MenuSeparator => !!s));
			if (!sub.some((s) => !isSeparator(s))) continue;
			out.push({ ...item, items: sub });
			continue;
		}
		out.push(item);
	}
	return tidySeparators(out);
}

/**
 * One menu from the entries of nested elements, nearest element first: each group cleaned, empty
 * groups left out, a separator between two groups.
 */
export function composeMenu(groups: readonly (readonly MenuInput[])[]): MenuItem[] {
	const out: MenuItem[] = [];
	for (const group of groups) {
		const items = cleanItems(group);
		if (items.length === 0) continue;
		if (out.length > 0) out.push(SEPARATOR);
		out.push(...items);
	}
	return out;
}

/**
 * Top-left corner of a `w` × `h` menu opened at the pointer (x, y), inside a `vw` × `vh` window:
 * it opens right and down, flips to the left or upwards of the pointer when there is no room, and
 * never leaves the window (a menu taller than the window sticks to its top and scrolls).
 */
export function clampToViewport(x: number, y: number, w: number, h: number, vw: number, vh: number, margin = MENU_MARGIN): { left: number; top: number } {
	const left = x + w + margin > vw ? x - w : x;
	const top = y + h + margin > vh ? y - h : y;
	return {
		left: Math.round(Math.max(margin, Math.min(left, vw - w - margin))),
		top: Math.round(Math.max(margin, Math.min(top, vh - h - margin)))
	};
}

/**
 * Top-left corner of a `w` × `h` submenu beside the entry that opens it (`anchor`, window
 * coordinates): on its right, else on its left, its first entry level with the anchor, inside the
 * window.
 */
export function placeSubmenu(anchor: { left: number; right: number; top: number }, w: number, h: number, vw: number, vh: number, margin = MENU_MARGIN): { left: number; top: number } {
	const right = anchor.right + 2;
	const left = right + w + margin <= vw ? right : anchor.left - w - 2;
	const top = anchor.top - 6;
	return {
		left: Math.round(Math.max(margin, Math.min(left, vw - w - margin))),
		top: Math.round(Math.max(margin, Math.min(top, vh - h - margin)))
	};
}

/**
 * Entry focused after a navigation key among `count` entries (`current` = -1 when none has the
 * focus): arrows wrap around, Home and End go to the ends; null for any other key.
 */
export function stepIndex(count: number, current: number, key: string): number | null {
	if (count === 0) return null;
	if (key === 'Home') return 0;
	if (key === 'End') return count - 1;
	if (key === 'ArrowDown') return current < 0 ? 0 : (current + 1) % count;
	if (key === 'ArrowUp') return current < 0 ? count - 1 : (current - 1 + count) % count;
	return null;
}

/** Lower case without accents, so « é » finds « Égaliser ». */
function fold(text: string): string {
	return text.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
}

/**
 * Entry reached by type-ahead: the next one after `current` whose label starts with `query`
 * (accents and case ignored), wrapping around; the same letter typed again cycles through the
 * entries starting with it. -1 when none matches.
 */
export function typeAhead(labels: readonly string[], current: number, query: string): number {
	const q = fold(query);
	if (!q) return -1;
	const repeated = q.length > 1 && [...q].every((c) => c === q[0]);
	const wanted = repeated ? q[0]! : q;
	const n = labels.length;
	const from = wanted.length > 1 && current >= 0 ? current : current + 1;
	for (let k = 0; k < n; k++) {
		const i = (((from + k) % n) + n) % n;
		if (fold(labels[i]!).startsWith(wanted)) return i;
	}
	return -1;
}

/** Input types where nothing is typed: their right click may show the page entries. */
const NON_TEXT_INPUTS: ReadonlySet<string> = new Set(['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit']);

/**
 * Element where text is typed (text input, textarea, editable content): its right click, Menu key
 * and long press keep the browser menu (paste, spelling), even inside an element with entries.
 */
export function isTextField(el: { tagName: string; type?: string; isContentEditable?: boolean }): boolean {
	if (el.isContentEditable) return true;
	const tag = el.tagName.toUpperCase();
	if (tag === 'TEXTAREA') return true;
	return tag === 'INPUT' && !NON_TEXT_INPUTS.has((el.type || 'text').toLowerCase());
}

/** Key that opens a context menu from the keyboard: the Menu key or Shift + F10. */
export function isMenuKey(e: { key: string; shiftKey: boolean; ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean }): boolean {
	if (e.ctrlKey || e.altKey || e.metaKey) return false;
	return e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10');
}
