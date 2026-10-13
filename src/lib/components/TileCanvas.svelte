<script lang="ts" module>
	import type { BlockSize } from '$lib/layoutModel';
	import type { Rect } from '$lib/tiles';

	/** What a block asks its canvas (Svelte context `tuiles`). */
	export interface TileContext {
		readonly page: string;
		/** Tiling is on (wide screen, main pointer not a finger); off, blocks stack in one column. */
		readonly tiled: boolean;
		/** Pixel rectangle of a block in the canvas, null when it has no tile (stored, not measured yet). */
		rect(id: string): Rect | null;
		/** Width bucket of a block's tile, for contents that adapt their inner grid. */
		size(id: string): BlockSize;
		/** The page has user-defined tiles: contents (charts) may fill their tile height. */
		readonly fixedHeights: boolean;
		stored(id: string): boolean;
		/** Offset of the block being dragged (null for every other block). */
		lift(id: string): { dx: number; dy: number } | null;
		/** Block that was just dropped: it lands without sliding. */
		landing(id: string): boolean;
		pointerDown(e: PointerEvent, id: string, host: HTMLElement): void;
		contextMenu(e: MouseEvent, id: string, host: HTMLElement): void;
		keyDown(e: KeyboardEvent, id: string, host: HTMLElement): void;
		openMenu(id: string, x: number, y: number): void;
	}

	export const TILE_CONTEXT = 'tuiles';
</script>

