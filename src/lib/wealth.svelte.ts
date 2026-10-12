import { restorePoint } from './history.svelte';
import type { Transaction } from './types';
import { getTransactions } from './store.svelte';
import { isPending, signedAmount, cumulativeBalance, type BalancePoint } from './data';
import { isBankTx } from './scope';
import { computeAccounts, isImplicitDemo, type AccountView } from './accountBalances';
import { isFiat, toEur } from './fiat';
import { closesAt, balancesAt, cryptoEurByDay, splitByAsset } from './cryptoValue';
import { formatDate } from './format';
import { accountState } from './accounts.svelte';
import { getLoanViews } from './loans.svelte';
import * as kraken from './kraken';
import { krakenLedgerState, mergeKrakenLedger, ledgerNeedsFullResync, getLedgerEntries, markApiSynced } from './krakenLedger.svelte';
import { entryToTransaction, isInternalKrakenMovement } from './csvKraken';
import { excludeKeys } from './transfers.svelte';
import { txKey } from './categories';
import { addImported } from './store.svelte';
import { assetPnl, computePerformance, TECHNICAL_ASSETS, type KrakenPerformance } from './krakenPerf';
import { computeTaxReport, pfuRate } from './cryptoTax';
import { hasTaxNotice, getTaxNotices } from './taxes.svelte';
import { natixisState, getNatixisEstimate } from './natixisHoldings.svelte';

/**
 * Reactive net-worth state (Svelte 5 runes):
 * - Kraken state (prices, balances, statuses, manual entries, snapshots)
 * - net worth = bank balances (demo + imported CM, imported Natixis) + live crypto
 * - net-worth history for the chart (bank + crypto snapshots/OHLC)
 */

export type PriceStatus = 'idle' | 'loading' | 'ok' | 'error' | 'offline';
export type BalanceStatus = 'no-keys' | 'loading' | 'ok' | 'error';

/**
 * Kraken state. Prices, candles and snapshots are raw state (hundreds of points read in loops by
 * the history curves): every change replaces the object or the array, never mutates it in place.
 */
class KrakenState {
	online = $state(typeof navigator === 'undefined' ? true : navigator.onLine);
	hasKeys = $state(false);
	/** symbol → quantity (API, suffixed variants summed). */
	balances = $state.raw<Record<string, number> | null>(null);
	/** '.HOLD' amounts from the API (pending deposits/withdrawals): shown apart, never counted. */
	hold = $state.raw<Record<string, number>>({});
	balanceStatus = $state<BalanceStatus>('no-keys');
	balanceError = $state('');
	/** Persisted manual entry. */
	manual = $state.raw<Record<string, number>>({});
	prices = $state.raw<Record<string, kraken.CachedPrice>>({});
	priceStatus = $state<PriceStatus>('idle');
	priceError = $state('');
	pricesAt = $state(0);
	ohlc = $state.raw<Record<string, kraken.OhlcPoint[]>>({});
	/** Weekly candles (up to ~14 years): valuation at an old date (tax, flows). */
	ohlcWeekly = $state.raw<Record<string, kraken.OhlcPoint[]>>({});
	snapshots = $state.raw<kraken.CryptoSnapshot[]>([]);
}

export const krakenState = new KrakenState();

let initialized = false;

/** Initialises the state from localStorage and listens to online/offline (idempotent). */
export function initKraken(): void {
	if (initialized) return;
	initialized = true;
	const cache = kraken.loadPricesCache();
	if (cache) {
		krakenState.prices = cache.data;
		krakenState.pricesAt = cache.at;
	}
	krakenState.manual = kraken.loadManual();
	krakenState.hasKeys = kraken.hasKeys();
	krakenState.snapshots = kraken.loadSnapshots();
	if (typeof window !== 'undefined') {
		window.addEventListener('online', () => (krakenState.online = true));
		window.addEventListener('offline', () => (krakenState.online = false));
	}
}

// Init on module load: child onMount callbacks run BEFORE App's
initKraken();

