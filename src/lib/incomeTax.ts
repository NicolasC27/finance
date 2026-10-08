import { COLLECTION_THRESHOLD, INSTALMENT_THRESHOLD, type TaxYearRules } from './incomeTaxRules';

/**
 * Income tax estimate (pure, testable): taxable salaries after the 10 % deduction (or actual
 * expenses), family quotient with its cap, progressive scale, décote, reductions; then the
 * withholding already taken and still to come against that tax, which gives the regularisation
 * of the next September (or a refund) and the rate that would avoid it.
 */

export interface Household {
	couple: boolean;
	children: number;
}

export interface TaxInput {
	/** Net taxable salary of the year per person (one entry, two for a couple). */
	salaries: readonly number[];
	/** Actual professional expenses per person instead of the 10 % deduction (null = 10 %). */
	actualExpenses?: readonly (number | null)[];
	/** Other income taxed on the scale (already net). */
	otherIncome: number;
	household: Household;
	/** Tax reductions and credits (€). */
	reductions: number;
}

export interface BracketLine {
	from: number;
	to: number | null;
	rate: number;
	/** Tax of this bracket for one part. */
	tax: number;
}

export interface TaxResult {
	grossSalaries: number;
	deduction: number;
	netIncome: number;
	parts: number;
	/** Income per part. */
	quotient: number;
	brackets: BracketLine[];
	/** Scale tax with every part, and with the base parts only (1 or 2). */
	taxWithParts: number;
	taxBaseParts: number;
	/** Tax after the family quotient cap. */
	grossTax: number;
	/** The cap limited the advantage of the children. */
	capped: boolean;
	decote: number;
	reductions: number;
	/** Tax due (0 under the collection threshold). */
	netTax: number;
	/** Rate of the last bracket reached (without the children's parts when the cap applies). */
	marginalRate: number;
	/** netTax / net income (%). */
	averageRate: number;
}

const round = (n: number) => Math.round(n);

/** Tax parts: 1 alone, 2 as a couple; ½ for each of the first two children, 1 from the third; +½ for a single parent. */
export function taxParts(h: Household): number {
	const c = Math.max(0, Math.floor(h.children));
	const children = Math.min(c, 2) * 0.5 + Math.max(0, c - 2);
	return (h.couple ? 2 : 1) + children + (!h.couple && c > 0 ? 0.5 : 0);
}

/** Flat professional deduction of one salary: 10 % between the floor and the cap, never more than the salary. */
export function professionalDeduction(salary: number, rules: TaxYearRules): number {
	if (!(salary > 0)) return 0;
	return round(Math.min(salary, Math.min(rules.deduction.cap, Math.max(rules.deduction.floor, (salary * rules.deduction.rate) / 100))));
}

/** Scale tax for one part of `quotient` €, bracket by bracket. */
export function scaleLines(quotient: number, rules: TaxYearRules): BracketLine[] {
	const out: BracketLine[] = [];
	let from = 0;
	for (const b of rules.brackets) {
		const top = b.upTo ?? Infinity;
		const slice = Math.max(0, Math.min(quotient, top) - from);
		out.push({ from, to: b.upTo, rate: b.rate, tax: (slice * b.rate) / 100 });
		from = top;
	}
	return out;
}

const scaleTax = (income: number, parts: number, rules: TaxYearRules) => scaleLines(income / parts, rules).reduce((s, l) => s + l.tax, 0) * parts;

/** Income tax of the year, every step kept for display. */
export function computeTax(input: TaxInput, rules: TaxYearRules): TaxResult {
	const salaries = input.salaries.map((s) => Math.max(0, s));
	const grossSalaries = round(salaries.reduce((s, x) => s + x, 0));
	const deduction = salaries.reduce((s, x, i) => {
		const actual = input.actualExpenses?.[i];
		return s + (actual !== null && actual !== undefined && actual >= 0 ? Math.min(x, actual) : professionalDeduction(x, rules));
	}, 0);
	const netIncome = Math.max(0, Math.floor(grossSalaries - deduction + Math.max(0, input.otherIncome)));
	const parts = taxParts(input.household);
	const baseParts = input.household.couple ? 2 : 1;
	const taxWithParts = scaleTax(netIncome, parts, rules);
	const taxBaseParts = scaleTax(netIncome, baseParts, rules);
	const halfParts = Math.round((parts - baseParts) * 2);
	const singleParent = !input.household.couple && input.household.children > 0;
	const cap = singleParent ? rules.qfCapSingleParent + Math.max(0, halfParts - 2) * rules.qfCapPerHalfPart : halfParts * rules.qfCapPerHalfPart;
	const capped = taxBaseParts - taxWithParts > cap;
	const grossTax = round(capped ? taxBaseParts - cap : taxWithParts);
	const forfait = input.household.couple ? rules.decote.couple : rules.decote.single;
	const decote = round(Math.min(grossTax, Math.max(0, forfait - (rules.decote.rate / 100) * grossTax)));
	const reductions = Math.max(0, input.reductions);
	const due = Math.max(0, grossTax - decote - reductions);
	const netTax = due < COLLECTION_THRESHOLD ? 0 : round(due);
	const quotient = netIncome / parts;
	const brackets = scaleLines(quotient, rules);
	const marginalRate = [...(capped ? scaleLines(netIncome / baseParts, rules) : brackets)].reverse().find((l) => l.tax > 0)?.rate ?? 0;
	return {
		grossSalaries,
		deduction: round(deduction),
		netIncome,
		parts,
		quotient: round(quotient),
		brackets,
		taxWithParts: round(taxWithParts),
		taxBaseParts: round(taxBaseParts),
		grossTax,
		capped,
		decote,
		reductions,
		netTax,
		marginalRate,
		averageRate: netIncome > 0 ? Math.round((netTax / netIncome) * 1000) / 10 : 0
	};
}

