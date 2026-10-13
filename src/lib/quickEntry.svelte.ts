import type { CategoryId, Transaction } from './types';
import { categorize, CATEGORIES, txKey } from './categories';
import { subcategorize } from './subcategories';
import { SUBCATEGORIES } from './subDict';
import { classifyItemName } from './amazonOrders';
import { persistJson } from './storage';
import { budgetState, patchOverrides, setTxSubOverrides } from './budget.svelte';
import { getMerchantCategoryMap, getTransactions, addQuickEntries, removeQuickEntry, removeQuickEntries, settleDueInstalments } from './store.svelte';
import { accountState } from './accounts.svelte';
import { draftToTransaction, everydayCategory, instalmentPlan, instalmentText, instalmentTransactions, isStale, learnQuick, splitVoucherPayment, suggestFromMemory, type QuickDraft, type QuickMemory, type QuickPayment } from './quickEntry';
import { todayIso } from './forecast';
import { formatEUR } from './format';
import { addSwileSpend, addVoucherSpend, cultureVoucherBalance, hasSwile, portageState, removeSwileSpend, removeVoucher, swileCap, swileSpentOn } from './portage.svelte';
import { voucherSpendEntry, voucherSpendRank } from './portage';
import { addSharedClaim, dropClaim, hasClaim } from './refunds.svelte';

/**
 * Quick entry, app side: relay call (optional), suggested category, default account, saving with
 * the chosen category, and the « not seen on a statement yet » flag of each entry.
 */

/** Local relay of the AI analysis (address + token set on the Analyse IA page), or null. */
export function relayConfig(): { url: string; token: string } | null {
	try {
		const c = JSON.parse(localStorage.getItem('budget:ia-config') ?? 'null') as { url?: string; token?: string } | null;
		return c?.url && c.token ? { url: c.url.replace(/\/+$/, ''), token: c.token } : null;
	} catch {
		return null;
	}
}

/** Categories the AI may choose from (spending and income, no transfers). */
export const QUICK_CATEGORIES = CATEGORIES.filter((c) => c.id !== 'epargne').map((c) => ({ id: c.id, label: c.label }));
/** Their subcategories, sent to the AI with their category. */
export const QUICK_SUBCATEGORIES = SUBCATEGORIES.filter((s) => QUICK_CATEGORIES.some((c) => c.id === s.categoryId)).map((s) => ({ id: s.id, categoryId: s.categoryId, label: s.label }));

const MEMORY_KEY = 'budget:quick-memory';

function loadMemory(): QuickMemory {
	try {
		const v = JSON.parse(localStorage.getItem(MEMORY_KEY) ?? '{}') as unknown;
		return v && typeof v === 'object' && !Array.isArray(v) ? (v as QuickMemory) : {};
	} catch {
		return {};
	}
}

/** What the quick entry learned (word → category|subcategory votes), persisted in the encrypted base. */
export const quickMemoryState = $state({ memory: typeof localStorage === 'undefined' ? {} : loadMemory() });

/** Remembers the final choice of a saved entry. */
export function rememberQuick(label: string, categoryId: CategoryId, subId: string | null): void {
	quickMemoryState.memory = learnQuick(quickMemoryState.memory, label, categoryId, subId);
	persistJson(MEMORY_KEY, quickMemoryState.memory);
}

/** Forgets everything the quick entry learned. */
export function resetQuickMemory(): void {
	quickMemoryState.memory = {};
	persistJson(MEMORY_KEY, {});
}

/** Asks the relay to read the sentence; null when unavailable, busy or unreadable (the local parse stays). */
export async function askRelay(text: string, today: string): Promise<QuickDraft | null> {
	const r = relayConfig();
	if (!r) return null;
	try {
		const res = await fetch(`${r.url}/saisie`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', 'x-ia-token': r.token },
			body: JSON.stringify({ texte: text, aujourdhui: today, categories: QUICK_CATEGORIES, sousCategories: QUICK_SUBCATEGORIES }),
			signal: AbortSignal.timeout(20_000)
		});
		if (!res.ok) return null;
		const body = (await res.json()) as { brouillon?: unknown };
		return normaliseDraft(body.brouillon, today);
	} catch {
		return null;
	}
}

