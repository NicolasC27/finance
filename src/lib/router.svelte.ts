import { onDestroy, tick } from 'svelte';
import { navDirection } from './navOrder';
import { beginPageChange, settleEntrances } from './motion.svelte';
import { hrefOf, parsePath, type RoutePath } from './routes';

/** Home-made router: History API + View Transitions (graceful fallback). */

export { hrefOf, normalizePath, parsePath, type RoutePath } from './routes';

/**
 * Current route (reactive): the page, the sub-path for a nested page ('' otherwise) and `visit`, which
 * changes when Back or Forward lands on another history entry of the same page: the app shell
 * re-creates the page so that entry's snapshot is restored.
 */
export const route = $state<{ path: RoutePath; rest: string; visit: number }>({
	...parsePath(typeof location === 'undefined' ? '/' : location.pathname),
	visit: 0
});

/** Loads the code of a page before it is shown (lazy pages), set by the app shell. */
let preload: ((to: RoutePath) => Promise<unknown> | undefined) | null = null;

export function setRoutePreloader(fn: (to: RoutePath) => Promise<unknown> | undefined): void {
	preload = fn;
}

/** Longest wait for the code of a page: past it the page opens anyway and fills in when the code arrives. */
const PRELOAD_WAIT_MS = 400;

/** Latest navigation: an older one still waiting for its page code, or skipped by a newer transition, gives way. */
let navToken = 0;

/** View transition on screen: only it removes the <html> tags when it ends. */
let shownTransition: ViewTransition | null = null;

/**
 * History entry on screen, the scroll position each visited entry was left at and the view state of
 * its page (see pageSnapshot), kept for the tab (sessionStorage) so Back, Forward and a reload all
 * return to the page as it was left.
 */
const SCROLLS_KEY = 'budget:scroll-positions';
const SNAPSHOTS_KEY = 'budget:page-snapshots';
const ENTRIES_KEPT = 50;
let entryKey = '';
let scrolls = new Map<string, number>();
let snapshots = new Map<string, Record<string, unknown>>();
const capturers = new Map<string, () => unknown>();

function newEntryKey(): string {
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function readEntries<T>(storageKey: string, valid: (value: unknown) => value is T): Map<string, T> {
	try {
		const saved: unknown = JSON.parse(sessionStorage.getItem(storageKey) ?? '[]');
		return new Map(Array.isArray(saved) ? saved.filter((e): e is [string, T] => Array.isArray(e) && typeof e[0] === 'string' && valid(e[1])) : []);
	} catch {
		return new Map();
	}
}

/** Saves the newest entries (storage full or disabled: they stay in memory). */
function writeEntries(storageKey: string, entries: Map<string, unknown>): void {
	try {
		sessionStorage.setItem(storageKey, JSON.stringify([...entries].slice(-ENTRIES_KEPT)));
	} catch {
		return;
	}
}

/** Entry on screen, read from the history once: the first page is created before initRouter runs. */
function ensureEntry(): void {
	if (entryKey) return;
	scrolls = readEntries(SCROLLS_KEY, (v): v is number => typeof v === 'number');
	snapshots = readEntries(SNAPSHOTS_KEY, (v): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v));
	entryKey = typeof history.state?.key === 'string' ? history.state.key : newEntryKey();
}

/** Notes how the entry on screen was left, scroll and page view state (moved last, so the oldest entries are dropped first). */
function leaveEntry(): void {
	scrolls.delete(entryKey);
	scrolls.set(entryKey, window.scrollY);
	writeEntries(SCROLLS_KEY, scrolls);
	const parts: Record<string, unknown> = {};
	for (const [id, capture] of capturers) {
		try {
			parts[id] = $state.snapshot(capture());
		} catch (e) {
			console.error(`pageSnapshot ${id}`, e);
		}
	}
	snapshots.delete(entryKey);
	if (Object.keys(parts).length > 0) snapshots.set(entryKey, parts);
	writeEntries(SNAPSHOTS_KEY, snapshots);
}

