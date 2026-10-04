/**
 * Inflation in France (INSEE consumer price index) compared with your spending
 * and income — pure, testable module.
 *
 * To update every year: the annual average published by INSEE in January
 * (https://www.insee.fr/fr/statistiques/4268033), and the latest year-on-year
 * rate (monthly « Prix à la consommation » release).
 */

/** Annual average inflation (%), CPI, whole of France. */
export const ANNUAL_INFLATION: Readonly<Record<number, number>> = {
	2010: 1.5,
	2011: 2.1,
	2012: 2.0,
	2013: 0.9,
	2014: 0.5,
	2015: 0.0,
	2016: 0.2,
	2017: 1.0,
	2018: 1.9,
	2019: 1.1,
	2020: 0.5,
	2021: 1.6,
	2022: 5.2,
	2023: 4.9,
	2024: 2.0,
	2025: 0.9
};

/** Latest known year-on-year rate (current year, no annual average yet). */
export const RECENT_INFLATION = { mois: '2026-09', taux: 3.0, provisoire: true } as const;

export const INFLATION_SOURCES = {
	annuelle: 'https://www.insee.fr/fr/statistiques/4268033',
	recente: 'https://www.insee.fr/fr/statistiques/9056956'
} as const;

/** Inflation of a year: annual average, otherwise the current year's latest year-on-year rate. */
export function inflationOf(year: number): { taux: number; definitive: boolean } | null {
	if (ANNUAL_INFLATION[year] !== undefined) return { taux: ANNUAL_INFLATION[year]!, definitive: true };
	if (year === Number(RECENT_INFLATION.mois.slice(0, 4))) return { taux: RECENT_INFLATION.taux, definitive: false };
	return null;
}

/** Cumulative price increase (%) between the averages of year `from` and year `to` (known years). */
export function cumulativeInflation(from: number, to: number): number {
	let f = 1;
	for (let y = from + 1; y <= to; y++) f *= 1 + (ANNUAL_INFLATION[y] ?? 0) / 100;
	return Math.round((f - 1) * 1000) / 10;
}

export interface MonthCategoryTotals {
	mois: string; // YYYY-MM
	depenses: number;
	revenus: number;
}

