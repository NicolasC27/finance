import type { KrakenLedgerEntry } from './csvKraken';
import { isFiat, toEur } from './fiat';
import { applyPerfEntries, emptyPerf, isRewardLine, netQty, summarizeLedger, type KrakenPerfState } from './krakenPerf';

/**
 * Local store of the Kraken crypto ledger (SPEC v14 §E.2) — `budget:kraken-ledger`.
 *
 * Fed by "spot ledgers" CSV imports: crypto rows (BTC…) are NOT budget
 * transactions, they live here:
 *   - balances per asset (`balance` column, rows of the same second resolved
 *     by krakenPerf.summarizeLedger);
 *   - cumulated card cashback (krakcard/cashbackreward) + number of rewarded
 *     spends;
 *   - rewards (staking/earn/bonus) cumulated, NET of the fee;
 *   - total card spending in EUR;
 *   - balance history compacted to 1 point/day/asset (for the crypto portfolio
 *     value curve on the Patrimoine page).
 *
 * Merged on import: several files, in any order; deduplication by txid makes a
 * re-import strictly idempotent.
 */

export interface KrakenBalancePoint {
	/** "YYYY-MM-DD" date (1 point per day and per asset). */
	date: string;
	asset: string;
	/** Asset balance at the end of the day (last row of the day). */
	balance: number;
	/** Timestamp of the source row (internal merge order). */
	at: string;
}

export interface KrakenLedgerSummary {
	/** Last known balance per asset (balance column, most recent row). */
	assetBalances: Record<string, number>;
	/** Cumulated card cashback per asset (BTC…). */
	cashbackTotal: Record<string, number>;
	/** Number of rewarded card spends (cashbackreward rows). */
	cashbackCount: number;
	/** Cumulated rewards per asset (staking/earn/bonus), net of the Kraken fee. */
	earnTotal: Record<string, number>;
	/** Σ |krakcard spend| in EUR. */
	spendTotalEUR: number;
	/** Compacted history: 1 point/day/asset, sorted by date. */
	balanceHistory: KrakenBalancePoint[];
	lastImportAt: number;
	/** Fiat deposits/withdrawals and cost basis per asset (krakenPerf.ts). */
	perf: KrakenPerfState;
	/**
	 * Start date (ISO) of the last API sync that RAN TO THE END: the stored
	 * history is complete since that date → later syncs are incremental (before:
	 * a full refetch of ~20 pages every time).
	 */
	apiSyncedFrom?: string;
}

/** Compact ledger row kept to recompute the performance (chronological order guaranteed even when backfilling). */
type CompactEntry = [txid: string, refid: string, at: string, type: string, subtype: string, asset: string, amount: number, fee: number, balance: number];

/** Persisted shape: summary + txids already seen (idempotent re-import). */
interface KrakenLedgerStore extends KrakenLedgerSummary {
	seenTxids: string[];
	/** All rows seen (compact). */
	entries: CompactEntry[];
}

export const LEDGER_KEY = 'budget:kraken-ledger';

const compact = (e: KrakenLedgerEntry): CompactEntry => [e.txid, e.refid, e.at, e.type, e.subtype, e.asset, e.amount, e.fee, e.balance];
const expand = (c: CompactEntry): KrakenLedgerEntry => ({ txid: c[0], refid: c[1], at: c[2], date: c[2].slice(0, 10), type: c[3], subtype: c[4], asset: c[5], amount: c[6], fee: c[7], balance: c[8] });

function emptyStore(): KrakenLedgerStore {
	return {
		assetBalances: {},
		cashbackTotal: {},
		cashbackCount: 0,
		earnTotal: {},
		spendTotalEUR: 0,
		balanceHistory: [],
		lastImportAt: 0,
		perf: emptyPerf(),
		seenTxids: [],
		entries: []
	};
}

/**
 * Loads the store. The performance AND the summary (balances, rewards,
 * history) are recomputed from the kept rows on load: an engine fix applies
 * on the next reload, without resyncing. The persisted summary is kept when
 * the row store is incomplete (older version).
 */
