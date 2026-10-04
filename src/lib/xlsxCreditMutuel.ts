import type { Transaction } from './types';
import { parseXlsx } from './xlsxCore';
import { HEADER_MAP, guessMapping, parseRowsWithMapping, type CsvImportResult, type FieldKey } from './importMapper';
import { detectAccountKind, normalizeHeader, parseAmountFr, type ImportedAccount } from './csvCore';

/**
 * Import of a Crédit Mutuel workbook (.xlsx):
 * - 'Vos comptes' sheet → account registry (label + 11-digit number, detected kind, DECLARED balance
 *   and currency, v9)
 * - 'Cpt …' sheets → transactions, same key rules as the CSV (CSV↔XLSX dedup parity:
 *   amount.toFixed(2), Math.abs, CRDT for a credit, value_date = value || date, trimmed label).
 */

export type { ImportedAccount } from './csvCore';

export interface XlsxImportResult extends CsvImportResult {
	/** Registry found in the workbook ('Vos comptes'). */
	accounts: ImportedAccount[];
	/** Ignored sheets (neither registry nor recognised account header). */
	sheetsSkipped: number;
}

/** Last 11-digit block of a RIB (fictional example: '10278 00000 00012345678' → '00012345678'). */
function accountNumber(text: string): string | null {
	const blocks = text.match(/\d{11}/g);
	return blocks ? blocks[blocks.length - 1]! : null;
}

/** Recognised fields of a row (except 'ignore'), through the extended table. */
function recognizedFields(row: string[]): FieldKey[] {
	const out: FieldKey[] = [];
	for (const cell of row) {
		const key = HEADER_MAP[normalizeHeader(cell)];
		if (key && key !== 'ignore' && !out.includes(key)) out.push(key);
	}
	return out;
}

/**
 * Account sheet: 'header' row within the first 25 rows with ≥ 2 recognised headers including Date
 * and Libellé. Returns its index or -1.
 */
function findHeaderRow(rows: string[][]): number {
	const limit = Math.min(rows.length, 25);
	for (let r = 0; r < limit; r++) {
		const fields = recognizedFields(rows[r] ?? []);
		if (fields.length >= 2 && fields.includes('date') && fields.includes('label')) return r;
	}
	return -1;
}

/** Account number from the metadata before the header ('R.I.B. : …' row). */
function ribFromMetadata(rows: string[][], headerRow: number): string | null {
	for (let r = 0; r < headerRow; r++) {
		for (const cell of rows[r] ?? []) {
			if (/r\s*[.i]?\s*i\s*\.?\s*b/i.test(cell)) {
				const n = accountNumber(cell);
				if (n) return n;
			}
		}
	}
	return null;
}

/**
 * 'Vos comptes' registry: header row Compte + (R.I.B. or Solde) within the first 10 rows (the sheet
 * name is NOT required), then one row per account. Captures: label (bank casing, collapsed spaces),
 * 11-digit number from the RIB (RIB column first, else any cell), DECLARED balance (dot amount OK)
 * and currency; the kind is guessed from the label (detectAccountKind).
 */
function parseRegistry(rows: string[][]): ImportedAccount[] | null {
	let header = -1;
	let labelCol = -1;
	let ribCol = -1;
	let balanceCol = -1;
	let currencyCol = -1;
	const limit = Math.min(rows.length, 10);
	for (let r = 0; r < limit; r++) {
		const cells = (rows[r] ?? []).map((c) => normalizeHeader(c));
		const li = cells.indexOf('compte');
		const ribAt = cells.indexOf('r i b');
		const ri = ribAt !== -1 ? ribAt : cells.indexOf('rib');
		const bi = cells.indexOf('solde');
		if (li !== -1 && (ri !== -1 || bi !== -1)) {
			header = r;
			labelCol = li;
			ribCol = ri;
			balanceCol = bi;
			const currencyAt = cells.indexOf('dev');
			currencyCol = currencyAt !== -1 ? currencyAt : cells.indexOf('devise');
			break;
		}
	}
	if (header === -1) return null;

	const accounts: ImportedAccount[] = [];
	for (let r = header + 1; r < rows.length; r++) {
		const row = rows[r] ?? [];
		const n = accountNumber(ribCol !== -1 ? (row[ribCol] ?? '') : row.join(' '));
		if (!n) continue;
		const label = (row[labelCol] ?? '').replace(/\s+/g, ' ').trim();
		const balance = balanceCol !== -1 ? parseAmountFr(row[balanceCol] ?? '') : null;
		const currency = currencyCol !== -1 ? (row[currencyCol] ?? '').trim() : '';
		const id = `cm-${n}`;
		accounts.push({
			id,
			label: label || `Compte ••${n.slice(-4)}`,
			last4: n.slice(-4),
			kind: detectAccountKind(label, id),
			...(balance !== null ? { balance } : {}),
			...(currency ? { currency } : {})
		});
	}
	return accounts.length > 0 ? accounts : null;
}

