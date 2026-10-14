import { dwindleInsert, hasLeaf, leafIds, removeLeaf, replaceLeaf, sanitizeTree, type TileNode } from './tiles';

/**
 * Block layout rules, pure and testable: optional elements, the former order and widths (read once to
 * build the tile trees, see tiles.ts), per-page tiles and the cleanup of the persisted
 * `budget:layout` value. The reactive state lives in layout.svelte.ts.
 */

export type Density = 'compact' | 'normal' | 'confort';

/** Block width on the 12-column grid (large screens): S = 4, M = 6, L = 8, XL = 12 columns. */
export type BlockSize = 'XS' | 'S' | 'M' | 'L' | 'XL';

export const BLOCK_SIZES: readonly BlockSize[] = ['XS', 'S', 'M', 'L', 'XL'];

/** Labels of the sizes in the UI (tooltips). */
export const SIZE_LABELS: Record<BlockSize, string> = { XS: 'Très petit (1/4)', S: 'Petit (1/3)', M: 'Moyen (1/2)', L: 'Grand (2/3)', XL: 'Pleine largeur' };

/** Tells the block content whether an optional element is shown. */
export type BlockShow = (elementId: string) => boolean;

/** Optional part of a block that the user can show or hide. */
export interface BlockElement {
	id: string;
	label: string;
	/** Shown when the user has not chosen (default true). */
	default?: boolean;
}

/**
 * User choices for one block, stored under `page:id`: the optional elements. `size`, `hidden` and
 * `collapsed` come from the former layout model and are only read to build a page's first tiles
 * (width share, then hidden or collapsed blocks become stored ones).
 */
export interface BlockPrefs {
	size?: BlockSize;
	hidden?: boolean;
	collapsed?: boolean;
	elements?: Record<string, boolean>;
}

/** Tiles of one page once the user has changed them: tree, stored blocks and canvas height in px. */
export interface PageTiles {
	tree?: TileNode;
	stored?: string[];
	height?: number;
}

/**
 * Tiles completed with a canvas height whenever they hold a tree: a tree saved without one would be
 * drawn with a guessed height per row and squeeze its tiles. `fallback` gives the height to use.
 */
export function withCanvasHeight(tiles: PageTiles, fallback: (tree: TileNode) => number): PageTiles {
	if (!tiles.tree || (tiles.height ?? 0) > 0) return tiles;
	return { ...tiles, height: Math.round(fallback(tiles.tree)) };
}

/**
 * Tiles once a block is stored. A page still on its default layout (no saved tree) stays derived:
 * the block only joins the stored list and the other blocks take their default places with their
 * natural heights. A customised page loses the leaf: `place` is the canvas's own document-flow
 * removal (tree and height); otherwise the leaf leaves `base` (the tree on screen) or the saved tree.
 */
export function tilesWithStored(tiles: PageTiles, stored: readonly string[], id: string, base?: TileNode | null, place?: { tree: TileNode | null; height: number }): PageTiles {
	const next: PageTiles = { ...tiles, stored: [...new Set([...stored, id])] };
	if (!tiles.tree) return next;
	const pruned = place ? place.tree : removeLeaf(base === undefined ? tiles.tree : base, id);
	if (pruned) next.tree = pruned;
	else delete next.tree;
	if (place) next.height = Math.round(place.height);
	return next;
}

/**
 * Tiles once a stored block comes back. A page on its default layout stays derived (the block takes
 * its default place again, natural heights); a customised page splits the largest tile on screen for
 * it (dwindle) when the canvas size is known, else the canvas inserts it the same way when drawing.
 */
export function tilesWithBroughtBack(tiles: PageTiles, stored: readonly string[], id: string, screen?: { tree: TileNode | null | undefined; size: { w: number; h: number } }): PageTiles {
	const next: PageTiles = { ...tiles, stored: stored.filter((x) => x !== id) };
	if (tiles.tree && screen && screen.size.w > 0 && screen.size.h > 0) next.tree = dwindleInsert(removeLeaf(screen.tree, id), id, screen.size);
	return next;
}

/** Persisted value of `budget:layout`. */
export interface PersistedLayout {
	wide: boolean;
	order: Record<string, string[]>;
	density: Density;
	blocks: Record<string, BlockPrefs>;
	tiles: Record<string, PageTiles>;
	/** The one-time gesture tip was seen. */
	hint: boolean;
}

/** Canvas heights accepted from storage. */
export const CANVAS_HEIGHT = { min: 200, max: 20000 } as const;

/** Bucket of a tile width in px, for block contents that adapt their inner grid (cards per row). */
export function sizeOfWidth(px: number): BlockSize {
	if (px < 440) return 'S';
	if (px < 680) return 'M';
	if (px < 940) return 'L';
	return 'XL';
}