// ---------- Effective assets (API first, otherwise manual entry) ----------
// Without API keys, CSV ledger balances (factual) come first, then manual entries for the
// assets the ledger does not know. Positions are digital assets only: fiat (EUR, USD…) is
// counted apart (eurOnKraken) and KFEE (free fee credits) has no value.

export interface AssetView {
	symbol: string;
	qty: number;
	/** 'api' (private keys) > 'ledger' (CSV spot ledgers v14) > 'manual'. */
	source: 'api' | 'ledger' | 'manual';
	price?: number;
	change24h?: number;
	eur?: number;
	/** Unit cost basis (average cost, ledger) and unrealised gain at the current price. */
	avgCost?: number;
	pnlEur?: number;
	pnlPct?: number;
	/** Share of the position whose cost is known (1 = the whole history covers the position). */
	pnlCoverage?: number;
	basisQty?: number;
	basisCost?: number;
}

const assets = $derived.by((): AssetView[] => {
	const apiMode = krakenState.balanceStatus === 'ok' && krakenState.balances !== null;
	let entries: [string, number, AssetView['source']][];
	if (apiMode) {
		entries = Object.entries(krakenState.balances ?? {}).map(
			([symbol, qty]): [string, number, AssetView['source']] => [symbol, qty, 'api']
		);
	} else {
		const merged = new Map<string, { qty: number; source: 'ledger' | 'manual' }>();
		for (const [symbol, qty] of Object.entries(krakenLedgerState.ledger.assetBalances)) {
			if (qty > 0) merged.set(symbol, { qty, source: 'ledger' });
		}
		for (const [symbol, qty] of Object.entries(krakenState.manual)) {
			if (qty > 0 && !merged.has(symbol)) merged.set(symbol, { qty, source: 'manual' });
		}
		entries = [...merged.entries()].map(([symbol, v]): [string, number, AssetView['source']] => [symbol, v.qty, v.source]);
	}
	return entries
		.filter(([symbol]) => !isFiat(symbol) && !TECHNICAL_ASSETS.has(symbol))
		.map(([symbol, qty, source]) => {
			const quote = krakenState.prices[symbol];
			const pnl = assetPnl(krakenLedgerState.ledger.perf.costBasis[symbol], qty, quote?.price);
			return {
				symbol,
				qty,
				source,
				price: quote?.price,
				change24h: quote?.change24h,
				eur: quote ? qty * quote.price : undefined,
				...(pnl ? { avgCost: pnl.avgCost, pnlEur: pnl.pnlEur, pnlPct: pnl.pnlPct, pnlCoverage: pnl.coverage, basisQty: pnl.basisQty, basisCost: pnl.basisCost } : {})
			};
		})
		.sort((a, b) => (b.eur ?? 0) - (a.eur ?? 0));
});

export function getAssets(): AssetView[] {
	return assets;
}

/**
 * Kraken performance (deposits, withdrawals, value, gain) since the start of the imported
 * ledger; null without a ledger. Value = EUR on Kraken + valued cryptos (cryptoTotal already
 * includes the EUR held on Kraken: never add them twice).
 */
export function getKrakenPerformance(): KrakenPerformance | null {
	const perf = krakenLedgerState.ledger.perf;
	if (!perf.firstDate) return null;
	const unpriced = assets.filter((a) => a.qty > 0 && a.price === undefined).length;
	return computePerformance(perf, getCryptoTotal(), priceAtDate, unpriced);
}

/** Closest close to a date in a series, if it is less than `maxDays` away. */
function nearestClose(series: kraken.OhlcPoint[] | undefined, target: number, maxDays: number): number | undefined {
	if (!series || series.length === 0) return undefined;
	let best: { close: number; d: number } | null = null;
	for (const p of series) {
		const d = Math.abs(p.t - target);
		if (!best || d < best.d) best = { close: p.close, d };
	}
	return best && best.d <= maxDays * 86_400_000 ? best.close : undefined;
}

