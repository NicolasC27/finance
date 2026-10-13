import type { CategoryId, Transaction } from './types';
import { isPlannedInstalment, signedAmount } from './data';
import { getCategory, txKey } from './categories';
import { merchantKey } from './merchant';
import { formatDate, formatDateShort, formatEUR } from './format';

/**
 * Detail of an operation in the Transactions list (pure module): its dates as one sentence, and the
 * history of its merchant (the last operations of the same merchant and direction), shown on one
 * line under the classification controls.
 */

/** Where an operation stands: booked by the bank, still pending, a planned instalment, or typed by hand and waiting for the statement. */
export type DateState = 'booked' | 'pending' | 'planned' | 'typed';

/** Dates of an operation, as the detail reads them. */
export interface DateFacts {
	/** Purchase date read in the card label, '' when there is none. */
	purchase: string;
	/** Booking date, '' while pending. */
	booking: string;
	credit: boolean;
	/** Cash withdrawal (« RETRAIT DAB 1808 »): « Retiré le ». */
	withdrawal?: boolean;
	state?: DateState;
}

const MONTH = new Intl.DateTimeFormat('fr-FR', { month: 'long', timeZone: 'UTC' });

/** « août », or « août 2025 » outside `year`. */
export function monthName(iso: string, year: number): string {
	const [y, m] = iso.split('-').map(Number);
	const name = MONTH.format(new Date(Date.UTC(y!, m! - 1, 15)));
	return y === year ? name : `${name} ${y}`;
}

/** « 1er » for the first day of a month, the number otherwise. */
function dayNumber(iso: string): string {
	const day = Number(iso.slice(8, 10));
	return day === 1 ? '1er' : String(day);
}

/** Short date of a sentence, year outside `year` (« 19 août », « 1er oct. », « 4 mars 2025 »); `withYear` always writes it. */
export function dayDate(iso: string, year: number, withYear = false): string {
	const text = withYear ? formatDate(iso) : formatDateShort(iso, year);
	return text.replace(/^\d+(?=\s)/, dayNumber(iso));
}

/** Second date of a sentence: the day alone in the month and year of `ref` (« 19 »), a short date otherwise. */
function laterDay(iso: string, ref: string, year: number): string {
	return iso.slice(0, 7) === ref.slice(0, 7) ? dayNumber(iso) : dayDate(iso, year);
}

/**
 * The dates of an operation as one sentence that writes each distinct date once: « Acheté le 18 août
 * · débité le 19 », « Débité le 19 août », « Pas encore débité ». A pending operation is dated by
 * its purchase and says it is not debited yet (« Acheté le 18 août · pas encore débité »), a planned
 * instalment gives its due date, a quick entry the day it was paid. The year is written only
 * outside `year`, and on a purchase made the year before its debit.
 */
export function datesSentence(f: DateFacts, year = new Date().getFullYear()): string {
	const verb = f.credit ? 'crédité' : 'débité';
	if (!f.booking) return `Pas encore ${verb}`;
	const booked = dayDate(f.booking, year);
	if (f.state === 'planned') return `Échéance prévue le ${booked}`;
	if (f.state === 'typed') return `${f.credit ? 'Reçu' : 'Payé'} le ${booked}`;
	const bought = !!f.purchase && f.purchase !== f.booking;
	const first = f.withdrawal ? 'Retiré le' : bought && !f.credit ? 'Acheté le' : 'Le';
	if (f.state === 'pending') return `${first} ${dayDate(bought ? f.purchase : f.booking, year)} · pas encore ${verb}`;
	if (!bought) return `${verb[0]!.toUpperCase()}${verb.slice(1)} le ${booked}`;
	const day = dayDate(f.purchase, year, f.purchase.slice(0, 4) !== f.booking.slice(0, 4));
	return `${first} ${day} · ${verb} le ${laterDay(f.booking, f.purchase, year)}`;
}

/** One operation on the merchant's bar strip. */
export interface HistoryBar {
	key: string;
	/** Booking date, '' while pending. */
	date: string;
	/** Amount without sign (€). */
	amount: number;
	/** The operation whose detail is open. */
	current: boolean;
}

/** A fixed price that changed: the last operations are worth `delta` more than the steady price before them. */
export interface PriceChange {
	delta: number;
	/** First operation at the new price. */
	since: string;
}

/** The category where the merchant's other operations are filed, when it is not the open one's. */
export interface Elsewhere {
	categoryId: CategoryId;
	count: number;
	/** Other operations of the merchant in this direction, those filed in Vacances left out. */
	of: number;
}

