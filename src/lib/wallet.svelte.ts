import type { CategoryId, Transaction } from './types';
import { persistJson } from './storage';
import { txKey } from './categories';
import { getTransactions } from './store.svelte';
import { todayIso } from './forecast';
import { sensitiveEUR, sensitiveEURCompact } from './format';
import {
	cashEntryList,
	emptyWallet,
	keyRank,
	needsCheck,
	readWallet,
	shownBalance,
	storedWallet,
	walletBalance,
	walletStartFor,
	walletWithdrawals,
	withConfirmedBalance,
	withdrawalsOf,
	withItemBack,
	withoutCheck,
	withoutItem,
	withStart,
	withWriteOff,
	type CashSpend,
	type CashWallet,
	type Withdrawal
} from './wallet';

/**
 * Cash wallet, app side (`budget:cash-wallet`): cash spends typed in the quick entry, write-offs,
 * last check. Its start is never stored: it is derived from them and the withdrawals on every read
 * (walletStart), so a withdrawal the statement brings after the spends it paid for joins the wallet
 * by itself. Its entries join getBudgetTransactions() (never the balances) and the withdrawals from
 * its start leave the budget by a derived rule (transfers.svelte.ts), never written into the
 * internal-transfer list.
 */

export const WALLET_KEY = 'budget:cash-wallet';

const canStore = typeof localStorage !== 'undefined';

function load(): CashWallet {
	if (!canStore) return emptyWallet();
	try {
		return readWallet(JSON.parse(localStorage.getItem(WALLET_KEY) ?? 'null'));
	} catch {
		return emptyWallet();
	}
}

const stored = $state({ wallet: load() });

/** Replaces the stored wallet (never its start, derived) and persists it. */
function save(w: CashWallet): void {
	stored.wallet = storedWallet(w);
	if (canStore) persistJson(WALLET_KEY, stored.wallet);
}

const uid = (p: string) => `${p}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;

const withdrawals = $derived(withdrawalsOf(getTransactions(), txKey));
const withdrawalDates = $derived(withdrawals.map((w) => w.date));
const current = $derived(withStart(stored.wallet, withdrawalDates));
const insideKeys = $derived(new Set(walletWithdrawals(withdrawals, current.start).map((w) => w.key)));
const list = $derived(cashEntryList(stored.wallet));
const entries = $derived(list.map((e) => e.tx));
const idByKey = $derived(new Map(list.map((e) => [txKey(e.tx), e.id])));
const balance = $derived(walletBalance(current, withdrawals));

/** The wallet as the app reads it (read-only, changed through the functions below): what is stored, with its start derived from the withdrawals. */
export const walletState = {
	get wallet(): CashWallet {
		return current;
	}
};

/** Budget entries of the wallet (spends, cash received, write-offs): budget only, never the balances. */
export function getCashEntries(): Transaction[] {
	return entries;
}

/** Withdrawal that went into the wallet (on or after its start): out of the budget, still in the balances. */
export function isWalletWithdrawal(key: string): boolean {
	return insideKeys.has(key);
}

/** Keys of the withdrawals that went into the wallet. */
export function walletWithdrawalKeys(): ReadonlySet<string> {
	return insideKeys;
}

/** Has the wallet started (first cash spend, or a check)? */
export function walletStarted(): boolean {
	return !!current.start;
}

/** Withdrawal a first cash spend on `date` would start the wallet with (latest taken in the previous 31 days), null when none (it starts on the spend day). */
export function cashStartPreview(date: string): Withdrawal | null {
	if (walletStarted()) return null;
	const start = walletStartFor(date, withdrawalDates);
	return withdrawals.find((w) => w.date === start) ?? null;
}

/** Exact balance (can be negative when cash came from elsewhere). */
export function cashBalance(): number {
	return balance;
}

/** Balance as shown, never below 0 €. */
export function shownCashBalance(): number {
	return shownBalance(balance);
}

/** Text of the payment chip: « Liquide », then « Liquide · 40 € » once the wallet has started (masked in privacy mode). */
export function cashChipLabel(): string {
	if (!walletStarted()) return 'Liquide';
	const b = shownCashBalance();
	return `Liquide · ${Number.isInteger(b) ? sensitiveEURCompact(b) : sensitiveEUR(b)}`;
}

/** Id of the wallet spend or write-off behind a budget entry key, if any. */
export function cashItemOf(key: string): string | undefined {
	return idByKey.get(key);
}

/** Key of the budget entry of a spend or write-off, null when it no longer exists. */
export function cashEntryKey(id: string): string | null {
	const e = list.find((x) => x.id === id);
	return e ? txKey(e.tx) : null;
}

/**
 * Adds a cash spend (or cash received, `credit`), its key of its own (keyRank). The start follows
 * by itself (walletStart): a first spend opens the wallet at the latest withdrawal taken in the
 * previous 31 days, else on its own date, cash received on its own date, and a withdrawal the
 * statement brings later still joins. Returns its id, the key of its budget entry and an undo.
 */
export function addCashSpend(d: Omit<CashSpend, 'id' | 'dup'>): { id: string; key: string; undo: () => void } {
	const id = uid('cash');
	save({ ...stored.wallet, spends: [...stored.wallet.spends, { id, ...d, dup: keyRank(id) }] });
	return {
		id,
		key: cashEntryKey(id) ?? '',
		undo: () => save(withoutItem(stored.wallet, id))
	};
}

/**
 * Removes a cash spend, cash received or a write-off: the start follows what is left, and the
 * wallet closes when nothing is left (withoutItem). Returns an undo that puts it back in place.
 * Its key is never handed to another spend (keyRank), so what was set on it stays with it.
 */
export function removeCashItem(id: string): () => void {
	const before = stored.wallet;
	save(withoutItem(before, id));
	return () => save(withItemBack(stored.wallet, before, id));
}

/** Changes the category of a cash spend (its budget entry keeps its key). */
export function setCashSpendCategory(id: string, categoryId: CategoryId, subId: string | null): void {
	const w = stored.wallet;
	save({
		...w,
		spends: w.spends.map((s) => {
			if (s.id !== id) return s;
			const next: CashSpend = { ...s, categoryId };
			if (subId) next.subId = subId;
			else delete next.subId;
			return next;
		})
	});
}

/** Should the app ask whether the cash is still there (positive balance, no cash entry for 30 days; withdrawals do not count)? */
export function walletNeedsCheck(today: string = todayIso()): boolean {
	return needsCheck(current, withdrawals, today);
}

/**
 * Records the check of the wallet on `today`. `counted`: cash actually in hand (the shown balance
 * when omitted); less writes off the difference, more raises the starting amount. Returns an undo
 * of what the check added only (withoutCheck): a cash spend typed since stays.
 */
export function confirmWalletBalance(today: string = todayIso(), counted?: number): () => void {
	const before = stored.wallet;
	const after = storedWallet(withConfirmedBalance(current, withdrawals, today, uid('cash-off'), counted));
	save(after);
	return () => save(withoutCheck(stored.wallet, before, after));
}

/**
 * Turns the remaining balance into a « Liquide non détaillé » spend in « Autre » on `today`, so
 * forgotten spends never vanish from the totals. Returns the amount and an undo, null when the
 * balance is not positive.
 */
export function writeOffCash(today: string = todayIso()): { amount: number; undo: () => void } | null {
	const id = uid('cash-off');
	const next = withWriteOff(current, withdrawals, today, id);
	if (!next) return null;
	save(next);
	return {
		amount: next.writeOffs.at(-1)!.amount,
		undo: () => {
			removeCashItem(id);
		}
	};
}
