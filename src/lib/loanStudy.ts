import type { Change } from './whatIf';
import {
	APPLICATION_FEE,
	EXCEPTION_DEBT_RATIO,
	EXPECTED_DOWN_PAYMENT,
	GUARANTEE_RATE,
	INCOME_WEIGHTS,
	INSURANCE_RATES,
	JOB_SENIORITY,
	LEMOINE,
	MARKET_RATES,
	MAX_CONSUMER_MONTHS,
	MAX_DEBT_RATIO,
	MAX_MORTGAGE_MONTHS,
	MAX_MORTGAGE_MONTHS_NEW,
	NOTARY_RATE,
	REMAINING_INCOME,
	USURY,
	USURY_MAX_AGE_MONTHS,
	type UsuryTable
} from './lendingRules';

/**
 * Loan study (pure, testable): what a bank looks at before lending. Real cost of a loan (instalment,
 * borrower insurance on the initial or remaining capital, fees, actuarial TAEG, usury ceiling),
 * acceptance checklist (HCSF debt ratio, duration, remaining income, job stability, down payment,
 * savings left) weighted into a qualitative verdict, and borrowing capacity. Indicative only: each
 * bank has its own grid.
 */

export type LoanKind = 'mortgage' | 'car' | 'personal';
export type InsuranceMode = 'none' | 'initial' | 'crd';
export type JobType = 'cdi' | 'portage' | 'cdd';
export type Status = 'pass' | 'warn' | 'fail';
export type Verdict = 'high' | 'medium' | 'low' | 'very-low';

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Constant monthly instalment of an amortising loan, insurance excluded (rounded to the cent). */
export function loanPayment(amount: number, ratePct: number, months: number): number {
	if (!(amount > 0) || !(months >= 1)) return 0;
	const r = ratePct / 1200;
	return r2(r === 0 ? amount / months : (amount * r) / (1 - Math.pow(1 + r, -months)));
}

/** Total interest paid over the loan (instalments × months − amount). */
export function loanTotalCost(amount: number, ratePct: number, months: number): number {
	const p = loanPayment(amount, ratePct, months);
	return p ? r2(p * Math.round(months) - amount) : 0;
}

/** Notary fees (€) of a purchase: about 7.5 % in the old, 2.5 % in the new. */
export function notaryFees(price: number, isNew: boolean): number {
	return price > 0 ? Math.round((price * (isNew ? NOTARY_RATE.new : NOTARY_RATE.old)) / 100) : 0;
}

function interpolate(points: readonly { age: number; rate: number }[], age: number): number {
	if (age <= points[0]!.age) return points[0]!.rate;
	for (let i = 1; i < points.length; i++) {
		const a = points[i - 1]!;
		const b = points[i]!;
		if (age <= b.age) return Math.round((a.rate + ((b.rate - a.rate) * (age - a.age)) / (b.age - a.age)) * 100) / 100;
	}
	return points.at(-1)!.rate;
}

/** Usual borrower insurance rate (annual % of the capital) for an age, a loan type and a contract. */
export function suggestInsuranceRate(kind: LoanKind, mode: InsuranceMode, age: number): number {
	if (mode === 'none') return 0;
	if (kind !== 'mortgage') return interpolate(INSURANCE_RATES.consumer, age);
	return interpolate(mode === 'crd' ? INSURANCE_RATES.delegation : INSURANCE_RATES.group, age);
}

export interface ResolvedLoan {
	id: string;
	label: string;
	kind: LoanKind;
	/** Amount borrowed (€). */
	principal: number;
	months: number;
	rate: number;
	insurance: { mode: InsuranceMode; rate: number };
	fees: { application: number; guarantee: number; broker: number; total: number };
	/** Mortgage only (0 otherwise). */
	price: number;
	notary: number;
	downPayment: number;
	isNew: boolean;
	replacesRent: boolean;
	mainResidence: boolean;
	firstTime: boolean;
}

/**
 * A loan row with its defaults: for a mortgage with a price, the amount borrowed is the whole
 * project (price + notary + fees) minus the down payment; fees left empty take the usual values.
 */
