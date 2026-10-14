import { untrack } from 'svelte';
import {
	blockKey,
	effectiveOrder,
	canvasesOf,
	migrateDashboardSplit,
	migrateKpis,
	pageHasChoices,
	resetPageLayout,
	sanitizeLayout,
	storedOf,
	tilesWithBroughtBack,
	tilesWithStored,
	withCanvasHeight,
	withPrefs,
	type BlockElement,
	type BlockPrefs,
	type BlockSize,
	type Density,
	type PageTiles
} from './layoutModel';
import { leafIds, naturalCanvasHeight, type TileNode } from './tiles';
import { showToast } from './ui.svelte';

/**
 * Customisable layout, persisted in `budget:layout` (rules in layoutModel.ts, tiling in tiles.ts):
 * - `wide`: wide mode, no margins or max width;
 * - `density`: compact / normal / comfortable spacing;
 * - `tiles`: per page, the tile tree, the stored blocks and the canvas height (only once the user
 *   changed something; until then the page derives its tiles from the defaults);
 * - `blocks`: per block (`page:id`) the optional elements, plus the former size / hidden / collapsed
 *   choices read to build the first tiles; `order`: the former block order, read the same way;
 * - `hint`: the gesture tip was seen;
 * - `fullscreen`, `currentPage`, `registry`, `natural`, `screens`, `organiserIA`: session only.
 */

export type { BlockElement, BlockPrefs, BlockSize, Density, PageTiles } from './layoutModel';

const KEY = 'budget:layout';

export const DENSITY_LABELS: Record<Density, string> = { compact: 'Compacte', normal: 'Normale', confort: 'Confortable' };

/** What a mounted block tells its page: title, optional elements and default width share. */
export interface BlockMeta {
	title: string;
	elements: readonly BlockElement[];
	/** Default width (former S / M / L / XL), used to build the first tiles. */
	size?: BlockSize;
}

/** What a tiled canvas shows (session only): read by « Organiser par l'IA » to describe the page. */
export interface PageScreen {
	tree: TileNode | null;
	/** Canvas size in px (0 × 0 before it is measured). */
	size: { w: number; h: number };
	/** Blocks in the tiles, then blocks kept in « blocs rangés ». */
	visible: string[];
	stored: string[];
}

/** Stored layout read once at startup (corrupted values fall back to defaults, old blocks migrated). */
function load() {
	if (typeof localStorage === 'undefined') return { layout: sanitizeLayout(null), migrated: false };
	try {
		const clean = sanitizeLayout(JSON.parse(localStorage.getItem(KEY) ?? '{}'));
		const layout = migrateDashboardSplit(migrateKpis(clean));
		return { layout, migrated: layout !== clean };
	} catch {
		return { layout: sanitizeLayout(null), migrated: false };
	}
}

const { layout: initial, migrated: initialMigrated } = load();

export const layoutState = $state({
	wide: initial.wide,
	order: initial.order,
	density: initial.density,
	blocks: initial.blocks,
	tiles: initial.tiles,
	hint: initial.hint,
	fullscreen: null as string | null,
	/** Page with tiles on screen (palette command « Réinitialiser la disposition de la page »). */
	currentPage: null as string | null,
	/** Blocks mounted per page (stored ones included): titles, elements and default widths. */
	registry: {} as Record<string, Record<string, BlockMeta>>,
	/** Natural content height in px of each block (`page:id`) measured this session, at its tile width. */
	natural: {} as Record<string, number>,
	/** On-screen tiles of each mounted canvas (tree, size, visible and stored blocks). */
	screens: {} as Record<string, PageScreen>,
	/**
	 * « ✨ Organiser par l'IA »: set at startup to a function that asks the AI for a tree and applies
	 * it (through applyTree); the tile menu shows the entry disabled while it is null.
	 */
	organiserIA: null as null | ((page: string) => void | Promise<void>)
});

