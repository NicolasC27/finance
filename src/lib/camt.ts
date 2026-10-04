import type { Transaction } from './types';
import { parseAmountFr } from './csvCore';
import { child, childrenNamed, findAll, parseMarkup, textAt, type MarkupNode } from './markup';
import {
	addStatementAccount,
	decodeStatement,
	headOf,
	isoDay,
	mergeLabel,
	statementAccount,
	statementAccountId,
	statementTx,
	type StatementAccount,
	type StatementResult
} from './statementCore';

/**
 * CAMT statements (ISO 20022) — pure module: camt.053 (end-of-day statement,
 * « Stmt »), camt.052 (intraday report, « Rpt ») and camt.054 (notification,
 * « Ntfctn »), all versions (namespaces ignored).
 * Logic inspired by ezBookkeeping (MIT, pkg/converters/camt), with two
 * app-specific choices:
 * - one operation per entry (Ntry), like the bank's CSV exports — batch
 *   details (TxDtls) only feed the label; account balance and duplicate guard
 *   stay correct;
 * - pending (PDNG) or informative (INFO) entries are dropped: they will come
 *   back booked in a later statement.
 * Declared balance: closing booked (CLBD), otherwise interim booked (ITBD).
 */

/** Priority of the balance types used as declared balance. */
const BALANCE_TYPES = ['CLBD', 'ITBD', 'CLAV', 'ITAV'];

/** Decodes a CAMT file according to its XML declaration (UTF-8 by default). */
export function decodeCamt(buffer: ArrayBuffer): string {
	const declared = /<\?xml[^>]*encoding\s*=\s*["']([^"']+)["']/i.exec(headOf(buffer))?.[1];
	return decodeStatement(buffer, declared);
}

/** Date of a « <X><Dt>…</Dt></X> » or « <X><DtTm>…</DtTm></X> » block. */
function dateOf(node: MarkupNode | undefined): string | null {
	if (!node) return null;
	return isoDay(textAt(node, 'Dt') || textAt(node, 'DtTm'));
}

/** Signed amount of a block carrying Amt + CdtDbtInd (debit negative); null when unreadable. */
function signedAmountOf(node: MarkupNode): number | null {
	const amount = parseAmountFr(textAt(node, 'Amt'));
	if (amount === null) return null;
	return textAt(node, 'CdtDbtInd').toUpperCase() === 'DBIT' ? -Math.abs(amount) : Math.abs(amount);
}

/** Party name (« Dbtr>Nm » up to v7, « Dbtr>Pty>Nm » afterwards). */
function partyName(parties: MarkupNode | undefined, role: 'Dbtr' | 'Cdtr'): string {
	const party = child(parties, role);
	return textAt(party, 'Nm') || textAt(child(party, 'Pty'), 'Nm');
}

/** Parses an already decoded CAMT statement. `fallbackAccount`: account used when the statement gives none. */
export function parseCamt(text: string, fallbackAccount = 'cm'): StatementResult {
	const result: StatementResult = { format: 'camt', transactions: [], accounts: [], ignored: 0, errors: [] };
	const tree = parseMarkup(text);
	const statements = ['Stmt', 'Rpt', 'Ntfctn'].flatMap((name) => findAll(tree, name)).filter((n) => child(n, 'Acct'));
	if (statements.length === 0) {
		result.errors.push('Fichier CAMT illisible : aucun relevé de compte (Stmt/Rpt) trouvé');
		return result;
	}
	let pending = 0;
	for (const st of statements) pending += parseStatementNode(st, fallbackAccount, result);
	if (pending > 0) {
		result.ignored += pending;
		result.errors.push(`${pending} opération${pending > 1 ? 's' : ''} en attente ignorée${pending > 1 ? 's' : ''} : elle${pending > 1 ? 's' : ''} reviendr${pending > 1 ? 'ont' : 'a'} comptabilisée${pending > 1 ? 's' : ''} au prochain relevé`);
	}
	return result;
}

