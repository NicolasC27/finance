/**
 * Press-and-slide selection of list rows (pure, testable): the rows passed over between the first
 * one and the current one take the state chosen at the start, on top of the selection held before
 * the gesture, so sliding back gives the rows back their previous state.
 */

/**
 * Selection after sliding from row `from` to row `to`: `keys` are the page's rows in order (null for
 * a row that cannot be selected), `base` the selection before the gesture, `on` the state painted.
 */
export function paintRange(base: ReadonlySet<string>, keys: readonly (string | null)[], from: number, to: number, on: boolean): Set<string> {
	const next = new Set(base);
	const lo = Math.max(0, Math.min(from, to));
	const hi = Math.min(keys.length - 1, Math.max(from, to));
	for (let i = lo; i <= hi; i++) {
		const key = keys[i];
		if (!key) continue;
		if (on) next.add(key);
		else next.delete(key);
	}
	return next;
}

/** Pixels from the window edge where the list starts scrolling by itself. */
export const EDGE = 64;

/**
 * Scroll step (px per frame) for a pointer at `y` in a window of `height`: zero away from the
 * edges, up to `max` at the very edge, negative at the top.
 */
export function edgeScrollStep(y: number, height: number, max = 18): number {
	if (y < EDGE) return -Math.ceil(max * Math.min(1, (EDGE - y) / EDGE));
	if (y > height - EDGE) return Math.ceil(max * Math.min(1, (y - (height - EDGE)) / EDGE));
	return 0;
}

/** Pointer travel (px) before a mouse press becomes a slide, or before a touch press becomes a scroll (long press not fired yet). */
export const TOUCH_SLOP = 8;

/** Long press (ms) that starts a selection on touch screens. */
export const LONG_PRESS = 450;
