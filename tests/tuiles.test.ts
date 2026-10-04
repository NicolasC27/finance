import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TILE_GAP, MIN_TILE, dock, dockTile, dropPreview, dropZone, dwindleInsert, edgeSplits, equalize, insertBeside, layoutTiles, leafIds, moveTile, neededHeight, neighbour, nodeAt, orderNeighbour, pruneTree, ratioForSize, removeLeaf, rowsFromOrder, sanitizeTree, setRatio, swapLeaves, treeFromRows, type Rect, type TileNode, LEGACY_WIDTHS, flowResize, fitDelta, replaceLeaf, ratiosFrom, removeFlow } from '../src/lib/tiles';

const CANVAS = { x: 0, y: 0, w: 1012, h: 612 };
const area = (r: Rect) => r.w * r.h;

/** Every pair of tiles is disjoint and the tiles plus the gaps cover the canvas exactly. */
function assertTiled(tree: TileNode, canvas: Rect = CANVAS) {
	const { tiles } = layoutTiles(tree, canvas);
	const rects = [...tiles.values()];
	for (const r of rects) {
		assert.ok(r.x >= canvas.x && r.y >= canvas.y && r.x + r.w <= canvas.x + canvas.w && r.y + r.h <= canvas.y + canvas.h, 'tile inside the canvas');
	}
	for (let i = 0; i < rects.length; i++) {
		for (let j = i + 1; j < rects.length; j++) {
			const a = rects[i]!;
			const b = rects[j]!;
			const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
			assert.ok(apart, 'no overlap');
		}
	}
	return tiles;
}

const two: TileNode = { dir: 'row', ratio: 0.5, a: { id: 'a' }, b: { id: 'b' } };

test('layout: two halves side by side separated by one gap, filling the canvas', () => {
	const tiles = assertTiled(two);
	const a = tiles.get('a')!;
	const b = tiles.get('b')!;
	assert.equal(a.x, 0);
	assert.equal(b.x - (a.x + a.w), TILE_GAP);
	assert.equal(b.x + b.w, CANVAS.w);
	assert.equal(a.h, CANVAS.h);
	assert.equal(a.w + b.w + TILE_GAP, CANVAS.w);
});

test('layout: minimum tile sizes win over an extreme ratio', () => {
	const tiles = layoutTiles(setRatio(two, '', 0.02), CANVAS).tiles;
	assert.ok(tiles.get('a')!.w >= MIN_TILE.w);
	const stacked: TileNode = { dir: 'col', ratio: 0.98, a: { id: 'a' }, b: { id: 'b' } };
	assert.ok(layoutTiles(stacked, CANVAS).tiles.get('b')!.h >= MIN_TILE.h);
});

test('insert next to a tile in the four directions', () => {
	const leaf: TileNode = { id: 't' };
	const left = assertTiled(insertBeside(leaf, 't', 'n', 'left'));
	assert.ok(left.get('n')!.x < left.get('t')!.x);
	const right = assertTiled(insertBeside(leaf, 't', 'n', 'right'));
	assert.ok(right.get('n')!.x > right.get('t')!.x);
	const top = assertTiled(insertBeside(leaf, 't', 'n', 'top'));
	assert.ok(top.get('n')!.y < top.get('t')!.y);
	const bottom = assertTiled(insertBeside(leaf, 't', 'n', 'bottom'));
	assert.ok(bottom.get('n')!.y > bottom.get('t')!.y);
	assert.deepEqual(insertBeside(leaf, 'absent', 'n', 'left'), leaf, 'unknown target: unchanged');
});

test('move: the tile leaves its place (its sibling closes the gap) and splits the target', () => {
	const tree: TileNode = { dir: 'col', ratio: 0.5, a: two, b: { id: 'c' } };
	const moved = moveTile(tree, 'a', 'c', 'right');
	assert.deepEqual(leafIds(moved), ['b', 'c', 'a']);
	const tiles = assertTiled(moved);
	assert.equal(tiles.get('b')!.w, CANVAS.w, 'b took the whole top row');
	assert.ok(tiles.get('a')!.x > tiles.get('c')!.x, 'a on the right of c');
	assert.equal(tiles.get('a')!.y, tiles.get('c')!.y);
	assert.deepEqual(moveTile(tree, 'a', 'a', 'left'), tree, 'onto itself: unchanged');
});

