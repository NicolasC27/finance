import { getTransactions } from './store.svelte';
import { accountState } from './accounts.svelte';
import { extractLoanRecord, projectLoan, type LoanProjection, type LoanRecord } from './loans';
import { NON_BANK_ACCOUNTS } from './scope';
import { persistJson } from './storage';

/**
 * Store of tracked loans (SPEC v13 §D) — Svelte 5 runes.
 *
 * Persisted in `budget:loans`: Record<accountId, LoanRecord>, updated on every
 * import (the latest statement wins) through syncLoans(), called on load and
 * after each import. A hand-corrected monthly payment (monthlyOverride) is kept
 * from one statement to the next. Invalid JSON gives an empty store.
 *
 * The projection (estimated current balance, estimated end, progress) is
 * recomputed at DISPLAY time from lastSeenAt — no re-import needed.
 */

export const LOANS_KEY = 'budget:loans';

const canStore = typeof localStorage !== 'undefined';

function loadLoans(): Record<string, LoanRecord> {
	if (!canStore) return {};
	try {
		const parsed = JSON.parse(localStorage.getItem(LOANS_KEY) ?? 'null') as Record<string, LoanRecord> | null;
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
			const out: Record<string, LoanRecord> = {};
			for (const [id, rec] of Object.entries(parsed)) {
				if (rec && typeof rec.balance === 'number' && typeof rec.lastSeenAt === 'string') out[id] = rec;
			}
			return out;
		}
	} catch {
	}
	return {};
}

export const loanState = $state({ loans: loadLoans() });

function persist(): void {
	if (!canStore) return;
	persistJson(LOANS_KEY, loanState.loans);
}

/**
 * Re-detects loans from the transactions + the account registry (initial load
 * and end of import). The latest statement wins; the first observed statement
 * and the payment override are kept. Candidate accounts are the registry plus
 * the accounts seen in transactions, never off-bank accounts (Kraken, Natixis,
 * Krak card).
 */
export function syncLoans(): void {
	const txs = getTransactions();
	const next: Record<string, LoanRecord> = {};
	const ids = new Set<string>(accountState.accounts.map((a) => a.id).filter((id) => !NON_BANK_ACCOUNTS.has(id)));
	for (const tx of txs) {
		const id = tx.account ?? 'cm';
		if (NON_BANK_ACCOUNTS.has(id)) continue;
		ids.add(id);
	}
	for (const id of ids) {
		const hint = accountState.accounts.find((a) => a.id === id);
		const rec = extractLoanRecord(id, txs, hint, loanState.loans[id]);
		if (rec) next[id] = rec;
	}
	loanState.loans = next;
	persist();
}

/** Stores a manual correction of the monthly payment (persisted). */
export function setMonthlyOverride(accountId: string, value: number): void {
	const rec = loanState.loans[accountId];
	if (!rec || !Number.isFinite(value) || value <= 0) return;
	loanState.loans = { ...loanState.loans, [accountId]: { ...rec, monthlyOverride: Math.round(value * 100) / 100 } };
	persist();
}

/** Removes the manual correction (back to the detected payment). */
export function clearMonthlyOverride(accountId: string): void {
	const rec = loanState.loans[accountId];
	if (!rec || rec.monthlyOverride === undefined) return;
	const next = { ...rec };
	delete next.monthlyOverride;
	loanState.loans = { ...loanState.loans, [accountId]: next };
	persist();
}

export interface LoanView extends LoanProjection {
	accountId: string;
	label: string;
}

/**
 * Projected loan views (reactive): the CURRENT estimated balance recomputed at
 * display time — that balance is what enters the net worth (SPEC §D.3).
 */
const loanViews = $derived.by((): Map<string, LoanView> => {
	const now = new Date();
	const map = new Map<string, LoanView>();
	for (const [accountId, rec] of Object.entries(loanState.loans)) {
		map.set(accountId, { accountId, label: rec.label, ...projectLoan(rec, now) });
	}
	return map;
});

export function getLoanViews(): Map<string, LoanView> {
	return loanViews;
}
