import type { CategoryId, Transaction } from './types';
import { isPending, signedAmount, spendAmount } from './data';
import { categorize, getCategory, type MerchantCategoryMap } from './categories';
import { monthKeyOf } from './format';
import { detectRecurring, median, forecastRefIso } from './forecast';

/**
 * Envelope advice — pure, testable functions.
 * 50/30/20 rule (needs/wants/savings), recalibrated when housing takes more
 * than 35 % of income; targets rounded to 10 €.
 */

/** « Needs » (50 %) and « wants » (30 %) categories of the rule. */
const NEEDS: CategoryId[] = ['logement', 'energie', 'alimentation', 'transport', 'voiture', 'sante'];
const WANTS: CategoryId[] = ['loisirs', 'abonnements'];

export interface CategoryAdvice {
	categoryId: CategoryId;
	label: string;
	/** Advised target budget (rounded to 10 €). */
	target: number;
	/** Current budget (0 when unset). */
	current: number;
	/** Gap between current budget and target, in % of the target. */
	deltaPct: number;
	/** teal when the gap is ≤ 15 %, amber when the budget exceeds the target by more than 15 %. */
	tone: 'teal' | 'amber';
	/** Real average monthly spending over the analysed period. */
	actual: number;
}

export interface AdvisorResult {
	/** Reference monthly income (detected salary or median of credits). */
	salary: number;
	salarySource: 'recurring' | 'median';
	/** Analysed months (last 3 complete months, "YYYY-MM" keys). */
	months: string[];
	/** Shares of the rule (after any recalibration). */
	reference: { needs: number; wants: number; savings: number };
	/** true when rent > 35 % of income forced a recalibration. */
	calibrated: boolean;
	/** Real share of housing in income. */
	rentShare: number;
	advice: CategoryAdvice[];
	/** TARGET savings of the rule (« savings » share × salary, €/month, rounded to 10 €) — a target, not a measure. */
	savingsCapacity: number;
	/** Reachable example goal (prefilled creation link). */
	goalSuggestion: { name: string; amount: number; months: number } | null;
}

/** Rounds to the nearest ten euros. */
function round10(v: number): number {
	return Math.round(v / 10) * 10;
}

/**
 * « Complete » months to analyse: months present in the data, minus the most
 * recent one when it stops before the 25th (current month).
 */
function completeMonths(txs: Transaction[]): string[] {
	const byMonth = new Map<string, number>();
	for (const tx of txs) {
		if (isPending(tx)) continue;
		const mk = monthKeyOf(tx.booking_date);
		byMonth.set(mk, Math.max(byMonth.get(mk) ?? 0, Number(tx.booking_date.slice(8, 10))));
	}
	const months = [...byMonth.keys()].sort();
	const last = months[months.length - 1];
	const usable = last && (byMonth.get(last) ?? 0) < 25 ? months.slice(0, -1) : months;
	return usable.slice(-3);
}

/**
 * Reference monthly salary: the biggest ACTIVE monthly recurring credit
 * (forecast detection; a salary from a former employer no longer counts);
 * otherwise the median of monthly credit totals. 0 without usable data.
 */
export function detectSalary(txs: Transaction[], overrides?: Record<string, CategoryId>, merchantMap?: MerchantCategoryMap): { amount: number; source: 'recurring' | 'median' } {
	const lastIso = txs.reduce((m, tx) => (!isPending(tx) && tx.booking_date > m ? tx.booking_date : m), '');
	const recurring = detectRecurring(txs, overrides, forecastRefIso(lastIso) || undefined, merchantMap).filter(
		(r) => r.kind === 'credit' && r.cadence === 'mensuelle' && r.active && r.categoryId === 'revenus'
	);
	if (recurring.length > 0) {
		const biggest = recurring.reduce((a, b) => (b.medianAmount > a.medianAmount ? b : a));
		return { amount: biggest.medianAmount, source: 'recurring' };
	}
	const byMonth = new Map<string, number>();
	for (const tx of txs) {
		if (isPending(tx)) continue;
		const amount = signedAmount(tx);
		if (amount <= 0) continue;
		const mk = monthKeyOf(tx.booking_date);
		byMonth.set(mk, (byMonth.get(mk) ?? 0) + amount);
	}
	const monthly = [...byMonth.values()];
	if (monthly.length === 0) return { amount: 0, source: 'median' };
	return { amount: Math.round(median(monthly) * 100) / 100, source: 'median' };
}

