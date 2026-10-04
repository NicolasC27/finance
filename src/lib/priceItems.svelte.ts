import type { CategoryId } from './types';
import { categorize } from './categories';
import { subcategorize } from './subcategories';
import { budgetState } from './budget.svelte';
import { getMerchantCategoryMap } from './store.svelte';
import { getBudgetTransactions } from './transfers.svelte';
import { isBudgetFlow } from './totals';
import { flowKind } from './flow';
import { signedAmount } from './data';
import { priceItemOf, type PriceItem } from './personalInflation';

/**
 * Spending per month, category and INSEE spending group (reactive): base of the personal
 * inflation (Analyse page) and of the per-group indexation of envelopes (Budget page). Same
 * scope as the budget totals; loans, vehicle purchase, loans to relatives and taxes excluded.
 */

export interface PriceItemSpend {
	mois: string;
	categoryId: CategoryId;
	poste: PriceItem;
	montant: number;
}

const spends = $derived.by((): PriceItemSpend[] => {
	const mm = getMerchantCategoryMap();
	const out = new Map<string, PriceItemSpend>();
	for (const tx of getBudgetTransactions()) {
		if (!isBudgetFlow(tx)) continue;
		const cat = categorize(tx, budgetState.overrides, undefined, mm);
		if (flowKind(cat) !== 'expense') continue;
		const item = priceItemOf(cat, subcategorize(tx, budgetState.overrides, undefined, mm));
		if (!item) continue;
		const month = tx.booking_date.slice(0, 7);
		const k = `${month}|${cat}|${item}`;
		const d = out.get(k);
		if (d) d.montant += -signedAmount(tx);
		else out.set(k, { mois: month, categoryId: cat, poste: item, montant: -signedAmount(tx) });
	}
	return [...out.values()];
});

export function getPriceItemSpends(): PriceItemSpend[] {
	return spends;
}

/** Sum per group over the selected months. */
export function byPriceItem(rows: readonly PriceItemSpend[], keep: (month: string) => boolean): Map<PriceItem, number> {
	const m = new Map<PriceItem, number>();
	for (const d of rows) if (keep(d.mois)) m.set(d.poste, (m.get(d.poste) ?? 0) + d.montant);
	return m;
}

/** The `n` full months before `currentMonth` (YYYY-MM), oldest first. */
export function monthsBefore(currentMonth: string, n: number, offset = 0): string[] {
	const [y, m] = currentMonth.split('-').map(Number);
	const out: string[] = [];
	for (let i = n + offset; i > offset; i--) {
		const d = new Date(Date.UTC(y!, m! - 1 - i, 15));
		out.push(d.toISOString().slice(0, 7));
	}
	return out;
}