/** Writes the persisted part (the storage layer sends it to the database). */
function persist(): void {
	try {
		localStorage.setItem(
			KEY,
			JSON.stringify({ wide: layoutState.wide, order: layoutState.order, density: layoutState.density, blocks: layoutState.blocks, tiles: layoutState.tiles, hint: layoutState.hint })
		);
	} catch {
		return;
	}
}

if (initialMigrated) persist();

/** Applies the density on <html> (spacing and size variables, see app.css). */
export function applyDensity(): void {
	if (typeof document === 'undefined') return;
	if (layoutState.density === 'normal') delete document.documentElement.dataset.density;
	else document.documentElement.dataset.density = layoutState.density;
}

export function setDensity(d: Density): void {
	layoutState.density = d;
	applyDensity();
	persist();
}

export function toggleWide(): void {
	layoutState.wide = !layoutState.wide;
	persist();
}

/**
 * Reading order of a page's blocks (DOM order, so the one-column layout of narrow screens follows
 * the tiles): the page tree first, then the other blocks in their former order.
 */
export function orderedIds(page: string, defaults: readonly string[]): string[] {
	const fromTree = leafIds(layoutState.tiles[page]?.tree).filter((id) => defaults.includes(id));
	return [...fromTree, ...effectiveOrder(layoutState.order[page], defaults).filter((id) => !fromTree.includes(id))];
}

/** Choices of one block (empty object when none). */
export function blockPrefs(page: string, id: string): BlockPrefs {
	return layoutState.blocks[blockKey(page, id)] ?? {};
}

/** Shows or hides one optional element of a block. */
export function setBlockElement(page: string, id: string, element: string, shown: boolean): void {
	layoutState.blocks = withPrefs(layoutState.blocks, blockKey(page, id), { elements: { ...blockPrefs(page, id).elements, [element]: shown } });
	persist();
}

/** Blocks of a page kept out of its tiles (stored). */
export function storedIds(page: string): string[] {
	return storedOf(layoutState, page);
}

/** Is a block stored (out of the tiles)? */
export function isStored(page: string, id: string): boolean {
	return storedIds(page).includes(id);
}

/** Everything one page keeps (tiles, block choices, former order), for undo. */
interface PageSnapshot {
	tiles: PageTiles | undefined;
	order: string[] | undefined;
	blocks: Record<string, BlockPrefs>;
}

function snapshot(page: string): PageSnapshot {
	const prefix = `${page}:`;
	return {
		tiles: $state.snapshot(layoutState.tiles[page]),
		order: $state.snapshot(layoutState.order[page]),
		blocks: Object.fromEntries(Object.entries($state.snapshot(layoutState.blocks)).filter(([key]) => key.startsWith(prefix)))
	};
}

function restore(page: string, snap: PageSnapshot): void {
	const prefix = `${page}:`;
	const tiles = { ...layoutState.tiles };
	if (snap.tiles) tiles[page] = snap.tiles;
	else delete tiles[page];
	const order = { ...layoutState.order };
	if (snap.order) order[page] = snap.order;
	else delete order[page];
	layoutState.tiles = tiles;
	layoutState.order = order;
	layoutState.blocks = { ...Object.fromEntries(Object.entries(layoutState.blocks).filter(([key]) => !key.startsWith(prefix))), ...snap.blocks };
	persist();
}

/** Runs a layout change on one page or several canvases, saves it and offers « Annuler » in a toast. */
function withUndo(pages: string | readonly string[], label: string, change: () => void): void {
	const before = (typeof pages === 'string' ? [pages] : pages).map((page) => [page, snapshot(page)] as const);
	change();
	persist();
	showToast(label, 'Annuler', () => {
		for (const [page, snap] of before) restore(page, snap);
	});
}

/** The former hidden / collapsed choices of a block dropped (the stored list replaces them). */
function clearLegacyFlags(page: string, id: string): void {
	const key = blockKey(page, id);
	if (layoutState.blocks[key]?.hidden || layoutState.blocks[key]?.collapsed) layoutState.blocks = withPrefs(layoutState.blocks, key, { hidden: false, collapsed: false });
}

