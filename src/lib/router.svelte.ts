/** Home-made router (~40 lines): History API + View Transitions (graceful fallback). */

export type RoutePath = '/' | '/budget' | '/analyse' | '/trier' | '/transactions' | '/patrimoine' | '/crypto' | '/rapport' | '/ia' | '/portage' | '/voiture';

const KNOWN: RoutePath[] = ['/', '/budget', '/analyse', '/trier', '/transactions', '/patrimoine', '/crypto', '/rapport', '/ia', '/portage', '/voiture'];

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

/** SPA navigation: pushState + view transition when supported (graceful fallback). */
export function navigate(to: RoutePath): void {
	if (to === route.path) return;
	const update = () => {
		history.pushState({}, '', to);
		route.path = to;
	};
	if (typeof document.startViewTransition === 'function') {
		document.startViewTransition(update);
	} else {
		update();
	}
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
		route.path = normalizePath(location.pathname);
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
