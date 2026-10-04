import type { CategoryId, Transaction } from './types';
import { spendAmount } from './data';
import { getCategory, type MerchantCategoryMap, categorize } from './categories';
import { getSubcategory, subcategorize } from './subcategories';
import { formatEUR, monthKeyOf } from './format';
import { spendByCategory, biggestExpense, shiftMonthKey } from './insights';
import { monthTotals, monthCutoffDay, lastFlowDate, isBudgetFlow, type CatOf } from './totals';
import { todayIso } from './forecast';

/**
 * Monthly report: pure summary function (/rapport page). Generated verdict: teal on a surplus,
 * amber on a deficit (never red).
 */

export interface MonthFlows {
	income: number;
	expenses: number;
	net: number;
	/** Net savings / income, in % (null without income). */
	savingsRate: number | null;
}

export interface ReportCategory {
	categoryId: CategoryId;
	label: string;
	color: string;
	current: number;
	previous: number;
}

/** Report subcategory (v11): amount of the month, previous month, share of spending. */
export interface ReportSubcategory {
	subId: string;
	label: string;
	categoryId: CategoryId;
	current: number;
	previous: number;
	/** Share of the month's spending, in % (1 decimal). */
	share: number;
}

export interface MonthlyReport {
	monthKey: string;
	verdict: { tone: 'teal' | 'amber'; text: string };
	current: MonthFlows;
	previous: MonthFlows | null;
	topCategories: ReportCategory[];
	/** Top 5 subcategories of the month (excluding the 'Autres' bucket), compared with the previous month. */
	topSubcategories: ReportSubcategory[];
	biggest: { label: string; amount: number } | null;
	/** % of budgeted categories kept (spent ≤ budget). */
	budgetRespect: { within: number; total: number } | null;
	/** Income vs the average of the 3 previous months. */
	incomeAvg3: number | null;
	incomeVsAvgPct: number | null;
	/** Incomplete (current) month: cut-off day; the previous month is then compared at the same date. */
	cutoffDay: number | null;
}

/**
 * Flows of a month (in / out / net savings / rate), with the per-CATEGORY convention of
 * totals.ts, the same as the Budget, the donut and Analyse. `upToDay`: cut at that day of the
 * month (comparing a current month).
 */
export function monthFlows(txs: Transaction[], monthKey: string, catOf: CatOf, upToDay?: number | null): MonthFlows {
	const t = monthTotals(txs, monthKey, catOf, upToDay);
	return { income: t.income, expenses: t.expenses, net: t.net, savingsRate: t.savingsRate };
}

/** Spending (positive) of a month aggregated by subcategory ('Autres' bucket excluded). */
function spendBySubForMonth(
	confirmed: Transaction[],
	overrides: Record<string, CategoryId>,
	monthKey: string,
	merchantMap?: MerchantCategoryMap,
	upToDay?: number | null
): Map<string, number> {
	const out = new Map<string, number>();
	for (const tx of confirmed) {
		if (!isBudgetFlow(tx) || monthKeyOf(tx.booking_date) !== monthKey) continue;
		if (upToDay && Number(tx.booking_date.slice(8, 10)) > upToDay) continue;
		const spend = spendAmount(tx, categorize(tx, overrides, undefined, merchantMap));
		if (spend === null) continue;
		const sub = subcategorize(tx, overrides, undefined, merchantMap);
		if (!sub) continue;
		out.set(sub, (out.get(sub) ?? 0) + spend);
	}
	return out;
}

/**
 * Builds the full report of a month, compared with the previous month. For a current month the
 * previous one is cut at the same day, and income is not compared with the average (not all
 * income has arrived yet). Contents: top 3 categories with their previous value, top 5
 * subcategories, budget kept (budgeted categories with spent ≤ budget), income vs the average of
 * the 3 previous months (months present only), generated verdict (surplus teal, deficit amber).
 */
