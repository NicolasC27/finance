/**
 * Budget page blocks (pure module, testable with tsx): ids in default order, the one-time move from
 * the former collapsible sections (`budget:ui-collapse`) to stored blocks, and the categories shown.
 * Card grids follow the width of their tile: see tileGrid.ts.
 */

/** Blocks of the Budget page, in default order. */
export const BUDGET_BLOCKS = ['resume', 'cascade', 'objectifs', 'vacances', 'categories', 'conseils', 'previsions'] as const;

export type BudgetBlockId = (typeof BUDGET_BLOCKS)[number];

/** Former collapsible section of the Budget page and the block that replaces it. */
export const SECTION_BLOCKS: readonly { section: string; block: BudgetBlockId }[] = [
	{ section: 'goals', block: 'objectifs' },
	{ section: 'vacations', block: 'vacances' },
	{ section: 'categories', block: 'categories' },
	{ section: 'advisor', block: 'conseils' },
	{ section: 'forecast', block: 'previsions' }
];

/**
 * Sections still collapsed (stored choice, or collapsed by default like Conseils and Prévisions)
 * that must become stored blocks. The caller then marks each section expanded, so a later visit
 * finds nothing left to move and the block keeps the user's own choice. A block absent for now (no
 * advice or forecast yet) is left for a later visit: nothing is stored for it.
 */
export function sectionsToMigrate(isCollapsed: (section: string) => boolean, isPresent: (block: BudgetBlockId) => boolean = () => true): { section: string; block: BudgetBlockId }[] {
	return SECTION_BLOCKS.filter((s) => isCollapsed(s.section) && isPresent(s.block));
}

/**
 * Expense categories to show: every one, or (when the user hides the empty ones) only those with a
 * budget or some spending in the month, plus those `keep` names (budget changed during the visit), so
 * a card never vanishes while its slider is being dragged down to zero.
 */
export function categoriesToShow<T extends { id: string }>(
	categories: readonly T[],
	budgetOf: (id: string) => number,
	spentOf: (id: string) => number,
	withEmpty: boolean,
	keep: (id: string) => boolean = () => false
): T[] {
	return withEmpty ? [...categories] : categories.filter((c) => budgetOf(c.id) > 0 || spentOf(c.id) !== 0 || keep(c.id));
}
