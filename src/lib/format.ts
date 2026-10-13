/** Formatting helpers (amounts, dates, labels). */

/**
 * Privacy mode (« mode discret »): the SENSITIVE amounts (wealth, balances, crypto, savings, salary,
 * portage) come out masked through the `sensitive*` formatters (see sensitiveFormat.ts); everyday
 * spending stays readable. The source is plugged by ui.svelte.ts (a reactive flag), so templates
 * re-render instantly when it toggles.
 */
let privacySource: () => boolean = () => false;

export function setPrivacySource(fn: () => boolean): void {
	privacySource = fn;
}

/** Masked amount shown in privacy mode (no digit, same currency sign). */
export const MASKED_AMOUNT = '••••';

/** Euro amounts written inside free text (notes, AI answers, alerts): « 4 235 € », « 0,29 €/km », « 1,2 k€ ». */
const AMOUNT_IN_TEXT = /[-−+]?\d[\d\u00a0\u202f .]*(?:,\d+)?\s?k?€/g;

/** Free text with its euro amounts masked in privacy mode (unchanged otherwise). */
export function maskAmounts(text: string): string {
	return privacySource() ? text.replace(AMOUNT_IN_TEXT, `${MASKED_AMOUNT}\u00a0€`) : text;
}

/** Is privacy mode on (reactive when read inside a template or a derived)? */
export function isPrivate(): boolean {
	return privacySource();
}

const eur = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const eurCompact = new Intl.NumberFormat('fr-FR', {
	style: 'currency',
	currency: 'EUR',
	maximumFractionDigits: 0
});

const dateFmt = new Intl.DateTimeFormat('fr-FR', {
	day: 'numeric',
	month: 'short',
	year: 'numeric'
});

const monthFmt = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' });

/**
 * Intl emits an ASCII hyphen « - » for negatives: it is unified into the
 * typographic minus « − » (consistent with the +/- variations that build the
 * sign by hand). The narrow no-break space U+202F Intl fr-FR puts between
 * thousands is only ~2 px wide in DM Serif (« 1234,56 € » read next to
 * « 5 678,90 € »): replaced by the regular no-break space U+00A0.
 */
function typoMinus(s: string): string {
	return s.replace('-', '−').replace(/\u202f/g, '\u00a0');
}

const pctFormats = new Map<number, Intl.NumberFormat>();

/**
 * Percentage in French format: decimal comma, typographic minus, no-break
 * space before « % ». `signed` adds « + » to positive values.
 * 25.8 → « 25,8 % »; −0.8 (signed) → « −0,8 % »; 14.3 (signed) → « +14,3 % ».
 */
export function formatPct(value: number, digits = 1, signed = false): string {
	let fmt = pctFormats.get(digits);
	if (!fmt) {
		fmt = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
		pctFormats.set(digits, fmt);
	}
	const body = typoMinus(fmt.format(value));
	return `${signed && value > 0 ? '+' : ''}${body}\u00a0%`;
}

/** 1234.5 → "1 234,50 €"; −1234.5 → "−1 234,50 €" (typographic minus) */
export function formatEUR(amount: number): string {
	return typoMinus(eur.format(amount));
}

const MASKED = `${MASKED_AMOUNT}\u00a0€`;

/** formatEUR for a sensitive amount: masked in privacy mode. */
export function sensitiveEUR(amount: number): string {
	return privacySource() ? MASKED : formatEUR(amount);
}

/** formatEURCompact for a sensitive amount: masked in privacy mode. */
export function sensitiveEURCompact(amount: number): string {
	return privacySource() ? MASKED : formatEURCompact(amount);
}

/** formatEURNarrowParts for a sensitive amount: masked in privacy mode. */
export function sensitiveEURNarrowParts(amount: number): NarrowParts {
	return privacySource() ? { main: MASKED, suffix: '' } : formatEURNarrowParts(amount);
}

/** formatEURNarrow for a sensitive amount: masked in privacy mode. */
export function sensitiveEURNarrow(amount: number): string {
	return privacySource() ? MASKED : formatEURNarrow(amount);
}

/** Compact version without decimals (chart axes). */
export function formatEURCompact(amount: number): string {
	return typoMinus(eurCompact.format(amount));
}

const narrowK = new Intl.NumberFormat('fr-FR', {
	minimumFractionDigits: 1,
	maximumFractionDigits: 1
});

/** Parts of a narrow amount: number alone + optional suffix. */
export interface NarrowParts {
	main: string;
	suffix: 'k€' | '';
}

