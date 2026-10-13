import type { CategoryId, Transaction } from './types';
import { CASH_WRITE_OFF_LABEL, CATEGORIES } from './categories';
import { isWealthLine } from './scope';
import { isComputedEntry } from './data';
import { effectiveDate } from './vacationDate';

/**
 * Cash wallet (pure, testable): cash taken at an ATM goes into a separate wallet instead of
 * counting as spending in « Autre ». From the wallet start, withdrawals are transfers into it (left
 * out of the budget, still in the bank balances) and each cash spend typed in the quick entry counts
 * as an entry outside the bank (account 'liquide', source 'cash'), in its typed category unless an
 * override or a holiday moves it, like a bank operation. Earlier withdrawals keep counting as
 * before. The start is never stored: it is derived each time from what the wallet holds and the
 * withdrawals (walletStart), so a withdrawal booked or imported after the spends it paid for still
 * joins the wallet, whatever the order of entry. A withdrawal is dated by the day the cash was taken
 * (the JJMM of « RETRAIT DAB 3009 »), not by the later booking. What is never detailed can be
 * written off as « Liquide non détaillé » in « Autre » (never « Vacances »), so no euro taken out
 * vanishes from the totals.
 */

/** Account of the wallet entries: never a bank account, never in the balances. */
export const CASH_ACCOUNT = 'liquide';
/** Days a withdrawal can come before a cash spend and still be where its cash came from. */
export const START_LOOKBACK_DAYS = 31;
/** Days without any movement after which a positive balance asks to be checked. */
export const CHECK_AFTER_DAYS = 30;
/** Label of the budget entry of a write-off. */
export const WRITE_OFF_LABEL = CASH_WRITE_OFF_LABEL;

export interface CashSpend {
	id: string;
	/** AAAA-MM-JJ. */
	date: string;
	label: string;
	/** Positive amount (€). */
	amount: number;
	categoryId: CategoryId;
	/** Subcategory id (must belong to categoryId). */
	subId?: string;
	/** Person the spend was for, who pays back their share (« pour Léa »). */
	forWhom?: string;
	/** Money received in cash (a sale, a share paid back): it fills the wallet. */
	credit?: true;
	/** Rank in the key of its budget entry, set once from its id (keyRank) so that key is its own: never handed to another spend, never shifted when one is removed. */
	dup?: number;
}

/** Cash left in the wallet and never detailed, counted in « Autre » on its date. */
export interface CashWriteOff {
	id: string;
	date: string;
	amount: number;
	/** Start of the wallet when it was written off: that balance came from its withdrawals since then, so the wallet never starts later. */
	start?: string;
}

export interface CashWallet {
	/** First day of the wallet, withdrawals from that day on (inclusive) fill it: derived (withStart) on the wallet the app reads, never stored. */
	start?: string;
	/** Cash already in hand on the start day (0 when not set). */
	startAmount?: number;
	spends: CashSpend[];
	writeOffs: CashWriteOff[];
	/** Last balance the user confirmed, with the start it was confirmed with (the wallet never starts later: its withdrawals stay in). */
	check?: { date: string; balance: number; start?: string };
}

/** ATM withdrawal of a bank account: its key, the day the cash was taken (withdrawalDate), the day it was booked and its amount. */
export interface Withdrawal {
	key: string;
	/** Day the cash was taken ('' while undated): decides whether it fills the wallet. */
	date: string;
	/** Day the bank booked it, when its balance dropped (`date` when absent). */
	booked?: string;
	amount: number;
}

const DAY = 86_400_000;
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const WITHDRAWAL_RE = /^RETRAITS?\b/i;
const CATEGORY_IDS: ReadonlySet<string> = new Set(CATEGORIES.map((c) => c.id));
const utc = (d: string) => Date.parse(`${d}T00:00:00Z`);
const isoOf = (t: number) => new Date(t).toISOString().slice(0, 10);
const r2 = (n: number) => Math.round(n * 100) / 100;
const sum = (list: readonly { amount: number }[]) => list.reduce((s, x) => s + x.amount, 0);
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const isDate = (v: unknown): v is string => typeof v === 'string' && ISO_RE.test(v) && !Number.isNaN(utc(v));
const isAmount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 1_000_000;
const later = (a: string, b: string) => (b > a ? b : a);

export function emptyWallet(): CashWallet {
	return { spends: [], writeOffs: [] };
}