/**
 * Adds a statement's entries; returns the number of dropped pending entries.
 * The account name is the DIRECT Acct>Nm child only (Ownr>Nm = owner,
 * Svcr>…>Nm = bank: never an account name); the declared balance is the first
 * recognised one in BALANCE_TYPES order.
 */
function parseStatementNode(st: MarkupNode, fallbackAccount: string, result: StatementResult): number {
	const acct = child(st, 'Acct')!;
	const accountId =
		statementAccountId({ iban: textAt(acct, 'Id>IBAN'), number: textAt(acct, 'Id>Othr>Id') }) ?? fallbackAccount;
	const accountCurrency = (textAt(acct, 'Ccy') || 'EUR').toUpperCase();
	const added: Transaction[] = [];
	let pending = 0;

	childrenNamed(st, 'Ntry').forEach((entry, i) => {
		const status = (textAt(entry, 'Sts>Cd') || textAt(entry, 'Sts')).toUpperCase();
		if (status === 'PDNG' || status === 'INFO') {
			pending++;
			return;
		}
		const amount = signedAmountOf(entry);
		const booking = dateOf(child(entry, 'BookgDt'));
		if (amount === null || !booking) {
			result.ignored++;
			result.errors.push(
				amount === null
					? `Écriture ${i + 1} : montant illisible (« ${textAt(entry, 'Amt')} »), ignorée`
					: `Écriture ${i + 1} : date comptable absente ou illisible, ignorée`
			);
			return;
		}
		const currency = (child(entry, 'Amt')?.attrs.Ccy || accountCurrency).toUpperCase();
		added.push(
			statementTx('camt', {
				amount,
				currency,
				booking,
				value: dateOf(child(entry, 'ValDt')) ?? booking,
				label: entryLabel(entry, amount),
				account: accountId
			})
		);
	});
	result.transactions.push(...added);
	if (accountCurrency !== 'EUR' && added.length > 0)
		result.errors.push(`Compte en ${accountCurrency} : montants repris tels quels, sans conversion en euros`);

	const account: StatementAccount = statementAccount(accountId, undefined, child(acct, 'Nm')?.text || undefined);
	const balances = childrenNamed(st, 'Bal');
	let balance: { montant: number; devise: string; dateDeclaree: string | null; mouvements: Transaction[] } | null = null;
	for (const type of BALANCE_TYPES) {
		const bal = balances.find((b) => (textAt(b, 'Tp>CdOrPrtry>Cd') || textAt(b, 'Tp>CdOrPrtry>Prtry')).toUpperCase() === type);
		const amount = bal ? signedAmountOf(bal) : null;
		if (bal && amount !== null) {
			balance = { montant: amount, devise: accountCurrency, dateDeclaree: dateOf(child(bal, 'Dt')) ?? null, mouvements: added };
			break;
		}
	}
	addStatementAccount(result, account, balance);
	return pending;
}

/**
 * Entry label: the bank's additional information, then the counterparty (payee
 * of a debit, payer of a credit) and the unstructured remittance info of the
 * first 3 details — without repetition.
 */
function entryLabel(entry: MarkupNode, amount: number): string {
	const parts = [textAt(entry, 'AddtlNtryInf')];
	const details = findAll(child(entry, 'NtryDtls'), 'TxDtls');
	for (const td of details.slice(0, 3)) {
		parts.push(partyName(child(td, 'RltdPties'), amount < 0 ? 'Cdtr' : 'Dbtr'));
		for (const u of findAll(child(td, 'RmtInf'), 'Ustrd')) parts.push(u.text);
		parts.push(textAt(td, 'AddtlTxInf'));
	}
	const label = mergeLabel(parts);
	if (label) return details.length > 3 ? `${label} (+${details.length - 3} opérations)` : label;
	return textAt(entry, 'BkTxCd>Prtry>Cd') || 'Opération';
}
