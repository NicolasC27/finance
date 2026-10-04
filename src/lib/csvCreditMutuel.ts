import {
	normalizeHeader,
	tokenize,
	detectDelimiter,
	decodeCsv
} from './csvCore';
import { HEADER_MAP, guessMapping, parseRowsWithMapping, type CsvImportResult } from './importMapper';

/**
 * CSV parser for the Crédit Mutuel export format:
 *   Date;Date de valeur;Date d'analyse;Libellé;Note personnelle;Débit;Crédit;
 *   Catégorie;Sous-catégorie;Solde;Opération pointée;Tags associés
 *
 * Row logic is delegated to the generic engine (importMapper) — here: CSV
 * tokenisation, header detection and account derived from the file.
 * Tolerances: UTF-8 → windows-1252 decoding, automatic delimiter (; , tab),
 * quoted fields, normalised headers, French amounts, DD/MM/YYYY dates,
 * reordered columns (reduced 6-column format).
 */

export type { CsvImportResult } from './importMapper';

/**
 * Parses the (already decoded) CSV text into CM transactions, with a mapping
 * guessed from the header (unknown columns ignored).
 * `account`: target account id ('cm' by default, 'cm-XXXXXXXXXXX').
 */
export function parseCreditMutuelText(text: string, account = 'cm'): CsvImportResult {
	const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
	const delimiter = detectDelimiter(firstLine);
	const rows = tokenize(text, delimiter);
	if (rows.length === 0) {
		return { transactions: [], ignored: 0, errors: ['Fichier vide'], accounts: [] };
	}

	const mapping = guessMapping(rows[0]!);
	if (!mapping) {
		return {
			transactions: [],
			ignored: 0,
			errors: ["En-tête introuvable : colonne « Libellé » absente (format Crédit Mutuel attendu)"],
			accounts: []
		};
	}

	return parseRowsWithMapping(rows, { mapping, dateFormat: 'fr', skipRows: 0, account, source: 'cm-csv' });
}

/** Account derived from the file name: 11 digits → 'cm-XXXXXXXXXXX', otherwise 'cm'. */
export function accountFromFileName(name: string): string {
	const m = /(\d{11})/.exec(name);
	return m ? `cm-${m[1]}` : 'cm';
}

/**
 * Reads a CM CSV file (UTF-8 → windows-1252 decoding through csvCore).
 * The account is derived from the file name (00012345678.csv → 'cm-00012345678').
 */
export async function parseCreditMutuelCsv(file: File): Promise<CsvImportResult> {
	return parseCreditMutuelText(decodeCsv(await file.arrayBuffer()), accountFromFileName(file.name));
}

/**
 * Format detection: the header looks like a Crédit Mutuel export (label +
 * typical CM markers: value date, reconciled operation…).
 */
export function matchesCmHeader(headerFields: string[]): boolean {
	const keys = new Set(
		headerFields.map((h) => HEADER_MAP[normalizeHeader(h)]).filter((k) => k !== undefined)
	);
	return keys.has('label') && (keys.has('valueDate') || keys.has('checked') || keys.has('analysisDate'));
}
