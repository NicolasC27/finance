/**
 * Pure layouts of the spending charts (testable outside the browser): the daily spending calendar
 * (heatmap), the month waterfall from income to savings, and the monthly trend of each envelope.
 */

export interface DayTotal {
	amount: number;
	/** Spending per merchant label that day. */
	merchants: Map<string, number>;
}

export interface CalendarCell {
	date: string;
	/** Week column (0 = oldest) and weekday row (0 = Monday … 6 = Sunday). */
	col: number;
	row: number;
	amount: number;
	/** 0 = nothing spent, 1..4 = quartile-like intensity. */
	level: 0 | 1 | 2 | 3 | 4;
	/** Top 3 merchants of the day. */
	top: { label: string; amount: number }[];
}

export interface SpendingCalendar {
	cells: CalendarCell[];
	weeks: number;
	/** First column of each month (label 'janv.', 'févr.'…). */
	months: { col: number; key: string }[];
	/** Upper bounds of levels 1..3 (level 4 above the last). */
	thresholds: [number, number, number];
	/** Average spending per weekday (Monday first) over days with data. */
	byWeekday: number[];
	total: number;
	/** Days without spending in the range (up to the end date). */
	emptyDays: number;
}

const DAY = 86_400_000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const utc = (d: string) => Date.parse(`${d}T00:00:00Z`);

/** Value at quantile `q` (0..1) of sorted values, linear interpolation. */
function quantile(sorted: readonly number[], q: number): number {
	if (!sorted.length) return 0;
	const pos = (sorted.length - 1) * q;
	const lo = Math.floor(pos);
	const hi = Math.ceil(pos);
	return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

/** Intensity level of an amount against the thresholds. */
export function levelOf(amount: number, thresholds: readonly [number, number, number]): 0 | 1 | 2 | 3 | 4 {
	if (amount <= 0) return 0;
	if (amount <= thresholds[0]) return 1;
	if (amount <= thresholds[1]) return 2;
	if (amount <= thresholds[2]) return 3;
	return 4;
}

/**
 * Calendar of the `weeks` weeks ending on `end` (AAAA-MM-JJ), Monday-first columns. Levels split the
 * spending days at the 40th, 70th and 90th percentiles, so one huge day does not wash out the rest.
 */
export function buildCalendar(days: ReadonlyMap<string, DayTotal>, end: string, weeks = 53): SpendingCalendar {
	const endT = utc(end);
	const weekday = (new Date(endT).getUTCDay() + 6) % 7;
	const startT = endT - weekday * DAY - (weeks - 1) * 7 * DAY;
	const amounts = [...days.entries()].filter(([d, v]) => utc(d) >= startT && utc(d) <= endT && v.amount > 0).map(([, v]) => v.amount).sort((a, b) => a - b);
	const thresholds: [number, number, number] = [quantile(amounts, 0.4), quantile(amounts, 0.7), quantile(amounts, 0.9)];
	const cells: CalendarCell[] = [];
	const months: { col: number; key: string }[] = [];
	const sums = new Array<number>(7).fill(0);
	const counts = new Array<number>(7).fill(0);
	let total = 0;
	let emptyDays = 0;
	for (let t = startT; t <= endT; t += DAY) {
		const date = iso(t);
		const col = Math.floor((t - startT) / (7 * DAY));
		const row = Math.round((t - startT) / DAY) % 7;
		const d = days.get(date);
		const amount = Math.max(0, Math.round((d?.amount ?? 0) * 100) / 100);
		const top = d ? [...d.merchants.entries()].filter(([, a]) => a > 0).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([label, a]) => ({ label, amount: Math.round(a * 100) / 100 })) : [];
		cells.push({ date, col, row, amount, level: levelOf(amount, thresholds), top });
		if (date.endsWith('-01') || t === startT) {
			if (!months.length || months[months.length - 1]!.col !== col) months.push({ col, key: date.slice(0, 7) });
			else months[months.length - 1] = { col, key: date.slice(0, 7) };
		}
		total += amount;
		if (amount === 0) emptyDays++;
		sums[row]! += amount;
		counts[row]!++;
	}
	return {
		cells,
		weeks,
		months: months.filter((m, i) => i === 0 || m.col - months[i - 1]!.col >= 2),
		thresholds,
		byWeekday: sums.map((s, i) => (counts[i] ? Math.round(s / counts[i]!) : 0)),
		total: Math.round(total * 100) / 100,
		emptyDays
	};
}

export interface WaterfallItem {
	id: string;
	label: string;
	amount: number;
	color?: string;
}

export interface WaterfallStep {
	id: string;
	label: string;
	kind: 'income' | 'expense' | 'result';
	/** Running total before and after the step (the bar spans both). */
	from: number;
	to: number;
	amount: number;
	color?: string;
}

/**
 * Month waterfall: income, then each expense (largest first, the tail folded into « Autres » beyond
 * `maxSteps`), then what is left (savings, negative when overspent).
 */
export function waterfallSteps(income: number, expenses: readonly WaterfallItem[], maxSteps = 6): WaterfallStep[] {
	const sorted = expenses.filter((e) => e.amount > 0).sort((a, b) => b.amount - a.amount);
	const shown = sorted.length > maxSteps ? sorted.slice(0, maxSteps - 1) : sorted;
	const rest = sorted.length > maxSteps ? sorted.slice(maxSteps - 1).reduce((s, e) => s + e.amount, 0) : 0;
	const items = rest > 0 ? [...shown, { id: 'autres', label: 'Autres', amount: rest }] : shown;
	const steps: WaterfallStep[] = [{ id: 'income', label: 'Revenus', kind: 'income', from: 0, to: income, amount: income }];
	let run = income;
	for (const e of items) {
		steps.push({ id: e.id, label: e.label, kind: 'expense', from: run, to: run - e.amount, amount: e.amount, ...(e.color ? { color: e.color } : {}) });
		run -= e.amount;
	}
	steps.push({ id: 'result', label: run >= 0 ? 'Épargne' : 'Dépassement', kind: 'result', from: 0, to: run, amount: run });
	return steps.map((s) => ({ ...s, from: Math.round(s.from * 100) / 100, to: Math.round(s.to * 100) / 100, amount: Math.round(s.amount * 100) / 100 }));
}

/** The `n` month keys ending with `month` (AAAA-MM), oldest first. */
export function monthsEndingAt(month: string, n: number): string[] {
	const [y, m] = month.split('-').map(Number) as [number, number];
	return Array.from({ length: n }, (_, i) => {
		const d = new Date(Date.UTC(y, m - 1 - (n - 1 - i), 15));
		return d.toISOString().slice(0, 7);
	});
}
