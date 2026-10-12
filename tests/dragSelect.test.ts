import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EDGE, edgeScrollStep, paintRange } from '../src/lib/dragSelect';

const keys = ['a', 'b', null, 'd', 'e'];

test('sliding down or up paints the rows passed over, unselectable rows skipped', () => {
	assert.deepEqual([...paintRange(new Set(), keys, 0, 3, true)].sort(), ['a', 'b', 'd']);
	assert.deepEqual([...paintRange(new Set(), keys, 4, 1, true)].sort(), ['b', 'd', 'e']);
});

test('sliding back gives the rows their state from before the gesture', () => {
	const base = new Set(['e']);
	const far = paintRange(base, keys, 0, 4, true);
	assert.deepEqual([...far].sort(), ['a', 'b', 'd', 'e']);
	assert.deepEqual([...paintRange(base, keys, 0, 1, true)].sort(), ['a', 'b', 'e']);
});

test('starting on a selected row unselects instead', () => {
	assert.deepEqual([...paintRange(new Set(['a', 'b', 'd', 'e']), keys, 1, 3, false)].sort(), ['a', 'e']);
});

test('indexes outside the page are clamped', () => {
	assert.deepEqual([...paintRange(new Set(), keys, 3, 99, true)].sort(), ['d', 'e']);
});

test('the list scrolls by itself only near the window edges, faster at the very edge', () => {
	assert.equal(edgeScrollStep(400, 800), 0);
	assert.ok(edgeScrollStep(EDGE / 2, 800) < 0);
	assert.ok(edgeScrollStep(0, 800) < edgeScrollStep(EDGE / 2, 800));
	assert.ok(edgeScrollStep(799, 800) > edgeScrollStep(800 - EDGE / 2, 800));
	assert.equal(edgeScrollStep(0, 800, 18), -18);
});
