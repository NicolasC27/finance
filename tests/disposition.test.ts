import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countColumns, effectiveOrder, isElementShown, pageHasChoices, resetPageLayout, sanitizeLayout, sizeOfWidth, storedOf, tilesWithBroughtBack, tilesWithStored, withCanvasHeight, withPrefs, type BlockElement, migrateDashboardSplit, migrateKpis } from '../src/lib/layoutModel';
import { leafIds, layoutTiles, naturalCanvasHeight, LEAF_ESTIMATE, MIN_TILE, TILE_GAP, type TileNode } from '../src/lib/tiles';

const IDS = ['kpis', 'balance', 'donut', 'notes'] as const;

test('order: defaults without choice; removed blocks dropped, new ones at their default place, duplicates ignored', () => {
	assert.deepEqual(effectiveOrder(undefined, IDS), ['kpis', 'balance', 'donut', 'notes']);
	assert.deepEqual(effectiveOrder(['notes', 'donut', 'old', 'balance'], IDS), ['kpis', 'notes', 'donut', 'balance']);
	assert.deepEqual(effectiveOrder(['donut', 'donut', 'notes'], ['donut', 'notes']), ['donut', 'notes']);
	assert.deepEqual(effectiveOrder([], IDS), ['kpis', 'balance', 'donut', 'notes']);
});

test('elements: choice first, then the element default, otherwise shown', () => {
	const elements: BlockElement[] = [{ id: 'legende', label: 'Légende' }, { id: 'plus', label: 'Plus', default: false }];
	assert.equal(isElementShown(undefined, 'legende', elements), true);
	assert.equal(isElementShown(undefined, 'plus', elements), false);
	assert.equal(isElementShown({ elements: { plus: true } }, 'plus', elements), true);
	assert.equal(isElementShown({ elements: { legende: false } }, 'legende', elements), false);
	assert.equal(isElementShown({}, 'inconnu', elements), true);
});

test('block choices: fields merged, empty entries removed', () => {
	let blocks = withPrefs({}, 'dashboard:donut', { size: 'M' });
	assert.deepEqual(blocks, { 'dashboard:donut': { size: 'M' } });
	blocks = withPrefs(blocks, 'dashboard:donut', { hidden: true, elements: { legende: false } });
	assert.deepEqual(blocks['dashboard:donut'], { size: 'M', hidden: true, elements: { legende: false } });
	blocks = withPrefs(blocks, 'dashboard:donut', { size: undefined, hidden: false, elements: {} });
	assert.deepEqual(blocks, {});
});

test('page reset: only that page loses its order, tiles and block choices', () => {
	const layout = {
		order: { dashboard: ['notes', 'kpis'], patrimoine: ['a', 'b'] },
		blocks: { 'dashboard:notes': { hidden: true }, 'patrimoine:a': { size: 'S' as const } },
		tiles: { dashboard: { tree: { id: 'kpis' }, stored: ['notes'] }, crypto: { height: 900 } }
	};
	assert.equal(pageHasChoices(layout, 'dashboard'), true);
	assert.equal(pageHasChoices(layout, 'crypto'), true, 'tiles alone count as a choice');
	const next = resetPageLayout(layout, 'dashboard');
	assert.deepEqual(next, { order: { patrimoine: ['a', 'b'] }, blocks: { 'patrimoine:a': { size: 'S' } }, tiles: { crypto: { height: 900 } } });
	assert.equal(pageHasChoices(next, 'dashboard'), false);
	assert.deepEqual(layout.order.dashboard, ['notes', 'kpis']);
});

test('stored blocks: the page list once it has tiles, else the former hidden or collapsed blocks', () => {
	const layout = {
		blocks: { 'budget:conseils': { collapsed: true }, 'budget:previsions': { hidden: true }, 'budget:resume': { size: 'XL' as const }, 'dashboard:notes': { collapsed: true } },
		tiles: { dashboard: { stored: [] } }
	};
	assert.deepEqual(storedOf(layout, 'budget'), ['conseils', 'previsions'], 'migration: collapsed and hidden become stored');
	assert.deepEqual(storedOf(layout, 'dashboard'), [], 'own list wins once the page has tiles');
	assert.deepEqual(storedOf(layout, 'crypto'), []);
});

