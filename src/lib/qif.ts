import type { Transaction } from './types';
import type { AccountKind } from './csvCore';
import { parseAmountFr, parseDateIso } from './csvCore';
import { mergeLabel, statementAccount, statementAccountId, statementTx, type StatementResult } from './statementCore';

/**
 * QIF statements (Quicken Interchange Format): pure module.
 * Logic inspired by ezBookkeeping (MIT, pkg/converters/qif):
 * - '!Type:Bank | CCard | Cash | Oth A | Oth L' sections: one operation per block ending with '^'
 *   (D date, T/U signed amount, P payee, M memo, N number, C cleared, L category 'Cat:Sub-cat');
 *   S/E/$ splits ignored (the T total is enough); an opening balance is not an operation, and an
 *   L category in brackets is a transfer to that account;
 * - '!Account' (N name): account of the following sections (a speaking name is kept as label, a
 *   bare number gets the fallback label); '!Option' / '!Clear' autoswitch toggles have no effect;
 * - investments (!Type:Invst), categories, classes, memorised items: ignored;
 * - dates DD/MM/YYYY, DD/MM'YY (Quicken) or ISO; the day/month order is deduced from the whole
 *   file (a day > 12 decides), French by default.
 */

/** Sections carrying operations → registry account kind. */
const TX_SECTIONS: Record<string, AccountKind> = {
	bank: 'courant',
	ccard: 'courant',
	cash: 'autre',
	'oth a': 'autre',
	'oth l': 'pret'
};

interface QifEntry {
	section: string;
	lines: string[];
	account: string | null;
}

type DateOrder = 'dmy' | 'mdy';

