/**
 * Price increases of recurring charges (subscriptions, insurance, direct
 * debits) compared with inflation — pure module.
 *
 * The current price (last occurrence) is compared with the price a year ago:
 * median of the occurrences 10 to 14 months before, otherwise the oldest
 * known ones if they are at least 6 months old. The increase is brought back
 * to one year to be comparable with inflation. Amounts that vary with usage
 * (tolls) or a new price seen only once: no comparison.
 */

export interface Occurrence {
	date: string;
	montant: number;
}

export interface PriceRise {
	/** Price about a year ago (median of the window) and reference date. */
	avant: number;
	dateAvant: string;
	/** Current price (last occurrence). */
	apres: number;
	dateApres: string;
	/** Total increase (%). */
	hausse: number;
	/** Increase brought back to one year (%). */
	parAn: number;
	/** Extra cost per year at the charge's pace (€). */
	coutAn: number;
}

const DAY_MS = 86_400_000;
const daysBetween = (from: string, to: string) => (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS;
const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

function median(v: number[]): number {
	const s = [...v].sort((a, b) => a - b);
	const m = Math.floor(s.length / 2);
	return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/**
 * Price increase (or decrease) of a charge over about a year; null without
 * enough history.
 * - At most 3 occurrences, the closest to one year before.
 * - An amount that varies with usage (tolls, consumption) is not a price:
 *   nothing to compare.
 * - The new price must be confirmed by the previous occurrence (an isolated
 *   bill is not an increase).
 * - A fixed price that changed tier: almost every recent occurrence is worth
 *   the old or the new price.
 */
export function priceRise(occurrences: readonly Occurrence[], perYear: number): PriceRise | null {
	const occ = occurrences.filter((o) => o.montant > 0).sort((a, b) => a.date.localeCompare(b.date));
	if (occ.length < 3) return null;
	const last = occ[occ.length - 1]!;
	let yearAgo = occ.filter((o) => {
		const days = daysBetween(o.date, last.date);
		return days >= 300 && days <= 430;
	});
	if (!yearAgo.length) yearAgo = occ.filter((o) => daysBetween(o.date, last.date) >= 180).slice(0, 3);
	if (!yearAgo.length) return null;
	yearAgo = [...yearAgo].sort((a, b) => Math.abs(daysBetween(a.date, last.date) - 365) - Math.abs(daysBetween(b.date, last.date) - 365)).slice(0, 3);
	const amounts = yearAgo.map((o) => o.montant);
	if (Math.max(...amounts) > Math.min(...amounts) * 1.15) return null;
	const previous = occ[occ.length - 2]!;
	if (Math.abs(last.montant / previous.montant - 1) > 0.15) return null;
	const before = median(amounts);
	const isNear = (m: number, ref: number) => Math.abs(m - ref) <= ref * 0.15;
	const recent = occ.filter((o) => daysBetween(o.date, last.date) <= 456);
	if (recent.filter((o) => isNear(o.montant, before) || isNear(o.montant, last.montant)).length < recent.length * 0.75) return null;
	const dateBefore = [...yearAgo].sort((a, b) => a.date.localeCompare(b.date))[Math.floor((yearAgo.length - 1) / 2)]!.date;
	const spanDays = daysBetween(dateBefore, last.date);
	if (before <= 0 || spanDays < 180) return null;
	const ratio = last.montant / before;
	return {
		avant: r2(before),
		dateAvant: dateBefore,
		apres: last.montant,
		dateApres: last.date,
		hausse: r1((ratio - 1) * 100),
		parAn: r1((Math.pow(ratio, 365 / spanDays) - 1) * 100),
		coutAn: r2((last.montant - before) * perYear)
	};
}

/**
 * Increase faster than inflation: at least 2 points above per year, 3 % in
 * total, and 5 € per year (cents don't deserve an alert).
 */
export function abnormalRise(h: PriceRise, inflation: number): boolean {
	return h.parAn >= inflation + 2 && h.hausse >= 3 && h.coutAn >= 5;
}

/** Occurrences per year of a detected cadence. */
export function periodsPerYear(cadence: string): number {
	return cadence === 'hebdomadaire' ? 52 : cadence === 'trimestrielle' ? 4 : 12;
}