export function resolveLoan(c: Change, age: number): ResolvedLoan {
	const kind: LoanKind = c.kind ?? 'personal';
	const months = Math.round(c.months ?? 0);
	const rate = c.rate ?? 0;
	const price = kind === 'mortgage' ? Math.max(0, c.price ?? 0) : 0;
	const isNew = !!c.isNew;
	const notary = notaryFees(price, isNew);
	const downPayment = kind === 'mortgage' ? Math.max(0, c.downPayment ?? 0) : 0;
	const base = price > 0 ? Math.max(0, price + notary - downPayment) : Math.max(0, c.amount);
	const application = c.application ?? (kind === 'mortgage' ? Math.min(APPLICATION_FEE.cap, Math.round((base * APPLICATION_FEE.rate) / 100)) : 0);
	const guarantee = c.guarantee ?? (kind === 'mortgage' ? Math.round((base * GUARANTEE_RATE) / 100) : 0);
	const broker = c.broker ?? 0;
	const total = r2(application + guarantee + broker);
	const principal = r2(price > 0 ? base + total : base);
	const mode: InsuranceMode = c.insurance?.mode ?? 'none';
	const insRate = mode === 'none' ? 0 : (c.insurance?.rate ?? suggestInsuranceRate(kind, mode, age));
	return {
		id: c.id,
		label: c.label,
		kind,
		principal,
		months,
		rate,
		insurance: { mode, rate: insRate },
		fees: { application, guarantee, broker, total },
		price,
		notary,
		downPayment,
		isNew,
		replacesRent: kind === 'mortgage' && !!c.replacesRent,
		mainResidence: kind === 'mortgage' && !!c.mainResidence,
		firstTime: kind === 'mortgage' && !!c.firstTime
	};
}

/**
 * Actuarial TAEG (%): monthly rate i such that the amount actually received (principal − upfront
 * fees) equals the discounted monthly outflows, TAEG = (1 + i)^12 − 1. Bisection, 2 decimals.
 */
export function taeg(received: number, flows: readonly number[]): number {
	if (!(received > 0) || !flows.length) return 0;
	const pv = (i: number) => flows.reduce((s, f, k) => s + f / Math.pow(1 + i, k + 1), 0);
	if (pv(0) <= received) return 0;
	let lo = 0;
	let hi = 0.1;
	for (let n = 0; n < 200; n++) {
		const mid = (lo + hi) / 2;
		if (pv(mid) > received) lo = mid;
		else hi = mid;
	}
	return Math.round((Math.pow(1 + (lo + hi) / 2, 12) - 1) * 10000) / 100;
}

export interface UsuryCheck {
	ceiling: number;
	category: string;
	ok: boolean;
	/** The table is older than a quarter and a bit: to update. */
	stale: boolean;
}

/** Usury ceiling (Banque de France) of a loan and whether its TAEG stays below it. */
export function usuryCheck(kind: LoanKind, amount: number, months: number, rate: number, today: string, table: UsuryTable = USURY): UsuryCheck {
	const [ceiling, category] =
		kind === 'mortgage'
			? months < 120
				? [table.mortgage.under10y, 'prêt immobilier à taux fixe de moins de 10 ans']
				: months < 240
					? [table.mortgage.from10to20y, 'prêt immobilier à taux fixe de 10 à 20 ans']
					: [table.mortgage.from20y, 'prêt immobilier à taux fixe de 20 ans et plus']
			: amount <= 3000
				? [table.consumer.upTo3000, 'crédit à la consommation jusqu’à 3 000 €']
				: amount <= 6000
					? [table.consumer.upTo6000, 'crédit à la consommation de 3 000 à 6 000 €']
					: [table.consumer.above6000, 'crédit à la consommation de plus de 6 000 €'];
	const [y, m] = table.since.split('-').map(Number);
	const age = (Number(today.slice(0, 4)) - y!) * 12 + Number(today.slice(5, 7)) - m!;
	return { ceiling, category, ok: rate <= ceiling, stale: age > USURY_MAX_AGE_MONTHS };
}