/** Presentation row (balance, repeated title, empty) and not an operation. */
function isChromeRow(row: string[]): boolean {
	const cells = row.map((c) => c.trim()).filter((c) => c !== '');
	if (cells.length === 0) return true;
	if (cells.some((c) => /^solde\s+(initial|au\b)/i.test(c))) return true;
	if (cells.every((c) => /^liste de vos comptes$/i.test(c) || /^[A-Z]{3}$/.test(c))) return true;
	return false;
}

/**
 * Parses a full CM workbook: registry + every account sheet.
 * 1) Summary registry: header Compte + (R.I.B. or Solde), any sheet name; deduplicated by id, the
 *    most complete entry wins; a 'Vos comptes' sheet that cannot be read counts as skipped.
 * 2) Account sheet: recognised Date/Valeur/Libellé/… header; account from the metadata RIB, else
 *    the sheet name, else a fallback. CM workbook chrome rows ('Solde initial :', 'Solde au
 *    JJ/MM/AAAA :', 'Liste de vos comptes') are skipped on purpose (counted in `skipped`) without
 *    being removed from the matrix, so error row numbers stay those of the sheet. Same rule as the
 *    CSV: a single guessed Libellé column (stable keys); Excel serials (20000-60000) and FR/ISO
 *    dates accepted; errors are prefixed with the sheet name.
 */
export async function parseCreditMutuelXlsx(file: Blob): Promise<XlsxImportResult> {
	const sheets = await parseXlsx(await file.arrayBuffer());

	const transactions: Transaction[] = [];
	const errors: string[] = [];
	let ignored = 0;
	let blank = 0;
	let skipped = 0;
	let sheetsSkipped = 0;
	let accounts: ImportedAccount[] = [];

	sheets.forEach((sheet, index) => {
		const registry = parseRegistry(sheet.rows);
		if (registry) {
			for (const acc of registry) {
				const existing = accounts.find((a) => a.id === acc.id);
				if (!existing) {
					accounts.push(acc);
				} else {
					if (existing.balance === undefined && acc.balance !== undefined) existing.balance = acc.balance;
					if (!existing.currency && acc.currency) existing.currency = acc.currency;
				}
			}
			return;
		}
		if (normalizeHeader(sheet.name) === 'vos comptes') {
			sheetsSkipped++;
			return;
		}
		const headerRow = findHeaderRow(sheet.rows);
		if (headerRow === -1) {
			sheetsSkipped++;
			return;
		}

		const rib = ribFromMetadata(sheet.rows, headerRow) ?? accountNumber(sheet.name);
		const account = rib ? `cm-${rib}` : `cm-xlsx-${index}`;

		const mappingRow = sheet.rows[headerRow] ?? [];
		const result = parseRowsWithMapping(sheet.rows, {
			mapping: guessMapping(mappingRow) ?? mappingRow.map((cell) => HEADER_MAP[normalizeHeader(cell)] ?? 'ignore'),
			dateFormat: 'auto',
			skipRows: headerRow,
			account,
			source: 'cm-xlsx',
			skipRow: isChromeRow
		});
		transactions.push(...result.transactions);
		ignored += result.ignored;
		blank += result.blank ?? 0;
		skipped += result.skipped ?? 0;
		for (const err of result.errors) errors.push(`[${sheet.name}] ${err}`);
	});

	return { transactions, ignored, errors, accounts, sheetsSkipped, blank, skipped };
}
