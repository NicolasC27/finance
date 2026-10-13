import type { CategoryId, Transaction } from './types';
import { categorize, txKey } from './categories';
import { subcategorize } from './subcategories';
import { signedAmount } from './data';
import { merchantLabel } from './merchant';
import { cleanLabel } from './format';
import { persistJson } from './storage';
import { budgetState, setOverride } from './budget.svelte';
import { getMerchantCategoryMap, getTransactions, onQuickEntryReplaced } from './store.svelte';
import { getPortageEntries } from './portage.svelte';
import { getCashEntries } from './wallet.svelte';
import { autoClaims, creditsOf, matchRefunds, totalOwed, type ClaimStatus, type RefundClaim, type RefundSource } from './refunds';

/**
 * Expected refunds, app side (`budget:refunds`): claims typed by hand, automatic ones dismissed or
 * closed, delay before an alert; statuses recomputed from the operations; credits that refund an
 * expense are moved once into the expense's category so the budget counts the net expense.
 */

const KEY = 'budget:refunds';

interface StoredRefunds {
	claims: RefundClaim[];
	dismissed: string[];
	closed: string[];
	/** Credits already moved into their expense's category (never moved again). */
	netted: string[];
	dueDays: number;
}

function load(): StoredRefunds {
	const empty: StoredRefunds = { claims: [], dismissed: [], closed: [], netted: [], dueDays: 15 };
	if (typeof localStorage === 'undefined') return empty;
	try {
		const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<StoredRefunds> | null;
		if (!v || typeof v !== 'object') return empty;
		const list = (x: unknown) => (Array.isArray(x) ? x.filter((k): k is string => typeof k === 'string') : []);
		return {
			claims: Array.isArray(v.claims) ? v.claims.filter((c) => c && typeof c.expenseKey === 'string' && typeof c.expected === 'number') : [],
			dismissed: list(v.dismissed),
			closed: list(v.closed),
			netted: list(v.netted),
			dueDays: typeof v.dueDays === 'number' && v.dueDays >= 1 && v.dueDays <= 365 ? v.dueDays : 15
		};
	} catch {
		return empty;
	}
}

export const refundsState = $state(load());

function persist(): void {
	persistJson(KEY, refundsState);
}

const today = () => new Date().toISOString().slice(0, 10);
const labelOf = (tx: Transaction) => merchantLabel(tx.remittance_information) || cleanLabel(tx.remittance_information);

/** Names of the user's mutuelle(s), read from their direct debits (subcategory « mutuelle »). */
const mutuelleNames = $derived.by(() => {
	const mm = getMerchantCategoryMap();
	const names = new Set<string>();
	for (const tx of getTransactions()) if (signedAmount(tx) < 0 && subcategorize(tx, budgetState.overrides, undefined, mm) === 'mutuelle') names.add(labelOf(tx));
	return [...names];
});

/** Every claim: typed by hand (while their operation exists), plus automatic ones (health visits, advances) not dismissed. */
const claims = $derived.by((): RefundClaim[] => {
	const mm = getMerchantCategoryMap();
	const present = new Set([...getTransactions(), ...getPortageEntries(), ...getCashEntries()].map(txKey));
	const manual = new Map(refundsState.claims.filter((c) => present.has(c.expenseKey)).map((c) => [c.expenseKey, c]));
	const expenses = getTransactions()
		.filter((tx) => signedAmount(tx) < 0 && tx.booking_date)
		.map((tx) => ({ key: txKey(tx), date: tx.booking_date, amount: -signedAmount(tx), label: labelOf(tx), categoryId: categorize(tx, budgetState.overrides, undefined, mm), subId: subcategorize(tx, budgetState.overrides, undefined, mm) }));
	const auto = autoClaims(expenses, today()).filter((c) => !manual.has(c.expenseKey) && !refundsState.dismissed.includes(c.expenseKey));
	const closed = new Set(refundsState.closed);
	return [...manual.values(), ...auto].map((c) => (closed.has(c.expenseKey) ? { ...c, closed: true } : c));
});

const statuses = $derived(matchRefunds(claims, creditsOf(getTransactions(), txKey, signedAmount), today(), refundsState.dueDays, mutuelleNames));
const byExpense = $derived(new Map(statuses.map((s) => [s.claim.expenseKey, s])));
const byCredit = $derived.by(() => {
	const m = new Map<string, ClaimStatus[]>();
	for (const s of statuses) for (const p of s.payments) m.set(p.key, [...(m.get(p.key) ?? []), s]);
	return m;
});

export function getRefundStatuses(): ClaimStatus[] {
	return statuses;
}

/** Claim of an expense operation, if any. */
export function refundOf(expenseKey: string): ClaimStatus | undefined {
	return byExpense.get(expenseKey);
}

