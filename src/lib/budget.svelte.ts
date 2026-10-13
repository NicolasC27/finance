import type { CategoryId } from './types';
import { loadOverrides, saveOverrides, txKey } from './categories';
import { loadSubOverrides, saveSubOverrides, setSubOverridesSource } from './subcategories';
import { merchantKey } from './merchant';
import type { Transaction } from './types';
import { persistJson } from './storage';

/** Shared runes store: budgets per category, selected month, overrides. */

const BUDGETS_KEY = 'budget:budgets';

const canStore = typeof localStorage !== 'undefined';

/** Default budgets (seeded on first load, editable afterwards). */
const DEFAULT_BUDGETS: Partial<Record<CategoryId, number>> = {
	alimentation: 420,
	logement: 930,
	energie: 100,
	transport: 60,
	voiture: 120,
	abonnements: 80,
	loisirs: 160,
	sante: 60,
	vacances: 150,
	autre: 60
};

/** Stored budgets; invalid JSON falls back to the defaults. */
function loadBudgets(): Partial<Record<CategoryId, number>> {
	if (!canStore) return { ...DEFAULT_BUDGETS };
	try {
		const raw = localStorage.getItem(BUDGETS_KEY);
		if (raw) return JSON.parse(raw) as Partial<Record<CategoryId, number>>;
	} catch {
	}
	return { ...DEFAULT_BUDGETS };
}

/** Global reactive state (Svelte 5 runes). */
export const budgetState = $state({
	budgets: loadBudgets(),
	overrides: loadOverrides(),
	/** Manual subcategory overrides (per operation / per merchant). */
	subOverrides: loadSubOverrides(),
	/** Selected month as "YYYY-MM" (Budget page). */
	selectedMonth: ''
});

/** Sets (or removes when amount ≤ 0) a category budget, persisted. */
export function setBudget(categoryId: CategoryId, amount: number): void {
	if (amount > 0) {
		budgetState.budgets[categoryId] = amount;
	} else {
		delete budgetState.budgets[categoryId];
	}
	if (canStore) persistJson(BUDGETS_KEY, budgetState.budgets);
}

/** Manual category override for a transaction (txKey key). */
export function setOverride(key: string, categoryId: CategoryId): void {
	budgetState.overrides = { ...budgetState.overrides, [key]: categoryId };
	saveOverrides(budgetState.overrides);
}

/**
 * Batch overrides (bulk edit of the Transactions page, « Annuler »): a single
 * write; `null` removes the key's override (back to automatic categorisation).
 */
export function patchOverrides(patch: Record<string, CategoryId | null>): void {
	const next = { ...budgetState.overrides };
	for (const [key, categoryId] of Object.entries(patch)) {
		if (categoryId === null) delete next[key];
		else next[key] = categoryId;
	}
	budgetState.overrides = next;
	saveOverrides(next);
}

/** Removes a manual override (back to automatic categorisation). */
export function clearOverride(key: string): void {
	if (!(key in budgetState.overrides)) return;
	const next = { ...budgetState.overrides };
	delete next[key];
	budgetState.overrides = next;
	saveOverrides(budgetState.overrides);
}

setSubOverridesSource(budgetState.subOverrides);

/**
 * Manual subcategory: `scope: 'tx'` for this operation only (subId null =
 * « none »), `scope: 'merchant'` for every operation of the same merchant
 * (subId null = force « none » for the merchant; previously the rule was
 * deleted and the dictionary subcategory came back). Forces a new overrides
 * reference: subcategorize() is derived from budgetState.overrides.
 */
export function setSubOverride(tx: Transaction, subId: string | null, scope: 'tx' | 'merchant'): void {
	const key = txKey(tx);
	const mk = merchantKey(tx.remittance_information);
	const byTx = { ...budgetState.subOverrides.byTx };
	const byMerchant = { ...budgetState.subOverrides.byMerchant };
	if (scope === 'merchant' && mk) {
		delete byTx[key];
		byMerchant[mk] = subId;
	} else {
		byTx[key] = subId;
	}
	budgetState.subOverrides = { byTx, byMerchant };
	saveSubOverrides(budgetState.subOverrides);
	setSubOverridesSource(budgetState.subOverrides);
	budgetState.overrides = { ...budgetState.overrides };
}

/** Subcategories of several operations at once (`scope: 'tx'`), one write. */
export function setTxSubOverrides(list: readonly { tx: Transaction; subId: string | null }[]): void {
	if (!list.length) return;
	const byTx = { ...budgetState.subOverrides.byTx };
	for (const { tx, subId } of list) byTx[txKey(tx)] = subId;
	budgetState.subOverrides = { ...budgetState.subOverrides, byTx };
	saveSubOverrides(budgetState.subOverrides);
	setSubOverridesSource(budgetState.subOverrides);
	budgetState.overrides = { ...budgetState.overrides };
}

/**
 * Puts subcategory overrides back as they were before a change (undo), in one write: a value
 * (subId, or null = « none ») is set again, `undefined` removes the entry (automatic subcategory).
 */
export function restoreSubOverrides(byTxPrevious: Record<string, string | null | undefined>, byMerchantPrevious: Record<string, string | null | undefined> = {}): void {
	const restore = (current: Record<string, string | null>, previous: Record<string, string | null | undefined>) => {
		const next = { ...current };
		for (const [key, value] of Object.entries(previous)) {
			if (value === undefined) delete next[key];
			else next[key] = value;
		}
		return next;
	};
	budgetState.subOverrides = { byTx: restore(budgetState.subOverrides.byTx, byTxPrevious), byMerchant: restore(budgetState.subOverrides.byMerchant, byMerchantPrevious) };
	saveSubOverrides(budgetState.subOverrides);
	setSubOverridesSource(budgetState.subOverrides);
	budgetState.overrides = { ...budgetState.overrides };
}

/**
 * Hands the category and subcategory chosen for one operation (`fromKey`) over to `to`: a quick
 * entry whose key changes, or the bank operation that replaces it. What `to` already has is kept;
 * `fromKey` loses them.
 */
export function moveTxOverrides(fromKey: string, to: Transaction): void {
	const toKey = txKey(to);
	if (fromKey in budgetState.overrides) {
		const next = { ...budgetState.overrides };
		const category = next[fromKey]!;
		delete next[fromKey];
		if (!(toKey in next)) next[toKey] = category;
		budgetState.overrides = next;
		saveOverrides(next);
	}
	if (fromKey in budgetState.subOverrides.byTx) {
		const byTx = { ...budgetState.subOverrides.byTx };
		const subId = byTx[fromKey] ?? null;
		delete byTx[fromKey];
		if (!(toKey in byTx)) byTx[toKey] = subId;
		budgetState.subOverrides = { ...budgetState.subOverrides, byTx };
		saveSubOverrides(budgetState.subOverrides);
		setSubOverridesSource(budgetState.subOverrides);
		budgetState.overrides = { ...budgetState.overrides };
	}
}

/** Moves to the previous/next month, bounded by the list of available months. */
export function shiftMonth(availableMonths: string[], delta: number): void {
	const idx = availableMonths.indexOf(budgetState.selectedMonth);
	if (idx === -1) return;
	const next = idx + delta;
	if (next >= 0 && next < availableMonths.length) {
		budgetState.selectedMonth = availableMonths[next]!;
	}
}
