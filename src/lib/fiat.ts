/**
 * Fiat currencies seen on Kraken (besides EUR) and approximate conversion to
 * euros. Early Kraken accounts often traded in USD: a crypto → USD sale is a
 * taxable disposal (the dollar is a currency, not a digital asset) and a USD
 * deposit is a contribution. Without a local exchange-rate history, a yearly
 * average rate is applied (source: ECB, rounded) — flagged as an
 * approximation in the UI.
 */

export const FIAT = new Set(['EUR', 'USD', 'GBP', 'CHF', 'CAD', 'JPY', 'AUD']);

export function isFiat(asset: string): boolean {
	return FIAT.has(asset);
}

/** Euros per currency unit, per year (rounded yearly averages). */
const EUR_PER_UNIT: Record<string, Record<number, number>> = {
	USD: { 2013: 0.75, 2014: 0.75, 2015: 0.9, 2016: 0.9, 2017: 0.89, 2018: 0.85, 2019: 0.89, 2020: 0.88, 2021: 0.85, 2022: 0.95, 2023: 0.92, 2024: 0.92, 2025: 0.9, 2026: 0.9 },
	GBP: { 2017: 1.14, 2018: 1.13, 2019: 1.14, 2020: 1.12, 2021: 1.16, 2022: 1.17, 2023: 1.15, 2024: 1.17, 2025: 1.18, 2026: 1.18 },
	CHF: { 2017: 0.9, 2018: 0.87, 2019: 0.9, 2020: 0.93, 2021: 0.93, 2022: 1.0, 2023: 1.03, 2024: 1.05, 2025: 1.06, 2026: 1.06 },
	CAD: { 2020: 0.65, 2021: 0.67, 2022: 0.73, 2023: 0.69, 2024: 0.67, 2025: 0.65, 2026: 0.65 },
	JPY: { 2020: 0.0082, 2021: 0.0077, 2022: 0.0072, 2023: 0.0066, 2024: 0.0061, 2025: 0.006, 2026: 0.006 },
	AUD: { 2020: 0.6, 2021: 0.63, 2022: 0.66, 2023: 0.61, 2024: 0.61, 2025: 0.59, 2026: 0.59 }
};

/** Converts a fiat amount to euros (EUR unchanged); null for an unknown currency. */
export function toEur(amount: number, asset: string, date: string): number | null {
	if (asset === 'EUR') return amount;
	const table = EUR_PER_UNIT[asset];
	if (!table) return null;
	const year = Number(date.slice(0, 4));
	const years = Object.keys(table).map(Number).sort((a, b) => a - b);
	const y = table[year] !== undefined ? year : year < years[0]! ? years[0]! : years[years.length - 1]!;
	return amount * table[y]!;
}