/**
 * Stored wallet read defensively: an unknown shape gives an empty wallet, invalid items are dropped.
 * A start stored by an earlier version is not kept (it is derived now, walletStart): it only
 * becomes the start of a write-off or a check stored without theirs, whose balance came from its
 * withdrawals (they would count twice if the wallet started later).
 */
export function readWallet(v: unknown): CashWallet {
	if (!v || typeof v !== 'object' || Array.isArray(v)) return emptyWallet();
	const o = v as Record<string, unknown>;
	const kept = (start: unknown): { start?: string } => (isDate(start) ? { start } : isDate(o.start) ? { start: o.start } : {});
	const spends = (Array.isArray(o.spends) ? o.spends : []).flatMap((x): CashSpend[] => {
		const s = x as Partial<CashSpend> | null;
		if (!s || typeof s.id !== 'string' || !isDate(s.date) || typeof s.label !== 'string' || !isAmount(s.amount) || typeof s.categoryId !== 'string' || !CATEGORY_IDS.has(s.categoryId)) return [];
		return [{ id: s.id, date: s.date, label: s.label, amount: r2(s.amount), categoryId: s.categoryId, ...(typeof s.subId === 'string' && s.subId ? { subId: s.subId } : {}), ...(typeof s.forWhom === 'string' && s.forWhom.trim() ? { forWhom: s.forWhom.trim() } : {}), ...(s.credit === true ? { credit: true as const } : {}), ...(typeof s.dup === 'number' && Number.isInteger(s.dup) && s.dup > 0 ? { dup: s.dup } : {}) }];
	});
	const writeOffs = (Array.isArray(o.writeOffs) ? o.writeOffs : []).flatMap((x): CashWriteOff[] => {
		const w = x as Partial<CashWriteOff> | null;
		return w && typeof w.id === 'string' && isDate(w.date) && isAmount(w.amount) ? [{ id: w.id, date: w.date, amount: r2(w.amount), ...kept(w.start) }] : [];
	});
	const check = o.check as { date?: unknown; balance?: unknown; start?: unknown } | undefined;
	return {
		...(typeof o.startAmount === 'number' && Number.isFinite(o.startAmount) && o.startAmount > 0 ? { startAmount: r2(o.startAmount) } : {}),
		spends,
		writeOffs,
		...(check && isDate(check.date) && typeof check.balance === 'number' && Number.isFinite(check.balance) ? { check: { date: check.date, balance: r2(check.balance), ...kept(check.start) } } : {})
	};
}

/** ATM withdrawal from a bank account: a debit labelled « RETRAIT … » (« RETRAIT DAB 1507 … ») or filed by the bank under « Retrait »; never a wealth line (Kraken, Natixis). */
export function isCashWithdrawal(tx: Transaction): boolean {
	if (tx.credit_debit_indicator !== 'DBIT' || isComputedEntry(tx) || isWealthLine(tx)) return false;
	return WITHDRAWAL_RE.test(tx.remittance_information.join(' ').trim()) || /^retraits?\b/.test(fold(tx.bank_category ?? ''));
}

/**
 * Day the cash was taken: the JJMM of the label (« RETRAIT DAB 3009 » booked on 2 Oct. → 30 Sept.,
 * see vacationDate.ts), else the booking or value date; '' while undated (pending).
 */
export function withdrawalDate(tx: Transaction): string {
	const day = tx.booking_date || tx.value_date;
	return day ? effectiveDate({ ...tx, booking_date: day }) : '';
}

/** Withdrawals among the operations, in their order. */
export function withdrawalsOf(txs: readonly Transaction[], keyOf: (tx: Transaction) => string): Withdrawal[] {
	return txs.filter(isCashWithdrawal).map((tx) => ({ key: keyOf(tx), date: withdrawalDate(tx), booked: tx.booking_date || tx.value_date, amount: Math.abs(Number(tx.transaction_amount.amount)) || 0 }));
}

/** Does a withdrawal of that date fill the wallet? On or after its start; an undated (pending) one is recent, so it does. */
export function fillsWallet(date: string, start: string | undefined): boolean {
	return !!start && (!date || date >= start);
}

/** Withdrawals that filled the wallet. */
export function walletWithdrawals(list: readonly Withdrawal[], start: string | undefined): Withdrawal[] {
	return list.filter((w) => fillsWallet(w.date, start));
}

