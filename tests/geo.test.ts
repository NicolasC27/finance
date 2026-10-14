import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanCountryCode, cleanGeoQuery, cleanTile, distanceKm, fitView, isLocated, parseNominatim, pathKm, project, unproject, visibleTiles, worldSize } from '../src/lib/geo';
import { dayColor, dayKm, DAY_COLORS } from '../src/lib/itinerary';
import { hrefOf, parsePath } from '../src/lib/routes';

const lisbon = { lon: -9.1393, lat: 38.7223 };

test('project: the origin of the world is top-left, Greenwich/equator the middle, and unproject inverts it', () => {
	const corner = project({ lon: -180, lat: 85.05112878 }, 0);
	assert.ok(Math.abs(corner.x) < 1e-6 && Math.abs(corner.y) < 1e-6, `${corner.x},${corner.y}`);
	const middle = project({ lon: 0, lat: 0 }, 1);
	assert.equal(Math.round(middle.x), 256);
	assert.equal(Math.round(middle.y), 256);
	const back = unproject(project(lisbon, 12), 12);
	assert.ok(Math.abs(back.lon - lisbon.lon) < 1e-9);
	assert.ok(Math.abs(back.lat - lisbon.lat) < 1e-9);
	assert.equal(worldSize(3), 2048);
});

test('unproject wraps the longitude past the antimeridian', () => {
	const p = unproject({ x: worldSize(2) * 1.25, y: worldSize(2) / 2 }, 2);
	assert.ok(Math.abs(p.lon - -90) < 1e-9);
});

test('fitView: one place at street level, several within the viewport minus the margin, none → null', () => {
	assert.equal(fitView([], 600, 400), null);
	assert.equal(fitView([lisbon], 0, 0), null);
	assert.deepEqual(fitView([lisbon], 600, 400), { center: lisbon, zoom: 15 });
	const belem = { lon: -9.216, lat: 38.6916 };
	const view = fitView([lisbon, belem], 600, 400)!;
	assert.ok(view.zoom >= 10 && view.zoom <= 16, `zoom ${view.zoom}`);
	for (const p of [lisbon, belem]) {
		const c = project(view.center, view.zoom);
		const q = project(p, view.zoom);
		assert.ok(Math.abs(q.x - c.x) <= 300 - 48 + 1e-6, 'inside horizontally');
		assert.ok(Math.abs(q.y - c.y) <= 200 - 48 + 1e-6, 'inside vertically');
	}
	const spread = fitView([lisbon, { lon: 139.7, lat: 35.7 }], 300, 200)!;
	assert.equal(spread.zoom, 2);
});

test('visibleTiles covers the viewport with unique keys and wrapped tile columns', () => {
	const tiles = visibleTiles({ center: { lon: 0, lat: 0 }, zoom: 2 }, 1200, 300);
	assert.ok(tiles.length > 0);
	assert.equal(new Set(tiles.map((t) => t.key)).size, tiles.length);
	assert.ok(tiles.every((t) => t.x >= 0 && t.x < 4 && t.y >= 0 && t.y < 4));
	assert.ok(tiles.some((t) => t.left < 0) && tiles.some((t) => t.left + 256 > 1200));
	assert.deepEqual(visibleTiles({ center: lisbon, zoom: 12 }, 0, 0), []);
});

test('distances: Lisbon–Belém about 5 km, a path sums its legs, a day counts its located places only', () => {
	const belem = { lon: -9.216, lat: 38.6916 };
	const d = distanceKm(lisbon, belem);
	assert.ok(d > 7 && d < 8, `${d}`);
	assert.equal(pathKm([lisbon]), 0);
	assert.equal(pathKm([lisbon, belem, lisbon]), Math.round(d * 2 * 10) / 10);
	const p = (id: string, lat: number | null, lon: number | null) => ({ id, name: id, url: '', cost: null, envelope: 'activites' as const, lat, lon });
	assert.equal(dayKm({ id: 'd', title: '', notes: '', places: [p('a', lisbon.lat, lisbon.lon), p('x', null, null), p('b', belem.lat, belem.lon)] }), Math.round(d * 10) / 10);
	assert.equal(dayKm(null), 0);
	assert.ok(isLocated(p('a', 1, 2)) && !isLocated(p('b', null, 2)));
});

test('day colours: eight in a fixed order, reused from the start beyond', () => {
	assert.equal(DAY_COLORS.length, 8);
	assert.equal(dayColor(0), DAY_COLORS[0]);
	assert.equal(dayColor(8), DAY_COLORS[0]);
	assert.equal(dayColor(9), DAY_COLORS[1]);
});

test('cleanGeoQuery and cleanCountryCode accept what the geocoder can take', () => {
	assert.equal(cleanGeoQuery('  Tour de   Belém '), 'Tour de Belém');
	assert.equal(cleanGeoQuery('Tram 28, Lisbonne'), 'Tram 28, Lisbonne');
	assert.equal(cleanGeoQuery(''), null);
	assert.equal(cleanGeoQuery('x'.repeat(121)), null);
	assert.equal(cleanGeoQuery('a\u0000b'), null);
	assert.equal(cleanGeoQuery(42), null);
	assert.equal(cleanCountryCode('PT'), 'pt');
	assert.equal(cleanCountryCode('prt'), '');
	assert.equal(cleanCountryCode(null), '');
});

test('parseNominatim takes the first result with usable coordinates', () => {
	assert.equal(parseNominatim({}), null);
	assert.equal(parseNominatim([]), null);
	assert.equal(parseNominatim([{ lat: 'x', lon: '1' }]), null);
	assert.deepEqual(parseNominatim([{ lat: '95', lon: '1' }, { lat: '38.6916123456', lon: '-9.2160', display_name: 'Torre de Belém, Lisboa' }]), { lat: 38.69161, lon: -9.216, label: 'Torre de Belém, Lisboa' });
	assert.equal(parseNominatim([{ lat: '1', lon: '2' }])!.label, '');
});

test('cleanTile only accepts an existing tile of a known style and layer', () => {
	assert.deepEqual(cleanTile('light', 'base', '12', '1951', '1565'), { style: 'light', layer: 'base', z: 12, x: 1951, y: 1565 });
	assert.deepEqual(cleanTile('dark', 'labels', '0', '0', '0'), { style: 'dark', layer: 'labels', z: 0, x: 0, y: 0 });
	assert.equal(cleanTile('sepia', 'base', '1', '0', '0'), null);
	assert.equal(cleanTile('light', 'roads', '1', '0', '0'), null);
	assert.equal(cleanTile('light', 'base', '1', '2', '0'), null);
	assert.equal(cleanTile('light', 'base', '17', '0', '0'), null);
	assert.equal(cleanTile('light', 'base', '1.5', '0', '0'), null);
	assert.equal(cleanTile('light', 'base', '1', '-1', '0'), null);
});

test('router: a trip id under /vacances is the sub-path of that page, the rest unchanged', () => {
	assert.deepEqual(parsePath('/vacances/trip-lisbonne'), { path: '/vacances', rest: 'trip-lisbonne' });
	assert.deepEqual(parsePath('/vacances/trip%20x/'), { path: '/vacances', rest: 'trip x' });
	assert.deepEqual(parsePath('/vacances'), { path: '/vacances', rest: '' });
	assert.deepEqual(parsePath('/budget/foo'), { path: '/', rest: '' });
	assert.deepEqual(parsePath('/transactions.html'), { path: '/transactions', rest: '' });
	assert.equal(hrefOf('/vacances', 'trip-lisbonne'), '/vacances/trip-lisbonne');
	assert.equal(hrefOf('/budget'), '/budget');
});
