import type { Transaction } from './types';
import type { AccountKind } from './csvCore';
import { parseAmountFr } from './csvCore';
import { child, childrenNamed, findAll, parseMarkup, textAt, type MarkupNode } from './markup';
import {
	addStatementAccount,
	compactDate,
	decodeStatement,
	headOf,
	mergeLabel,
	statementAccount,
	statementAccountId,
	statementTx,
	type StatementAccount,
	type StatementResult
} from './statementCore';

/**
 * OFX / QFX statements (Open Financial Exchange) — pure module.
 * Logic inspired by ezBookkeeping (MIT, pkg/converters/ofx):
 * - OFX 1.x: "OFXHEADER:100" header (ENCODING, CHARSET) then an SGML body whose
 *   data tags are not closed; OFX 2.x: XML;
 * - account (STMTRS) and card (CCSTMTRS) statements, several per file;
 * - signed TRNAMT (negative = debit), DTPOSTED = booking date, DTAVAIL = value
 *   date; label = NAME (or PAYEE>NAME) + MEMO without repetition;
 * - LEDGERBAL balance → the account's DECLARED balance (beyond ezBookkeeping).
 */

/** OFX data tags whose end tag is optional in SGML. */
const OFX_LEAVES: ReadonlySet<string> = new Set([
	'CODE', 'SEVERITY', 'MESSAGE', 'DTSERVER', 'LANGUAGE', 'DTPROFUP', 'DTACCTUP', 'ORG', 'FID', 'TRNUID',
	'CLTCOOKIE', 'SESSCOOKIE', 'USERKEY', 'TSKEYEXPIRE', 'ACCESSKEY', 'INTU.BID', 'INTU.USERID', 'CURDEF',
	'BANKID', 'BRANCHID', 'ACCTID', 'ACCTTYPE', 'ACCTKEY', 'DTSTART', 'DTEND', 'TRNTYPE', 'DTPOSTED', 'DTUSER',
	'DTAVAIL', 'TRNAMT', 'FITID', 'CORRECTFITID', 'CORRECTACTION', 'SRVRTID', 'CHECKNUM', 'REFNUM', 'SIC',
	'PAYEEID', 'NAME', 'EXTDNAME', 'MEMO', 'CURRATE', 'CURSYM', 'BALAMT', 'DTASOF', 'ADDR1', 'ADDR2', 'ADDR3',
	'CITY', 'STATE', 'POSTALCODE', 'COUNTRY', 'PHONE', 'MKTGINFO', 'INV401KSOURCE'
]);

/** Aggregates a search fallback must not dig into (payee account, currency). */
const SKIP_IN_TRN: ReadonlySet<string> = new Set(['BANKACCTTO', 'CCACCTTO', 'CURRENCY', 'ORIGCURRENCY']);

/** Fallback label for a transaction with neither NAME nor MEMO. */
const TRNTYPE_LABELS: Record<string, string> = {
	CHECK: 'Chèque',
	ATM: 'Retrait DAB',
	CASH: 'Retrait',
	POS: 'Paiement carte',
	FEE: 'Frais bancaires',
	SRVCHG: 'Frais bancaires',
	INT: 'Intérêts',
	DIV: 'Dividende',
	XFER: 'Virement',
	DIRECTDEP: 'Virement reçu',
	DEP: 'Dépôt',
	DIRECTDEBIT: 'Prélèvement',
	REPEATPMT: 'Prélèvement',
	PAYMENT: 'Paiement'
};

/** OFX account type → registry kind. */
const ACCTTYPE_KINDS: Record<string, AccountKind> = {
	CHECKING: 'courant',
	SAVINGS: 'livret',
	MONEYMRKT: 'livret',
	CD: 'livret',
	CREDITLINE: 'pret'
};

/** OFX 1.x header ("KEY:VALUE" before <OFX>) or XML declaration: character set. */
function declaredCharset(head: string): string | undefined {
	const xml = /<\?xml[^>]*encoding\s*=\s*["']([^"']+)["']/i.exec(head);
	if (xml) return xml[1];
	const encoding = /^\s*ENCODING\s*:\s*(\S+)/im.exec(head)?.[1]?.toUpperCase();
	if (encoding === 'UTF-8' || encoding === 'UTF8') return 'utf-8';
	if (encoding === 'UNICODE') return 'utf-16le';
	return /^\s*CHARSET\s*:\s*(\S+)/im.exec(head)?.[1];
}

/** Decodes an OFX file according to its header (valid UTF-8 wins, see decodeStatement). */
export function decodeOfx(buffer: ArrayBuffer): string {
	return decodeStatement(buffer, declaredCharset(headOf(buffer)));
}