/** OHLC close of an asset at a date: daily (±3 d), else weekly (±4 d), else the current price if the date is recent (< 7 d). */
export function priceAtDate(asset: string, date: string): number | undefined {
	const target = new Date(`${date}T12:00:00Z`).getTime();
	const daily = nearestClose(krakenState.ohlc[asset], target, 3);
	if (daily !== undefined) return daily;
	const weekly = nearestClose(krakenState.ohlcWeekly[asset], target, 4);
	if (weekly !== undefined) return weekly;
	const quote = krakenState.prices[asset];
	if (quote && Date.now() - target < 7 * 86_400_000) return quote.price;
	return undefined;
}

/** Assets of incoming/outgoing crypto flows (to preload their OHLC). */
export function getCryptoFlowAssets(): string[] {
	return [...new Set((krakenLedgerState.ledger.perf.cryptoFlows ?? []).map((f) => f.asset))];
}

/**
 * Fiat held on Kraken, in euros (API balances, else ledger balances): EUR plus the other
 * currencies converted at the yearly average rate (fiat.ts). They are not crypto positions
 * but they are still money.
 */
const eurOnKraken = $derived.by((): number => {
	const source = krakenState.balanceStatus === 'ok' && krakenState.balances ? krakenState.balances : krakenLedgerState.ledger.assetBalances;
	const today = dayKey(new Date());
	let total = 0;
	for (const [symbol, qty] of Object.entries(source)) {
		if (!isFiat(symbol) || !(qty > 0)) continue;
		total += toEur(qty, symbol, today) ?? 0;
	}
	return Math.round(total * 100) / 100;
});

/** Crypto valuation in EUR (live/cached prices; assets without a price excluded). */
const cryptoTotal = $derived(assets.reduce((sum, a) => sum + (a.eur ?? 0), 0) + eurOnKraken);

export function getCryptoTotal(): number {
	return cryptoTotal;
}

// ---------- Bank balances ----------

/** Rounds to the cent (cumulative flows drift in floating point). */
const r2 = (v: number): number => Math.round(v * 100) / 100;

function txAmount(tx: Transaction): number {
	return isPending(tx) ? 0 : signedAmount(tx);
}

// ---------- Detected accounts (v9: kinds, declared balances) ----------

export { computeAccounts, type AccountView } from './accountBalances';

/**
 * Reactive detected accounts (transactions ∪ persisted registry).
 * A tracked loan's balance (v13 §D.3) is the CURRENT estimated balance (projected from the
 * last statement); it enters the net total as is.
 */
const accountsView = $derived.by((): AccountView[] => {
	const base = computeAccounts(getTransactions(), accountState.accounts);
	const loans = getLoanViews();
	if (loans.size === 0) return base;
	return base.map((acc) => {
		const loan = loans.get(acc.id);
		return loan ? { ...acc, balance: loan.currentBalance } : acc;
	});
});

export function getAccountsView(): AccountView[] {
	return accountsView;
}

// ---------- Bank balances (declared wins over computed) ----------
// Generic flows (implicit demo + non-imported 'cm' account) plus detected accounts, declared
// balance first: never counted twice.

const bankBalances = $derived.by(() => {
	let cm = 0;
	let natixis = 0;
	for (const tx of getTransactions()) {
		const amount = txAmount(tx);
		if (tx.account === 'natixis') natixis += amount;
		else if (isImplicitDemo(tx)) cm += amount;
	}
	for (const acc of accountsView) cm += acc.balance;
	return { cm: r2(cm), natixis: r2(natixis) };
});

export function getBankBalances(): { cm: number; natixis: number } {
	return bankBalances;
}

/** Natixis imported at least once (empty state otherwise). */
export function hasNatixis(): boolean {
	return getTransactions().some((tx) => tx.account === 'natixis');
}

// ---------- Employee savings, Natixis (v14 §F) ----------

