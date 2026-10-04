import type { CategoryId } from './types';

/**
 * Nature of a category in totals (pure module, no dependency):
 * - 'income'   : income (signed amount: a reversed cheque counts negative);
 * - 'expense'  : spending (a credit there is a refund, deducted from the envelope);
 * - 'transfer' : outside flows — savings and transfers between one's own
 *   accounts, neither spending nor income (excluded from totals and the
 *   savings rate).
 */
export type FlowKind = 'income' | 'expense' | 'transfer';

export function flowKind(id: CategoryId): FlowKind {
	if (id === 'revenus') return 'income';
	if (id === 'epargne') return 'transfer';
	return 'expense';
}

/** Spending category (Budget envelopes, donut, forecasts). */
export function isExpenseCategory(id: CategoryId): boolean {
	return flowKind(id) === 'expense';
}