test('width buckets of a tile in px, for inner grids', () => {
	assert.equal(sizeOfWidth(300), 'S');
	assert.equal(sizeOfWidth(600), 'M');
	assert.equal(sizeOfWidth(800), 'L');
	assert.equal(sizeOfWidth(1200), 'XL');
});

test('stored layout: corrupted values fall back to defaults, valid ones are kept', () => {
	const empty = { wide: false, order: {}, density: 'normal', blocks: {}, tiles: {}, hint: false };
	assert.deepEqual(sanitizeLayout(null), empty);
	assert.deepEqual(sanitizeLayout('garbage'), empty);
	const clean = sanitizeLayout({
		wide: true,
		density: 'confort',
		order: { dashboard: ['a', 3, 'b'], broken: 'x' },
		blocks: {
			'dashboard:a': { size: 'XXL', hidden: true, collapsed: 'yes', elements: { legende: false, bad: 'no' } },
			'dashboard:b': { size: 'S' },
			'nocolon': { hidden: true },
			'dashboard:c': 'nope',
			'dashboard:d': {}
		},
		tiles: {
			dashboard: { tree: { dir: 'row', ratio: 3, a: { id: 'a' }, b: { id: 'b' } }, stored: ['c', 4, 'c'], height: 50 },
			crypto: { tree: 'nope', height: 'tall' },
			budget: 7
		},
		hint: true
	});
	assert.deepEqual(clean, {
		wide: true,
		density: 'confort',
		order: { dashboard: ['a', 'b'] },
		blocks: { 'dashboard:a': { hidden: true, elements: { legende: false } }, 'dashboard:b': { size: 'S' } },
		tiles: { dashboard: { tree: { dir: 'row', ratio: 0.999, a: { id: 'a' }, b: { id: 'b' } }, stored: ['c'], height: 200 } },
		hint: true
	});
	assert.equal(sanitizeLayout({ density: 'huge' }).density, 'normal');
});

test('columns per visible count: one per item up to four, nothing when empty, written in full', () => {
	assert.equal(countColumns(0, 'sm'), '');
	assert.equal(countColumns(1, 'sm'), 'sm:grid-cols-1');
	assert.equal(countColumns(3, 'sm'), 'sm:grid-cols-3');
	assert.equal(countColumns(4, 'lg'), 'lg:grid-cols-4');
	assert.equal(countColumns(7, 'lg'), 'lg:grid-cols-4', 'capped at four');
	assert.equal(countColumns(2, 'lg'), 'lg:grid-cols-2');
});

const KPIS = ['kpi-solde', 'kpi-entrees', 'kpi-sorties', 'kpi-budget'];

test('migration: the former « Indicateurs » leaf becomes the four figure tiles at its place', () => {
	const old = sanitizeLayout({
		tiles: { dashboard: { tree: { dir: 'col', ratio: 0.2, a: { id: 'balance' }, b: { dir: 'col', ratio: 0.3, a: { id: 'kpis' }, b: { id: 'notes' } } }, stored: ['donut'], height: 1500 } },
		blocks: { 'dashboard:kpis': { elements: { sorties: false, courbes: false } } },
		order: { dashboard: ['kpis', 'balance'] }
	});
	const next = migrateKpis(old);
	const tree = next.tiles.dashboard!.tree!;
	assert.deepEqual(leafIds(tree), ['balance', 'kpi-solde', 'kpi-entrees', 'kpi-budget', 'notes'], 'in place, the unticked figure left out');
	assert.deepEqual(next.tiles.dashboard!.stored, ['donut', 'kpi-sorties'], 'an unticked figure is stored');
	assert.equal(next.tiles.dashboard!.height, 1500);
	const tiles = layoutTiles(tree, { x: 0, y: 0, w: 1012, h: 1500 }).tiles;
	const ys = ['kpi-solde', 'kpi-entrees', 'kpi-budget'].map((id) => tiles.get(id)!.y);
	assert.ok(ys.every((y) => y === ys[0]), 'one row');
	assert.equal(next.blocks['dashboard:kpis'], undefined);
	for (const id of ['kpi-solde', 'kpi-entrees', 'kpi-sorties']) assert.deepEqual(next.blocks[`dashboard:${id}`], { elements: { courbe: false } }, `${id}: curve hidden`);
	assert.equal(next.blocks['dashboard:kpi-budget'], undefined, 'the budget tile has no curve');
	assert.deepEqual(next.order.dashboard, [...KPIS, 'balance']);
	assert.equal(migrateKpis(next), next, 'runs once: nothing left to migrate');
});