function loadLedger(): KrakenLedgerStore {
	if (typeof localStorage === 'undefined') return emptyStore();
	try {
		const raw = localStorage.getItem(LEDGER_KEY);
		if (!raw) return emptyStore();
		const parsed = JSON.parse(raw) as Partial<KrakenLedgerStore>;
		if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.balanceHistory)) return emptyStore();
		const entries = Array.isArray(parsed.entries) ? parsed.entries : [];
		const seenTxids = Array.isArray(parsed.seenTxids) ? parsed.seenTxids : [];
		const expanded = entries.map(expand);
		const perf = entries.length > 0 ? applyPerfEntries(emptyPerf(), expanded) : { ...emptyPerf(), ...(parsed.perf ?? {}) };
		const summary = entries.length > 0 && entries.length >= seenTxids.length ? summarizeLedger(expanded) : {};
		return { ...emptyStore(), ...parsed, ...summary, perf, seenTxids, entries };
	} catch {
		return emptyStore();
	}
}

/** Persists the store; when the quota is exceeded the data stays in memory for the session. */
function persist(store: KrakenLedgerStore): void {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(LEDGER_KEY, JSON.stringify(store));
	} catch {
	}
}

export const krakenLedgerState = $state({ ledger: loadLedger() });

export function getKrakenLedger(): KrakenLedgerSummary {
	return krakenLedgerState.ledger;
}

/** Does the ledger have content (at least one tracked asset)? */
export function hasKrakenLedger(): boolean {
	return Object.keys(krakenLedgerState.ledger.assetBalances).length > 0;
}

/**
 * Merges the rows of an import (idempotent re-import by txid). Returns the
 * number of truly new rows.
 * Rows kept for the performance are those missing from the row store
 * (including txids already "seen" by an older version that didn't store them);
 * nothing new but rows to remember → the performance is recomputed. With a
 * complete row store the summary is recomputed over the WHOLE history;
 * an old store without rows gets an incremental update of the persisted
 * summary. History key is day|asset, the most recent row of the day wins;
 * balances per asset come from the most recent row (timestamp).
 */
export function mergeKrakenLedger(entries: KrakenLedgerEntry[]): number {
	const store = krakenLedgerState.ledger;
	const seen = new Set(store.seenTxids);
	const fresh = entries.filter((e) => e.txid && !seen.has(e.txid));
	const kept = new Set(store.entries.map((c) => c[0]));
	const toStore = entries.filter((e) => e.txid && !kept.has(e.txid));
	if (fresh.length === 0 && toStore.length === 0) return 0;
	if (fresh.length === 0) {
		const allEntries = [...store.entries.map(expand), ...toStore];
		const nextEntries = [...store.entries, ...toStore.map(compact)];
		const summary = nextEntries.length >= seen.size ? summarizeLedger(allEntries) : {};
		const next: KrakenLedgerStore = { ...store, ...summary, perf: applyPerfEntries(emptyPerf(), allEntries), entries: nextEntries };
		krakenLedgerState.ledger = next;
		persist(next);
		return 0;
	}

	const allEntries = [...store.entries.map(expand), ...toStore];
	const nextEntries = [...store.entries, ...toStore.map(compact)];
	for (const e of fresh) seen.add(e.txid);

	let next: KrakenLedgerStore;
	if (nextEntries.length >= seen.size) {
		next = {
			...store,
			...summarizeLedger(allEntries),
			lastImportAt: Date.now(),
			perf: applyPerfEntries(emptyPerf(), allEntries),
			seenTxids: [...seen],
			entries: nextEntries
		};
	} else {
		const cashbackTotal = { ...store.cashbackTotal };
		const earnTotal = { ...store.earnTotal };
		let cashbackCount = store.cashbackCount;
		let spendTotalEUR = store.spendTotalEUR;
		const historyByKey = new Map<string, KrakenBalancePoint>();
		for (const p of store.balanceHistory) historyByKey.set(`${p.date}|${p.asset}`, p);
		for (const e of fresh) {
			const key = `${e.date}|${e.asset}`;
			const prev = historyByKey.get(key);
			if (!prev || e.at >= prev.at) historyByKey.set(key, { date: e.date, asset: e.asset, balance: e.balance, at: e.at });
			if (e.subtype === 'cashbackreward') {
				cashbackTotal[e.asset] = (cashbackTotal[e.asset] ?? 0) + netQty(e);
				cashbackCount++;
			} else if (isRewardLine(e)) {
				if (netQty(e) > 0) earnTotal[e.asset] = (earnTotal[e.asset] ?? 0) + netQty(e);
			} else if (e.type === 'krakcard' && e.subtype === 'spend' && e.asset === 'EUR') {
				spendTotalEUR += Math.abs(e.amount);
			}
		}
		const lastByAsset = new Map<string, { at: string; balance: number }>();
		for (const p of historyByKey.values()) {
			const cur = lastByAsset.get(p.asset);
			if (!cur || p.at >= cur.at) lastByAsset.set(p.asset, { at: p.at, balance: p.balance });
		}
		const assetBalances: Record<string, number> = {};
		for (const [asset, v] of lastByAsset) assetBalances[asset] = v.balance;
		next = {
			...store,
			assetBalances,
			cashbackTotal,
			cashbackCount,
			earnTotal,
			spendTotalEUR: Math.round(spendTotalEUR * 100) / 100,
			balanceHistory: [...historyByKey.values()].sort((a, b) => (a.date === b.date ? a.asset.localeCompare(b.asset) : a.date.localeCompare(b.date))),
			lastImportAt: Date.now(),
			perf: applyPerfEntries(emptyPerf(), allEntries),
			seenTxids: [...seen],
			entries: nextEntries
		};
	}
	krakenLedgerState.ledger = next;
	persist(next);
	return fresh.length;
}

