import type { Transaction } from './types';
import { categorize, isWealthMovement, txKey } from './categories';
import { subcategorize } from './subcategories';
import { budgetState } from './budget.svelte';
import { getMerchantCategoryMap } from './store.svelte';
import { getBudgetTransactions } from './transfers.svelte';
import { isComputedEntry, isPending } from './data';
import { persistJson } from './storage';

/**
 * 'À trier' queue (Triage page + Sidebar badge), single source: operations in 'Autre', excluding
 * computed entries (portage, cash wallet: their category is chosen where they are typed), wealth
 * movements, hidden operations, fixed charges legitimately in 'Autre' (loan instalments,
 * bank fees and subscriptions) and operations the user chose to keep in 'Autre'. Before, those 7
 * real operations stayed in the queue and the badge forever.
 */

const KEPT_KEY = 'budget:trier-kept';

function loadKept(): string[] {
	if (typeof localStorage === 'undefined') return [];
	try {
		const parsed = JSON.parse(localStorage.getItem(KEPT_KEY) ?? '[]') as unknown;
		return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : [];
	} catch {
		return [];
	}
}

export const sortQueueState = $state({ kept: loadKept() });

const keptSet = $derived(new Set(sortQueueState.kept));

/** Fixed-charge subcategories: they stay in 'Autre' without going through the queue. */
const FIXED_SUBS: ReadonlySet<string> = new Set(['credits', 'frais-bancaires']);
/** CM fixed-charge labels (loan instalment, monthly payment, subscription, fees). */
const FIXED_LABEL_RE = /^(MENSUALITE PRELEVEE|ECH(EANCE)? PRET|F COTIS|F |FRAIS|COM CARTE|COTIS)/i;

const queue = $derived.by((): Transaction[] => {
	const merchantMap = getMerchantCategoryMap();
	return getBudgetTransactions()
		.filter((tx) => {
			if (isComputedEntry(tx) || isPending(tx) || isWealthMovement(tx) || keptSet.has(txKey(tx))) return false;
			if (categorize(tx, budgetState.overrides, undefined, merchantMap) !== 'autre') return false;
			if (FIXED_LABEL_RE.test(tx.remittance_information.join(' ').trim())) return false;
			const sub = subcategorize(tx, budgetState.overrides, undefined, merchantMap);
			return !(sub && FIXED_SUBS.has(sub));
		})
		.sort((a, b) => b.booking_date.localeCompare(a.booking_date));
});

/** Operations to sort, most recent first. */
export function getSortQueue(): Transaction[] {
	return queue;
}

/** 'Garder en Autre': the operation leaves the queue, decision remembered. */
export function keepInOther(tx: Transaction): void {
	const key = txKey(tx);
	if (keptSet.has(key)) return;
	sortQueueState.kept = [...sortQueueState.kept, key];
	persistJson(KEPT_KEY, sortQueueState.kept);
}

/** Undoes 'Garder en Autre'. */
export function unkeep(tx: Transaction): void {
	const key = txKey(tx);
	sortQueueState.kept = sortQueueState.kept.filter((k) => k !== key);
	persistJson(KEPT_KEY, sortQueueState.kept);
}