<script lang="ts">
	import { setContext, tick, type Snippet } from 'svelte';
	import { blockKey, effectiveOrder, sizeOfWidth, isElementShown, CANVAS_HEIGHT } from '$lib/layoutModel';
	import {
		TILE_GAP,
		MIN_TILE,
		LEGACY_WIDTHS,
		dockTile,
		dropPreview,
		dropZone,
		dwindleInsert,
		edgeSplits,
		equalize,
		fitDelta,
		flowResize,
		hasLeaf,
		layoutTiles,
		LEAF_ESTIMATE,
		minSize,
		moveTile,
		neededHeight,
		neighbour,
		orderNeighbour,
		pruneTree,
		ratioForSize,
		removeFlow,
		rowsFromOrder,
		setRatio,
		swapLeaves,
		treeFromRows,
		type DropZone,
		type FlowResize,
		type Gutter,
		type Side,
		type TileNode
	} from '$lib/tiles';
	import {
		blockPrefs,
		clearScreen,
		commitTiles,
		layoutState,
		markHintSeen,
		storeBlock,
		resetPage,
		bringBackBlock,
		setBlockElement,
		publishScreen,
		setFullscreen,
		storedIds
	} from '$lib/layout.svelte';
	import { uiState } from '$lib/ui.svelte';
	import { pressedScrollbar, tileOuterHeight } from '$lib/tileMeasure';

	/**
	 * Tiled canvas of a page's blocks, like Hyprland's dwindle layout: the tiles fill the canvas with a
	 * constant gap, no hole and no overlap (tree and pixel rules in tiles.ts).
	 *
	 * Gestures (wide screen whose main pointer is not a finger):
	 * - hold a block about 200 ms on any non-interactive spot, then drag: a drop zone shows the half
	 *   of the hovered tile it will take (nearest edge), the whole tile to swap with (center) or a
	 *   whole canvas side (border); release to drop;
	 * - right button held and dragged on a block, to the pixel: sideways, its nearest side edge follows
	 *   the pointer (widths are tiled, neighbours share the page width); up or down, its bottom edge
	 *   follows (heights are in document flow: the page height changes, what is below moves, nothing
	 *   above is squeezed). Dragging a gutter does the same: a vertical gutter shares the width, a
	 *   horizontal one sets the height of the row above it (double click: fit it to its content); the
	 *   canvas bottom edge grows or shrinks the last row;
	 * - right click without dragging: the block menu (Shift + right click keeps the browser menu), with
	 *   « Ajuster la hauteur au contenu »;
	 * - keyboard on a focused tile: Alt + arrows swap with the neighbour, Alt + Shift + arrows resize
	 *   by 24 px (up and down from the bottom edge), Alt + Enter fullscreen, Menu key or Shift + F10
	 *   open the menu.
	 * Narrow or touch screens: one column in tree order with natural heights; a long press (or a right
	 * click) opens the menu. Every change can be undone from its toast.
	 *
	 * Until the user changes something, the page derives its tiles from the defaults: rows from the
	 * former order and widths, row heights from the blocks' natural heights (no stretching to the window:
	 * no empty space inside the tiles). Stored blocks wait in the « blocs rangés » chip under the canvas.
	 */
	let { page, defaults, children }: { page: string; defaults: readonly string[]; children: Snippet } = $props();

	const HOLD_MS = 200;
	const TOUCH_HOLD_MS = 450;
	const MOVE_SLOP = 6;
	const KEY_STEP = 24;
	const PER_ROW = 260;
	const INTERACTIVE = 'a, button, input, select, textarea, label, summary, [contenteditable=""], [contenteditable="true"], [role="slider"], [data-no-drag]';

	let canvas = $state<HTMLElement | null>(null);
	let width = $state(0);
	let viewport = $state(640);
	let tiledMedia = $state(false);
	let draft = $state<{ tree?: TileNode; height?: number } | null>(null);
	let moving = $state<{ id: string; dx: number; dy: number; zone: DropZone | null } | null>(null);
	let landingId = $state<string | null>(null);
	let gesture = $state(false);
	let label = $state<{ x: number; y: number; text: string } | null>(null);
	let menu = $state<{ id: string; x: number; y: number } | null>(null);
	let menuEl = $state<HTMLElement | null>(null);
	let menuHeight = $state(0);
	let chipOpen = $state(false);
	let rightPressed = false;

	const registered = $derived(layoutState.registry[page] ?? {});
	const mounted = $derived([...defaults.filter((id) => id in registered), ...Object.keys(registered).filter((id) => !defaults.includes(id))]);
	const stored = $derived(new Set(storedIds(page)));
	const visible = $derived(mounted.filter((id) => !stored.has(id)));
	const saved = $derived(layoutState.tiles[page]);
	const fixedHeights = $derived(!!saved?.tree);
	const tiled = $derived(tiledMedia && width > 0);

	/**
	 * First placement of the tiles, until every shown block is measured (then two more frames, 1 s at
	 * most): they land at their size without sliding; later moves and resizes animate.
	 */
	let placing = $state(true);
	const measured = $derived(visible.every((id) => layoutState.natural[blockKey(page, id)] !== undefined));

	/** Natural outer height of a block (measured), with an estimate until it is measured. */
	function naturalOf(id: string): number {
		return Math.max(MIN_TILE.h, layoutState.natural[blockKey(page, id)] ?? LEAF_ESTIMATE);
	}

	/** Former width share of a block (out of 12 columns): the user's old size, else its default. */
	function widthOf(id: string): number {
		return LEGACY_WIDTHS[blockPrefs(page, id).size ?? registered[id]?.size ?? 'XL'] ?? 12;
	}

	const defaultTree = $derived.by((): TileNode | null => {
		const order = [...effectiveOrder(layoutState.order[page], defaults), ...mounted.filter((id) => !defaults.includes(id))].filter((id) => visible.includes(id));
		const rows = rowsFromOrder(order, widthOf);
		return treeFromRows(rows, widthOf, (row) => Math.max(...row.map(naturalOf)));
	});

	/** Height used to place a block brought back by default (before the canvas height is known). */
	const insertHeight = $derived(saved?.height ?? Math.max(viewport, 600));

	const baseTree = $derived.by((): TileNode | null => {
		if (!saved?.tree) return defaultTree;
		let tree = pruneTree(saved.tree, (id) => visible.includes(id));
		for (const id of visible) if (!hasLeaf(tree, id)) tree = dwindleInsert(tree, id, { w: Math.max(width, 800), h: insertHeight });
		return tree;
	});

	const tree = $derived(draft?.tree ?? baseTree);

	const baseHeight = $derived.by((): number => {
		if (!tree) return 0;
		const floor = minSize(tree).h;
		if (saved?.height) return Math.max(floor, saved.height);
		const wanted = fixedHeights ? neededHeight(tree, () => PER_ROW) : neededHeight(tree, naturalOf);
		return Math.max(floor, wanted);
	});

	const height = $derived(draft?.height ?? baseHeight);
	const layout = $derived(layoutTiles(tree, { x: 0, y: 0, w: width, h: height }));
	const preview = $derived(moving?.zone ? dropPreview(moving.zone, layout.tiles, { w: width, h: height }) : null);

	const storedList = $derived(mounted.filter((id) => stored.has(id)).map((id) => ({ id, title: registered[id]?.title || id })));
	const menuMeta = $derived(menu ? registered[menu.id] : undefined);
	const menuPrefs = $derived(menu ? blockPrefs(page, menu.id) : undefined);

	const ctx: TileContext = {
		get page() {
			return page;
		},
		get tiled() {
			return tiled;
		},
		get fixedHeights() {
			return fixedHeights;
		},
		rect: (id) => (tiled ? (layout.tiles.get(id) ?? null) : null),
		size: (id) => (tiled ? sizeOfWidth(layout.tiles.get(id)?.w ?? width) : 'XL'),
		stored: (id) => stored.has(id),
		lift: (id) => (moving && moving.id === id ? { dx: moving.dx, dy: moving.dy } : null),
		landing: (id) => landingId === id,
		pointerDown,
		contextMenu,
		keyDown,
		openMenu
	};
	setContext(TILE_CONTEXT, ctx);

	$effect(() => {
		layoutState.currentPage = page;
		return () => {
			if (layoutState.currentPage === page) layoutState.currentPage = null;
		};
	});

	/** What the page shows, for « Organiser par l'IA » (tree, canvas size, visible and stored blocks). */
	$effect(() => {
		publishScreen(page, { tree: tree ? $state.snapshot(tree) : null, size: { w: tiled ? width : 0, h: tiled ? height : 0 }, visible: [...visible], stored: [...stored] });
	});
	$effect(() => () => clearScreen(page));

	/** Tiling on wide screens unless the main pointer is a finger (phones, tablets stack their blocks). */
	$effect(() => {
		const wide = matchMedia('(min-width: 1024px)');
		const touch = matchMedia('(pointer: coarse)');
		const update = () => (tiledMedia = wide.matches && !touch.matches);
		update();
		wide.addEventListener('change', update);
		touch.addEventListener('change', update);
		return () => {
			wide.removeEventListener('change', update);
			touch.removeEventListener('change', update);
		};
	});

	$effect(() => {
		if (!canvas) return;
		const el = canvas;
		const measure = () => {
			width = el.clientWidth;
			const top = el.getBoundingClientRect().top + window.scrollY;
			viewport = Math.max(360, Math.round(window.innerHeight - top - 24));
		};
		measure();
		const ro = new ResizeObserver(() => (width = el.clientWidth));
		ro.observe(el);
		window.addEventListener('resize', measure);
		return () => {
			ro.disconnect();
			window.removeEventListener('resize', measure);
		};
	});

	$effect(() => {
		if (!placing || !tiled || !measured) return;
		let frame = requestAnimationFrame(() => (frame = requestAnimationFrame(() => (placing = false))));
		return () => cancelAnimationFrame(frame);
	});

	$effect(() => {
		const timer = setTimeout(() => (placing = false), 1000);
		return () => clearTimeout(timer);
	});

	/** Menu listeners while it is open: outside click, Escape, scroll or resize close it. */
	$effect(() => {
		if (!menu) return;
		const close = () => (menu = null);
		const onDown = (e: PointerEvent) => {
			if (!menuEl?.contains(e.target as Node)) menu = null;
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== 'Escape') return;
			e.stopImmediatePropagation();
			menu = null;
		};
		document.addEventListener('pointerdown', onDown, true);
		window.addEventListener('keydown', onKey, true);
		window.addEventListener('resize', close);
		window.addEventListener('scroll', close, true);
		return () => {
			document.removeEventListener('pointerdown', onDown, true);
			window.removeEventListener('keydown', onKey, true);
			window.removeEventListener('resize', close);
			window.removeEventListener('scroll', close, true);
		};
	});

	/** Stored chip list: an outside click closes it. */
	$effect(() => {
		if (!chipOpen) return;
		const onDown = (e: PointerEvent) => {
			if (!(e.target as HTMLElement | null)?.closest('[data-tile-chip]')) chipOpen = false;
		};
		document.addEventListener('pointerdown', onDown, true);
		return () => document.removeEventListener('pointerdown', onDown, true);
	});

	/**
	 * Pointer down on an interactive control, or on the scrollbar of an element that really scrolls,
	 * starts no gesture (a press on inline text, an amount or a label does lift the tile).
	 */
	function ignoredTarget(e: PointerEvent): boolean {
		const target = e.target;
		if (!(target instanceof Element)) return true;
		if (target.closest(INTERACTIVE)) return true;
		return target instanceof HTMLElement && pressedScrollbar(target, e.offsetX, e.offsetY);
	}

	/** Swallows the click the browser sends after a drag or a long press. */
	function swallowNextClick(): void {
		const stop = (e: Event) => {
			e.stopPropagation();
			e.preventDefault();
		};
		window.addEventListener('click', stop, { capture: true, once: true });
		setTimeout(() => window.removeEventListener('click', stop, { capture: true }), 80);
	}

	/** Page-wide gesture state: no text selection, no tile transitions. */
	function setGesture(on: boolean): void {
		gesture = on;
		document.body.classList.toggle('tile-gesture', on);
		if (on) window.getSelection()?.removeAllRanges();
	}

	/** Canvas coordinates of a pointer. */
	function local(e: { clientX: number; clientY: number }): { x: number; y: number } {
		const box = canvas?.getBoundingClientRect();
		return { x: e.clientX - (box?.left ?? 0), y: e.clientY - (box?.top ?? 0) };
	}

	/** Dimensions label shown near the pointer during a resize. */
	function showLabel(e: { clientX: number; clientY: number }, text: string): void {
		label = { x: e.clientX + 14, y: e.clientY + 16, text };
	}

	/** Saves a tree (and the height on screen) with an undo toast. */
	function commit(next: TileNode | null, text: string, nextHeight = height): void {
		commitTiles(page, { tree: next, height: nextHeight }, text);
	}

	function pointerDown(e: PointerEvent, id: string, host: HTMLElement): void {
		if (!tiled) {
			if (e.pointerType !== 'mouse' && e.button === 0 && !ignoredTarget(e)) holdForMenu(e, id);
			return;
		}
		if (e.button === 2) {
			startRightDrag(e, id, host);
			return;
		}
		if (e.button !== 0 || e.pointerType === 'touch' || ignoredTarget(e)) return;
		const startX = e.clientX;
		const startY = e.clientY;
		const pointerId = e.pointerId;
		const timer = setTimeout(() => {
			stop();
			lift(pointerId, id, host, startX, startY);
		}, HOLD_MS);
		const onMove = (ev: PointerEvent) => {
			if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > MOVE_SLOP) stop();
		};
		const stop = () => {
			clearTimeout(timer);
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', stop);
			window.removeEventListener('pointercancel', stop);
		};
		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', stop);
		window.addEventListener('pointercancel', stop);
	}

	/**
	 * Follows one pointer on the window until it is released or cancelled. Gestures do not rely on
	 * pointer capture: a press on text starts a native selection and Chrome then drops the capture at
	 * the first move (the selection itself is blocked during gestures). Returns the stop function.
	 */
	function follow(pointerId: number, onMove: (e: PointerEvent) => void, onEnd: (e: PointerEvent, cancelled: boolean) => void): () => void {
		const move = (e: PointerEvent) => {
			if (e.pointerId === pointerId) onMove(e);
		};
		const up = (e: PointerEvent) => {
			if (e.pointerId !== pointerId) return;
			stop();
			onEnd(e, false);
		};
		const cancel = (e: PointerEvent) => {
			if (e.pointerId !== pointerId) return;
			stop();
			onEnd(e, true);
		};
		const stop = () => {
			window.removeEventListener('pointermove', move, true);
			window.removeEventListener('pointerup', up, true);
			window.removeEventListener('pointercancel', cancel, true);
		};
		window.addEventListener('pointermove', move, true);
		window.addEventListener('pointerup', up, true);
		window.addEventListener('pointercancel', cancel, true);
		return stop;
	}

	/**
	 * Drag of a lifted tile: it follows the pointer while the drop zone under it is computed from the
	 * tile rectangles; release applies it (move, swap or dock), Escape cancels.
	 */
	function lift(pointerId: number, id: string, host: HTMLElement, startX: number, startY: number): void {
		if (!host.isConnected) return;
		menu = null;
		setGesture(true);
		moving = { id, dx: 0, dy: 0, zone: null };
		const finish = (apply: boolean) => {
			window.removeEventListener('keydown', onKey, true);
			const zone = moving?.zone ?? null;
			const moved = !!moving && Math.hypot(moving.dx, moving.dy) > MOVE_SLOP;
			setGesture(false);
			if (moved) swallowNextClick();
			if (apply && zone && tree) {
				const next = zone.kind === 'dock' ? dockTile(tree, id, zone.side) : moveTile(tree, id, zone.target, zone.zone);
				landingId = id;
				moving = null;
				commit(next, zone.kind === 'tile' && zone.zone === 'center' ? 'Blocs échangés' : 'Bloc déplacé');
				requestAnimationFrame(() => requestAnimationFrame(() => (landingId = null)));
				return;
			}
			moving = null;
		};
		const stop = follow(
			pointerId,
			(ev) => {
				window.getSelection()?.removeAllRanges();
				const p = local(ev);
				moving = { id, dx: ev.clientX - startX, dy: ev.clientY - startY, zone: dropZone(layout.tiles, { w: width, h: height }, p.x, p.y, id) };
			},
			(_ev, cancelled) => finish(!cancelled)
		);
		const onKey = (ev: KeyboardEvent) => {
			if (ev.key !== 'Escape') return;
			ev.preventDefault();
			ev.stopImmediatePropagation();
			stop();
			finish(false);
		};
		window.addEventListener('keydown', onKey, true);
	}

	/** Edge of a tile moved by a resize on one axis: the one nearest to the pointer, else the other one. */
	function pickEdge(edges: Partial<Record<Side, string>>, near: Side, far: Side): Side | null {
		if (edges[near] !== undefined) return near;
		return edges[far] !== undefined ? far : null;
	}

	/** Tree with the given tile edges moved by pixel offsets (each edge is a split's separator). */
	function movedEdges(base: TileNode, moves: readonly { path: string; delta: number }[]): TileNode {
		let next = base;
		const gutters = layoutTiles(base, { x: 0, y: 0, w: width, h: height }).gutters;
		for (const { path, delta } of moves) {
			const g = gutters.find((x) => x.path === path);
			if (g) next = setRatio(next, path, ratioForSize(g, g.size + delta));
		}
		return next;
	}

	/** End of a resize gesture: the draft (tree and canvas height) is saved, unless cancelled or unmoved. */
	function endResize(base: TileNode, baseHeight: number, cancelled: boolean, text: string): void {
		const changed = draft !== null;
		const next = draft?.tree ?? base;
		const nextHeight = draft?.height ?? baseHeight;
		draft = null;
		label = null;
		setGesture(false);
		if (!cancelled && changed) commit(next, text, nextHeight);
	}

	/** Vertical resize in document flow on the canvas as it was when the gesture started. */
	function flowAt(base: TileNode, baseHeight: number, y0: number, delta: number): FlowResize {
		const room = CANVAS_HEIGHT.max - baseHeight;
		return flowResize(base, { w: width, h: baseHeight }, y0, Math.min(room, delta), TILE_GAP, MIN_TILE, CANVAS_HEIGHT.min);
	}

	/** Height of the tiles ending on a line once resized, for the size label. */
	function heightEndingAt(flow: FlowResize, y0: number): number | null {
		for (const r of layoutTiles(flow.tree, { x: 0, y: 0, w: width, h: flow.height }).tiles.values()) {
			if (Math.abs(r.y + r.h - (y0 + flow.delta)) <= 1) return Math.round(r.h);
		}
		return null;
	}

	/**
	 * Height a block needs without stretching to its tile (content, padding and border), measured now:
	 * inline heights its content takes from the tile are switched off for the measure (.tile-measuring).
	 */
	function intrinsicHeight(id: string): number | null {
		const host = canvas?.querySelector<HTMLElement>(`[data-tile="${CSS.escape(id)}"]`);
		const content = host?.querySelector<HTMLElement>('.tile-content');
		if (!host || !content) return null;
		host.classList.add('tile-measuring');
		const outer = tileOuterHeight(host, content.getBoundingClientRect().height);
		host.classList.remove('tile-measuring');
		return outer;
	}

	/** The row ending on a line gets the height its tallest content needs; the page height follows. */
	function fitLine(y0: number): void {
		if (!tree) return;
		const d = fitDelta(layout.tiles, y0, intrinsicHeight);
		if (d === null || Math.abs(d) < 1) return;
		const flow = flowAt(tree, height, y0, d);
		commit(flow.tree, 'Hauteur ajustée au contenu', flow.height);
	}

	/**
	 * Right button held on a tile: a drag moves its nearest edges (pixel resize, label with the new
	 * size); a release without drag opens the menu there. Decided on release, since Linux sends the
	 * contextmenu event on press.
	 */
	function startRightDrag(e: PointerEvent, id: string, _host: HTMLElement): void {
		if (e.shiftKey || !tree) return;
		const base = tree;
		const baseHeight = height;
		const r = layout.tiles.get(id);
		if (!r) return;
		rightPressed = true;
		const start = local(e);
		const edges = edgeSplits(base, id);
		const right = start.x - r.x > r.w / 2;
		const hSide = pickEdge(edges, right ? 'right' : 'left', right ? 'left' : 'right');
		const bottom = r.y + r.h;
		let resizing = false;
		follow(
			e.pointerId,
			(ev) => {
				const dx = ev.clientX - e.clientX;
				const dy = ev.clientY - e.clientY;
				if (!resizing && Math.hypot(dx, dy) < 4) return;
				if (!resizing) {
					resizing = true;
					menu = null;
					setGesture(true);
				}
				const widened = hSide ? movedEdges(base, [{ path: edges[hSide]!, delta: dx }]) : base;
				const flow = flowAt(widened, baseHeight, bottom, dy);
				draft = { tree: flow.tree, height: flow.height };
				const now = layoutTiles(flow.tree, { x: 0, y: 0, w: width, h: flow.height }).tiles.get(id);
				if (now) showLabel(ev, `${Math.round(now.w)} × ${Math.round(now.h)}`);
			},
			(ev, cancelled) => {
				setTimeout(() => (rightPressed = false), 300);
				if (resizing) endResize(base, baseHeight, cancelled, 'Taille du bloc modifiée');
				else if (!cancelled) openMenu(id, ev.clientX, ev.clientY);
			}
		);
	}

	/**
	 * Gutter dragged with the left button: a vertical one shares the width of its two halves; a
	 * horizontal one sets the height of the row above it, the page height following (document flow).
	 */
	function startGutter(e: PointerEvent, gutter: Gutter): void {
		if (e.button !== 0 || !tree) return;
		e.preventDefault();
		const base = tree;
		const baseHeight = height;
		setGesture(true);
		menu = null;
		follow(
			e.pointerId,
			(ev) => {
				if (gutter.dir === 'row') {
					draft = { tree: movedEdges(base, [{ path: gutter.path, delta: ev.clientX - e.clientX }]) };
					const g = layout.gutters.find((x) => x.path === gutter.path);
					if (g) showLabel(ev, `${Math.round(g.size)} px · ${Math.round(g.avail - g.size)} px`);
					return;
				}
				const flow = flowAt(base, baseHeight, gutter.rect.y, ev.clientY - e.clientY);
				draft = { tree: flow.tree, height: flow.height };
				const h = heightEndingAt(flow, gutter.rect.y);
				if (h !== null) showLabel(ev, `${h} px de haut`);
			},
			(_ev, cancelled) => endResize(base, baseHeight, cancelled, gutter.dir === 'row' ? 'Taille des blocs modifiée' : 'Hauteur des blocs modifiée')
		);
	}

	/** Bottom edge of the canvas dragged: the last row grows or shrinks to the pixel, the rest stays. */
	function startHeight(e: PointerEvent): void {
		if (e.button !== 0 || !tree) return;
		e.preventDefault();
		const base = tree;
		const start = height;
		setGesture(true);
		follow(
			e.pointerId,
			(ev) => {
				const flow = flowAt(base, start, start, ev.clientY - e.clientY);
				draft = { tree: flow.tree, height: flow.height };
				showLabel(ev, `${flow.height} px`);
			},
			(_ev, cancelled) => endResize(base, start, cancelled, 'Hauteur de la page modifiée')
		);
	}

	/** Long press with a finger (narrow or touch screens): opens the menu there. */
	function holdForMenu(e: PointerEvent, id: string): void {
		const startX = e.clientX;
		const startY = e.clientY;
		const timer = setTimeout(() => {
			stop();
			swallowNextClick();
			openMenu(id, startX, startY);
		}, TOUCH_HOLD_MS);
		const onMove = (ev: PointerEvent) => {
			if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > 8) stop();
		};
		const stop = () => {
			clearTimeout(timer);
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', stop);
			window.removeEventListener('pointercancel', stop);
		};
		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', stop);
		window.addEventListener('pointercancel', stop);
	}

	/**
	 * Browser menu event on a block: kept with Shift; with a mouse on tiles the menu opens on release
	 * (see startRightDrag); from the keyboard or on narrow screens it opens right away.
	 */
	function contextMenu(e: MouseEvent, id: string, host: HTMLElement): void {
		if (e.shiftKey) return;
		e.preventDefault();
		if (tiled && rightPressed) return;
		const fromKeyboard = e.clientX === 0 && e.clientY === 0;
		const box = host.getBoundingClientRect();
		openMenu(id, fromKeyboard ? box.left + 16 : e.clientX, fromKeyboard ? box.top + 16 : e.clientY);
	}

	/** Keyboard on a focused tile (see the component doc). */
	function keyDown(e: KeyboardEvent, id: string, host: HTMLElement): void {
		if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
			e.preventDefault();
			const box = host.getBoundingClientRect();
			openMenu(id, box.left + 16, box.top + 16);
			return;
		}
		if (!e.altKey) return;
		if (e.key === 'Enter') {
			e.preventDefault();
			setFullscreen(page, id, true);
			return;
		}
		const sides: Record<string, Side> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'top', ArrowDown: 'bottom' };
		const side = sides[e.key];
		if (!side || !tiled || !tree) return;
		e.preventDefault();
		if (!e.shiftKey) {
			const other = neighbour(layout.tiles, id, side);
			if (other) commit(swapLeaves(tree, id, other), 'Blocs échangés');
			void tick().then(() => host.focus({ preventScroll: true }));
			return;
		}
		const grow = side === 'right' || side === 'bottom' ? KEY_STEP : -KEY_STEP;
		if (side === 'top' || side === 'bottom') {
			const r = layout.tiles.get(id);
			if (!r) return;
			const flow = flowAt(tree, height, r.y + r.h, grow);
			commit(flow.tree, 'Taille du bloc modifiée', flow.height);
			return;
		}
		const edges = edgeSplits(tree, id);
		const edge = pickEdge(edges, 'right', 'left');
		if (!edge) return;
		commit(movedEdges(tree, [{ path: edges[edge]!, delta: grow }]), 'Taille du bloc modifiée');
	}

	function openMenu(id: string, x: number, y: number): void {
		chipOpen = false;
		menu = { id, x, y };
	}

	/** Menu position kept inside the window. */
	const menuStyle = $derived.by(() => {
		if (!menu) return '';
		const w = 236;
		const left = Math.max(8, Math.min(menu.x, window.innerWidth - w - 8));
		const top = menu.y + menuHeight + 8 > window.innerHeight ? Math.max(8, window.innerHeight - menuHeight - 8) : menu.y;
		return `left: ${left}px; top: ${top}px; width: ${w}px;`;
	});

	function menuAction(run: () => void): void {
		menu = null;
		run();
	}

	/** « Ajuster la hauteur au contenu »: the row ending at the bottom of the block fits its content. */
	function fitFromMenu(id: string): void {
		const r = layout.tiles.get(id);
		menuAction(() => {
			if (r) fitLine(r.y + r.h);
		});
	}

	/** Stores a block from its menu; on tiles, what was below a full-width block moves up (document flow). */
	function storeFromMenu(id: string): void {
		const place = tiled && tree ? removeFlow(tree, { w: width, h: height }, id) : undefined;
		menuAction(() => storeBlock(page, id, tree, place));
	}

	function bringBack(id: string): void {
		chipOpen = false;
		bringBackBlock(page, id, tree, tiled ? { w: width, h: height } : undefined);
	}

	function swapInOrder(id: string, step: -1 | 1): void {
		const other = orderNeighbour(tree, id, step);
		if (other && tree) menuAction(() => commit(swapLeaves(tree!, id, other), 'Bloc déplacé'));
	}

	function dismissHint(): void {
		markHintSeen();
	}