/** Key of a block in `blocks`. */
export function blockKey(page: string, id: string): string {
	return `${page}:${id}`;
}

/** Is an element shown? The user's choice, else the element default, else shown. */
export function isElementShown(prefs: BlockPrefs | undefined, elementId: string, elements: readonly BlockElement[] = []): boolean {
	const chosen = prefs?.elements?.[elementId];
	if (typeof chosen === 'boolean') return chosen;
	return elements.find((e) => e.id === elementId)?.default ?? true;
}

/**
 * Effective order of a page: the stored order restricted to blocks that still exist, with new
 * blocks inserted at their default position.
 */
export function effectiveOrder(saved: readonly string[] | undefined, defaults: readonly string[]): string[] {
	if (!saved) return [...defaults];
	const known = saved.filter((id, i) => defaults.includes(id) && saved.indexOf(id) === i);
	for (const id of defaults) if (!known.includes(id)) known.splice(Math.min(defaults.indexOf(id), known.length), 0, id);
	return known;
}

/** Column classes per number of visible items, written in full so Tailwind generates them. */
const COUNT_COLUMNS: Record<'sm' | 'lg', readonly string[]> = {
	sm: ['', 'sm:grid-cols-1', 'sm:grid-cols-2', 'sm:grid-cols-3', 'sm:grid-cols-4'],
	lg: ['', 'lg:grid-cols-1', 'lg:grid-cols-2', 'lg:grid-cols-3', 'lg:grid-cols-4']
};

/**
 * Grid columns for a row of `count` optional items (figures, indicators, totals) from the given
 * breakpoint up: one column per visible item, at most four; nothing when no item is visible.
 */
export function countColumns(count: number, breakpoint: 'sm' | 'lg'): string {
	if (count <= 0) return '';
	return COUNT_COLUMNS[breakpoint][Math.min(4, Math.floor(count))] ?? '';
}

/** Block choices with one field changed; empty choices are dropped to keep the stored value small. */
export function withPrefs(blocks: Record<string, BlockPrefs>, key: string, patch: Partial<BlockPrefs>): Record<string, BlockPrefs> {
	const merged: BlockPrefs = { ...blocks[key], ...patch };
	const clean: BlockPrefs = {};
	if (merged.size) clean.size = merged.size;
	if (merged.hidden) clean.hidden = true;
	if (merged.collapsed) clean.collapsed = true;
	if (merged.elements && Object.keys(merged.elements).length > 0) clean.elements = merged.elements;
	const next = { ...blocks };
	if (Object.keys(clean).length > 0) next[key] = clean;
	else delete next[key];
	return next;
}

/** Choices of every block of a page dropped, along with its stored order and tiles. */
export function resetPageLayout(layout: Pick<PersistedLayout, 'order' | 'blocks' | 'tiles'>, page: string): Pick<PersistedLayout, 'order' | 'blocks' | 'tiles'> {
	const order = { ...layout.order };
	delete order[page];
	const tiles = { ...layout.tiles };
	delete tiles[page];
	const blocks = Object.fromEntries(Object.entries(layout.blocks).filter(([key]) => !key.startsWith(`${page}:`)));
	return { order, blocks, tiles };
}

/** Does the page have any stored choice (order, block or tiles)? */
export function pageHasChoices(layout: Pick<PersistedLayout, 'order' | 'blocks' | 'tiles'>, page: string): boolean {
	return page in layout.order || page in layout.tiles || Object.keys(layout.blocks).some((key) => key.startsWith(`${page}:`));
}

/**
 * Blocks of a page kept out of its tiles: the stored list once the page has tiles, else the blocks
 * the former model hid or collapsed (Budget's Conseils and Prévisions by default, for instance).
 */
export function storedOf(layout: Pick<PersistedLayout, 'blocks' | 'tiles'>, page: string): string[] {
	const own = layout.tiles[page]?.stored;
	if (own) return [...own];
	const prefix = `${page}:`;
	return Object.entries(layout.blocks)
		.filter(([key, prefs]) => key.startsWith(prefix) && (prefs.hidden || prefs.collapsed))
		.map(([key]) => key.slice(prefix.length));
}

/** Tiles of one page read back from storage; null when nothing valid is left. */
function cleanTiles(raw: unknown): PageTiles | null {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
	const r = raw as Record<string, unknown>;
	const out: PageTiles = {};
	const tree = sanitizeTree(r.tree);
	if (tree) out.tree = tree;
	if (Array.isArray(r.stored)) out.stored = [...new Set(r.stored.filter((id): id is string => typeof id === 'string' && id.length > 0))];
	if (typeof r.height === 'number' && Number.isFinite(r.height)) out.height = Math.round(Math.min(CANVAS_HEIGHT.max, Math.max(CANVAS_HEIGHT.min, r.height)));
	return Object.keys(out).length > 0 ? out : null;
}