test('move next to its own sibling works (the sibling takes the parent place first)', () => {
	const moved = moveTile(two, 'a', 'b', 'bottom');
	assert.deepEqual(leafIds(moved), ['b', 'a']);
	const tiles = assertTiled(moved);
	assert.ok(tiles.get('a')!.y > tiles.get('b')!.y);
	assert.equal(tiles.get('a')!.w, CANVAS.w);
});

test('swap: the center zone exchanges two tiles and keeps the shape', () => {
	const tree: TileNode = { dir: 'row', ratio: 0.3, a: { id: 'a' }, b: { dir: 'col', ratio: 0.6, a: { id: 'b' }, b: { id: 'c' } } };
	const swapped = moveTile(tree, 'a', 'c', 'center');
	assert.deepEqual(leafIds(swapped), ['c', 'b', 'a']);
	assert.deepEqual(swapLeaves(swapped, 'a', 'c'), tree);
	assert.equal((swapped as { ratio: number }).ratio, 0.3);
});

test('dock: a tile along a whole canvas side, the rest pushed aside', () => {
	const tree: TileNode = { dir: 'col', ratio: 0.5, a: two, b: { id: 'c' } };
	for (const side of ['left', 'right', 'top', 'bottom'] as const) {
		const docked = dockTile(tree, 'c', side);
		const tiles = assertTiled(docked);
		const c = tiles.get('c')!;
		if (side === 'left' || side === 'right') assert.equal(c.h, CANVAS.h, `${side}: full height`);
		else assert.equal(c.w, CANVAS.w, `${side}: full width`);
		if (side === 'left') assert.equal(c.x, 0);
		if (side === 'right') assert.equal(c.x + c.w, CANVAS.w);
		if (side === 'top') assert.equal(c.y, 0);
		if (side === 'bottom') assert.equal(c.y + c.h, CANVAS.h);
	}
	assert.deepEqual(dock(null, 'x', 'left'), { id: 'x' });
});

test('remove: the sibling takes the whole place; the last tile gives an empty tree', () => {
	assert.deepEqual(removeLeaf(two, 'a'), { id: 'b' });
	assert.equal(removeLeaf({ id: 'a' }, 'a'), null);
	assert.deepEqual(removeLeaf(two, 'absent'), two);
	assert.deepEqual(pruneTree({ dir: 'col', ratio: 0.5, a: two, b: { id: 'c' } }, (id) => id !== 'b'), { dir: 'col', ratio: 0.5, a: { id: 'a' }, b: { id: 'c' } });
});

test('bring back (dwindle): the largest tile is split along its longest side', () => {
	const tree: TileNode = { dir: 'row', ratio: 0.7, a: { id: 'big' }, b: { id: 'small' } };
	const wide = dwindleInsert(tree, 'n', { w: 1400, h: 600 });
	const wideTiles = assertTiled(wide, { x: 0, y: 0, w: 1400, h: 600 });
	assert.ok(wideTiles.get('n')!.x > wideTiles.get('big')!.x, 'wide tile split left / right');
	const tall = dwindleInsert({ dir: 'col', ratio: 0.8, a: { id: 'big' }, b: { id: 'small' } }, 'n', { w: 500, h: 1200 });
	const tallTiles = assertTiled(tall, { x: 0, y: 0, w: 500, h: 1200 });
	assert.ok(tallTiles.get('n')!.y > tallTiles.get('big')!.y, 'tall tile split top / bottom');
	assert.ok(area(tallTiles.get('small')!) > 0);
	assert.deepEqual(dwindleInsert(null, 'n', { w: 800, h: 600 }), { id: 'n' });
});

test('pixel resizing: a gutter drag sets the size of the first half, within the minimums', () => {
	const { gutters } = layoutTiles(two, CANVAS);
	const g = gutters[0]!;
	assert.equal(g.path, '');
	assert.equal(g.avail, CANVAS.w - TILE_GAP);
	const wider = setRatio(two, g.path, ratioForSize(g, g.size + 123));
	const tiles = layoutTiles(wider, CANVAS).tiles;
	assert.equal(tiles.get('a')!.w, g.size + 123, 'exact pixel size');
	const tooSmall = layoutTiles(setRatio(two, '', ratioForSize(g, 10)), CANVAS).tiles;
	assert.equal(tooSmall.get('a')!.w, MIN_TILE.w, 'stops at the minimum width');
	const tooBig = layoutTiles(setRatio(two, '', ratioForSize(g, 5000)), CANVAS).tiles;
	assert.equal(tooBig.get('b')!.w, MIN_TILE.w, 'the other half keeps its minimum');
	assert.equal(nodeAt(two, 'a') && 'id' in nodeAt(two, 'a')! ? 'a' : '', 'a');
});

