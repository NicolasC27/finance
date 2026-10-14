import { test } from 'node:test';
import assert from 'node:assert/strict';
import { atlasCode, atlasEntries, atlasStats, isPastTrip, sanitizeVisits } from '../src/lib/atlas';
import { WORLD, WORLD_VIEWBOX } from '../src/lib/worldMap';
import type { Trip } from '../src/lib/trips';

const mk = (id: string, country: string, start: string, end: string, status: Trip['status'], envelopes: Trip['envelopes'] = {}): Trip => ({ id, name: id, destination: '', country, start, end, travellers: 2, status, notes: '', photo: '', periodId: null, goalId: null, envelopes, checklist: [], quotes: [], days: [], packing: [], createdAt: 0 });

test('world map: one path per country with code, French name and continent, under 120 KB', () => {
	assert.ok(WORLD.length > 150);
	assert.equal(new Set(WORLD.map((c) => c.code)).size, WORLD.length);
	assert.equal(WORLD.find((c) => c.code === 'FR')?.name, 'France');
	assert.equal(WORLD.find((c) => c.code === 'JP')?.continent, 'Asia');
	assert.equal(WORLD.some((c) => c.code === 'AQ'), false);
	assert.ok(WORLD.every((c) => /^M[\d. ]+/.test(c.d) && c.d.endsWith('Z')));
	assert.match(WORLD_VIEWBOX, /^0 0 1000 \d+$/);
	assert.ok(JSON.stringify(WORLD).length < 120 * 1024);
});

test('atlasCode: map names, aliases of the practical table, unknown', () => {
	assert.equal(atlasCode('Portugal'), 'PT');
	assert.equal(atlasCode('états unis'), 'US');
	assert.equal(atlasCode('USA'), 'US');
	assert.equal(atlasCode('Royaume-Uni'), 'GB');
	assert.equal(atlasCode('Japon'), 'JP');
	assert.equal(atlasCode('Narnia'), null);
	assert.equal(atlasCode(''), null);
});

test('atlasEntries: past trips and manual visits are visited, coming ones are wishes, visited wins', () => {
	const trips = [mk('rome', 'Italie', '2025-05-01', '2025-05-05', 'termine'), mk('lisbonne', 'Portugal', '2027-04-10', '2027-04-16', 'prevu'), mk('japon', 'Japon', '', '', 'idee'), mk('sicile', 'Italie', '2027-08-01', '2027-08-10', 'idee'), mk('nulle', 'Atlantide', '', '', 'idee')];
	const entries = atlasEntries(trips, [{ id: 'v', country: 'Maroc', year: 2019 }], '2026-10-07');
	assert.deepEqual([...entries.keys()].sort(), ['IT', 'JP', 'MA', 'PT']);
	assert.equal(entries.get('IT')!.status, 'visited');
	assert.deepEqual(entries.get('IT')!.trips, ['rome', 'sicile']);
	assert.deepEqual(entries.get('IT')!.years, [2025, 2027]);
	assert.equal(entries.get('PT')!.status, 'wish');
	assert.equal(entries.get('JP')!.status, 'wish');
	assert.deepEqual(entries.get('MA')!.trips, ['saisi']);
	assert.equal(isPastTrip({ end: '2026-10-06', status: 'prevu' }, '2026-10-07'), true);
	assert.equal(isPastTrip({ end: '', status: 'idee' }, '2026-10-07'), false);
});

test('atlasStats: countries and continents, trips and nights per year, cost per trip and per night', () => {
	const trips = [mk('rome', 'Italie', '2025-05-01', '2025-05-05', 'termine', { hebergement: 400 }), mk('tokyo', 'Japon', '2025-10-01', '2025-10-11', 'termine'), mk('lisbonne', 'Portugal', '2027-04-10', '2027-04-16', 'prevu')];
	const spent = new Map([['rome', 480], ['tokyo', 2500]]);
	const stats = atlasStats(trips, [{ id: 'v', country: 'Maroc', year: 2019 }], '2026-10-07', (t) => spent.get(t.id) ?? 0);
	assert.equal(stats.countries, 3);
	assert.equal(stats.continents, 3);
	assert.deepEqual(stats.perYear, [{ year: 2025, trips: 2, nights: 14 }]);
	assert.equal(stats.perTrip, 1490);
	assert.equal(stats.perNight, 212.86);
	assert.deepEqual(stats.cheapest, { name: 'rome', perNight: 120 });
	assert.deepEqual(stats.dearest, { name: 'tokyo', perNight: 250 });
	const planned = atlasStats([trips[0]!], [], '2026-10-07', () => 0);
	assert.equal(planned.perTrip, 400);
	assert.equal(planned.dearest, null);
	assert.equal(atlasStats([], [], '2026-10-07', () => 0).perTrip, null);
});

test('sanitizeVisits keeps known countries and plausible years', () => {
	assert.deepEqual(sanitizeVisits([{ id: 'a', country: 'Italie', year: 2022.4 }, { id: 'b', country: 'Narnia', year: 2020 }, { id: 'c', country: 'Grèce', year: 1800 }, null, 'x']), [{ id: 'a', country: 'Italie', year: 2022 }]);
	assert.deepEqual(sanitizeVisits({}), []);
});

test('atlasEntries: wishes are hatched by their country, or by their name when it is one', () => {
	const entries = atlasEntries([], [], '2026-10-08', [{ name: 'Islande', country: 'Islande' }, { name: 'Highlands', country: 'Royaume-Uni' }, { name: 'Nulle part', country: '' }]);
	assert.equal(entries.get('IS')?.status, 'wish');
	assert.deepEqual(entries.get('IS')?.trips, ['envie : Islande']);
	assert.equal(entries.get('GB')?.status, 'wish');
	assert.equal(entries.size, 2);
});