/** Draft returned by the relay (already checked there with readQuickAnswer), re-checked defensively. */
function normaliseDraft(v: unknown, today: string): QuickDraft | null {
	const d = v as Partial<QuickDraft> | null;
	if (!d || typeof d.label !== 'string' || typeof d.amount !== 'number' || !(d.amount > 0)) return null;
	const date = typeof d.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.date) && d.date <= today ? d.date : today;
	const cat = QUICK_CATEGORIES.some((c) => c.id === d.categoryId) ? d.categoryId : undefined;
	const sub = cat && QUICK_SUBCATEGORIES.some((s) => s.id === d.subId && s.categoryId === cat) ? d.subId : undefined;
	return { label: d.label.slice(0, 80), amount: Math.round(d.amount * 100) / 100, credit: d.credit === true, date, ...(cat ? { categoryId: cat } : {}), ...(sub ? { subId: sub } : {}) };
}

export interface QuickSuggestion {
	categoryId: CategoryId;
	subId: string | null;
	/** Where it comes from: learned word, merchant dictionary/rules, product keyword, or nothing found. */
	source: 'memory' | 'rules' | 'keyword' | 'none';
}

/**
 * Category and subcategory for a label: what was learned first, then the merchant dictionary and the
 * user's rules, then product keywords (« vinyles », « chargeur »…), else « Autre ».
 */
export function suggestCategory(label: string, credit: boolean): QuickSuggestion {
	const learned = suggestFromMemory(quickMemoryState.memory, label);
	if (learned) return { categoryId: learned.categoryId, subId: learned.subId, source: 'memory' };
	const tx: Transaction = { transaction_amount: { amount: '1.00', currency: 'EUR' }, booking_date: '2000-01-01', value_date: '2000-01-01', remittance_information: [label], credit_debit_indicator: credit ? 'CRDT' : 'DBIT' };
	const mm = getMerchantCategoryMap();
	const cat = categorize(tx, budgetState.overrides, undefined, mm);
	if (cat !== 'autre' || credit) return { categoryId: cat, subId: subcategorize(tx, budgetState.overrides, undefined, mm), source: 'rules' };
	const kw = everydayCategory(label) ?? classifyItemName(label);
	if (kw) return { categoryId: kw.categoryId, subId: kw.subId, source: 'keyword' };
	return { categoryId: 'autre', subId: null, source: 'none' };
}

/** Bank accounts an entry can belong to (current accounts first), with a short name. */
export function quickAccounts(): { id: string; label: string }[] {
	const list = accountState.accounts.filter((a) => a.kind === 'courant' || a.kind === 'livret');
	if (!list.length) return [{ id: 'cm', label: 'Compte courant' }];
	return [...list].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'courant' ? -1 : 1)).map((a) => ({ id: a.id, label: `${a.kind === 'courant' ? 'Compte courant' : 'Livret'} ••${a.last4}` }));
}

/**
 * Saves the entry with its category and subcategory (stored only when they differ from the automatic
 * ones) and remembers the choice for the next entries. Returns its key.
 */
export function saveQuickEntry(draft: QuickDraft, account: string, categoryId: CategoryId, subId: string | null): string {
	const key = keepEntry(draftToTransaction(draft, account), categoryId, subId);
	rememberQuick(draft.label, categoryId, subId);
	return key;
}

function keepEntry(tx: Transaction, categoryId: CategoryId, subId: string | null): string {
	return keepEntries([tx], categoryId, subId)[0]!;
}

/** Adds entries with the chosen category and subcategory (stored only where they differ from the automatic ones), one write each. */
function keepEntries(txs: readonly Transaction[], categoryId: CategoryId, subId: string | null): string[] {
	const keys = addQuickEntries(txs);
	const mm = getMerchantCategoryMap();
	const patch: Record<string, CategoryId> = {};
	txs.forEach((tx, i) => {
		if (categoryId !== categorize(tx, budgetState.overrides, undefined, mm)) patch[keys[i]!] = categoryId;
	});
	if (Object.keys(patch).length) patchOverrides(patch);
	setTxSubOverrides(txs.filter((tx) => subId !== subcategorize(tx, budgetState.overrides, undefined, mm)).map((tx) => ({ tx, subId })));
	return keys;
}

export { removeQuickEntry, txKey };

/** Payment means offered in the quick entry besides the bank card. */
export function voucherOptions(): { swile: boolean; culture: boolean } {
	return { swile: hasSwile(), culture: cultureVoucherBalance() > 0 };
}

/** What the voucher can still pay for that entry (Swile: daily cap minus that day's meals; culture: balance). */
export function voucherAvailable(payment: QuickPayment, date: string): number {
	if (payment === 'swile') return Math.max(0, swileCap() - swileSpentOn(date));
	if (payment === 'culture') return Math.max(0, cultureVoucherBalance());
	return 0;
}

