import type { Transaction } from './types';
import { isPending, signedAmount } from './data';

/**
 * Real cost of an amortising loan (constant instalments) — pure module.
 *
 * Statements give two things: the instalment paid from the current account
 * (« ECH PRET … 005678 01 ») and, on the loan account, the repaid principal
 * (« MENSUALITE PRELEVEE »). The difference is the interest: divided by the
 * principal owed before the instalment, it gives the rate without asking
 * anything. Example: 210 € of which 176 € principal on 8,500 € owed → 34 € of
 * interest, ≈ 4.8 %/year.
 */

export interface LoanParams {
	/** Outstanding principal (€, > 0). */
	capital: number;
	/** Monthly instalment paid (principal + interest, insurance if any). */
	mensualite: number;
	/** Nominal annual rate (%). */
	taux: number;
}

export interface AmortizationRow {
	n: number;
	interets: number;
	capital: number;
	restant: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Amortisation table until full repayment (600 instalments at most; empty when
 * the instalment doesn't cover the interest). A rounding remainder (a few
 * cents) is absorbed by the last instalment.
 */
export function amortizationTable(p: LoanParams): AmortizationRow[] {
	const r = p.taux / 1200;
	const out: AmortizationRow[] = [];
	let remaining = p.capital;
	for (let n = 1; remaining > 0.005 && n <= 600; n++) {
		const interest = remaining * r;
		if (p.mensualite <= interest) return [];
		let capital = Math.min(p.mensualite - interest, remaining);
		if (remaining - capital < Math.max(0.5, p.mensualite * 0.01)) capital = remaining;
		remaining -= capital;
		out.push({ n, interets: r2(interest), capital: r2(capital), restant: r2(Math.max(0, remaining)) });
	}
	return remaining > 0.005 ? [] : out;
}

export interface RemainingCost {
	/** Remaining instalments (the last one may be smaller). */
	echeances: number;
	/** Interest still to pay (€). */
	interets: number;
	/** Total still to pay: principal + interest (€). */
	total: number;
}

/** What remains to be paid; null when the instalment doesn't even cover the interest. */
export function remainingCost(p: LoanParams): RemainingCost | null {
	const t = amortizationTable(p);
	if (!t.length) return null;
	const interest = r2(t.reduce((s, l) => s + l.interets, 0));
	return { echeances: t.length, interets: interest, total: r2(p.capital + interest) };
}

/**
 * Early repayment penalty of a consumer loan (art. L312-34 of the French
 * Consumer Code): none when the total repaid early over 12 months does not
 * exceed 10,000 €; otherwise at most 1 % of the amount (0.5 % within a year
 * of the end), and never more than the interest saved. A mortgage follows
 * other rules.
 */
export function earlyRepaymentFee(amount: number, remainingInstallments: number, interestSaved: number, repaidPast12Months = 0): number {
	if (amount + repaidPast12Months <= 10_000) return 0;
	return r2(Math.min(amount * (remainingInstallments > 12 ? 0.01 : 0.005), interestSaved));
}

export interface EarlyRepaymentSimulation {
	montant: number;
	/** Interest that will never be paid (€). */
	interetsEvites: number;
	/** Fewer instalments (same instalment, earlier end). */
	echeancesEnMoins: number;
	/** Remaining instalments after the repayment (0 = paid off). */
	echeancesApres: number;
	indemnite: number;
	/** Net gain: interest saved − penalty (€). */
	gain: number;
}

/**
 * Early repayment of `amount` today (at most the whole principal): same
 * instalment, shorter duration — the banks' default rule.
 */
export function simulateEarlyRepayment(p: LoanParams, amount: number, repaidPast12Months = 0): EarlyRepaymentSimulation | null {
	const before = remainingCost(p);
	if (!before || !(amount > 0)) return null;
	const m = Math.min(amount, p.capital);
	const remaining = p.capital - m;
	const after = remaining > 0.005 ? remainingCost({ ...p, capital: remaining }) : { echeances: 0, interets: 0, total: 0 };
	if (!after) return null;
	const interestSaved = r2(before.interets - after.interets);
	const penalty = earlyRepaymentFee(m, before.echeances, interestSaved, repaidPast12Months);
	return { montant: r2(m), interetsEvites: interestSaved, echeancesEnMoins: before.echeances - after.echeances, echeancesApres: after.echeances, indemnite: penalty, gain: r2(interestSaved - penalty) };
}

/**
 * Nominal annual rate (%) derived from an instalment: interest = instalment −
 * principal part, divided by the principal owed BEFORE the instalment
 * (principal after + part). Includes insurance when it is debited with the
 * instalment (real cost).
 */
export function rateFromInstallment(installment: number, principalPart: number, principalAfter: number): number | null {
	const interest = installment - principalPart;
	const before = principalAfter + principalPart;
	if (!(interest > 0) || !(before > 0) || principalPart <= 0) return null;
	const rate = (interest / before) * 1200;
	return rate < 30 ? Math.round(rate * 100) / 100 : null;
}

/** Principal owed `k` instalments earlier: amortisation run backwards, C_before = (C + instalment) / (1 + r). */
export function principalBefore(p: LoanParams, k: number): number {
	const r = p.taux / 1200;
	let c = p.capital;
	for (let i = 0; i < k; i++) c = (c + p.mensualite) / (1 + r);
	return r2(c);
}

export interface Payment {
	date: string;
	montant: number;
}

/** Significant digits of an account number (« cm-00000567801 » → « 567801 »). */
function accountDigits(id: string): string {
	return id.replace(/\D/g, '').replace(/^0+/, '');
}

const INSTALLMENT_RE = /\b(ECH(EANCE)?\s+PR(E|Ê)T|ECHEANCE|REMB(OURSEMENT)?\s+PR(E|Ê)T)\b/;

/**
 * Instalments of a loan paid from the other accounts: an instalment label that
 * quotes the loan account number (« ECH PRET AUTO 01234 005678 01 » for
 * account 00000567801). `singleLoan`: without a recognised number, the series
 * (same label without variable digits) of the most recent instalment is kept
 * (a single tracked loan).
 */
export function loanInstallments(txs: readonly Transaction[], loanAccount: string, singleLoan = false): Payment[] {
	const num = accountDigits(loanAccount);
	const candidates = txs.filter((tx) => !isPending(tx) && (tx.account ?? 'cm') !== loanAccount && signedAmount(tx) < 0 && INSTALLMENT_RE.test(tx.remittance_information.join(' ').toUpperCase()));
	const label = (tx: Transaction) => tx.remittance_information.join(' ');
	let matched = num.length >= 5 ? candidates.filter((tx) => label(tx).replace(/\D/g, '').includes(num)) : [];
	if (!matched.length && singleLoan && candidates.length) {
		const seriesKey = (tx: Transaction) => label(tx).toUpperCase().replace(/\s+/g, ' ').trim();
		const latest = [...candidates].sort((a, b) => b.booking_date.localeCompare(a.booking_date))[0]!;
		matched = candidates.filter((tx) => seriesKey(tx) === seriesKey(latest));
	}
	return matched.map((tx) => ({ date: tx.booking_date, montant: r2(-signedAmount(tx)) })).sort((a, b) => a.date.localeCompare(b.date));
}

/** Repaid principal parts, read on the loan account (the account's credits). */
export function principalParts(txs: readonly Transaction[], loanAccount: string): Payment[] {
	return txs
		.filter((tx) => !isPending(tx) && tx.account === loanAccount && signedAmount(tx) > 0)
		.map((tx) => ({ date: tx.booking_date, montant: r2(signedAmount(tx)) }))
		.sort((a, b) => a.date.localeCompare(b.date));
}

/** Current instalment: median of the last 3 (the first, partial instalment doesn't count). */
export function currentInstallment(installments: readonly Payment[]): number | null {
	const d = installments.slice(-3).map((e) => e.montant).sort((a, b) => a - b);
	if (!d.length) return null;
	return d.length % 2 ? d[(d.length - 1) / 2]! : r2((d[d.length / 2 - 1]! + d[d.length / 2]!) / 2);
}

/**
 * Rate estimated from the statements: last known principal part, instalment of
 * the same month, principal owed after that instalment. null when a piece is
 * missing.
 */
export function estimateRate(installments: readonly Payment[], parts: readonly Payment[], principalAfterLastPart: number): number | null {
	const part = parts[parts.length - 1];
	if (!part) return null;
	const installment = [...installments].reverse().find((e) => e.date.slice(0, 7) === part.date.slice(0, 7));
	return installment ? rateFromInstallment(installment.montant, part.montant, principalAfterLastPart) : null;
}
