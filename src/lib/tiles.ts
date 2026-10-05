/**
 * Hyprland-like dwindle tiling of page blocks (pure module, testable with tsx).
 *
 * Each page keeps a binary tree: a leaf is a block, a split divides its rectangle in two, side by
 * side (`row`, `a` on the left) or stacked (`col`, `a` on top), along a continuous `ratio` (share of
 * `a`). The tiles always fill the canvas: no hole, no overlap, a constant gap between them.
 *
 * Covered here: pixel layout with minimum tile sizes, moves (next to a tile, swap, docked on a canvas
 * side), removal and dwindle insertion (the largest tile is split along its longest side), pixel
 * resizing of splits, the default tree built from the former order + widths model, cleanup of stored
 * values and the drop zones of a dragged tile.
 *
 * Widths are tiled like Hyprland (the page width is fixed, neighbours share it), heights follow the
 * document flow: resizing a tile vertically changes the canvas height, moves what is below and never
 * squeezes what is above (flowResize).
 */

export type TileDir = 'row' | 'col';

export interface TileLeaf {
	id: string;
}

export interface TileSplit {
	dir: TileDir;
	ratio: number;
	a: TileNode;
	b: TileNode;
}

export type TileNode = TileLeaf | TileSplit;

export type Side = 'left' | 'right' | 'top' | 'bottom';

export interface Rect {
	x: number;
	y: number;
	w: number;
	h: number;
}

/** Separator between the two halves of a split, with what a pixel drag needs. */
export interface Gutter {
	/** Path of the split from the root ('' = root, then 'a' / 'b' steps). */
	path: string;
	dir: TileDir;
	rect: Rect;
	/** Length shared by both halves along the split axis (gap excluded). */
	avail: number;
	/** Current size of the first half along the split axis. */
	size: number;
	/** Minimum sizes of both halves along the split axis. */
	minA: number;
	minB: number;
}

export interface TileLayout {
	tiles: Map<string, Rect>;
	gutters: Gutter[];
}

/** Gap between tiles, like Hyprland's gaps_in. */
export const TILE_GAP = 12;

/** Smallest tile a block can be squeezed to. */
export const MIN_TILE = { w: 140, h: 90 } as const;

/**
 * Ratios stay inside this range so a split never collapses one of its halves to nothing (minimum tile
 * sizes do the real work; the range is wide so tall canvases keep exact pixel heights).
 */
const RATIO_MIN = 0.001;
const RATIO_MAX = 0.999;

export function isLeaf(node: TileNode): node is TileLeaf {
	return 'id' in node;
}

/** Leaf ids in tree order (first half before second half): the reading order on narrow screens. */
export function leafIds(node: TileNode | null | undefined): string[] {
	if (!node) return [];
	return isLeaf(node) ? [node.id] : [...leafIds(node.a), ...leafIds(node.b)];
}

export function hasLeaf(node: TileNode | null | undefined, id: string): boolean {
	return leafIds(node).includes(id);
}

const clampRatio = (r: number): number => Math.min(RATIO_MAX, Math.max(RATIO_MIN, r));

/** Smallest size a subtree can take: halves side by side add up, stacked halves take the larger one. */
export function minSize(node: TileNode, min: { w: number; h: number } = MIN_TILE, gap = TILE_GAP): { w: number; h: number } {
	if (isLeaf(node)) return { w: min.w, h: min.h };
	const a = minSize(node.a, min, gap);
	const b = minSize(node.b, min, gap);
	return node.dir === 'row' ? { w: a.w + gap + b.w, h: Math.max(a.h, b.h) } : { w: Math.max(a.w, b.w), h: a.h + gap + b.h };
}

/**
 * Size of the first half of a split: the ratio applied to the available length, kept within the
 * minimum sizes of both halves when they fit (shared in proportion to them otherwise).
 */
function firstHalf(split: TileSplit, avail: number, min: { w: number; h: number }, gap: number): { size: number; minA: number; minB: number } {
	const axis = split.dir === 'row' ? 'w' : 'h';
	const minA = minSize(split.a, min, gap)[axis];
	const minB = minSize(split.b, min, gap)[axis];
	const wanted = Math.round(avail * split.ratio);
	if (minA + minB > avail) return { size: Math.round((avail * minA) / (minA + minB)), minA, minB };
	return { size: Math.min(avail - minB, Math.max(minA, wanted)), minA, minB };
}