/**
 * Employee savings in the net worth: the STATEMENT VALUE (factual snapshot on the valuation
 * day). The estimate extended by the yearly performance is not a valuation: it is shown apart
 * (getEmployeeSavingsEstimate) and never added to the net worth.
 */
const employeeSavingsTotal = $derived(natixisState.holdings?.total ?? 0);

export function getEmployeeSavingsTotal(): number {
	return employeeSavingsTotal;
}

/** Today's estimate of the employee savings (null without an estimate distinct from the statement). */
export function getEmployeeSavingsEstimate(): { total: number; valuedAt: string } | null {
	const est = getNatixisEstimate();
	const h = natixisState.holdings;
	if (!est || !h || !est.estimated || Math.abs(est.total - h.total) < 0.005) return null;
	return { total: est.total, valuedAt: h.valuedAt };
}

/**
 * Natixis CSV flows counted in the net worth: only WITHOUT a PDF statement. The statement
 * holdings already value the employee savings; adding the sum of CSV deposits would count
 * them twice.
 */
const natixisCash = $derived(natixisState.holdings ? 0 : bankBalances.natixis);

export function getNatixisCashCounted(): number {
	return natixisCash;
}

// ---------- Net worth + allocation ----------

export interface TaxProvisionDetail {
	total: number;
	/** 'estimate': flat tax estimated on disposals; 'notice': amount still due on an imported notice. */
	items: { year: number; gain: number; tax: number; rate: number; status: string; kind: 'estimate' | 'notice' }[];
	dueHint: string;
}

/**
 * Provision for crypto tax not yet paid: flat tax estimated on the disposals of the current
 * year (paid in September of the next year) and of the previous year as long as no tax notice
 * is imported for it. Deducted from the net worth. An imported but unpaid notice keeps its
 * amount due as a debt until the due date.
 */
const taxProvision = $derived.by((): TaxProvisionDetail => {
	const entries = getLedgerEntries();
	if (entries.length === 0 && getTaxNotices().length === 0) return { total: 0, items: [], dueHint: '' };
	const report = computeTaxReport(entries, priceAtDate);
	const thisYear = new Date().getFullYear();
	const today = dayKey(new Date());
	const items: TaxProvisionDetail['items'] = [];
	for (const y of report.years) {
		if (y.taxEstimate <= 0) continue;
		const rate = pfuRate(y.year);
		if (y.year === thisYear) items.push({ year: y.year, gain: y.netGain, tax: y.taxEstimate, rate, status: `à payer en septembre ${y.year + 1}`, kind: 'estimate' });
		else if (y.year === thisYear - 1 && !hasTaxNotice(y.year)) items.push({ year: y.year, gain: y.netGain, tax: y.taxEstimate, rate, status: `à payer en septembre ${y.year + 1} (importez l'avis quand il arrive)`, kind: 'estimate' });
	}
	for (const n of getTaxNotices()) {
		if (!n.remaining || n.remaining <= 0 || !n.remainingDueDate || n.remainingDueDate < today) continue;
		if (items.some((it) => it.year === n.year)) continue;
		const gain = report.years.find((y) => y.year === n.year)?.netGain ?? 0;
		items.push({ year: n.year, gain, tax: n.remaining, rate: pfuRate(n.year), status: `reste à payer avant le ${formatDate(n.remainingDueDate)} (avis d'impôt)`, kind: 'notice' });
	}
	const total = Math.round(items.reduce((s2, it) => s2 + it.tax, 0) * 100) / 100;
	const hasEstimate = items.some((it) => it.kind === 'estimate');
	return { total, items, dueHint: hasEstimate ? 'Estimation au PFU (12,8 % IR + prélèvements sociaux) sur les cessions Kraken ; le montant réel figurera sur l’avis d’impôt.' : '' };
});

export function getTaxProvisionDetail(): TaxProvisionDetail {
	return taxProvision;
}

export function getTaxProvision(): number {
	return taxProvision.total;
}