/**
 * Parses an already decoded OFX statement. `fallbackAccount`: account used when the file gives none.
 */
export function parseOfx(text: string, fallbackAccount = 'cm'): StatementResult {
	const result: StatementResult = { format: 'ofx', transactions: [], accounts: [], ignored: 0, errors: [] };
	const start = text.search(/<OFX[\s>]/i);
	if (start === -1) {
		result.errors.push('Fichier OFX illisible : balise <OFX> introuvable');
		return result;
	}
	const tree = parseMarkup(text.slice(start), { leaves: OFX_LEAVES, upperCase: true });
	const statements = [...findAll(tree, 'STMTRS'), ...findAll(tree, 'CCSTMTRS')];
	if (statements.length === 0) {
		result.errors.push('Aucun relevé de compte dans ce fichier OFX (relevé de placements non pris en charge)');
		return result;
	}
	for (const st of statements) parseStatementNode(st, fallbackAccount, result);
	return result;
}

function parseStatementNode(st: MarkupNode, fallbackAccount: string, result: StatementResult): void {
	const card = st.name === 'CCSTMTRS';
	const from = child(st, card ? 'CCACCTFROM' : 'BANKACCTFROM') ?? child(st, 'BANKACCTFROM') ?? child(st, 'CCACCTFROM');
	const accountId = statementAccountId({ number: textAt(from, 'ACCTID'), card }) ?? fallbackAccount;
	const currency = (textAt(st, 'CURDEF') || 'EUR').toUpperCase();
	if (currency !== 'EUR') result.errors.push(`Compte en ${currency} : montants repris tels quels, sans conversion en euros`);

	const list = child(st, 'BANKTRANLIST') ?? findAll(st, 'BANKTRANLIST')[0];
	const items = childrenNamed(list, 'STMTTRN');
	const trns = items.length > 0 ? items : findAll(list, 'STMTTRN');
	const added: Transaction[] = [];
	trns.forEach((trn, i) => {
		const tx = parseTrn(trn, accountId, currency, i + 1, result);
		if (tx) added.push(tx);
	});
	result.transactions.push(...added);

	const acctType = textAt(from, 'ACCTTYPE').toUpperCase();
	const account: StatementAccount = statementAccount(accountId, card ? 'courant' : ACCTTYPE_KINDS[acctType]);
	const ledger = child(st, 'LEDGERBAL');
	const balance = ledger ? parseAmountFr(textAt(ledger, 'BALAMT')) : null;
	addStatementAccount(result, account, ledger && balance !== null ? { montant: balance, devise: currency, dateDeclaree: compactDate(textAt(ledger, 'DTASOF')), mouvements: added } : null);
}

/**
 * One STMTTRN → transaction. An amount in another currency (CURRENCY aggregate
 * + rate) is converted into the account's currency. A cheque number is only
 * added to a cheque's label (some banks put a reference everywhere).
 */
function parseTrn(trn: MarkupNode, accountId: string, currency: string, rank: number, result: StatementResult): Transaction | null {
	const at = (path: string) => textAt(trn, path, SKIP_IN_TRN);
	const amountRaw = at('TRNAMT');
	let amount = parseAmountFr(amountRaw);
	const booking = compactDate(at('DTPOSTED'));
	if (amount === null || !booking) {
		result.ignored++;
		result.errors.push(
			amount === null
				? `Opération ${rank} : montant illisible (« ${amountRaw} »), ignorée`
				: `Opération ${rank} : date illisible (« ${at('DTPOSTED')} »), ignorée`
		);
		return null;
	}
	const fx = child(trn, 'CURRENCY');
	const rate = fx ? parseAmountFr(textAt(fx, 'CURRATE')) : null;
	const symbol = fx ? textAt(fx, 'CURSYM').toUpperCase() : '';
	if (rate !== null && rate > 0 && symbol && symbol !== currency) amount = Math.round(amount * rate * 100) / 100;

	const type = at('TRNTYPE').toUpperCase();
	let label = mergeLabel([at('NAME') || textAt(child(trn, 'PAYEE'), 'NAME'), at('MEMO')]);
	const checkNum = at('CHECKNUM');
	if (checkNum && (type === 'CHECK' || !label || /ch[eè]que/i.test(label)) && !label.includes(checkNum))
		label = mergeLabel([label || TRNTYPE_LABELS.CHECK!, checkNum]);
	if (!label) label = TRNTYPE_LABELS[type] ?? 'Opération';

	return statementTx('ofx', {
		amount,
		currency,
		booking,
		value: compactDate(at('DTAVAIL')) ?? booking,
		label,
		account: accountId
	});
}