export interface InflationRow {
	annee: number;
	inflation: number | null;
	inflationDefinitive: boolean;
	/** Months (1-12) compared with the previous year (present in both years). */
	moisCompares: number[];
	depenses: number;
	revenus: number;
	/** Change over the same months as the previous year (%). */
	varDepenses: number | null;
	varRevenus: number | null;
	/** Increase of your income adjusted for inflation (%). */
	pouvoirAchat: number | null;
	/** Increase of your spending adjusted for inflation (%): > 0 = you spend more in volume. */
	depensesReelles: number | null;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Year by year: spending and income (full months, current month excluded),
 * change over the same months as the previous year, compared with inflation.
 */
export function compareYears(months: readonly MonthCategoryTotals[], currentMonth: string): InflationRow[] {
	const byYear = new Map<number, Map<number, MonthCategoryTotals>>();
	for (const m of months) {
		if (m.mois >= currentMonth) continue;
		const year = Number(m.mois.slice(0, 4));
		if (!byYear.has(year)) byYear.set(year, new Map());
		byYear.get(year)!.set(Number(m.mois.slice(5, 7)), m);
	}
	const sum = (ms: Map<number, MonthCategoryTotals>, num: number[], k: 'depenses' | 'revenus') => num.reduce((s, n) => s + (ms.get(n)?.[k] ?? 0), 0);
	return [...byYear.keys()]
		.sort((a, b) => b - a)
		.map((year) => {
			const thisYear = byYear.get(year)!;
			const prevYear = byYear.get(year - 1);
			const commonMonths = prevYear ? [...thisYear.keys()].filter((n) => prevYear.has(n)).sort((a, b) => a - b) : [];
			const infl = inflationOf(year);
			const variation = (k: 'depenses' | 'revenus') => {
				if (!prevYear || !commonMonths.length) return null;
				const b = sum(prevYear, commonMonths, k);
				return b > 0 ? r1((sum(thisYear, commonMonths, k) / b - 1) * 100) : null;
			};
			const expenseChange = variation('depenses');
			const incomeChange = variation('revenus');
			const toReal = (v: number | null) => (v === null || !infl ? null : r1(((1 + v / 100) / (1 + infl.taux / 100) - 1) * 100));
			return {
				annee: year,
				inflation: infl?.taux ?? null,
				inflationDefinitive: infl?.definitive ?? false,
				moisCompares: commonMonths,
				depenses: Math.round(sum(thisYear, [...thisYear.keys()], 'depenses')),
				revenus: Math.round(sum(thisYear, [...thisYear.keys()], 'revenus')),
				varDepenses: expenseChange,
				varRevenus: incomeChange,
				pouvoirAchat: toReal(incomeChange),
				depensesReelles: toReal(expenseChange)
			};
		});
}

// ---------- Inflation by main item (INSEE) ----------

/** Main items of the price index (official INSEE breakdown). */
export type Sector = 'alimentation' | 'energie' | 'manufactures' | 'services' | 'tabac';

export const SECTORS: Readonly<Record<Sector, string>> = {
	alimentation: 'Alimentation',
	energie: 'Énergie',
	manufactures: 'Produits manufacturés',
	services: 'Services',
	tabac: 'Tabac'
};

/**
 * Inflation by main item (%): annual average (INSEE annual reviews); for the
 * current year, the year-on-year rate of the latest published month
 * (RECENT_INFLATION). Energy = petroleum products, electricity, gas.
 */
export const SECTOR_INFLATION: Readonly<Record<number, Readonly<Record<Sector, number>>>> = {
	2023: { alimentation: 11.8, energie: 5.6, manufactures: 3.5, services: 3.0, tabac: 8.0 },
	2024: { alimentation: 1.4, energie: 2.3, manufactures: 0.0, services: 2.7, tabac: 10.3 },
	2025: { alimentation: 1.2, energie: -5.6, manufactures: -0.3, services: 2.3, tabac: 4.3 },
	2026: { alimentation: 1.5, energie: 21.2, manufactures: -0.3, services: 2.2, tabac: 3.3 }
};

export const SECTOR_SOURCES = {
	2023: 'https://www.insee.fr/fr/statistiques/7750173',
	2024: 'https://www.insee.fr/fr/statistiques/8330913',
	2025: 'https://www.insee.fr/fr/statistiques/8726461'
} as const;

/** Inflation of an item for a given year (null when the year is not covered). */
export function sectorInflation(year: number, sector: Sector | 'ensemble'): number | null {
	if (sector === 'ensemble') return inflationOf(year)?.taux ?? null;
	return SECTOR_INFLATION[year]?.[sector] ?? null;
}

// ---------- Livret A (same rate: LDDS, Livret bleu) ----------

/** Livret A rate (%), from the given date (February 1st / August 1st). */
export const LIVRET_A_RATES: readonly { depuis: string; taux: number }[] = [
	{ depuis: '2015-08-01', taux: 0.75 },
	{ depuis: '2020-02-01', taux: 0.5 },
	{ depuis: '2022-02-01', taux: 1.0 },
	{ depuis: '2022-08-01', taux: 2.0 },
	{ depuis: '2023-02-01', taux: 3.0 },
	{ depuis: '2025-02-01', taux: 2.4 },
	{ depuis: '2025-08-01', taux: 1.7 },
	{ depuis: '2026-02-01', taux: 1.5 },
	{ depuis: '2026-08-01', taux: 1.7 }
];

export const LIVRET_A_SOURCE = 'https://www.legifiscal.fr/actualites-fiscales/4571-livret-taux-remuneration-compter-1er-aout-2026.html';

/** Livret A rate in force on a date (YYYY-MM-DD). */
export function livretARate(date: string): { taux: number; depuis: string } {
	let p = LIVRET_A_RATES[0]!;
	for (const x of LIVRET_A_RATES) if (x.depuis <= date) p = x;
	return p;
}

/** Average Livret A rate over a year (month by month), up to month `until` (YYYY-MM) included when given. */
export function averageLivretARate(year: number, until?: string): number {
	const rates: number[] = [];
	for (let m = 1; m <= 12; m++) {
		const month = `${year}-${String(m).padStart(2, '0')}`;
		if (until && month > until) break;
		rates.push(livretARate(`${month}-01`).taux);
	}
	return rates.length ? rates.reduce((s, t) => s + t, 0) / rates.length : 0;
}

// ---------- Price increase between two dates ----------

/** Inflation used for a past or current year (annual average, otherwise the latest year-on-year rate). */
function annualRate(year: number): number {
	return ANNUAL_INFLATION[year] ?? (year >= Number(RECENT_INFLATION.mois.slice(0, 4)) ? RECENT_INFLATION.taux : 0);
}

/**
 * Price increase factor between two dates (1.10 = +10 %): each year's rate
 * applied pro rata of the days. Used to express a past amount in today's euros.
 */
export function priceFactor(from: string, to: string): number {
	if (to <= from) return 1;
	const t0 = Date.parse(`${from}T00:00:00Z`);
	const t1 = Date.parse(`${to}T00:00:00Z`);
	let f = 1;
	for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) {
		const yearStart = Date.UTC(y, 0, 1);
		const yearEnd = Date.UTC(y + 1, 0, 1);
		const start = Math.max(t0, yearStart);
		const end = Math.min(t1, yearEnd);
		if (end > start) f *= Math.pow(1 + annualRate(y) / 100, (end - start) / (yearEnd - yearStart));
	}
	return f;
}

/** Inflation assumed for long-term projections (%/year): the ECB target. */
export const LONG_TERM_INFLATION = 2;