const netWorth = $derived(
	Math.round((bankBalances.cm + natixisCash + cryptoTotal + employeeSavingsTotal - taxProvision.total) * 100) / 100
);

export function getNetWorth(): number {
	return netWorth;
}

export interface AllocationSlice {
	id: string;
	label: string;
	value: number;
	color: string;
}

/**
 * Allocation colours: blue for the bank, orange for crypto, green for employee savings. Taken from
 * the category palette and checked together on 2026-10-06 (all pairs, light and dark surfaces:
 * OKLab ΔE ≥ 18 in normal vision, ≥ 9 with colour blindness); the former champagne and amber were
 * 6 apart and three of the four read grey.
 */
const ALLOCATION_COLORS = { cm: '#5d94da', natixis: '#9e5598', crypto: '#c77f3e', epargne: '#297613' } as const;

const allocation = $derived.by((): AllocationSlice[] => {
	const parts: AllocationSlice[] = [
		{ id: 'cm', label: 'Crédit Mutuel', value: bankBalances.cm, color: ALLOCATION_COLORS.cm },
		{ id: 'natixis', label: 'Natixis', value: natixisCash, color: ALLOCATION_COLORS.natixis },
		{ id: 'crypto', label: 'Crypto (Kraken)', value: cryptoTotal, color: ALLOCATION_COLORS.crypto },
		{ id: 'epargne', label: 'Épargne salariale', value: employeeSavingsTotal, color: ALLOCATION_COLORS.epargne }
	];
	return parts.filter((p) => p.value > 0).sort((a, b) => b.value - a.value);
});

export function getAllocation(): AllocationSlice[] {
	return allocation;
}

// ---------- Net-worth history ----------

