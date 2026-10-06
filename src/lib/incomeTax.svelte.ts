import { persistJson } from './storage';
import { portageState } from './portage.svelte';
import { taxableBase } from './portage';
import { getTransactions, getMerchantCategoryMap } from './store.svelte';
import { budgetState } from './budget.svelte';
import { subcategorize } from './subcategories';
import { signedAmount } from './data';
import { getTaxNotices } from './taxes.svelte';
import { computeTax, defaultTaxYear, projectMonths, regularisation, type Regularisation, type TaxResult, type WithholdingMonth } from './incomeTax';
import { currentLawFor, rulesFor, rulesWarning, type TaxYearRules } from './incomeTaxRules';

/**
 * Income tax estimate, app side: the year's payslips (portage salarial), the salary received
 * before them (read from the « Salaire » credits, editable), the household and the figures typed
 * on the page for each income year (`budget:income-tax`, the only thing stored), and the result.
 */

const KEY = 'budget:income-tax';

/** Figures typed for one income year. */
export interface YearInputs {
	/** Net taxable salary received before the first payslip of the year (null = estimated). */
	before: number | null;
	/** Withholding rate applied to that salary (%, null = rate of the first payslip). */
	beforeRate: number | null;
	otherIncome: number;
	/** Actual professional expenses (null = flat 10 %). */
	actualExpenses: number | null;
	reductions: number;
	/** Partner's net taxable salary of the year and the tax withheld on it (couple). */
	partnerSalary: number;
	partnerWithheld: number;
}

export interface TaxSettings {
	couple: boolean;
	children: number;
	/** Scale used while the year's rules are a bill: the bill, or the law in force today. */
	scale: 'bill' | 'current';
	/** Income year shown (null = automatic). */
	year: number | null;
	years: Record<string, YearInputs>;
}

const EMPTY_YEAR: YearInputs = { before: null, beforeRate: null, otherIncome: 0, actualExpenses: null, reductions: 0, partnerSalary: 0, partnerWithheld: 0 };
const num = (x: unknown, d: number) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : d);
const numOrNull = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : null);

function readYear(v: unknown): YearInputs {
	const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
	return {
		before: numOrNull(o.before),
		beforeRate: numOrNull(o.beforeRate),
		otherIncome: num(o.otherIncome, 0),
		actualExpenses: numOrNull(o.actualExpenses),
		reductions: num(o.reductions, 0),
		partnerSalary: num(o.partnerSalary, 0),
		partnerWithheld: num(o.partnerWithheld, 0)
	};
}

function load(): TaxSettings {
	const empty: TaxSettings = { couple: false, children: 0, scale: 'bill', year: null, years: {} };
	if (typeof localStorage === 'undefined') return empty;
	try {
		const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Record<string, unknown> | null;
		if (!v || typeof v !== 'object') return empty;
		const years: Record<string, YearInputs> = {};
		if (v.years && typeof v.years === 'object') for (const [y, inputs] of Object.entries(v.years)) if (/^\d{4}$/.test(y)) years[y] = readYear(inputs);
		return {
			couple: v.couple === true,
			children: Math.round(num(v.children, 0)),
			scale: v.scale === 'current' ? 'current' : 'bill',
			year: typeof v.year === 'number' && Number.isInteger(v.year) ? v.year : null,
			years
		};
	} catch {
		return empty;
	}
}

export const taxSettings = $state({ v: load() });

/** Changes the household, the scale or the year shown. */
export function setTaxSettings(patch: Partial<Omit<TaxSettings, 'years'>>): void {
	taxSettings.v = { ...taxSettings.v, ...patch };
	persistJson(KEY, taxSettings.v);
}

/** Changes the figures typed for one income year. */
export function setYearInputs(year: number, patch: Partial<YearInputs>): void {
	const current = taxSettings.v.years[String(year)] ?? EMPTY_YEAR;
	taxSettings.v = { ...taxSettings.v, years: { ...taxSettings.v.years, [String(year)]: { ...current, ...patch } } };
	persistJson(KEY, taxSettings.v);
}