/** Pixel rectangles of every tile and the gutters between split halves, for a canvas rectangle. */
export function layoutTiles(node: TileNode | null | undefined, rect: Rect, gap = TILE_GAP, min: { w: number; h: number } = MIN_TILE): TileLayout {
	const tiles = new Map<string, Rect>();
	const gutters: Gutter[] = [];
	const walk = (n: TileNode, r: Rect, path: string): void => {
		if (isLeaf(n)) {
			tiles.set(n.id, r);
			return;
		}
		const row = n.dir === 'row';
		const avail = Math.max(0, (row ? r.w : r.h) - gap);
		const { size, minA, minB } = firstHalf(n, avail, min, gap);
		const rest = avail - size;
		const ra: Rect = row ? { x: r.x, y: r.y, w: size, h: r.h } : { x: r.x, y: r.y, w: r.w, h: size };
		const rb: Rect = row ? { x: r.x + size + gap, y: r.y, w: rest, h: r.h } : { x: r.x, y: r.y + size + gap, w: r.w, h: rest };
		gutters.push({ path, dir: n.dir, rect: row ? { x: r.x + size, y: r.y, w: gap, h: r.h } : { x: r.x, y: r.y + size, w: r.w, h: gap }, avail, size, minA, minB });
		walk(n.a, ra, `${path}a`);
		walk(n.b, rb, `${path}b`);
	};
	if (node) walk(node, rect, '');
	return { tiles, gutters };
}

/** Node found at a path, or null. */
export function nodeAt(node: TileNode | null | undefined, path: string): TileNode | null {
	let current: TileNode | null = node ?? null;
	for (const step of path) {
		if (!current || isLeaf(current)) return null;
		current = step === 'a' ? current.a : current.b;
	}
	return current;
}

/** Copy of the tree with the node at `path` replaced. */
function replaceAt(node: TileNode, path: string, replacement: TileNode): TileNode {
	if (path === '') return replacement;
	if (isLeaf(node)) return node;
	return path[0] === 'a' ? { ...node, a: replaceAt(node.a, path.slice(1), replacement) } : { ...node, b: replaceAt(node.b, path.slice(1), replacement) };
}

/** Copy of the tree with the ratio of the split at `path` changed (clamped). */
export function setRatio(node: TileNode, path: string, ratio: number): TileNode {
	const split = nodeAt(node, path);
	if (!split || isLeaf(split)) return node;
	return replaceAt(node, path, { ...split, ratio: clampRatio(ratio) });
}

/** Ratio that gives the first half of a split `size` pixels, within the minimum sizes of both halves. */
export function ratioForSize(gutter: Pick<Gutter, 'avail' | 'minA' | 'minB'>, size: number): number {
	if (gutter.avail <= 0) return 0.5;
	const lo = Math.min(gutter.minA, gutter.avail);
	const hi = Math.max(lo, gutter.avail - gutter.minB);
	return clampRatio(Math.min(hi, Math.max(lo, size)) / gutter.avail);
}

/** Tree without a leaf: its parent split gives the whole place to the sibling. Null when it was the last tile. */
export function removeLeaf(node: TileNode | null | undefined, id: string): TileNode | null {
	if (!node) return null;
	if (isLeaf(node)) return node.id === id ? null : node;
	const a = removeLeaf(node.a, id);
	const b = removeLeaf(node.b, id);
	if (!a) return b;
	if (!b) return a;
	return a === node.a && b === node.b ? node : { ...node, a, b };
}

/** Tree keeping only the leaves `keep` accepts (the others leave their place to their siblings). */
export function pruneTree(node: TileNode | null | undefined, keep: (id: string) => boolean): TileNode | null {
	if (!node) return null;
	if (isLeaf(node)) return keep(node.id) ? node : null;
	const a = pruneTree(node.a, keep);
	const b = pruneTree(node.b, keep);
	if (!a) return b;
	if (!b) return a;
	return a === node.a && b === node.b ? node : { ...node, a, b };
}

/** New split that puts `id` on one side of `target` (`share` = part of the new tile). */
function besides(target: TileNode, id: string, side: Side, share: number): TileSplit {
	const leaf: TileLeaf = { id };
	const dir: TileDir = side === 'left' || side === 'right' ? 'row' : 'col';
	const first = side === 'left' || side === 'top';
	return { dir, ratio: clampRatio(first ? share : 1 - share), a: first ? leaf : target, b: first ? target : leaf };
}

