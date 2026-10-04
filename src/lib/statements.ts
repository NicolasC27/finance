import { accountFromFileName } from './csvCreditMutuel';
import { decodeOfx, parseOfx } from './ofx';
import { parseQif } from './qif';
import { decodeCamt, parseCamt } from './camt';
import { decodeStatement, headOf, type StatementFormat, type StatementResult } from './statementCore';

export { STATEMENT_LABELS, type StatementAccount, type StatementFormat, type StatementResult } from './statementCore';
export { isStatementSource, skipKnownMovements } from './duplicateGuard';

/**
 * Standard statements (OFX/QFX, QIF, CAMT.053/052): pure module for detection by content (whatever
 * the name or the button used), reading, and the anti-duplicate guard against CSV/XLSX exports
 * already imported.
 */

/** Format recognised from the file content; null for a plain CSV/XLSX. */
export function detectStatementFormat(buffer: ArrayBuffer): StatementFormat | null {
	const head = headOf(buffer).replace(/^﻿/, '').trimStart();
	if (/^OFXHEADER\s*:/i.test(head) || /<OFX[\s>]/i.test(head) || /<\?OFX\b/i.test(head)) return 'ofx';
	if (/camt\.05[234]/i.test(head) || /<(?:\w+:)?BkToCstmr(?:Stmt|AcctRpt|DbtCdtNtfctn)\b/.test(head)) return 'camt';
	if (/^!(?:Type|Account|Option|Clear)\b/i.test(head)) return 'qif';
	return null;
}

/**
 * Reads a statement. The fallback account comes from the file name (11 digits → 'cm-…', else
 * 'cm'), as for a Crédit Mutuel CSV.
 */
export function parseStatement(buffer: ArrayBuffer, fileName: string): StatementResult | null {
	const format = detectStatementFormat(buffer);
	const fallback = accountFromFileName(fileName);
	switch (format) {
		case 'ofx':
			return parseOfx(decodeOfx(buffer), fallback);
		case 'camt':
			return parseCamt(decodeCamt(buffer), fallback);
		case 'qif':
			return parseQif(decodeStatement(buffer), fallback);
		default:
			return null;
	}
}
