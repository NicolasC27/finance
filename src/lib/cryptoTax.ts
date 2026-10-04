import type { KrakenLedgerEntry } from './csvKraken';
import { isFiat, toEur } from './fiat';

/**
 * Taxation of digital assets (French CGI art. 150 VH bis, form 2086) — pure
 * module, testable with tsx.
 *
 * Applied rules:
 * - Taxable disposal = crypto → euro sale (trade / spend-receive with a
 *   positive EUR leg) and crypto → euro conversion for the card
 *   (kardconversion). Crypto ↔ crypto swaps are not taxable.
 * - Gain of a disposal = PC − PTA × PC / VG
 *   PC  = disposal price (euros received before fees; fees are deducted apart)
 *   VG  = global portfolio value (all cryptos) ON the disposal day
 *   PTA = remaining total acquisition price of the portfolio (euro purchases +
 *         valued crypto received), minus the « initial capital fractions »
 *         already consumed by previous disposals (PTA × PC / VG).
 * - Per calendar year: if Σ PC ≤ 305 €, exempt; otherwise the net gain (gains
 *   − losses of the year) is taxed at the PFU (12.8 % income tax + social
 *   levies: 30 % in total up to 2025 income, see pfuRate). A net loss is not
 *   carried forward.
 *
 * Honest limits: VG depends on prices at the date (daily close, otherwise
 * weekly); assets without a price are left out of VG (reported).
 */

export interface TaxCession {
	date: string;
	asset: string;
	qty: number;
	/** Gross disposal price (euros received before fees). */
	proceeds: number;
	fees: number;
	/** Global portfolio value on the disposal day. */
	portfolioValue: number;
	/** Remaining PTA before this disposal. */
	acquisitionCost: number;
	/** Initial capital fraction consumed: PTA × PC / VG. */
	fractionUsed: number;
	gain: number;
	/** Portfolio assets without a price at that date (VG underestimated). */
	unpricedAssets: string[];
	/** Disposal currency when not the euro (amounts converted at the yearly average rate). */
	currency?: string;
}

export interface TaxYear {
	year: number;
	cessions: TaxCession[];
	totalProceeds: number;
	netGain: number;
	exempt: boolean;
	/** Year's PFU (pfuRate) on the net gain (0 when exempt or at a loss). */
	taxEstimate: number;
	/** Applied PFU rate (0.30 = 30 %). */
	rate: number;
}