test('migration: a stored « Indicateurs » block stores the four tiles; former flags without tiles hide them', () => {
	const stored = migrateKpis(sanitizeLayout({ tiles: { dashboard: { tree: { id: 'balance' }, stored: ['kpis'] } } }));
	assert.deepEqual(stored.tiles.dashboard!.stored, KPIS);
	assert.deepEqual(leafIds(stored.tiles.dashboard!.tree), ['balance']);
	const legacy = migrateKpis(sanitizeLayout({ blocks: { 'dashboard:kpis': { collapsed: true } } }));
	for (const id of KPIS) assert.deepEqual(legacy.blocks[`dashboard:${id}`], { hidden: true });
	const partial = migrateKpis(sanitizeLayout({ blocks: { 'dashboard:kpis': { elements: { solde: false } } } }));
	assert.deepEqual(partial.blocks['dashboard:kpi-solde'], { hidden: true });
	assert.equal(partial.blocks['dashboard:kpi-entrees'], undefined);
	const untouched = sanitizeLayout({ tiles: { dashboard: { tree: { id: 'balance' } } } });
	assert.equal(migrateKpis(untouched), untouched);
});

/** Two stacked rows: a full-width chart over two blocks side by side. */
const SAVED: TileNode = { dir: 'col', ratio: 0.5, a: { id: 'balance' }, b: { dir: 'row', ratio: 0.5, a: { id: 'donut' }, b: { id: 'notes' } } };

test('a saved tree always comes with a canvas height: the fallback fills it, an existing one is kept', () => {
	assert.deepEqual(withCanvasHeight({ stored: ['x'] }, () => 999), { stored: ['x'] });
	assert.equal(withCanvasHeight({ tree: SAVED }, () => 812.4).height, 812);
	assert.equal(withCanvasHeight({ tree: SAVED, height: 640 }, () => 999).height, 640);
	assert.equal(withCanvasHeight({ tree: SAVED, height: 0 }, () => 700).height, 700);
});

test('natural canvas height: stacked rows add up, side by side the tallest wins, unmeasured blocks are estimated', () => {
	const natural: Record<string, number> = { balance: 300, donut: 180, notes: 420 };
	assert.equal(naturalCanvasHeight(SAVED, (id) => natural[id]), 300 + TILE_GAP + 420);
	assert.equal(naturalCanvasHeight(SAVED, () => undefined), LEAF_ESTIMATE * 2 + TILE_GAP);
	assert.equal(naturalCanvasHeight({ id: 'a' }, () => 10), MIN_TILE.h);
	assert.equal(naturalCanvasHeight(null, () => 100), 0);
});

test('bringing a block back on a page never customised keeps it derived: no tree saved, nothing squeezed', () => {
	const next = tilesWithBroughtBack({ stored: ['conseils', 'previsions'] }, ['conseils', 'previsions'], 'conseils', { tree: SAVED, size: { w: 1200, h: 900 } });
	assert.deepEqual(next, { stored: ['previsions'] });
	const fresh = tilesWithBroughtBack({}, ['notes'], 'notes', { tree: SAVED, size: { w: 1200, h: 900 } });
	assert.equal(fresh.tree, undefined);
	assert.deepEqual(fresh.stored, []);
});

