import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LIST_COLUMNS, cardColumns, chartHeight, figureColumns } from '../src/lib/tileGrid';

test('cards: columns follow the tile width (container queries), no class for a single card', () => {
	assert.equal(cardColumns(0), '');
	assert.equal(cardColumns(1), '');
	assert.equal(cardColumns(2), '@md:grid-cols-2');
	assert.equal(cardColumns(3), '@md:grid-cols-2 @3xl:grid-cols-3');
	assert.equal(cardColumns(4), '@md:grid-cols-2 @4xl:grid-cols-4');
	assert.equal(cardColumns(7), cardColumns(4), 'plus de quatre cartes : quatre par rangée au plus');
});

test('figures: two per row from a narrow tile up, all on one row when the tile is wide', () => {
	assert.equal(figureColumns(1), '');
	assert.equal(figureColumns(2), '@xs:grid-cols-2');
	assert.equal(figureColumns(3), '@xs:grid-cols-2 @xl:grid-cols-3');
	assert.equal(figureColumns(4), '@xs:grid-cols-2 @2xl:grid-cols-4');
});

test('grids follow only the tile width, never the window width', () => {
	for (const cls of [LIST_COLUMNS, cardColumns(4), figureColumns(4)]) {
		assert.ok(cls.split(' ').every((c) => c.startsWith('@')), cls);
	}
});

test('chart height: what the tile leaves above and below, with a floor and a default value', () => {
	assert.equal(chartHeight(null, 40, 20, 240), 240, 'tuile sans hauteur fixée : hauteur par défaut');
	assert.equal(chartHeight({ h: 500 }, 80, 30, 240), 390);
	assert.equal(chartHeight({ h: 150 }, 80, 30, 240), 120, 'petite tuile : le graphique garde son plancher (la tuile défile)');
	assert.equal(chartHeight({ h: 150 }, 80, 30, 240, 60), 60);
	assert.equal(chartHeight({ h: 300.7 }, 0, 0, 240), 300);
});
