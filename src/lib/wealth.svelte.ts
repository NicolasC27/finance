import { restorePoint } from './history.svelte';
import type { Transaction } from './types';
import { getTransactions } from './store.svelte';
import { isPending, signedAmount, cumulativeBalance, type BalancePoint } from './data';
import { NON_BANK_ACCOUNTS, isBankTx } from './scope';
import { isFiat, toEur } from './fiat';
import { formatDate } from './format';
import { accountState, type AccountInfo } from './accounts.svelte';
import { detectAccountKind, type AccountKind } from './csvCore';
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

export const krakenState = $state({
	online: typeof navigator === 'undefined' ? true : navigator.onLine,
	hasKeys: false,
	balances: null as Record<string, number> | null, // symbol → quantity (API, suffixed variants summed)
	/** '.HOLD' amounts from the API (pending deposits/withdrawals): shown apart, never counted. */
	hold: {} as Record<string, number>,
	balanceStatus: 'no-keys' as BalanceStatus,
	balanceError: '',
	manual: {} as Record<string, number>, // persisted manual entry
	prices: {} as Record<string, kraken.CachedPrice>,
	priceStatus: 'idle' as PriceStatus,
	priceError: '',
	pricesAt: 0,
	ohlc: {} as Record<string, kraken.OhlcPoint[]>,
	/** Weekly candles (up to ~14 years): valuation at an old date (tax, flows). */
	ohlcWeekly: {} as Record<string, kraken.OhlcPoint[]>,
	snapshots: [] as kraken.CryptoSnapshot[]
});

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

/** Sources of a real bank statement (Crédit Mutuel CSV/XLSX, OFX/QIF/CAMT statements). */
const IMPORTED_BANK_SOURCES: ReadonlySet<Transaction['source']> = new Set(['cm-csv', 'cm-xlsx', 'ofx', 'qif', 'camt']);

/**
 * Transaction of the implicit generic account ('cm') outside imports: demo data, excluded
 * from the detected accounts (it still contributes to the total through the generic flows).
 */
function isImplicitDemo(tx: Transaction): boolean {
	return (tx.account ?? 'cm') === 'cm' && !IMPORTED_BANK_SOURCES.has(tx.source);
}

function txAmount(tx: Transaction): number {
	return isPending(tx) ? 0 : signedAmount(tx);
}

// ---------- Detected accounts (v9: kinds, declared balances) ----------

export interface AccountView {
	id: string;
	label: string;
	last4: string;
	kind: AccountKind;
	/** DECLARED balance (XLSX summary sheet / reconciliation) + flows after its date; undefined if unknown. */
	declared?: number;
	/** Computed balance: last known balance_after, else cumulative flows. */
	computed: number;
	/** Where the computation comes from: the statement Balance column, or the plain sum of imported flows. */
	computedFrom: 'balance' | 'flow';
	/** Balance used: declared wins over computed. */
	balance: number;
	/** Signed sum of the current month. */
	monthVar: number;
	txCount: number;
}

/** Readable fallback label when the registry does not know the id. */
function fallbackAccountLabel(id: string): string {
	if (id === 'cm') return 'Compte Courant';
	const m = /^cm-(?:\d{7})(\d{4})$/.exec(id);
	if (m) return `Compte ••${m[1]}`;
	if (id.startsWith('cm-')) return `Compte ${id.slice(3)}`;
	return id;
}

/**
 * Detected-accounts view (PURE function, testable outside the browser): distinct ids of
 * imported transactions ∪ registry (implicit demo and Natixis/Kraken excluded: they have their
 * own cards), kind + declared balance from the registry, computed balance (last balance_after,
 * else cumulative flows), current-month change and number of operations. A registry account
 * with no remaining transaction shows 0 operations (entry kept).
 *
 * The latest balance_after wins by date; on equal dates the FIRST one met wins (CM exports are
 * reverse-chronological). A dated declared balance is moved forward by the operations booked
 * after it; an undated one (old registry) is used as is. Non-bank accounts (Kraken, Natixis,
 * Krak card) never come from the registry: the Krak card used to show up as a phantom account.
 */
