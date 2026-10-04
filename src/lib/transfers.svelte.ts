import type { Transaction } from './types';
import { txKey } from './categories';
import { getTransactions } from './store.svelte';
import { accountState } from './accounts.svelte';
import { getPortageEntries } from './portage.svelte';
import {
	detectTransferPairs,
	holderNamesFromLabels,
	pairKeys,
	recurringTransferNotes,
	type TransferPair
} from './transfers';

/**
 * Internal transfers store (SPEC v13 §C.2), Svelte 5 runes.
 *
 * Persisted in `budget:internal-transfers` as { excluded, dismissed } (invalid JSON → empty store;
 * unavailable storage keeps the decisions in memory for the session):
 * - excluded: txKeys hidden from the budget totals (spending/income, donut, forecast, report,
 *   insights) BUT still counted in account balances (Patrimoine) and visible on Transactions with a
 *   badge.
 * - dismissed: txKeys the user chose to KEEP (remembered decision, never offered again by the
 *   dialog).
 *
 * The confirmation dialog opens only once per detection batch (initial load or import) through
 * reviewTransfers().
 */

export const TRANSFERS_KEY = 'budget:internal-transfers';

interface TransferStore {
	excluded: string[];
	dismissed: string[];
}

const canStore = typeof localStorage !== 'undefined';

function loadTransfers(): TransferStore {
	if (!canStore) return { excluded: [], dismissed: [] };
	try {
		const parsed = JSON.parse(localStorage.getItem(TRANSFERS_KEY) ?? 'null') as Partial<TransferStore> | null;
		if (parsed && Array.isArray(parsed.excluded)) {
			return {
				excluded: parsed.excluded.filter((k) => typeof k === 'string'),
				dismissed: Array.isArray(parsed.dismissed) ? parsed.dismissed.filter((k) => typeof k === 'string') : []
			};
		}
	} catch {
	}
	return { excluded: [], dismissed: [] };
}

export const transferState = $state({
	...loadTransfers(),
	/** Confirmation dialog open (once per detection batch). */
	reviewOpen: false
});

function persist(): void {
	if (!canStore) return;
	try {
		localStorage.setItem(
			TRANSFERS_KEY,
			JSON.stringify({ excluded: transferState.excluded, dismissed: transferState.dismissed })
		);
	} catch {
	}
}

const excludedSet = $derived(new Set(transferState.excluded));
const dismissedSet = $derived(new Set(transferState.dismissed));

/** Is the key excluded from the budget totals? */
export function isExcluded(key: string): boolean {
	return excludedSet.has(key);
}

/** Holder names detected from the account registry (name heuristic). */
const holderNames = $derived(holderNamesFromLabels(accountState.accounts.map((a) => a.label)));

/** All pairs/candidates detected on the current transactions. */
const detectedPairs = $derived(detectTransferPairs(getTransactions(), holderNames));

export function getDetectedPairs(): TransferPair[] {
	return detectedPairs;
}

/** Keys detected as internal transfers (excluded or not): Transactions filter. */
const internalKeys = $derived.by((): Set<string> => {
	const set = new Set<string>(transferState.excluded);
	for (const pair of detectedPairs) for (const k of pairKeys(pair)) set.add(k);
	return set;
});

/** Is the key an internal transfer (detected or excluded)? */
export function isInternal(key: string): boolean {
	return internalKeys.has(key);
}

/** Number of operations detected as internal transfers (filter chip). */
export function internalCount(): number {
	return internalKeys.size;
}

/** Pairs NOT decided yet (neither excluded nor kept): subject of the dialog. */
const undecidedPairs = $derived(
	detectedPairs.filter((pair) => pairKeys(pair).some((k) => !excludedSet.has(k) && !dismissedSet.has(k)))
);

export function getUndecidedPairs(): TransferPair[] {
	return undecidedPairs;
}

/** 'Virement régulier' mentions of the undecided pairs (dialog). */
export function getUndecidedNotes(): { target: string; monthly: number; months: number }[] {
	return recurringTransferNotes(undecidedPairs, getTransactions());
}

/**
 * Reviews the detections (initial load / end of import): opens the dialog ONCE per batch if
 * undecided pairs remain.
 */
export function reviewTransfers(): void {
	if (undecidedPairs.length > 0) transferState.reviewOpen = true;
}

/** 'Masquer du budget': the keys leave the totals (persisted decision). */
export function excludeKeys(keys: string[]): void {
	if (keys.length === 0) return;
	const add = new Set(keys.filter((k) => !excludedSet.has(k)));
	if (add.size === 0) return;
	transferState.excluded = [...transferState.excluded, ...add];
	transferState.dismissed = transferState.dismissed.filter((k) => !add.has(k));
	persist();
}

/** 'Garder' / 'Réintégrer au budget': remembered decision (never offered again). */
export function includeKeys(keys: string[]): void {
	if (keys.length === 0) return;
	const wanted = new Set(keys);
	transferState.excluded = transferState.excluded.filter((k) => !wanted.has(k));
	const add = keys.filter((k) => !dismissedSet.has(k));
	transferState.dismissed = [...transferState.dismissed, ...add];
	persist();
}

/** Resolves the whole dialog batch at once: hide (excluded) or keep (dismissed). */
export function resolveReview(hide: boolean): void {
	const keys = undecidedPairs.flatMap(pairKeys);
	if (hide) excludeKeys(keys);
	else includeKeys(keys);
	transferState.reviewOpen = false;
}

/**
 * Resolves the dialog line by line: ticked pairs leave the budget totals (excluded), unticked ones
 * are kept (dismissed, never offered again). Each key belongs to one pair only (1-to-1 matching).
 */
export function resolveReviewSelection(hideKeys: string[], keepKeys: string[]): void {
	const hidden = new Set(hideKeys);
	excludeKeys(hideKeys);
	includeKeys(keepKeys.filter((k) => !hidden.has(k)));
	transferState.reviewOpen = false;
}

/**
 * 'Plus tard' / Escape: closes the dialog WITHOUT deciding anything; the pairs stay undecided and
 * are offered again at the next load or import.
 */
export function closeReview(): void {
	transferState.reviewOpen = false;
}

/**
 * Transactions of the BUDGET scope: all except the excluded internal transfers, plus the computed
 * portage entries (meal vouchers, culture vouchers, advanced expenses). Single source of the
 * aggregations (budget, donut, forecast, report, insights); account balances (Patrimoine) use
 * getTransactions(), without those entries.
 */
const budgetTransactions = $derived([...getTransactions().filter((tx) => !excludedSet.has(txKey(tx))), ...getPortageEntries()]);

export function getBudgetTransactions(): Transaction[] {
	return budgetTransactions;
}

/** Number of hidden internal transfers in a batch of transactions (import feedback). */
export function countExcludedAmong(txs: Transaction[]): number {
	let n = 0;
	for (const tx of txs) if (excludedSet.has(txKey(tx))) n++;
	return n;
}
