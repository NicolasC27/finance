/**
 * Inner grids of tile contents (pure module, testable with tsx). They follow the width of the tile
 * through CSS container queries, not the width of the window: on a wide screen a tile can still be
 * narrow. An ancestor of the grid must carry the `@container` class. Tailwind only generates the
 * classes it finds written in full in the sources, hence the literal tables.
 */

/** Cards of about 220 px (KPI, stat cards): one per row, then two, then all of them on one row. */
const CARD_COLUMNS: Readonly<Record<number, string>> = {
	2: '@md:grid-cols-2',
	3: '@md:grid-cols-2 @3xl:grid-cols-3',
	4: '@md:grid-cols-2 @4xl:grid-cols-4'
};

/** Short figures (a label over an amount, about 160 px each). */
const FIGURE_COLUMNS: Readonly<Record<number, string>> = {
	2: '@xs:grid-cols-2',
	3: '@xs:grid-cols-2 @xl:grid-cols-3',
	4: '@xs:grid-cols-2 @2xl:grid-cols-4'
};

/** Card lists of about 250 px per card (Budget categories and goals): up to four per row. */
export const LIST_COLUMNS = '@lg:grid-cols-2 @3xl:grid-cols-3 @5xl:grid-cols-4';

/** Container-query column classes for `count` cards side by side ('' for one card or none). */
export function cardColumns(count: number): string {
	return CARD_COLUMNS[Math.min(4, Math.floor(count))] ?? '';
}

/** Container-query column classes for `count` short figures side by side ('' for one or none). */
export function figureColumns(count: number): string {
	return FIGURE_COLUMNS[Math.min(4, Math.floor(count))] ?? '';
}

/**
 * Height left to a chart that fills its tile: the tile content height minus what sits above and
 * below the chart, never under `min`. Without a set tile height (`box` null) the chart keeps
 * `fallback`.
 */
export function chartHeight(box: { h: number } | null, above: number, below: number, fallback: number, min = 120): number {
	if (!box) return fallback;
	return Math.max(min, Math.floor(box.h - above - below));
}
