import type { Transaction } from './types';
import { extractPdfPages, type PdfLine } from './pdfNatixis';

/**
 * Monthly Kraken statements ('krak_statement_account_statement_YYYY_MM.pdf').
 *
 * For a card payment the ledger (API/CSV) only gives an id ('KRAKEN CARTE LDMNP7-…'). The PDF
 * statement carries the merchant NAME ('Counter party' column): it is the only source that lets
 * us categorise Krak card spending.
 *
 * 'Activity' table: each operation takes 3 text lines
 *   1) date (UTC) + type ('Krak Card', 'Trade', 'Earn'…)
 *   2) detail: asset, [wallet], amount, price, fee, value, counter party, reference
 *   3) time + subtype ('Card Payment', 'Refund', 'Cashback Reward', 'Buy'…)
 * Depending on the month, the 'Wallet' column sits on the detail line ('Everyday') or is split
 * over lines 1 and 3 ('Spot' / 'Main'), and the type of an internal transfer ('Transfer') moves
 * to the detail line. Columns are therefore read by x position, not by index.
 *
 * Only EUR card payments and refunds become budget operations (account 'krak-card'). Cashback,
 * automatic BTC→EUR conversions, Earn rewards and Spot→card transfers are wealth movements
 * already covered by the ledger: ignored here.
 */

export const KRAK_ACCOUNT_ID = 'krak-card';
export const KRAK_LABEL_PREFIX = 'CARTE KRAK';

export interface KrakActivity {
	date: string; // YYYY-MM-DD (UTC)
	time: string;
	type: string; // 'Krak Card', 'Trade', 'Earn', 'Transfer'
	subtype: string; // 'Card Payment', 'Refund', 'Cashback Reward', 'Buy', 'Sell', 'Reward'
	asset: string;
	amount: number;
	valueEur: number;
	counterparty: string; // '' when '-'
	reference: string;
}

export interface KrakStatementResult {
	/** Statement month 'YYYY-MM' (from the header), '' if not found. */
	month: string;
	activities: KrakActivity[];
	transactions: Transaction[];
	stats: { payments: number; refunds: number; cashback: number; other: number };
	/** Amounts of the month (EUR): card spending, refunds, cashback received. */
	totals: { spendEur: number; refundEur: number; cashbackEur: number };
	errors: string[];
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}:\d{2}$/;
const NUM_RE = /^-?[\d,]*\.?\d+$/;
const MONTHS: Record<string, string> = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };

/** 'Type' column: x between the date (~31) and 'Asset' (~164). */
const TYPE_X = [60, 150] as const;

function num(s: string): number {
	return Number(s.replace(/,/g, ''));
}

function typeWords(items: { x: number; str: string }[]): string {
	return items
		.filter((i) => i.x > TYPE_X[0] && i.x < TYPE_X[1])
		.map((i) => i.str.trim())
		.join(' ')
		.trim();
}

/** Statement month: 'Statement Period: Jan 01, 2026 - …' or 'Monthly Statement: August 2026'. */
export function statementMonth(pages: PdfLine[][]): string {
	for (const line of pages.flat()) {
		let m = /Statement Period:\s*([A-Za-z]{3})[a-z]*\s+\d{1,2},\s*(\d{4})/.exec(line.text);
		if (m) return `${m[2]}-${MONTHS[m[1]!.toLowerCase()] ?? '01'}`;
		m = /Monthly Statement:\s*([A-Za-z]{3})[a-z]*\s+(\d{4})/.exec(line.text);
		if (m) return `${m[2]}-${MONTHS[m[1]!.toLowerCase()] ?? '01'}`;
	}
	return '';
}

/**
 * Reads the 3 lines of an operation; null if the shape is not recognised. The detail is right
 * of the Type column; an optional wallet ('Everyday') is a non-numeric word before the amount.
 */