test('bringing a block back on a customised page inserts it in the tree on screen (dwindle), height kept', () => {
	const next = tilesWithBroughtBack({ tree: SAVED, height: 900, stored: ['memo'] }, ['memo'], 'memo', { tree: SAVED, size: { w: 1200, h: 900 } });
	assert.deepEqual(leafIds(next.tree).sort(), ['balance', 'donut', 'memo', 'notes']);
	assert.equal(next.height, 900);
	assert.deepEqual(next.stored, []);
	const later = tilesWithBroughtBack({ tree: SAVED, height: 900, stored: ['memo'] }, ['memo'], 'memo');
	assert.deepEqual(leafIds(later.tree), leafIds(SAVED), 'without the screen the canvas inserts it when drawing');
});

test('storing a block: a derived page only lists it; a customised page loses the leaf (or takes the flow result)', () => {
	assert.deepEqual(tilesWithStored({}, [], 'notes', SAVED, { tree: { id: 'balance' }, height: 300 }), { stored: ['notes'] });
	const pruned = tilesWithStored({ tree: SAVED, height: 900 }, [], 'notes');
	assert.deepEqual(leafIds(pruned.tree), ['balance', 'donut']);
	assert.equal(pruned.height, 900);
	const flowed = tilesWithStored({ tree: SAVED, height: 900 }, ['x'], 'notes', SAVED, { tree: { dir: 'col', ratio: 0.6, a: { id: 'balance' }, b: { id: 'donut' } }, height: 640.6 });
	assert.deepEqual(flowed.stored, ['x', 'notes']);
	assert.equal(flowed.height, 641);
});

test('a section collapsed by default that appears after the page got tiles is still stored (Budget migration)', () => {
	const tiles = { tree: { dir: 'col', ratio: 0.5, a: { id: 'resume' }, b: { id: 'conseils' } } as TileNode, height: 1200, stored: ['previsions'] };
	const next = tilesWithStored(tiles, tiles.stored, 'conseils');
	assert.deepEqual(next.stored, ['previsions', 'conseils']);
	assert.deepEqual(leafIds(next.tree), ['resume']);
	assert.equal(next.height, 1200);
	const absent = tilesWithStored({ tree: { id: 'resume' }, height: 500 }, [], 'conseils');
	assert.deepEqual(absent.stored, ['conseils']);
	assert.deepEqual(leafIds(absent.tree), ['resume']);
});

test('home split: blocks move to their canvas with their choices, the figures keep the saved tree, once', () => {
	const old = sanitizeLayout({
		order: { dashboard: ['kpi-solde', 'recent', 'balance', 'kpi-budget'] },
		blocks: { 'dashboard:balance': { elements: { projection: false } }, 'dashboard:recent': { elements: { plus: true } }, 'dashboard:kpi-solde': { elements: { courbe: false } } },
		tiles: {
			dashboard: {
				tree: { dir: 'col', ratio: 0.2, a: { dir: 'row', ratio: 0.5, a: { id: 'kpi-solde' }, b: { id: 'kpi-budget' } }, b: { dir: 'row', ratio: 0.5, a: { id: 'recent' }, b: { id: 'balance' } } },
				height: 1500,
				stored: ['kpi-sorties', 'notes']
			}
		}
	});
	const next = migrateDashboardSplit(old);
	assert.deepEqual(leafIds(next.tiles.dashboard!.tree), ['kpi-solde', 'kpi-budget']);
	assert.equal(next.tiles.dashboard!.height, undefined, 'measured again');
	assert.deepEqual(next.tiles.dashboard!.stored, ['kpi-sorties']);
	assert.deepEqual(next.tiles['dashboard-detail']!.stored, ['notes']);
	assert.deepEqual(next.blocks['dashboard-detail:balance'], { elements: { projection: false } });
	assert.deepEqual(next.blocks['dashboard-main:recent'], { elements: { plus: true } });
	assert.deepEqual(next.blocks['dashboard:kpi-solde'], { elements: { courbe: false } });
	assert.equal(next.blocks['dashboard:balance'], undefined);
	assert.deepEqual(next.order, { dashboard: ['kpi-solde', 'kpi-budget'], 'dashboard-main': ['recent'], 'dashboard-detail': ['balance'] });
	assert.equal(migrateDashboardSplit(next), next, 'runs once');
});
