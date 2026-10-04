import type { KrakenLedgerEntry } from './csvKraken';
import { isFiat, toEur } from './fiat';

/**
 * Kraken performance from the ledger (pure module, testable with tsx):
 * - fiat flows: deposits (EUR deposits, incoming transfers), withdrawals (EUR
 *   withdrawals NET of cancellations, outgoing transfers, card spending) —
 *   withdrawal fees are a cost (they reduce the value), not an outflow;
 * - cost basis per asset (weighted average cost): EUR ↔ crypto trades
 *   (trade / spend+receive / card conversions), crypto withdrawals and rewards
 *   handled in CHRONOLOGICAL ORDER (the average cost depends on it); gains
 *   realised on sale; cashback and rewards enter at zero cost, NET of the
 *   Kraken fee.
 *
 * Total gain = (current value + withdrawals) − deposits: everything that came
 * out or remains, minus what was put in. Independent of past prices.
 *
 * Also holds the ledger summary (balances per asset, rewards, history):
 * summarizeLedger.
 */

export interface AssetCost {
	/** Quantity held according to trades (≈ balance; gaps come from rows outside the period). */
	qty: number;
	/** Remaining EUR cost of the held quantity (average cost). */
	cost: number;
	/** EUR spent on buys (fees included), cumulated. */
	boughtEur: number;
	/** EUR received from sales (fees deducted), cumulated. */
	soldEur: number;
	/** Gains realised on sales (EUR received − average cost of the sold quantity). */
	realized: number;
}

export interface KrakenPerfState {
	depositsEur: number;
	withdrawalsEur: number;
	cardSpendEur: number;
	costBasis: Record<string, AssetCost>;
	/** Crypto received from / sent outside (not EUR): valued at the day's price. */
	cryptoFlows: { asset: string; qty: number; date: string }[];
	/** First and last date seen in the ledger. */
	firstDate: string;
	lastDate: string;
}

