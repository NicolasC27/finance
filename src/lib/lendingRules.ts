/**
 * French lending rules and market references for the loan study (October 2026) — constants only.
 *
 * Sources:
 * - HCSF decision D-HCSF-2021-7 (debt ratio 35 % insurance included, 25 years, 20 % flexibility):
 *   https://www.economie.gouv.fr/hcsf
 * - Usury rates, Banque de France, quarterly notice (« taux d'usure »):
 *   https://www.banque-france.fr/fr/statistiques/taux-et-cours/taux-dusure
 * - Market mortgage rates: Observatoire Crédit Logement / CSA (monthly release).
 * - Borrower insurance: loi Lemoine (2022-270), broker price surveys; purchase costs: notaires de
 *   France simulators; bank practices (income weighting, remaining income) have no legal value.
 *
 * To update: the usury table EVERY QUARTER (1 January, 1 April, 1 July, 1 October), market rates
 * every few months, the rest when the rules change. The study warns when the usury table is older
 * than USURY_MAX_AGE_MONTHS.
 */

/** HCSF: maximum debt ratio (%), insurance included, over net income before tax. */
export const MAX_DEBT_RATIO = 35;
/** Above this ratio an exception is very unlikely (banks use the 20 % margin up to about 40 %). */
export const EXCEPTION_DEBT_RATIO = 40;
/** HCSF: maximum mortgage duration (months), and with a deferral for a new build. */
export const MAX_MORTGAGE_MONTHS = 300;
export const MAX_MORTGAGE_MONTHS_NEW = 324;
/** Usual maximum for a consumer loan (months). */
export const MAX_CONSUMER_MONTHS = 84;

/** Share of each income counted by banks. */
export const INCOME_WEIGHTS = { salary: 1, variable: 0.7, rental: 0.7, alimony: 1 } as const;

/** Remaining income per month (« reste à vivre », €), bank practice: per adult, couple, per child. */
export const REMAINING_INCOME = { adult: 800, couple: 1300, child: 350 } as const;

/** Seniority (months) that reassures banks, by job type. */
export const JOB_SENIORITY = {
	cdi: { ok: 3 },
	portage: { min: 4, ok: 12, reassuring: 18 },
	cdd: { min: 24, ok: 36 }
} as const;

/** Purchase costs (% of the price or of the loan). */
export const NOTARY_RATE = { old: 7.5, new: 2.5 } as const;
export const GUARANTEE_RATE = 1.2;
export const APPLICATION_FEE = { rate: 1, cap: 1500 } as const;
/** Down payment banks like to see (% of the price), covering at least the fees. */
export const EXPECTED_DOWN_PAYMENT = 10;

/** Loi Lemoine: no health questionnaire up to this insured amount per person, loan ending before 60. */
export const LEMOINE = { maxInsured: 200_000, endAge: 60 } as const;

export interface UsuryTable {
	quarter: string;
	/** First day of validity (YYYY-MM-DD). */
	since: string;
	consumer: { upTo3000: number; upTo6000: number; above6000: number };
	mortgage: { under10y: number; from10to20y: number; from20y: number; variable: number; bridge: number };
}

/** Usury rates (TAEG ceilings, %), Banque de France, from 1 October 2026. */
export const USURY: UsuryTable = {
	quarter: 'T4 2026',
	since: '2026-10-01',
	consumer: { upTo3000: 23.6, upTo6000: 15.76, above6000: 8.56 },
	mortgage: { under10y: 4.09, from10to20y: 4.68, from20y: 5.4, variable: 5.52, bridge: 6.49 }
};
export const USURY_MAX_AGE_MONTHS = 4;

/** Indicative market rates (nominal, %), October 2026. */
export const MARKET_RATES = {
	asOf: '2026-10',
	mortgage: [
		{ months: 180, rate: 3.23 },
		{ months: 240, rate: 3.42 },
		{ months: 300, rate: 3.53 }
	],
	mortgageRange: { low: 3.2, high: 3.6 },
	car: { low: 3.5, high: 4.4 },
	personal: { low: 5, high: 9 }
} as const;

/**
 * Borrower insurance (annual % of the capital) by age: delegation on the remaining capital, bank
 * group contract on the initial capital, optional insurance of a consumer loan.
 */
export const INSURANCE_RATES = {
	delegation: [
		{ age: 30, rate: 0.1 },
		{ age: 40, rate: 0.2 },
		{ age: 50, rate: 0.4 },
		{ age: 60, rate: 0.7 }
	],
	group: [
		{ age: 35, rate: 0.32 },
		{ age: 45, rate: 0.55 },
		{ age: 55, rate: 0.9 },
		{ age: 65, rate: 1.4 }
	],
	consumer: [
		{ age: 30, rate: 0.25 },
		{ age: 45, rate: 0.5 },
		{ age: 60, rate: 0.9 }
	]
} as const;
