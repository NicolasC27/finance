import type { CategoryId, Transaction } from './types';
import { isPending, signedAmount, spendAmount } from './data';
import { monthKeyOf } from './format';
import { flowKind } from './flow';
import { isWealthLine, KRAKEN_RE } from './scope';
import { isBudgetFlow } from './totals';

/**
 * Monthly analysis (Analyse page) — pure engine, testable outside the browser.
 *
 * For each calendar month between the first and last observed month (empty
 * months included, so curves don't « jump »):
 * - net spending per category and subcategory (refunds deducted, same
 *   convention as the Budget: spendAmount);
 * - income (« revenus » category, signed: a reversed cheque counts negative);
 * - savings = income − spending, savings rate = savings / income;
 * - invested savings = bank transfers to Kraken (debits), which are not
 *   spending but money put aside elsewhere.
 *
 * Kraken/Natixis lines (wealth) are ignored: they are value movements, not
 * cash flows.
 */

export interface MonthlyAnalytics {
	/** « YYYY-MM » months, ascending and contiguous. */
	months: string[];
	/** Net spending per category (index aligned with `months`). */
	byCategory: Partial<Record<CategoryId, number[]>>;
	/** Net spending per subcategory. */
	bySub: Record<string, number[]>;
	income: number[];
	expenses: number[];
	savings: number[];
	/** In %, null when there is no income that month. */
	savingsRate: (number | null)[];
	/** Transfers to Kraken (invested savings), positive. */
	invested: number[];
}

/** Contiguous list of months between two keys, inclusive. */
export function monthRange(first: string, last: string): string[] {
	const out: string[] = [];
	let [y, m] = first.split('-').map(Number) as [number, number];
	const [ly, lm] = last.split('-').map(Number) as [number, number];
	while (y < ly || (y === ly && m <= lm)) {
		out.push(`${y}-${String(m).padStart(2, '0')}`);
		m++;
		if (m > 12) {
			m = 1;
			y++;
		}
	}
	return out;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Same scope as every total (totals.ts): transfers to oneself and savings go
 * out through their « Épargne & transferts » category (flowKind 'transfer');
 * income is signed, transfers are neither income nor spending.
 * @param budgetTxs budget operations (internal transfers and hidden ones already excluded)
 * @param allTxs    every operation (to spot transfers to Kraken, excluded from the budget)
 * @param catOf     resolved category (overrides, rules, vacations…)
 * @param subOf     resolved subcategory (null = none)
 * @param lastMonths keep only the last N months (undefined = all)
 */
export function monthlyAnalytics(
	budgetTxs: Transaction[],
	allTxs: Transaction[],
	catOf: (tx: Transaction) => CategoryId,
	subOf: (tx: Transaction) => string | null,
	lastMonths?: number
): MonthlyAnalytics {
	const flows = budgetTxs.filter(isBudgetFlow);
	const keys = flows.map((tx) => monthKeyOf(tx.booking_date)).sort();
	if (keys.length === 0) {
		return { months: [], byCategory: {}, bySub: {}, income: [], expenses: [], savings: [], savingsRate: [], invested: [] };
	}
	let months = monthRange(keys[0]!, keys[keys.length - 1]!);
	if (lastMonths && months.length > lastMonths) months = months.slice(-lastMonths);
	const idx = new Map(months.map((m, i) => [m, i]));
	const zeros = () => months.map(() => 0);

	const byCategory: Partial<Record<CategoryId, number[]>> = {};
	const bySub: Record<string, number[]> = {};
	const income = zeros();
	const expenses = zeros();
	const invested = zeros();

	for (const tx of flows) {
		const i = idx.get(monthKeyOf(tx.booking_date));
		if (i === undefined) continue;
		const cat = catOf(tx);
		const sp = spendAmount(tx, cat);
		if (sp === null) {
			if (flowKind(cat) === 'income') income[i]! += signedAmount(tx);
			continue;
		}
		(byCategory[cat] ??= zeros())[i]! += sp;
		expenses[i]! += sp;
		const sub = subOf(tx);
		if (sub) (bySub[sub] ??= zeros())[i]! += sp;
	}

	for (const tx of allTxs) {
		if (isPending(tx) || isWealthLine(tx) || tx.credit_debit_indicator !== 'DBIT') continue;
		if (!KRAKEN_RE.test(tx.remittance_information.join(' '))) continue;
		const i = idx.get(monthKeyOf(tx.booking_date));
		if (i !== undefined) invested[i]! += Math.abs(signedAmount(tx));
	}

	for (const arr of [income, expenses, invested, ...Object.values(byCategory), ...Object.values(bySub)]) {
		for (let i = 0; i < arr.length; i++) arr[i] = r2(arr[i]!);
	}
	const savings = months.map((_, i) => r2(income[i]! - expenses[i]!));
	const savingsRate = months.map((_, i) => (income[i]! > 0 ? Math.round((savings[i]! / income[i]!) * 1000) / 10 : null));
	return { months, byCategory, bySub, income, expenses, savings, savingsRate, invested };
}

/** Moving average over the last n points (n = 3: light smoothing). */
export function movingAverage(values: number[], n = 3): number[] {
	return values.map((_, i) => {
		const from = Math.max(0, i - n + 1);
		const slice = values.slice(from, i + 1);
		return r2(slice.reduce((a, b) => a + b, 0) / slice.length);
	});
}

/** Change in % (null when the base is zero). */
export function pctChange(current: number, previous: number): number | null {
	if (previous === 0) return null;
	return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}

export interface SeriesStats {
	mean: number;
	total: number;
	best: { index: number; value: number } | null;
	worst: { index: number; value: number } | null;
}

/** Mean, total, best and worst month of a series (null when empty). */
export function seriesStats(values: number[]): SeriesStats {
	if (values.length === 0) return { mean: 0, total: 0, best: null, worst: null };
	let best = 0;
	let worst = 0;
	let total = 0;
	values.forEach((v, i) => {
		total += v;
		if (v > values[best]!) best = i;
		if (v < values[worst]!) worst = i;
	});
	return { mean: r2(total / values.length), total: r2(total), best: { index: best, value: values[best]! }, worst: { index: worst, value: values[worst]! } };
}
