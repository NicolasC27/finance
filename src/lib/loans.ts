import type { Transaction } from './types';
import { isPending, signedAmount } from './data';
import { median } from './forecast';

/**
 * Ongoing loans — detection, persistence, projection (SPEC v13 §D).
 * PURE functions, testable outside the browser (no state, no DOM).
 *
 * A loan is tracked for an account of kind 'pret' (v9) OR any account whose
 * (declared or computed) balance is negative with recurring monthly credits
 * (the repayments). Example: balance −5 000 €, payments 150 → 160 € (median of
 * the last 6 months ≈ 158 €).
 */

/** Minimal registry needed for detection (avoids importing the store). */
export interface LoanAccountHint {
	id: string;
	label: string;
	kind: string;
	balance?: number; // DECLARED balance (XLSX summary sheet)
}

export interface LoanRecord {
	/** Last known balance (negative = principal still owed). */
	balance: number;
	/** Detected monthly payment: median of the monthly credits over the last 6 months. */
	monthlyPayment: number;
	/** ISO date of the last statement (most recent booking_date). */
	lastSeenAt: string;
	/** ISO date of the first observed statement (progress baseline, §D.3). */
	firstSeenAt: string;
	/** Account label at the last statement. */
	label: string;
	/** Manual correction of the monthly payment (persisted, overrides detection). */
	monthlyOverride?: number;
}

export interface LoanProjection {
	/** CURRENT estimated balance (≤ 0): balance + payment × elapsed months, capped at 0. */
	currentBalance: number;
	/** Whole months elapsed since lastSeenAt. */
	monthsElapsed: number;
	/** Remaining months: ceil(|current balance| / payment). */
	monthsRemaining: number;
	/** Estimated end month "YYYY-MM" (today + remaining months). */
	endMonth: string;
	/**
	 * Progress 0..1: the initial principal is unknown, so time is used —
	 * months elapsed since the first statement / (months elapsed + months remaining).
	 */
	progress: number;
	/** Effective monthly payment (manual override wins over detection). */
	effectivePayment: number;
	/** true when the payment was entered by hand. */
	isOverride: boolean;
	/** ISO date of the computation day ("estimated on …" note). */
	estimatedAt: string;
}

/** Month key "YYYY-MM" of an ISO date. */
function monthKey(iso: string): string {
	return iso.slice(0, 7);
}

/** WHOLE months elapsed between two ISO dates (day to day: 06/08 → 14/08 = 0); a month only counts once its day is reached. */
export function wholeMonthsBetween(fromIso: string, toIso: string): number {
	const [y1, m1, d1] = fromIso.split('-').map(Number);
	const [y2, m2, d2] = toIso.split('-').map(Number);
	let months = (y2! - y1!) * 12 + (m2! - m1!);
	if (d2! < d1!) months -= 1;
	return Math.max(0, months);
}

