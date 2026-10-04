import { test } from 'node:test';
import assert from 'node:assert/strict';
import { othersRowSpans, positionColumns, taxColumns } from '../src/lib/cryptoTables';

const POSITION_ELEMENTS = ['quantite', 'cours', 'part', 'revient'] as const;

/** Every subset of the optional position columns, as a show() function. */
function subsets(): ((id: string) => boolean)[] {
	return Array.from({ length: 1 << POSITION_ELEMENTS.length }, (_, mask) => (id: string) => {
		const i = POSITION_ELEMENTS.indexOf(id as (typeof POSITION_ELEMENTS)[number]);
		return i < 0 || (mask & (1 << i)) !== 0;
	});
}

test('positions: 8 columns with everything shown, 2 with only Actif and Valeur', () => {
	assert.equal(positionColumns(() => true), 8);
	assert.equal(positionColumns(() => false), 2);
	assert.equal(positionColumns((id) => id === 'cours'), 4);
});

test('positions: the « Autres » row always spans exactly the table width', () => {
	for (const show of subsets()) {
		const { lead, tail } = othersRowSpans(show);
		assert.equal(lead + 1 + (show('part') ? 1 : 0) + tail, positionColumns(show));
	}
});

test('taxes: 7 columns with « Déclaré » and the export button, 5 without', () => {
	assert.equal(taxColumns(() => true), 7);
	assert.equal(taxColumns(() => false), 5);
	assert.equal(taxColumns((id) => id === 'export'), 6);
});