/**
 * Records that an API sync started at `fromIso` ran to the end: the history is
 * complete since that date (the oldest one is kept).
 */
export function markApiSynced(fromIso: string): void {
	const store = krakenLedgerState.ledger;
	const current = store.apiSyncedFrom;
	if (current && current <= fromIso) return;
	const next: KrakenLedgerStore = { ...store, apiSyncedFrom: fromIso };
	krakenLedgerState.ledger = next;
	persist(next);
}

/** All the kept rows (chronological). */
export function getLedgerEntries(): KrakenLedgerEntry[] {
	return krakenLedgerState.ledger.entries.map(expand).sort((a, b) => a.at.localeCompare(b.at));
}


export interface AssetTrade {
	date: string;
	side: 'buy' | 'sell';
	qty: number;
	eur: number;
	price: number;
}

/** EUR ↔ asset buys and sells (trades paired by refid), chronological. */
export function getAssetTrades(symbol: string): AssetTrade[] {
	const entries = krakenLedgerState.ledger.entries.map(expand);
	const groups = new Map<string, KrakenLedgerEntry[]>();
	for (const e of entries) {
		if (!(e.type === 'trade' || e.type === 'spend' || e.type === 'receive' || e.subtype === 'kardconversion')) continue;
		const g = groups.get(e.refid) ?? [];
		g.push(e);
		groups.set(e.refid, g);
	}
	const out: AssetTrade[] = [];
	for (const g of groups.values()) {
		const eur = g.filter((e) => isFiat(e.asset));
		const leg = g.find((e) => e.asset === symbol);
		if (!leg || eur.length === 0) continue;
		const eurNet = eur.reduce((s, e) => s + (toEur(e.amount, e.asset, e.date) ?? 0) - Math.abs(toEur(e.fee, e.asset, e.date) ?? 0), 0);
		const qty = Math.abs(leg.amount) - Math.abs(leg.fee);
		if (qty <= 0 || eurNet === 0) continue;
		out.push({ date: leg.date, side: leg.amount > 0 ? 'buy' : 'sell', qty: Math.round(qty * 1e8) / 1e8, eur: Math.round(Math.abs(eurNet) * 100) / 100, price: Math.abs(eurNet) / qty });
	}
	return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** The row store is incomplete (sync done by a version that didn't keep them): a full resync is needed. */
export function ledgerNeedsFullResync(): boolean {
	const l = krakenLedgerState.ledger;
	return l.seenTxids.length > l.entries.length;
}

/** Clears the ledger (test utility / reset). Unavailable storage is ignored. */
export function resetKrakenLedger(): void {
	krakenLedgerState.ledger = emptyStore();
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.removeItem(LEDGER_KEY);
	} catch {
	}
}