/** Indicative market rate for a loan type and duration: [low, high] and a central value. */
export function marketRate(kind: LoanKind, months: number): { low: number; high: number; central: number } {
	if (kind === 'car') return { ...MARKET_RATES.car, central: r2((MARKET_RATES.car.low + MARKET_RATES.car.high) / 2) };
	if (kind === 'personal') return { ...MARKET_RATES.personal, central: r2((MARKET_RATES.personal.low + MARKET_RATES.personal.high) / 2) };
	const pts = MARKET_RATES.mortgage;
	const central = months <= pts[0]!.months ? pts[0]!.rate : months >= pts.at(-1)!.months ? pts.at(-1)!.rate : (() => {
		const i = pts.findIndex((p) => p.months >= months);
		const a = pts[i - 1]!;
		const b = pts[i]!;
		return r2(a.rate + ((b.rate - a.rate) * (months - a.months)) / (b.months - a.months));
	})();
	return { ...MARKET_RATES.mortgageRange, central };
}

export interface LoanAnalysis {
	loan: ResolvedLoan;
	withInsurance: boolean;
	/** Instalment without insurance. */
	payment: number;
	insuranceFirst: number;
	insuranceAvg: number;
	/** First month, insurance included. */
	totalMonthly: number;
	totalInterest: number;
	totalInsurance: number;
	fees: number;
	/** Interest + insurance + fees (notary excluded). */
	totalCost: number;
	taeg: number;
	/** Insurance counted in the TAEG (required for a mortgage, optional otherwise). */
	insuranceInTaeg: boolean;
	usury: UsuryCheck;
	market: { low: number; high: number; central: number };
	/** Outflow of each month (instalment + insurance) and capital left after it. */
	monthly: number[];
	remaining: number[];
}

/** Real cost of a resolved loan, with or without its insurance. */
export function analyzeLoan(loan: ResolvedLoan, today: string, withInsurance = true): LoanAnalysis {
	const { principal, months, rate } = loan;
	const payment = loanPayment(principal, rate, months);
	const insRate = withInsurance ? loan.insurance.rate : 0;
	const mode = withInsurance ? loan.insurance.mode : 'none';
	const r = rate / 1200;
	const exact = months >= 1 ? (r === 0 ? principal / months : (principal * r) / (1 - Math.pow(1 + r, -months))) : 0;
	const monthly: number[] = [];
	const remaining: number[] = [];
	const insurance: number[] = [];
	let left = principal;
	for (let k = 1; k <= months; k++) {
		const ins = mode === 'initial' ? (principal * insRate) / 1200 : mode === 'crd' ? (left * insRate) / 1200 : 0;
		left = k === months ? 0 : Math.max(0, left * (1 + r) - exact);
		insurance.push(ins);
		monthly.push(r2(payment + ins));
		remaining.push(r2(left));
	}
	const totalInsurance = r2(insurance.reduce((s, x) => s + x, 0));
	const totalInterest = months >= 1 ? r2(payment * months - principal) : 0;
	const insuranceInTaeg = loan.kind === 'mortgage';
	const flows = insuranceInTaeg ? monthly : monthly.map(() => payment);
	const t = taeg(principal - loan.fees.total, flows);
	return {
		loan,
		withInsurance,
		payment,
		insuranceFirst: r2(insurance[0] ?? 0),
		insuranceAvg: months ? r2(totalInsurance / months) : 0,
		totalMonthly: r2(payment + (insurance[0] ?? 0)),
		totalInterest,
		totalInsurance,
		fees: loan.fees.total,
		totalCost: r2(totalInterest + totalInsurance + loan.fees.total),
		taeg: t,
		insuranceInTaeg,
		usury: usuryCheck(loan.kind, principal, months, t, today),
		market: marketRate(loan.kind, months),
		monthly,
		remaining
	};
}

/** Loi Lemoine: no health questionnaire when the insured share is small and the loan ends early. */
export function noHealthQuestionnaire(insuredAmount: number, age: number, months: number): boolean {
	return insuredAmount <= LEMOINE.maxInsured && age + months / 12 < LEMOINE.endAge;
}

export interface Incomes {
	/** Net salary before tax (€/month). */
	salary: number;
	/** Variable pay, 3-year monthly average. */
	variable: number;
	/** Net rental income. */
	rental: number;
	/** Alimony set by a judgment. */
	alimony: number;
}

