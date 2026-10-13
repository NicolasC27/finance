import type { CategoryId, Transaction } from './types';
import { isComputedEntry, isPending, signedAmount } from './data';
import { categorize, type MerchantCategoryMap } from './categories';
import { subcategorize } from './subcategories';
import { cleanLabel, monthKeyOf, normalizeLabelKey } from './format';
import { merchantLabel } from './merchant';
import { isWealthLine } from './scope';
import { monthTotals, monthCutoffDay, lastFlowDate, isBudgetFlow } from './totals';
import { flowKind } from './flow';
import { VARIABLE_SUBS } from './schedule';

/**
 * Forecast engine — pure, testable functions (no state, no DOM).
 *
 * Formulas used (reminders):
 * - Median: middle value of the sorted series (mean of the 2 middle ones when n is even).
 * - Standard deviation (population): σ = √( Σ(xᵢ − x̄)² / n ).
 * - Linear regression (least squares):
 *     slope a = Σ(xᵢ−x̄)(yᵢ−ȳ) / Σ(xᵢ−x̄)²;  intercept b = ȳ − a·x̄
 *     coefficient of determination R² = [ Σ(xᵢ−x̄)(yᵢ−ȳ) / √(Σ(xᵢ−x̄)²·Σ(yᵢ−ȳ)²) ]²
 *   R² > 0.5 → the trend explains more than half of the variance: it is applied.
 */

export type Cadence = 'hebdomadaire' | 'mensuelle' | 'trimestrielle';
export type Confidence = 'haute' | 'moyenne' | 'faible';

export interface RecurringItem {
	/** Grouping key: normalised label (upper case, without variable numbers). */
	key: string;
	/** Readable label: short merchantLabel (SPEC v13 §A), cleanLabel fallback. */
	label: string;
	categoryId: CategoryId;
	/** Subcategory of the last occurrence (null when none). */
	subId: string | null;
	kind: 'credit' | 'debit';
	cadence: Cadence;
	/** Median interval between occurrences, in days. */
	intervalDays: number;
	/** Standard deviation of the intervals (regularity). */
	sigma: number;
	confidence: Confidence;
	/** Expected amount (positive): median, adjusted by regression when R² > 0.5. */
	amount: number;
	/** Raw median of the amounts. */
	medianAmount: number;
	/** Applied slope per period (0 when the trend is not significant). */
	trendPerPeriod: number;
	/** R² of the regression on the amounts. */
	r2: number;
	/** σ of the amounts (basis of the low/high range). */
	amountSigma: number;
	lastDate: string;
	/** Due date expected right after the last occurrence (last + interval), NOT moved forward. */
	expectedDate: string;
	/** Estimated next due date, moved forward up to the reference date. */
	nextDate: string;
	occurrences: number;
	/**
	 * Live recurrence: the expected due date is at most one interval late on the
	 * reference. A subscription cancelled in March is no longer projected in
	 * October (previously « prochaine : 27 oct. » forever).
	 */
	active: boolean;
	/** Share of amounts within ±15 % of the median or the last amount (stable price, one-off increase tolerated). */
	stableShare: number;
	/**
	 * FIXED CHARGE (subscription, direct debit, rent, loan instalment) rather than
	 * a buying habit: regular interval AND (stable amount OR SEPA direct debit),
	 * never a cash withdrawal, weekly cadence only for a direct debit. Saturday
	 * groceries or the corner café no longer show up as « subscriptions » (they
	 * still count in the spending forecasts).
	 */
	fixed: boolean;
	/** Monthly equivalent of the expected amount (monthly = amount; quarterly ÷ 3; weekly × 52/12). */
	monthly: number;
}

/** Direct debit / instalment: labels of recurring payment orders (SEPA, loan, membership fees). */
const DEBIT_ORDER_RE = /^(PRLV|PRELEVEMENT|ECH(EANCE)?\s+PRET|MENSUALITE|F\s+COTIS|COTIS)/;
/** Cash withdrawal: never a subscription, even when regular. */
const CASH_RE = /^RETRAIT\b/;

export interface CategoryForecast {
	categoryId: CategoryId;
	/** Monthly totals of the last 3 months (basis of the computation). */
	monthly: number[];
	/** 3-month moving average. */
	average: number;
	/** Relative trend bounded to ±20 %. */
	trendPct: number;
	/** Forecast = average × (1 + trendPct). */
	expected: number;
	low: number;
	high: number;
}