/** Canvas height a page takes with natural tile heights: the height of a tree saved without one. */
function naturalHeightOf(page: string, tree: TileNode): number {
	return naturalCanvasHeight(tree, (id) => layoutState.natural[blockKey(page, id)]);
}

/** The page's tiles replaced, never with a tree lacking a canvas height. */
function setPageTiles(page: string, tiles: PageTiles): void {
	layoutState.tiles = { ...layoutState.tiles, [page]: withCanvasHeight(tiles, (tree) => naturalHeightOf(page, tree)) };
}

/**
 * Saves the tiles of a page (tree, height, stored blocks): every value not given keeps the current
 * one, and a tree always goes with a canvas height. With a label, a toast offers to undo.
 */
export function commitTiles(page: string, next: { tree?: TileNode | null; height?: number; stored?: string[] }, label?: string): void {
	const apply = () => {
		const current = layoutState.tiles[page] ?? {};
		const merged: PageTiles = { ...current, stored: next.stored ?? current.stored ?? storedIds(page) };
		if (next.tree !== undefined) {
			if (next.tree) merged.tree = next.tree;
			else delete merged.tree;
		}
		if (next.height !== undefined) merged.height = Math.round(next.height);
		setPageTiles(page, merged);
		layoutState.hint = true;
	};
	if (label) withUndo(page, label, apply);
	else {
		apply();
		persist();
	}
}

/**
 * Stores a block: it waits in the page's « blocs rangés » list. A page still on its default layout
 * stays derived (the other blocks take their default places); on a customised page the block leaves
 * the tiles: `tree` is the tree on screen (the stored tree is used otherwise) and `place` the tiling
 * computed by the canvas without the block (tree and canvas height, document flow).
 */
export function storeBlock(page: string, id: string, tree?: TileNode | null, place?: { tree: TileNode | null; height: number }): void {
	withUndo(page, 'Bloc rangé', () => {
		setPageTiles(page, tilesWithStored(layoutState.tiles[page] ?? {}, storedIds(page), id, tree, place));
		clearLegacyFlags(page, id);
	});
}

/**
 * Brings a stored block back. A page still on its default layout stays derived: the block takes its
 * default place with natural heights, nothing is squeezed. On a customised page, with the tree on
 * screen and the canvas size, it splits the largest tile along its longest side (dwindle); without
 * them the page inserts it the same way when drawing.
 */
export function bringBackBlock(page: string, id: string, tree?: TileNode | null, size?: { w: number; h: number }): void {
	withUndo(page, 'Bloc ressorti', () => {
		setPageTiles(page, tilesWithBroughtBack(layoutState.tiles[page] ?? {}, storedIds(page), id, tree !== undefined && size ? { tree, size } : undefined));
		clearLegacyFlags(page, id);
	});
}

/** Former API (pages, IA actions): hiding or collapsing a block now stores it; showing brings it back. */
export function setBlockHidden(page: string, id: string, hidden: boolean): void {
	if (hidden) storeBlock(page, id);
	else bringBackBlock(page, id);
}

/** Former API: same as setBlockHidden (collapsed blocks became stored blocks). */
export function setBlockCollapsed(page: string, id: string, collapsed: boolean): void {
	setBlockHidden(page, id, collapsed);
}

/**
 * A block stored by default or by a one-time migration, without a toast. Before the page has tiles it
 * is kept as a former flag (the first tiles leave it stored); once the page has tiles it joins their
 * stored list and leaves the saved tree, so a block that appears later still starts stored.
 */
export function storeByDefault(page: string, id: string): void {
	const tiles = layoutState.tiles[page];
	if (tiles) setPageTiles(page, tilesWithStored(tiles, storedIds(page), id));
	else layoutState.blocks = withPrefs(layoutState.blocks, blockKey(page, id), { collapsed: true });
	persist();
}

