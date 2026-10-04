/**
 * Shared CSV core (Crédit Mutuel, Natixis): UTF-8 → windows-1252 decoding,
 * RFC-4180 tokenisation (quotes, ""), automatic delimiter, normalised headers,
 * French dates and amounts.
 */

/** Normalises a header: lowercase, no accents, punctuation → spaces. */
export function normalizeHeader(raw: string): string {
	return raw
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();
}

/** Splits the text into rows of fields (standard CSV, quotes and "" handled; skips a BOM; keeps a last row without a final newline). */
export function tokenize(text: string, delimiter: string): string[][] {
	const rows: string[][] = [];
	let field = '';
	let row: string[] = [];
	let inQuotes = false;
	let i = 0;
	if (text.charCodeAt(0) === 0xfeff) i = 1;
	for (; i < text.length; i++) {
		const c = text[i];
		if (inQuotes) {
			if (c === '"') {
				if (text[i + 1] === '"') {
					field += '"';
					i++;
				} else {
					inQuotes = false;
				}
			} else {
				field += c;
			}
		} else if (c === '"') {
			inQuotes = true;
		} else if (c === delimiter) {
			row.push(field);
			field = '';
		} else if (c === '\n' || c === '\r') {
			if (c === '\r' && text[i + 1] === '\n') i++;
			row.push(field);
			rows.push(row);
			row = [];
			field = '';
		} else {
			field += c;
		}
	}
	if (field !== '' || row.length > 0) {
		row.push(field);
		rows.push(row);
	}
	return rows;
}

/** Automatic delimiter from the header line: ; , or tab. */
export function detectDelimiter(headerLine: string): string {
	const candidates = [';', ',', '\t'];
	let best = ';';
	let bestCount = 0;
	for (const d of candidates) {
		const count = headerLine.split(d).length - 1;
		if (count > bestCount) {
			best = d;
			bestCount = count;
		}
	}
	return best;
}

/** Optional time part (« 10:12 », « 10:12:33.5 », time zone) stripped from a date. */
const TIME_SUFFIX = String.raw`(?:[ T]\d{1,2}:\d{2}(?::\d{2}(?:[.,]\d+)?)?(?:\s?(?:Z|[+-]\d{2}:?\d{2}))?)?`;
const FR_DATE_RE = new RegExp(String.raw`^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})${TIME_SUFFIX}$`);
const ISO_DATE_RE = new RegExp(String.raw`^(\d{4})-(\d{2})-(\d{2})${TIME_SUFFIX}$`);

/**
 * "YYYY-MM-DD" when the day really exists (calendar round trip: 31/02 or 29/02
 * of a non-leap year are rejected), otherwise null.
 */
