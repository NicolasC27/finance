/** The app's pages and the reading of a pathname (pure; the reactive router is router.svelte.ts). */

export type RoutePath = '/' | '/budget' | '/analyse' | '/trier' | '/transactions' | '/patrimoine' | '/crypto' | '/rapport' | '/ia' | '/portage' | '/voiture' | '/vacances' | '/historique' | '/simulateur' | '/echeancier' | '/impot';

const KNOWN: RoutePath[] = ['/', '/budget', '/analyse', '/trier', '/transactions', '/patrimoine', '/crypto', '/rapport', '/ia', '/portage', '/voiture', '/vacances', '/historique', '/simulateur', '/echeancier', '/impot'];

/** Pages with a sub-path of their own: '/vacances/<trip id>' opens one trip. */
const NESTED: RoutePath[] = ['/vacances'];

/**
 * Reads a pathname for static hosting ('/transactions.html' → '/transactions', '/index.html' →
 * '/', trailing '/' removed): the page and, for a nested page, what follows it; an unknown path
 * is the Dashboard.
 */
export function parsePath(pathname: string): { path: RoutePath; rest: string } {
	let p = pathname.replace(/\/+$/, '') || '/';
	if (p.endsWith('.html')) p = p.slice(0, -'.html'.length) || '/';
	if (p === '/index') p = '/';
	if (KNOWN.includes(p as RoutePath)) return { path: p as RoutePath, rest: '' };
	const slash = p.indexOf('/', 1);
	const head = slash > 0 ? p.slice(0, slash) : p;
	if (NESTED.includes(head as RoutePath)) {
		try {
			return { path: head as RoutePath, rest: decodeURIComponent(p.slice(slash + 1)) };
		} catch {
			return { path: head as RoutePath, rest: '' };
		}
	}
	return { path: '/', rest: '' };
}

/** The page of a pathname. */
export function normalizePath(pathname: string): RoutePath {
	return parsePath(pathname).path;
}

/** Pathname of a page and its sub-path. */
export const hrefOf = (path: RoutePath, rest = ''): string => (rest ? `${path}/${encodeURIComponent(rest)}` : path);