/**
 * Tiles for a page computed elsewhere (« Organiser par l'IA »), with undo. The canvas keeps its
 * height: the saved one, else the one on screen, else the natural heights of the new tree (never a
 * guessed height per row that would squeeze the tiles).
 */
export function applyTree(page: string, tree: TileNode, label = 'Disposition appliquée'): void {
	const screen = layoutState.screens[page]?.size.h ?? 0;
	const height = layoutState.tiles[page]?.height ?? (screen > 0 ? screen : naturalHeightOf(page, tree));
	commitTiles(page, { tree, height }, label);
}

/** Does the page have choices to reset? */
export function pageCustomized(page: string): boolean {
	return pageHasChoices(layoutState, page);
}

/** Back to the default layout of one page (tiles, stored blocks, elements), with undo. */
export function resetPage(page: string): void {
	const pages = canvasesOf(page);
	withUndo(pages, 'Disposition de la page remise par défaut', () => {
		const next = pages.reduce((layout, p) => resetPageLayout(layout, p), { order: layoutState.order, blocks: layoutState.blocks, tiles: layoutState.tiles });
		layoutState.order = next.order;
		layoutState.blocks = next.blocks;
		layoutState.tiles = next.tiles;
	});
}

/** Back to the default layout everywhere, normal width and density. */
export function resetLayout(): void {
	layoutState.order = {};
	layoutState.blocks = {};
	layoutState.tiles = {};
	layoutState.wide = false;
	layoutState.density = 'normal';
	applyDensity();
	persist();
}

/** The gesture tip was read (or a gesture was done): it never shows again. */
export function markHintSeen(): void {
	if (layoutState.hint) return;
	layoutState.hint = true;
	persist();
}

/**
 * Records a mounted block for its page. Untracked: blocks call it from an effect, and reading the
 * registry there would make every block re-run on each registration.
 */
export function registerBlock(page: string, id: string, meta: BlockMeta): void {
	untrack(() => {
		const known = layoutState.registry[page]?.[id];
		if (known && known.title === meta.title && known.elements === meta.elements && known.size === meta.size) return;
		layoutState.registry = { ...layoutState.registry, [page]: { ...layoutState.registry[page], [id]: meta } };
	});
}

/**
 * Forgets a block that left the screen (unmounted): it no longer takes a tile. Its natural height is
 * kept, so the next visit of the page places it at its size right away.
 */
export function unregisterBlock(page: string, id: string): void {
	untrack(() => {
		const known = layoutState.registry[page];
		if (!known || !(id in known)) return;
		const rest = { ...known };
		delete rest[id];
		layoutState.registry = { ...layoutState.registry, [page]: rest };
	});
}

/** Natural content height of a block (px), measured by the block itself; small changes are ignored. */
export function setNaturalHeight(page: string, id: string, px: number): void {
	untrack(() => {
		const key = blockKey(page, id);
		const rounded = Math.ceil(px);
		if (Math.abs((layoutState.natural[key] ?? -10) - rounded) <= 1) return;
		layoutState.natural = { ...layoutState.natural, [key]: rounded };
	});
}

/** The canvas of a page tells what it shows (untracked: called from its effect). */
export function publishScreen(page: string, screen: PageScreen): void {
	untrack(() => {
		layoutState.screens = { ...layoutState.screens, [page]: screen };
	});
}

/** The canvas of a page left the screen. */
export function clearScreen(page: string): void {
	untrack(() => {
		if (!(page in layoutState.screens)) return;
		const rest = { ...layoutState.screens };
		delete rest[page];
		layoutState.screens = rest;
	});
}

export function isFullscreen(page: string, id: string): boolean {
	return layoutState.fullscreen === `${page}:${id}`;
}

export function setFullscreen(page: string, id: string, on: boolean): void {
	layoutState.fullscreen = on ? `${page}:${id}` : null;
}