test('edges of a tile: deepest split behind each side, none on the canvas border', () => {
	const tree: TileNode = { dir: 'row', ratio: 0.5, a: { id: 'a' }, b: { dir: 'col', ratio: 0.5, a: { id: 'b' }, b: { id: 'c' } } };
	assert.deepEqual(edgeSplits(tree, 'a'), { right: '' });
	assert.deepEqual(edgeSplits(tree, 'b'), { left: '', bottom: 'b' });
	assert.deepEqual(edgeSplits(tree, 'c'), { left: '', top: 'b' });
	assert.deepEqual(edgeSplits(tree, 'absent'), {});
});

test('migration: former order and widths become stacked rows split by width', () => {
	const widths: Record<string, number> = { kpis: 12, balance: 8, donut: 4, savings: 4, recent: 8, notes: 12 };
	const rows = rowsFromOrder(['kpis', 'balance', 'donut', 'savings', 'recent', 'notes'], (id) => widths[id]!);
	assert.deepEqual(rows, [['kpis'], ['balance', 'donut'], ['savings', 'recent'], ['notes']]);
	const tree = treeFromRows(rows, (id) => widths[id]!, () => 1)!;
	assert.deepEqual(leafIds(tree), ['kpis', 'balance', 'donut', 'savings', 'recent', 'notes']);
	const tiles = assertTiled(tree, { x: 0, y: 0, w: 1212, h: 900 });
	const balance = tiles.get('balance')!;
	const donut = tiles.get('donut')!;
	assert.equal(balance.y, donut.y, 'same row');
	assert.ok(Math.abs(balance.w / (balance.w + donut.w) - 8 / 12) < 0.01, 'width shares kept');
	assert.equal(tiles.get('kpis')!.w, 1212);
	assert.equal(treeFromRows([], () => 1, () => 1), null);
});

test('migration: row heights follow the wanted heights, and the needed height adds them up', () => {
	const tree = treeFromRows([['a'], ['b']], () => 12, (row) => (row[0] === 'a' ? 100 : 300))!;
	const tiles = layoutTiles(tree, { x: 0, y: 0, w: 800, h: 412 }).tiles;
	assert.equal(tiles.get('a')!.h, 100);
	assert.equal(tiles.get('b')!.h, 300);
	assert.equal(neededHeight(tree, (id) => (id === 'a' ? 100 : 300)), 412);
	assert.equal(neededHeight(two, (id) => (id === 'a' ? 100 : 300)), 300);
	const heights: Record<string, number> = { r1: 255, r2: 480, r3: 130, r4: 504, r5: 90 };
	const deep = treeFromRows([['r1'], ['r2'], ['r3'], ['r4'], ['r5']], () => 12, (row) => heights[row[0]!]!)!;
	const total = neededHeight(deep, (id) => heights[id]!);
	const deepTiles = layoutTiles(deep, { x: 0, y: 0, w: 900, h: total }).tiles;
	for (const id of Object.keys(heights)) assert.ok(Math.abs(deepTiles.get(id)!.h - heights[id]!) <= 1, `${id} gets its exact height`);
});

test('cleanup: corrupted trees, ratios out of range and duplicates', () => {
	assert.equal(sanitizeTree(null), null);
	assert.equal(sanitizeTree({ dir: 'diagonal', a: { id: 'a' }, b: { id: 'b' } }), null);
	assert.deepEqual(sanitizeTree({ dir: 'row', ratio: 7, a: { id: 'a' }, b: { id: 'b' } }), { dir: 'row', ratio: 0.999, a: { id: 'a' }, b: { id: 'b' } });
	assert.deepEqual(sanitizeTree({ dir: 'col', ratio: 'x', a: { id: 'a' }, b: { id: 'b' } }), { dir: 'col', ratio: 0.5, a: { id: 'a' }, b: { id: 'b' } });
	assert.deepEqual(sanitizeTree({ dir: 'row', ratio: 0.4, a: { id: 'a' }, b: { dir: 'col', ratio: 0.5, a: { id: 'a' }, b: { id: 'c' } } }), { dir: 'row', ratio: 0.4, a: { id: 'a' }, b: { id: 'c' } }, 'duplicate dropped');
	assert.deepEqual(sanitizeTree({ dir: 'row', ratio: 0.5, a: 3, b: { id: 'b' } }), { id: 'b' });
	assert.equal(sanitizeTree({ id: '' }), null);
});