/** The leaf `target` split in two to make room for `id` on the given side. Unchanged when `target` is missing. */
export function insertBeside(node: TileNode | null | undefined, target: string, id: string, side: Side, share = 0.5): TileNode {
	if (!node) return { id };
	if (isLeaf(node)) return node.id === target ? besides(node, id, side, share) : node;
	const a = insertBeside(node.a, target, id, side, share);
	const b = a === node.a ? insertBeside(node.b, target, id, side, share) : node.b;
	return a === node.a && b === node.b ? node : { ...node, a, b };
}

/** The whole tree pushed aside to dock `id` along a canvas side, taking `share` of the width or height. */
export function dock(node: TileNode | null | undefined, id: string, side: Side, share = 1 / 3): TileNode {
	return node ? besides(node, id, side, share) : { id };
}

/** Two leaves exchanged (each takes the other's place). */
export function swapLeaves(node: TileNode, a: string, b: string): TileNode {
	if (isLeaf(node)) return node.id === a ? { id: b } : node.id === b ? { id: a } : node;
	return { ...node, a: swapLeaves(node.a, a, b), b: swapLeaves(node.b, a, b) };
}

/** A tile moved next to another (taken out first, its sibling closing the gap), or swapped with it ('center'). */
export function moveTile(node: TileNode, id: string, target: string, zone: Side | 'center'): TileNode {
	if (id === target || !hasLeaf(node, id) || !hasLeaf(node, target)) return node;
	if (zone === 'center') return swapLeaves(node, id, target);
	return insertBeside(removeLeaf(node, id), target, id, zone);
}

/** A tile taken out of its place and docked along a whole side of the canvas. */
export function dockTile(node: TileNode, id: string, side: Side, share = 1 / 3): TileNode {
	return dock(removeLeaf(node, id), id, side, share);
}

/**
 * Dwindle insertion: the largest tile of a canvas of `size` is split along its longest side and the
 * new tile takes the second half (right, or bottom).
 */
export function dwindleInsert(node: TileNode | null | undefined, id: string, size: { w: number; h: number }, gap = TILE_GAP, min: { w: number; h: number } = MIN_TILE): TileNode {
	if (!node) return { id };
	const { tiles } = layoutTiles(node, { x: 0, y: 0, w: size.w, h: size.h }, gap, min);
	let target: string | null = null;
	let best = -1;
	for (const leaf of leafIds(node)) {
		const r = tiles.get(leaf);
		const area = r ? r.w * r.h : 0;
		if (area > best) {
			best = area;
			target = leaf;
		}
	}
	if (target === null) return node;
	const r = tiles.get(target);
	return insertBeside(node, target, id, r && r.h > r.w ? 'bottom' : 'right');
}

/** Columns side by side in a node: a leaf or a stacked (col) split counts as one, row splits add up. */
function columnCount(node: TileNode): number {
	return isLeaf(node) || node.dir === 'col' ? 1 : columnCount(node.a) + columnCount(node.b);
}

/**
 * Same width for the tiles of a same row: each row split gets the share of columns on its first
 * side (three tiles side by side → 1/3 then 1/2). Stacked (col) splits keep their ratio, so heights
 * never change; before, every split went back to one half and the key-figure row took half the page.
 */
export function equalize(node: TileNode): TileNode {
	if (isLeaf(node)) return node;
	const a = equalize(node.a);
	const b = equalize(node.b);
	if (node.dir === 'col') return { ...node, a, b };
	const na = columnCount(node.a);
	return { ...node, ratio: na / (na + columnCount(node.b)), a, b };
}

/**
 * Split behind each edge of a tile: the deepest ancestor whose separator is that edge (a side is
 * missing when the tile touches the canvas border there).
 */
export function edgeSplits(node: TileNode | null | undefined, id: string): Partial<Record<Side, string>> {
	const out: Partial<Record<Side, string>> = {};
	let current: TileNode | null | undefined = node;
	let path = '';
	while (current && !isLeaf(current)) {
		const inA = hasLeaf(current.a, id);
		if (!inA && !hasLeaf(current.b, id)) return {};
		if (current.dir === 'row') out[inA ? 'right' : 'left'] = path;
		else out[inA ? 'bottom' : 'top'] = path;
		path += inA ? 'a' : 'b';
		current = inA ? current.a : current.b;
	}
	return current && isLeaf(current) && current.id === id ? out : {};
}