const BENEFIT_LABEL = /\b(POLE ?EMPLOI|FRANCE ?TRAVAIL|ALLOCATIONS? ARE)\b/;

/** Is a credit an unemployment benefit (France Travail, ex-Pôle emploi), taxable like a salary? */
export function isUnemploymentBenefit(label: string): boolean {
	return BENEFIT_LABEL.test(label.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
}

/**
 * Income year to show by default: last year until October (declaration in May, regularisation in
 * September) as long as its notice has not been imported, else this year.
 */
export function defaultTaxYear(today: string, lastYearNoticeImported: boolean): number {
	const year = Number(today.slice(0, 4));
	return Number(today.slice(5, 7)) < 10 && !lastYearNoticeImported ? year - 1 : year;
}

export interface WithholdingMonth {
	/** YYYY-MM. */
	month: string;
	taxable: number;
	rate: number;
	withheld: number;
	/** Still to come: projected at the last payslip until December (its rate can still change). */
	projected: boolean;
	/** Already past but without payslip (missing between two, or not imported yet): estimated like the month before. */
	missing?: boolean;
}

/** Months without payslip after which the estimate stops (the contract has probably ended). */
const STALE_MONTHS = 3;

const monthIndex = (month: string) => Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7));

/**
 * Months of the year from the first payslip to December: each payslip as read; a month without
 * payslip before the last one, or after it but already past, estimated like the month before
 * (`missing`); months still to come projected at the last payslip (`projected`). Given `today`,
 * nothing is counted after a payslip three months old or more: the contract has probably ended
 * (a year already over then stops at its last payslip).
 */
export function projectMonths(payslips: readonly { month: string; taxable: number; rate: number; withheld: number }[], year: number, today?: string): WithholdingMonth[] {
	const own = payslips.filter((p) => p.month.startsWith(`${year}-`)).sort((a, b) => a.month.localeCompare(b.month));
	if (!own.length) return [];
	const lastRead = own[own.length - 1]!.month;
	const current = today ? today.slice(0, 7) : null;
	const stale = current !== null && monthIndex(current) - monthIndex(lastRead) >= STALE_MONTHS;
	const out: WithholdingMonth[] = [];
	let last = own[0]!;
	for (let m = Number(own[0]!.month.slice(5, 7)); m <= 12; m++) {
		const month = `${year}-${String(m).padStart(2, '0')}`;
		const p = own.find((x) => x.month === month);
		if (p) {
			last = p;
			out.push({ month, taxable: p.taxable, rate: p.rate, withheld: p.withheld, projected: false });
			continue;
		}
		if (month > lastRead && stale) break;
		const estimate = { month, taxable: last.taxable, rate: last.rate, withheld: Math.round(last.taxable * last.rate) / 100 };
		const past = month < lastRead || (current !== null && month < current);
		out.push(past ? { ...estimate, projected: false, missing: true } : { ...estimate, projected: true });
	}
	return out;
}

export interface Regularisation {
	/** Withheld on the payslips read and before them (€). */
	withheldSoFar: number;
	/** Still withheld until December at the current rate (€). */
	withheldToCome: number;
	/** Estimated tax − everything withheld: > 0 to pay next September, < 0 refunded. */
	balance: number;
	/** Paid in four instalments (September → December) when over 300 €. */
	instalments: number;
	/** Net taxable of the projected months, and the rate on them that would bring the balance to zero (%). */
	remainingTaxable: number;
	rateToAvoid: number | null;
}

/** Withholding against the estimated tax: what is left to pay (or refunded) and the rate that avoids it. */
export function regularisation(netTax: number, months: readonly WithholdingMonth[], before: { withheld: number }): Regularisation {
	const withheldSoFar = Math.round(before.withheld + months.filter((m) => !m.projected).reduce((s, m) => s + m.withheld, 0));
	const toCome = months.filter((m) => m.projected);
	const withheldToCome = Math.round(toCome.reduce((s, m) => s + m.withheld, 0));
	const balance = Math.round(netTax - withheldSoFar - withheldToCome);
	const remainingTaxable = Math.round(toCome.reduce((s, m) => s + m.taxable, 0));
	const rateToAvoid = remainingTaxable > 0 ? Math.max(0, Math.round(((netTax - withheldSoFar) / remainingTaxable) * 1000) / 10) : null;
	return { withheldSoFar, withheldToCome, balance, instalments: balance > INSTALMENT_THRESHOLD ? 4 : balance > 0 ? 1 : 0, remainingTaxable, rateToAvoid };
}
