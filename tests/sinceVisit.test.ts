import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CategoryId } from '../src/lib/types';
import { diffSince, isNewVisit, takeSnapshot, visitWhen, type VisitData } from '../src/lib/sinceVisit';

/** « Depuis ta dernière visite » on the home page. */

const data = (over: Partial<VisitData> = {}): VisitData => ({
	now: new Date('2026-10-10T09:00:00'),
	day: '2026-10-10',
	month: '2026-10',
	operations: [
		{ key: 'a', date: '2026-10-02' },
		{ key: 'b', date: '2026-10-08' }
	],
	spent: new Map<CategoryId, number>([['loisirs', 120]]),
	budgets: { loisirs: 150 },
	due: [{ id: 'rent', label: 'Loyer', date: '2026-10-12' }],
	...over
});

test('since last visit: nothing changed, nothing to say', () => {
	const snap = takeSnapshot(data());
	assert.equal(diffSince(snap, data({ now: new Date('2026-10-10T12:00:00') })), null);
});

test('since last visit: new operations, a crossed envelope and a deadline that came', () => {
	const snap = takeSnapshot(data());
	const later = data({
		now: new Date('2026-10-13T08:00:00'),
		day: '2026-10-13',
		operations: [...data().operations, { key: 'c', date: '2026-10-12' }, { key: 'd', date: '2026-10-12' }],
		spent: new Map<CategoryId, number>([['loisirs', 180]])
	});
	assert.deepEqual(diffSince(snap, later), { since: snap.at, added: 2, crossed: ['loisirs'], arrived: [{ id: 'rent', label: 'Loyer', date: '2026-10-12' }] });
});

test('since last visit: an envelope already past its budget, or a new month, is not « crossed »', () => {
	const over = takeSnapshot(data({ spent: new Map<CategoryId, number>([['loisirs', 160]]) }));
	assert.equal(diffSince(over, data({ spent: new Map<CategoryId, number>([['loisirs', 190]]) })), null);
	const september = takeSnapshot(data({ month: '2026-09', spent: new Map() }));
	assert.equal(diffSince(september, data({ spent: new Map<CategoryId, number>([['loisirs', 190]]) })), null);
});

test('since last visit: a visit starts after a pause of 30 minutes', () => {
	const snap = takeSnapshot(data());
	assert.equal(isNewVisit(snap, new Date('2026-10-10T09:20:00')), false);
	assert.equal(isNewVisit(snap, new Date('2026-10-10T09:31:00')), true);
});

test('since last visit: the previous visit said in words', () => {
	const now = new Date('2026-10-14T10:00:00');
	assert.equal(visitWhen(new Date('2026-10-14T08:00:00').toISOString(), now), 'plus tôt');
	assert.equal(visitWhen(new Date('2026-10-13T20:00:00').toISOString(), now), 'hier');
	assert.equal(visitWhen(new Date('2026-10-11T20:00:00').toISOString(), now), 'dimanche');
	assert.equal(visitWhen(new Date('2026-10-03T20:00:00').toISOString(), now), 'le 3 octobre');
	assert.equal(visitWhen(new Date('2026-10-01T20:00:00').toISOString(), now), 'le 1er octobre');
});
