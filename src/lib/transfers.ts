import type { Transaction } from './types';
import { txKey, INTERNAL_TRANSFER_RE } from './categories';
import { isPending, signedAmount } from './data';
import { accountOf, KRAKEN_RE } from './scope';

/**
 * Detection of internal transfers (between the user's own accounts), SPEC v13 §C.1.
 * PURE functions, testable outside the browser (no state, no DOM).
 *
 * Two heuristics, deduplicated union (each operation appears in at most ONE pair):
 * 1. 'pair': debit on account A and credit on account B (A ≠ B), |amounts| equal to the cent,
 *    dates ≤ 7 days apart, and BOTH labels look like a transfer (VIR / VER / VIREMENT / VERSEMENT /
 *    TRANSFERT first, or an internal marker KRAKEN, VER INI, VIREMENT INTERNE). 1-to-1 matching:
 *    candidates are sorted by increasing day gap and each operation is used once, so a 100 € ATM
 *    withdrawal no longer 'validates' the credit of a real 100 € transfer.
 * 2. 'keyword': the label betrays a transfer to an own account: KRAKEN (crypto broker), VER INI /
 *    VIREMENT INTERNE (Crédit Mutuel internal markers), or 'VIR INST'/'VIR' + a holder NAME first
 *    and another of their names further on. Single candidate, with no 'transfer' counterpart
 *    available (target account not imported). Kraken account lines never produce one: their status
 *    is decided at import (isInternalKrakenMovement), and 'KRAKEN SUBSCRIPTION' is real spending.
 *    They can still be the counterpart of a pair (heuristic 1).
 *
 * Checked on real data, e.g. (fictional names and numbers): 'VIR INST JEAN PAUL DUPONT KRAKEN TX//…'
 * credits, and 'VIR 10278000000000000001' (−X € current account) ↔ 'VER INI 10278000000000000002'
 * (+X € LDDS).
 */

export interface TransferPair {
	/** txKey of the debit ('' if the counterpart is not imported). */
	debitKey: string;
	/** txKey of the credit ('' if the counterpart is not imported). */
	creditKey: string;
	/** Transfer amount (positive, €). */
	amount: number;
	/** Day gap between both sides (0 for a single candidate). */
	days: number;
	/** Originating heuristic: 'pair' (amount/date) or 'keyword' (label). */
	reason: string;
}

const DAY_MS = 86_400_000;

/** Maximum gap (days) between both sides of a transfer. */
const MAX_DAYS = 7;

/** ISO → whole day number (comparing day gaps). */
function dayOf(iso: string): number {
	return Math.round(new Date(`${iso}T12:00:00`).getTime() / DAY_MS);
}

/** Joined label in upper case (base of the keyword tests). */
function upperLabel(tx: Transaction): string {
	return tx.remittance_information.join(' ').toUpperCase().replace(/\s+/g, ' ').trim();
}

/** Absolute amount to the cent (matching key). */
function centsOf(tx: Transaction): number {
	return Math.round(Number(tx.transaction_amount.amount) * 100);
}

/** true if the label carries an explicit inter-account marker (KRAKEN, VER INI, VIREMENT INTERNE). */
export function hasInternalKeyword(label: string): boolean {
	return INTERNAL_TRANSFER_RE.test(label);
}

/** Bank transfer label at the start: VIR, VIR INST, VER INI, VIREMENT, VERSEMENT, TRANSFERT. */
const TRANSFER_LABEL_RE = /^(VIR|VER|VIREMENT|VERSEMENT|TRANSFERT)\b/;

/**
 * Kraken ledger lines that are bank ↔ Kraken movements (deposit, withdrawal, transfer); the others
 * (card, conversions, Kraken+ subscription, rewards…) are never the counterpart of a bank transfer.
 */
const KRAKEN_TRANSFER_RE = /^KRAKEN (VIREMENT|DEPOSIT|WITHDRAWAL)\b/;

/**
 * Does the label look like a transfer? Required on BOTH sides of an 'amount/date' pair: without it,
 * a 50 € card purchase on one account and a friend's 50 € repayment on another formed a 'transfer'.
 */
