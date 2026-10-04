import type { BlockShow } from './layoutModel';

/**
 * Column spans of the Crypto page tables once the user hid optional columns (block elements).
 * Positions: Actif and Valeur always, Quantité, Prix + Jour (« cours »), Part, PRU + Gain
 * (« revient ») on demand. Taxes: five fixed columns, « Déclaré » and the export button on demand.
 */

/** Number of columns of the positions table. */
export function positionColumns(show: BlockShow): number {
	return 2 + (show('quantite') ? 1 : 0) + (show('cours') ? 2 : 0) + (show('part') ? 1 : 0) + (show('revient') ? 2 : 0);
}

/**
 * Spans of the « Autres » row around its Valeur cell: `lead` covers Actif, Quantité and Prix; `tail`
 * covers PRU, Gain and Jour (0: no trailing cell). The optional Part cell sits between them.
 */
export function othersRowSpans(show: BlockShow): { lead: number; tail: number } {
	return { lead: 1 + (show('quantite') ? 1 : 0) + (show('cours') ? 1 : 0), tail: (show('revient') ? 2 : 0) + (show('cours') ? 1 : 0) };
}

/** Number of columns of the yearly tax table. */
export function taxColumns(show: BlockShow): number {
	return 5 + (show('declare') ? 1 : 0) + (show('export') ? 1 : 0);
}
