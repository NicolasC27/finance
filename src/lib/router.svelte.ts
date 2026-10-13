import { tick } from 'svelte';
import { navDirection } from './navOrder';
import { beginPageChange, settleEntrances } from './motion.svelte';

/** Home-made router: History API + View Transitions (graceful fallback). */

export type RoutePath = '/' | '/budget' | '/analyse' | '/trier' | '/transactions' | '/patrimoine' | '/crypto' | '/rapport' | '/ia' | '/portage' | '/voiture' | '/historique' | '/simulateur' | '/echeancier' | '/impot';

const KNOWN: RoutePath[] = ['/', '/budget', '/analyse', '/trier', '/transactions', '/patrimoine', '/crypto', '/rapport', '/ia', '/portage', '/voiture', '/historique', '/simulateur', '/echeancier', '/impot'];

/**
 * Normalises a pathname for static hosting:
 * '/transactions.html' → '/transactions', '/index.html' → '/', trailing '/' removed.
 */
export function normalizePath(pathname: string): RoutePath {
	let p = pathname.replace(/\/+$/, '') || '/';
	if (p.endsWith('.html')) p = p.slice(0, -'.html'.length) || '/';
	if (p === '/index') p = '/';
	return KNOWN.includes(p as RoutePath) ? (p as RoutePath) : '/';
}

/** Current route (reactive). */
export const route = $state<{ path: RoutePath }>({
	path: normalizePath(typeof location === 'undefined' ? '/' : location.pathname)
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
 * History entry on screen and the scroll position each visited entry was left at, kept for the tab
 * (sessionStorage) so Back, Forward and a reload all return to where the page was left.
 */
const SCROLLS_KEY = 'budget:scroll-positions';
const SCROLLS_KEPT = 50;
let entryKey = '';
let scrolls = new Map<string, number>();

function newEntryKey(): string {
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function loadScrolls(): Map<string, number> {
	try {
		const saved: unknown = JSON.parse(sessionStorage.getItem(SCROLLS_KEY) ?? '[]');
		return new Map(Array.isArray(saved) ? saved.filter((e): e is [string, number] => Array.isArray(e) && typeof e[0] === 'string' && typeof e[1] === 'number') : []);
	} catch {
		return new Map();
	}
}

/** Notes where the entry on screen was left (moved last, so the oldest entries are dropped first). */
function leaveEntry(): void {
	scrolls.delete(entryKey);
	scrolls.set(entryKey, window.scrollY);
	try {
		sessionStorage.setItem(SCROLLS_KEY, JSON.stringify([...scrolls].slice(-SCROLLS_KEPT)));
	} catch {
		/* storage full or disabled: positions stay in memory */
	}
}

function pushEntry(to: RoutePath): void {
	leaveEntry();
	entryKey = newEntryKey();
	history.pushState({ key: entryKey }, '', to);
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
 * SPA navigation: pushState + directional view transition when supported (graceful fallback); the
 * new page opens at the top. A click on the page on screen while Back/Forward still waits for its
 * page gives that page its own address back.
 */
export function navigate(to: RoutePath): void {
	if (to === route.path) {
		navToken++;
		if (normalizePath(location.pathname) !== to) pushEntry(to);
		return;
	}
	transition(
		to,
		() => {
			pushEntry(to);
			route.path = to;
		},
		() => 0
	);
}

/**
 * Installs the global listeners: popstate, interception of internal links (every internal
 * <a href="/..."> without a modifier goes through the router) and their preloading on hover or
 * focus. An unknown URL ('/foo') shows the Dashboard AND fixes the URL, otherwise clicking
 * 'Dashboard' never replaced it. Scroll positions are kept by the router (manual restoration): Back,
 * Forward and a reload return to where each entry was left.
 */
export function initRouter(): () => void {
	history.scrollRestoration = 'manual';
	scrolls = loadScrolls();
	entryKey = typeof history.state?.key === 'string' ? history.state.key : newEntryKey();
	if (route.path === '/' && !/^\/(index(\.html)?)?$/.test(location.pathname.replace(/\/+$/, '') || '/')) {
		history.replaceState({ key: entryKey }, '', '/');
	} else if (history.state?.key !== entryKey) {
		history.replaceState({ ...history.state, key: entryKey }, '');
	}
	const reloaded = scrolls.get(entryKey);
	if (reloaded) restoreScroll(reloaded, 5000);

	const onPopState = (e: PopStateEvent) => {
		const to = normalizePath(location.pathname);
		const key = typeof e.state?.key === 'string' ? e.state.key : newEntryKey();
		if (e.state?.key !== key) history.replaceState({ ...e.state, key }, '');
		const enter = () => {
			leaveEntry();
			entryKey = key;
		};
		const target = () => scrolls.get(key) ?? 0;
		if (to !== route.path) {
			transition(
				to,
				() => {
					enter();
					route.path = to;
				},
				target
			);
			return;
		}
		navToken++;
		enter();
		restoreScroll(target(), 1500);
	};

	const onPageHide = () => leaveEntry();

	const onIntent = (e: Event) => {
		const anchor = (e.target as Element | null)?.closest?.('a[href]');
		if (anchor instanceof HTMLAnchorElement && anchor.origin === location.origin) void preload?.(normalizePath(anchor.pathname));
	};

	const onClick = (e: MouseEvent) => {
		if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
		const anchor = (e.target as Element | null)?.closest?.('a[href]');
		if (!(anchor instanceof HTMLAnchorElement)) return;
		if (anchor.target || anchor.hasAttribute('download')) return;
		const url = new URL(anchor.href);
		if (url.origin !== location.origin) return;
		e.preventDefault();
		navigate(normalizePath(url.pathname));
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
