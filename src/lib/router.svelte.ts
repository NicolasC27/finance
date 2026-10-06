import { navDirection } from './navOrder';

/** Home-made router (~40 lines): History API + View Transitions (graceful fallback). */

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

/**
 * Runs a route change inside a view transition when supported, tagging <html> with the direction
 * (data-nav-dir) so the CSS slides the page up or down; instant swap otherwise. The tag only lives
 * during the transition: a view-transition-name makes a stacking context, which would trap the
 * fullscreen blocks under the sidebar the rest of the time.
 */
function transition(to: RoutePath, update: () => void): void {
	if (typeof document.startViewTransition !== 'function') return update();
	const root = document.documentElement;
	root.dataset.navDir = navDirection(route.path, to);
	void document.startViewTransition(update).finished.finally(() => delete root.dataset.navDir);
}

/** SPA navigation: pushState + directional view transition when supported (graceful fallback). */
export function navigate(to: RoutePath): void {
	if (to === route.path) return;
	transition(to, () => {
		history.pushState({}, '', to);
		route.path = to;
	});
}

/**
 * Installs the global listeners: popstate + interception of internal links (every internal
 * <a href="/..."> without a modifier goes through the router). An unknown URL ('/foo') shows the
 * Dashboard AND fixes the URL, otherwise clicking 'Dashboard' never replaced it.
 */
export function initRouter(): () => void {
	if (route.path === '/' && !/^\/(index(\.html)?)?$/.test(location.pathname.replace(/\/+$/, '') || '/')) {
		history.replaceState({}, '', '/');
	}
	const onPopState = () => {
		const to = normalizePath(location.pathname);
		if (to !== route.path) transition(to, () => (route.path = to));
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
	document.addEventListener('click', onClick);
	return () => {
		window.removeEventListener('popstate', onPopState);
		document.removeEventListener('click', onClick);
	};
}
