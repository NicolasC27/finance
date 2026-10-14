import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monthAfter, monthsToAfford, perDayOf, rankWishes, sanitizeWishes, validateWish, wishTripInput, type Wish } from '../src/lib/wishes';

const wish = (id: string, name: string, budget: number, days: number): Wish => ({ id, name, country: '', budget, days, season: '', notes: '', createdAt: 0 });

test('validateWish: a name, positive figures or none, known seasons only', () => {
	const ok = validateWish({ name: '  Islande ', country: 'Islande', budget: '3 400,50', days: '10', season: 'ete', notes: ' van ' });
	assert.deepEqual(ok, { ok: true, value: { name: 'Islande', country: 'Islande', budget: 3400.5, days: 10, season: 'ete', notes: 'van' } });
	assert.deepEqual(validateWish({ name: 'X', country: '', budget: '', days: '', season: 'mousson', notes: '' }), { ok: true, value: { name: 'X', country: '', budget: 0, days: 0, season: '', notes: '' } });
	assert.equal(validateWish({ name: ' ', country: '', budget: '', days: '', season: '', notes: '' }).ok, false);
	assert.equal(validateWish({ name: 'X', country: '', budget: '-5', days: '', season: '', notes: '' }).ok, false);
	assert.equal(validateWish({ name: 'X', country: '', budget: '', days: '2.5', season: '', notes: '' }).ok, false);
	assert.equal(validateWish({ name: 'X', country: '', budget: '', days: '400', season: '', notes: '' }).ok, false);
});

test('rankWishes: cheapest per day first, the ones without figures last', () => {
	const ranked = rankWishes([wish('a', 'Vietnam', 2800, 15), wish('b', 'Islande', 3400, 10), wish('c', 'Écosse', 1500, 7), wish('d', 'Zanzibar', 0, 0), wish('e', 'Açores', 900, 0)]);
	assert.deepEqual(
		ranked.map((w) => w.id),
		['a', 'c', 'b', 'e', 'd']
	);
	assert.equal(perDayOf(wish('x', 'x', 2800, 15)), 186.67);
	assert.equal(perDayOf(wish('x', 'x', 2800, 0)), null);
});

test('monthsToAfford and monthAfter', () => {
	assert.equal(monthsToAfford(3400, 500), 7);
	assert.equal(monthsToAfford(3400, 500, 3400), 0);
	assert.equal(monthsToAfford(3400, 0), null);
	assert.equal(monthAfter('2026-10-08', 7), '2027-05');
	assert.equal(monthAfter('2026-10-08', 0), '2026-10');
	assert.equal(monthAfter('2026-10-08', 3), '2027-01');
});

test('wishTripInput: an idea without dates, notes kept', () => {
	const w: Wish = { id: 'w', name: 'Islande', country: 'Islande', budget: 3400, days: 10, season: 'ete', notes: 'Route 1', createdAt: 0 };
	assert.deepEqual(wishTripInput(w), { name: 'Islande', destination: 'Islande', country: 'Islande', start: '', end: '', travellers: 2, status: 'idee', notes: 'Route 1', photo: '' });
});

test('sanitizeWishes: id and name required, figures positive or 0, seasons checked', () => {
	const out = sanitizeWishes([{ id: 'a', name: 'Islande', budget: 3400, days: 10, season: 'ete', notes: 'x', createdAt: 5 }, { id: 'b', name: 'Y', budget: -1, days: 2.5, season: 'nope' }, { id: 'c', name: ' ' }, { name: 'no id' }, null, 'x']);
	assert.deepEqual(out, [
		{ id: 'a', name: 'Islande', country: '', budget: 3400, days: 10, season: 'ete', notes: 'x', createdAt: 5 },
		{ id: 'b', name: 'Y', country: '', budget: 0, days: 0, season: '', notes: '', createdAt: 0 }
	]);
	assert.deepEqual(sanitizeWishes('x'), []);
});
