import type { CategoryId, Transaction } from './types';
import { isComputedEntry, isPending, signedAmount } from './data';
import { isWealthLine } from './scope';
import { flowKind } from './flow';

/**
 * Monthly totals: the SINGLE source of income / spending for every page (Dashboard, Budget,
 * Rapport, Insights, Transactions). Pure module.
 *
 * Convention per CATEGORY (not per sign):
 * - income: signed amount (a cheque deposited then reversed cancels out);
 * - spending: −signed amount (a credit in a spending category is a refund, deducted from the
 *   envelope);
 * - outside the flows: pending operations, wealth lines (Kraken/Natixis) and the 'Épargne &
 *   transferts' category.
 * Before the 2026-10-03 review the Rapport counted by sign, so a large reversed cheque made its
 * spending several times higher than the Budget's.
 */

export type CatOf = (tx: Transaction) => CategoryId;

/** Operation counted in the budget flows: confirmed and outside wealth. */
export function isBudgetFlow(tx: Transaction): boolean {
	return !isPending(tx) && !isWealthLine(tx);
}

export interface MonthTotals {
	income: number;
	expenses: number;
	net: number;
	/** Net savings / income, in % (null without income). */
	savingsRate: number | null;
	/** Operations counted (income + spending + transfers of the month). */
	count: number;
	/** Net spending per spending category. */
	byCategory: Map<CategoryId, number>;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Day of the month of an ISO date (1-31). */
function dayOf(iso: string): number {
	return Number(iso.slice(8, 10));
}

/**
 * Totals of a 'YYYY-MM' month. `upToDay` caps at that day of the month (inclusive): 'to date'
 * comparison of a current month with the previous one.
 */
export function monthTotals(txs: Transaction[], monthKey: string, catOf: CatOf, upToDay?: number | null): MonthTotals {
	let income = 0;
	let expenses = 0;
	let count = 0;
	const byCategory = new Map<CategoryId, number>();
	for (const tx of txs) {
		if (!isBudgetFlow(tx) || tx.booking_date.slice(0, 7) !== monthKey) continue;
		if (upToDay && dayOf(tx.booking_date) > upToDay) continue;
		count++;
		const cat = catOf(tx);
		const kind = flowKind(cat);
		if (kind === 'income') income += signedAmount(tx);
		else if (kind === 'expense') {
			const spend = -signedAmount(tx);
			expenses += spend;
			byCategory.set(cat, (byCategory.get(cat) ?? 0) + spend);
		}
	}
	income = r2(income);
	expenses = r2(expenses);
	for (const [k, v] of byCategory) byCategory.set(k, r2(v));
	return {
		income,
		expenses,
		net: r2(income - expenses),
		savingsRate: income > 0 ? Math.round(((income - expenses) / income) * 1000) / 10 : null,
		count,
		byCategory
	};
}

/** Number of days of a 'YYYY-MM' month (0 for an invalid key). */
export function daysInMonth(monthKey: string): number {
	if (!/^\d{4}-\d{2}$/.test(monthKey)) return 0;
	const [y, m] = monthKey.split('-').map(Number);
	return new Date(y!, m!, 0).getDate();
}

/**
 * Last operation date of the budget scope ('' if none); computed entries (portage dated at the end
 * of the month, a cash spend typed today or ahead) are not bank data dates.
 */
export function lastFlowDate(txs: Transaction[]): string {
	let last = '';
	for (const tx of txs) if (isBudgetFlow(tx) && !isComputedEntry(tx) && tx.booking_date > last) last = tx.booking_date;
	return last;
}

/** Missing days tolerated at the end of a month before calling it incomplete (export of the 30th out of 31: complete). */
const END_OF_MONTH_SLACK = 3;

/**
 * Cut-off day of an INCOMPLETE month, null if it is complete:
 * - current calendar month → today's day;
 * - last month of data that stops clearly before the end of the month (more than 3 missing days)
 *   → last day seen.
 * Used for 'to date' comparisons (3 Oct. against 3 Sept., not against the whole of September) and
 * to exclude the partial month from trends.
 */
export function monthCutoffDay(monthKey: string, lastDataIso: string, todayIso: string): number | null {
	const days = daysInMonth(monthKey);
	if (!days) return null;
	if (monthKey === todayIso.slice(0, 7)) {
		const d = dayOf(todayIso);
		return d < days ? d : null;
	}
	if (lastDataIso && monthKey === lastDataIso.slice(0, 7)) {
		const d = dayOf(lastDataIso);
		return d < days - END_OF_MONTH_SLACK ? d : null;
	}
	return null;
}

/**
 * Cumulative spending day by day for a month (length = days of the month), per-category
 * convention: a refund makes the curve go down.
 */
export function dailyCumulativeSpend(txs: Transaction[], monthKey: string, catOf: CatOf): number[] {
	const days = daysInMonth(monthKey);
	if (!days) return [];
	const byDay = new Array<number>(days).fill(0);
	for (const tx of txs) {
		if (!isBudgetFlow(tx) || tx.booking_date.slice(0, 7) !== monthKey) continue;
		if (flowKind(catOf(tx)) !== 'expense') continue;
		const d = dayOf(tx.booking_date);
		if (d >= 1 && d <= days) byDay[d - 1]! -= signedAmount(tx);
	}
	let runningTotal = 0;
	return byDay.map((v) => r2((runningTotal += v)));
}