/** Today's ISO date (local). */
export function todayIso(now: Date): string {
	return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** "YYYY-MM" shifted by `delta` months. */
export function shiftMonth(monthKeyIso: string, delta: number): string {
	const [y, m] = monthKeyIso.split('-').map(Number);
	const d = new Date(y!, m! - 1 + delta, 15);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Extracts a loan's state from an account's transactions:
 * - balance: last known `balance_after` (statement) at the most recent date —
 *   on equal dates the FIRST one met wins, since CM exports are
 *   reverse-chronological — otherwise the registry's declared balance,
 *   otherwise cumulated flows (display fallback only);
 * - monthlyPayment: median of the monthly credit TOTALS over the last 6 months
 *   with credits (on a loan account the repayments are CREDITS: they reduce
 *   the negative balance);
 * - lastSeenAt / firstSeenAt: bounds of the observed statements; the first
 *   observed statement never moves back (stable progress baseline).
 * Detection needs kind 'pret' OR a REAL (statement or declared) negative
 * balance with repayments, never cumulated flows: the Krak card (negative
 * cumulated payments, refunds mistaken for repayments) and partially imported
 * current accounts used to become fake loans.
 * Returns null when the account is not a loan (kind ≠ 'pret' AND balance ≥ 0
 * or no payment detected).
 */
export function extractLoanRecord(
	accountId: string,
	txs: Transaction[],
	hint: LoanAccountHint | undefined,
	existing?: LoanRecord
): LoanRecord | null {
	const own = txs.filter((tx) => (tx.account ?? 'cm') === accountId && !isPending(tx));
	const kind = hint?.kind ?? 'autre';

	let lastBalanceAt = '';
	let lastTxAt = '';
	let lastBalance: number | null = null;
	let firstAt = '';
	let flow = 0;
	const creditsByMonth = new Map<string, number>();
	for (const tx of own) {
		const amount = signedAmount(tx);
		flow += amount;
		if (!firstAt || tx.booking_date < firstAt) firstAt = tx.booking_date;
		if (tx.booking_date > lastTxAt) lastTxAt = tx.booking_date;
		if (tx.balance_after !== undefined && tx.booking_date >= lastBalanceAt) {
			if (tx.booking_date > lastBalanceAt || lastBalance === null) {
				lastBalanceAt = tx.booking_date;
				lastBalance = tx.balance_after;
			}
		}
		if (amount > 0) {
			const mk = monthKey(tx.booking_date);
			creditsByMonth.set(mk, (creditsByMonth.get(mk) ?? 0) + amount);
		}
	}
	if (!firstAt && hint?.balance === undefined) return null;

	const realBalance = lastBalance ?? hint?.balance;
	const balance = realBalance ?? Math.round(flow * 100) / 100;
	const lastSeenAt = lastTxAt || firstAt;
	const creditMonths = [...creditsByMonth.keys()].sort().slice(-6);
	const monthlyPayment =
		creditMonths.length > 0
			? Math.round(median(creditMonths.map((m) => creditsByMonth.get(m)!)) * 100) / 100
			: 0;

	const isLoan = kind === 'pret' || (realBalance !== undefined && realBalance < 0 && monthlyPayment > 0);
	if (!isLoan) return null;

	const rec: LoanRecord = {
		balance,
		monthlyPayment,
		lastSeenAt,
		firstSeenAt: existing && existing.firstSeenAt < firstAt ? existing.firstSeenAt : firstAt || lastSeenAt,
		label: hint?.label ?? accountId,
		...(existing?.monthlyOverride !== undefined ? { monthlyOverride: existing.monthlyOverride } : {})
	};
	return rec;
}

/**
 * Projection WITHOUT re-import (SPEC §D.2): the current estimated balance is
 * recomputed at display time from lastSeenAt —
 *   current balance = balance + payment × months elapsed since lastSeenAt,
 *   capped at 0 (a repaid loan does not become a credit).
 * Remaining months = ceil(|current balance| / payment); estimated end =
 * today + remaining months (the reference is moved to today when lastSeenAt is
 * old). Progress is TIME-based since the first statement (the initial
 * principal is unknown).
 * Example: −5 000 / ≈ 158 → 32 payments → ends in about 2.7 years.
 */
export function projectLoan(rec: LoanRecord, now: Date): LoanProjection {
	const estimatedAt = todayIso(now);
	const payment = rec.monthlyOverride ?? rec.monthlyPayment;
	const monthsElapsed = wholeMonthsBetween(rec.lastSeenAt, estimatedAt);
	const currentBalance =
		payment > 0
			? Math.round(Math.min(0, rec.balance + payment * monthsElapsed) * 100) / 100
			: rec.balance;
	const monthsRemaining = payment > 0 ? Math.ceil(Math.abs(currentBalance) / payment) : 0;
	const endMonth = shiftMonth(estimatedAt.slice(0, 7), monthsRemaining);
	const monthsSinceFirst = wholeMonthsBetween(rec.firstSeenAt, estimatedAt);
	const progress =
		monthsSinceFirst + monthsRemaining > 0 ? monthsSinceFirst / (monthsSinceFirst + monthsRemaining) : 0;
	return {
		currentBalance,
		monthsElapsed,
		monthsRemaining,
		endMonth,
		progress: Math.max(0, Math.min(1, progress)),
		effectivePayment: payment,
		isOverride: rec.monthlyOverride !== undefined,
		estimatedAt
	};
}