/** Claims an incoming credit pays back (one transfer can refund several expenses). */
export function refundedBy(creditKey: string): ClaimStatus[] {
	return byCredit.get(creditKey) ?? [];
}

export function getTotalOwed(): number {
	return totalOwed(statuses);
}

/** Marks an expense « to be refunded » (or updates its claim). */
export function addClaim(tx: Transaction, c: { source: RefundSource; who: string; expected: number; shared?: boolean }): void {
	const who = c.who.trim() || (c.source === 'sante' ? 'Sécu + mutuelle' : labelOf(tx));
	putClaim({ expenseKey: txKey(tx), source: c.source, who, expected: c.expected, date: tx.booking_date, categoryId: categorize(tx, budgetState.overrides, undefined, getMerchantCategoryMap()), auto: false, ...(c.shared && c.source === 'personne' ? { shared: true } : {}) });
}

/** Spend shared with someone who pays back their share (quick entry « pour Léa »). */
export function addSharedClaim(c: { expenseKey: string; who: string; expected: number; date: string; categoryId: CategoryId }): void {
	putClaim({ ...c, who: c.who.trim(), source: 'personne', auto: false, shared: true });
}

/** Has this operation a claim typed by hand? */
export function hasClaim(expenseKey: string): boolean {
	return refundsState.claims.some((c) => c.expenseKey === expenseKey);
}

function putClaim(claim: RefundClaim): void {
	const key = claim.expenseKey;
	refundsState.claims = [...refundsState.claims.filter((x) => x.expenseKey !== key), { ...claim, expected: Math.round(claim.expected * 100) / 100 }];
	refundsState.dismissed = refundsState.dismissed.filter((k) => k !== key);
	refundsState.closed = refundsState.closed.filter((k) => k !== key);
	persist();
}

/** Forgets the claim of an expense without dismissing it (undo of the entry that held it). */
export function dropClaim(expenseKey: string): void {
	refundsState.claims = refundsState.claims.filter((x) => x.expenseKey !== expenseKey);
	refundsState.closed = refundsState.closed.filter((k) => k !== expenseKey);
	persist();
}

/**
 * A claim follows its operation when the key changes (quick entry replaced by the bank operation at
 * import, or back on undo; identical voucher spends renumbered). A claim already on `to` wins.
 * Returns whether a claim moved.
 */
export function moveClaim(from: string, to: string): boolean {
	if (from === to || !hasClaim(from) || hasClaim(to)) return false;
	refundsState.claims = refundsState.claims.map((c) => (c.expenseKey === from ? { ...c, expenseKey: to } : c));
	refundsState.closed = refundsState.closed.map((k) => (k === from ? to : k));
	persist();
	return true;
}
onQuickEntryReplaced(moveClaim);

/** People already named in a shared spend: a lowercase « pour léa » is then understood. */
export function knownPeople(): string[] {
	return [...new Set(refundsState.claims.filter((c) => c.shared).map((c) => c.who))];
}

/** Nothing to expect for this expense (an automatic claim stays dismissed). */
export function removeClaim(expenseKey: string): void {
	refundsState.claims = refundsState.claims.filter((x) => x.expenseKey !== expenseKey);
	if (!refundsState.dismissed.includes(expenseKey)) refundsState.dismissed = [...refundsState.dismissed, expenseKey];
	persist();
}

/** Closes a claim by hand (what is missing will not come), or reopens it. */
export function setClaimClosed(expenseKey: string, closed: boolean): void {
	refundsState.closed = closed ? [...new Set([...refundsState.closed, expenseKey])] : refundsState.closed.filter((k) => k !== expenseKey);
	persist();
}

export function setDueDays(days: number): void {
	if (!(days >= 1 && days <= 365)) return;
	refundsState.dueDays = Math.round(days);
	persist();
}

/**
 * Moves each refund credit once into the category of the expense it pays back (Sécu refund →
 * Santé), so the budget shows the net expense; a later manual change of the credit is kept.
 */
export function syncRefundCategories(): void {
	const mm = getMerchantCategoryMap();
	const byKey = new Map(getTransactions().map((tx) => [txKey(tx), tx]));
	const done = new Set(refundsState.netted);
	const fresh: string[] = [];
	for (const s of statuses) {
		for (const p of s.payments) {
			if (done.has(p.key)) continue;
			const tx = byKey.get(p.key);
			if (!tx) continue;
			const target: CategoryId = s.claim.categoryId;
			if (categorize(tx, budgetState.overrides, undefined, mm) !== target) setOverride(p.key, target);
			done.add(p.key);
			fresh.push(p.key);
		}
	}
	if (fresh.length) {
		refundsState.netted = [...refundsState.netted, ...fresh].slice(-2000);
		persist();
	}
}