/** Cleans one block entry read from storage; null when nothing valid is left. */
function cleanPrefs(raw: unknown): BlockPrefs | null {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
	const r = raw as Record<string, unknown>;
	const out: BlockPrefs = {};
	if (typeof r.size === 'string' && (BLOCK_SIZES as readonly string[]).includes(r.size)) out.size = r.size as BlockSize;
	if (r.hidden === true) out.hidden = true;
	if (r.collapsed === true) out.collapsed = true;
	if (r.elements && typeof r.elements === 'object' && !Array.isArray(r.elements)) {
		const elements = Object.fromEntries(Object.entries(r.elements as Record<string, unknown>).filter((e): e is [string, boolean] => typeof e[1] === 'boolean'));
		if (Object.keys(elements).length > 0) out.elements = elements;
	}
	return Object.keys(out).length > 0 ? out : null;
}

/** Persisted layout read back safely: unknown or corrupted fields fall back to defaults. */
export function sanitizeLayout(raw: unknown): PersistedLayout {
	const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
	const density: Density = r.density === 'compact' || r.density === 'confort' ? r.density : 'normal';
	const order: Record<string, string[]> = {};
	if (r.order && typeof r.order === 'object' && !Array.isArray(r.order)) {
		for (const [page, ids] of Object.entries(r.order as Record<string, unknown>)) {
			if (Array.isArray(ids)) order[page] = ids.filter((id): id is string => typeof id === 'string');
		}
	}
	const blocks: Record<string, BlockPrefs> = {};
	if (r.blocks && typeof r.blocks === 'object' && !Array.isArray(r.blocks)) {
		for (const [key, value] of Object.entries(r.blocks as Record<string, unknown>)) {
			const prefs = cleanPrefs(value);
			if (prefs && key.includes(':')) blocks[key] = prefs;
		}
	}
	const tiles: Record<string, PageTiles> = {};
	if (r.tiles && typeof r.tiles === 'object' && !Array.isArray(r.tiles)) {
		for (const [page, value] of Object.entries(r.tiles as Record<string, unknown>)) {
			const clean = cleanTiles(value);
			if (clean) tiles[page] = clean;
		}
	}
	return { wide: r.wide === true, order, density, blocks, tiles, hint: r.hint === true };
}

/** Dashboard tiles that replaced the former « Indicateurs » block, with the element that showed each one. */
const KPI_SPLIT: readonly { id: string; element: string }[] = [
	{ id: 'kpi-solde', element: 'solde' },
	{ id: 'kpi-entrees', element: 'entrees' },
	{ id: 'kpi-sorties', element: 'sorties' },
	{ id: 'kpi-budget', element: 'budget' }
];

/** Figure tiles that show a mini curve (element `courbe`), the former « Mini-courbes » element. */
const KPI_CURVES: readonly string[] = ['kpi-solde', 'kpi-entrees', 'kpi-sorties'];

/**
 * One-time migration of the dashboard « Indicateurs » block (`kpis`) into four independent tiles:
 * - its leaf becomes, at its place, a row of the figures it showed, sharing its width equally;
 * - stored, the four are stored; a figure unticked in the old block stores its tile;
 * - « Mini-courbes » unticked hides the curve of the three figure tiles;
 * - the former order and hidden / collapsed flags (pages without tiles yet) follow the same rules.
 * A layout without the old block comes back as is (same object), so it runs only once.
 */