function dayKey(d: Date): string {
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Daily ledger balances per asset (crypto AND fiat), sorted: base for back-computing the
 * crypto value at a past date.
 */
const ledgerHistoryByAsset = $derived(splitByAsset(krakenLedgerState.ledger.balanceHistory, (a) => TECHNICAL_ASSETS.has(a)));

/** Daily net-worth series: bank (cumulative tx) + crypto (snapshots/backfill). */
/**
 * Net-worth curve: BANK accounts (excluding Kraken lines, which are platform movements)
 * aligned on the real declared balance, + crypto value of the day. It starts at the first
 * imported bank statement: before that the bank balance is unknown and is not invented (the
 * long crypto curve lives on the Crypto page). Natixis is not a bank (scope.ts); its CSV flows
 * are a constant offset (only without a PDF statement, see natixisCash).
 */
const baseHistory = $derived.by((): BalancePoint[] => {
	const bankTx = getTransactions().filter(isBankTx);
	const bankPoints = cumulativeBalance(bankTx);
	if (bankPoints.length === 0) return [];
	const flowTotal = bankPoints[bankPoints.length - 1]!.balance;
	const offset = Math.round((bankBalances.cm - flowTotal + natixisCash) * 100) / 100;
	const crypto = cryptoEurByDay(
		bankPoints.map((p) => p.iso),
		{ snapshots: krakenState.snapshots, ledger: ledgerHistoryByAsset, ohlc: krakenState.ohlc, holdings: assets, isFiat, toEur }
	);
	return bankPoints.map((p, k) => ({
		date: p.date,
		iso: p.iso,
		balance: Math.round((p.balance + offset + crypto[k]!) * 100) / 100
	}));
});

/**
 * Curve + employee savings (step at the statement date, constant statement value after).
 * The LAST point matches the displayed net worth (today): tax provision and crypto value of
 * the day included. Future-dated data never creates a point.
 */
const history = $derived.by((): BalancePoint[] => {
	const h = natixisState.holdings;
	const withSavings = !h || !h.valuedAt ? baseHistory : baseHistory.map((p) => (p.iso >= h.valuedAt ? { ...p, balance: Math.round((p.balance + h.total) * 100) / 100 } : p));
	if (withSavings.length === 0) return withSavings;
	const today = dayKey(new Date());
	const last = withSavings[withSavings.length - 1]!;
	if (last.iso === today) return [...withSavings.slice(0, -1), { ...last, balance: netWorth }];
	if (last.iso > today) return withSavings;
	return [...withSavings, { date: new Date(`${today}T12:00:00`), iso: today, balance: netWorth }];
});

export function getWealthHistory(): BalancePoint[] {
	return history;
}

// ---------- Crypto portfolio value curve (ledger v14 §E.3) ----------

export interface CryptoHistoryView {
	points: BalancePoint[];
	/** true: EUR value (balance/day × OHLC close); false: raw balance fallback. */
	priced: boolean;
	/** Asset plotted in fallback (prices unavailable). */
	fallbackAsset?: string;
}

/**
 * EUR value history of the crypto portfolio: balance of each asset per day (ledger) × OHLC
 * close of the day. Never blocking: without OHLC prices (offline…), HONEST fallback to the raw
 * balance curve of the main asset (largest last balance), labelled 'prices unavailable' in the UI.
 */
const cryptoHistory = $derived.by((): CryptoHistoryView => {
	const hist = krakenLedgerState.ledger.balanceHistory.filter((p) => p.asset !== 'EUR');
	if (hist.length === 0) return { points: [], priced: false };
	const byAsset = splitByAsset(hist);
	const dates = [...new Set(hist.map((p) => p.date))].sort();
	const hasOhlc = [...byAsset.keys()].some((s) => (krakenState.ohlc[s]?.length ?? 0) > 0);

	if (hasOhlc) {
		const totals = new Array<number>(dates.length).fill(0);
		for (const [s, series] of byAsset) {
			const balances = balancesAt(series, dates);
			const closes = closesAt(krakenState.ohlc[s] ?? [], dates);
			for (let k = 0; k < dates.length; k++) if (balances[k]! > 0 && closes[k] !== null) totals[k] += balances[k]! * closes[k]!;
		}
		return { points: dates.map((iso, k) => ({ date: new Date(`${iso}T12:00:00`), iso, balance: Math.round(totals[k]! * 100) / 100 })), priced: true };
	}

	const lastBalance = (s: string) => series(s).at(-1)?.balance ?? 0;
	const series = (s: string) => byAsset.get(s)!;
	const top = [...byAsset.keys()].sort((a, b) => lastBalance(b) - lastBalance(a))[0]!;
	const balances = balancesAt(series(top), dates);
	return { points: dates.map((iso, k) => ({ date: new Date(`${iso}T12:00:00`), iso, balance: balances[k]! })), priced: false, fallbackAsset: top };
});

export function getCryptoHistory(): CryptoHistoryView {
	return cryptoHistory;
}

/** 30-day sparkline (sidebar mini card): last 30 points of the net worth. */
export function getNetWorthSparkline(): number[] {
	return history.slice(-30).map((p) => p.balance);
}

/** Net-worth change vs ~30 days ago (if the history is long enough). */
export function getNetWorthVar30(): number | undefined {
	if (history.length < 2) return undefined;
	const last = history[history.length - 1]!;
	const cutoff = new Date(last.date);
	cutoff.setDate(cutoff.getDate() - 30);
	let ref = history[0]!;
	for (const p of history) {
		if (p.date <= cutoff) ref = p;
		else break;
	}
	if (ref.balance === 0 || ref === last) return undefined;
	return Math.max(-999, Math.min(999, ((last.balance - ref.balance) / Math.abs(ref.balance)) * 100));
}

// ---------- Kraken actions ----------

/** Symbols whose price is needed (held assets, EUR excluded). */
function wantedSymbols(): string[] {
	return assets.map((a) => a.symbol);
}

/** Refreshes public prices; degrades to the cache + badge on failure. */
/** Prices fresher than this are not fetched again (a page mount or the 60-second timer asks often). */
const PRICE_TTL_MS = 60_000;

export async function refreshPrices(force = false): Promise<void> {
	const symbols = wantedSymbols();
	if (symbols.length === 0) return;
	if (!force && krakenState.priceStatus === 'ok' && Date.now() - krakenState.pricesAt < PRICE_TTL_MS && symbols.every((s) => krakenState.prices[s])) return;
	krakenState.priceStatus = 'loading';
	krakenState.priceError = '';
	try {
		const quotes = await kraken.fetchPrices(symbols);
		if (quotes.some((q) => krakenState.prices[q.symbol]?.price !== q.price || krakenState.prices[q.symbol]?.change24h !== q.change24h)) {
			const next = { ...krakenState.prices };
			for (const q of quotes) next[q.symbol] = { price: q.price, change24h: q.change24h };
			krakenState.prices = next;
		}
		krakenState.pricesAt = Date.now();
		krakenState.priceStatus = 'ok';
		kraken.savePricesCache({ at: krakenState.pricesAt, data: krakenState.prices });
		recordSnapshot();
	} catch (e) {
		krakenState.priceStatus = krakenState.online ? 'error' : 'offline';
		krakenState.priceError = e instanceof Error ? e.message : 'Erreur réseau';
	}
}

/**
 * Syncs the Kraken history through the API (ledger since `sinceIso`, or since the last known
 * date − 2 days): balances, cashback, performance (krakenLedger) + EUR lines in the budget
 * (account 'kraken'). Idempotent. Incremental once a full API sync has covered `sinceIso` (a
 * history from a partial CSV is not enough). Merged page by page, so an interruption only loses
 * the current page. Deposits, withdrawals, transfers and trades stay out of the budget (they are
 * counted in the balances).
 */
export async function syncLedgerFromApi(
	sinceIso = '2011-01-01', // the whole account history (Kraken exists since 2011)
	onProgress?: (fetched: number, total: number) => void
): Promise<{ entries: number; fresh: number; transactions: number }> {
	const last = krakenLedgerState.ledger.perf.lastDate;
	const syncedFrom = krakenLedgerState.ledger.apiSyncedFrom;
	let from = sinceIso;
	if (last && syncedFrom && syncedFrom <= sinceIso && !ledgerNeedsFullResync()) {
		const d = new Date(`${last}T00:00:00Z`);
		d.setUTCDate(d.getUTCDate() - 2);
		from = d.toISOString().slice(0, 10);
	}
	const sinceUnix = Math.floor(new Date(`${from}T00:00:00Z`).getTime() / 1000);
	let fresh = 0;
	let added = 0;
	const entries = await kraken.fetchLedgers(sinceUnix, onProgress, (page) => {
		fresh += mergeKrakenLedger(page);
		const txs = page.map(entryToTransaction).filter((t): t is Transaction => t !== null);
		if (txs.length > 0) {
			void restorePoint(`avant import API Kraken : ${txs.length} opération${txs.length > 1 ? 's' : ''}`);
			added += addImported(txs, { ignored: 0, errors: [], fileName: 'API Kraken', accounts: ['Kraken'] }).added;
		}
		const internalKeys = page.filter(isInternalKrakenMovement).map(entryToTransaction).filter((t): t is Transaction => t !== null).map(txKey);
		if (internalKeys.length > 0) excludeKeys(internalKeys);
	});
	markApiSynced(from === sinceIso ? sinceIso : (syncedFrom ?? sinceIso));
	void refreshPrices();
	return { entries: entries.length, fresh, transactions: added };
}

/** Weekly OHLC of a symbol (~14 years) for old valuations; non fatal (the old valuation then stays unknown and flagged). */
export async function loadOhlcWeekly(symbol: string): Promise<void> {
	if (krakenState.ohlcWeekly[symbol]) return;
	try {
		const points = await kraken.fetchOhlc(symbol, 10080);
		if (points.length > 0) krakenState.ohlcWeekly = { ...krakenState.ohlcWeekly, [symbol]: points };
	} catch {
	}
}

/** Daily OHLC of a symbol (chart backfill); non fatal, the chart still works without it. */
export async function loadOhlc(symbol: string): Promise<void> {
	if (krakenState.ohlc[symbol]) return;
	try {
		const points = await kraken.fetchOhlc(symbol);
		if (points.length > 0) krakenState.ohlc = { ...krakenState.ohlc, [symbol]: points };
	} catch {
	}
}

/** Fetches the private balances (keys required) and values new assets; never fatal. */
export async function refreshBalances(): Promise<{ ok: boolean; error?: string }> {
	if (!krakenState.hasKeys) {
		krakenState.balanceStatus = 'no-keys';
		return { ok: false, error: 'no-keys' };
	}
	krakenState.balanceStatus = 'loading';
	krakenState.balanceError = '';
	try {
		const detail = await kraken.fetchBalanceDetailed();
		krakenState.balances = detail.balances;
		krakenState.hold = detail.hold;
		krakenState.balanceStatus = 'ok';
		void refreshPrices();
		return { ok: true };
	} catch (e) {
		krakenState.balanceStatus = 'error';
		krakenState.balanceError = e instanceof Error ? e.message : 'Erreur réseau';
		return { ok: false, error: krakenState.balanceError };
	}
}

/**
 * Tests typed keys WITHOUT saving them: the global state (balances, status) is unchanged and
 * the test reflects exactly the field values.
 */
export async function testKeysOnly(
	key: string,
	secret: string
): Promise<{ ok: boolean; error?: string; count?: number }> {
	try {
		const balances = await kraken.fetchBalance({ key: key.trim(), secret: secret.trim() });
		return { ok: true, count: Object.keys(balances).length };
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : 'Erreur réseau' };
	}
}