export function computeAccounts(txs: Transaction[], registry: AccountInfo[], now = new Date()): AccountView[] {
	const nowKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
	interface Acc {
		flow: number;
		monthVar: number;
		txCount: number;
		lastAt: string;
		lastBalance: number | null;
		afterDeclared: number;
	}
	const byAccount = new Map<string, Acc>();
	const ensure = (id: string): Acc => {
		let acc = byAccount.get(id);
		if (!acc) {
			acc = { flow: 0, monthVar: 0, txCount: 0, lastAt: '', lastBalance: null, afterDeclared: 0 };
			byAccount.set(id, acc);
		}
		return acc;
	};
	const declaredAt = new Map<string, string>();
	for (const info of registry) if (info.balance !== undefined && info.balanceAt) declaredAt.set(info.id, info.balanceAt);
	for (const tx of txs) {
		if (!isBankTx(tx)) continue;
		if (isImplicitDemo(tx)) continue;
		const acc = ensure(tx.account ?? 'cm');
		if (isPending(tx)) continue;
		const amount = signedAmount(tx);
		acc.txCount++;
		acc.flow = r2(acc.flow + amount);
		if (tx.booking_date.slice(0, 7) === nowKey) acc.monthVar = r2(acc.monthVar + amount);
		const declDate = declaredAt.get(tx.account ?? 'cm');
		if (declDate && tx.booking_date > declDate) acc.afterDeclared = r2(acc.afterDeclared + amount);
		if (tx.balance_after !== undefined && tx.booking_date > acc.lastAt) {
			acc.lastAt = tx.booking_date;
			acc.lastBalance = tx.balance_after;
		}
	}
	for (const info of registry) {
		if (NON_BANK_ACCOUNTS.has(info.id)) continue;
		ensure(info.id);
	}
	return [...byAccount.entries()]
		.map(([id, acc]) => {
			const reg = registry.find((a) => a.id === id);
			const label = reg?.label ?? fallbackAccountLabel(id);
			const computed = acc.lastBalance ?? acc.flow;
			const last4 = reg?.last4 ?? (/^cm-(?:\d{7})(\d{4})$/.exec(id)?.[1] || '••••');
			const declared = reg?.balance !== undefined ? (reg.balanceAt ? r2(reg.balance + acc.afterDeclared) : reg.balance) : undefined;
			return {
				id,
				label,
				last4,
				kind: reg?.kind ?? detectAccountKind(label, id),
				...(declared !== undefined ? { declared } : {}),
				computed,
				computedFrom: (acc.lastBalance !== null ? 'balance' : 'flow') as AccountView['computedFrom'],
				balance: declared ?? computed,
				monthVar: acc.monthVar,
				txCount: acc.txCount
			};
		})
		.sort((a, b) => b.balance - a.balance);
}

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

const ALLOCATION_COLORS = { cm: '#c9a86c', natixis: '#a8a69c', crypto: '#cd9b1f', epargne: '#8f9a7e' } as const;

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
const ledgerHistoryByAsset = $derived.by((): Map<string, { date: string; balance: number }[]> => {
	const out = new Map<string, { date: string; balance: number }[]>();
	for (const p of krakenLedgerState.ledger.balanceHistory) {
		if (TECHNICAL_ASSETS.has(p.asset)) continue;
		const list = out.get(p.asset);
		if (list) list.push({ date: p.date, balance: p.balance });
		else out.set(p.asset, [{ date: p.date, balance: p.balance }]);
	}
	return out;
});

/** Balance of an asset at a date in its daily series (last point ≤ date, 0 before the first). */
function balanceOn(series: { date: string; balance: number }[], iso: string): number {
	let bal = 0;
	for (const p of series) {
		if (p.date <= iso) bal = p.balance;
		else break;
	}
	return bal;
}

/**
 * Estimated crypto valuation at a date: snapshot of the day (or the latest before it), else a
 * back-computation. With a ledger: balance AT THAT TIME of each asset × close of the day (+ fiat);
 * current quantities used to be applied to past prices. Without a ledger (API keys / manual
 * entry): current quantities × close of the day (fallback, OHLC range only).
 */