function isTransferLike(tx: Transaction, label: string): boolean {
	if (accountOf(tx) === 'kraken') return KRAKEN_TRANSFER_RE.test(label);
	return TRANSFER_LABEL_RE.test(label) || hasInternalKeyword(label);
}

/** Normalised name token (apostrophes / hyphens removed), like holderNamesFromLabels. */
function nameToken(tok: string): string {
	return tok.replace(/['’-]/g, '');
}

/**
 * true if the label is a 'VIR INST'/'VIR' whose FIRST word after the prefix (title ignored, e.g.
 * 'VIR INST M. DUPONT') is a holder name, AND which contains at least ANOTHER of their names
 * ('VIR INST JEAN PAUL DUPONT …'), fictional examples:
 * - the leading position rules out a salary ('VIR SAS ACME DUPONT JEAN': the employer precedes the
 *   name) and a payment to a namesake ('VIR INST DEVIS N00000 DUPONT J.');
 * - the second name rules out a friend with the same first name ('VIR INST JEAN MARTIN RESTO' is
 *   not a transfer to oneself).
 */
function startsWithHolderName(label: string, holderNames: string[]): boolean {
	if (holderNames.length < 2) return false;
	const m = /^(?:VIR INST|VIR)\s+(.+)$/.exec(label);
	if (!m) return false;
	const toks = m[1]!.split(' ').map(nameToken);
	if (/^(M|MME|MLLE|MR)\.?$/.test(toks[0] ?? '')) toks.shift();
	const first = toks[0] ?? '';
	if (!holderNames.includes(first)) return false;
	return toks.slice(1).some((tok) => tok !== first && holderNames.includes(tok));
}

/**
 * Holder names extracted from the account registry labels (fictional example):
 * 'C/C EUROCOMPTE CONFORT M JEAN DUPONT' → ['JEAN', 'DUPONT']. Words of ≥ 4 letters following the
 * title (M/MME/MLLE) are kept: long enough to discriminate, first name included.
 */
export function holderNamesFromLabels(labels: string[]): string[] {
	const names = new Set<string>();
	for (const raw of labels) {
		const up = raw.toUpperCase().replace(/\s+/g, ' ').trim();
		const m = /\b(?:M|MM?E|MLLE)\s+([A-ZÀ-Ý'’-]+(?:\s+[A-ZÀ-Ý'’-]+)*)\s*$/.exec(up);
		if (!m) continue;
		for (const tok of m[1]!.split(/\s+/)) {
			const clean = nameToken(tok);
			if (clean.length >= 4) names.add(clean);
		}
	}
	return [...names];
}

/** Debit ↔ credit matching candidate (before the 1-to-1 assignment). */
interface Candidate {
	debit: Transaction;
	credit: Transaction;
	days: number;
	/** Order of appearance: deterministic tie-break at equal gap. */
	order: number;
}

/**
 * Detects the pairs/candidates of internal transfers (union of both heuristics; each operation
 * appears in at most ONE pair). `holderNames`: holder names (holderNamesFromLabels on the
 * registry), optional; the name heuristic is simply inactive without them. 'Transfer' credits are
 * indexed by amount to the cent; heuristic 1 builds amount/date candidates (debit A ↔ credit B, two
 * transfer labels) assigned 1-to-1 by increasing day gap; heuristic 2 adds keyword candidates with
 * no counterpart, never for a Kraken ledger line.
 */
export function detectTransferPairs(txs: Transaction[], holderNames: string[] = []): TransferPair[] {
	const confirmed = txs.filter((tx) => !isPending(tx));
	const labels = new Map<Transaction, string>();
	for (const tx of confirmed) labels.set(tx, upperLabel(tx));
	const labelOf = (tx: Transaction): string => labels.get(tx)!;

	const creditsByCents = new Map<number, Transaction[]>();
	for (const tx of confirmed) {
		if (tx.credit_debit_indicator !== 'CRDT' || !isTransferLike(tx, labelOf(tx))) continue;
		const cents = centsOf(tx);
		const list = creditsByCents.get(cents);
		if (list) list.push(tx);
		else creditsByCents.set(cents, [tx]);
	}

	const candidates: Candidate[] = [];
	for (const debit of confirmed) {
		if (debit.credit_debit_indicator !== 'DBIT' || !isTransferLike(debit, labelOf(debit))) continue;
		const day = dayOf(debit.booking_date);
		for (const credit of creditsByCents.get(centsOf(debit)) ?? []) {
			if (accountOf(credit) === accountOf(debit)) continue;
			const days = Math.abs(dayOf(credit.booking_date) - day);
			if (days > MAX_DAYS) continue;
			candidates.push({ debit, credit, days, order: candidates.length });
		}
	}

	candidates.sort((a, b) => a.days - b.days || a.order - b.order);
	const used = new Set<Transaction>();
	const out: TransferPair[] = [];
	for (const c of candidates) {
		if (used.has(c.debit) || used.has(c.credit)) continue;
		used.add(c.debit).add(c.credit);
		out.push({
			debitKey: txKey(c.debit),
			creditKey: txKey(c.credit),
			amount: centsOf(c.debit) / 100,
			days: c.days,
			reason: 'pair'
		});
	}

	for (const tx of confirmed) {
		if (used.has(tx) || accountOf(tx) === 'kraken') continue;
		const label = labelOf(tx);
		if (!hasInternalKeyword(label) && !startsWithHolderName(label, holderNames)) continue;
		used.add(tx);
		const key = txKey(tx);
		const amount = Math.abs(signedAmount(tx));
		out.push(
			tx.credit_debit_indicator === 'DBIT'
				? { debitKey: key, creditKey: '', amount, days: 0, reason: 'keyword' }
				: { debitKey: '', creditKey: key, amount, days: 0, reason: 'keyword' }
		);
	}

	return out.sort((a, b) => b.amount - a.amount);
}

/** All (non-empty) keys of a pair/candidate. */
export function pairKeys(pair: TransferPair): string[] {
	return [pair.debitKey, pair.creditKey].filter((k) => k !== '');
}

/** Readable target of a transfer (for the dialog): 'Kraken' if the label names it. */
export function transferTarget(tx: Transaction | undefined): string {
	if (!tx) return 'un autre compte';
	return KRAKEN_RE.test(tx.remittance_information.join(' ')) ? 'Kraken' : 'un autre compte';
}

/**
 * Regular transfers to the same target (dialog mention, SPEC §C.2): a target is 'regular' if
 * transfers concerning it appear in ≥ 3 distinct months; the monthly amount shown is the average of
 * the monthly totals (several transfers in a month still make a monthly rhythm, e.g. weekly Kraken
 * repayments). A pair is ONE transfer: its amount counts once (debit side first, else the credit
 * of a single candidate).
 */
export function recurringTransferNotes(
	pairs: TransferPair[],
	txs: Transaction[]
): { target: string; monthly: number; months: number }[] {
	const byKey = new Map<string, Transaction>();
	for (const tx of txs) byKey.set(txKey(tx), tx);
	const byTarget = new Map<string, Map<string, number>>();
	for (const pair of pairs) {
		const tx = byKey.get(pair.debitKey) ?? byKey.get(pair.creditKey);
		if (!tx || !tx.booking_date) continue;
		const target = transferTarget(tx);
		let perMonth = byTarget.get(target);
		if (!perMonth) {
			perMonth = new Map();
			byTarget.set(target, perMonth);
		}
		const mk = tx.booking_date.slice(0, 7);
		perMonth.set(mk, (perMonth.get(mk) ?? 0) + pair.amount);
	}
	const notes: { target: string; monthly: number; months: number }[] = [];
	for (const [target, perMonth] of byTarget) {
		if (perMonth.size < 3) continue;
		const total = [...perMonth.values()].reduce((s, v) => s + v, 0);
		notes.push({ target, monthly: Math.round(total / perMonth.size), months: perMonth.size });
	}
	return notes.sort((a, b) => b.monthly - a.monthly);
}
