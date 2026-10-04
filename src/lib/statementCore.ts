import type { Transaction } from './types';
import { normalizeHeader, parseDateIso, type AccountKind, type ImportedAccount } from './csvCore';

/**
 * Shared core of standard statements (OFX/QFX, QIF, CAMT): pure module for decoding, account id,
 * label and compact dates. Logic inspired by ezBookkeeping (MIT, pkg/converters).
 */

export type StatementFormat = 'ofx' | 'qif' | 'camt';

/** Account of a statement: registry (fallback label, kind) + dated DECLARED balance. */
export type StatementAccount = ImportedAccount & { balanceAt?: string };

export interface StatementResult {
	format: StatementFormat;
	transactions: Transaction[];
	accounts: StatementAccount[];
	/** Rejected operations (unreadable, pending, investments, opening balance). */
	ignored: number;
	errors: string[];
}

/** Short format labels (toasts, import box). */
export const STATEMENT_LABELS: Record<StatementFormat, string> = {
	ofx: 'Relevé OFX',
	qif: 'Relevé QIF',
	camt: 'Relevé CAMT'
};

/** Declared charset (OFX CHARSET, e.g. 'CHARSET:1252', XML encoding) → TextDecoder label, or null. */
function decoderLabel(declared: string | undefined): string | null {
	const raw = (declared ?? '').trim().toLowerCase();
	if (!raw || raw === 'none') return null;
	const label = /^\d+$/.test(raw) ? `windows-${raw}` : raw;
	try {
		new TextDecoder(label);
		return label;
	} catch {
		return null;
	}
}

/**
 * Decodes a statement: BOM or zero bytes → UTF-16; valid UTF-8 first (some banks declare 1252
 * but write UTF-8), else the declared charset, else windows-1252 (French bank exports are often
 * Latin-1).
 */
export function decodeStatement(buffer: ArrayBuffer, declared?: string): string {
	const bytes = new Uint8Array(buffer);
	if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
	if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
	if (bytes.length > 1 && bytes[1] === 0 && bytes[0] !== 0) return new TextDecoder('utf-16le').decode(bytes);
	if (bytes.length > 1 && bytes[0] === 0 && bytes[1] !== 0) return new TextDecoder('utf-16be').decode(bytes);
	try {
		return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '');
	} catch {
		return new TextDecoder(decoderLabel(declared) ?? 'windows-1252').decode(bytes);
	}
}

/** Start of the file in Latin-1 (ASCII headers: detection, declared charset). */
export function headOf(buffer: ArrayBuffer, size = 4096): string {
	const bytes = new Uint8Array(buffer, 0, Math.min(size, buffer.byteLength));
	if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes.length > 1 && bytes[1] === 0 && bytes[0] !== 0))
		return new TextDecoder('utf-16le').decode(bytes);
	if ((bytes[0] === 0xfe && bytes[1] === 0xff) || (bytes.length > 1 && bytes[0] === 0 && bytes[1] !== 0))
		return new TextDecoder('utf-16be').decode(bytes);
	return new TextDecoder('windows-1252').decode(bytes);
}

/** '20260915', '20260915120000.000[+2:CEST]' → '2026-09-15' (written date, no time-zone conversion); null if invalid. */
export function compactDate(raw: string): string | null {
	const m = /^(\d{4})(\d{2})(\d{2})/.exec(raw.trim());
	if (!m) return null;
	return parseDateIso(`${m[1]}-${m[2]}-${m[3]}`) || null;
}

/** ISO date possibly with time (CAMT 'DtTm') → 'YYYY-MM-DD'; null if invalid. */
export function isoDay(raw: string): string | null {
	return parseDateIso(raw.trim().slice(0, 10)) || null;
}

/**
 * Collapses spaces and drops pieces already contained in another (case ignored); a longer piece
 * that CONTAINS a previous one replaces it (truncated NAME + full MEMO).
 */
export function mergeLabel(parts: string[]): string {
	const clean = parts.map((p) => p.replace(/\s+/g, ' ').trim()).filter((p) => p !== '');
	const kept: string[] = [];
	for (const part of clean) {
		const lower = part.toLowerCase();
		if (kept.some((k) => k.toLowerCase().includes(lower))) continue;
		for (let i = kept.length - 1; i >= 0; i--) if (lower.includes(kept[i]!.toLowerCase())) kept.splice(i, 1);
		kept.push(part);
	}
	return kept.join(' ');
}

/** Id of a statement account: account number, IBAN, kind. */
export interface StatementAccountRef {
	iban?: string;
	/** OFX ACCTID, CAMT 'Othr>Id', QIF account name. */
	number?: string;
	/** Card statement (OFX CCSTMTRS): the number is the card's. */
	card?: boolean;
}

