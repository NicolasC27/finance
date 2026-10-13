import type { CategoryId, Transaction } from './types';
import { isPending, isPlannedInstalment, signedAmount } from './data';
import { flowKind, type FlowKind } from './flow';

/**
 * « Catégorie » sort of the Transactions list (pure, testable): the filtered rows grouped under one
 * header per category, and where those headers fall on each page.
 *
 * Category order, descending (the default): spending categories first, the largest net spending
 * first (refunds deducted, so a category whose refunds exceed its spending ends the block); then the
 * categories outside the flows (savings, transfers between one's own accounts), the largest outflow
 * first; then income, the largest first. Income comes after spending because the sort is read to
 * check where the money went. Ascending is the exact reverse. Inside a category the rows go by date,
 * newest first whatever the direction, the pending bank rows (« en cours ») last as in the date sort.
 * Ties: more rows first, then the category id, so the order never flickers.
 *
 * Headers never count as rows: a list whose categories are all folded is a one-page summary, and
 * only the rows of unfolded categories fill the pages. The period stepper of the category mode reads
 * and writes whole months (monthBounds, rangeMonth) and skips the months without operations.
 */

export interface CategoryGroup {
	id: CategoryId;
	kind: FlowKind;
	/** Rows of the category in the filtered list, pending, hidden and folded ones included. */
	count: number;
	/** Signed net of the rows the page totals count (income positive, spending negative), to the cent. */
	net: number;
}

export interface CategoryLayout {
	/** Categories of the filtered rows, in display order. */
	groups: CategoryGroup[];
	/** Rows shown, in display order: the rows of a folded category are left out. */
	rows: Transaction[];
	/** Index in `rows` where each group starts (a folded group: where its lone header sits), aligned with `groups`. */
	starts: number[];
	/** Folded categories. */
	folded: ReadonlySet<CategoryId>;
}

export interface CategoryHead {
	group: CategoryGroup;
	/** The category started on an earlier page: its header is repeated there, marked « (suite) ». */
	continued: boolean;
	folded: boolean;
}

export interface PageHeads {
	/** Headers drawn before each row of the page (index in the page). */
	before: CategoryHead[][];
	/** Headers drawn after the page's last row: folded categories at the very end of the list. */
	after: CategoryHead[];
}

const KIND_RANK: Record<FlowKind, number> = { expense: 0, transfer: 1, income: 2 };

/** Size of a group inside its kind: the income received, otherwise the money gone out. */
function weight(group: CategoryGroup): number {
	return group.kind === 'income' ? group.net : -group.net;
}

/** Pending bank row, listed after the dated ones; an expected instalment keeps its date. */
function listedLast(tx: Transaction): boolean {
	return isPending(tx) && !isPlannedInstalment(tx);
}

/**
 * Rows grouped by category: `catOf` is the category each row displays, `counted` the page totals'
 * rule (budget flow, not hidden), `folded` the categories whose rows are left out of the list (their
 * header stays).
 */
export function categoryLayout(
	txs: readonly Transaction[],
	catOf: (tx: Transaction) => CategoryId,
	counted: (tx: Transaction) => boolean,
	dir: 'asc' | 'desc',
	folded: ReadonlySet<CategoryId> = new Set()
): CategoryLayout {
	const cats = new Map<Transaction, CategoryId>();
	const byId = new Map<CategoryId, CategoryGroup>();
	for (const tx of txs) {
		const id = catOf(tx);
		cats.set(tx, id);
		const group = byId.get(id) ?? { id, kind: flowKind(id), count: 0, net: 0 };
		group.count++;
		if (counted(tx)) group.net = Math.round((group.net + signedAmount(tx)) * 100) / 100;
		byId.set(id, group);
	}
	const groups = [...byId.values()].sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind] || weight(b) - weight(a) || b.count - a.count || a.id.localeCompare(b.id));
	if (dir === 'asc') groups.reverse();
	const rank = new Map(groups.map((group, i) => [group.id, i]));
	const rankOf = (tx: Transaction) => rank.get(cats.get(tx)!)!;
	const rows = txs
		.filter((tx) => !folded.has(cats.get(tx)!))
		.sort((a, b) => rankOf(a) - rankOf(b) || Number(listedLast(a)) - Number(listedLast(b)) || b.booking_date.localeCompare(a.booking_date));
	const starts: number[] = [];
	let at = 0;
	for (const group of groups) {
		starts.push(at);
		if (!folded.has(group.id)) at += group.count;
	}
	return { groups, rows, starts, folded };
}

/**
 * Headers of the page showing rows [from, to): a category starting on the page gets its header
 * before its first row, one continued from an earlier page gets it again before the page's first
 * row, and a folded one sits where its rows would start (after the last row when it ends the list).
 */
export function pageHeads(layout: CategoryLayout, from: number, to: number): PageHeads {
	const total = layout.rows.length;
	const before: CategoryHead[][] = Array.from({ length: Math.max(0, to - from) }, () => []);
	const after: CategoryHead[] = [];
	layout.groups.forEach((group, i) => {
		const start = layout.starts[i]!;
		const folded = layout.folded.has(group.id);
		const end = folded ? start : start + group.count;
		if (start >= from && start < to) before[start - from]!.push({ group, continued: false, folded });
		else if (start < from && end > from && from < to) before[0]!.push({ group, continued: true, folded });
		else if (start === to && to === total) after.push({ group, continued: false, folded });
	});
	return { before, after };
}

/** Page (from 1) where the header of category `id` starts, `pageSize` rows per page. */
export function headPage(layout: CategoryLayout, id: CategoryId, pageSize: number): number {
	const i = layout.groups.findIndex((group) => group.id === id);
	if (i < 0) return 1;
	const start = layout.starts[i]!;
	const total = layout.rows.length;
	return Math.floor((start === total && total > 0 ? start - 1 : start) / pageSize) + 1;
}

/** Share (0–1) of `spending`, the filtered spending of the page totals, taken by a spending category. */
export function spendingShare(group: CategoryGroup, spending: number): number {
	if (group.kind !== 'expense' || group.net >= 0 || spending <= 0) return 0;
	return Math.min(1, -group.net / spending);
}

/** First and last day (inclusive ISO bounds) of the month `key` (YYYY-MM). */
export function monthBounds(key: string): [string, string] {
	const [y, m] = key.split('-').map(Number);
	const last = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
	return [`${key}-01`, `${key}-${String(last).padStart(2, '0')}`];
}

/** Month (YYYY-MM) a period covers exactly, from its first day to its last; '' for any other period. */
export function rangeMonth(from: string, to: string): string {
	if (!/^\d{4}-(0[1-9]|1[0-2])-01$/.test(from)) return '';
	const key = from.slice(0, 7);
	return monthBounds(key)[1] === to ? key : '';
}

/** Months (YYYY-MM) holding a dated operation, oldest first: a pending row has no month of its own. */
export function monthsWithRows(txs: readonly Transaction[]): string[] {
	return [...new Set(txs.filter((tx) => !isPending(tx)).map((tx) => tx.booking_date.slice(0, 7)))].sort();
}

/**
 * Month the period stepper reaches from `month`: the closest of `months` (oldest first) before it
 * (delta < 0) or after it (delta > 0), so a month without operations is skipped; '' past either end.
 */
export function stepMonth(months: readonly string[], month: string, delta: number): string {
	if (!month || delta === 0) return '';
	return (delta < 0 ? months.findLast((m) => m < month) : months.find((m) => m > month)) ?? '';
}
