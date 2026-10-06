import type { PdfLine } from './pdfNatixis';

/**
 * France Travail « relevé de situation » (PDF) → the unemployment benefit (ARE) of each month:
 * gross, supplementary pension, social levies, income tax withheld and net, plus the personal
 * withholding rate. The net taxable amount is the withholding base (tax ÷ rate), the figure of the
 * yearly tax certificate. Pure module apart from the pdfjs extraction.
 */

export interface BenefitMonth {
	/** YYYY-MM of the period. */
	month: string;
	days: number;
	gross: number;
	pension: number;
	social: number;
	tax: number;
	net: number;
	/** Personal withholding rate (%) of the statement. */
	rate: number;
	/** Statement date (YYYY-MM-DD). */
	statement: string;
	/** Payment date (YYYY-MM-DD): taxed in the year it is paid. */
	paidOn?: string;
}

const AMOUNT = /(?<![\d,])\d+(?:[ \u00a0\u202f]\d{3})*,\d{2}/g;
const num = (s: string) => Number(s.replace(/\s/g, '').replace(',', '.'));
const iso = (d: string) => `${d.slice(6, 10)}-${d.slice(3, 5)}-${d.slice(0, 2)}`;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Is this PDF a France Travail statement? */
export function looksLikeFranceTravailStatement(pages: PdfLine[][]): boolean {
	const text = pages.flat().map((l) => l.text).join(' ');
	return /RELEVE DE SITUATION DU/i.test(text) && /FRANCE TRAVAIL|POLE EMPLOI/i.test(text);
}

/**
 * Benefit months of a statement: each « Allocation d'Aide au Retour à l'Emploi » line (its amounts on
 * the same line or just below) takes the period above it; when the amounts already paid are there
 * too, the amounts due (last five) count.
 */
export function parseFranceTravailStatement(pages: PdfLine[][]): { months: BenefitMonth[]; rate: number; statement: string } | { error: string } {
	const lines = pages.flat().map((l) => l.text.replace(/\s+/g, ' ').trim());
	const all = lines.join(' ');
	const statement = /RELEVE DE SITUATION DU (\d{2}\/\d{2}\/\d{4})/i.exec(all)?.[1];
	if (!statement) return { error: 'relevé de situation France Travail non reconnu' };
	const rateMatch = /taux\s+personnalis[ée]+\s+de\s+(\d{1,2}(?:,\d{1,2})?)\s*%/i.exec(all);
	const rate = rateMatch ? num(rateMatch[1]!) : 0;
	const paid = /REGLEMENT DU (\d{2}\/\d{2}\/\d{4})/i.exec(all)?.[1];
	const months: BenefitMonth[] = [];
	let period: string | null = null;
	for (const [i, line] of lines.entries()) {
		const p = /PERIODE DU (\d{2}\/\d{2}\/\d{4}) AU/i.exec(line);
		if (p) period = iso(p[1]!).slice(0, 7);
		const are = /^Allocation d['’]Aide au\b(.*)$/i.exec(line);
		if (!are || !period) continue;
		const text = [are[1]!, ...lines.slice(i + 1, i + 3)].find((t) => (t.match(AMOUNT) ?? []).length >= 5);
		if (!text) continue;
		const amounts = [...text.matchAll(AMOUNT)].map((m) => num(m[0]));
		const [gross, pension, social, tax, net] = amounts.slice(-5) as [number, number, number, number, number];
		const days = Number(/^\s*(\d{1,2})\s/.exec(text.replace(AMOUNT, ' '))?.[1] ?? 0);
		months.push({ month: period, days, gross, pension, social, tax, net, rate, statement: iso(statement), ...(paid ? { paidOn: iso(paid) } : {}) });
	}
	if (!months.length) return { error: 'aucune allocation versée sur ce relevé' };
	return { months, rate, statement: iso(statement) };
}

/**
 * Net taxable amount of a benefit month: the withholding base (tax ÷ rate); without a rate, the
 * net plus the tax plus the non-deductible part of the social levies (CSG 2.4 % + CRDS 0.5 % of 6.7 %).
 */
export function benefitTaxable(m: BenefitMonth): number {
	if (m.rate > 0 && m.tax > 0) return r2((m.tax * 100) / m.rate);
	return r2(m.net + m.tax + (m.social * 2.9) / 6.7);
}

/** Income year of a benefit month: the year it was paid (a December allocation paid in January counts the next year). */
export function benefitYear(m: BenefitMonth): number {
	return Number((m.paidOn ?? m.month).slice(0, 4));
}

/** Benefit month a France Travail credit pays: the month before its date (allocations are paid early the next month). */
export function paidMonthOf(creditDate: string): string {
	const n = Number(creditDate.slice(0, 4)) * 12 + Number(creditDate.slice(5, 7)) - 2;
	return `${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, '0')}`;
}

/** Merges months (a newer statement replaces the same month), sorted. */
export function mergeBenefitMonths(current: readonly BenefitMonth[], added: readonly BenefitMonth[]): BenefitMonth[] {
	const byMonth = new Map(current.map((m) => [m.month, m]));
	for (const m of added) {
		const old = byMonth.get(m.month);
		if (!old || old.statement <= m.statement) byMonth.set(m.month, m);
	}
	return [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
}