/**
 * Keeps part of a page's view state (filters, view, sort, open row…) with the history entry, like a
 * SvelteKit snapshot: `capture` runs when the entry is left (page change, reload), `restore` runs
 * during this call when the entry is revisited (Back, Forward, reload), so the page renders as it
 * was left from its first frame. A new visit (link, sidebar) starts fresh. `id` is unique in the app;
 * `capture` returns a plain JSON object (anything else is never handed back). Call during component
 * initialisation, after the states that `restore` sets.
 */
export function pageSnapshot<T extends object>(id: string, capture: () => T, restore: (saved: T) => void): void {
	ensureEntry();
	const parts = snapshots.get(entryKey);
	const part = parts?.[id];
	if (parts && typeof part === 'object' && part !== null && !Array.isArray(part)) {
		const saved = part as T;
		delete parts[id];
		restore(saved);
	}
	capturers.set(id, capture);
	onDestroy(() => {
		if (capturers.get(id) === capture) capturers.delete(id);
	});
}

function pushEntry(href: string): void {
	leaveEntry();
	entryKey = newEntryKey();
	history.pushState({ key: entryKey }, '', href);
}

let stopRestore: (() => void) | null = null;

/**
 * Scrolls to `y`, again each time the page grows (content that arrives late) until it gets there,
 * the user scrolls, types or clicks, or `ms` pass.
 */
function restoreScroll(y: number, ms: number): void {
	stopRestore?.();
	window.scrollTo(0, y);
	if (Math.abs(window.scrollY - y) < 2) return;
	const inputs = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const;
	const stop = () => {
		ro.disconnect();
		window.clearTimeout(timer);
		for (const type of inputs) window.removeEventListener(type, stop, true);
		stopRestore = null;
	};
	const ro = new ResizeObserver(() => {
		window.scrollTo(0, y);
		if (Math.abs(window.scrollY - y) < 2) stop();
	});
	const timer = window.setTimeout(stop, ms);
	for (const type of inputs) window.addEventListener(type, stop, { capture: true, passive: true });
	ro.observe(document.body);
	stopRestore = stop;
}

/**
 * Shows another page: its code is loaded first (PRELOAD_WAIT_MS at most, so the transition shows a
 * full page), then the swap runs inside a view transition when supported, tagging <html> with the
 * direction (data-nav-dir) so the CSS fades the old page out and raises the new one; instant swap
 * otherwise. The new page opens at `scrollTop()`, its entrances settled (the transition is its only
 * movement). The tags only live during the transition: a view-transition-name makes a stacking
 * context, which would trap the fullscreen blocks under the sidebar the rest of the time.
 */
function transition(to: RoutePath, update: () => void, scrollTop: () => number): void {
	const token = ++navToken;
	const run = () => {
		if (token !== navToken) return;
		const root = document.documentElement;
		const swap = async () => {
			if (token !== navToken) return;
			beginPageChange();
			update();
			if ('navDir' in root.dataset) root.dataset.navIn = '';
			await tick();
			if (token !== navToken) return;
			restoreScroll(scrollTop(), 1500);
			settleEntrances(document.querySelector('.app-main'));
		};
		if (typeof document.startViewTransition !== 'function') return void swap();
		delete root.dataset.navIn;
		root.dataset.navDir = navDirection(route.path, to);
		const vt = document.startViewTransition(swap);
		shownTransition = vt;
		void vt.finished.finally(() => {
			if (shownTransition !== vt) return;
			shownTransition = null;
			delete root.dataset.navDir;
			delete root.dataset.navIn;
		});
	};
	const ready = preload?.(to);
	if (!ready) return run();
	const waited = new Promise((resolve) => window.setTimeout(resolve, PRELOAD_WAIT_MS));
	void Promise.race([ready.catch(() => undefined), waited]).then(run);
}