/** Splits a QIF date ('25/09/2026', "9/25'26", '25.09.26', '2026-09-25') into 3 numbers. */
function dateParts(raw: string): number[] | null {
	const s = raw.replace(/\s/g, '');
	const parts = s.split(/[/.'-]/);
	if (parts.length !== 3 || parts.some((p) => !/^\d{1,4}$/.test(p))) return null;
	return parts.map(Number);
}

/**
 * Day/month order of the file: a first number > 12 → day first; a second > 12 → month first;
 * otherwise French (a leading year makes the order irrelevant).
 */
function detectDateOrder(raws: string[]): DateOrder {
	let dmy = false;
	let mdy = false;
	for (const raw of raws) {
		const p = dateParts(raw);
		if (!p || p[0]! > 31) continue;
		if (p[0]! > 12) dmy = true;
		if (p[1]! > 12) mdy = true;
	}
	return mdy && !dmy ? 'mdy' : 'dmy';
}

/** QIF date → ISO; null if invalid. Two-digit year: 20YY (19YY above 70). */
function qifDate(raw: string, order: DateOrder): string | null {
	const p = dateParts(raw);
	if (!p) return null;
	let [a, b, c] = p as [number, number, number];
	if (a > 31) return parseDateIso(`${a}-${String(b).padStart(2, '0')}-${String(c).padStart(2, '0')}`) || null;
	if (c < 100) c += c > 70 ? 1900 : 2000;
	const [day, month] = order === 'dmy' ? [a, b] : [b, a];
	return parseDateIso(`${c}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`) || null;
}

/** Value of the first field with this code in a block ('' if absent). */
function field(lines: string[], code: string): string {
	const line = lines.find((l) => l[0] === code);
	return line ? line.slice(1).trim() : '';
}

/** Parses an already-decoded QIF statement. `fallbackAccount`: account deduced from the file name. */
export function parseQif(text: string, fallbackAccount = 'cm'): StatementResult {
	const result: StatementResult = { format: 'qif', transactions: [], accounts: [], ignored: 0, errors: [] };
	const entries: QifEntry[] = [];
	let section = '';
	let account: string | null = null;
	let lines: string[] = [];
	let skippedInvestments = 0;

	for (const rawLine of text.replace(/^﻿/, '').split(/\r?\n/)) {
		const line = rawLine.trimEnd();
		if (!line.trim()) continue;
		if (line[0] === '!') {
			const header = line.trim().toLowerCase();
			if (header.startsWith('!type:')) section = header.slice(6).trim();
			else if (header === '!account') section = 'account';
			lines = [];
			continue;
		}
		if (line[0] === '^') {
			if (section === 'account') {
				account = field(lines, 'N') || account;
			} else if (section in TX_SECTIONS) {
				entries.push({ section, lines, account });
			} else if (section === 'invst') {
				skippedInvestments++;
			}
			lines = [];
			continue;
		}
		lines.push(line.trimStart());
	}

	if (skippedInvestments > 0) {
		result.ignored += skippedInvestments;
		result.errors.push(`${skippedInvestments} opération${skippedInvestments > 1 ? 's' : ''} de placement ignorée${skippedInvestments > 1 ? 's' : ''} (non prises en charge)`);
	}
	if (entries.length === 0 && skippedInvestments === 0) {
		result.errors.push('Aucune opération dans ce fichier QIF');
		return result;
	}

	const order = detectDateOrder(entries.map((e) => field(e.lines, 'D')));
	const usStyle = usAmounts(entries.map((e) => field(e.lines, 'T') || field(e.lines, 'U')), order);
	entries.forEach((entry, i) => {
		const tx = parseEntry(entry, order, usStyle, fallbackAccount, i + 1, result);
		if (!tx) return;
		result.transactions.push(tx);
		const id = tx.account!;
		const name = entry.account && /[a-z]{3}/i.test(entry.account) ? entry.account : undefined;
		if (id !== 'cm' && !result.accounts.some((a) => a.id === id)) result.accounts.push(statementAccount(id, TX_SECTIONS[entry.section], name));
	});
	return result;
}

/**
 * US-style amounts (comma = thousands: '-1,234', '1,234.56')? Yes for a month/day dated file,
 * or as soon as an amount has a decimal point with no comma after it. Otherwise French decimal
 * comma ('12,50').
 */
function usAmounts(raws: readonly string[], order: DateOrder): boolean {
	if (order === 'mdy') return true;
	return raws.some((r) => /\.\d{1,2}$/.test(r.trim()) && !/,\d*$/.test(r.trim()));
}

/** QIF amount: thousands commas removed for a US file, then tolerant parsing. */
function qifAmount(raw: string, us: boolean): number | null {
	return parseAmountFr(us ? raw.replace(/,/g, '') : raw);
}

function parseEntry(entry: QifEntry, order: DateOrder, us: boolean, fallbackAccount: string, rank: number, result: StatementResult): Transaction | null {
	const { lines } = entry;
	const payee = field(lines, 'P');
	if (/^(opening balance|solde (initial|d'ouverture|d’ouverture))$/i.test(payee)) {
		result.ignored++;
		return null;
	}
	const dateRaw = field(lines, 'D');
	const amountRaw = field(lines, 'T') || field(lines, 'U');
	const booking = qifDate(dateRaw, order);
	const amount = qifAmount(amountRaw, us);
	if (!booking || amount === null) {
		result.ignored++;
		result.errors.push(
			!booking
				? `Opération ${rank} : date illisible (« ${dateRaw} »), ignorée`
				: `Opération ${rank} : montant illisible (« ${amountRaw} »), ignorée`
		);
		return null;
	}
	const number = field(lines, 'N');
	const label = mergeLabel([payee, field(lines, 'M')]) || mergeLabel(['Opération', number]);
	const accountId = (entry.account && statementAccountId({ number: entry.account })) || fallbackAccount;
	const tx = statementTx('qif', { amount, currency: 'EUR', booking, value: booking, label, account: accountId });
	const category = field(lines, 'L');
	if (category && !category.startsWith('[')) {
		const [main, sub] = category.split(':').map((s) => s.trim());
		if (main) tx.bank_category = main;
		if (sub) tx.bank_subcategory = sub;
	}
	if (/^[*cxr]$/i.test(field(lines, 'C'))) tx.checked = true;
	return tx;
}