/** Payment of an entry: the card unless the sentence names Swile or culture vouchers (and they exist). */
export function defaultPayment(named: 'swile' | 'culture' | undefined): QuickPayment {
	const o = voucherOptions();
	return named && o[named] ? named : 'card';
}

/**
 * Saves a quick entry paid by card, Swile or culture vouchers. The voucher pays what it can (Swile
 * daily cap, voucher balance); the rest becomes a card entry waiting for the statement, labelled
 * so it pairs with the bank line (« complément Swile »). A spend « pour Léa » (one payment) also
 * expects Léa's share back. Returns a summary and an undo.
 */
export function saveQuickPayment(draft: QuickDraft, account: string, categoryId: CategoryId, subId: string | null, payment: QuickPayment): { summary: string; undo: () => void } {
	const who = !draft.credit && !draft.instalments ? (draft.forWhom?.trim() ?? '') : '';
	const expectShare = (key: string | null): string => {
		if (!who || !key || hasClaim(key)) return '';
		addSharedClaim({ expenseKey: key, who, expected: draft.amount, date: draft.date, categoryId });
		return `, part attendue de ${who}`;
	};
	if (payment === 'card') {
		const today = todayIso();
		const plan = instalmentPlan(draft, today);
		if (plan.length > 1) {
			const keys = keepEntries(instalmentTransactions(draft, account, today), categoryId, subId);
			rememberQuick(draft.label, categoryId, subId);
			const settled = settleDueInstalments(today);
			const paid = keys.filter((k) => settled.get(k) === null).length;
			const left = keys.map((k) => (settled.has(k) ? settled.get(k)! : k)).filter((k): k is string => k !== null);
			const already = paid ? ` (${paid} déjà sur le relevé)` : '';
			return { summary: `en ${plan.length} fois : ${instalmentText(plan, today)}${already}`, undo: () => removeQuickEntries(left) };
		}
		const key = saveQuickEntry(draft, account, categoryId, subId);
		const owed = expectShare(key);
		return {
			summary: `à rapprocher du relevé${owed}`,
			undo: () => {
				if (owed) dropClaim(key);
				removeQuickEntry(key);
			}
		};
	}
	const split = splitVoucherPayment(draft.amount, voucherAvailable(payment, draft.date));
	const spend = { date: draft.date, montant: split.voucher, libelle: draft.label, categoryId, ...(subId ? { subId } : {}) };
	const id = split.voucher > 0 ? (payment === 'swile' ? addSwileSpend(spend) : addVoucherSpend(spend)) : null;
	const name = payment === 'swile' ? 'Swile' : 'chèques culture';
	const key = split.card > 0 ? saveQuickEntry({ ...draft, label: `${draft.label} (complément ${name})`, amount: split.card }, account, categoryId, subId) : null;
	if (!key) rememberQuick(draft.label, categoryId, subId);
	const typed = payment === 'swile' ? (portageState.data.swile ?? []) : portageState.data.cheques.depenses;
	const added = id ? typed.find((x) => x.id === id) : undefined;
	const claimKey = added ? txKey(voucherSpendEntry(added, payment, voucherSpendRank(typed, added))) : key;
	const owed = expectShare(claimKey);
	return {
		summary: `${key ? `${formatEUR(split.voucher)} en ${name}, ${formatEUR(split.card)} sur ta carte à rapprocher` : `payé en ${name}`}${owed}`,
		undo: () => {
			if (owed && claimKey) dropClaim(claimKey);
			if (id) (payment === 'swile' ? removeSwileSpend : removeVoucher)(id);
			if (key) removeQuickEntry(key);
		}
	};
}

/** Latest statement date of each account (quick entries excluded): base of the « not seen yet » flag. */
const lastStatementByAccount = $derived.by(() => {
	const m = new Map<string, string>();
	for (const tx of getTransactions()) {
		if (tx.source === 'manual' || !tx.booking_date) continue;
		const acc = tx.account ?? 'cm';
		if ((m.get(acc) ?? '') < tx.booking_date) m.set(acc, tx.booking_date);
	}
	return m;
});

/** Quick entry still absent from a statement that covers more than a week after it. */
export function quickEntryStale(tx: Transaction): boolean {
	return tx.source === 'manual' && isStale(tx, lastStatementByAccount.get(tx.account ?? 'cm'));
}