/** Income counted by banks: salary 100 %, variable pay 70 %, rental income 70 %, alimony 100 %. */
export function weightedIncome(i: Incomes): number {
	return r2(i.salary * INCOME_WEIGHTS.salary + i.variable * INCOME_WEIGHTS.variable + i.rental * INCOME_WEIGHTS.rental + i.alimony * INCOME_WEIGHTS.alimony);
}

/** Remaining income banks like to see: ≈ 800 € for one adult, 1 300 € for a couple, + 350 € per child. */
export function remainingIncomeThreshold(adults: number, children: number): number {
	const a = Math.max(1, Math.round(adults));
	return (a >= 2 ? REMAINING_INCOME.couple + (a - 2) * REMAINING_INCOME.adult : REMAINING_INCOME.adult) + Math.max(0, Math.round(children)) * REMAINING_INCOME.child;
}

/** Largest amount whose first instalment plus insurance fits in `maxMonthly`. */
export function maxLoanAmount(maxMonthly: number, ratePct: number, months: number, insuranceRate = 0): number {
	if (!(maxMonthly > 0) || !(months >= 1)) return 0;
	const r = ratePct / 1200;
	const factor = (r === 0 ? 1 / months : r / (1 - Math.pow(1 + r, -months))) + insuranceRate / 1200;
	return Math.floor(maxMonthly / factor / 100) * 100;
}

export interface StudyInput {
	incomes: Incomes;
	adults: number;
	children: number;
	/** Instalments of the loans already running (€/month). */
	existingPayments: number;
	/** Current rent (€/month), dropped when a mortgage replaces it. */
	rent: number;
	job: JobType;
	seniorityMonths: number;
	age: number;
	/** Current and savings accounts (available at once) and usual monthly spending (emergency fund). */
	savings: number;
	monthlySpending: number;
	/** Employee savings: released early for the purchase of the main residence. */
	employeeSavings?: number;
	/** One-off money spent by the scenario besides the down payments. */
	oneOff: number;
	/** Today (YYYY-MM-DD), to date when the job seniority becomes enough. */
	today?: string;
}

/**
 * Weight of a criterion in the verdict: a blocking one alone makes acceptance very unlikely (law or
 * HCSF rule), a major one lowers the verdict by one level, two minor ones by one level, an
 * information line never changes it.
 */
export type Weight = 'blocking' | 'major' | 'minor' | 'info';

export interface Criterion {
	id: 'debt' | 'rent' | 'duration' | 'remaining' | 'job' | 'downPayment' | 'emergency' | 'usury' | 'lemoine';
	label: string;
	status: Status;
	weight: Weight;
	reason: string;
}

export interface Study {
	income: number;
	/** HCSF debt ratio (%): loan instalments, insurance included, over the counted income. */
	debtBefore: number;
	debtAfter: number;
	/** Same ratio with the rent kept (%), which some lenders also count. */
	effortWithRent: number;
	newMonthly: number;
	rentKept: number;
	remainingIncome: number;
	remainingThreshold: number;
	/** Largest total monthly instalment allowed by the 35 % rule, insurance included. */
	maxMonthly: number;
	criteria: Criterion[];
	verdict: Verdict;
}

const pct1 = (n: number) => `${n.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`;
const pct2 = (n: number) => `${n.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} %`;
const eur = (n: number) => `${Math.round(n).toLocaleString('fr-FR')} €`;
const MONTHS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/** Month name and year `n` months after `today` (« août 2027 »). */
function monthIn(today: string, n: number): string {
	const idx = Number(today.slice(0, 4)) * 12 + Number(today.slice(5, 7)) - 1 + Math.max(0, Math.ceil(n));
	return `${MONTHS_FR[idx % 12]} ${Math.floor(idx / 12)}`;
}

/** Verdict from the weighted criteria: any blocking failure, else one level down per major issue and per two minor ones. */
export function verdictOf(criteria: readonly Pick<Criterion, 'status' | 'weight'>[]): Verdict {
	const issues = criteria.filter((c) => c.status !== 'pass' && c.weight !== 'info');
	if (issues.some((c) => c.weight === 'blocking' && c.status === 'fail')) return 'very-low';
	const major = issues.filter((c) => c.weight === 'blocking' || c.weight === 'major').reduce((n, c) => n + (c.status === 'fail' ? 2 : 1), 0);
	const minor = issues.filter((c) => c.weight === 'minor').length;
	const score = major + Math.floor(minor / 2);
	return score === 0 ? 'high' : score === 1 ? 'medium' : score === 2 ? 'low' : 'very-low';
}