/** Lines closer than this (px) count as the same edge. */
const EDGE_TOLERANCE = 1;

/** Bounding box of a subtree's tiles (null when none of them is in `rects`). */
function extent(node: TileNode, rects: ReadonlyMap<string, Rect>): Rect | null {
	let box: Rect | null = null;
	for (const id of leafIds(node)) {
		const r = rects.get(id);
		if (!r) continue;
		if (!box) {
			box = { ...r };
			continue;
		}
		const right = Math.max(box.x + box.w, r.x + r.w);
		const bottom = Math.max(box.y + box.h, r.y + r.h);
		box.x = Math.min(box.x, r.x);
		box.y = Math.min(box.y, r.y);
		box.w = right - box.x;
		box.h = bottom - box.y;
	}
	return box;
}

/**
 * Tree whose ratios reproduce wanted tile rectangles in `region` (the canvas): top-down, the first
 * half of each split keeps the size its tiles reach (from the region's start to their far edge) and
 * the second half takes the rest, so any slack goes to the tiles below or on the right.
 */
export function ratiosFrom(node: TileNode, rects: ReadonlyMap<string, Rect>, region: Rect, gap = TILE_GAP): TileNode {
	if (isLeaf(node)) return node;
	const row = node.dir === 'row';
	const avail = Math.max(0, (row ? region.w : region.h) - gap);
	const a = extent(node.a, rects);
	const reach = a ? (row ? a.x + a.w - region.x : a.y + a.h - region.y) : avail * node.ratio;
	const size = Math.min(avail, Math.max(0, reach));
	const ratio = avail > 0 ? clampRatio(size / avail) : node.ratio;
	const ra: Rect = row ? { x: region.x, y: region.y, w: size, h: region.h } : { x: region.x, y: region.y, w: region.w, h: size };
	const rb: Rect = row ? { x: region.x + size + gap, y: region.y, w: avail - size, h: region.h } : { x: region.x, y: region.y + size + gap, w: region.w, h: avail - size };
	return { ...node, ratio, a: ratiosFrom(node.a, rects, ra, gap), b: ratiosFrom(node.b, rects, rb, gap) };
}

/** Result of a vertical resize in document flow. */
export interface FlowResize {
	tree: TileNode;
	/** New canvas height. */
	height: number;
	/** Offset applied (the asked one, clamped to the minimum sizes). */
	delta: number;
}

/**
 * Vertical resize in document flow: the horizontal line `y0` (a tile's bottom edge, or the canvas
 * bottom) moves by `delta` px and the canvas height follows. Tiles ending on that line or crossing it
 * grow by `delta`, tiles below it shift by `delta`, the others keep their exact place. The offset is
 * clamped so no growing tile gets below `min.h` and the canvas below `minCanvas`.
 */
export function flowResize(node: TileNode, canvas: { w: number; h: number }, y0: number, delta: number, gap = TILE_GAP, min: { w: number; h: number } = MIN_TILE, minCanvas = 0): FlowResize {
	const { tiles } = layoutTiles(node, { x: 0, y: 0, w: canvas.w, h: canvas.h }, gap, min);
	const ends = (r: Rect) => Math.abs(r.y + r.h - y0) <= EDGE_TOLERANCE;
	const crosses = (r: Rect) => r.y < y0 - EDGE_TOLERANCE && r.y + r.h > y0 + EDGE_TOLERANCE;
	let d = Math.round(delta);
	for (const r of tiles.values()) if (ends(r) || crosses(r)) d = Math.max(d, Math.min(0, min.h - r.h));
	d = Math.max(d, Math.min(0, minCanvas - canvas.h));
	const wanted = new Map<string, Rect>();
	for (const [id, r] of tiles) {
		if (ends(r) || crosses(r)) wanted.set(id, { ...r, h: r.h + d });
		else if (r.y >= y0) wanted.set(id, { ...r, y: r.y + d });
		else wanted.set(id, r);
	}
	const height = canvas.h + d;
	return { tree: ratiosFrom(node, wanted, { x: 0, y: 0, w: canvas.w, h: height }, gap), height, delta: d };
}

