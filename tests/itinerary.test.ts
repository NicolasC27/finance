import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanPlace, dayCost, dayList, itineraryTotal, movePlace, perDayBudget, reorderPlace, trimDays, withDay, withNewDay, withoutDay } from '../src/lib/itinerary';
import { sanitizeDays, type TripDay } from '../src/lib/trips';

const place = (id: string, cost: number | null) => ({ id, name: id, url: '', cost, envelope: 'activites' as const, lat: null, lon: null });
const days: TripDay[] = [
	{ id: 'd1', title: 'Alfama', notes: '', places: [place('a', 6.5), place('b', null), place('c', 45)] },
	{ id: 'd2', title: '', notes: '', places: [] },
	{ id: 'd3', title: 'Sintra', notes: '', places: [place('d', 40)] }
];

test('dayList: the days of the stay dated from the departure, written days beyond it flagged, day ideas without dates', () => {
	const dated = dayList({ start: '2027-04-10', end: '2027-04-12', days });
	assert.deepEqual(
		dated.map((d) => [d.index, d.date, d.day?.id ?? null, d.beyond]),
		[
			[0, '2027-04-10', 'd1', false],
			[1, '2027-04-11', 'd2', false],
			[2, '2027-04-12', 'd3', false]
		]
	);
	const longer = dayList({ start: '2027-04-10', end: '2027-04-14', days });
	assert.equal(longer.length, 5);
	assert.equal(longer[4]!.day, null);
	const shortened = dayList({ start: '2027-04-10', end: '2027-04-10', days });
	assert.deepEqual(shortened.map((d) => d.beyond), [false, true, true]);
	const ideas = dayList({ start: '', end: '', days });
	assert.deepEqual(ideas.map((d) => d.date), ['', '', '']);
	assert.deepEqual(dayList({ start: '', end: '', days: [] }), []);
});

test('costs: per day, for the plan, and the per-day budget from the envelopes', () => {
	assert.equal(dayCost(days[0]!), 51.5);
	assert.equal(dayCost(null), 0);
	assert.equal(itineraryTotal({ days }), 91.5);
	assert.equal(perDayBudget({ start: '2027-04-10', end: '2027-04-16', envelopes: { transport: 320, hebergement: 560, repas: 350 } }), 175.71);
	assert.equal(perDayBudget({ start: '', end: '', envelopes: { transport: 320 } }), null);
});

test('withDay pads up to the day, trimDays drops trailing empty days, withoutDay shifts the rest', () => {
	const written = withDay([], 2, (d) => ({ ...d, title: 'Jour 3' }));
	assert.equal(written.length, 3);
	assert.equal(written[2]!.title, 'Jour 3');
	assert.equal(written[0]!.places.length, 0);
	assert.deepEqual(trimDays(withDay(days, 1, (d) => d)).map((d) => d.id), ['d1', 'd2', 'd3']);
	assert.deepEqual(trimDays([...days, { id: 'd4', title: '', notes: '', places: [] }]).map((d) => d.id), ['d1', 'd2', 'd3']);
	assert.equal(withNewDay(days).length, 4);
	assert.deepEqual(withoutDay(days, 1).map((d) => d.id), ['d1', 'd3']);
});

test('movePlace and reorderPlace: between days (padding the target), inside a day (nothing at the ends)', () => {
	const moved = movePlace(days, 0, 'c', 2);
	assert.deepEqual(moved[0]!.places.map((p) => p.id), ['a', 'b']);
	assert.deepEqual(moved[2]!.places.map((p) => p.id), ['d', 'c']);
	const far = movePlace(days, 0, 'a', 5);
	assert.equal(far.length, 6);
	assert.deepEqual(far[5]!.places.map((p) => p.id), ['a']);
	assert.deepEqual(movePlace(days, 0, 'zz', 2), days);
	assert.deepEqual(movePlace(days, 0, 'a', 0), days);
	assert.deepEqual(reorderPlace(days, 0, 'c', -1)[0]!.places.map((p) => p.id), ['a', 'c', 'b']);
	assert.deepEqual(reorderPlace(days, 0, 'a', -1)[0]!.places.map((p) => p.id), ['a', 'b', 'c']);
	assert.deepEqual(reorderPlace(days, 0, 'c', 1)[0]!.places.map((p) => p.id), ['a', 'b', 'c']);
	assert.deepEqual(reorderPlace(days, 7, 'c', 1), days);
});

test('cleanPlace and sanitizeDays', () => {
	assert.deepEqual(cleanPlace({ name: '  Palais  de Pena ', url: '', cost: '40,00', envelope: 'activites' }), { name: 'Palais de Pena', url: '', cost: 40, envelope: 'activites', lat: null, lon: null });
	assert.deepEqual(cleanPlace({ name: 'Gratuit', url: 'https://x.pt/', cost: '', envelope: 'extras' }), { name: 'Gratuit', url: 'https://x.pt/', cost: null, envelope: 'extras', lat: null, lon: null });
	assert.equal(cleanPlace({ name: ' ', url: '', cost: '', envelope: 'extras' }), null);
	assert.equal(cleanPlace({ name: 'X', url: 'ftp://x', cost: '', envelope: 'extras' }), null);
	assert.equal(cleanPlace({ name: 'X', url: '', cost: 'abc', envelope: 'extras' }), null);
	assert.equal(cleanPlace({ name: 'X', url: '', cost: '-5', envelope: 'extras' }), null);
	const clean = sanitizeDays([{ id: 'd', title: 'T', places: [{ id: 'p', name: 'N', cost: 5, envelope: 'nope' }, { id: 'bad' }, null] }, { nope: 1 }, 'x']);
	assert.equal(clean.length, 1);
	assert.deepEqual(clean[0]!.places, [{ id: 'p', name: 'N', url: '', cost: 5, envelope: 'extras', lat: null, lon: null }]);
	assert.equal(clean[0]!.notes, '');
	assert.deepEqual(sanitizeDays(null), []);
	const located = sanitizeDays([{ id: 'd', places: [{ id: 'a', name: 'A', lat: 38.7, lon: -9.1 }, { id: 'b', name: 'B', lat: 38.7 }, { id: 'c', name: 'C', lat: 91, lon: 0 }, { id: 'e', name: 'E', lat: '38', lon: '-9' }] }]);
	assert.deepEqual(
		located[0]!.places.map((p) => [p.id, p.lat, p.lon]),
		[
			['a', 38.7, -9.1],
			['b', null, null],
			['c', null, null],
			['e', null, null]
		]
	);
});