function validYmd(year: number, month: number, day: number): string | null {
	const d = new Date(Date.UTC(year, month - 1, day));
	if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
	return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * French date "DD/MM/YYYY" (or . -), optional time ignored (« 24/07/2026
 * 10:12 ») → ISO "YYYY-MM-DD"; "" when empty; null when invalid (31/02
 * included).
 */
export function parseDateFr(raw: string): string | null {
	const s = raw.trim();
	if (!s) return '';
	const m = FR_DATE_RE.exec(s);
	if (!m) return null;
	let year = Number(m[3]);
	if (year < 100) year += 2000;
	return validYmd(year, Number(m[2]), Number(m[1]));
}

/**
 * ISO date "YYYY-MM-DD", optional time and time zone ignored (« 2026-07-24
 * 10:12:33 », « 2026-07-24T10:12:33Z »: the written date is kept as is,
 * without time zone conversion); "" when empty; null when invalid.
 */
export function parseDateIso(raw: string): string | null {
	const s = raw.trim();
	if (!s) return '';
	const m = ISO_DATE_RE.exec(s);
	return m ? validYmd(Number(m[1]), Number(m[2]), Number(m[3])) : null;
}

/**
 * Tolerant date: ISO accepted (time ignored), otherwise French format.
 * "" when empty; null when invalid.
 */
export function parseDateFlexible(raw: string): string | null {
	const s = raw.trim();
	if (!s) return '';
	if (/^\d{4}-/.test(s)) return parseDateIso(s);
	return parseDateFr(s);
}

/**
 * Tolerant amount → number; null when invalid. Accepts: spaces (including
 * non-breaking U+00A0/U+202F), a leading « + », typographic minus U+2212 and
 * dashes, the € symbol or « EUR », French decimal comma, decimal point (XLSX
 * cells), thousands grouped by dot or comma when both separators coexist
 * (« 1.234,56 », « 1,234.56 »: the last one is the decimal) and the
 * exponential notation of XLSX cells (« 5.0000000000000001E-3 »).
 * Ambiguous (« 1,234,567 ») → null.
 */
export function parseAmountFr(raw: string): number | null {
	let s = raw
		.replace(/[\s\u00a0\u202f]/g, '')
		.replace(/[\u2212\u2012\u2013]/g, '-')
		.replace(/€|eur/gi, '');
	if (s.startsWith('+')) s = s.slice(1);
	if (!s) return null;
	const lastComma = s.lastIndexOf(',');
	const lastDot = s.lastIndexOf('.');
	if (lastComma !== -1 && lastDot !== -1) {
		s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
	} else if (lastComma !== -1) {
		if (s.indexOf(',') !== lastComma) return null;
		s = s.replace(',', '.');
	}
	if (!/^-?\d+(\.\d+)?(e[+-]?\d+)?$/i.test(s)) return null;
	const n = Number(s);
	return Number.isFinite(n) ? n : null;
}

/**
 * Direction and amount of a row from its (already parsed) columns:
 * - signed column first (negative = debit);
 * - otherwise separate columns: an amount in the Debit column is always an
 *   outflow (exports write it signed « -82,35 » or not « 82,35 »); a NEGATIVE
 *   amount in the Credit column is an outflow (reversal, signed export) — no
 *   longer recorded as a +5 credit;
 * - both columns filled: the larger absolute value wins.
 * null when no column has an amount.
 */
export function resolveDirection(
	signed: number | null,
	debit: number | null,
	credit: number | null
): { isCredit: boolean; amount: number } | null {
	if (signed !== null) return { isCredit: signed >= 0, amount: Math.abs(signed) };
	if (credit !== null && (debit === null || Math.abs(credit) >= Math.abs(debit))) {
		return { isCredit: credit >= 0, amount: Math.abs(credit) };
	}
	if (debit !== null) return { isCredit: false, amount: Math.abs(debit) };
	return null;
}

/**
 * Decodes a CSV buffer: UTF-8 first; when U+FFFD shows up, re-read as
 * windows-1252 (French bank exports are often Latin-1).
 */
export function decodeCsv(buffer: ArrayBuffer): string {
	let text = new TextDecoder('utf-8').decode(buffer);
	if (text.includes('\uFFFD')) {
		text = new TextDecoder('windows-1252').decode(buffer);
	}
	return text;
}

// ---------- Account kind detection (v9) ----------

/** Account kind detected from the bank label. */
export type AccountKind = 'courant' | 'livret' | 'pret' | 'crypto' | 'autre';

/**
 * Account found by an import (XLSX « Vos comptes » registry, CSV file name or
 * remapped « Compte » column). `balance`/`currency` are only set by the XLSX
 * summary sheet (DECLARED balance).
 */
export interface ImportedAccount {
	id: string;
	label: string;
	last4: string;
	kind?: AccountKind;
	balance?: number;
	currency?: string;
}

/** Lowercase without accents (combining NFD marks removed), punctuation KEPT (« c/c », « cc »… patterns). */
function foldLabel(label: string): string {
	return label
		.toLowerCase()
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '');
}

/**
 * Guesses an account kind from its label (+ special id cases).
 * « pret » is checked BEFORE « courant »: « Passeport Crédit » contains
 * « credit », while a C/C never matches these patterns. The label is matched
 * both normalised (lowercase, no accents, punctuation → spaces, padded with
 * spaces for patterns ending with a space) and with punctuation kept
 * (« c/c »). A generic fallback label (« Compte ••7902 ») says nothing →
 * 'autre' (deliberate: no guessing without a clue), except a Natixis id, which
 * defaults to a current account.
 */
export function detectAccountKind(label: string, id = ''): AccountKind {
	if (id.startsWith('kraken')) return 'crypto';
	const norm = normalizeHeader(label);
	const hay = ` ${norm} `;
	const flat = foldLabel(label);
	const has = (needle: string) => hay.includes(needle) || flat.includes(needle);
	if (['passeport credit', 'pret', 'credit', 'loan', 'lombard'].some(has)) return 'pret';
	if (['livret', 'ldd', 'ldds', 'lep', 'cel ', 'pel ', 'developpement durable', 'epargne logement'].some(has))
		return 'livret';
	if (['c/c', 'cc ', 'compte courant', 'eurocompte', 'chequier', 'compte de depot', 'compte cheque'].some(has))
		return 'courant';
	if (['kraken', 'binance', 'coinbase', 'crypto'].some(has)) return 'crypto';
	if (id.startsWith('natixis')) return 'courant';
	return 'autre';
}
