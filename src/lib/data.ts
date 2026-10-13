import type { CategoryId, Transaction } from './types';
import { flowKind } from './flow';

/** Data loading and helpers (local JSON, no external call). */

/** Fetches the demo transactions from /data/transactions.json (client side). */
export async function loadDemoTransactions(): Promise<Transaction[]> {
	const res = await fetch(`${import.meta.env.BASE_URL}data/transactions.json`);
	if (!res.ok) {
		throw new Error(`Impossible de charger les transactions (${res.status})`);
	}
	return (await res.json()) as Transaction[];
}

// Scopes (bank accounts / wealth lines): single source in scope.ts
export { NON_BANK_ACCOUNTS, isBankTx, isWealthLine } from './scope';

/**
 * Entry computed outside the bank (source 'portage': portage documents; 'cash': cash wallet): in
 * the budget, never in the balances, never a bank date nor a direct debit, and it keeps its written
 * label.
 */
export function isComputedEntry(tx: Transaction): boolean {
	return tx.source === 'portage' || tx.source === 'cash';
}

/** A transaction without a value date is "pending". */
export function isPending(tx: Transaction): boolean {
	return !tx.booking_date || !tx.value_date;
}

/**
 * Expected instalment of a payment in several times: a quick entry waiting, without a value date,
 * for its date or its bank debit. Pending like a bank operation « en cours », but dated.
 */
export function isPlannedInstalment(tx: Transaction): boolean {
	return tx.source === 'manual' && !!tx.instalment && !tx.value_date;
}

/** Signed amount: positive for a credit, negative for a debit. */
export function signedAmount(tx: Transaction): number {
	const value = Number(tx.transaction_amount.amount);
	return tx.credit_debit_indicator === 'CRDT' ? value : -value;
}

/**
 * SPENDING amount of an operation in its category: positive for a debit,
 * NEGATIVE for a credit classified in a spending category (a friend paying
 * back through Wero, credit note, returned item…) — it is deducted from the
 * envelope instead of inflating income. null = not spending: income OR
 * savings/transfer (see flowKind, flow.ts).
 */
export function spendAmount(tx: Transaction, categoryId: CategoryId): number | null {
	if (flowKind(categoryId) !== 'expense') return null;
	return -signedAmount(tx);
}

/** Chronological sort on booking_date (pending ones last). */
export function sortByDate(txs: Transaction[]): Transaction[] {
	return [...txs].sort((a, b) => {
		if (!a.booking_date) return 1;
		if (!b.booking_date) return -1;
		return a.booking_date.localeCompare(b.booking_date);
	});
}

export interface BalancePoint {
	date: Date;
	iso: string;
	balance: number;
}

/** Cumulative balance day by day (booked transactions only, one point per day). */
export function cumulativeBalance(txs: Transaction[]): BalancePoint[] {
	const sorted = sortByDate(txs.filter((tx) => !isPending(tx)));
	let runningTotal = 0;
	const points: BalancePoint[] = [];
	for (const tx of sorted) {
		runningTotal += signedAmount(tx);
		const last = points[points.length - 1];
		if (last && last.iso === tx.booking_date) {
			last.balance = Math.round(runningTotal * 100) / 100;
		} else {
			points.push({
				date: new Date(`${tx.booking_date}T12:00:00`),
				iso: tx.booking_date,
				balance: Math.round(runningTotal * 100) / 100
			});
		}
	}
	return points;
}

/** Catmull-Rom → Bézier smoothing (balance curve). */
export function smoothPath(pts: readonly (readonly [number, number])[], factor = 0.2): string {
	if (pts.length < 2) return '';
	const first = pts[0]!;
	let d = `M${first[0]},${first[1]}`;
	for (let i = 0; i < pts.length - 1; i++) {
		const p0 = pts[Math.max(i - 1, 0)]!;
		const p1 = pts[i]!;
		const p2 = pts[i + 1]!;
		const p3 = pts[Math.min(i + 2, pts.length - 1)]!;
		const c1x = p1[0] + (p2[0] - p0[0]) * factor;
		const c1y = p1[1] + (p2[1] - p0[1]) * factor;
		const c2x = p2[0] - (p3[0] - p1[0]) * factor;
		const c2y = p2[1] - (p3[1] - p1[1]) * factor;
		d += ` C${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${p2[0]},${p2[1]}`;
	}
	return d;
}
