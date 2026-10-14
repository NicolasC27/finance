/**
 * What-if simulator (pure, testable): the current monthly budget and net-worth path, then the same
 * with a scenario of monthly changes (income up or down, new or removed expense, new loan) and
 * one-off ones (purchase, down payment, windfall). Nothing here touches the real data.
 *
 * Wealth is simulated month by month in today's euros: liquid wealth earns the real return, a new
 * loan is a debt amortised at its own rate, insurance included in the monthly outflow; its
 * instalments and remaining debt are fixed in euros, so inflation makes them lighter over time. The money
 * of a car or personal loan is spent at once, so net worth drops by the amount and goes back up as
 * the principal is repaid; a mortgage buys a home kept at its price (only notary and fees are lost).
 */

import { LONG_TERM_INFLATION } from './inflation';
import { analyzeLoan, resolveLoan, type InsuranceMode, type JobType, type LoanAnalysis, type LoanKind } from './loanStudy';

export { loanPayment, loanTotalCost } from './loanStudy';

export type ChangeType = 'income' | 'expense' | 'loan' | 'oneoff';

export interface Change {
	id: string;
	type: ChangeType;
	label: string;
	/**
	 * income: monthly change (< 0 = lower income); expense: monthly amount (< 0 = expense removed);
	 * loan: amount borrowed; oneoff: amount spent (< 0 = money received).
	 */
	amount: number;
	/** One-off only: months from now before the money leaves (0 or missing = today). */
	month?: number;
	/** Loan only: nominal annual rate (%). */
	rate?: number;
	/** Loan only: duration (months). */
	months?: number;
	/** Loan only (missing on scenarios saved before the loan study: personal loan, no insurance). */
	kind?: LoanKind;
	/** Borrower insurance; rate null = usual rate for the age. */
	insurance?: { mode: InsuranceMode; rate: number | null };
	/** Fees (€); null = usual value for a mortgage. */
	application?: number | null;
	guarantee?: number | null;
	broker?: number;
	/** Mortgage: price of the home, new build, down payment, current rent dropped, buyer profile. */
	price?: number;
	isNew?: boolean;
	downPayment?: number;
	replacesRent?: boolean;
	mainResidence?: boolean;
	firstTime?: boolean;
}

/** Household and job used by the bank study; null = read from the app's data. */
export interface StudySettings {
	age: number;
	adults: number;
	children: number;
	rent: number | null;
	job: JobType | null;
	seniority: number | null;
	salary: number | null;
	variable: number;
	rental: number;
	alimony: number;
	existing: number | null;
}

export const DEFAULT_STUDY: StudySettings = { age: 35, adults: 1, children: 0, rent: null, job: null, seniority: null, salary: null, variable: 0, rental: 0, alimony: 0, existing: null };

export interface Scenario {
	id: string;
	name: string;
	changes: Change[];
	study?: StudySettings;
}

export interface Baseline {
	/** Usual monthly income and spending (€). */
	income: number;
	expenses: number;
	/** Principal of the current loans repaid each month (adds to net worth, not to cash). */
	loanPrincipal: number;
	/** Net worth today (€). */
	netWorth: number;
	/** Real return of liquid wealth (%/year). */
	realRate: number;
}