</script>

{#if tiled && !layoutState.hint && visible.length > 1}
	<p class="tile-hint meta-xs" role="note">
		<span>Astuce : <b>maintiens</b> un bloc pour le déplacer · <b>clic droit + glisser</b> pour le redimensionner · <b>clic droit</b> pour ses options</span>
		<button type="button" class="tile-hint-ok" onclick={dismissHint}>Compris</button>
	</p>
{/if}

<div
	bind:this={canvas}
	class="tile-canvas"
	class:tile-canvas-tiled={tiled}
	class:tile-canvas-gesture={gesture}
	class:tile-canvas-placing={placing}
	style={tiled ? `height: ${height}px;` : ''}
	data-tile-page={page}
>
	{@render children()}
	{#if tiled}
		{#each layout.gutters as g (g.path)}
			<div
				class="tile-gutter tile-gutter-{g.dir}"
				style="left: {g.rect.x}px; top: {g.rect.y}px; width: {g.rect.w}px; height: {g.rect.h}px;"
				role="separator"
				aria-orientation={g.dir === 'row' ? 'vertical' : 'horizontal'}
				aria-label={g.dir === 'row' ? 'Glisser pour partager la largeur' : 'Glisser pour changer la hauteur (double-clic : ajuster au contenu)'}
				title={g.dir === 'col' ? 'Glisser : hauteur du bloc au-dessus · double-clic : ajuster au contenu' : undefined}
				onpointerdown={(e) => startGutter(e, g)}
				ondblclick={() => g.dir === 'col' && fitLine(g.rect.y)}
			></div>
		{/each}
		{#if preview}
			<div class="tile-drop" style="left: {preview.x}px; top: {preview.y}px; width: {preview.w}px; height: {preview.h}px;" aria-hidden="true"></div>
		{/if}
	{/if}
</div>

{#if tiled}
	<div class="tile-foot" role="separator" aria-orientation="horizontal" aria-label="Glisser pour changer la hauteur de la page" title="Glisser pour changer la hauteur de la page" onpointerdown={startHeight}>
		<span class="tile-foot-grip" aria-hidden="true"></span>
	</div>
{/if}

{#if storedList.length > 0}
	<div class="tile-chip-row" data-tile-chip>
		<div class="relative">
			<button type="button" class="chip chip-muted cursor-pointer" aria-expanded={chipOpen} onclick={() => (chipOpen = !chipOpen)}>
				{storedList.length} bloc{storedList.length > 1 ? 's' : ''} rangé{storedList.length > 1 ? 's' : ''}
			</button>
			{#if chipOpen}
				<div class="tile-chip-list" role="group" aria-label="Blocs rangés">
					{#each storedList as b (b.id)}
						<div class="tile-chip-item">
							<span class="min-w-0 flex-1 truncate">{b.title}</span>
							<button type="button" class="btn btn-secondary btn-sm" onclick={() => bringBack(b.id)}>Ressortir</button>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	</div>
{/if}

{#if label}
	<div class="tile-label tabular" style="left: {label.x}px; top: {label.y}px;" aria-hidden="true">{label.text}</div>
{/if}

{#snippet menuIcon(name: string)}
	<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
		{#if name === 'full'}<path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M16 21h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
		{:else if name === 'store'}<path d="M21 8v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8M2 3h20v5H2zM10 12h4" />
		{:else if name === 'fit'}<path d="M12 3v18M8 7l4-4 4 4M8 17l4 4 4-4M4 3h16M4 21h16" />
		{:else if name === 'equal'}<path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z" />
		{:else if name === 'up'}<path d="M12 19V5M6 11l6-6 6 6" />
		{:else if name === 'down'}<path d="M12 5v14M6 13l6 6 6-6" />
		{:else if name === 'reset'}<path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5" />
		{:else if name === 'ai'}<path d="M12 3l1.8 4.9L19 10l-5.2 1.9L12 17l-1.8-5.1L5 10l5.2-2.1zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z" />
		{/if}
	</svg>
{/snippet}

{#if menu}
	{@const id = menu.id}
	<div bind:this={menuEl} bind:offsetHeight={menuHeight} class="tile-menu" style={menuStyle} role="menu" aria-label="Options du bloc {menuMeta?.title ?? ''}" data-tile-menu>
		<p class="tile-menu-title">{menuMeta?.title ?? 'Bloc'}</p>
		<!-- Most used actions as big icon buttons -->
		<div class="tile-menu-quick">
			<button type="button" role="menuitem" class="tile-menu-tool" title="Plein écran (Alt + Entrée, ou double-clic sur le bloc)" onclick={() => menuAction(() => setFullscreen(page, id, true))}>{@render menuIcon('full')}<span>Plein écran</span></button>
			<button type="button" role="menuitem" class="tile-menu-tool" title="Ranger le bloc : il revient avec la puce « blocs rangés »" onclick={() => storeFromMenu(id)}>{@render menuIcon('store')}<span>Ranger</span></button>
			{#if tiled}
				<button type="button" role="menuitem" class="tile-menu-tool" title="Ajuster la hauteur au contenu" onclick={() => fitFromMenu(id)}>{@render menuIcon('fit')}<span>Ajuster</span></button>
				<button type="button" role="menuitem" class="tile-menu-tool" title="Égaliser les tuiles de la page" onclick={() => menuAction(() => tree && commit(equalize(tree), 'Tuiles égalisées'))}>{@render menuIcon('equal')}<span>Égaliser</span></button>
			{:else}
				<button type="button" role="menuitem" class="tile-menu-tool" disabled={!orderNeighbour(tree, id, -1)} onclick={() => swapInOrder(id, -1)}>{@render menuIcon('up')}<span>Monter</span></button>
				<button type="button" role="menuitem" class="tile-menu-tool" disabled={!orderNeighbour(tree, id, 1)} onclick={() => swapInOrder(id, 1)}>{@render menuIcon('down')}<span>Descendre</span></button>
			{/if}
		</div>
		{#if menuMeta && menuMeta.elements.length > 0}
			<p class="tile-menu-section">Éléments affichés</p>
			<ul class="space-y-0.5">
				{#each menuMeta.elements as el (el.id)}
					<li>
						<label class="tile-menu-check">
							<input type="checkbox" checked={isElementShown(menuPrefs, el.id, menuMeta.elements)} onchange={(e) => setBlockElement(page, id, el.id, e.currentTarget.checked)} />
							<span>{el.label}</span>
						</label>
					</li>
				{/each}
			</ul>
		{/if}
		<div class="tile-menu-sep" aria-hidden="true"></div>
		<button type="button" role="menuitem" class="tile-menu-item" onclick={() => menuAction(() => resetPage(page))}>{@render menuIcon('reset')}<span class="flex-1">Réinitialiser la page</span></button>
		<button
			type="button"
			role="menuitem"
			class="tile-menu-item tile-menu-ai"
			disabled={!layoutState.organiserIA || uiState.dialogDepth > 0}
			title={layoutState.organiserIA ? 'Proposer une disposition adaptée à cette page' : 'Bientôt'}
			onclick={() => menuAction(() => void layoutState.organiserIA?.(page))}
		>
			{@render menuIcon('ai')}<span class="flex-1">Organiser par l'IA</span>
		</button>
		{#if tiled}
			<p class="tile-menu-help">Double-clic : plein écran · maintenir + glisser : déplacer · clic droit + glisser : taille · Maj + clic droit : menu du navigateur</p>
		{/if}
	</div>
{/if}

<style>
	.tile-canvas {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.tile-canvas-tiled {
		position: relative;
		display: block;
	}
	.tile-canvas-tiled > :global(.tile) {
		position: absolute;
	}

	.tile-gutter {
		position: absolute;
		z-index: 4;
		touch-action: none;
	}
	.tile-gutter-row {
		cursor: col-resize;
	}
	.tile-gutter-col {
		cursor: row-resize;
	}
	.tile-gutter::after {
		content: '';
		position: absolute;
		inset: 0;
		margin: auto;
		border-radius: 999px;
		background-color: var(--accent);
		opacity: 0;
		transition: opacity 120ms ease;
	}
	.tile-gutter-row::after {
		width: 3px;
	}
	.tile-gutter-col::after {
		height: 3px;
	}
	.tile-gutter:hover::after,
	.tile-canvas-gesture .tile-gutter:active::after {
		opacity: 0.55;
	}

	.tile-drop {
		position: absolute;
		z-index: 60;
		border: 2px solid var(--accent);
		border-radius: 10px;
		background-color: color-mix(in srgb, var(--accent) 14%, transparent);
		pointer-events: none;
		transition:
			left 120ms ease,
			top 120ms ease,
			width 120ms ease,
			height 120ms ease;
	}

	.tile-foot {
		position: relative;
		height: 14px;
		margin-top: 2px;
		cursor: row-resize;
		touch-action: none;
	}
	.tile-foot-grip {
		position: absolute;
		left: 50%;
		top: 5px;
		width: 44px;
		height: 4px;
		margin-left: -22px;
		border-radius: 999px;
		background-color: var(--hairline);
		transition: background-color 120ms ease;
	}
	.tile-foot:hover .tile-foot-grip {
		background-color: var(--accent);
	}

	.tile-chip-row {
		display: flex;
		justify-content: flex-end;
		margin-top: 6px;
	}
	.tile-chip-list {
		position: absolute;
		right: 0;
		bottom: calc(100% + 6px);
		z-index: 60;
		min-width: 240px;
		padding: 6px;
		border: 1px solid var(--hairline);
		border-radius: 10px;
		background-color: var(--surface);
		box-shadow: var(--shadow-soft);
	}
	.tile-chip-item {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 4px;
		font-size: 12px;
	}

	.tile-hint {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		margin-bottom: 8px;
		padding: 6px 10px;
		border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--hairline));
		border-radius: 8px;
		background-color: color-mix(in srgb, var(--accent) 6%, var(--surface));
	}
	.tile-hint b {
		color: var(--text);
		font-weight: 600;
	}
	.tile-hint-ok {
		flex-shrink: 0;
		color: var(--accent);
		cursor: pointer;
	}

	.tile-label {
		position: fixed;
		z-index: 90;
		padding: 2px 7px;
		border-radius: 6px;
		background-color: var(--text);
		color: var(--bg);
		font-size: 11px;
		font-weight: 600;
		pointer-events: none;
	}

	.tile-menu {
		position: fixed;
		z-index: 85;
		min-width: 276px;
		padding: 8px;
		border: 1px solid var(--hairline);
		border-radius: 14px;
		background-color: color-mix(in srgb, var(--surface) 92%, transparent);
		backdrop-filter: blur(14px) saturate(1.2);
		box-shadow:
			0 18px 44px -18px rgb(0 0 0 / 0.55),
			0 0 0 1px color-mix(in srgb, var(--accent) 8%, transparent);
		text-align: left;
		transform-origin: top left;
		animation: tile-menu-in var(--motion-base) var(--ease-spring);
	}
	@keyframes tile-menu-in {
		from {
			opacity: 0;
			transform: scale(0.94) translateY(-4px);
		}
	}
	.tile-menu-quick {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 4px;
		margin-bottom: 6px;
	}
	.tile-menu-tool {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
		padding: 9px 2px 7px;
		border-radius: 10px;
		background-color: var(--surface-2);
		color: var(--text-secondary);
		font-size: 10.5px;
		cursor: pointer;
		transition:
			background-color var(--motion-fast) ease,
			color var(--motion-fast) ease,
			transform var(--motion-fast) var(--ease-out);
	}
	.tile-menu-tool:hover:not(:disabled),
	.tile-menu-tool:focus-visible {
		background-color: var(--accent-soft);
		color: var(--accent);
		transform: translateY(-1px);
	}
	.tile-menu-tool:active:not(:disabled) {
		transform: scale(0.94);
	}
	.tile-menu-tool:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.tile-menu-tool span {
		color: var(--text);
		white-space: nowrap;
	}
	.tile-menu-ai {
		color: var(--accent);
	}
	.tile-menu-title {
		margin: 2px 6px 6px;
		font-size: 12px;
		font-weight: 600;
	}
	.tile-menu-section {
		margin: 2px 6px 4px;
		font-size: 10px;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--text-secondary);
	}
	.tile-menu-check {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 3px 6px;
		border-radius: 6px;
		font-size: 12px;
		cursor: pointer;
	}
	.tile-menu-check:hover {
		background-color: var(--surface-2);
	}
	.tile-menu-check input {
		accent-color: var(--accent);
	}
	.tile-menu-sep {
		margin: 5px 0;
		border-top: 1px solid var(--border-subtle);
	}
	.tile-menu-item {
		display: flex;
		width: 100%;
		align-items: center;
		gap: 9px;
		padding: 6px 8px;
		border-radius: 8px;
		font-size: 12px;
		text-align: left;
		cursor: pointer;
		transition:
			background-color var(--motion-fast) ease,
			transform var(--motion-fast) var(--ease-out);
	}
	.tile-menu-item :global(svg) {
		color: var(--text-secondary);
		flex-shrink: 0;
	}
	.tile-menu-item:hover:not(:disabled) {
		background-color: var(--surface-2);
		transform: translateX(2px);
	}
	.tile-menu-ai :global(svg) {
		color: var(--accent);
	}
	.tile-menu-item:disabled {
		opacity: 0.45;
		cursor: default;
	}
	.tile-menu-help {
		margin: 6px 6px 2px;
		font-size: 10.5px;
		line-height: 1.4;
		color: var(--text-secondary);
	}

	/* Intrinsic height measure: heights a content takes from its tile are switched off for one read */
	:global(.tile-measuring .tile-content),
	:global(.tile-measuring .tile-content [style*='height']) {
		height: auto !important;
		min-height: 0 !important;
	}

	:global(body.tile-gesture) {
		user-select: none;
		-webkit-user-select: none;
	}
	:global(body.tile-gesture *) {
		cursor: inherit;
	}
</style>