export interface GlobalForecast {
	days: 30 | 60 | 90;
	expected: number;
	low: number;
	high: number;
}

const DAY_MS = 86_400_000;

/** Date → ISO key "YYYY-MM-DD". */
export function dayIso(d: Date): string {
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** ISO → local Date at noon (avoids time zone issues). */
function parseIso(iso: string): Date {
	return new Date(`${iso}T12:00:00`);
}

/** Today as local ISO (YYYY-MM-DD) — the browser's real date. */
export function todayIso(): string {
	return dayIso(new Date());
}

/**
 * Forecast reference date: max(last booking_date of the dataset, today). A
 * dataset ending before today must no longer anchor due dates in the real
 * past (v8 QA fix); a dataset running into the future keeps its own
 * reference. '' when the dataset is empty.
 */
export function forecastRefIso(lastDatasetIso: string): string {
	if (!lastDatasetIso) return '';
	const today = todayIso();
	return lastDatasetIso > today ? lastDatasetIso : today;
}

/** Whole days between two ISO dates. */
function daysBetween(a: string, b: string): number {
	return Math.round((parseIso(b).getTime() - parseIso(a).getTime()) / DAY_MS);
}

/** Median of a series (sorted copy; 0 when empty). */
export function median(values: number[]): number {
	if (values.length === 0) return 0;
	const s = [...values].sort((a, b) => a - b);
	const mid = s.length >> 1;
	return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Arithmetic mean (0 when empty). */
export function mean(values: number[]): number {
	return values.length === 0 ? 0 : values.reduce((s, v) => s + v, 0) / values.length;
}

/** Population standard deviation: σ = √(Σ(x−x̄)²/n) (0 when n < 2). */
export function stddev(values: number[]): number {
	if (values.length < 2) return 0;
	const m = mean(values);
	return Math.sqrt(values.reduce((s, v) => s + (v - m) ** 2, 0) / values.length);
}

/** Least-squares linear regression on points indexed 0..n-1 (x̄ = (n-1)/2). */
export function linreg(ys: number[]): { slope: number; intercept: number; r2: number } {
	const n = ys.length;
	if (n < 2) return { slope: 0, intercept: ys[0] ?? 0, r2: 0 };
	const xm = (n - 1) / 2;
	const ym = mean(ys);
	let sxy = 0;
	let sxx = 0;
	let syy = 0;
	for (let i = 0; i < n; i++) {
		const dx = i - xm;
		const dy = ys[i]! - ym;
		sxy += dx * dy;
		sxx += dx * dx;
		syy += dy * dy;
	}
	if (sxx === 0) return { slope: 0, intercept: ym, r2: 0 };
	const slope = sxy / sxx;
	const r2 = syy === 0 ? 0 : (sxy * sxy) / (sxx * syy);
	return { slope, intercept: ym - slope * xm, r2 };
}

/**
 * Normalised label for grouping recurrences: direct debit references that
 * change at every instalment (« RMS00000000000000UI », « BF0000000 ») are
 * removed — otherwise each month of the same insurance was a distinct
 * operation and the recurrence never showed up.
 */
const labelCache = new WeakMap<Transaction, string>();

export function normalizeLabel(tx: Transaction): string {
	const hit = labelCache.get(tx);
	if (hit !== undefined) return hit;
	const label = normalizeLabelKey(tx.remittance_information)
		.replace(/\b[A-Z]+\d{5,}[A-Z0-9]*\b/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	labelCache.set(tx, label);
	return label;
}

/** Window a recurrence is judged on: its last 13 months (old prices and pauses no longer count). */
const RECENT_DAYS = 400;

/**
 * Classifies a median interval into a known cadence, ±20 % tolerance:
 * weekly 6-9 d (→ 4.8-10.8), monthly 25-35 d (→ 20-42), quarterly 80-100 d (→ 64-120).
 */
function classifyCadence(interval: number): Cadence | null {
	if (interval >= 4.8 && interval <= 10.8) return 'hebdomadaire';
	if (interval >= 20 && interval <= 42) return 'mensuelle';
	if (interval >= 64 && interval <= 120) return 'trimestrielle';
	return null;
}

/**
 * Detects recurring spending/income:
 * groups of ≥ 3 occurrences over ≥ 2 distinct months, known cadence,
 * confidence from the σ of the intervals (< 2 d = high, < 5 d = medium),
 * amount = median ± trend (regression when R² > 0.5, bounded to ×0.5…×2 of
 * the median so the trend never runs away; next point at x = n).
 * - A group is judged on its last 13 months (when they hold at least 3
 *   occurrences): a 2018 subscription at the old price, or a two-year pause,
 *   no longer distorts regularity.
 * - The median absolute deviation of the intervals is robust: a month missing
 *   from the imports breaks nothing.
 * - Fixed charge vs habit: interval regularity + amount stability (see
 *   RecurringItem.fixed).
 *
 * `refIso` (reference date, e.g. today): when the computed next due date is in
 * the past, it moves forward by steps of the median interval until
 * nextDate ≥ reference — past occurrences no longer count (v8 fix: no more
 * double counting in the 30/60/90 d totals nor due dates shown in the past).
 * Computed entries are left out (portage documents, cash wallet): paid by hand or computed, never a
 * direct debit or a subscription.
 * Sorted by nearest due date first.
 */
export function detectRecurring(
	txs: Transaction[],
	overrides?: Record<string, CategoryId>,
	refIso?: string,
	merchantMap?: MerchantCategoryMap
): RecurringItem[] {
	const groups = new Map<string, Transaction[]>();
	for (const tx of txs) {
		if (isPending(tx) || isComputedEntry(tx)) continue;
		const key = normalizeLabel(tx);
		if (!key) continue;
		const list = groups.get(key);
		if (list) list.push(tx);
		else groups.set(key, [tx]);
	}

	const out: RecurringItem[] = [];
	for (const [key, list] of groups) {
		if (list.length < 3) continue;
		const all = [...list].sort((a, b) => a.booking_date.localeCompare(b.booking_date));
		const lastIso = all[all.length - 1]!.booking_date;
		const recent = all.filter((tx) => daysBetween(tx.booking_date, lastIso) <= RECENT_DAYS);
		const sorted = recent.length >= 3 ? recent : all;
		const months = new Set(sorted.map((tx) => monthKeyOf(tx.booking_date)));
		if (months.size < 2) continue;

		const dates = sorted.map((tx) => tx.booking_date);
		const intervals: number[] = [];
		for (let i = 1; i < dates.length; i++) intervals.push(daysBetween(dates[i - 1]!, dates[i]!));
		const intervalDays = median(intervals);
		const cadence = classifyCadence(intervalDays);
		if (!cadence) continue;
		const sigma = stddev(intervals);
		const confidence: Confidence = sigma < 2 ? 'haute' : sigma < 5 ? 'moyenne' : 'faible';
		const intervalMad = median(intervals.map((d) => Math.abs(d - intervalDays)));

		const amounts = sorted.map((tx) => Math.abs(signedAmount(tx)));
		const medianAmount = median(amounts);
		const reg = linreg(amounts);
		let amount = medianAmount;
		let trendPerPeriod = 0;
		if (reg.r2 > 0.5 && reg.slope !== 0) {
			trendPerPeriod = reg.slope;
			const predicted = reg.intercept + reg.slope * amounts.length;
			amount = Math.min(Math.max(predicted, medianAmount * 0.5), medianAmount * 2);
		}

		const last = sorted[sorted.length - 1]!;
		const expectedMs = parseIso(last.booking_date).getTime() + intervalDays * DAY_MS;
		let nextMs = expectedMs;
		let active = true;
		const lastAmount = amounts[amounts.length - 1]!;
		const near = (a: number, ref: number) => Math.abs(a - ref) <= ref * 0.15;
		const stableShare = amounts.filter((a) => near(a, medianAmount) || near(a, lastAmount)).length / amounts.length;
		const rawLabel = last.remittance_information.join(' ').toUpperCase().trim();
		const debitOrder = DEBIT_ORDER_RE.test(rawLabel);
		const regular = intervalMad <= Math.max(2, intervalDays * 0.1);
		const fixed = !CASH_RE.test(rawLabel) && regular && (stableShare >= 0.75 || debitOrder) && (cadence !== 'hebdomadaire' || debitOrder);
		if (refIso) {
			const refMs = parseIso(refIso).getTime();
			active = (refMs - expectedMs) / DAY_MS <= intervalDays + 3;
			while (nextMs < refMs) nextMs += intervalDays * DAY_MS;
		}
		out.push({
			key,
			label: merchantLabel(last.remittance_information) || cleanLabel(last.remittance_information),
			categoryId: categorize(last, overrides, undefined, merchantMap),
			subId: subcategorize(last, overrides, undefined, merchantMap),
			kind: last.credit_debit_indicator === 'CRDT' ? 'credit' : 'debit',
			cadence,
			intervalDays,
			sigma: Math.round(sigma * 100) / 100,
			confidence,
			amount: Math.round(amount * 100) / 100,
			medianAmount: Math.round(medianAmount * 100) / 100,
			trendPerPeriod: Math.round(trendPerPeriod * 100) / 100,
			r2: Math.round(reg.r2 * 1000) / 1000,
			amountSigma: Math.round(stddev(amounts) * 100) / 100,
			lastDate: last.booking_date,
			expectedDate: dayIso(new Date(expectedMs)),
			nextDate: dayIso(new Date(nextMs)),
			occurrences: all.length,
			active,
			stableShare: Math.round(stableShare * 100) / 100,
			fixed,
			monthly: Math.round((cadence === 'mensuelle' ? amount : cadence === 'trimestrielle' ? amount / 3 : (amount * 52) / 12) * 100) / 100
		});
	}

	return out.sort((a, b) => a.nextDate.localeCompare(b.nextDate));
}

/**
 * Forecast per category: average of the last 3 COMPLETE calendar months (a
 * month without spending = 0, not skipped; the partial current month used to
 * drag the trend down, e.g. housing forecast at about half its real value
 * early in the month), adjusted by the trend (slope of the 3 points, bounded
 * to ±20 % of the average — only with 3 months, since 2 points always give a
 * ±20 % « trend » at the slightest gap), range ± 1 σ. Spending net of refunds,
 * excluding wealth and transfers (same convention as totals.ts).
 */
export function forecastByCategory(
	txs: Transaction[],
	overrides?: Record<string, CategoryId>,
	merchantMap?: MerchantCategoryMap,
	today = todayIso()
): CategoryForecast[] {
	const flows = txs.filter(isBudgetFlow);
	const lastIso = lastFlowDate(flows);
	if (!lastIso) return [];
	let m = lastIso.slice(0, 7);
	if (monthCutoffDay(m, lastIso, today) !== null) m = shiftMonth(m, -1);
	const last3 = [shiftMonth(m, -2), shiftMonth(m, -1), m];
	const firstMonth = flows.reduce((min, tx) => (tx.booking_date < min ? tx.booking_date : min), lastIso).slice(0, 7);
	const months = last3.filter((k) => k >= firstMonth);
	if (months.length === 0) return [];
	const catOf = (tx: Transaction) => categorize(tx, overrides, undefined, merchantMap);
	const perMonth = months.map((k) => monthTotals(flows, k, catOf).byCategory);

	const catIds = new Set<CategoryId>();
	for (const map of perMonth) for (const id of map.keys()) catIds.add(id);

	const out: CategoryForecast[] = [];
	for (const id of catIds) {
		const monthly = perMonth.map((map) => map.get(id) ?? 0);
		const average = mean(monthly);
		if (average <= 0) continue;
		const reg = monthly.length >= 3 ? linreg(monthly) : { slope: 0 };
		const trendPct = Math.max(-0.2, Math.min(0.2, reg.slope / average));
		const expected = average * (1 + trendPct);
		const sigma = stddev(monthly);
		out.push({
			categoryId: id,
			monthly: monthly.map((v) => Math.round(v * 100) / 100),
			average: Math.round(average * 100) / 100,
			trendPct: Math.round(trendPct * 1000) / 1000,
			expected: Math.round(expected * 100) / 100,
			low: Math.round(Math.max(0, expected - sigma) * 100) / 100,
			high: Math.round((expected + sigma) * 100) / 100
		});
	}
	return out.sort((a, b) => b.expected - a.expected);
}

/** "YYYY-MM" shifted by `delta` months. */
function shiftMonth(monthKey: string, delta: number): string {
	const [y, mo] = monthKey.split('-').map(Number);
	const d = new Date(y!, mo! - 1 + delta, 15);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Expected spending totals over a horizon (30/60/90 d) from `fromIso`:
 * - detected recurrences: expected amount × number of due dates in the window;
 *   only live ones (a stopped direct debit no longer counts), and stopped ones
 *   ALSO leave the variable spending average below;
 * - non-recurring: daily average of the last 90 days OF DATA × horizon — the
 *   window ends at the last known operation, not today, so a 2-month-old
 *   import no longer divides the daily average by 3.
 * Range: ± 1 σ (recurrence amounts and non-recurring monthly totals), with
 * σ over the horizon = σ_month × √(days/30) (aggregation of independent gaps).
 */
export function forecastTotals(
	txs: Transaction[],
	overrides: Record<string, CategoryId> | undefined,
	fromIso: string,
	days: 30 | 60 | 90,
	merchantMap?: MerchantCategoryMap
): GlobalForecast {
	const allRecurring = detectRecurring(txs, overrides, fromIso, merchantMap).filter((r) => r.kind === 'debit' && r.fixed && flowKind(r.categoryId) === 'expense' && !VARIABLE_SUBS.has(r.subId ?? ''));
	const recurring = allRecurring.filter((r) => r.active);
	const end = parseIso(fromIso).getTime() + days * DAY_MS;

	let recExpected = 0;
	let recLow = 0;
	let recHigh = 0;
	for (const r of recurring) {
		let count = 0;
		for (let t = parseIso(r.nextDate).getTime(); t <= end; t += r.intervalDays * DAY_MS) count++;
		if (count === 0) continue;
		recExpected += r.amount * count;
		recLow += Math.max(0, r.amount - r.amountSigma) * count;
		recHigh += (r.amount + r.amountSigma) * count;
	}

	const recKeys = new Set(allRecurring.map((r) => r.key));
	const lastData = lastFlowDate(txs);
	let lastMonth = (lastData && lastData < fromIso ? lastData : fromIso).slice(0, 7);
	if (lastData && monthCutoffDay(lastMonth, lastData, fromIso) !== null) lastMonth = shiftMonth(lastMonth, -1);
	const firstMonth = txs.filter(isBudgetFlow).reduce((min, tx) => (tx.booking_date < min ? tx.booking_date : min), '9999').slice(0, 7);
	const months = [shiftMonth(lastMonth, -2), shiftMonth(lastMonth, -1), lastMonth].filter((m) => m >= firstMonth);
	const nonRecByMonth = new Map<string, number>(months.map((m) => [m, 0]));
	let seen = false;
	for (const tx of txs) {
		if (isPending(tx) || isWealthLine(tx) || !isBudgetFlow(tx)) continue;
		const mk = monthKeyOf(tx.booking_date);
		if (!nonRecByMonth.has(mk) || recKeys.has(normalizeLabel(tx))) continue;
		if (flowKind(categorize(tx, overrides, undefined, merchantMap)) !== 'expense') continue;
		const spend = -signedAmount(tx);
		seen = true;
		nonRecByMonth.set(mk, (nonRecByMonth.get(mk) ?? 0) + spend);
	}
	const monthly = [...nonRecByMonth.values()];
	const otherMonth = seen ? median(monthly) : 0;
	const otherExpected = Math.max(0, otherMonth) * (days / 30.4);
	const monthSigma = seen ? stddev(monthly) : 0;
	const otherSigma = monthSigma * Math.sqrt(days / 30.4);

	const expected = recExpected + otherExpected;
	const low = recLow + Math.max(0, otherExpected - otherSigma);
	const high = recHigh + otherExpected + otherSigma;
	return {
		days,
		expected: Math.round(expected * 100) / 100,
		low: Math.round(Math.max(0, low) * 100) / 100,
		high: Math.round(high * 100) / 100
	};
}

/**
 * Average daily net flow over `days` rolling days ending at `endIso` (single
 * source for the BalanceChart projection AND the forecasts).
 */
export function avgDailyNet(txs: Transaction[], endIso: string, days = 90): number {
	const startIso = dayIso(new Date(parseIso(endIso).getTime() - (days - 1) * DAY_MS));
	let net = 0;
	for (const tx of txs) {
		if (isPending(tx)) continue;
		if (tx.booking_date >= startIso && tx.booking_date <= endIso) net += signedAmount(tx);
	}
	return net / days;
}

/** Displayed label of a confidence level (« haute » alone didn't say high what). */
export function confidenceLabel(confidence: Confidence): string {
	return confidence === 'haute' ? 'fiable' : confidence === 'moyenne' ? 'probable' : 'incertaine';
}

/** Inline style of the confidence badge: high teal / medium neutral / low amber. */
export function confidenceStyle(confidence: Confidence): string {
	if (confidence === 'haute') return 'background-color: var(--accent-soft); color: var(--accent);';
	if (confidence === 'faible') return 'background-color: var(--amber-soft); color: var(--amber);';
	return 'background-color: var(--surface-hover); color: var(--text-secondary);';
}
