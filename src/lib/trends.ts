import type { OhlcPoint } from './kraken';

/**
 * Crypto trends, pure functions: SMA20 vs SMA50 + 30-day momentum. Graceful: null when the history
 * is too short (no badge, no error).
 */

export type TrendBadge = 'haussier' | 'neutre' | 'baissier';

export interface TrendReading {
	sma20: number;
	sma50: number;
	/** Change in % over 30 days. */
	momentum30: number;
	badge: TrendBadge;
}

/** Simple moving average of the last `n` closes (null if not enough). */
export function sma(closes: number[], n: number): number | null {
	if (closes.length < n || n <= 0) return null;
	let sum = 0;
	for (let i = closes.length - n; i < closes.length; i++) sum += closes[i]!;
	return sum / n;
}

/**
 * Trend reading: SMA20 > SMA50 and momentum > 0 → bullish; SMA20 < SMA50 and momentum < 0 →
 * bearish; otherwise neutral. Needs ≥ 51 closes (SMA50 + the D-30 reference), null otherwise.
 */
export function trendFromCloses(closes: number[]): TrendReading | null {
	const sma20 = sma(closes, 20);
	const sma50 = sma(closes, 50);
	if (sma20 === null || sma50 === null || closes.length < 31) return null;
	const last = closes[closes.length - 1]!;
	const ref = closes[closes.length - 31]!;
	const momentum30 = ref > 0 ? ((last - ref) / ref) * 100 : 0;
	const badge: TrendBadge =
		sma20 > sma50 && momentum30 > 0 ? 'haussier' : sma20 < sma50 && momentum30 < 0 ? 'baissier' : 'neutre';
	return {
		sma20: Math.round(sma20 * 100) / 100,
		sma50: Math.round(sma50 * 100) / 100,
		momentum30: Math.round(momentum30 * 100) / 100,
		badge
	};
}

/** Trend from an OHLC series (chronological closes). */
export function trendFromOhlc(points: OhlcPoint[]): TrendReading | null {
	if (points.length === 0) return null;
	const closes = [...points].sort((a, b) => a.t - b.t).map((p) => p.close);
	return trendFromCloses(closes);
}