export function buildMonthlyReport(
	txs: Transaction[],
	overrides: Record<string, CategoryId>,
	budgets: Partial<Record<CategoryId, number>>,
	monthKey: string,
	merchantMap?: MerchantCategoryMap,
	today = todayIso()
): MonthlyReport | null {
	if (!monthKey) return null;
	const confirmed = txs.filter(isBudgetFlow);
	const catOf: CatOf = (tx) => categorize(tx, overrides, undefined, merchantMap);
	const cutoffDay = monthCutoffDay(monthKey, lastFlowDate(confirmed), today);
	const current = monthFlows(confirmed, monthKey, catOf);
	const prevKey = shiftMonthKey(monthKey, -1);
	const hasPrev = confirmed.some((tx) => monthKeyOf(tx.booking_date) === prevKey);
	const previous = hasPrev ? monthFlows(confirmed, prevKey, catOf, cutoffDay) : null;

	const cur = spendByCategory(confirmed, overrides, monthKey, merchantMap);
	const prev = spendByCategory(confirmed, overrides, prevKey, merchantMap, cutoffDay);
	const topCategories: ReportCategory[] = [...cur.entries()]
		.filter(([id]) => id !== 'revenus')
		.sort((a, b) => b[1] - a[1])
		.slice(0, 3)
		.map(([id, value]) => {
			const cat = getCategory(id);
			return {
				categoryId: id,
				label: cat.label,
				color: cat.color,
				current: Math.round(value * 100) / 100,
				previous: Math.round((prev.get(id) ?? 0) * 100) / 100
			};
		});

	const biggest = biggestExpense(confirmed, overrides, monthKey, merchantMap);

	const curSubs = spendBySubForMonth(confirmed, overrides, monthKey, merchantMap);
	const prevSubs = spendBySubForMonth(confirmed, overrides, prevKey, merchantMap, cutoffDay);
	const topSubcategories: ReportSubcategory[] = [...curSubs.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, 5)
		.map(([subId, value]) => {
			const sub = getSubcategory(subId);
			return {
				subId,
				label: sub?.label ?? subId,
				categoryId: sub?.categoryId ?? 'autre',
				current: Math.round(value * 100) / 100,
				previous: Math.round((prevSubs.get(subId) ?? 0) * 100) / 100,
				share: current.expenses > 0 ? Math.round((value / current.expenses) * 1000) / 10 : 0
			};
		});

	const budgeted = Object.entries(budgets).filter(([, v]) => (v ?? 0) > 0);
	const budgetRespect =
		budgeted.length > 0
			? {
					within: budgeted.filter(([id, v]) => (cur.get(id as CategoryId) ?? 0) <= (v ?? 0)).length,
					total: budgeted.length
				}
			: null;

	const prevIncomes: number[] = [];
	for (let i = 1; i <= 3; i++) {
		const mk = shiftMonthKey(monthKey, -i);
		if (!confirmed.some((tx) => monthKeyOf(tx.booking_date) === mk)) continue;
		prevIncomes.push(monthFlows(confirmed, mk, catOf).income);
	}
	const incomeAvg3 =
		prevIncomes.length > 0
			? Math.round((prevIncomes.reduce((s, v) => s + v, 0) / prevIncomes.length) * 100) / 100
			: null;
	const incomeVsAvgPct =
		incomeAvg3 !== null && incomeAvg3 > 0 && cutoffDay === null
			? Math.round(((current.income - incomeAvg3) / incomeAvg3) * 1000) / 10
			: null;

	const asOf = cutoffDay ? `Au ${cutoffDay} : ` : '';
	const verdict =
		current.net >= 0
			? {
					tone: 'teal' as const,
					text: `${asOf}${cutoffDay ? 'dans le vert' : 'Mois dans le vert'} de ${formatEUR(current.net)}${
						current.savingsRate !== null ? ` — ${Math.round(current.savingsRate)} % d'épargne sur vos revenus` : ''
					}`
				}
			: {
					tone: 'amber' as const,
					text: cutoffDay
						? `${asOf}sorties supérieures aux entrées de ${formatEUR(-current.net)} (mois en cours : revenus peut-être pas encore arrivés)`
						: `Mois en déficit de ${formatEUR(-current.net)} — les sorties dépassent les entrées, regardez les postes ci-dessous`
				};

	return {
		monthKey,
		verdict,
		current,
		previous,
		topCategories,
		topSubcategories,
		biggest: biggest ? { label: biggest.label, amount: biggest.amount } : null,
		budgetRespect,
		incomeAvg3,
		incomeVsAvgPct,
		cutoffDay
	};
}

/* ---- Editorial summary of the Dashboard (SPEC v12 §4) ---- */

/** Month name alone ('juillet') for the phrase 'qu'en juillet'. */
const monthNameFmt = new Intl.DateTimeFormat('fr-FR', { month: 'long' });

/** '2026-07' → 'juillet' (lower case, fits after 'qu'en'). */
export function monthName(monthKey: string): string {
	const [y, m] = monthKey.split('-').map(Number);
	return monthNameFmt.format(new Date(y!, m! - 1, 15));
}

export interface EditorialSummary {
	/** true = not enough data (< 5 operations) → plain sentence. */
	sober: boolean;
	/** Number of confirmed operations of the month. */
	count: number;
	/** Spending of the month (positive, rounded to the cent). */
	expenses: number;
	/** Change in spending vs the previous month (null without a previous month or with no spending). */
	variation: { pct: number; down: boolean; prevMonthName: string } | null;
	/** Net savings of the month, mentioned only when strictly positive. */
	savings: number | null;
	/** Current month: cut-off day (the change compares with the same day of the previous month). */
	cutoffDay: number | null;
}

/**
 * Summary sentence of the Dashboard summary, computed (SPEC v12 §4):
 * '2 340 € dépensés ce mois — 12 % de moins qu'en juillet ; épargne de 610 €.'
 * Rules: amount spent = spending of the month; change vs the previous month CUT AT THE SAME DAY
 * (accent when lower, --debit when higher, never red); savings mentioned only when net positive
 * and never for a current month (salary not in yet); < 5 operations → plain sentence
 * 'Mois en cours — N opérations.'.
 */
export function buildEditorialSummary(txs: Transaction[], monthKey: string, catOf: CatOf, today = todayIso()): EditorialSummary | null {
	if (!monthKey) return null;
	const confirmed = txs.filter(isBudgetFlow);
	const count = confirmed.filter((tx) => monthKeyOf(tx.booking_date) === monthKey).length;
	const cutoffDay = monthCutoffDay(monthKey, lastFlowDate(confirmed), today);
	if (count < 5) return { sober: true, count, expenses: 0, variation: null, savings: null, cutoffDay };

	const current = monthFlows(confirmed, monthKey, catOf);
	const prevKey = shiftMonthKey(monthKey, -1);
	const hasPrev = confirmed.some((tx) => monthKeyOf(tx.booking_date) === prevKey);
	const previous = hasPrev ? monthFlows(confirmed, prevKey, catOf, cutoffDay) : null;

	const variation =
		previous !== null && previous.expenses > 0
			? {
					pct: Math.round((Math.abs(current.expenses - previous.expenses) / previous.expenses) * 100),
					down: current.expenses <= previous.expenses,
					prevMonthName: monthName(prevKey)
				}
			: null;

	return {
		sober: false,
		count,
		expenses: current.expenses,
		variation,
		savings: current.net > 0 && cutoffDay === null ? current.net : null,
		cutoffDay
	};
}