/**
 * « k€ » split: the number and the suffix are rendered in separate elements
 * (dedicated span with neutral kerning) to avoid the €/k collision under
 * aggressive display tracking. See `.amount-suffix` (app.css).
 */
export function formatEURNarrowParts(amount: number): NarrowParts {
	const abs = Math.abs(amount);
	if (abs >= 100_000) {
		return { main: `${amount < 0 ? '−' : ''}${typoMinus(narrowK.format(abs / 1000))}`, suffix: 'k€' };
	}
	return { main: typoMinus(eur.format(amount)), suffix: '' };
}

/**
 * « Narrow card » format (plain string, aria-labels/tooltips):
 * ≥ 100,000 € → "128,4 k€" (one decimal), otherwise the regular EUR format.
 */
export function formatEURNarrow(amount: number): string {
	const { main, suffix } = formatEURNarrowParts(amount);
	return suffix ? `${main} ${suffix}` : main;
}

/** Neatly truncates a long label (ellipsis), 40 characters by default. */
export function truncateLabel(label: string, max = 40): string {
	if (label.length <= max) return label;
	return `${label.slice(0, max - 1).trimEnd()}…`;
}

/** "2026-07-15" → "15 juil. 2026"; "" → "En cours"; unreadable date → raw text (never a render exception). Parsed at noon to avoid time zone issues. */
export function formatDate(iso: string): string {
	if (!iso) return 'En cours';
	const d = new Date(`${iso}T12:00:00`);
	return Number.isNaN(d.getTime()) ? iso : dateFmt.format(d);
}

const dayMonthFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });

/** formatDate without the year when it is `year` (the current one by default): "2026-07-15" → "15 juil.", "2025-07-15" → "15 juil. 2025". */
export function formatDateShort(iso: string, year = new Date().getFullYear()): string {
	if (!iso || !iso.startsWith(`${year}-`)) return formatDate(iso);
	const d = new Date(`${iso}T12:00:00`);
	return Number.isNaN(d.getTime()) ? iso : dayMonthFmt.format(d);
}

/** "2026-07" → "Juillet 2026" (capitalised); unreadable key → « — ». */
export function formatMonth(monthKey: string): string {
	if (!/^\d{4}-\d{2}$/.test(monthKey)) return monthKey || '—';
	const [y, m] = monthKey.split('-').map(Number);
	const label = monthFmt.format(new Date(y!, m! - 1, 15));
	return label.charAt(0).toUpperCase() + label.slice(1);
}

/** "YYYY-MM" key of an ISO date. */
export function monthKeyOf(isoDate: string): string {
	return isoDate.slice(0, 7);
}

/** Acronyms kept in upper case when cleaning (list shared with merchantLabel). */
export const KEEP_UPPER: ReadonlySet<string> = new Set([
	'EDF', 'SNCF', 'RATP', 'UGC', 'SFR', 'CPAM', 'FNAC', 'LIDL', 'KFC', 'TGV',
	'DAB', 'EURL', 'SARL', 'SAS', 'SA', 'SNC', 'SCOP', 'BP'
]);

/** Technical bank prefixes to strip. */
const PREFIX_RE = /^(CB|PRELEVEMENT|VIREMENT|PAIEMENT|CARTE)\s+/i;

/**
 * Cleans the raw label of a bank statement: joins the lines, strips technical
 * prefixes, converts to title case ("CB CARREFOUR CITY" → "Carrefour City").
 */
export function cleanLabel(remittanceInformation: string[]): string {
	const raw = remittanceInformation.join(' ').replace(/\s+/g, ' ').trim();
	const stripped = raw.replace(PREFIX_RE, '');
	return stripped
		.split(' ')
		.map((word) => {
			if (KEEP_UPPER.has(word.toUpperCase()) && word.length <= 6) return word.toUpperCase();
			if (/^[A-Z0-9.]+$/.test(word) && word.length > 1) {
				return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
			}
			return word;
		})
		.join(' ');
}

/**
 * Normalised label for grouping (recurrences, learned rules):
 * cleanLabel → upper case → variable numbers removed → spaces collapsed.
 * "CB CARREFOUR CITY 75 PARIS" → "CARREFOUR CITY PARIS".
 */
export function normalizeLabelKey(remittanceInformation: string[]): string {
	return cleanLabel(remittanceInformation)
		.toUpperCase()
		.replace(/\b\d[\d./-]*\b/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}