function cryptoEurAt(iso: string): number {
	let snap: number | null = null;
	for (const s of krakenState.snapshots) {
		if (s.date <= iso) snap = s.eur;
		else break;
	}
	if (snap !== null) return snap;
	const ledgerSeries = ledgerHistoryByAsset;
	if (ledgerSeries.size > 0) {
		let total = 0;
		for (const [asset, series] of ledgerSeries) {
			const bal = balanceOn(series, iso);
			if (bal <= 0) continue;
			if (isFiat(asset)) {
				total += toEur(bal, asset, iso) ?? 0;
				continue;
			}
			const close = ohlcCloseAt(krakenState.ohlc[asset] ?? [], iso);
			if (close !== null) total += bal * close;
		}
		return total;
	}
	let total = 0;
	let any = false;
	for (const a of assets) {
		const series = krakenState.ohlc[a.symbol];
		if (!series || series.length === 0) continue;
		const t = new Date(`${iso}T23:59:59`).getTime();
		let close: number | null = null;
		for (const p of series) {
			if (p.t <= t) close = p.close;
			else break;
		}
		if (close !== null) {
			total += a.qty * close;
			any = true;
		}
	}
	return any ? total : 0;
}

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
	return bankPoints.map((p) => ({
		date: p.date,
		iso: p.iso,
		balance: Math.round((p.balance + offset + cryptoEurAt(p.iso)) * 100) / 100
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

/** Balance of an asset at a date: last history point ≤ date (history sorted by date). */
function ledgerBalanceAt(history: { date: string; asset: string; balance: number }[], asset: string, iso: string): number {
	let bal = 0;
	for (const p of history) {
		if (p.asset !== asset) continue;
		if (p.date <= iso) bal = p.balance;
		else break;
	}
	return bal;
}

/** OHLC close of a symbol at a date (last point ≤ end of day). */
function ohlcCloseAt(series: kraken.OhlcPoint[], iso: string): number | null {
	const t = new Date(`${iso}T23:59:59`).getTime();
	let close: number | null = null;
	for (const p of series) {
		if (p.t <= t) close = p.close;
		else break;
	}
	return close;
}

/**
 * EUR value history of the crypto portfolio: balance of each asset per day (ledger) × OHLC
 * close of the day. Never blocking: without OHLC prices (offline…), HONEST fallback to the raw
 * balance curve of the main asset (largest last balance), labelled 'prices unavailable' in the UI.
 */
const cryptoHistory = $derived.by((): CryptoHistoryView => {
	const hist = krakenLedgerState.ledger.balanceHistory.filter((p) => p.asset !== 'EUR');
	if (hist.length === 0) return { points: [], priced: false };
	const symbols = [...new Set(hist.map((p) => p.asset))];
	const dates = [...new Set(hist.map((p) => p.date))].sort();
	const hasOhlc = symbols.some((s) => (krakenState.ohlc[s]?.length ?? 0) > 0);

	if (hasOhlc) {
		const points: BalancePoint[] = dates.map((iso) => {
			let total = 0;
			for (const s of symbols) {
				const bal = ledgerBalanceAt(hist, s, iso);
				const close = ohlcCloseAt(krakenState.ohlc[s] ?? [], iso);
				if (bal > 0 && close !== null) total += bal * close;
			}
			return { date: new Date(`${iso}T12:00:00`), iso, balance: Math.round(total * 100) / 100 };
		});
		return { points, priced: true };
	}

	const lastDate = dates[dates.length - 1]!;
	const top = symbols.sort((a, b) => ledgerBalanceAt(hist, b, lastDate) - ledgerBalanceAt(hist, a, lastDate))[0]!;
	const points: BalancePoint[] = dates.map((iso) => ({
		date: new Date(`${iso}T12:00:00`),
		iso,
		balance: ledgerBalanceAt(hist, top, iso)
	}));
	return { points, priced: false, fallbackAsset: top };
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
export async function refreshPrices(): Promise<void> {
	const symbols = wantedSymbols();
	if (symbols.length === 0) return;
	krakenState.priceStatus = 'loading';
	krakenState.priceError = '';
	try {
		const quotes = await kraken.fetchPrices(symbols);
		for (const q of quotes) {
			krakenState.prices[q.symbol] = { price: q.price, change24h: q.change24h };
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
	const list = [...krakenState.snapshots];
	const last = list[list.length - 1];
	if (last && last.date === date) last.eur = Math.round(total * 100) / 100;
	else list.push({ date, eur: Math.round(total * 100) / 100 });
	krakenState.snapshots = list;
	kraken.saveSnapshots(list);
}
