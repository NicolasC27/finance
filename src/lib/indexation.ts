import type { CategoryId } from './types';

/**
 * Inflation-indexed budgets — pure module. In January, envelopes can follow
 * price increases in one click: everywhere at the same rate, or item by item
 * (each category's own inflation). The indexation is stored (before / after) so
 * it can be undone.
 */

export type Budgets = Partial<Record<CategoryId, number>>;

export interface Indexation {
	/** Indexation date (YYYY-MM-DD). */
	date: string;
	/** Single rate (%) or "postes" (rate per category). */
	mode: 'global' | 'postes';
	/** Rate applied per category (%). */
	taux: Partial<Record<CategoryId, number>>;
	avant: Budgets;
	apres: Budgets;
}

/** Indexed envelopes, rounded to the euro; a category without a rate is left unchanged. */
export function indexBudgets(budgets: Budgets, rateOf: (c: CategoryId) => number | null | undefined): { budgets: Budgets; taux: Partial<Record<CategoryId, number>> } {
	const out: Budgets = {};
	const rates: Partial<Record<CategoryId, number>> = {};
	for (const [cat, amount] of Object.entries(budgets) as [CategoryId, number][]) {
		const t = rateOf(cat);
		if (t === null || t === undefined || !(amount > 0)) {
			out[cat] = amount;
			continue;
		}
		out[cat] = Math.max(1, Math.round(amount * (1 + t / 100)));
		rates[cat] = t;
	}
	return { budgets: out, taux: rates };
}

/** Offer it in January if the envelopes have not been indexed yet this year. */
export function indexationToSuggest(today: string, last: Indexation | null): boolean {
	return today.slice(5, 7) === '01' && (!last || last.date.slice(0, 4) < today.slice(0, 4));
}

/** Can be undone for 30 days, as long as the envelopes were not edited since. */
export function undoableIndexation(last: Indexation | null, budgets: Budgets, today: string): boolean {
	if (!last) return false;
	const days = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${last.date}T00:00:00Z`)) / 86_400_000;
	if (days > 30) return false;
	const keys = new Set([...Object.keys(budgets), ...Object.keys(last.apres)]) as Set<CategoryId>;
	return [...keys].every((c) => budgets[c] === last.apres[c]);
}

/** Validates an indexation read back from storage. */
export function readIndexation(v: unknown): Indexation | null {
	if (!v || typeof v !== 'object') return null;
	const x = v as Indexation;
	return typeof x.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x.date) && (x.mode === 'global' || x.mode === 'postes') && x.avant && x.apres && typeof x.avant === 'object' && typeof x.apres === 'object' ? x : null;
}