/**
 * Start a cash spend on `spendDate` needs: the latest withdrawal on or before that day within the
 * previous 31 days (the cash most likely came from it), else the spend day itself.
 * `withdrawalDates`: days the cash was taken (withdrawalDate), never the later booking, or a
 * withdrawal already spent would be pulled in; an undated (pending) one is no anchor.
 */
export function walletStartFor(spendDate: string, withdrawalDates: readonly string[]): string {
	const from = isoOf(utc(spendDate) - START_LOOKBACK_DAYS * DAY);
	return withdrawalDates.reduce((best, d) => (d && d >= from && d <= spendDate ? later(best, d) : best), '') || spendDate;
}

/** Start an item of the wallet needs: a cash spend, its withdrawal (walletStartFor); cash received, its own day (it did not come from a withdrawal). */
export function neededStart(s: Pick<CashSpend, 'date' | 'credit'>, withdrawalDates: readonly string[]): string {
	return s.credit ? s.date : walletStartFor(s.date, withdrawalDates);
}

/**
 * Start of the wallet, derived each time from what it holds and the withdrawals (any start set on
 * `w` is ignored), so it never depends on the order of entry: a withdrawal booked or imported after
 * the spend it paid for becomes its anchor by itself. The earliest of: the start each spend or
 * cash receipt needs (neededStart); the start a write-off or the check was made with (their balance
 * came from the withdrawals since then). A spend dated on or after a write-off or the check never
 * needs a start before theirs: the cash taken earlier was counted or written off then, it would
 * count twice. Undefined when the wallet holds nothing.
 */
export function walletStart(w: CashWallet, withdrawalDates: readonly string[]): string | undefined {
	const kept = [...w.writeOffs, ...(w.check ? [w.check] : [])].map((x) => ({ date: x.date, start: x.start ?? x.date }));
	const floor = (date: string) => kept.reduce((f, k) => (k.date <= date ? later(f, k.start) : f), '');
	const needs = [...kept.map((k) => k.start), ...w.spends.map((s) => later(neededStart(s, withdrawalDates), floor(s.date)))];
	return needs.length ? needs.reduce((a, b) => (b < a ? b : a)) : undefined;
}

/** The wallet as the app reads it: what is stored, with its start derived (walletStart), none when it holds nothing. */
export function withStart(w: CashWallet, withdrawalDates: readonly string[]): CashWallet {
	const start = walletStart(w, withdrawalDates);
	const next: CashWallet = { ...w };
	if (start) next.start = start;
	else delete next.start;
	return next;
}

/** The wallet as it is stored: never its start, derived again on every read (withStart). */
export function storedWallet(w: CashWallet): CashWallet {
	const next: CashWallet = { ...w };
	delete next.start;
	return next;
}

/**
 * The wallet without the spend, cash receipt or write-off `id` (deleted by the user, or the undo of
 * its entry). The start, derived, follows what is left by itself: a spend typed a year too early no
 * longer keeps a year of withdrawals out of the budget, while a confirmed check or a write-off keeps
 * the start it was made with. With nothing left, the starting amount goes too: the wallet closes as
 * before it started.
 */
export function withoutItem(w: CashWallet, id: string): CashWallet {
	const next: CashWallet = { ...w, spends: w.spends.filter((s) => s.id !== id), writeOffs: w.writeOffs.filter((x) => x.id !== id) };
	if (!next.spends.length && !next.writeOffs.length && !next.check) delete next.startAmount;
	return next;
}

/**
 * Undo of withoutItem on the wallet as it is `now`: the item `id` of `before` back in its place and
 * its starting amount when it has none now (the removal closed it); the start follows (walletStart).
 * With nothing changed in between, `before` exactly.
 */
export function withItemBack(now: CashWallet, before: CashWallet, id: string): CashWallet {
	const back = <T extends { id: string }>(list: T[], from: readonly T[]): T[] => {
		const at = from.findIndex((x) => x.id === id);
		return at < 0 || list.some((x) => x.id === id) ? list : [...list.slice(0, at), from[at]!, ...list.slice(at)];
	};
	const next: CashWallet = { ...now, spends: back(now.spends, before.spends), writeOffs: back(now.writeOffs, before.writeOffs) };
	if (now.startAmount === undefined && before.startAmount !== undefined) next.startAmount = before.startAmount;
	return next;
}