/**
 * SPA navigation: pushState + directional view transition between pages when supported (graceful
 * fallback); the new page, or the new sub-path of a nested page, opens at the top. A click on the page
 * on screen while Back/Forward still waits for its page gives that page its own address back.
 */
export function navigate(to: string): void {
	const next = parsePath(to);
	const href = hrefOf(next.path, next.rest);
	if (next.path === route.path) {
		navToken++;
		if (next.rest !== route.rest) {
			pushEntry(href);
			route.rest = next.rest;
			void tick().then(() => restoreScroll(0, 1500));
		} else if (location.pathname !== href) {
			pushEntry(href);
		}
		return;
	}
	transition(
		next.path,
		() => {
			pushEntry(href);
			route.path = next.path;
			route.rest = next.rest;
		},
		() => 0
	);
}

/**
 * Installs the global listeners: popstate, interception of internal links (every internal
 * <a href="/..."> without a modifier goes through the router) and their preloading on hover or
 * focus. An unknown URL ('/foo') shows the Dashboard AND fixes the URL, otherwise clicking
 * 'Dashboard' never replaced it. Scroll positions and page snapshots are kept by the router (manual
 * restoration): Back, Forward and a reload return to each entry as it was left.
 */
export function initRouter(): () => void {
	history.scrollRestoration = 'manual';
	ensureEntry();
	if (route.path === '/' && !/^\/(index(\.html)?)?$/.test(location.pathname.replace(/\/+$/, '') || '/')) {
		history.replaceState({ key: entryKey }, '', '/');
	} else if (history.state?.key !== entryKey) {
		history.replaceState({ ...history.state, key: entryKey }, '');
	}
	const reloaded = scrolls.get(entryKey);
	if (reloaded) restoreScroll(reloaded, 5000);

	const onPopState = (e: PopStateEvent) => {
		const next = parsePath(location.pathname);
		const key = typeof e.state?.key === 'string' ? e.state.key : newEntryKey();
		if (e.state?.key !== key) history.replaceState({ ...e.state, key }, '');
		const enter = () => {
			leaveEntry();
			entryKey = key;
		};
		const target = () => scrolls.get(key) ?? 0;
		if (next.path !== route.path) {
			transition(
				next.path,
				() => {
					enter();
					route.path = next.path;
					route.rest = next.rest;
				},
				target
			);
			return;
		}
		navToken++;
		const otherEntry = key !== entryKey;
		enter();
		route.rest = next.rest;
		if (otherEntry) route.visit++;
		void tick().then(() => restoreScroll(target(), 1500));
	};

	const onPageHide = () => leaveEntry();

	const onIntent = (e: Event) => {
		const anchor = (e.target as Element | null)?.closest?.('a[href]');
		if (anchor instanceof HTMLAnchorElement && anchor.origin === location.origin) void preload?.(parsePath(anchor.pathname).path);
	};

	const onClick = (e: MouseEvent) => {
		if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
		const anchor = (e.target as Element | null)?.closest?.('a[href]');
		if (!(anchor instanceof HTMLAnchorElement)) return;
		if (anchor.target || anchor.hasAttribute('download')) return;
		const url = new URL(anchor.href);
		if (url.origin !== location.origin) return;
		e.preventDefault();
		navigate(url.pathname);
	};

	window.addEventListener('popstate', onPopState);
	window.addEventListener('pagehide', onPageHide);
	document.addEventListener('click', onClick);
	document.addEventListener('pointerover', onIntent, { passive: true });
	document.addEventListener('focusin', onIntent);
	return () => {
		stopRestore?.();
		window.removeEventListener('popstate', onPopState);
		window.removeEventListener('pagehide', onPageHide);
		document.removeEventListener('click', onClick);
		document.removeEventListener('pointerover', onIntent);
		document.removeEventListener('focusin', onIntent);
	};
}