/** 11-character account number from a French or Monaco IBAN (FRkk BBBBB GGGGG CCCCCCCCCCC KK). */
function numberFromIban(iban: string): string | null {
	const s = iban.replace(/\s/g, '').toUpperCase();
	return /^(FR|MC)\d{2}[0-9A-Z]{23}$/.test(s) ? s.slice(14, 25) : null;
}

/**
 * Stable id, aligned with the Crédit Mutuel import: a bank account is 'cm-<11-character number>'
 * whatever the format (CSV, XLSX, OFX, CAMT, QIF), so the same account lands on the same registry
 * line whatever the import order. ACCTID may be the number alone (11), number + RIB key (13),
 * bank + branch + number (21) or a full RIB (23); a QIF account name gives its 11-digit number if
 * it contains one, else a slug. Without a French number: 'cm-<slug>', like the 'Compte' column of
 * the remapper (accountIdFromValue); card: 'carte-<last 4 digits>'. null if nothing usable.
 */
export function statementAccountId(ref: StatementAccountRef): string | null {
	const original = (ref.number ?? '').trim();
	const raw = original.replace(/\s/g, '');
	if (ref.card) {
		const digits = raw.replace(/\D/g, '');
		return digits.length >= 4 ? `carte-${digits.slice(-4)}` : null;
	}
	const fromIban = numberFromIban(ref.iban ?? '') ?? numberFromIban(raw);
	if (fromIban) return `cm-${fromIban}`;
	if (ref.iban) return `cm-${ref.iban.replace(/\s/g, '').toLowerCase()}`;
	if (!raw) return null;
	if (/^[0-9A-Z]{11}$/i.test(raw) && /\d{5}/.test(raw)) return `cm-${raw.toUpperCase()}`;
	if (/^\d{13}$/.test(raw)) return `cm-${raw.slice(0, 11)}`;
	if (/^\d{10}[0-9A-Z]{11}(\d{2})?$/i.test(raw)) return `cm-${raw.slice(10, 21).toUpperCase()}`;
	const inName = /(?:^|\D)(\d{11})(?:\D|$)/.exec(original);
	if (inName) return `cm-${inName[1]}`;
	const slug = normalizeHeader(original).replace(/ /g, '-');
	return slug ? `cm-${slug}` : null;
}

/** Last 4 characters of an account number ('••XXXX' badge); '••••' for a named account. */
export function last4Of(id: string): string {
	const tail = id.replace(/^(cm|carte)-/, '').replace(/[^0-9A-Za-z]/g, '');
	return (tail.match(/\d/g)?.length ?? 0) >= 4 ? tail.slice(-4).toUpperCase() : '••••';
}

/** Registry entry of a statement account (fallback label: a real bank label will replace it). */
export function statementAccount(id: string, kind: AccountKind | undefined, label?: string): StatementAccount {
	const last4 = last4Of(id);
	const fallback = id.startsWith('carte-') ? `Carte ••${last4}` : `Compte ••${last4}`;
	return { id, label: label?.trim() || fallback, last4, ...(kind ? { kind } : {}) };
}

/**
 * Date of the declared balance: last operation of the account in the statement (same rule as the
 * XLSX export: later operations, imported afterwards, are added to it), else the balance's own date.
 */
export function balanceDate(transactions: Transaction[], accountId: string, declaredAt: string | null): string | undefined {
	const last = transactions.reduce((m, t) => (t.account === accountId && t.booking_date > m ? t.booking_date : m), '');
	return last || declaredAt || undefined;
}

/**
 * End of an account (OFX, CAMT): sets the balance declared by the statement (rounded to the cent,
 * dated by balanceDate), then adds the account to the result, except the fallback without a number
 * ('cm'), as for a CSV without a number.
 */
export function addStatementAccount(
	result: StatementResult,
	account: StatementAccount,
	balance: { montant: number; devise: string; dateDeclaree: string | null; mouvements: Transaction[] } | null
): void {
	if (balance) {
		account.balance = Math.round(balance.montant * 100) / 100;
		account.currency = balance.devise;
		const at = balanceDate(balance.mouvements, account.id, balance.dateDeclaree);
		if (at) account.balanceAt = at;
	}
	if (account.id !== 'cm' && !result.accounts.some((a) => a.id === account.id)) result.accounts.push(account);
}

/** Statement transaction (signed amount → direction + absolute value with 2 decimals). */
export function statementTx(
	format: StatementFormat,
	fields: { amount: number; currency: string; booking: string; value: string; label: string; account: string }
): Transaction {
	return {
		transaction_amount: { amount: Math.abs(fields.amount).toFixed(2), currency: fields.currency || 'EUR' },
		booking_date: fields.booking,
		value_date: fields.value || fields.booking,
		remittance_information: [fields.label],
		credit_debit_indicator: fields.amount >= 0 ? 'CRDT' : 'DBIT',
		source: format,
		account: fields.account
	};
}
