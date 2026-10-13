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
	/** Shared with the payer, who gives back their share: one transfer worth SHARE_MIN to SHARE_MAX of the open shared spends settles them. */
	shared?: boolean;
}

/** Share of a shared spend a transfer must reach to settle it (40 %), and the most it may exceed it by. */
export const SHARE_MIN = 0.4;
export const SHARE_MAX = 1.1;
/** Share counted as still owed on an unpaid shared spend (half: what a payer usually gives back). */
export const SHARE_OWED = 0.5;
/** Most open shared spends of one payer weighed against a transfer (the latest ones). */
const SHARE_SET_CAP = 10;

/** Transfers that settle shared spends worth `total`. */
export function shareRange(total: number): { min: number; max: number } {
	return { min: r2(total * SHARE_MIN), max: r2(total * SHARE_MAX) };
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
 * Shared spends are settled first by `settleShared`.
 */
export function matchRefunds(claims: readonly RefundClaim[], credits: readonly Credit[], today: string, dueDays = 15, extraHealthNames: readonly string[] = []): ClaimStatus[] {
	const left = new Map(credits.map((c) => [c.key, c.amount]));
	const sortedCredits = [...credits].sort((a, b) => a.date.localeCompare(b.date));
	const order = claims.map((claim, i) => ({ claim, i })).sort((a, b) => a.claim.date.localeCompare(b.claim.date));
	const settled = settleShared(order, sortedCredits, left, extraHealthNames);
	const out: ClaimStatus[] = new Array(claims.length);
	for (const { claim, i } of order) {
		const age = (utc(today) - utc(claim.date)) / DAY;
		if (claim.shared) {
			const share = settled.get(i);
			const state: ClaimStatus['state'] = claim.closed ? 'closed' : share ? 'refunded' : age > dueDays ? 'overdue' : 'pending';
			out[i] = { claim, payments: share ? [share] : [], refunded: share?.amount ?? 0, remaining: share ? 0 : r2(claim.expected * SHARE_OWED), state };
			continue;
		}
		const payments: ClaimStatus['payments'] = [];
		let refunded = 0;
		for (const c of sortedCredits) {
			if (refunded >= claim.expected - 0.005) break;
			const avail = left.get(c.key) ?? 0;
			if (avail <= 0.005) continue;
			if (!followsWithin90(claim, c) || !creditFrom(claim, c.label, extraHealthNames)) continue;
			const part = r2(Math.min(avail, claim.expected - refunded));
			left.set(c.key, r2(avail - part));
			refunded = r2(refunded + part);
			payments.push({ key: c.key, date: c.date, amount: part, label: c.label });
		}
		const remaining = r2(Math.max(0, claim.expected - refunded));
		const tolerance = claim.source === 'sante' ? HEALTH_TOLERANCE : 0.005;
		const state: ClaimStatus['state'] = claim.closed ? 'closed' : remaining <= tolerance ? 'refunded' : age > dueDays ? 'overdue' : refunded > 0 ? 'partial' : 'pending';
		out[i] = { claim, payments, refunded, remaining, state };
	}
	return out;
}

function followsWithin90(claim: RefundClaim, c: Credit): boolean {
	const days = (utc(c.date) - utc(claim.date)) / DAY;
	return days >= 0 && days <= 90;
}

/**
 * Shared spends: each transfer from the payer (oldest first) settles some of their open shared
 * spends of the 90 days before it: the set whose total puts the transfer between SHARE_MIN and
 * SHARE_MAX of it, nearest to half or all of it (more spends, then older ones, on a tie). The whole
 * transfer goes to that set, split pro rata. A transfer that repays exactly an open plain claim of
 * that payer (a loan, an advance) is left to it.
 */
function settleShared(order: readonly { claim: RefundClaim; i: number }[], credits: readonly Credit[], left: Map<string, number>, extraHealthNames: readonly string[]): Map<number, ClaimStatus['payments'][number]> {
	const settled = new Map<number, ClaimStatus['payments'][number]>();
	const shared = order.filter((o) => o.claim.shared && !o.claim.closed);
	if (!shared.length) return settled;
	const plain = order.filter((o) => !o.claim.shared && !o.claim.closed);
	for (const c of credits) {
		const from = (claim: RefundClaim) => followsWithin90(claim, c) && creditFrom(claim, c.label, extraHealthNames);
		if (plain.some(({ claim }) => Math.abs(claim.expected - c.amount) < 0.01 && from(claim))) continue;
		const open = shared.filter(({ claim, i }) => !settled.has(i) && from(claim)).slice(-SHARE_SET_CAP);
		const set = bestShareSet(open.map((o) => o.claim.expected), c.amount);
		if (!set) continue;
		const picked = set.map((j) => open[j]!);
		const total = r2(picked.reduce((sum, o) => sum + o.claim.expected, 0));
		let given = 0;
		picked.forEach(({ claim, i }, j) => {
			const amount = j === picked.length - 1 ? r2(c.amount - given) : r2((c.amount * claim.expected) / total);
			given = r2(given + amount);
			settled.set(i, { key: c.key, date: c.date, amount, label: c.label });
		});
		left.set(c.key, 0);
	}
	return settled;
}

/** Indexes (oldest first) of the spends a transfer most likely pays back, or null when no set fits the share range. */
function bestShareSet(amounts: readonly number[], paid: number): number[] | null {
	let best: { set: number[]; gap: number } | null = null;
	for (let mask = 1; mask < 1 << amounts.length; mask++) {
		const set = amounts.map((_, j) => j).filter((j) => mask & (1 << j));
		const total = r2(set.reduce((sum, j) => sum + amounts[j]!, 0));
		const { min, max } = shareRange(total);
		if (paid < min - 0.005 || paid > max + 0.005) continue;
		const ratio = paid / total;
		const gap = Math.round(Math.min(Math.abs(ratio - 0.5), Math.abs(ratio - 1)) * 1000);
		const better = !best || gap < best.gap || (gap === best.gap && (set.length > best.set.length || (set.length === best.set.length && set.join() < best.set.join())));
		if (better) best = { set, gap };
	}
	return best?.set ?? null;
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