/** Balance = starting amount + withdrawals since the start + cash received − cash spends − write-offs. Can go below 0 (cash from elsewhere). */
export function walletBalance(w: CashWallet, withdrawals: readonly Withdrawal[]): number {
	const received = w.spends.filter((s) => s.credit);
	const spent = w.spends.filter((s) => !s.credit);
	return r2((w.startAmount ?? 0) + sum(walletWithdrawals(withdrawals, w.start)) + sum(received) - sum(spent) - sum(w.writeOffs));
}

/** Balance as shown: never below 0 € (a spend larger than the balance was paid with cash from elsewhere). */
export function shownBalance(balance: number): number {
	return Math.max(0, balance);
}

/**
 * Cash in the wallet at the end of each of `days` (AAAA-MM-JJ, ascending): 0 before the start,
 * never below 0 €. A withdrawal of the wallet counts on the day it was booked (when the bank
 * balance dropped), spends, receipts and write-offs on their date. One cumulative pass over the
 * events sorted by date, never a balance per day.
 */
export function walletBalanceByDay(w: CashWallet, withdrawals: readonly Withdrawal[], days: readonly string[]): number[] {
	const start = w.start;
	if (!start) return days.map(() => 0);
	const events = [
		...walletWithdrawals(withdrawals, start).map((x) => ({ date: x.booked ?? x.date, amount: x.amount })),
		...w.spends.map((s) => ({ date: s.date, amount: s.credit ? s.amount : -s.amount })),
		...w.writeOffs.map((x) => ({ date: x.date, amount: -x.amount }))
	].sort((a, b) => a.date.localeCompare(b.date));
	let i = 0;
	let total = w.startAmount ?? 0;
	return days.map((iso) => {
		for (; i < events.length && events[i]!.date <= iso; i++) total += events[i]!.amount;
		return iso < start ? 0 : shownBalance(r2(total));
	});
}

/**
 * Latest day the user did something with the wallet: cash spend or cash received, write-off,
 * confirmed check (the start when nothing else; '' before it). A withdrawal is not one: the bank
 * brings it in by itself, so weeks of withdrawals without a single cash spend typed still ask.
 */
export function lastMovement(w: CashWallet): string {
	if (!w.start) return '';
	const dates = [w.start, w.check?.date ?? '', ...w.spends.map((s) => s.date), ...w.writeOffs.map((x) => x.date)];
	return dates.reduce((a, b) => (b > a ? b : a), '');
}

/** Honesty check: cash still in the wallet while the user typed nothing for 30 days (forgotten spends?). */
export function needsCheck(w: CashWallet, withdrawals: readonly Withdrawal[], today: string): boolean {
	const last = lastMovement(w);
	return !!last && walletBalance(w, withdrawals) > 0 && (utc(today) - utc(last)) / DAY >= CHECK_AFTER_DAYS;
}

/**
 * The wallet with its whole positive balance written off on `today` (counted in « Autre »), with the
 * start it came from; null when there is nothing to write off. `w`: the wallet with its start
 * (withStart).
 */
export function withWriteOff(w: CashWallet, withdrawals: readonly Withdrawal[], today: string, id: string): CashWallet | null {
	const balance = walletBalance(w, withdrawals);
	return balance > 0 ? { ...w, writeOffs: [...w.writeOffs, { id, date: today, amount: balance, start: w.start ?? today }] } : null;
}

/**
 * The wallet after the user checked it on `today`; `w`: the wallet with its start (withStart).
 * `counted`: cash actually in hand (the shown balance when omitted). Less than the balance: the
 * difference is written off (spends never typed); more: it came from elsewhere and raises the
 * starting amount. A wallet not started yet starts that day. The balance then equals what was
 * counted; the check (and its write-off) keep the start they confirmed, so the wallet never starts
 * later (walletStart).
 */
export function withConfirmedBalance(w: CashWallet, withdrawals: readonly Withdrawal[], today: string, id: string, counted?: number): CashWallet {
	const start = w.start ?? today;
	const balance = walletBalance({ ...w, start }, withdrawals);
	const target = r2(Math.max(0, counted ?? shownBalance(balance)));
	const next: CashWallet =
		target < balance
			? { ...w, writeOffs: [...w.writeOffs, { id, date: today, amount: r2(balance - target), start }] }
			: target > balance
				? { ...w, startAmount: r2((w.startAmount ?? 0) + target - balance) }
				: w;
	return { ...next, check: { date: today, balance: target, start } };
}