export interface IncomeTaxView {
	year: number;
	/** Years offered: last year and this year. */
	years: number[];
	/** The year was picked automatically. */
	auto: boolean;
	/** The year is over: every month comes from a payslip. */
	past: boolean;
	inputs: YearInputs;
	rules: TaxYearRules & { exact: boolean };
	months: WithholdingMonth[];
	/** Salary credits seen before the first payslip of the year, and the estimate drawn from them. */
	before: { credits: number; months: number; rate: number; taxable: number; withheld: number; estimated: boolean };
	portageTaxable: number;
	result: TaxResult;
	reg: Regularisation;
	/** While the year's scale is a bill: tax with the bill and with the law in force, and which one is used. */
	compare: { used: 'bill' | 'current'; bill: { rules: TaxYearRules; netTax: number }; current: { rules: TaxYearRules; netTax: number } } | null;
	/** The scale needs updating (still a bill after the vote, or missing year), else null. */
	warning: string | null;
	/** Notice of the year shown (when it has arrived) and of the year before. */
	notice: { incomeTax: number; remaining?: number } | null;
	lastYear: { year: number; incomeTax: number } | null;
}

const view = $derived.by((): IncomeTaxView => {
	const today = new Date().toISOString().slice(0, 10);
	const thisYear = Number(today.slice(0, 4));
	const s = taxSettings.v;
	const notices = getTaxNotices();
	const autoYear = defaultTaxYear(today, notices.some((n) => n.year === thisYear - 1));
	const year = s.year === thisYear || s.year === thisYear - 1 ? s.year : autoYear;
	const inputs = s.years[String(year)] ?? EMPTY_YEAR;
	const slips = portageState.data.paies
		.filter((p) => p.pas && p.mois.startsWith(`${year}-`))
		.map((p) => ({ month: p.mois, taxable: Math.round(taxableBase(p) * 100) / 100, rate: p.pas!.taux, withheld: p.pas!.montant }));
	const months = projectMonths(slips, year);
	const firstMonth = months[0]?.month ?? `${year}-13`;
	const mm = getMerchantCategoryMap();
	const salaryCredits = getTransactions().filter((t) => {
		const d = t.booking_date ?? '';
		return d.startsWith(`${year}-`) && d.slice(0, 7) < firstMonth && signedAmount(t) > 0 && subcategorize(t, budgetState.overrides, undefined, mm) === 'salaire';
	});
	const credits = Math.round(salaryCredits.reduce((sum, t) => sum + signedAmount(t), 0));
	const creditMonths = new Set(salaryCredits.map((t) => t.booking_date.slice(0, 7))).size;
	const rate = inputs.beforeRate ?? months[0]?.rate ?? 0;
	const estimatedTaxable = rate < 100 ? Math.round(credits / (1 - rate / 100)) : credits;
	const beforeTaxable = inputs.before ?? estimatedTaxable;
	const beforeWithheld = Math.round((beforeTaxable * rate) / 100);
	const portageTaxable = Math.round(months.reduce((sum, m) => sum + m.taxable, 0));
	const input = {
		salaries: s.couple ? [beforeTaxable + portageTaxable, inputs.partnerSalary] : [beforeTaxable + portageTaxable],
		actualExpenses: inputs.actualExpenses === null ? undefined : [inputs.actualExpenses, null],
		otherIncome: inputs.otherIncome,
		household: { couple: s.couple, children: s.children },
		reductions: inputs.reductions
	};
	const billRules = rulesFor(year);
	const currentRules = currentLawFor(year);
	const useCurrent = currentRules !== null && s.scale === 'current';
	const rules = useCurrent ? { ...currentRules, exact: true } : billRules;
	const result = computeTax(input, rules);
	const compare = currentRules
		? {
				used: useCurrent ? ('current' as const) : ('bill' as const),
				bill: { rules: billRules, netTax: useCurrent ? computeTax(input, billRules).netTax : result.netTax },
				current: { rules: currentRules, netTax: useCurrent ? result.netTax : computeTax(input, currentRules).netTax }
			}
		: null;
	const own = notices.find((n) => n.year === year);
	const prev = notices.find((n) => n.year === year - 1);
	return {
		year,
		years: [thisYear - 1, thisYear],
		auto: year === autoYear && s.year === null,
		past: year < thisYear,
		inputs,
		rules,
		months,
		before: { credits, months: creditMonths, rate, taxable: beforeTaxable, withheld: beforeWithheld, estimated: inputs.before === null },
		portageTaxable,
		result,
		reg: regularisation(result.netTax, months, { withheld: beforeWithheld + (s.couple ? inputs.partnerWithheld : 0) }),
		compare,
		warning: rulesWarning(year, today),
		notice: own ? { incomeTax: own.incomeTax, ...(own.remaining !== undefined ? { remaining: own.remaining } : {}) } : null,
		lastYear: prev ? { year: prev.year, incomeTax: prev.incomeTax } : null
	};
});

/** Estimate of the income year shown, recomputed from the data and the settings. */
export function getIncomeTax(): IncomeTaxView {
	return view;
}
