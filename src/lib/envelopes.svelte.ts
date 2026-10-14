import { categorize } from './categories';
import { budgetState } from './budget.svelte';
import { envelopeGauge, type EnvelopeGauge } from './envelopes';
import { todayIso } from './rangeCalendar';
import { getMerchantCategoryMap } from './store.svelte';
import { monthTotals } from './totals';
import { getBudgetTransactions } from './transfers.svelte';
import type { CategoryId, Transaction } from './types';

/** Month whose envelopes the marks show: the current one, checked every minute (a tab left open across the 1st moves on). */
let currentMonth = $state(todayIso().slice(0, 7));
if (typeof window !== 'undefined') {
	setInterval(() => {
		const month = todayIso().slice(0, 7);
		if (month !== currentMonth) currentMonth = month;
	}, 60_000);
}

/** The current month ('YYYY-MM'). */
export function getCurrentMonth(): string {
	return currentMonth;
}

const spentThisMonth = $derived(
	monthTotals(getBudgetTransactions(), currentMonth, (tx: Transaction): CategoryId => categorize(tx, budgetState.overrides, undefined, getMerchantCategoryMap())).byCategory
);

/**
 * Envelope gauge of a category for an operation of `month`: only the current month has a gauge
 * (an old operation does not say how this month is going), and only a category with a budget.
 */
export function envelopeUse(id: CategoryId, month: string | undefined): EnvelopeGauge | null {
	if (month !== currentMonth) return null;
	return envelopeGauge(spentThisMonth.get(id) ?? 0, budgetState.budgets[id]);
}

/** Spending per category of the current month (the « depuis ta dernière visite » snapshot reads it too). */
export function getSpentThisMonth(): ReadonlyMap<CategoryId, number> {
	return spentThisMonth;
}
