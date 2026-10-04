import type { Transaction } from './types';
import type { CsvImportResult } from './csvCreditMutuel';
import { matchesCmHeader } from './csvCreditMutuel';
import {
	normalizeHeader,
	tokenize,
	detectDelimiter,
	parseDateFlexible,
	parseAmountFr,
	resolveDirection,
	decodeCsv
} from './csvCore';

/**
 * Tolerant CSV parser for Natixis exports (savings / French bank).
 *
 * NOTE: the real format of Natixis exports varies with the contract — the
 * HEADER_MAP table below sits at the top of the file on purpose, so it can be
 * adjusted as soon as a user example arrives.
 *
 * Same tolerances as the Crédit Mutuel parser: UTF-8 → windows-1252 decoding,
 * automatic delimiter (; , tab), quotes, French + ISO dates, French amounts,
 * normalised headers (case/accents).
 */

/** Known columns after header normalisation. */
type ColumnKey =
	| 'date'
	| 'valueDate'
	| 'label'
	| 'amount' // signed amount (negative = debit)
	| 'debit'
	| 'credit'
	| 'balance'
	| 'category'
	| 'subcategory';

/**
 * Header → column mapping table (normalised form).
 * ← ADJUST HERE if the real Natixis export uses other titles.
 */
const HEADER_MAP: Record<string, ColumnKey> = {
	date: 'date',
	'date d operation': 'date',
	'date operation': 'date',
	'date d effet': 'date',
	'date effet': 'date',
	'date comptable': 'date',
	'date de valeur': 'valueDate',
	'date valeur': 'valueDate',
	libelle: 'label',
	'libelle operation': 'label',
	'libelle simplifie': 'label',
	operation: 'label',
	intitule: 'label',
	motif: 'label',
	detail: 'label',
	montant: 'amount',
	'montant eur': 'amount',
	'montant en euros': 'amount',
	'montant operation': 'amount',
	debit: 'debit',
	'debit eur': 'debit',
	credit: 'credit',
	'credit eur': 'credit',
	solde: 'balance',
	'solde apres operation': 'balance',
	categorie: 'category',
	'sous categorie': 'subcategory'
};

/**
 * Parses the (already decoded) CSV text into Natixis transactions.
 * - Columns are mapped from the header (unknown columns ignored); a blank row
 *   is counted apart, neither an error nor an unreadable row.
 * - Amount: signed column first, otherwise separate debit/credit; a debit is
 *   always an outflow and a negative credit an outflow (see resolveDirection).
 * - French or ISO dates (time ignored). An unreadable operation date drops the
 *   row (never kept « pending »); an unreadable value date falls back to the
 *   operation date, reported. Without a value date column the booking date is
 *   reused, otherwise the transaction would be « pending » and excluded from
 *   wealth balances.
 */
export function parseNatixisText(text: string): CsvImportResult {
	const errors: string[] = [];
	const transactions: Transaction[] = [];
	let ignored = 0;
	let blank = 0;

	const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
	const delimiter = detectDelimiter(firstLine);
	const rows = tokenize(text, delimiter);
	if (rows.length === 0) {
		return { transactions, ignored: 0, errors: ['Fichier vide'], accounts: [] };
	}

	const header = rows[0]!;
	const columns = new Map<number, ColumnKey>();
	header.forEach((h, idx) => {
		const key = HEADER_MAP[normalizeHeader(h)];
		if (key) columns.set(idx, key);
	});
	const known = [...columns.values()];
	if (!known.includes('label') || !(known.includes('amount') || known.includes('debit') || known.includes('credit'))) {
		return {
			transactions,
			ignored: 0,
			errors: [
				'En-tête introuvable : colonnes « Libellé » et « Montant » (ou Débit/Crédit) absentes (format Natixis attendu)'
			],
			accounts: []
		};
	}

	for (let r = 1; r < rows.length; r++) {
		const fields = rows[r]!;
		if (fields.every((f) => f.trim() === '')) {
			blank++;
			continue;
		}
		const get = (key: ColumnKey): string => {
			for (const [idx, k] of columns) {
				if (k === key) return (fields[idx] ?? '').trim();
			}
			return '';
		};
		const lineNo = r + 1;

		const label = get('label');
		if (!label) {
			ignored++;
			errors.push(`Ligne ${lineNo} : libellé manquant, ligne ignorée`);
			continue;
		}

		const amountRaw = get('amount');
		const debitRaw = get('debit');
		const creditRaw = get('credit');
		const signed = parseAmountFr(amountRaw);
		const debit = parseAmountFr(debitRaw);
		const credit = parseAmountFr(creditRaw);

		if ((amountRaw !== '' && signed === null) || (debitRaw !== '' && debit === null) || (creditRaw !== '' && credit === null)) {
			ignored++;
			errors.push(`Ligne ${lineNo} : montant illisible, ligne ignorée`);
			continue;
		}

		const direction = resolveDirection(signed, debit, credit);
		if (!direction) {
			ignored++;
			errors.push(`Ligne ${lineNo} : aucun montant exploitable, ligne ignorée`);
			continue;
		}
		const { isCredit, amount } = direction;

		const date = parseDateFlexible(get('date'));
		if (date === null) {
			ignored++;
			errors.push(`Ligne ${lineNo} : date illisible (JJ/MM/AAAA ou ISO attendu), ligne ignorée`);
			continue;
		}
		const valueDate = parseDateFlexible(get('valueDate'));
		if (valueDate === null) errors.push(`Ligne ${lineNo} : date de valeur illisible, date d'opération reprise`);
		const balance = parseAmountFr(get('balance'));

		const tx: Transaction = {
			transaction_amount: { amount: amount.toFixed(2), currency: 'EUR' },
			booking_date: date,
			value_date: valueDate || date,
			remittance_information: [label],
			credit_debit_indicator: isCredit ? 'CRDT' : 'DBIT',
			source: 'natixis-csv',
			account: 'natixis'
		};
		const category = get('category');
		if (category) tx.bank_category = category;
		const subcategory = get('subcategory');
		if (subcategory) tx.bank_subcategory = subcategory;
		if (balance !== null) tx.balance_after = Math.round(balance * 100) / 100;

		transactions.push(tx);
	}

	return { transactions, ignored, errors, accounts: [], blank };
}

/** Reads a Natixis CSV file (UTF-8 → windows-1252 decoding through csvCore). */
export async function parseNatixisCsv(file: Blob): Promise<CsvImportResult> {
	return parseNatixisText(decodeCsv(await file.arrayBuffer()));
}

/**
 * Format detection: the header suggests Natixis (label + amount/debit/credit)
 * and doesn't match the typical Crédit Mutuel markers.
 */
export function matchesNatixisHeader(headerFields: string[]): boolean {
	if (matchesCmHeader(headerFields)) return false;
	const keys = new Set(
		headerFields.map((h) => HEADER_MAP[normalizeHeader(h)]).filter((k) => k !== undefined)
	);
	return keys.has('label') && (keys.has('amount') || keys.has('debit') || keys.has('credit'));
}

/** Detects the export format from the header line. */
export function detectCsvFormat(text: string): 'cm' | 'natixis' | null {
	const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
	const fields = tokenize(firstLine, detectDelimiter(firstLine))[0] ?? [];
	if (matchesCmHeader(fields)) return 'cm';
	if (matchesNatixisHeader(fields)) return 'natixis';
	return null;
}
