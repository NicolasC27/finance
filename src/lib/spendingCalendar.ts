import type { Transaction } from './types';
import { spendAmount } from './data';
import { daysInMonth, isBudgetFlow, type CatOf } from './totals';
import { effectiveDate } from './vacationDate';

/**
 * Spending calendar (pure module, testable with tsx): spending per PURCHASE
 * day and average spending per weekday.
 *
 * Purchase date: DDMM of the card label (« PAIEMENT CB 1809 » = 18/09, see
 * effectiveDate) — the bank books 1 to 5 days later, never on weekends;
 * otherwise the booking date. Spending: same convention as totals.ts
 * (spending category, refunds deducted; excluding pending operations, wealth
 * lines, income and savings).
 */

const r2 = (n: number) => Math.round(n * 100) / 100;
const pad = (n: number) => String(n).padStart(2, '0');
const DAY_MS = 86_400_000;

/** Short day labels, Monday first. */
export const WEEKDAY_LABELS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'] as const;
/** Day names (for sentences), Monday first. */
export const WEEKDAY_NAMES = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'] as const;

/** Purchase date of an operation ('' when pending). */
export function purchaseDate(tx: Transaction): string {
	return effectiveDate(tx);
}

/** Budget spending of an operation (negative: refund), null when it is not spending. */
export function budgetSpend(tx: Transaction, catOf: CatOf): number | null {
	if (!isBudgetFlow(tx)) return null;
	return spendAmount(tx, catOf(tx));
}

function utc(iso: string): number {
	const [y, m, d] = iso.split('-').map(Number);
	return Date.UTC(y!, m! - 1, d!);
}

/** Weekday of an ISO date: Monday = 0 … Sunday = 6 (UTC computation, no time zone). */
export function weekdayOf(iso: string): number {
	return (new Date(utc(iso)).getUTCDay() + 6) % 7;
}

export interface CalendarDay {
	/** YYYY-MM-DD */
	date: string;
	day: number;
	/** Monday = 0 … Sunday = 6 */
	weekday: number;
	/** Net spending of the day (negative: more refunds than purchases). */
	spend: number;
	/** Spending operations that day. */
	count: number;
}

export interface CalendarMonth {
	monthKey: string;
	/** Empty cells before the 1st in a Monday → Sunday grid. */
	leading: number;
	days: CalendarDay[];
	total: number;
	/** Highest daily spending (colour scale), 0 without spending. */
	max: number;
	/** Days with at least one purchase. */
	activeDays: number;
}

/** Spending of month "YYYY-MM", day by day, at the purchase date. */
export function calendarMonth(txs: readonly Transaction[], monthKey: string, catOf: CatOf): CalendarMonth {
	const n = daysInMonth(monthKey);
	const days: CalendarDay[] = [];
	for (let d = 1; d <= n; d++) {
		const date = `${monthKey}-${pad(d)}`;
		days.push({ date, day: d, weekday: weekdayOf(date), spend: 0, count: 0 });
	}
	for (const tx of txs) {
		const date = purchaseDate(tx);
		if (date.slice(0, 7) !== monthKey) continue;
		const spend = budgetSpend(tx, catOf);
		if (spend === null) continue;
		const cell = days[Number(date.slice(8, 10)) - 1];
		if (!cell) continue;
		cell.spend += spend;
		cell.count++;
	}
	let total = 0;
	let max = 0;
	let activeDays = 0;
	for (const cell of days) {
		cell.spend = r2(cell.spend);
		total += cell.spend;
		if (cell.spend > max) max = cell.spend;
		if (cell.count > 0) activeDays++;
	}
	return { monthKey, leading: days[0]?.weekday ?? 0, days, total: r2(total), max, activeDays };
}

/** One spending operation of a purchase-day range (calendar side panel). */
export interface RangePurchase {
	tx: Transaction;
	/** Purchase date (YYYY-MM-DD). */
	date: string;
	/** Budget spending of the operation (negative: refund). */
	spend: number;
}

export interface RangePurchases {
	items: RangePurchase[];
	/** Net spending of the range: the sum of the calendar cells of these days. */
	total: number;
	/** Spending operations in the range. */
	count: number;
}

/**
 * Spending operations bought between `from` and `to` (inclusive, bounds in any order), with the
 * calendar's rules (purchase date, refunds deducted; income, savings, pending and wealth lines
 * left out). Sorted by day, then by amount, largest first.
 */
export function rangePurchases(txs: readonly Transaction[], from: string, to: string, catOf: CatOf): RangePurchases {
	const [start, end] = from <= to ? [from, to] : [to, from];
	const items: RangePurchase[] = [];
	let total = 0;
	for (const tx of txs) {
		const date = purchaseDate(tx);
		if (!date || date < start || date > end) continue;
		const spend = budgetSpend(tx, catOf);
		if (spend === null) continue;
		total += spend;
		items.push({ tx, date, spend: r2(spend) });
	}
	items.sort((a, b) => a.date.localeCompare(b.date) || b.spend - a.spend);
	return { items, total: r2(total), count: items.length };
}

/** First and last "YYYY-MM" month with a purchase (null when none). */
export function purchaseMonthRange(txs: readonly Transaction[], catOf: CatOf): { first: string; last: string } | null {
	let first = '';
	let last = '';
	for (const tx of txs) {
		if (budgetSpend(tx, catOf) === null) continue;
		const month = purchaseDate(tx).slice(0, 7);
		if (!month) continue;
		if (!first || month < first) first = month;
		if (month > last) last = month;
	}
	return first ? { first, last } : null;
}

/** Number of Mondays, Tuesdays… (Monday = index 0) between two ISO dates, inclusive. */
export function countWeekdays(from: string, to: string): number[] {
	const out = new Array<number>(7).fill(0);
	if (!from || !to || from > to) return out;
	const total = Math.round((utc(to) - utc(from)) / DAY_MS) + 1;
	const start = weekdayOf(from);
	for (let i = 0; i < 7; i++) out[i] = Math.floor(total / 7);
	for (let k = 0; k < total % 7; k++) out[(start + k) % 7]!++;
	return out;
}

export interface WeekdayStat {
	weekday: number;
	label: (typeof WEEKDAY_LABELS)[number];
	total: number;
	/** Days of this kind in the period (including days without spending). */
	days: number;
	average: number;
}

/**
 * Average spending per weekday over [from, to] (purchase dates, inclusive):
 * total of the Mondays / number of Mondays in the period, days without
 * spending included. Empty bounds: from the first to the last purchase date of
 * the given operations.
 */
export function weekdayAverages(txs: readonly Transaction[], catOf: CatOf, from = '', to = ''): WeekdayStat[] {
	const totals = new Array<number>(7).fill(0);
	let first = '';
	let last = '';
	for (const tx of txs) {
		const date = purchaseDate(tx);
		if (!date || (from && date < from) || (to && date > to)) continue;
		const spend = budgetSpend(tx, catOf);
		if (spend === null) continue;
		totals[weekdayOf(date)]! += spend;
		if (!first || date < first) first = date;
		if (date > last) last = date;
	}
	const days = countWeekdays(from || first, to || last);
	return WEEKDAY_LABELS.map((label, i) => ({
		weekday: i,
		label,
		total: r2(totals[i]!),
		days: days[i]!,
		average: days[i] ? r2(totals[i]! / days[i]!) : 0
	}));
}
