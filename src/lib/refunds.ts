import type { CategoryId, Transaction } from './types';

/**
 * Expected refunds (pure, testable): money owed back after an expense — health insurance and
 * mutuelle after a doctor's visit, money advanced to someone, a returned purchase. Incoming credits
 * are matched to the claims (several transfers allowed), overdue claims are flagged.
 */

export type RefundSource = 'sante' | 'personne' | 'magasin';

export interface RefundClaim {
	/** Key of the expense operation (txKey). */
	expenseKey: string;
	source: RefundSource;
	/** Who pays back: person's name, shop, « Sécu + mutuelle ». */
	who: string;
	/** Amount expected back (€, positive). */
	expected: number;
	/** Expense date (AAAA-MM-JJ). */
	date: string;
	categoryId: CategoryId;
	/** Created automatically (health visit, advance to a relative) rather than by hand. */
	auto: boolean;
	/** Closed by hand (« soldé ») even if not fully refunded. */
	closed?: boolean;
}

export interface Credit {
	key: string;
	date: string;
	amount: number;
	label: string;
}

export interface ClaimStatus {
	claim: RefundClaim;
	/** Credits allocated to this claim (part of each credit). */
	payments: { key: string; date: string; amount: number; label: string }[];
	refunded: number;
	remaining: number;
	state: 'pending' | 'partial' | 'refunded' | 'overdue' | 'closed';
}

const DAY = 86_400_000;
/** What health insurance never refunds on a visit (flat fee), in €. */
export const HEALTH_TOLERANCE = 4;
const utc = (d: string) => Date.parse(`${d}T00:00:00Z`);
const r2 = (n: number) => Math.round(n * 100) / 100;

const HEALTH_RE = /\b(CPAM|AMELI|ASSURANCE MALADIE|CAISSE PRIMAIRE|CNAM|MUTUELLE|MGEN|HARMONIE|ALAN|MALAKOFF|SWISSLIFE|AG2R|APRIL|MAIF SANTE|MAAF SANTE|MATMUT SANTE|GROUPAMA|AXA|GENERALI|ALLIANZ|HUMANIS|KLESIA|UNEO|MUTEX|ADREA|SOLIMUT|VIASANTE|IDENTITES|LA MUTUELLE GENERALE|LMDE|SMERRA|PREVOYANCE|REMBOURSEMENT SOINS|PRESTATION)\b/i;

/** Normalised words of a label (accents removed, 3+ letters). */
function words(s: string): string[] {
	return s.toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^A-Z0-9]+/).filter((w) => w.length >= 3);
}

/**
 * Does a credit look like it comes from the claim's payer? Health: insurance and mutuelle names
 * (plus the user's own mutuelle seen in their direct debits); person or shop: a word of their name.
 */
export function creditFrom(claim: RefundClaim, label: string, extraHealthNames: readonly string[] = []): boolean {
	if (claim.source === 'sante') {
		if (HEALTH_RE.test(label)) return true;
		const w = new Set(words(label));
		return extraHealthNames.some((n) => words(n).some((x) => w.has(x)));
	}
	const noise = new Set(['PAIEMENT', 'CARTE', 'VIR', 'VIREMENT', 'INST', 'SEPA', 'RECU', 'DEPUIS', 'REMBOURSEMENT', 'AVOIR', 'REMB']);
	const target = words(claim.who).filter((w) => !noise.has(w));
	const w = new Set(words(label));
	return target.some((x) => w.has(x));
}

/**
 * Allocates incoming credits to the claims: a credit must follow the expense (same day to 90 days
 * after) and come from the claim's payer; it pays the oldest open claims of that payer first and
 * can be split between them (one transfer for several visits), a claim can be paid in several
 * transfers. A claim not fully refunded after `dueDays` is overdue. Health claims count as refunded
 * once at most HEALTH_TOLERANCE € is missing (the non-refundable flat fee per visit).
 */
export function matchRefunds(claims: readonly RefundClaim[], credits: readonly Credit[], today: string, dueDays = 15, extraHealthNames: readonly string[] = []): ClaimStatus[] {
	const left = new Map(credits.map((c) => [c.key, c.amount]));
	const sortedCredits = [...credits].sort((a, b) => a.date.localeCompare(b.date));
	const order = claims.map((claim, i) => ({ claim, i })).sort((a, b) => a.claim.date.localeCompare(b.claim.date));
	const out: ClaimStatus[] = new Array(claims.length);
	for (const { claim, i } of order) {
		const payments: ClaimStatus['payments'] = [];
		let refunded = 0;
		for (const c of sortedCredits) {
			if (refunded >= claim.expected - 0.005) break;
			const avail = left.get(c.key) ?? 0;
			if (avail <= 0.005) continue;
			const days = (utc(c.date) - utc(claim.date)) / DAY;
			if (days < 0 || days > 90 || !creditFrom(claim, c.label, extraHealthNames)) continue;
			const part = r2(Math.min(avail, claim.expected - refunded));
			left.set(c.key, r2(avail - part));
			refunded = r2(refunded + part);
			payments.push({ key: c.key, date: c.date, amount: part, label: c.label });
		}
		const remaining = r2(Math.max(0, claim.expected - refunded));
		const tolerance = claim.source === 'sante' ? HEALTH_TOLERANCE : 0.005;
		const age = (utc(today) - utc(claim.date)) / DAY;
		const state: ClaimStatus['state'] = claim.closed ? 'closed' : remaining <= tolerance ? 'refunded' : age > dueDays ? 'overdue' : refunded > 0 ? 'partial' : 'pending';
		out[i] = { claim, payments, refunded, remaining, state };
	}
	return out;
}

/**
 * Claims created automatically: visits to a practitioner (subcategory « soins ») are refunded by
 * health insurance and mutuelle, money advanced to a relative (« avances ») by that person, both
 * for the whole amount, over the last `days` days.
 */
export function autoClaims(expenses: readonly { key: string; date: string; amount: number; label: string; categoryId: CategoryId; subId: string | null }[], today: string, days = 120): RefundClaim[] {
	const from = utc(today) - days * DAY;
	return expenses
		.filter((e) => (e.subId === 'soins' || e.subId === 'avances') && utc(e.date) >= from && e.amount > 0)
		.map((e) => ({
			expenseKey: e.key,
			source: e.subId === 'soins' ? 'sante' : 'personne',
			who: e.subId === 'soins' ? 'Sécu + mutuelle' : e.label,
			expected: r2(e.amount),
			date: e.date,
			categoryId: e.categoryId,
			auto: true
		}));
}

/** Total still owed by the open claims (pending, partial, overdue). */
export function totalOwed(statuses: readonly ClaimStatus[]): number {
	return r2(statuses.filter((s) => s.state !== 'refunded' && s.state !== 'closed').reduce((sum, s) => sum + s.remaining, 0));
}

/** Credit operations usable for matching: incoming money (signed amount > 0). */
export function creditsOf(txs: readonly Transaction[], key: (tx: Transaction) => string, signed: (tx: Transaction) => number): Credit[] {
	return txs.filter((tx) => signed(tx) > 0 && tx.booking_date).map((tx) => ({ key: key(tx), date: tx.booking_date, amount: r2(signed(tx)), label: tx.remittance_information.join(' ') }));
}