function readActivity(l1: PdfLine, l2: PdfLine, l3: PdfLine): KrakActivity | null {
	const date = l1.items[0]?.str ?? '';
	const time = l3.items[0]?.str ?? '';
	if (!DATE_RE.test(date) || !TIME_RE.test(time)) return null;
	const type = [typeWords(l1.items), typeWords(l2.items)].filter(Boolean).join(' ');
	const subtype = typeWords(l3.items);
	const cells = l2.items.filter((i) => i.x >= TYPE_X[1]).map((i) => i.str.trim());
	if (cells.length < 5) return null;
	let k = 0;
	const asset = cells[k++]!;
	if (k < cells.length && !NUM_RE.test(cells[k]!)) k++;
	const nums: number[] = [];
	while (k < cells.length && nums.length < 4 && NUM_RE.test(cells[k]!)) nums.push(num(cells[k++]!));
	if (nums.length < 4) return null;
	const rest = cells.slice(k);
	const refIdx = l2.items.findIndex((i) => i.x >= 600);
	const reference = refIdx >= 0 ? l2.items[refIdx]!.str.trim() : '';
	const cpParts = rest.filter((c) => c !== reference);
	const counterparty = cpParts.join(' ').replace(/\s+/g, ' ').trim();
	return {
		date,
		time,
		type,
		subtype,
		asset,
		amount: nums[0]!,
		valueEur: nums[3]!,
		counterparty: counterparty === '-' ? '' : counterparty,
		reference: reference === '-' ? '' : reference
	};
}

/** Parses already-extracted lines (testable without a PDF); EUR value at the rate of the day (BTC or EUR). */
export function parseKrakLines(pages: PdfLine[][]): KrakStatementResult {
	const month = statementMonth(pages);
	const activities: KrakActivity[] = [];
	const errors: string[] = [];
	for (const page of pages) {
		for (let i = 0; i + 2 < page.length; i++) {
			const first = page[i]!.items[0]?.str ?? '';
			if (!DATE_RE.test(first)) continue;
			const a = readActivity(page[i]!, page[i + 1]!, page[i + 2]!);
			if (a) {
				activities.push(a);
				i += 2;
			} else {
				errors.push(`Ligne non reconnue : ${page[i]!.text.slice(0, 60)}`);
			}
		}
	}
	const stats = { payments: 0, refunds: 0, cashback: 0, other: 0 };
	const totals = { spendEur: 0, refundEur: 0, cashbackEur: 0 };
	const transactions: Transaction[] = [];
	for (const a of activities) {
		const isCard = /Card/i.test(a.type);
		const sub = a.subtype.toLowerCase();
		if (isCard && /card payment/.test(sub) && a.asset === 'EUR') {
			stats.payments++;
			totals.spendEur += Math.abs(a.valueEur);
			transactions.push(toTransaction(a));
		} else if (isCard && /refund/.test(sub) && a.asset === 'EUR') {
			stats.refunds++;
			totals.refundEur += Math.abs(a.valueEur);
			transactions.push(toTransaction(a));
		} else if (/cashback/.test(sub)) {
			stats.cashback++;
			totals.cashbackEur += Math.abs(a.valueEur);
		} else stats.other++;
	}
	for (const k of Object.keys(totals) as (keyof typeof totals)[]) totals[k] = Math.round(totals[k] * 100) / 100;
	return { month, activities, transactions, stats, totals, errors };
}

function toTransaction(a: KrakActivity): Transaction {
	const label = `${KRAK_LABEL_PREFIX} ${a.counterparty || 'COMMERCANT INCONNU'}`;
	const amount = Math.abs(a.valueEur);
	return {
		transaction_amount: { amount: amount.toFixed(2), currency: 'EUR' },
		booking_date: a.date,
		value_date: a.date,
		remittance_information: a.reference ? [label, a.reference] : [label],
		credit_debit_indicator: a.valueEur < 0 ? 'DBIT' : 'CRDT',
		source: 'krak-pdf',
		account: KRAK_ACCOUNT_ID
	};
}

/** Does the text look like a monthly Kraken statement? (importer and import panel) */
export function looksLikeKrakStatement(pages: PdfLine[][]): boolean {
	const text = pages.flat().map((l) => l.text).join('\n');
	return /Payward|Kraken/i.test(text) && /Statement/i.test(text);
}

/** Entry point: a PDF statement → Krak card operations. */
export async function parseKrakStatementPdf(buffer: ArrayBuffer): Promise<KrakStatementResult | { error: string }> {
	const pages = await extractPdfPages(buffer);
	if (!looksLikeKrakStatement(pages)) return { error: 'Ce PDF n’est pas un relevé mensuel Kraken.' };
	return parseKrakLines(pages);
}
