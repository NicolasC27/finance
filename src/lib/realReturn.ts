import { priceFactor, livretARate } from './inflation';

/**
 * Real return of savings and net-worth projection: pure module.
 *
 * Real return = what money earns once inflation is removed: (1 + rate) / (1 + inflation) − 1.
 * At 1.7 % on a savings account with 3 % inflation, 10 000 € lose ≈ 126 € of purchasing power a
 * year. Projections are in today's euros: future savings keep the same value and the counted
 * return is the real return.
 */

export type InvestmentType = 'courant' | 'livret' | 'salariale';

export interface Investment {
	id: string;
	label: string;
	type: InvestmentType;
	montant: number;
	/** Yearly nominal return (%). */
	taux: number;
	/** Where the rate comes from ('taux du Livret A depuis le 1er août 2026'). */
	source: string;
}

export interface InvestmentRow extends Investment {
	/** Real return (%/year). */
	reel: number;
	/** Purchasing power gained (> 0) or lost (< 0) per year (€). */
	gainReelAn: number;
}

export interface ReturnSummary {
	lignes: InvestmentRow[];
	total: number;
	/** Average nominal rate weighted by amounts (%). */
	tauxMoyen: number;
	reelMoyen: number;
	gainReelAn: number;
	inflation: number;
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Real return (%) of a nominal rate against an inflation rate. */
export function realReturn(rate: number, inflation: number): number {
	return ((1 + rate / 100) / (1 + inflation / 100) - 1) * 100;
}

/** Real return of each placement and of the total, at the given inflation rate. */
export function returnSummary(investments: readonly Investment[], inflation: number): ReturnSummary {
	const rows = investments
		.filter((p) => p.montant > 0)
		.map((p) => {
			const real = realReturn(p.taux, inflation);
			return { ...p, reel: r1(real), gainReelAn: Math.round((p.montant * real) / 100) };
		})
		.sort((a, b) => b.montant - a.montant);
	const total = r2(rows.reduce((s, l) => s + l.montant, 0));
	const avgRate = total > 0 ? rows.reduce((s, l) => s + l.montant * l.taux, 0) / total : 0;
	return {
		lignes: rows,
		total,
		tauxMoyen: r2(avgRate),
		reelMoyen: r1(realReturn(avgRate, inflation)),
		gainReelAn: rows.reduce((s, l) => s + l.gainReelAn, 0),
		inflation
	};
}

const MONTH_NAMES = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/**
 * Rate of a savings account from its label: Livret A, LDDS and Livret bleu share the same
 * regulated rate. Other accounts (LEP, in-house account): null, the rate has to be typed.
 */
export function regulatedRate(label: string, date: string): { taux: number; source: string } | null {
	const l = label.toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
	if (/\bLEP\b|EPARGNE POPULAIRE|LIVRET JEUNE/.test(l)) return null;
	if (!/\bLIVRET A\b|\bLDDS?\b|DEVELOPPEMENT DURABLE|LIVRET BLEU/.test(l)) return null;
	const t = livretARate(date);
	const [year, month] = t.depuis.split('-');
	return { taux: t.taux, source: `taux réglementé depuis le 1er ${MONTH_NAMES[Number(month) - 1]} ${year}` };
}

// ---------- Crypto: inflation-adjusted gain ----------

export interface DatedFlow {
	date: string;
	/** > 0: deposit; < 0: withdrawal. */
	montant: number;
}

export interface CryptoRealReturn {
	/** Gain in current euros: value + withdrawals − deposits. */
	gain: number;
	gainPct: number;
	/** Price increase since the (weighted) average date of the deposits (%). */
	inflation: number;
	/** Gain in today's euros: deposits and withdrawals revalued for inflation. */
	gainReel: number;
	gainReelPct: number;
}

/**
 * Inflation-adjusted crypto gain. `invested` and `withdrawn` come from the Kraken performance (fiat
 * deposits + received cryptos valued); dated flows (deposits, withdrawals) give the average date
 * to revalue.
 */
export function cryptoRealReturn(invested: number, withdrawn: number, value: number, flows: readonly DatedFlow[], today: string): CryptoRealReturn | null {
	if (invested <= 0) return null;
	const avgFactor = (sign: 1 | -1) => {
		const l = flows.filter((f) => f.montant * sign > 0);
		const sum = l.reduce((s, f) => s + Math.abs(f.montant), 0);
		return sum > 0 ? l.reduce((s, f) => s + Math.abs(f.montant) * priceFactor(f.date, today), 0) / sum : 1;
	};
	const fDeposits = avgFactor(1);
	const fWithdrawals = avgFactor(-1);
	const gain = value + withdrawn - invested;
	const realGain = value + withdrawn * fWithdrawals - invested * fDeposits;
	return {
		gain: Math.round(gain),
		gainPct: r1((gain / invested) * 100),
		inflation: r1((fDeposits - 1) * 100),
		gainReel: Math.round(realGain),
		gainReelPct: r1((realGain / (invested * fDeposits)) * 100)
	};
}

// ---------- Net-worth projection (constant euros) ----------

export interface ProjectionAssumptions {
	/** Starting net worth (€). */
	depart: number;
	/** Savings paid in every month (today's €). */
	epargneMois: number;
	/** Assumed real return (%/year). */
	reel: number;
}

/** Projected net worth month by month over `months` months (index 0 = today), in today's euros. */
export function projectNetWorth(h: ProjectionAssumptions, months: number): number[] {
	const r = Math.pow(1 + h.reel / 100, 1 / 12) - 1;
	const out = [Math.round(h.depart)];
	let v = h.depart;
	for (let m = 1; m <= months; m++) {
		v = v * (1 + r) + h.epargneMois;
		out.push(Math.round(v));
	}
	return out;
}

/** Months before reaching `target` (0 if already reached, null beyond 50 years). */
export function monthsToReach(h: ProjectionAssumptions, target: number, max = 600): number | null {
	if (h.depart >= target) return 0;
	const r = Math.pow(1 + h.reel / 100, 1 / 12) - 1;
	let v = h.depart;
	for (let m = 1; m <= max; m++) {
		v = v * (1 + r) + h.epargneMois;
		if (v >= target) return m;
	}
	return null;
}

/** Reference monthly savings: average of the balances (income − spending) of the full months given. */
export function averageSavings(balances: readonly number[]): number {
	return balances.length ? Math.round(balances.reduce((s, x) => s + x, 0) / balances.length) : 0;
}