export function emptyPerf(): KrakenPerfState {
	return { depositsEur: 0, withdrawalsEur: 0, cardSpendEur: 0, costBasis: {}, cryptoFlows: [], firstDate: '', lastDate: '' };
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const r8 = (n: number) => Math.round(n * 1e8) / 1e8;

/** Technical Kraken assets without value (offered fee credits): ignored everywhere. */
export const TECHNICAL_ASSETS: ReadonlySet<string> = new Set(['KFEE']);

/** Row types forming an EUR ↔ asset trade (paired by refid). */
const EXCHANGE_TYPES = new Set(['trade', 'spend', 'receive']);

function isExchangeLine(e: KrakenLedgerEntry): boolean {
	return EXCHANGE_TYPES.has(e.type) || e.subtype === 'kardconversion';
}

/**
 * Reward received (quantity at zero cost): card cashback, staking (old type),
 * earn/reward (Kraken Earn), welcome bonus. Other earn rows (allocation,
 * autoallocation, migration…) are only internal moves, never gains.
 */
export function isRewardLine(e: KrakenLedgerEntry): boolean {
	if (isFiat(e.asset) || TECHNICAL_ASSETS.has(e.asset) || e.amount <= 0) return false;
	return e.subtype === 'cashbackreward' || e.type === 'staking' || e.type === 'reward' || (e.type === 'earn' && e.subtype === 'reward');
}

/** Net quantity of a row: Kraken takes its fee in the fee column. */
export function netQty(e: KrakenLedgerEntry): number {
	return e.amount - e.fee;
}

function isFiatIn(e: KrakenLedgerEntry): boolean {
	if (!isFiat(e.asset) || e.amount <= 0) return false;
	return e.type === 'deposit' || (e.type === 'transfer' && e.subtype === 'useraccounttransfer');
}

/** EUR transfer to another Kraken account (Krak card): an outflow of the tracked portfolio. */
function isFiatTransferOut(e: KrakenLedgerEntry): boolean {
	return isFiat(e.asset) && e.amount < 0 && e.type === 'transfer' && e.subtype === 'useraccounttransfer';
}

function isCardSpend(e: KrakenLedgerEntry): boolean {
	return e.type === 'krakcard' && e.subtype === 'spend' && isFiat(e.asset) && e.amount < 0;
}

/** Crypto sent out of the tracked portfolio (withdrawal, « hybrid earn » withdrawal). */
function isCryptoOut(e: KrakenLedgerEntry): boolean {
	if (isFiat(e.asset) || TECHNICAL_ASSETS.has(e.asset) || e.amount >= 0) return false;
	return e.type === 'withdrawal' || e.type === 'hybridearnwithdrawal';
}

/**
 * Applies NEW rows (deduplicated upstream) to the state in one chronological
 * pass — trades (paired by refid, applied at their first row), crypto
 * withdrawals and rewards in the order they happened. Before, rewards were
 * added AFTER all sales: already sold ones came back into the position
 * (wrong quantity and average cost). Returns a new state.
 * Details:
 * - trades are grouped by refid into an EUR leg + asset leg(s); crypto ↔
 *   crypto is out of the fiat scope; the group's net fiat is in euros, fees
 *   included (USD, GBP… converted at the yearly rate); fees can be taken in
 *   crypto; a buy costs the EUR spent (proportional share with several legs);
 *   a sale removes the average cost of the sold quantity from the remaining
 *   cost;
 * - fiat flows are sums (order doesn't matter) of SIGNED amounts: a cancelled
 *   withdrawal (−99 then +99) cancels out; fees (and their refund on
 *   cancellation) are not an outflow;
 * - cost basis is processed chronologically: crypto received from an external
 *   wallet is an in-kind deposit (valued at the day's price); crypto sent out
 *   takes its quantity (fees included) and average cost out of the tracked
 *   portfolio, only the sent quantity counts as an outflow; a reward is a NET
 *   quantity at zero cost (it lowers the average cost).
 */
export function applyPerfEntries(prev: KrakenPerfState, entries: KrakenLedgerEntry[]): KrakenPerfState {
	const st: KrakenPerfState = {
		...prev,
		costBasis: Object.fromEntries(Object.entries(prev.costBasis).map(([k, v]) => [k, { ...v }])),
		cryptoFlows: [...(prev.cryptoFlows ?? [])]
	};
	const sorted = [...entries].sort((a, b) => a.at.localeCompare(b.at));
	const basis = (asset: string): AssetCost =>
		(st.costBasis[asset] ??= { qty: 0, cost: 0, boughtEur: 0, soldEur: 0, realized: 0 });

	const groups = new Map<string, KrakenLedgerEntry[]>();
	for (const e of sorted) {
		if (!isExchangeLine(e)) continue;
		const g = groups.get(e.refid) ?? [];
		g.push(e);
		groups.set(e.refid, g);
	}
	const applied = new Set<string>();

	const applyExchange = (g: KrakenLedgerEntry[]) => {
		const eur = g.filter((e) => isFiat(e.asset));
		const legs = g.filter((e) => !isFiat(e.asset) && !TECHNICAL_ASSETS.has(e.asset));
		if (eur.length === 0 || legs.length === 0) return;
		const eurNet = eur.reduce((s, e) => s + (toEur(e.amount, e.asset, e.date) ?? 0) - Math.abs(toEur(e.fee, e.asset, e.date) ?? 0), 0);
		const legsTotal = legs.reduce((s, l) => s + Math.abs(l.amount), 0);
		for (const leg of legs) {
			const b = basis(leg.asset);
			const qty = leg.amount - Math.abs(leg.fee);
			const share = legs.length === 1 ? 1 : Math.abs(leg.amount) / legsTotal;
			if (qty > 0 && eurNet < 0) {
				const cost = Math.abs(eurNet) * share;
				b.qty = r8(b.qty + qty);
				b.cost = r2(b.cost + cost);
				b.boughtEur = r2(b.boughtEur + cost);
			} else if (qty < 0 && eurNet > 0) {
				const sold = Math.min(Math.abs(qty), b.qty);
				const avg = b.qty > 0 ? b.cost / b.qty : 0;
				const received = eurNet * share;
				b.realized = r2(b.realized + (received - avg * sold));
				b.soldEur = r2(b.soldEur + received);
				b.cost = r2(Math.max(0, b.cost - avg * sold));
				b.qty = r8(Math.max(0, b.qty - Math.abs(qty)));
			}
		}
	};

	for (const e of sorted) {
		if (!st.firstDate || e.date < st.firstDate) st.firstDate = e.date;
		if (e.date > st.lastDate) st.lastDate = e.date;

		if (isFiatIn(e)) st.depositsEur = r2(st.depositsEur + (toEur(e.amount, e.asset, e.date) ?? 0));
		else if (isFiat(e.asset) && e.type === 'withdrawal') {
			st.withdrawalsEur = r2(st.withdrawalsEur - (toEur(e.amount, e.asset, e.date) ?? 0));
		} else if (isFiatTransferOut(e)) st.withdrawalsEur = r2(st.withdrawalsEur + Math.abs(toEur(e.amount, e.asset, e.date) ?? 0));
		else if (isCardSpend(e)) st.cardSpendEur = r2(st.cardSpendEur + Math.abs(toEur(e.amount, e.asset, e.date) ?? 0));

		if (isExchangeLine(e)) {
			if (!applied.has(e.refid)) {
				applied.add(e.refid);
				applyExchange(groups.get(e.refid) ?? [e]);
			}
		} else if (!isFiat(e.asset) && !TECHNICAL_ASSETS.has(e.asset) && e.type === 'deposit' && e.amount > 0) {
			st.cryptoFlows.push({ asset: e.asset, qty: e.amount, date: e.date });
		} else if (isCryptoOut(e)) {
			const out = Math.abs(e.amount) + Math.abs(e.fee);
			st.cryptoFlows.push({ asset: e.asset, qty: -Math.abs(e.amount), date: e.date });
			const b = basis(e.asset);
			const removed = Math.min(out, b.qty);
			const avg = b.qty > 0 ? b.cost / b.qty : 0;
			b.cost = r2(Math.max(0, b.cost - avg * removed));
			b.qty = r8(Math.max(0, b.qty - removed));
		} else if (isRewardLine(e)) {
			const q = netQty(e);
			if (q > 0) {
				const b = basis(e.asset);
				b.qty = r8(b.qty + q);
			}
		}
	}
	return st;
}

export interface KrakenPerformance {
	/** Incoming/outgoing crypto flows without a known price at their date (not counted). */
	unpricedFlows: number;
	/** Held assets without a price (valued at 0). */
	unpricedAssets: number;
	/** Cumulated fiat deposits (deposits + incoming transfers). */
	invested: number;
	/** Cumulated fiat outflows (withdrawals + outgoing transfers + card spending). */
	withdrawn: number;
	/** Current value (EUR + valued crypto). */
	value: number;
	/** value + withdrawn − invested. */
	gain: number;
	/** gain / invested (undefined without any deposit). */
	gainPct: number | undefined;
	since: string;
	until: string;
}

/** Totals and gain of the portfolio; technical assets (KFEE credits from older persisted states) are skipped. */
export function computePerformance(
	st: KrakenPerfState,
	currentValueEur: number,
	priceAt?: (asset: string, date: string) => number | undefined,
	unpricedAssets = 0
): KrakenPerformance {
	let invested = st.depositsEur;
	let withdrawn = r2(st.withdrawalsEur + st.cardSpendEur);
	let unpricedFlows = 0;
	for (const f of st.cryptoFlows ?? []) {
		if (TECHNICAL_ASSETS.has(f.asset)) continue;
		const p = priceAt?.(f.asset, f.date);
		if (p === undefined) {
			unpricedFlows++;
			continue;
		}
		if (f.qty > 0) invested = r2(invested + f.qty * p);
		else withdrawn = r2(withdrawn + Math.abs(f.qty) * p);
	}
	const gain = r2(currentValueEur + withdrawn - invested);
	return {
		invested,
		withdrawn,
		value: r2(currentValueEur),
		gain,
		gainPct: invested > 0 ? (gain / invested) * 100 : undefined,
		since: st.firstDate,
		until: st.lastDate,
		unpricedFlows,
		unpricedAssets
	};
}

/**
 * Unit cost basis and unrealised gain of an asset at the current price. The
 * gain is only computed on the quantity whose cost is known (partial history:
 * buys older than the imported statement) — never extrapolated to the whole
 * position, otherwise a wrong cost basis blows the figure up.
 */
export function assetPnl(
	b: AssetCost | undefined,
	qtyHeld: number,
	price: number | undefined
): { avgCost: number; pnlEur: number; pnlPct: number; coverage: number; basisQty: number; basisCost: number } | undefined {
	if (!b || b.qty <= 1e-9 || b.cost <= 0 || price === undefined || qtyHeld <= 0) return undefined;
	const avgCost = b.cost / b.qty;
	const covered = Math.min(qtyHeld, b.qty);
	const coverage = covered / qtyHeld;
	const costHeld = avgCost * covered;
	const pnlEur = r2(covered * price - costHeld);
	return { avgCost, pnlEur, pnlPct: costHeld > 0 ? (pnlEur / costHeld) * 100 : 0, coverage, basisQty: b.qty, basisCost: b.cost };
}

// ---------- Ledger summary: balances, rewards, history ----------

export interface LedgerBalancePoint {
	/** "YYYY-MM-DD" date (1 point per day and per asset). */
	date: string;
	asset: string;
	/** Asset balance at the end of the day. */
	balance: number;
	/** Timestamp of the day's last row. */
	at: string;
}

export interface LedgerSummary {
	/** Final balance per asset. */
	assetBalances: Record<string, number>;
	/** Cumulated card cashback per asset (net of fee). */
	cashbackTotal: Record<string, number>;
	cashbackCount: number;
	/** Cumulated rewards per asset (staking/earn/bonus), NET of the Kraken fee. */
	earnTotal: Record<string, number>;
	/** Σ |krakcard spend| in EUR. */
	spendTotalEUR: number;
	/** 1 point/day/asset, sorted by date then asset. */
	balanceHistory: LedgerBalancePoint[];
}

/** Rounding that removes float leftovers (1e-17) from quantity sums. */
const r10 = (n: number): number => {
	const v = Math.round(n * 1e10) / 1e10;
	return Math.abs(v) < 1e-12 ? 0 : v;
};

const near = (a: number, b: number): boolean => Math.abs(a - b) <= Math.max(1e-9, Math.abs(a) * 1e-9);

/**
 * Balance after a group of rows of the SAME asset in the SAME second. The
 * balance column gives the balance after each row, but the order of rows
 * within one second is not reliable (seen: « spend −100.00 USD » listed before
 * « receive +100.00 USD » → the last row left a fake 100.00 balance instead of
 * 0; autoallocation +X/−X pairs → balance 0 instead of X).
 * Rule: known balance before the group + Σ(amount − fee) of the group; for an
 * asset's very first group, the starting balance is the one no row of the
 * group produces (chain), otherwise 0 (asset never held yet). A single row:
 * the column is authoritative (resync).
 */
function groupBalance(group: KrakenLedgerEntry[], before: number | null): number {
	if (group.length === 1) return group[0]!.balance;
	const net = group.reduce((s, e) => s + netQty(e), 0);
	if (before !== null) return before + net;
	const befores = group.map((e) => e.balance - netQty(e));
	const afters = group.map((e) => e.balance);
	const start = befores.find((b) => !afters.some((a) => near(a, b))) ?? (befores.some((b) => near(b, 0)) ? 0 : group[group.length - 1]!.balance - net);
	return start + net;
}

/**
 * Full ledger summary (pure function) from ALL rows: final balances and daily
 * history per asset (same-second groups resolved by groupBalance), cashback,
 * net rewards, card spending. The sort is stable: file order on equal
 * seconds.
 */
export function summarizeLedger(entries: KrakenLedgerEntry[]): LedgerSummary {
	const sorted = [...entries].sort((a, b) => a.at.localeCompare(b.at));
	const cashbackTotal: Record<string, number> = {};
	const earnTotal: Record<string, number> = {};
	let cashbackCount = 0;
	let spendTotalEUR = 0;
	const byAsset = new Map<string, KrakenLedgerEntry[]>();
	for (const e of sorted) {
		if (e.subtype === 'cashbackreward') {
			cashbackTotal[e.asset] = r10((cashbackTotal[e.asset] ?? 0) + netQty(e));
			cashbackCount++;
		} else if (isRewardLine(e)) {
			const q = netQty(e);
			if (q > 0) earnTotal[e.asset] = r10((earnTotal[e.asset] ?? 0) + q);
		} else if (e.type === 'krakcard' && e.subtype === 'spend' && e.asset === 'EUR') {
			spendTotalEUR += Math.abs(e.amount);
		}
		const list = byAsset.get(e.asset);
		if (list) list.push(e);
		else byAsset.set(e.asset, [e]);
	}

	const assetBalances: Record<string, number> = {};
	const history = new Map<string, LedgerBalancePoint>();
	for (const [asset, lines] of byAsset) {
		let running: number | null = null;
		for (let i = 0; i < lines.length; ) {
			let j = i + 1;
			while (j < lines.length && lines[j]!.at === lines[i]!.at) j++;
			const group = lines.slice(i, j);
			running = r10(groupBalance(group, running));
			const last = group[group.length - 1]!;
			history.set(`${last.date}|${asset}`, { date: last.date, asset, balance: running, at: last.at });
			i = j;
		}
		if (running !== null) assetBalances[asset] = running;
	}
	const balanceHistory = [...history.values()].sort((a, b) => (a.date === b.date ? a.asset.localeCompare(b.asset) : a.date.localeCompare(b.date)));
	return { assetBalances, cashbackTotal, cashbackCount, earnTotal, spendTotalEUR: r2(spendTotalEUR), balanceHistory };
}
