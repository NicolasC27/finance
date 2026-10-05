import { test } from 'node:test';
import assert from 'node:assert/strict';
import { barPath, changePct, interpolateArrays, nearestSeries } from '../src/lib/chartGeometry';

test('barres : extrémité arrondie côté valeur, rayon borné, barre vide sans tracé', () => {
	const up = barPath(10, 20, 100, 40, 4);
	assert.match(up, /^M10,100 L10,44 Q10,40 14,40 L26,40 Q30,40 30,44 L30,100 Z$/);
	const down = barPath(10, 20, 100, 130, 4);
	assert.match(down, /L10,126 Q10,130 14,130/);
	assert.match(barPath(0, 6, 50, 48, 4), /Q0,48 2,48/, 'rayon ≤ longueur et ≤ demi-largeur');
	assert.equal(barPath(0, 10, 50, 50), '');
});

test('variation, courbe la plus proche, interpolation de tableaux', () => {
	assert.equal(changePct(200, 250), 25);
	assert.equal(changePct(-100, -50), 50);
	assert.equal(changePct(0, 10), null);
	assert.equal(nearestSeries([[10, 20], [50, 60]], 1, 57), 1);
	assert.equal(nearestSeries([[10, 20], [50, 60]], 1, 40), null);
	assert.deepEqual(interpolateArrays([0, 10], [10, 30])(0.5), [5, 20]);
	assert.deepEqual(interpolateArrays([0], [10, 30])(0.2), [10, 30], 'longueurs différentes : saut direct');
});

test('transitions de page : sens selon l’ordre de la barre latérale', async () => {
	const { navDirection } = await import('../src/lib/navOrder');
	assert.equal(navDirection('/', '/budget'), 'down');
	assert.equal(navDirection('/patrimoine', '/analyse'), 'up');
	assert.equal(navDirection('/inconnu', '/'), 'down');
});
