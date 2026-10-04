import type { CategoryId, Transaction } from './types';
import { signedAmount } from './data';
import { categorize, getCategory, type MerchantCategoryMap } from './categories';
import { cleanLabel, formatDate, formatEUR, monthKeyOf, truncateLabel } from './format';
import { flowKind } from './flow';
import { monthTotals, dailyCumulativeSpend, isBudgetFlow, daysInMonth as monthDays, type CatOf } from './totals';

/**
 * Rule-based insight engine (no AI): pure, testable functions deriving
 * analysis sentences from the current month's transactions vs the previous
 * month.
 */

export type InsightIcon = 'trend' | 'projection' | 'expense' | 'budget';
export type InsightTone = 'teal' | 'amber' | 'neutral';

export interface Insight {
	id: string;
	icon: InsightIcon;
	tone: InsightTone;
	text: string;
}

/** Significance thresholds for a category change. */
const MIN_DELTA_PCT = 15;
const MIN_DELTA_EUR = 30;

/** "YYYY-MM" key shifted by `delta` months; an empty key (no data) is returned unchanged. */
export function shiftMonthKey(monthKey: string, delta: number): string {
	if (!/^\d{4}-\d{2}$/.test(monthKey)) return monthKey;
	const [y, m] = monthKey.split('-').map(Number);
	const d = new Date(y!, m! - 1 + delta, 15);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Number of days of a "YYYY-MM" month (0 when there is no data). */
export const daysInMonth = monthDays;

/** Resolved category (overrides, rules, vacations, cross learning). */
function catOfFor(overrides: Record<string, CategoryId>, merchantMap?: MerchantCategoryMap): CatOf {
	return (tx) => categorize(tx, overrides, undefined, merchantMap);
}

/**
 * Net spending of the month per category (refunds deducted, wealth and
 * transfers excluded — totals.ts). `upToDay`: "to date" comparison.
 */
export function spendByCategory(
	txs: Transaction[],
	overrides: Record<string, CategoryId>,
	monthKey: string,
	merchantMap?: MerchantCategoryMap,
	upToDay?: number | null
): Map<CategoryId, number> {
	return monthTotals(txs, monthKey, catOfFor(overrides, merchantMap), upToDay).byCategory;
}

export interface CategoryVariation {
	categoryId: CategoryId;
	label: string;
	current: number;
	previous: number;
	/** Change in % (100 = new spending, previous month at 0). */
	deltaPct: number;
	/** Change in € (positive = more spending). */
	deltaEur: number;
}

/**
 * Top spending changes per category vs the previous month: significant ones
 * only (|Δ| ≥ 15 % and ≥ 30 €), sorted by decreasing |Δ €|.
 * Current month (`cutoffDay`): compared with the previous month STOPPED AT THE
 * SAME DAY — before, on Oct 3rd it showed « Logement : −100 % » against the
 * whole of September.
 */
export function categoryVariations(
	txs: Transaction[],
	overrides: Record<string, CategoryId>,
	monthKey: string,
	limit = 2,
	merchantMap?: MerchantCategoryMap,
	cutoffDay?: number | null
): CategoryVariation[] {
	if (!monthKey) return [];
	const current = spendByCategory(txs, overrides, monthKey, merchantMap);
	const previous = spendByCategory(txs, overrides, shiftMonthKey(monthKey, -1), merchantMap, cutoffDay);
	const ids = new Set<CategoryId>([...current.keys(), ...previous.keys()]);
	const out: CategoryVariation[] = [];
	for (const id of ids) {
		const cur = Math.round((current.get(id) ?? 0) * 100) / 100;
		const prev = Math.round((previous.get(id) ?? 0) * 100) / 100;
		const deltaEur = Math.round((cur - prev) * 100) / 100;
		if (Math.abs(deltaEur) < MIN_DELTA_EUR) continue;
		const deltaPct = prev > 0 ? ((cur - prev) / prev) * 100 : 100;
		if (Math.abs(deltaPct) < MIN_DELTA_PCT) continue;
		out.push({
			categoryId: id,
			label: getCategory(id).label,
			current: cur,
			previous: prev,
			deltaPct: Math.round(deltaPct),
			deltaEur
		});
	}
	return out.sort((a, b) => Math.abs(b.deltaEur) - Math.abs(a.deltaEur)).slice(0, limit);
}

export interface BiggestExpense {
	label: string;
	amount: number;
	categoryId: CategoryId;
}

/** Biggest EXPENSE of the month (spending category, excluding wealth/transfers), cleaned label. */
export function biggestExpense(
	txs: Transaction[],
	overrides: Record<string, CategoryId>,
	monthKey: string,
	merchantMap?: MerchantCategoryMap
): BiggestExpense | null {
	let worst: Transaction | null = null;
	let worstCat: CategoryId = 'autre';
	for (const tx of txs) {
		if (!isBudgetFlow(tx) || monthKeyOf(tx.booking_date) !== monthKey) continue;
		if (signedAmount(tx) >= 0) continue;
		if (worst && signedAmount(tx) >= signedAmount(worst)) continue;
		const cat = categorize(tx, overrides, undefined, merchantMap);
		if (flowKind(cat) !== 'expense') continue;
		worst = tx;
		worstCat = cat;
	}
	if (!worst) return null;
	return {
		label: truncateLabel(cleanLabel(worst.remittance_information)),
		amount: -signedAmount(worst),
		categoryId: worstCat
	};
}

/**
 * Remaining budget of the month: budgets minus the month's NET spending (same
 * figure as the Budget page — it used to take all gross outflows and showed a
 * huge overrun while the Budget page showed a small one).
 */
export function budgetRemaining(
	txs: Transaction[],
	budgets: Partial<Record<CategoryId, number>>,
	monthKey: string,
	catOf: CatOf
): { remaining: number; total: number } | null {
	const total = Object.values(budgets).reduce((sum, v) => sum + (v ?? 0), 0);
	if (total <= 0 || !monthKey) return null;
	return { remaining: Math.round((total - monthTotals(txs, monthKey, catOf).expenses) * 100) / 100, total };
}

/**
 * Builds the ordered list of the month's insights: category changes,
 * projection, remaining budget, biggest expense. A spending increase is an
 * alert (amber), a decrease is favourable (teal). The projection is the
 * balance chart's one (real balance + average flow of current accounts), plus
 * a cumulative total from zero.
 */
export function buildInsights(
	txs: Transaction[],
	overrides: Record<string, CategoryId>,
	budgets: Partial<Record<CategoryId, number>>,
	monthKey: string,
	merchantMap?: MerchantCategoryMap,
	opts: {
		/** Current month: cut-off day (comparison with the previous month at the same date). */
		cutoffDay?: number | null;
		/** End-of-month projection of the balance chart (REAL balance of current accounts). */
		projection?: { balance: number; endIso: string } | null;
	} = {}
): Insight[] {
	const out: Insight[] = [];
	const prevLabel = opts.cutoffDay ? `vs le ${opts.cutoffDay} du mois dernier` : 'vs mois dernier';

	for (const v of categoryVariations(txs, overrides, monthKey, 2, merchantMap, opts.cutoffDay)) {
		const sign = v.deltaEur >= 0 ? '+' : '−';
		out.push({
			id: `variation-${v.categoryId}`,
			icon: 'trend',
			tone: v.deltaEur >= 0 ? 'amber' : 'teal',
			text:
				v.previous > 0
					? `${v.label} : ${sign}${Math.abs(v.deltaPct)} % ${prevLabel}`
					: `${v.label} : ${formatEUR(v.current)} ce mois, rien ${opts.cutoffDay ? `au ${opts.cutoffDay} du mois dernier` : 'le mois dernier'}`
		});
	}

	if (opts.projection) {
		out.push({
			id: 'projection',
			icon: 'projection',
			tone: 'neutral',
			text: `Au rythme actuel, solde projeté de ${formatEUR(opts.projection.balance)} le ${formatDate(opts.projection.endIso)}`
		});
	}

	const budget = budgetRemaining(txs, budgets, monthKey, catOfFor(overrides, merchantMap));
	if (budget) {
		out.push({
			id: 'budget',
			icon: 'budget',
			tone: budget.remaining >= 0 ? 'teal' : 'amber',
			text:
				budget.remaining >= 0
					? `Il vous reste ${formatEUR(budget.remaining)} de budget sur ${formatEUR(budget.total)} ce mois`
					: `Budget dépassé de ${formatEUR(-budget.remaining)} ce mois`
		});
	}

	const biggest = biggestExpense(txs, overrides, monthKey, merchantMap);
	if (biggest) {
		out.push({
			id: 'biggest',
			icon: 'expense',
			tone: 'neutral',
			text: `Plus grosse dépense : ${biggest.label} ${formatEUR(biggest.amount)}`
		});
	}

	return out;
}

/**
 * Net spending accumulated day by day over a month (length = days in the
 * month) — the N vs N-1 mini chart, same convention as the totals (totals.ts).
 */
export function dailyCumulativeExpenses(
	txs: Transaction[],
	monthKey: string,
	overrides: Record<string, CategoryId> = {},
	merchantMap?: MerchantCategoryMap
): number[] {
	return dailyCumulativeSpend(txs, monthKey, catOfFor(overrides, merchantMap));
}