test('narrow screens: tree order is the reading order', () => {
	const tree: TileNode = { dir: 'col', ratio: 0.5, a: { dir: 'row', ratio: 0.5, a: { id: 'a' }, b: { id: 'b' } }, b: { id: 'c' } };
	assert.deepEqual(leafIds(tree), ['a', 'b', 'c']);
	assert.equal(orderNeighbour(tree, 'b', -1), 'a');
	assert.equal(orderNeighbour(tree, 'c', 1), null);
	assert.deepEqual(leafIds(equalize(tree)), ['a', 'b', 'c']);
	assert.equal((equalize({ ...tree, ratio: 0.9 }) as { ratio: number }).ratio, 0.5);
});

test('neighbours: the tile touching a side, none at the border', () => {
	const tree: TileNode = { dir: 'row', ratio: 0.5, a: { id: 'a' }, b: { dir: 'col', ratio: 0.5, a: { id: 'b' }, b: { id: 'c' } } };
	const { tiles } = layoutTiles(tree, CANVAS);
	assert.equal(neighbour(tiles, 'a', 'right'), 'b');
	assert.equal(neighbour(tiles, 'b', 'bottom'), 'c');
	assert.equal(neighbour(tiles, 'c', 'left'), 'a');
	assert.equal(neighbour(tiles, 'a', 'left'), null);
});

test('drop zones: border docks, center swaps, edges split, own tile ignored', () => {
	const tree: TileNode = { dir: 'row', ratio: 0.5, a: { id: 'a' }, b: { id: 'b' } };
	const { tiles } = layoutTiles(tree, CANVAS);
	const size = { w: CANVAS.w, h: CANVAS.h };
	assert.deepEqual(dropZone(tiles, size, 5, 300, 'a'), { kind: 'dock', side: 'left' });
	assert.deepEqual(dropZone(tiles, size, 700, 607, 'a'), { kind: 'dock', side: 'bottom' });
	const b = tiles.get('b')!;
	assert.deepEqual(dropZone(tiles, size, b.x + b.w / 2, b.y + b.h / 2, 'a'), { kind: 'tile', target: 'b', zone: 'center' });
	assert.deepEqual(dropZone(tiles, size, b.x + 30, b.y + b.h / 2, 'a'), { kind: 'tile', target: 'b', zone: 'left' });
	assert.deepEqual(dropZone(tiles, size, b.x + b.w / 2, b.y + 40, 'a'), { kind: 'tile', target: 'b', zone: 'top' });
	assert.equal(dropZone(tiles, size, 200, 300, 'a'), null);
	const preview = dropPreview({ kind: 'tile', target: 'b', zone: 'right' }, tiles, size)!;
	assert.equal(preview.x + preview.w, b.x + b.w);
	assert.ok(preview.w < b.w);
	assert.equal(dropPreview({ kind: 'dock', side: 'top' }, tiles, size)!.w, CANVAS.w);
});

test('four quarter-width blocks (the dashboard figures) share one row by default', () => {
	const widths: Record<string, number> = { a: LEGACY_WIDTHS.XS!, b: LEGACY_WIDTHS.XS!, c: LEGACY_WIDTHS.XS!, d: LEGACY_WIDTHS.XS!, e: LEGACY_WIDTHS.L! };
	assert.deepEqual(rowsFromOrder(['a', 'b', 'c', 'd', 'e'], (id) => widths[id]!), [['a', 'b', 'c', 'd'], ['e']]);
});

const W = 1012;
const rectsOf = (tree: TileNode, h: number) => layoutTiles(tree, { x: 0, y: 0, w: W, h }).tiles;

test('flow resize: shrinking the bottom tile from its bottom edge leaves the tile above untouched and shortens the page (user case on Budget)', () => {
	const tree: TileNode = { dir: 'col', ratio: 0.3, a: { id: 'objectifs' }, b: { id: 'vacances' } };
	const before = rectsOf(tree, 900);
	const holidayTile = before.get('vacances')!;
	const r = flowResize(tree, { w: W, h: 900 }, holidayTile.y + holidayTile.h, -150);
	assert.equal(r.delta, -150);
	assert.equal(r.height, 750);
	const after = rectsOf(r.tree, r.height);
	assert.deepEqual(after.get('objectifs'), before.get('objectifs'), 'the tile above keeps its exact place and size');
	assert.deepEqual(after.get('vacances'), { ...holidayTile, h: holidayTile.h - 150 });
});