/**
 * Spending habits + recalibrated rule:
 * - real monthly average of each category over the last 3 complete months;
 * - 50/30/20, unless housing > 35 % of income: needs raised to
 *   (housing share + 25 %), wants 25 %, savings = the rest (≥ 10 %), and the
 *   result says so (`calibrated`);
 * - each category's target = its group's budget split pro rata of the group's
 *   real habits, rounded to 10 €;
 * - « Impôts » and « Autre » are not judged: target = real habit, rounded.
 */
export function buildAdvice(
	txs: Transaction[],
	overrides: Record<string, CategoryId>,
	budgets: Partial<Record<CategoryId, number>>,
	merchantMap?: MerchantCategoryMap
): AdvisorResult | null {
	const months = completeMonths(txs);
	if (months.length === 0) return null;
	const { amount: salary, source } = detectSalary(txs, overrides, merchantMap);
	if (salary <= 0) return null;

	const totals = new Map<CategoryId, number>();
	for (const tx of txs) {
		if (isPending(tx) || !months.includes(monthKeyOf(tx.booking_date))) continue;
		const id = categorize(tx, overrides, undefined, merchantMap);
		const spend = spendAmount(tx, id);
		if (spend === null) continue;
		totals.set(id, (totals.get(id) ?? 0) + spend);
	}
	const actual = new Map<CategoryId, number>();
	for (const [id, total] of totals) actual.set(id, total / months.length);

	const rentShare = (actual.get('logement') ?? 0) / salary;
	let reference = { needs: 0.5, wants: 0.3, savings: 0.2 };
	let calibrated = false;
	if (rentShare > 0.35) {
		calibrated = true;
		const needs = Math.min(0.75, rentShare + 0.25);
		const wants = 0.25;
		reference = { needs, wants, savings: Math.max(0.1, 1 - needs - wants) };
	}

	function groupTargets(ids: CategoryId[], share: number): Map<CategoryId, number> {
		const budget = salary * share;
		const sum = ids.reduce((s, id) => s + (actual.get(id) ?? 0), 0);
		const out = new Map<CategoryId, number>();
		for (const id of ids) {
			const weight = sum > 0 ? (actual.get(id) ?? 0) / sum : 1 / ids.length;
			out.set(id, round10(budget * weight));
		}
		return out;
	}

	const targets = new Map<CategoryId, number>([
		...groupTargets(NEEDS, reference.needs),
		...groupTargets(WANTS, reference.wants)
	]);
	targets.set('impots', round10(actual.get('impots') ?? 0));
	targets.set('autre', round10(actual.get('autre') ?? 0));

	const advice: CategoryAdvice[] = [...NEEDS, ...WANTS, 'impots' as CategoryId, 'autre' as CategoryId].map((id) => {
		const target = targets.get(id) ?? 0;
		const current = budgets[id] ?? 0;
		const deltaPct = target > 0 ? ((current - target) / target) * 100 : 0;
		return {
			categoryId: id,
			label: getCategory(id).label,
			target,
			current,
			deltaPct: Math.round(deltaPct),
			tone: deltaPct > 15 ? 'amber' : 'teal',
			actual: Math.round((actual.get(id) ?? 0) * 100) / 100
		};
	});

	const savingsCapacity = Math.max(0, round10(salary * reference.savings));
	const goalAmount = 2000;
	const goalSuggestion =
		savingsCapacity > 0
			? { name: 'Vacances', amount: goalAmount, months: Math.max(1, Math.ceil(goalAmount / savingsCapacity)) }
			: null;

	return {
		salary,
		salarySource: source,
		months,
		reference,
		calibrated,
		rentShare: Math.round(rentShare * 1000) / 1000,
		advice,
		savingsCapacity,
		goalSuggestion
	};
}