/**
 * Undo of a check (withConfirmedBalance turned `before` into `after`) on the wallet as it is `now`:
 * only what the check added goes (its write-off, its raise of the starting amount, its date and
 * balance while no later check replaced them); the start follows (walletStart). A cash spend typed
 * in between stays.
 */
export function withoutCheck(now: CashWallet, before: CashWallet, after: CashWallet): CashWallet {
	const added = new Set(after.writeOffs.filter((x) => !before.writeOffs.some((y) => y.id === x.id)).map((x) => x.id));
	const next: CashWallet = { ...now, writeOffs: now.writeOffs.filter((x) => !added.has(x.id)) };
	const amount = r2((now.startAmount ?? 0) - ((after.startAmount ?? 0) - (before.startAmount ?? 0)));
	if (amount > 0) next.startAmount = amount;
	else delete next.startAmount;
	if (now.check && after.check && now.check.date === after.check.date && now.check.balance === after.check.balance) {
		if (before.check) next.check = before.check;
		else delete next.check;
	}
	return next;
}

/** A budget entry of the wallet with the id of the spend or write-off it comes from. */
export interface CashEntry {
	id: string;
	kind: 'spend' | 'writeOff';
	tx: Transaction;
}

function entry(date: string, amount: number, credit: boolean, label: string, category: CategoryId, note: string, subId?: string): Transaction {
	return {
		transaction_amount: { amount: amount.toFixed(2), currency: 'EUR' },
		booking_date: date,
		value_date: date,
		remittance_information: [label],
		credit_debit_indicator: credit ? 'CRDT' : 'DBIT',
		source: 'cash',
		account: CASH_ACCOUNT,
		virtual_category: category,
		...(subId ? { virtual_subcategory: subId } : {}),
		note
	};
}

/**
 * Budget entries of the wallet: each spend in its typed category (« Liquide : marché »), each cash
 * receipt (« Reçu en liquide : … »), each write-off in « Autre ». A spend's category is a default:
 * an override or a holiday moves the entry like a bank operation (categorize); a write-off stays in
 * « Autre ». Dated and confirmed, never in the balances, never paired with a bank line; a spend's
 * key carries its own rank (keyRank), identical write-offs of a day get one so their keys differ.
 */
export function cashEntryList(w: CashWallet): CashEntry[] {
	const used = new Set<string>();
	const ranked = (tx: Transaction, from = 0): Transaction => {
		const k = `${tx.booking_date}|${tx.transaction_amount.amount}|${tx.credit_debit_indicator}|${tx.remittance_information[0]}`;
		let n = from;
		while (used.has(`${k}#${n}`)) n++;
		used.add(`${k}#${n}`);
		return n ? { ...tx, dup_index: n } : tx;
	};
	return [
		...w.spends.map((s): CashEntry => ({
			id: s.id,
			kind: 'spend',
			tx: ranked(
				s.credit
					? entry(s.date, s.amount, true, `Reçu en liquide : ${s.label}`, s.categoryId, 'Reçu en liquide : ajouté au porte-monnaie', s.subId)
					: entry(s.date, s.amount, false, `Liquide : ${s.label}`, s.categoryId, s.forWhom ? `Payé en liquide pour ${s.forWhom} (porte-monnaie)` : 'Payé en liquide (porte-monnaie)', s.subId),
				s.dup
			)
		})),
		...w.writeOffs.map((x): CashEntry => ({ id: x.id, kind: 'writeOff', tx: ranked(entry(x.date, x.amount, false, WRITE_OFF_LABEL, 'autre', 'Reste du porte-monnaie jamais détaillé : compté en Autre pour qu’il ne disparaisse pas des totaux')) }))
	];
}

/**
 * Rank of a new spend in the key of its budget entry, from its id (a hash, never 0): that key is
 * the spend's own. A spend deleted then typed again the same way gets a new key, so what was set on
 * the old one (category, subcategory, holiday, share expected back) never passes to it, and
 * the keys of identical spends never shift when one is removed. The undo of a deletion puts the
 * same spend back, with its key.
 */
export function keyRank(id: string): number {
	let hash = 5381;
	for (let i = 0; i < id.length; i++) hash = ((hash << 5) + hash + id.charCodeAt(i)) | 0;
	return ((hash >>> 0) % 0x7fffffff) + 1;
}

/** Budget entries of the wallet (see cashEntryList). */
export function cashEntries(w: CashWallet): Transaction[] {
	return cashEntryList(w).map((e) => e.tx);
}