/**
 * A tile taken out in document flow: a tile spanning the whole canvas width leaves no hole, what was
 * below moves up and the canvas loses its height plus a gap; any other tile gives its place to its
 * sibling (widths are tiled). Every other tile keeps its pixel size either way.
 */
export function removeFlow(node: TileNode, canvas: { w: number; h: number }, id: string, gap = TILE_GAP, min: { w: number; h: number } = MIN_TILE): { tree: TileNode | null; height: number } {
	const { tiles } = layoutTiles(node, { x: 0, y: 0, w: canvas.w, h: canvas.h }, gap, min);
	const r = tiles.get(id);
	const tree = removeLeaf(node, id);
	if (!r || !tree) return { tree, height: canvas.h };
	const fullWidth = r.x <= EDGE_TOLERANCE && r.x + r.w >= canvas.w - EDGE_TOLERANCE;
	const cut = fullWidth ? r.h + gap : 0;
	const wanted = new Map<string, Rect>();
	for (const [other, o] of tiles) if (other !== id) wanted.set(other, cut && o.y > r.y ? { ...o, y: o.y - cut } : o);
	const height = Math.max(minSize(tree, min, gap).h, canvas.h - cut);
	return { tree: ratiosFrom(tree, wanted, { x: 0, y: 0, w: canvas.w, h: height }, gap), height };
}

/**
 * Offset that fits the row ending on the line `y0` to its content: the tiles ending there get the
 * height their content needs (the tallest one wins). Null when no tile ends on that line.
 */
export function fitDelta(tiles: ReadonlyMap<string, Rect>, y0: number, heightOf: (id: string) => number | null, min: { w: number; h: number } = MIN_TILE): number | null {
	let bottom: number | null = null;
	for (const [id, r] of tiles) {
		if (Math.abs(r.y + r.h - y0) > EDGE_TOLERANCE) continue;
		const needed = heightOf(id);
		if (needed === null) continue;
		const end = r.y + Math.max(min.h, Math.ceil(needed));
		bottom = bottom === null ? end : Math.max(bottom, end);
	}
	return bottom === null ? null : bottom - y0;
}

/** Nominal tile length used to share a length equally once the gaps are counted (exact around it). */
const NOMINAL_SHARE = 300;

/**
 * A leaf replaced at its place by tiles sharing its width equally (row) or its height (col), gaps
 * counted; ids already in the tree are skipped, and the leaf is removed when none is left.
 */
export function replaceLeaf(node: TileNode | null | undefined, id: string, ids: readonly string[], dir: TileDir = 'row', gap = TILE_GAP): TileNode | null {
	if (!node) return null;
	const fresh = ids.filter((x, i) => x !== id && ids.indexOf(x) === i && !hasLeaf(node, x));
	const group = stack(
		fresh.map((x) => ({ id: x })),
		fresh.map(() => NOMINAL_SHARE),
		dir,
		gap
	);
	if (!group) return removeLeaf(node, id);
	const walk = (n: TileNode): TileNode => (isLeaf(n) ? (n.id === id ? group : n) : { ...n, a: walk(n.a), b: walk(n.b) });
	return walk(node);
}

/** Column share (out of 12) of the default sizes XS / S / M / L / XL. */
export const LEGACY_WIDTHS: Record<string, number> = { XS: 3, S: 4, M: 6, L: 8, XL: 12 };

/** Ids grouped in rows the way the former 12-column grid laid them out (left to right, then wrap). */
export function rowsFromOrder(ids: readonly string[], widthOf: (id: string) => number, cols = 12): string[][] {
	const rows: string[][] = [];
	let used = cols;
	for (const id of ids) {
		const w = Math.min(cols, Math.max(1, widthOf(id)));
		if (used + w > cols) {
			rows.push([]);
			used = 0;
		}
		rows[rows.length - 1]!.push(id);
		used += w;
	}
	return rows;
}

/** Chain of splits sharing a length between parts in proportion to their weights. */
function chain(parts: readonly TileNode[], weights: readonly number[], dir: TileDir): TileNode | null {
	if (parts.length === 0) return null;
	if (parts.length === 1) return parts[0]!;
	const total = weights.reduce((s, w) => s + Math.max(0.0001, w), 0);
	const rest = chain(parts.slice(1), weights.slice(1), dir)!;
	return { dir, ratio: clampRatio(Math.max(0.0001, weights[0]!) / total), a: parts[0]!, b: rest };
}

