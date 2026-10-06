import type { PdfLine } from './pdfNatixis';
import { natixisPdfKind } from './pdfNatixis';
import { looksLikeKrakStatement } from './pdfKrak';
import { looksLikeTaxNotice } from './pdfTax';
import { portageDocumentType } from './portage';
import { looksLikeFranceTravailStatement } from './franceTravail';
import { isAmazonArchive } from './amazonArchive';
import { readVehicleDocument } from './pdfVehicle';
import { detectStatementFormat } from './statements';
import { decodeCsv, detectDelimiter, tokenize } from './csvCore';
import { detectCsvFormat } from './csvNatixis';
import { matchesAmazonHeader } from './amazonOrders';
import { matchesKrakenLedgerHeader } from './csvKraken';

/**
 * Import panel: which format and which page a dropped file belongs to (pure
 * module, testable with tsx). Signatures are the importers' own; nothing is
 * imported here.
 *
 * - Transactions: everything its multi-file import can read (bank statements,
 *   Kraken ledger, Amazon, Krak PDF, Natixis, tax notice);
 * - Portage: InfoPortage PDFs; Voiture: vehicle documents.
 */

export type ImportFamily =
	| 'cm-xlsx'
	| 'cm-csv'
	| 'natixis-csv'
	| 'kraken-csv'
	| 'amazon'
	| 'csv'
	| 'ofx'
	| 'qif'
	| 'camt'
	| 'krak-pdf'
	| 'natixis-pdf'
	| 'impot-pdf'
	| 'infoportage'
	| 'france-travail'
	| 'vehicule';

export type ImportTarget = 'transactions' | 'portage' | 'voiture' | 'impot';

export interface Detection {
	famille: ImportFamily;
	cible: ImportTarget;
}

export interface Unrecognized {
	famille: null;
	raison: string;
}

export const FAMILY_LABELS: Record<ImportFamily, string> = {
	'cm-xlsx': 'Export XLSX Crédit Mutuel',
	'cm-csv': 'CSV Crédit Mutuel',
	'natixis-csv': 'CSV Natixis',
	'kraken-csv': 'Ledger Kraken (CSV)',
	amazon: 'Commandes Amazon (CSV)',
	csv: 'CSV à colonnes inconnues (remappage)',
	ofx: 'Relevé OFX/QFX',
	qif: 'Relevé QIF',
	camt: 'Relevé CAMT',
	'krak-pdf': 'Relevé Krak (PDF)',
	'natixis-pdf': 'Document Natixis (PDF)',
	'impot-pdf': "Avis d'impôt (PDF)",
	infoportage: 'Document InfoPortage (PDF)',
	'france-travail': 'Relevé France Travail (PDF)',
	vehicule: 'Document véhicule (PDF)'
};

const PDF_TARGETS: Record<'krak-pdf' | 'natixis-pdf' | 'impot-pdf' | 'infoportage' | 'france-travail' | 'vehicule', ImportTarget> = {
	'krak-pdf': 'transactions',
	'natixis-pdf': 'transactions',
	'impot-pdf': 'transactions',
	infoportage: 'portage',
	'france-travail': 'impot',
	vehicule: 'voiture'
};

/** PDF by name or MIME type. */
export function isPdf(name: string, type = ''): boolean {
	return type === 'application/pdf' || /\.pdf$/i.test(name);
}

/**
 * Text or spreadsheet file: standard statement by content (OFX/QIF/CAMT),
 * XLSX (by name, or a « PK » zip signature), then CSV by its header line
 * (Amazon, Kraken ledger, Crédit Mutuel, Natixis). A CSV with unknown columns
 * goes to the Transactions remapper.
 */
export function detectFile(name: string, buffer: ArrayBuffer): Detection | Unrecognized {
	const statementFormat = detectStatementFormat(buffer);
	if (statementFormat) return { famille: statementFormat, cible: 'transactions' };
	const bytes = new Uint8Array(buffer, 0, Math.min(4, buffer.byteLength));
	const zip = bytes[0] === 0x50 && bytes[1] === 0x4b;
	if (/\.xlsx$/i.test(name) || zip) {
		if (zip && !/\.xlsx$/i.test(name) && isAmazonArchive(buffer)) return { famille: 'amazon', cible: 'transactions' };
		return /\.xlsx$/i.test(name) ? { famille: 'cm-xlsx', cible: 'transactions' } : { famille: null, raison: 'archive non prise en charge (export Amazon « Your Shopping History » attendu pour un ZIP)' };
	}
	if (/\.(ofx|qfx|qif|xml)$/i.test(name)) return { famille: null, raison: 'relevé non reconnu : ni OFX/QFX, ni QIF, ni CAMT.053/052' };
	if (!/\.(csv|txt|tsv)$/i.test(name)) return { famille: null, raison: 'format non pris en charge (CSV, XLSX, OFX, QIF, CAMT ou PDF attendus)' };
	const text = decodeCsv(buffer);
	const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
	const fields = tokenize(firstLine, detectDelimiter(firstLine))[0] ?? [];
	if (matchesAmazonHeader(fields)) return { famille: 'amazon', cible: 'transactions' };
	if (matchesKrakenLedgerHeader(fields)) return { famille: 'kraken-csv', cible: 'transactions' };
	const csv = detectCsvFormat(text);
	if (csv === 'cm') return { famille: 'cm-csv', cible: 'transactions' };
	if (csv === 'natixis') return { famille: 'natixis-csv', cible: 'transactions' };
	return { famille: 'csv', cible: 'transactions' };
}

/**
 * PDF already extracted into lines (read only once): Krak statement, Natixis
 * document, tax notice, InfoPortage (payslip, activity account, expense
 * report), then vehicle document last (the most permissive reading).
 */
export function detectPdf(pages: PdfLine[][]): Detection | Unrecognized {
	const family = looksLikeKrakStatement(pages)
		? 'krak-pdf'
		: natixisPdfKind(pages)
			? 'natixis-pdf'
			: looksLikeFranceTravailStatement(pages)
				? 'france-travail'
				: looksLikeTaxNotice(pages)
				? 'impot-pdf'
				: portageDocumentType(pages)
					? 'infoportage'
					: !('error' in readVehicleDocument(pages))
						? 'vehicule'
						: null;
	if (!family) return { famille: null, raison: 'PDF non reconnu (ni relevé Krak, ni Natixis, ni avis d’impôt, ni relevé France Travail, ni InfoPortage, ni document véhicule)' };
	return { famille: family, cible: PDF_TARGETS[family] };
}