export interface TaxReport {
	years: TaxYear[];
	/** Disposals whose VG could not be computed for lack of prices: check by hand. */
	warnings: string[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;
/** Kraken technical credits (free fees): neither an asset nor a value. */
const NOT_AN_ASSET = new Set(['KFEE']);
/** Historical PFU: 12.8 % income tax + 17.2 % social levies. */
export const PFU_RATE = 0.3;
export const EXEMPTION_THRESHOLD = 305;

/**
 * PFU rate per disposal year (12.8 % income tax + social levies). A table per
 * year so a change in the law only affects the years concerned.
 * 2026 rate TO BE CHECKED: the 2026 social security budget law would raise the
 * CSG on capital income (social levies 18.6 %, PFU 31.4 %) — not applied until
 * confirmed for digital asset gains.
 */
const PFU_BY_YEAR: Record<number, number> = {};

export function pfuRate(year: number): number {
	return PFU_BY_YEAR[year] ?? PFU_RATE;
}

/** Price of an asset at an ISO date; undefined when unknown. */
export type PriceAt = (asset: string, date: string) => number | undefined;

function isExchange(e: KrakenLedgerEntry): boolean {
	return e.type === 'trade' || e.type === 'spend' || e.type === 'receive' || e.subtype === 'kardconversion';
}

/**
 * Builds the yearly tax report from the Kraken ledger.
 * - Running balances per asset (balance column = balance AFTER the row) feed
 *   VG; `acquisitionCost` is the remaining total acquisition price (PTA).
 * - Exchange groups (by refid) are processed chronologically; other rows feed
 *   the balances and the PTA (crypto deposits from outside enter the PTA at
 *   their value of the day).
 * - An internal spot ↔ earn move (« autoallocation » +X then −X, same second)
 *   doesn't change the held quantity: its 2nd row (balance 0) used to make the
 *   asset vanish from VG until the next row, so it is skipped.
 * - VG is taken BEFORE the disposal; fiat legs are converted to euros (USD,
 *   GBP… at the yearly average rate). A euro purchase raises the PTA by the
 *   amount spent, fees included.
 * - Disposal: gain pro rata of the portfolio. The quantity of the sold asset
 *   BEFORE the sale comes from the row itself (balance after − amount + fee):
 *   several orders in the same second make the row order uncertain, so the
 *   running balance would not be reliable. The sold asset is valued at ITS
 *   exact sale price, the others at the day's prices.
 * - Balances then move forward with every leg.
 */
export function computeTaxReport(entries: KrakenLedgerEntry[], priceAt: PriceAt): TaxReport {
	const sorted = [...entries].sort((a, b) => a.at.localeCompare(b.at));
	const warnings: string[] = [];

	const balances = new Map<string, number>();
	const portfolioValue = (date: string, override?: Map<string, number>): { value: number; unpriced: string[] } => {
		let value = 0;
		const unpriced: string[] = [];
		for (const [asset, qty] of balances) {
			if (isFiat(asset) || qty <= 1e-9 || NOT_AN_ASSET.has(asset)) continue;
			const p = override?.get(asset) ?? priceAt(asset, date);
			if (p === undefined) unpriced.push(asset);
			else value += qty * p;
		}
		return { value: r2(value), unpriced };
	};

	let acquisitionCost = 0;
	const cessions: TaxCession[] = [];

	const groups = new Map<string, KrakenLedgerEntry[]>();
	const timeline: { at: string; kind: 'line' | 'group'; line?: KrakenLedgerEntry; group?: KrakenLedgerEntry[] }[] = [];
	for (const e of sorted) {
		if (isExchange(e)) {
			let g = groups.get(e.refid);
			if (!g) {
				g = [];
				groups.set(e.refid, g);
				timeline.push({ at: e.at, kind: 'group', group: g });
			}
			g.push(e);
		} else timeline.push({ at: e.at, kind: 'line', line: e });
	}

	for (const step of timeline) {
		if (step.kind === 'line') {
			const e = step.line!;
			if (e.type === 'transfer' && e.subtype === 'autoallocation') continue;
			balances.set(e.asset, e.balance);
			if (!isFiat(e.asset) && !NOT_AN_ASSET.has(e.asset) && e.type === 'deposit' && e.amount > 0) {
				const p = priceAt(e.asset, e.date);
				if (p !== undefined) acquisitionCost = r2(acquisitionCost + e.amount * p);
				else warnings.push(`${e.date} : dépôt de ${e.amount} ${e.asset} sans cours connu (non ajouté au prix d'acquisition)`);
			}
			continue;
		}
		const g = step.group!;
		const eurLegs = g.filter((e) => isFiat(e.asset));
		const cryptoLegs = g.filter((e) => !isFiat(e.asset));
		const date = g[0]!.date;
		if (eurLegs.length > 0 && cryptoLegs.length > 0) {
			const currency = eurLegs[0]!.asset;
			const eurGross = eurLegs.reduce((s, e) => s + (toEur(e.amount, e.asset, e.date) ?? 0), 0);
			const fees = eurLegs.reduce((s, e) => s + Math.abs(toEur(e.fee, e.asset, e.date) ?? 0), 0);
			if (eurGross < 0) {
				acquisitionCost = r2(acquisitionCost + Math.abs(eurGross) + fees);
			} else {
				const saved = new Map(balances);
				for (const leg of cryptoLegs) balances.set(leg.asset, leg.balance - leg.amount + Math.abs(leg.fee));
				const soldPrices = new Map<string, number>();
				for (const leg of cryptoLegs) {
					const q = Math.abs(leg.amount);
					if (q > 0) soldPrices.set(leg.asset, eurGross / q);
				}
				const { value: totalValue, unpriced } = portfolioValue(date, soldPrices);
				balances.clear();
				for (const [k, v] of saved) balances.set(k, v);
				const proceeds = r2(eurGross);
				const leg = cryptoLegs[0]!;
				if (totalValue <= 0) {
					warnings.push(`${date} : cession de ${Math.abs(leg.amount)} ${leg.asset} — valeur du portefeuille inconnue (cours manquants), plus-value non calculée`);
				} else {
					const fraction = r2((acquisitionCost * proceeds) / totalValue);
					const gain = r2(proceeds - fees - fraction);
					cessions.push({ date, asset: leg.asset, qty: Math.abs(leg.amount), proceeds, fees: r2(fees), portfolioValue: totalValue, acquisitionCost: r2(acquisitionCost), fractionUsed: fraction, gain, unpricedAssets: unpriced, ...(currency !== 'EUR' ? { currency } : {}) });
					acquisitionCost = r2(Math.max(0, acquisitionCost - fraction));
				}
			}
		}
		for (const e of g) balances.set(e.asset, e.balance);
	}

	const byYear = new Map<number, TaxCession[]>();
	for (const c of cessions) {
		const y = Number(c.date.slice(0, 4));
		byYear.set(y, [...(byYear.get(y) ?? []), c]);
	}
	const years: TaxYear[] = [...byYear.entries()]
		.sort((a, b) => b[0] - a[0])
		.map(([year, list]) => {
			const totalProceeds = r2(list.reduce((s, c) => s + c.proceeds, 0));
			const netGain = r2(list.reduce((s, c) => s + c.gain, 0));
			const exempt = totalProceeds <= EXEMPTION_THRESHOLD;
			const rate = pfuRate(year);
			return { year, cessions: list, totalProceeds, netGain, exempt, rate, taxEstimate: exempt || netGain <= 0 ? 0 : r2(netGain * rate) };
		});
	return { years, warnings };
}
