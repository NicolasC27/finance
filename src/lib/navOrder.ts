/**
 * Order of the pages in the sidebar, used to give page transitions a direction: moving down the
 * list slides the new page up, moving up slides it down.
 */
export const NAV_ORDER: readonly string[] = ['/', '/budget', '/echeancier', '/analyse', '/transactions', '/trier', '/patrimoine', '/crypto', '/voiture', '/portage', '/ia', '/rapport', '/simulateur', '/impot', '/historique'];

/** Direction of a navigation between two paths (unknown paths count as the top of the list). */
export function navDirection(from: string, to: string): 'down' | 'up' {
	const a = Math.max(0, NAV_ORDER.indexOf(from));
	const b = Math.max(0, NAV_ORDER.indexOf(to));
	return b >= a ? 'down' : 'up';
}