/** Acceptance checklist of the scenario's new loans (with their insurance) for a household. */
export function bankStudy(input: StudyInput, loans: readonly LoanAnalysis[]): Study {
	const today = input.today ?? new Date().toISOString().slice(0, 10);
	const income = weightedIncome(input.incomes);
	const newMonthly = r2(loans.reduce((s, l) => s + l.totalMonthly, 0));
	const rentKept = loans.some((l) => l.loan.replacesRent) ? 0 : Math.max(0, input.rent);
	const credits = input.existingPayments + newMonthly;
	const ratio = (x: number) => (income > 0 ? Math.round((x / income) * 1000) / 10 : Infinity);
	const debtBefore = ratio(input.existingPayments);
	const debtAfter = ratio(credits);
	const effortWithRent = ratio(credits + rentKept);
	const remainingIncome = r2(income - credits - rentKept);
	const remainingThreshold = remainingIncomeThreshold(input.adults, input.children);
	const maxMonthly = Math.max(0, r2((income * MAX_DEBT_RATIO) / 100 - input.existingPayments));
	const mortgages = loans.filter((l) => l.loan.kind === 'mortgage');
	const criteria: Criterion[] = [];

	const favoured = mortgages.some((l) => l.loan.mainResidence || l.loan.firstTime);
	criteria.push({
		id: 'debt',
		label: 'Taux d’endettement',
		status: debtAfter <= MAX_DEBT_RATIO ? 'pass' : debtAfter <= EXCEPTION_DEBT_RATIO ? 'warn' : 'fail',
		weight: 'blocking',
		reason:
			income <= 0
				? 'Revenus à renseigner.'
				: debtAfter <= MAX_DEBT_RATIO
					? `${pct1(debtAfter)} de tes revenus pour les crédits, sous la limite HCSF de ${MAX_DEBT_RATIO} % assurance comprise.`
					: debtAfter <= EXCEPTION_DEBT_RATIO
						? `${pct1(debtAfter)} : au-dessus de ${MAX_DEBT_RATIO} %, dérogation possible (20 % des dossiers${favoured ? ', surtout résidence principale et primo-accédants' : ', réservée surtout à la résidence principale'}).`
						: `${pct1(debtAfter)} : bien au-dessus de ${MAX_DEBT_RATIO} %, refus très probable.`
	});

	if (rentKept > 0 && effortWithRent > MAX_DEBT_RATIO && debtAfter <= EXCEPTION_DEBT_RATIO) {
		criteria.push({
			id: 'rent',
			label: 'Loyer gardé',
			status: 'warn',
			weight: 'minor',
			reason: `Crédits + loyer (${eur(rentKept)}) = ${pct1(effortWithRent)} des revenus : la règle HCSF ne compte que les crédits, mais certains prêteurs (surtout en crédit conso) ajoutent le loyer.`
		});
	}

	for (const l of loans) {
		const { kind, months, isNew } = l.loan;
		const max = kind === 'mortgage' ? (isNew ? MAX_MORTGAGE_MONTHS_NEW : MAX_MORTGAGE_MONTHS) : MAX_CONSUMER_MONTHS;
		const status: Status = months <= (kind === 'mortgage' ? MAX_MORTGAGE_MONTHS : MAX_CONSUMER_MONTHS) ? 'pass' : months <= max ? 'warn' : 'fail';
		criteria.push({
			id: 'duration',
			label: `Durée${loans.length > 1 ? ` · ${l.loan.label || 'crédit'}` : ''}`,
			status,
			weight: 'blocking',
			reason:
				status === 'pass'
					? `${months} mois, dans les durées acceptées${kind === 'mortgage' ? ' (25 ans au plus)' : ''}.`
					: status === 'warn'
						? `${months} mois : au-delà de 25 ans, seulement pour un logement neuf avec différé (27 ans).`
						: `${months} mois : au-delà de la durée maximale (${Math.round(max / 12)} ans).`
		});
	}

	criteria.push({
		id: 'remaining',
		label: 'Reste à vivre',
		status: remainingIncome >= remainingThreshold ? 'pass' : remainingIncome >= remainingThreshold * 0.85 ? 'warn' : 'fail',
		weight: 'major',
		reason: `${eur(remainingIncome)} par mois une fois les crédits${rentKept ? ' et le loyer' : ''} payés, pour ≈ ${eur(remainingThreshold)} attendus (usage des banques, sans valeur légale).`
	});

	const s = input.seniorityMonths;
	const job: Pick<Criterion, 'status' | 'weight' | 'reason'> =
		input.job === 'cdi'
			? s >= JOB_SENIORITY.cdi.ok
				? { status: 'pass', weight: 'major', reason: `CDI depuis ${s} mois, période d’essai passée : revenu compté à 100 %.` }
				: { status: 'warn', weight: 'major', reason: `CDI depuis ${s} mois : les banques attendent la fin de la période d’essai (vers ${monthIn(today, JOB_SENIORITY.cdi.ok - s)}).` }
			: input.job === 'portage'
				? s >= JOB_SENIORITY.portage.reassuring
					? { status: 'pass', weight: 'major', reason: `Portage salarial depuis ${s} mois : traité comme un CDI, ancienneté rassurante.` }
					: s >= JOB_SENIORITY.portage.ok
						? { status: 'pass', weight: 'major', reason: `Portage salarial depuis ${s} mois : 12 mois de fiches de paie, accepté par la plupart des banques (18 à 24 mois rassurent davantage).` }
						: s >= JOB_SENIORITY.portage.min
							? { status: 'warn', weight: 'major', reason: `Portage salarial depuis ${s} mois : quelques banques acceptent déjà, la plupart à partir de ${monthIn(today, JOB_SENIORITY.portage.ok - s)} (12 mois de fiches de paie).` }
							: { status: 'warn', weight: 'major', reason: `Portage salarial depuis ${s} mois : très récent ; quelques banques à partir de ${monthIn(today, JOB_SENIORITY.portage.min - s)}, la plupart en ${monthIn(today, JOB_SENIORITY.portage.ok - s)}. Un CDI juste avant, dans le même métier et sans interruption, aide à convaincre.` }
				: s >= JOB_SENIORITY.cdd.ok
					? { status: 'pass', weight: 'major', reason: `CDD ou indépendant avec ${s} mois d’historique : 3 ans de revenus réguliers rassurent.` }
					: s >= JOB_SENIORITY.cdd.min
						? { status: 'warn', weight: 'major', reason: `CDD ou indépendant avec ${s} mois d’historique : les banques demandent souvent 3 bilans.` }
						: { status: 'fail', weight: 'blocking', reason: `CDD ou indépendant avec ${s} mois d’historique : revenu jugé instable par la plupart des banques.` };
	criteria.push({ id: 'job', label: 'Stabilité de l’emploi', ...job });

	const downPayment = mortgages.reduce((sum, l) => sum + l.loan.downPayment, 0);
	const releasable = mortgages.some((l) => l.loan.mainResidence) ? Math.max(0, input.employeeSavings ?? 0) : 0;
	const available = input.savings + releasable;
	if (mortgages.some((l) => l.loan.price > 0)) {
		const fees = mortgages.reduce((sum, l) => sum + l.loan.notary + l.loan.fees.total, 0);
		const price = mortgages.reduce((sum, l) => sum + l.loan.price, 0);
		const expected = (price * EXPECTED_DOWN_PAYMENT) / 100;
		const tooMuch = downPayment > available;
		criteria.push({
			id: 'downPayment',
			label: 'Apport',
			status: !tooMuch && downPayment >= Math.max(fees, expected) ? 'pass' : 'warn',
			weight: 'minor',
			reason: tooMuch
				? `${eur(downPayment)} d’apport pour ${eur(available)} disponibles (comptes et livrets${releasable ? ', épargne salariale déblocable pour la résidence principale' : ''}) : apport à revoir.`
				: downPayment >= Math.max(fees, expected)
					? `${eur(downPayment)} : couvre les frais (${eur(fees)}) et ≈ ${EXPECTED_DOWN_PAYMENT} % du prix.`
					: downPayment >= fees
						? `${eur(downPayment)} : couvre les frais (${eur(fees)}) mais moins de ${EXPECTED_DOWN_PAYMENT} % du prix (${eur(expected)} souvent attendus).`
						: `${eur(downPayment)} pour ${eur(fees)} de frais (notaire, garantie, dossier) : financer les frais (prêt à 110 %) reste possible avec de bons revenus, mais plus rare.`
		});
	}

	const spent = downPayment + input.oneOff + loans.filter((l) => l.loan.kind !== 'mortgage').reduce((sum, l) => sum + l.loan.fees.total, 0);
	if (spent > 0 && input.monthlySpending > 0) {
		const left = Math.max(0, available - spent);
		const months = Math.round((left / input.monthlySpending) * 10) / 10;
		criteria.push({
			id: 'emergency',
			label: 'Épargne restante',
			status: months >= 3 ? 'pass' : 'warn',
			weight: 'minor',
			reason: `${eur(left)} restent de côté après ${eur(spent)} versés, soit ${months.toLocaleString('fr-FR')} mois de dépenses (3 à 6 mois conseillés ; les banques apprécient une épargne restante).`
		});
	}

	for (const l of loans) {
		criteria.push({
			id: 'usury',
			label: `Taux d’usure${loans.length > 1 ? ` · ${l.loan.label || 'crédit'}` : ''}`,
			status: l.usury.ok ? (l.usury.stale ? 'warn' : 'pass') : 'fail',
			weight: l.usury.ok ? 'minor' : 'blocking',
			reason: `TAEG ${pct2(l.taeg)} pour un plafond de ${pct2(l.usury.ceiling)} (${l.usury.category}, ${USURY.quarter})${l.usury.ok ? '' : ' : la banque ne peut pas prêter à ce taux'}${l.usury.stale ? ' · table à mettre à jour' : ''}.`
		});
	}

	for (const l of mortgages.filter((m) => m.loan.insurance.mode !== 'none')) {
		const free = noHealthQuestionnaire(l.loan.principal, input.age, l.loan.months);
		criteria.push({
			id: 'lemoine',
			label: 'Questionnaire de santé',
			status: free ? 'pass' : 'warn',
			weight: 'info',
			reason: free
				? 'Pas de questionnaire de santé (loi Lemoine : 200 000 € assurés au plus, fin avant 60 ans). Assurance changeable à tout moment.'
				: 'Questionnaire de santé demandé (plus de 200 000 € assurés ou fin après 60 ans) : simple formalité sans souci de santé. Assurance changeable à tout moment (loi Lemoine).'
		});
	}

	return { income, debtBefore, debtAfter, effortWithRent, newMonthly, rentKept, remainingIncome, remainingThreshold, maxMonthly, criteria, verdict: verdictOf(criteria) };
}

export interface CapacityRow {
	months: number;
	monthly: number;
	totalCost: number;
	debtRatio: number;
	maxAmount: number;
}

/** Same loan over other durations: monthly total, total cost, debt ratio, and the largest amount allowed. */
export function capacityTable(loan: ResolvedLoan, durations: readonly number[], today: string, ctx: { income: number; existingPayments: number; maxMonthly: number }): CapacityRow[] {
	return durations.map((months) => {
		const a = analyzeLoan({ ...loan, months }, today);
		const charges = ctx.existingPayments + a.totalMonthly;
		return {
			months,
			monthly: a.totalMonthly,
			totalCost: a.totalCost,
			debtRatio: ctx.income > 0 ? Math.round((charges / ctx.income) * 1000) / 10 : Infinity,
			maxAmount: maxLoanAmount(ctx.maxMonthly, loan.rate, months, loan.insurance.rate)
		};
	});
}

/** Durations compared in the capacity table. */
export const CAPACITY_DURATIONS: Readonly<Record<LoanKind, readonly number[]>> = {
	mortgage: [180, 240, 300],
	car: [24, 36, 48, 60, 72],
	personal: [24, 36, 48, 60, 72]
};