/**
 * Stack of parts with exact pixel lengths: each split gives its first part exactly its length when
 * the whole stack measures the sum of the lengths plus the gaps between them (and scales them
 * evenly when it is taller).
 */
function stack(parts: readonly TileNode[], lengths: readonly number[], dir: TileDir, gap: number): TileNode | null {
	if (parts.length === 0) return null;
	if (parts.length === 1) return parts[0]!;
	const first = Math.max(1, lengths[0]!);
	const rest = lengths.slice(1).reduce((sum, l) => sum + Math.max(1, l), 0) + (lengths.length - 2) * gap;
	return { dir, ratio: clampRatio(first / (first + rest)), a: parts[0]!, b: stack(parts.slice(1), lengths.slice(1), dir, gap)! };
}

/**
 * Default tree from the former model: rows stacked from top to bottom, each row split side by side
 * by the former widths; each row gets the height `rowHeight` gives (its tallest block, for instance)
 * when the canvas is as tall as the rows plus the gaps.
 */
export function treeFromRows(rows: readonly string[][], widthOf: (id: string) => number, rowHeight: (row: readonly string[]) => number, gap = TILE_GAP): TileNode | null {
	const filled = rows.filter((r) => r.length > 0);
	const rowNodes = filled.map((r) => chain(r.map((id) => ({ id })), r.map(widthOf), 'row')!);
	return stack(rowNodes, filled.map(rowHeight), 'col', gap);
}

/**
 * Height a tree needs for its tiles to reach their wanted heights: stacked halves add up (plus the
 * gap), halves side by side take the larger one.
 */
export function neededHeight(node: TileNode | null | undefined, heightOf: (id: string) => number, gap = TILE_GAP): number {
	if (!node) return 0;
	if (isLeaf(node)) return heightOf(node.id);
	const a = neededHeight(node.a, heightOf, gap);
	const b = neededHeight(node.b, heightOf, gap);
	return node.dir === 'col' ? a + gap + b : Math.max(a, b);
}

/** Outer height assumed for a block that has not been measured yet. */
export const LEAF_ESTIMATE = 240;

/**
 * Canvas height giving every tile its natural height (measured, else LEAF_ESTIMATE, never below the
 * minimum tile height), and never less than the tree needs. Used for a tree saved without a height.
 */
export function naturalCanvasHeight(node: TileNode | null | undefined, naturalOf: (id: string) => number | undefined, gap = TILE_GAP, min: { w: number; h: number } = MIN_TILE): number {
	if (!node) return 0;
	return Math.max(minSize(node, min, gap).h, neededHeight(node, (id) => Math.max(min.h, naturalOf(id) ?? LEAF_ESTIMATE), gap));
}

/**
 * Tree read back from storage: unknown shapes dropped, ratios clamped, each id kept once (a later
 * duplicate leaves its place to its sibling). Null when nothing valid is left.
 */
export function sanitizeTree(raw: unknown, seen: Set<string> = new Set()): TileNode | null {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
	const r = raw as Record<string, unknown>;
	if (typeof r.id === 'string') {
		if (!r.id || seen.has(r.id)) return null;
		seen.add(r.id);
		return { id: r.id };
	}
	if (r.dir !== 'row' && r.dir !== 'col') return null;
	const a = sanitizeTree(r.a, seen);
	const b = sanitizeTree(r.b, seen);
	if (!a) return b;
	if (!b) return a;
	const ratio = typeof r.ratio === 'number' && Number.isFinite(r.ratio) ? clampRatio(r.ratio) : 0.5;
	return { dir: r.dir, ratio, a, b };
}

/**
 * Tile next to `id` in a direction: among the tiles beyond that side whose span overlaps it, the
 * closest one (largest overlap breaks ties). Null at the canvas border.
 */
export function neighbour(tiles: ReadonlyMap<string, Rect>, id: string, side: Side): string | null {
	const r = tiles.get(id);
	if (!r) return null;
	let best: { id: string; distance: number; overlap: number } | null = null;
	for (const [other, o] of tiles) {
		if (other === id) continue;
		const horizontal = side === 'left' || side === 'right';
		const overlap = horizontal ? Math.min(r.y + r.h, o.y + o.h) - Math.max(r.y, o.y) : Math.min(r.x + r.w, o.x + o.w) - Math.max(r.x, o.x);
		if (overlap <= 0) continue;
		const distance = side === 'left' ? r.x - (o.x + o.w) : side === 'right' ? o.x - (r.x + r.w) : side === 'top' ? r.y - (o.y + o.h) : o.y - (r.y + r.h);
		if (distance < -1) continue;
		if (!best || distance < best.distance - 0.5 || (Math.abs(distance - best.distance) <= 0.5 && overlap > best.overlap)) best = { id: other, distance, overlap };
	}
	return best?.id ?? null;
}

