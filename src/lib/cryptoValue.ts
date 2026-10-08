/**
 * Crypto valuation day by day (pure, testable): every lookup walks its series once alongside the
 * sorted list of days (two pointers), instead of scanning the whole series again for each day.
 * Used by the net-worth history and the crypto curve, which used to cost close to a second on
 * every page switch (one scan of several hundred candles per bank day and per asset).
 */

export interface Candle {
	/** Unix time (ms) of the candle. */
	t: number;
	close: number;
}

export interface DailyBalance {
	/** ISO date (AAAA-MM-JJ). */
	date: string;
	balance: number;
}

export interface Snapshot {
	date: string;
	eur: number;
}

/** End of a local day as a timestamp, like `new Date(`${iso}T23:59:59`).getTime()`. */
const endOfDay = (iso: string): number => new Date(`${iso}T23:59:59`).getTime();

/** Close of the last candle at or before the end of each day (null before the first candle); `isos` sorted ascending. */
export function closesAt(series: readonly Candle[], isos: readonly string[]): (number | null)[] {
	const out: (number | null)[] = new Array(isos.length);
	let i = 0;
	let close: number | null = null;
	for (let k = 0; k < isos.length; k++) {
		const t = endOfDay(isos[k]!);
		while (i < series.length && series[i]!.t <= t) close = series[i++]!.close;
		out[k] = close;
	}
	return out;
}

/** Balance at each day: the last point at or before it, 0 before the first; `isos` sorted ascending. */
export function balancesAt(series: readonly DailyBalance[], isos: readonly string[]): number[] {
	const out: number[] = new Array(isos.length);
	let i = 0;
	let bal = 0;
	for (let k = 0; k < isos.length; k++) {
		const iso = isos[k]!;
		while (i < series.length && series[i]!.date <= iso) bal = series[i++]!.balance;
		out[k] = bal;
	}
	return out;
}

/** Snapshot of the day or the latest before it, null when none yet; `isos` sorted ascending. */
export function snapshotsAt(snapshots: readonly Snapshot[], isos: readonly string[]): (number | null)[] {
	const out: (number | null)[] = new Array(isos.length);
	let i = 0;
	let eur: number | null = null;
	for (let k = 0; k < isos.length; k++) {
		const iso = isos[k]!;
		while (i < snapshots.length && snapshots[i]!.date <= iso) eur = snapshots[i++]!.eur;
		out[k] = eur;
	}
	return out;
}

export interface CryptoValueSources {
	/** Daily snapshots of the portfolio value (EUR), sorted by date. */
	snapshots: readonly Snapshot[];
	/** Ledger balances per asset, each sorted by date (empty without a ledger). */
	ledger: ReadonlyMap<string, readonly DailyBalance[]>;
	/** Daily candles per asset, sorted by time. */
	ohlc: Readonly<Record<string, readonly Candle[] | undefined>>;
	/** Current quantities (fallback without a ledger). */
	holdings: readonly { symbol: string; qty: number }[];
	isFiat: (asset: string) => boolean;
	/** Fiat amount in EUR at a date (null when the currency is unknown). */
	toEur: (amount: number, asset: string, date: string) => number | null;
}

/**
 * Estimated value of the crypto portfolio on each day (same rules as before, computed in one pass):
 * the snapshot of the day or the latest before it; else, with a ledger, the balance held that day
 * × the close of the day (fiat converted); else the current quantities × the close of the day.
 */
export function cryptoEurByDay(isos: readonly string[], s: CryptoValueSources): number[] {
	const out = new Array<number>(isos.length).fill(0);
	const snaps = snapshotsAt(s.snapshots, isos);
	const pending: number[] = [];
	for (let k = 0; k < isos.length; k++) {
		if (snaps[k] !== null) out[k] = snaps[k]!;
		else pending.push(k);
	}
	if (pending.length === 0) return out;
	const days = pending.map((k) => isos[k]!);
	if (s.ledger.size > 0) {
		for (const [asset, series] of s.ledger) {
			const balances = balancesAt(series, days);
			const closes = s.isFiat(asset) ? null : closesAt(s.ohlc[asset] ?? [], days);
			for (let j = 0; j < days.length; j++) {
				const bal = balances[j]!;
				if (bal <= 0) continue;
				if (closes === null) out[pending[j]!] += s.toEur(bal, asset, days[j]!) ?? 0;
				else if (closes[j] !== null) out[pending[j]!] += bal * closes[j]!;
			}
		}
		return out;
	}
	for (const h of s.holdings) {
		const series = s.ohlc[h.symbol];
		if (!series || series.length === 0) continue;
		const closes = closesAt(series, days);
		for (let j = 0; j < days.length; j++) if (closes[j] !== null) out[pending[j]!] += h.qty * closes[j]!;
	}
	return out;
}

/** Ledger history (every asset mixed, sorted by date) split per asset, order kept. */
export function splitByAsset(history: readonly { date: string; asset: string; balance: number }[], skip?: (asset: string) => boolean): Map<string, DailyBalance[]> {
	const out = new Map<string, DailyBalance[]>();
	for (const p of history) {
		if (skip?.(p.asset)) continue;
		const list = out.get(p.asset);
		if (list) list.push({ date: p.date, balance: p.balance });
		else out.set(p.asset, [{ date: p.date, balance: p.balance }]);
	}
	return out;
}