export function migrateKpis(layout: PersistedLayout): PersistedLayout {
	const page = 'dashboard';
	const oldKey = blockKey(page, 'kpis');
	const prefs = layout.blocks[oldKey];
	const pageTiles = layout.tiles[page];
	const inTree = hasLeaf(pageTiles?.tree, 'kpis');
	const inStored = pageTiles?.stored?.includes('kpis') ?? false;
	const inOrder = layout.order[page]?.includes('kpis') ?? false;
	if (!prefs && !inTree && !inStored && !inOrder) return layout;

	const all = KPI_SPLIT.map((k) => k.id);
	const elements = prefs?.elements ?? {};
	const shown = KPI_SPLIT.filter((k) => elements[k.element] !== false).map((k) => k.id);
	const unticked = all.filter((id) => !shown.includes(id));

	let blocks = { ...layout.blocks };
	delete blocks[oldKey];
	if (elements.courbes === false) {
		for (const id of KPI_CURVES) blocks = withPrefs(blocks, blockKey(page, id), { elements: { ...blocks[blockKey(page, id)]?.elements, courbe: false } });
	}

	const tiles = { ...layout.tiles };
	if (pageTiles) {
		const next: PageTiles = { ...pageTiles };
		const stored = (pageTiles.stored ?? []).filter((id) => id !== 'kpis');
		stored.push(...(inStored ? all : unticked));
		next.stored = [...new Set(stored)];
		if (inTree) {
			const tree = replaceLeaf(pageTiles.tree, 'kpis', inStored ? [] : shown);
			if (tree) next.tree = tree;
			else delete next.tree;
		}
		tiles[page] = next;
	} else {
		const hideAll = !!(prefs?.hidden || prefs?.collapsed);
		for (const id of hideAll ? all : unticked) blocks = withPrefs(blocks, blockKey(page, id), { hidden: true });
	}

	const order = { ...layout.order };
	if (inOrder) order[page] = layout.order[page]!.flatMap((id) => (id === 'kpis' ? all : [id]));
	return { ...layout, blocks, tiles, order };
}

/** The three canvases of the home page: the figures row keeps the historical 'dashboard' namespace. */
export const DASHBOARD_KPI_BLOCKS = ['kpi-solde', 'kpi-entrees', 'kpi-sorties', 'kpi-budget'] as const;
export const DASHBOARD_MAIN_BLOCKS = ['ribbon', 'recent', 'upcoming'] as const;
export const DASHBOARD_DETAIL_BLOCKS = ['balance', 'donut', 'savings', 'insights', 'refunds', 'precaution', 'comptes', 'notes'] as const;
export const DASHBOARD_CANVASES: readonly string[] = ['dashboard', 'dashboard-main', 'dashboard-detail'];

/** Canvases a page-level action (reset) covers: the three of the home page together, else the page itself. */
export function canvasesOf(page: string): readonly string[] {
	return DASHBOARD_CANVASES.includes(page) ? DASHBOARD_CANVASES : [page];
}

const SPLIT_TARGETS: ReadonlyMap<string, string> = new Map([
	...DASHBOARD_MAIN_BLOCKS.map((id) => [id, 'dashboard-main'] as const),
	...DASHBOARD_DETAIL_BLOCKS.map((id) => [id, 'dashboard-detail'] as const)
]);

/**
 * One-time split of the former single home canvas: every block other than the figures moves to
 * 'dashboard-main' or 'dashboard-detail' with its choices (elements, former order, stored flag);
 * the saved tree keeps only the figures and is measured again. A layout already split comes back
 * as is (same object).
 */
export function migrateDashboardSplit(layout: PersistedLayout): PersistedLayout {
	const page = 'dashboard';
	const prefix = blockKey(page, '');
	const moves = (id: string): boolean => SPLIT_TARGETS.has(id);
	const pageTiles = layout.tiles[page];
	const movedLeaves = leafIds(pageTiles?.tree).filter(moves);
	const movedStored = (pageTiles?.stored ?? []).filter(moves);
	const movedOrder = (layout.order[page] ?? []).filter(moves);
	const movedBlocks = Object.keys(layout.blocks).filter((key) => key.startsWith(prefix) && moves(key.slice(prefix.length)));
	if (!movedLeaves.length && !movedStored.length && !movedOrder.length && !movedBlocks.length) return layout;

	const blocks = { ...layout.blocks };
	for (const key of movedBlocks) {
		const id = key.slice(prefix.length);
		blocks[blockKey(SPLIT_TARGETS.get(id)!, id)] = blocks[key]!;
		delete blocks[key];
	}

	const tiles = { ...layout.tiles };
	if (pageTiles) {
		const next: PageTiles = { ...pageTiles, stored: (pageTiles.stored ?? []).filter((id) => !moves(id)) };
		if (movedLeaves.length) {
			const tree = movedLeaves.reduce<TileNode | null>((t, id) => removeLeaf(t, id), pageTiles.tree ?? null);
			if (tree) next.tree = tree;
			else delete next.tree;
			delete next.height;
		}
		tiles[page] = next;
		for (const id of movedStored) {
			const target = SPLIT_TARGETS.get(id)!;
			tiles[target] = { ...tiles[target], stored: [...new Set([...(tiles[target]?.stored ?? []), id])] };
		}
	}

	const order = { ...layout.order };
	if (movedOrder.length) {
		order[page] = layout.order[page]!.filter((id) => !moves(id));
		for (const id of movedOrder) {
			const target = SPLIT_TARGETS.get(id)!;
			order[target] = [...(order[target] ?? []), id];
		}
	}
	return { ...layout, blocks, tiles, order };
}