export interface Simulation {
	income: number;
	expenses: number;
	/** Instalments of the scenario's new loans, insurance included (first month). */
	loanPayments: number;
	/** Rent no longer paid once a mortgage replaces it. */
	rentSaved: number;
	/** Cash left each month: income − expenses + rent saved − new instalments (first month). */
	savings: number;
	/** savings / income in % (null without income). */
	savingsRate: number | null;
	/** One-off total (€ spent, < 0 = received). */
	oneOff: number;
	loans: LoanAnalysis[];
	/** Cash saved each month, index 0 = first month (instalments stop when a loan ends). */
	schedule: number[];
	/** Net worth month by month, index 0 = today after the one-off changes. */
	path: number[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;

const validLoan = (c: Change) => c.type === 'loan' && (c.amount > 0 || (c.kind === 'mortgage' && (c.price ?? 0) > 0)) && (c.months ?? 0) >= 1 && (c.rate ?? 0) >= 0;

export interface SimulateOptions {
	/** Borrower's age (suggested insurance rate). */
	age?: number;
	/** Current rent, saved when a mortgage replaces it (€/month). */
	rent?: number;
	/** YYYY-MM-DD, for the usury table. */
	today?: string;
	/** Yearly inflation (%) that erodes the fixed instalments and debt of the new loans. */
	inflation?: number;
}

/** Budget and net-worth path over `horizon` months with the given changes (none = today). */
export function simulate(base: Baseline, changes: readonly Change[], horizon = 240, opts: SimulateOptions = {}): Simulation {
	const today = opts.today ?? new Date().toISOString().slice(0, 10);
	const sum = (t: ChangeType) => changes.filter((c) => c.type === t && Number.isFinite(c.amount)).reduce((s, c) => s + c.amount, 0);
	const income = r2(base.income + sum('income'));
	const expenses = r2(base.expenses + sum('expense'));
	const oneOff = r2(sum('oneoff'));
	const loans = changes.filter(validLoan).map((c) => analyzeLoan(resolveLoan(c, opts.age ?? DEFAULT_STUDY.age), today));
	const rentSaved = loans.some((l) => l.loan.replacesRent) ? Math.max(0, opts.rent ?? 0) : 0;
	const loanPayments = r2(loans.reduce((s, l) => s + l.totalMonthly, 0));
	const savings = r2(income - expenses + rentSaved - loanPayments);
	const r = Math.pow(1 + base.realRate / 100, 1 / 12) - 1;
	const deflator = (m: number) => Math.pow(1 + (opts.inflation ?? LONG_TERM_INFLATION) / 100, -m / 12);
	const assets = loans.reduce((s, l) => s + (l.loan.price > 0 ? l.loan.price : l.loan.kind === 'mortgage' ? l.loan.principal : 0), 0);
	const upfront = loans.reduce((s, l) => s + (l.loan.price > 0 ? l.loan.downPayment : l.loan.fees.total), 0);
	const oneOffAt = (m: number) => changes.filter((c) => c.type === 'oneoff' && Number.isFinite(c.amount) && Math.max(0, Math.round(c.month ?? 0)) === m).reduce((s, c) => s + c.amount, 0);
	let liquid = base.netWorth - oneOffAt(0) - upfront;
	const debtAt = (m: number) => loans.reduce((s, l) => s + (m === 0 ? l.loan.principal : (l.remaining[m - 1] ?? 0)), 0) * deflator(m);
	const path = [Math.round(liquid + assets - debtAt(0))];
	const schedule: number[] = [];
	for (let m = 1; m <= horizon; m++) {
		const paid = loans.reduce((s, l) => s + (l.monthly[m - 1] ?? 0), 0) * deflator(m);
		const cash = income - expenses + rentSaved - paid;
		schedule.push(r2(cash));
		liquid = liquid * (1 + r) + cash + base.loanPrincipal - oneOffAt(m);
		path.push(Math.round(liquid + assets - debtAt(m)));
	}
	return {
		income,
		expenses,
		loanPayments,
		rentSaved,
		savings,
		savingsRate: income > 0 ? Math.round((savings / income) * 1000) / 10 : null,
		oneOff,
		loans,
		schedule,
		path
	};
}

/**
 * Months before a savings goal is reached when every month's cash savings go into it (earning the
 * real return): 0 if already reached, null if never within the schedule.
 */
export function goalReach(current: number, target: number, schedule: readonly number[], realRate: number): number | null {
	if (current >= target) return 0;
	const r = Math.pow(1 + realRate / 100, 1 / 12) - 1;
	let v = current;
	for (let m = 0; m < schedule.length; m++) {
		v = v * (1 + r) + schedule[m]!;
		if (v >= target) return m + 1;
	}
	return null;
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const numOrNull = (v: unknown): number | null => num(v) ?? null;

/** Loan fields of a stored row; old rows (before the loan study) get none and keep their numbers. */
function readLoan(c: Record<string, unknown>): Partial<Change> {
	const kinds: readonly string[] = ['mortgage', 'car', 'personal'];
	const modes: readonly string[] = ['none', 'initial', 'crd'];
	const ins = c.insurance as { mode?: unknown; rate?: unknown } | undefined;
	return {
		rate: Number(c.rate) || 0,
		months: Number(c.months) || 0,
		...(kinds.includes(c.kind as string) ? { kind: c.kind as LoanKind } : {}),
		...(ins && modes.includes(ins.mode as string) ? { insurance: { mode: ins.mode as InsuranceMode, rate: numOrNull(ins.rate) } } : {}),
		...('application' in c ? { application: numOrNull(c.application) } : {}),
		...('guarantee' in c ? { guarantee: numOrNull(c.guarantee) } : {}),
		...(num(c.broker) !== undefined ? { broker: num(c.broker) } : {}),
		...(num(c.price) !== undefined ? { price: num(c.price) } : {}),
		...(num(c.downPayment) !== undefined ? { downPayment: num(c.downPayment) } : {}),
		...(typeof c.isNew === 'boolean' ? { isNew: c.isNew } : {}),
		...(typeof c.replacesRent === 'boolean' ? { replacesRent: c.replacesRent } : {}),
		...(typeof c.mainResidence === 'boolean' ? { mainResidence: c.mainResidence } : {}),
		...(typeof c.firstTime === 'boolean' ? { firstTime: c.firstTime } : {})
	};
}

/** Valid household settings, defaults for what is missing. */
export function readStudy(v: unknown): StudySettings {
	const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
	const jobs: readonly string[] = ['cdi', 'portage', 'cdd'];
	return {
		age: num(o.age) ?? DEFAULT_STUDY.age,
		adults: num(o.adults) ?? DEFAULT_STUDY.adults,
		children: num(o.children) ?? DEFAULT_STUDY.children,
		rent: numOrNull(o.rent),
		job: jobs.includes(o.job as string) ? (o.job as JobType) : null,
		seniority: numOrNull(o.seniority),
		salary: numOrNull(o.salary),
		variable: num(o.variable) ?? 0,
		rental: num(o.rental) ?? 0,
		alimony: num(o.alimony) ?? 0,
		existing: numOrNull(o.existing)
	};
}

/** Valid stored scenarios (`budget:scenarios`), unknown fields dropped. */
export function readScenarios(v: unknown): Scenario[] {
	if (!Array.isArray(v)) return [];
	const types: readonly string[] = ['income', 'expense', 'loan', 'oneoff'];
	return v
		.filter((s): s is Scenario => !!s && typeof s.id === 'string' && typeof s.name === 'string' && Array.isArray(s.changes))
		.map((s) => ({
			id: s.id,
			name: s.name,
			changes: s.changes
				.filter((c) => c && typeof c.id === 'string' && types.includes(c.type) && typeof c.amount === 'number' && Number.isFinite(c.amount))
				.map((c) => ({ id: c.id, type: c.type, label: typeof c.label === 'string' ? c.label : '', amount: c.amount, ...(c.type === 'loan' ? readLoan(c as unknown as Record<string, unknown>) : {}), ...(c.type === 'oneoff' && typeof c.month === 'number' && Number.isFinite(c.month) && c.month > 0 ? { month: Math.round(c.month) } : {}) })),
			...(s.study ? { study: readStudy(s.study) } : {})
		}));
}