/** History of an operation's merchant in the same direction (payments or income). */
export interface MerchantHistory {
	credit: boolean;
	/** The last operations, at most `max`, oldest first. */
	bars: HistoryBar[];
	/** Every operation of the merchant in this direction, the open one included. */
	count: number;
	/** Booking date of the oldest of them. */
	first: string;
	change: PriceChange | null;
	elsewhere: Elsewhere | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const sameAmount = (a: number, b: number) => Math.abs(a - b) < 0.005;

/**
 * Last change of a fixed price on the strip: the final run of equal amounts follows a run of at
 * least two equal amounts at another price (a subscription going from 9,99 € to 12,39 €). Amounts
 * that vary with each visit (groceries) have no such run: null.
 */
export function priceChange(bars: readonly HistoryBar[]): PriceChange | null {
	const n = bars.length;
	if (n < 3) return null;
	const last = bars[n - 1]!.amount;
	let start = n - 1;
	while (start > 0 && sameAmount(bars[start - 1]!.amount, last)) start--;
	if (start < 2) return null;
	const before = bars[start - 1]!.amount;
	if (!sameAmount(bars[start - 2]!.amount, before)) return null;
	return { delta: r2(last - before), since: bars[start]!.date };
}

/**
 * Category most of `others` are filed in among those that are not `own`, null when they are all in
 * `own`. Vacances is filed by the date, not by the merchant: an operation in Vacances gets no hint,
 * and the others in Vacances are left out (a bakery during a ski week is not misfiled).
 */
function otherCategory(others: readonly CategoryId[], own: CategoryId): Elsewhere | null {
	if (own === 'vacances') return null;
	const filed = others.filter((id) => id !== 'vacances');
	const counts = new Map<CategoryId, number>();
	for (const id of filed) if (id !== own) counts.set(id, (counts.get(id) ?? 0) + 1);
	let best: Elsewhere | null = null;
	for (const [categoryId, count] of counts) if (!best || count > best.count) best = { categoryId, count, of: filed.length };
	return best;
}

/**
 * History of the merchant of `tx` (same merchantKey and direction) among `ops`, planned instalments
 * left out: the last `max` amounts, how many there are since when, the last change of a fixed price
 * and where the others are filed. Null without a merchant or without another operation of it.
 */
export function merchantHistory(tx: Transaction, ops: readonly Transaction[], catOf: (t: Transaction) => CategoryId, max = 12): MerchantHistory | null {
	const merchant = merchantKey(tx.remittance_information);
	if (!merchant) return null;
	const own = txKey(tx);
	const same = ops.filter((o) => o.credit_debit_indicator === tx.credit_debit_indicator && !isPlannedInstalment(o) && merchantKey(o.remittance_information) === merchant);
	if (!same.some((o) => txKey(o) === own)) same.push(tx);
	if (same.length < 2) return null;
	const order = (o: Transaction) => o.booking_date || '￿';
	same.sort((a, b) => order(a).localeCompare(order(b)) || txKey(a).localeCompare(txKey(b)));
	const bars = same.slice(-max).map((o): HistoryBar => ({ key: txKey(o), date: o.booking_date, amount: Math.abs(signedAmount(o)), current: txKey(o) === own }));
	const others = same.filter((o) => txKey(o) !== own).map(catOf);
	return {
		credit: tx.credit_debit_indicator === 'CRDT',
		bars,
		count: same.length,
		first: same.find((o) => o.booking_date)?.booking_date ?? '',
		change: priceChange(bars),
		elsewhere: otherCategory(others, catOf(tx))
	};
}

/**
 * Category the history hint may file the open operation in: the one more than half of the
 * merchant's other operations are filed in (Vacances left out), null when they are fewer (the hint
 * then only reads).
 */
export function fileTarget(h: MerchantHistory): CategoryId | null {
	const e = h.elsewhere;
	return e && e.count * 2 > e.of ? e.categoryId : null;
}

/** « 7 paiements depuis mars », « 2 versements depuis décembre 2025 »: income is « versements ». */
export function historyCountLabel(h: MerchantHistory, year = new Date().getFullYear()): string {
	const noun = h.credit ? 'versement' : 'paiement';
	const since = h.first ? ` depuis ${monthName(h.first, year)}` : '';
	return `${h.count} ${noun}${h.count > 1 ? 's' : ''}${since}`;
}

/**
 * « prix +2,40 € depuis août », « montant +50,00 € depuis juin » for an income; in privacy mode only
 * the direction, « prix en hausse depuis août ».
 */
export function priceChangeLabel(c: PriceChange, masked: boolean, credit = false, year = new Date().getFullYear()): string {
	const noun = credit ? 'montant' : 'prix';
	const since = c.since ? ` depuis ${monthName(c.since, year)}` : '';
	if (masked) return `${noun} ${c.delta > 0 ? 'en hausse' : 'en baisse'}${since}`;
	return `${noun} ${c.delta > 0 ? '+' : '−'}${formatEUR(Math.abs(c.delta))}${since}`;
}

/** « 6 autres en Abonnements », « 1 autre en Loisirs ». */
export function elsewhereLabel(e: Elsewhere): string {
	return `${e.count} autre${e.count > 1 ? 's' : ''} en ${getCategory(e.categoryId).label}`;
}