test('flow resize: growing a tile pushes everything below down, unchanged in size', () => {
	const tree: TileNode = { dir: 'col', ratio: 0.25, a: { id: 'a' }, b: { dir: 'col', ratio: 0.5, a: { id: 'b' }, b: { id: 'c' } } };
	const before = rectsOf(tree, 1000);
	const a = before.get('a')!;
	const r = flowResize(tree, { w: W, h: 1000 }, a.y + a.h, 60);
	const after = rectsOf(r.tree, r.height);
	assert.equal(r.height, 1060);
	assert.deepEqual(after.get('a'), { ...a, h: a.h + 60 });
	for (const id of ['b', 'c']) assert.deepEqual(after.get(id), { ...before.get(id)!, y: before.get(id)!.y + 60 }, `${id} shifted, same size`);
});

test('flow resize: row neighbours ending on the same edge follow, a tile crossing the edge grows with it', () => {
	const rowTree: TileNode = { dir: 'col', ratio: 0.4, a: { dir: 'row', ratio: 0.5, a: { id: 'a' }, b: { id: 'b' } }, b: { id: 'c' } };
	const before = rectsOf(rowTree, 800);
	const a = before.get('a')!;
	const r = flowResize(rowTree, { w: W, h: 800 }, a.y + a.h, -40);
	const after = rectsOf(r.tree, r.height);
	assert.equal(after.get('a')!.h, a.h - 40);
	assert.equal(after.get('b')!.h, before.get('b')!.h - 40, 'row neighbour shrinks too');
	assert.deepEqual(after.get('c'), { ...before.get('c')!, y: before.get('c')!.y - 40 });

	const crossing: TileNode = { dir: 'row', ratio: 0.4, a: { id: 'tall' }, b: { dir: 'col', ratio: 0.5, a: { id: 'top' }, b: { id: 'bottom' } } };
	const b2 = rectsOf(crossing, 800);
	const top = b2.get('top')!;
	const r2 = flowResize(crossing, { w: W, h: 800 }, top.y + top.h, 30);
	const a2 = rectsOf(r2.tree, r2.height);
	assert.deepEqual(a2.get('top'), { ...top, h: top.h + 30 });
	assert.deepEqual(a2.get('bottom'), { ...b2.get('bottom')!, y: b2.get('bottom')!.y + 30 });
	assert.deepEqual(a2.get('tall'), { ...b2.get('tall')!, h: b2.get('tall')!.h + 30 }, 'the tile crossing the edge grows');
});

test('flow resize: never below the minimum height, and tiles above an edge just short of the line stay exact', () => {
	const tree: TileNode = { dir: 'col', ratio: 0.5, a: { id: 'a' }, b: { id: 'b' } };
	const before = rectsOf(tree, 600);
	const a = before.get('a')!;
	const r = flowResize(tree, { w: W, h: 600 }, a.y + a.h, -5000);
	assert.equal(rectsOf(r.tree, r.height).get('a')!.h, MIN_TILE.h);
	assert.equal(r.delta, MIN_TILE.h - a.h);

	const uneven: TileNode = { dir: 'row', ratio: 0.5, a: { dir: 'col', ratio: 0.5, a: { id: 'l1' }, b: { id: 'l2' } }, b: { dir: 'col', ratio: 0.49, a: { id: 'r1' }, b: { id: 'r2' } } };
	const u = rectsOf(uneven, 700);
	const l1 = u.get('l1')!;
	assert.ok(u.get('r1')!.y + u.get('r1')!.h < l1.y + l1.h, 'r1 ends just above l1');
	const ru = flowResize(uneven, { w: W, h: 700 }, l1.y + l1.h, 50);
	const after = rectsOf(ru.tree, ru.height);
	assert.deepEqual(after.get('r1'), u.get('r1'), 'r1 is above the line: untouched');
	assert.deepEqual(after.get('l1'), { ...l1, h: l1.h + 50 });
	assert.equal(after.get('r2')!.y + after.get('r2')!.h, ru.height, 'r2 still reaches the canvas bottom');
});