/**
 * Tests the keys THEN has them saved if the connection works: the local server stores them
 * in the system keyring (rejected keys are never saved; the page does not keep them).
 */
export async function saveKeysAndTest(key: string, secret: string): Promise<{ ok: boolean; error?: string }> {
	const keys = { key: key.trim(), secret: secret.trim() };
	let detail: kraken.NormalizedBalances;
	try {
		detail = await kraken.saveKeys(keys);
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : 'Erreur réseau' };
	}
	krakenState.hasKeys = true;
	krakenState.balances = detail.balances;
	krakenState.hold = detail.hold;
	krakenState.balanceStatus = 'ok';
	krakenState.balanceError = '';
	void refreshPrices();
	return { ok: true };
}

/** Deletes the keys (keyring): back to manual mode. */
export async function clearKrakenKeys(): Promise<{ ok: boolean; error?: string }> {
	try {
		await kraken.clearKeys();
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : 'Erreur réseau' };
	}
	krakenState.hasKeys = false;
	krakenState.balances = null;
	krakenState.hold = {};
	krakenState.balanceStatus = 'no-keys';
	krakenState.balanceError = '';
	return { ok: true };
}

/** Manual entry of a quantity (persisted). */
export function setManualQty(symbol: string, qty: number): void {
	const clean = symbol.trim().toUpperCase();
	if (!clean) return;
	krakenState.manual = { ...krakenState.manual, [clean]: Math.max(0, qty) };
	kraken.saveManual(krakenState.manual);
	void refreshPrices();
}

/** Removes an asset from the manual entries. */
export function removeManual(symbol: string): void {
	const next = { ...krakenState.manual };
	delete next[symbol];
	krakenState.manual = next;
	kraken.saveManual(next);
}

/** Daily snapshot of the crypto valuation (1/day, upsert). */
function recordSnapshot(): void {
	const total = cryptoTotal;
	if (total <= 0) return;
	const date = dayKey(new Date());
	const eur = Math.round(total * 100) / 100;
	const list = [...krakenState.snapshots];
	const last = list[list.length - 1];
	if (last && last.date === date && last.eur === eur) return;
	if (last && last.date === date) list[list.length - 1] = { date, eur };
	else list.push({ date, eur });
	krakenState.snapshots = list;
	kraken.saveSnapshots(list);
}
