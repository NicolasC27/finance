import type { Transaction } from './types';
import { txKey } from './categories';
import { setSubcategoryHook } from './subcategories';
import { setOverride, budgetState } from './budget.svelte';
import { getTransactions, updateImported } from './store.svelte';
import { recordImport } from './importsLog.svelte';
import {
	parseAmazonOrders,
	matchAmazonOrders,
	amazonNote,
	mergeAmazonNote,
	amazonOwnsCategory,
	type AmazonMatch
} from './amazonOrders';

/**
 * Amazon matches (runes store, persisted in `budget:amazon-matches`): for each
 * matched bank line, the items, the inferred category (set as an override as
 * long as the user has not decided otherwise — editable afterwards in the
 * row's select) and the subcategory (served through the subcategorize hook).
 * The item list is APPENDED to the row's note and the « amazon » tag to its
 * existing tags: nothing is overwritten.
 */

const KEY = 'budget:amazon-matches';
const canStore = typeof localStorage !== 'undefined';

function load(): Record<string, AmazonMatch> {
	if (!canStore) return {};
	try {
		const parsed = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, AmazonMatch>;
		return parsed && typeof parsed === 'object' ? parsed : {};
	} catch {
		return {};
	}
}

export const amazonState = $state({
	matches: load()
});

/** Saves the matches; ignored when storage is unavailable. */
function persist(): void {
	if (!canStore) return;
	try {
		localStorage.setItem(KEY, JSON.stringify(amazonState.matches));
	} catch {
	}
}

/** Items matched to a transaction (null when none). */
export function amazonMatchFor(tx: Transaction): AmazonMatch | null {
	return amazonState.matches[txKey(tx)] ?? null;
}

export interface AmazonApplySummary {
	matched: number;
	items: number;
	unmatchedTx: number;
	unmatchedOrders: number;
	orders: number;
	errors: string[];
}

/**
 * Imports an Amazon orders export (CSV text) and applies the matches.
 * - The inferred category becomes an override only while the row still
 *   « belongs to Amazon »: never over a manual correction, even on re-import.
 * - Note and tags are MERGED: the user's note is kept, the Amazon part is
 *   added (or updated on re-import), « amazon » is added to the tags.
 * `fileName` feeds the import log (« Derniers imports »), dated by the most
 * recent order.
 */
export function applyAmazonImport(text: string, fileName = 'Export Amazon'): AmazonApplySummary {
	const parsed = parseAmazonOrders(text);
	const txs = getTransactions();
	const result = matchAmazonOrders(txs, parsed.orders);
	const byKey = new Map(txs.map((t) => [txKey(t), t] as const));
	const next = { ...amazonState.matches };
	let items = 0;
	for (const m of result.matches) {
		const prev = amazonState.matches[m.txKey];
		items += m.items.length;
		const current = budgetState.overrides[m.txKey];
		const owned = amazonOwnsCategory(current, prev);
		if (owned && current !== m.categoryId) setOverride(m.txKey, m.categoryId);
		next[m.txKey] = { ...m, appliedCategory: owned ? m.categoryId : null };
		const tx = byKey.get(m.txKey);
		const note = mergeAmazonNote(tx?.note, prev ? amazonNote(prev) : null, amazonNote(m));
		const tags = [...new Set([...(tx?.tags ?? []), 'amazon'])];
		updateImported(m.txKey, { note, tags });
	}
	amazonState.matches = next;
	persist();
	const latestOrder = parsed.orders.reduce((max, o) => (o.orderDate > max ? o.orderDate : max), '');
	if (parsed.orders.length > 0) recordImport('amazon', fileName, latestOrder || undefined);
	return {
		matched: result.matches.length,
		items,
		unmatchedTx: result.unmatchedTx,
		unmatchedOrders: result.unmatchedOrders,
		orders: parsed.orders.length,
		errors: [...parsed.errors, ...result.errors]
	};
}

/** Forgets every match (overrides and notes already set stay, editable row by row). */
export function resetAmazonMatches(): void {
	amazonState.matches = {};
	persist();
}

/** Subcategory inferred from the items, served to the subcategory engine. */
setSubcategoryHook((tx) => {
	const m = amazonState.matches[txKey(tx)];
	return m ? m.subId : undefined;
});