test('ratios rebuilt from the current rectangles give back the same layout', () => {
	const tree: TileNode = { dir: 'col', ratio: 0.33, a: { dir: 'row', ratio: 0.3, a: { id: 'a' }, b: { id: 'b' } }, b: { dir: 'row', ratio: 0.6, a: { id: 'c' }, b: { dir: 'col', ratio: 0.4, a: { id: 'd' }, b: { id: 'e' } } } };
	const tiles = rectsOf(tree, 900);
	assert.deepEqual(rectsOf(ratiosFrom(tree, tiles, { x: 0, y: 0, w: W, h: 900 }), 900), tiles);
});

test('fit to content: the row ending on a line takes the height of its tallest content', () => {
	const tree: TileNode = { dir: 'col', ratio: 0.6, a: { dir: 'row', ratio: 0.5, a: { id: 'a' }, b: { id: 'b' } }, b: { id: 'c' } };
	const tiles = rectsOf(tree, 1000);
	const a = tiles.get('a')!;
	const y0 = a.y + a.h;
	const d = fitDelta(tiles, y0, (id) => (id === 'a' ? 180 : id === 'b' ? 240 : 999));
	assert.equal(d, a.y + 240 - y0);
	assert.equal(fitDelta(tiles, y0, () => 10), a.y + MIN_TILE.h - y0, 'never below the minimum height');
	assert.equal(fitDelta(tiles, 3, () => 100), null, 'no tile ends on that line');
});

test('replace a leaf by a row of tiles at its place, equal widths; removed when nothing replaces it', () => {
	const tree: TileNode = { dir: 'col', ratio: 0.2, a: { id: 'kpis' }, b: { id: 'balance' } };
	const next = replaceLeaf(tree, 'kpis', ['k1', 'k2', 'k3', 'k4'])!;
	assert.deepEqual(leafIds(next), ['k1', 'k2', 'k3', 'k4', 'balance']);
	const tiles = rectsOf(next, 800);
	const widths = ['k1', 'k2', 'k3', 'k4'].map((id) => tiles.get(id)!.w);
	assert.ok(Math.max(...widths) - Math.min(...widths) <= 2, 'equal shares, gaps counted');
	assert.ok(['k1', 'k2', 'k3', 'k4'].every((id) => tiles.get(id)!.y === 0), 'at the former place (top)');
	assert.deepEqual(replaceLeaf(tree, 'kpis', []), { id: 'balance' });
	assert.deepEqual(leafIds(replaceLeaf(tree, 'kpis', ['balance', 'k1'])), ['k1', 'balance'], 'an id already placed is not duplicated');
});

test('storing a tile in document flow: a full-width tile closes its gap, the others keep their pixels', () => {
	const stack: TileNode = { dir: 'col', ratio: 0.2, a: { id: 'resume' }, b: { dir: 'col', ratio: 0.3, a: { id: 'objectifs' }, b: { dir: 'col', ratio: 0.4, a: { id: 'vacances' }, b: { id: 'categories' } } } };
	const before = rectsOf(stack, 1200);
	const last = removeFlow(stack, { w: W, h: 1200 }, 'categories');
	const cat = before.get('categories')!;
	assert.equal(last.height, 1200 - cat.h - TILE_GAP);
	const afterLast = rectsOf(last.tree!, last.height);
	for (const id of ['resume', 'objectifs', 'vacances']) assert.deepEqual(afterLast.get(id), before.get(id), `${id} untouched`);

	const middle = removeFlow(stack, { w: W, h: 1200 }, 'objectifs');
	const obj = before.get('objectifs')!;
	const afterMiddle = rectsOf(middle.tree!, middle.height);
	assert.deepEqual(afterMiddle.get('resume'), before.get('resume'));
	for (const id of ['vacances', 'categories']) assert.deepEqual(afterMiddle.get(id), { ...before.get(id)!, y: before.get(id)!.y - obj.h - TILE_GAP }, `${id} moved up, same size`);

	const side: TileNode = { dir: 'col', ratio: 0.5, a: { dir: 'row', ratio: 0.5, a: { id: 'a' }, b: { id: 'b' } }, b: { id: 'c' } };
	const s0 = rectsOf(side, 800);
	const r = removeFlow(side, { w: W, h: 800 }, 'a');
	const s1 = rectsOf(r.tree!, r.height);
	assert.equal(r.height, 800, 'a half-width tile leaves no vertical gap to close');
	assert.equal(s1.get('b')!.w, W, 'its neighbour takes the width');
	assert.equal(s1.get('b')!.h, s0.get('b')!.h);
	assert.deepEqual(s1.get('c'), s0.get('c'));
});