/** Where a dragged tile would land. */
export type DropZone = { kind: 'dock'; side: Side } | { kind: 'tile'; target: string; zone: Side | 'center' };

/**
 * Drop zone under the pointer (canvas coordinates): within `edge` pixels of the canvas border, the
 * tile docks on that whole side; over another tile, its central box swaps both tiles and anywhere
 * else the nearest edge gives the half it will take. Null over the dragged tile itself.
 */
export function dropZone(tiles: ReadonlyMap<string, Rect>, canvas: { w: number; h: number }, x: number, y: number, dragged: string, edge = 20): DropZone | null {
	const borders: [Side, number][] = [
		['left', x],
		['right', canvas.w - x],
		['top', y],
		['bottom', canvas.h - y]
	];
	const [nearSide, nearDistance] = borders.reduce((m, b) => (b[1] < m[1] ? b : m));
	if (nearDistance <= edge) return { kind: 'dock', side: nearSide };
	let target: string | null = null;
	let rect: Rect | null = null;
	let closest = Infinity;
	for (const [id, r] of tiles) {
		const dx = x < r.x ? r.x - x : x > r.x + r.w ? x - r.x - r.w : 0;
		const dy = y < r.y ? r.y - y : y > r.y + r.h ? y - r.y - r.h : 0;
		const distance = Math.hypot(dx, dy);
		if (distance < closest) {
			closest = distance;
			target = id;
			rect = r;
		}
	}
	if (!target || !rect || target === dragged) return null;
	const px = rect.w > 0 ? (x - rect.x) / rect.w : 0.5;
	const py = rect.h > 0 ? (y - rect.y) / rect.h : 0.5;
	if (px > 0.3 && px < 0.7 && py > 0.3 && py < 0.7) return { kind: 'tile', target, zone: 'center' };
	const edges: [Side, number][] = [
		['left', px],
		['right', 1 - px],
		['top', py],
		['bottom', 1 - py]
	];
	return { kind: 'tile', target, zone: edges.reduce((m, e) => (e[1] < m[1] ? e : m))[0] };
}

/** Rectangle a drop would fill, for the preview drawn under the pointer. */
export function dropPreview(zone: DropZone, tiles: ReadonlyMap<string, Rect>, canvas: { w: number; h: number }, gap = TILE_GAP, share = 1 / 3): Rect | null {
	if (zone.kind === 'dock') {
		const w = Math.round((canvas.w - gap) * share);
		const h = Math.round((canvas.h - gap) * share);
		if (zone.side === 'left') return { x: 0, y: 0, w, h: canvas.h };
		if (zone.side === 'right') return { x: canvas.w - w, y: 0, w, h: canvas.h };
		if (zone.side === 'top') return { x: 0, y: 0, w: canvas.w, h };
		return { x: 0, y: canvas.h - h, w: canvas.w, h };
	}
	const r = tiles.get(zone.target);
	if (!r) return null;
	const halfW = Math.round((r.w - gap) / 2);
	const halfH = Math.round((r.h - gap) / 2);
	if (zone.zone === 'center') return r;
	if (zone.zone === 'left') return { x: r.x, y: r.y, w: halfW, h: r.h };
	if (zone.zone === 'right') return { x: r.x + r.w - halfW, y: r.y, w: halfW, h: r.h };
	if (zone.zone === 'top') return { x: r.x, y: r.y, w: r.w, h: halfH };
	return { x: r.x, y: r.y + r.h - halfH, w: r.w, h: halfH };
}

/** The tile placed right before (−1) or after (+1) in reading order: what « Monter » / « Descendre » swap with. */
export function orderNeighbour(node: TileNode | null | undefined, id: string, step: -1 | 1): string | null {
	const ids = leafIds(node);
	const i = ids.indexOf(id);
	return i < 0 ? null : (ids[i + step] ?? null);
}
