/**
 * Kraken service (pure logic, no reactive state):
 * - public Ticker/OHLC prices (no key needed), localStorage cache
 * - private balances and ledger: signed by the LOCAL SERVER (keys in the
 *   system keyring, see server/kraken.ts); the page never has the secret key,
 *   it only receives the result
 * - Kraken symbol mapping (XXBT→BTC, ZEUR→EUR…)
 * - 10 s timeout + 1 retry; any network/CORS error is non-fatal
 */
import type { KrakenLedgerEntry } from './csvKraken';
import { diskState } from './diskStorage';

/**
 * API base: through the Vite server proxy in the browser (dev AND `vite
 * preview`, see vite.config.ts) — the Kraken private API doesn't answer CORS
 * requests. Before, the build (DEV=false) called api.kraken.com directly and
 * the preview proxy was never used. Overridable with VITE_KRAKEN_BASE (own
 * proxy in production); outside the browser (tsx), direct call.
 */
const ENV = (import.meta as { env?: { VITE_KRAKEN_BASE?: string } }).env ?? {}; // missing outside Vite (tsx tests)
const API_BASE: string = ENV.VITE_KRAKEN_BASE ?? (typeof window !== 'undefined' ? '/kraken-api/0' : 'https://api.kraken.com/0');
const TIMEOUT_MS = 10_000;

export const PRICES_KEY = 'budget:kraken-prices';
export const MANUAL_KEY = 'budget:kraken-manual';
export const SNAPSHOTS_KEY = 'budget:crypto-snapshots';

// ---------- API types (documented Kraken responses) ----------

interface KrakenResponse<T> {
	error: string[];
	result?: T;
}

/** Ticker: c = last trade [price, volume], p = vwap [today, 24h], o = open. */
type KrakenTickerResult = Record<string, { c: string[]; p: string[]; o: string }>;

/** OHLC: [time, open, high, low, close, vwap, volume, count]. */
type KrakenOhlcEntry = [number, string, string, string, string, string, string, number];
type KrakenOhlcResult = Record<string, KrakenOhlcEntry[] | string>;

/** Private balance: { "XXBT": "0.1234", "ZEUR": "100.00", … }. */
type KrakenBalanceResult = Record<string, string>;

// ---------- Symbol mapping ----------

/** Internal Kraken codes → readable names. */
const KRAKEN_NAMES: Record<string, string> = {
	XXBT: 'BTC',
	XBT: 'BTC',
	XETH: 'ETH',
	XLTC: 'LTC',
	XXRP: 'XRP',
	XXLM: 'XLM',
	XXDG: 'DOGE',
	XDG: 'DOGE', // pair key of Ticker/OHLC responses (« XDGEUR »)
	XETC: 'ETC',
	XTZ: 'XTZ',
	ZEUR: 'EUR',
	ZUSD: 'USD',
	ZGBP: 'GBP',
	ZCAD: 'CAD',
	ZJPY: 'JPY',
	ZCHF: 'CHF'
};

/**
 * Readable symbol from a Kraken asset code ("XXBT" → "BTC"). Suffixes are
 * removed: .S staked ("ETH2.S", "DOT.S"), .M/.F/.B rewards, .HOLD pending.
 */
export function displaySymbol(krakenAsset: string): string {
	const base = krakenAsset.replace(/\.(S|M|F|B|P|HOLD)$/, '');
	return KRAKEN_NAMES[base] ?? base;
}

/** Technical assets without a market (fee credits, pending EUR…): never requested. */
const UNPRICED = new Set(['KFEE', 'EUR.HOLD', 'EUR.M', 'EUR.F', 'ZEUR']);

/**
 * Fiat currencies (Kraken has no "USDEUR" pair: a single fiat symbol in the
 * Ticker batch made the WHOLE batch fail, then 1 + N fallback requests every
 * 60 s). They are valued by fiat.ts, never by the Ticker.
 */
const FIAT_SYMBOLS = new Set(['EUR', 'USD', 'GBP', 'CHF', 'CAD', 'JPY', 'AUD']);

/** Symbol that can be requested from Ticker/OHLC (neither fiat nor technical). */
export function isPriceable(symbol: string): boolean {
	return !!symbol && !FIAT_SYMBOLS.has(symbol) && !UNPRICED.has(symbol);
}

/**
 * Canonical pair name to request ("BTC" → "XXBTZEUR", "ETH" → "XETHZEUR").
 * Newer assets use their plain name ("SOLEUR", "DOTEUR").
 */
function requestPair(symbol: string): string {
	switch (symbol) {
		case 'BTC':
			return 'XXBTZEUR';
		case 'ETH':
			return 'XETHZEUR';
		case 'LTC':
			return 'XLTCZEUR';
		case 'XRP':
			return 'XXRPZEUR';
		default:
			return `${symbol}EUR`;
	}
}

/**
 * Normalises a response pair key ("XXBTZEUR" → "XBTEUR"): each 4-character
 * segment loses its X (crypto) or Z (fiat) prefix.
 */
function normalizePairKey(key: string): string {
	const strip = (seg: string) =>
		seg.length === 4 && (seg.startsWith('X') || seg.startsWith('Z')) ? seg.slice(1) : seg;
	if (key.length === 8) return strip(key.slice(0, 4)) + strip(key.slice(4));
	return key;
}

/** Finds the requested symbol matching a response key ("XXBTZEUR" → "BTC"). */
function symbolForPairKey(key: string, wanted: string[]): string | null {
	const norm = normalizePairKey(key);
	if (!norm.endsWith('EUR')) return null;
	const base = norm.slice(0, -3);
	const symbol = displaySymbol(base);
	return wanted.includes(symbol) ? symbol : null;
}

// ---------- Persistence ----------

export interface CachedPrice {
	price: number;
	change24h: number;
}

export interface PricesCache {
	at: number;
	data: Record<string, CachedPrice>;
}

export interface KrakenKeys {
	key: string;
	secret: string;
}

export interface CryptoSnapshot {
	date: string; // YYYY-MM-DD
	eur: number;
}

function readJson<T>(key: string): T | null {
	if (typeof localStorage === 'undefined') return null;
	try {
		const raw = localStorage.getItem(key);
		return raw ? (JSON.parse(raw) as T) : null;
	} catch {
		return null;
	}
}

/** Writes a JSON key; when the quota is exceeded the data stays in memory for the session. */
function writeJson(key: string, value: unknown): void {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(key, JSON.stringify(value));
	} catch {
	}
}

export function loadPricesCache(): PricesCache | null {
	const cache = readJson<PricesCache>(PRICES_KEY);
	return cache && typeof cache.at === 'number' && cache.data ? cache : null;
}

export function savePricesCache(cache: PricesCache): void {
	writeJson(PRICES_KEY, cache);
}

const SERVER_HEADERS = { 'x-budget-data': '1', 'content-type': 'application/json' };

/** Readable message of an error response from the local server. */
function serverError(body: { error?: unknown; message?: unknown }, status: number): string {
	if (Array.isArray(body.error) && body.error.length) return body.error.map(String).join(', ');
	if (typeof body.message === 'string') return body.message;
	return `serveur local : erreur ${status}`;
}

/** API keys stored on the server side (system keyring)? */
export function hasKeys(): boolean {
	return diskState.secrets.kraken;
}

/**
 * Tests the keys (Balance) then has the server store them in the keyring;
 * returns the test balances. Nothing is kept in the page.
 */
export async function saveKeys(keys: KrakenKeys): Promise<NormalizedBalances> {
	const res = await fetch('/__secrets/kraken', { method: 'PUT', headers: SERVER_HEADERS, body: JSON.stringify(keys) });
	const body = (await res.json().catch(() => ({}))) as { error?: unknown; message?: unknown; result?: Record<string, string> };
	if (!res.ok) throw new Error(serverError(body, res.status));
	diskState.secrets.kraken = true;
	return normalizeBalances(body.result ?? {});
}

/** Makes the server forget the keys (keyring entry deleted). */
export async function clearKeys(): Promise<void> {
	const res = await fetch('/__secrets/kraken', { method: 'DELETE', headers: SERVER_HEADERS });
	if (!res.ok) throw new Error(serverError((await res.json().catch(() => ({}))) as { error?: unknown }, res.status));
	diskState.secrets.kraken = false;
}

/** Quantities entered by hand (fallback without keys / offline). */
export function loadManual(): Record<string, number> {
	return readJson<Record<string, number>>(MANUAL_KEY) ?? {};
}

export function saveManual(manual: Record<string, number>): void {
	writeJson(MANUAL_KEY, manual);
}

/** Crypto valuation snapshots (1/day, for the wealth chart). */
export function loadSnapshots(): CryptoSnapshot[] {
	const list = readJson<CryptoSnapshot[]>(SNAPSHOTS_KEY);
	return Array.isArray(list) ? list.filter((s) => s && typeof s.date === 'string' && typeof s.eur === 'number') : [];
}

export function saveSnapshots(snapshots: CryptoSnapshot[]): void {
	writeJson(SNAPSHOTS_KEY, snapshots.slice(-400));
}

// ---------- Robust fetch: 10 s timeout, 1 retry, never fatal ----------

/**
 * `retry`: a single new attempt on network error/timeout/HTTP — reserved for
 * PUBLIC calls. A private call must never resend the same request: its nonce
 * would be refused (« EAPI:Invalid nonce »); privateCall re-signs.
 */
async function fetchJson<T>(url: string, init?: RequestInit, retry = true): Promise<KrakenResponse<T>> {
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
	try {
		const res = await fetch(url, { ...init, signal: ctrl.signal });
		if (!res.ok) throw new Error(`Kraken HTTP ${res.status}`);
		return (await res.json()) as KrakenResponse<T>;
	} catch (e) {
		if (retry) return fetchJson<T>(url, init, false);
		if (e instanceof DOMException && e.name === 'AbortError') throw new Error('Délai dépassé (10 s)');
		throw e instanceof Error ? e : new Error('Erreur réseau');
	} finally {
		clearTimeout(timer);
	}
}

// ---------- Public API: prices ----------

export interface PriceQuote {
	symbol: string;
	price: number;
	/**
	 * Change of the DAY in %: last price vs the 0:00 UTC open (`o` of the
	 * Ticker). The historical name is kept (localStorage cache); it was not a 24 h
	 * change but a gap to the VWAP, hence this change.
	 */
	change24h: number;
}

/** Change of the day (%): last price vs the 0:00 UTC open; 0 when unknown. */
export function dayChangePct(last: number, open: number): number {
	return open > 0 && Number.isFinite(last) ? ((last - open) / open) * 100 : 0;
}

/**
 * Live price + change of the day for a list of symbols ("BTC", "ETH"…). Throws
 * an Error on failure — the caller degrades (cache + badge). One batch; if
 * Kraken rejects the WHOLE batch for an unknown pair (« EQuery:Unknown asset
 * pair », e.g. an asset without an EUR market), each asset is requested on its
 * own and those without a price are ignored. The change of the day compares
 * the last price with the 0:00 UTC open (the 24 h VWAP underestimated trends:
 * a linear +10 % showed +4.8 %).
 */
export async function fetchPrices(symbols: string[]): Promise<PriceQuote[]> {
	const wanted = [...new Set(symbols)].filter(isPriceable);
	if (wanted.length === 0) return [];
	const ticker = async (syms: string[]): Promise<KrakenTickerResult> => {
		const res = await fetchJson<KrakenTickerResult>(
			`${API_BASE}/public/Ticker?pair=${encodeURIComponent(syms.map(requestPair).join(','))}`
		);
		if (res.error.length > 0) throw new Error(res.error.join(', '));
		return res.result ?? {};
	};
	let result: KrakenTickerResult = {};
	try {
		result = await ticker(wanted);
	} catch (e) {
		if (!(e instanceof Error) || !/unknown asset pair/i.test(e.message)) throw e;
		const settled = await Promise.allSettled(wanted.map((sym) => ticker([sym])));
		for (const r of settled) if (r.status === 'fulfilled') Object.assign(result, r.value);
	}
	const quotes: PriceQuote[] = [];
	for (const [key, ticker] of Object.entries(result)) {
		const symbol = symbolForPairKey(key, wanted);
		if (!symbol) continue;
		const price = Number(ticker.c[0]);
		const change24h = dayChangePct(price, Number(ticker.o) || 0);
		if (Number.isFinite(price) && price > 0) quotes.push({ symbol, price, change24h });
	}
	if (quotes.length === 0) throw new Error('Réponse Kraken inattendue (paires introuvables)');
	return quotes;
}

export interface OhlcPoint {
	t: number; // timestamp ms
	close: number;
}

/** Daily history (interval 1440) to backfill the wealth chart. Fiat and fee credits have no EUR pair and are not requested; the "last" key is skipped. */
export async function fetchOhlc(symbol: string, interval: 1440 | 10080 = 1440): Promise<OhlcPoint[]> {
	if (!isPriceable(symbol)) return [];
	const res = await fetchJson<KrakenOhlcResult>(
		`${API_BASE}/public/OHLC?pair=${encodeURIComponent(requestPair(symbol))}&interval=${interval}`
	);
	if (res.error.length > 0) throw new Error(res.error.join(', '));
	for (const [key, value] of Object.entries(res.result ?? {})) {
		if (!Array.isArray(value)) continue;
		if (symbolForPairKey(key, [symbol]) !== symbol) continue;
		return value
			.map((entry) => ({ t: entry[0] * 1000, close: Number(entry[4]) }))
			.filter((p) => Number.isFinite(p.close) && p.close > 0);
	}
	return [];
}

// ---------- Private API: balances and ledger (signed by the local server) ----------

/**
 * Queue of private calls: Kraken requires increasing nonces ON ARRIVAL; the
 * server serialises them too, the queue keeps the page order here.
 */
let privateQueue: Promise<unknown> = Promise.resolve();

/**
 * Private call (Balance, Ledgers) through the local server, which signs with
 * the keyring keys — or with `keys` to test entered keys without storing
 * them. Serialised; an error does not block the queue. On a network error a
 * single new attempt is made (the server signs with a fresh nonce).
 */
function privateCall<T>(method: string, params: Record<string, string | number>, keys?: KrakenKeys): Promise<T> {
	const run = privateQueue.then(() => privateCallNow<T>(method, params, keys));
	privateQueue = run.catch(() => undefined);
	return run;
}

async function privateCallNow<T>(method: string, params: Record<string, string | number>, keys: KrakenKeys | undefined, attempt = 0): Promise<T> {
	let res: KrakenResponse<T>;
	try {
		res = await fetchJson<T>(
			`/__kraken/${method}`,
			{ method: 'POST', headers: SERVER_HEADERS, body: JSON.stringify({ params, cles: keys }) },
			false
		);
	} catch (e) {
		if (attempt === 0) return privateCallNow<T>(method, params, keys, 1);
		throw e;
	}
	if (res.error.length > 0) throw new Error(res.error.join(', '));
	return res.result as T;
}

/** Ledgers response: entries indexed by id + total. */
interface KrakenLedgersResult {
	ledger: Record<string, { refid: string; time: number; type: string; subtype: string; aclass: string; asset: string; amount: string; fee: string; balance: string }>;
	count: number;
}

const pad2 = (n: number) => String(n).padStart(2, '0');
/** Unix (s) → "YYYY-MM-DD HH:MM:SS" UTC (same shape as the CSV export). */
function unixToKrakenTime(t: number): string {
	const d = new Date(t * 1000);
	return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Waiting steps after « EAPI:Rate limit exceeded » (the Kraken counter decreases by ~0.33 pt/s). */
const RATE_LIMIT_BACKOFF_MS = [15_000, 30_000, 60_000];

/**
 * Ledger history through the private API (« Consulter le registre »
 * permission), paginated by 50 from `sinceUnix`. 2.5 s between pages (Kraken
 * limit: 2 points per call, decay ~0.33 pt/s); on a rate limit, an increasing
 * wait then the SAME page is retried (instead of losing everything around the
 * 12th page). `onPage`: progress; `onEntries`: each page's rows, for an
 * ongoing merge (a cut only loses the current page).
 */
export async function fetchLedgers(
	sinceUnix: number,
	onPage?: (fetched: number, total: number) => void,
	onEntries?: (entries: KrakenLedgerEntry[]) => void
): Promise<KrakenLedgerEntry[]> {
	if (!hasKeys()) throw new Error('no-keys');
	const out: KrakenLedgerEntry[] = [];
	let ofs = 0;
	let total = Infinity;
	let waits = 0;
	while (ofs < total) {
		if (ofs > 0) await sleep(2500);
		let page: KrakenLedgersResult;
		try {
			page = await privateCall<KrakenLedgersResult>('Ledgers', { start: sinceUnix, ofs });
		} catch (e) {
			const delay = RATE_LIMIT_BACKOFF_MS[waits];
			if (e instanceof Error && /rate limit/i.test(e.message) && delay !== undefined) {
				waits++;
				await sleep(delay);
				continue;
			}
			throw e;
		}
		waits = 0;
		total = page.count;
		const ids = Object.keys(page.ledger);
		if (ids.length === 0) break;
		const pageEntries: KrakenLedgerEntry[] = [];
		for (const [txid, l] of Object.entries(page.ledger)) {
			const at = unixToKrakenTime(l.time);
			pageEntries.push({
				txid,
				refid: l.refid,
				at,
				date: at.slice(0, 10),
				type: l.type.toLowerCase(),
				subtype: (l.subtype ?? '').toLowerCase(),
				asset: displaySymbol(l.asset.toUpperCase()),
				amount: Number(l.amount),
				fee: Number(l.fee) || 0,
				balance: Number(l.balance)
			});
		}
		out.push(...pageEntries);
		onEntries?.(pageEntries);
		ofs += ids.length;
		onPage?.(Math.min(ofs, total), total);
	}
	return out;
}

export interface NormalizedBalances {
	/** Quantities held per readable symbol: suffixed variants are ADDED (ADA + ADA.F + ADA.S). */
	balances: Record<string, number>;
	/** « .HOLD » amounts (pending deposits/withdrawals): not held yet, excluded from balances. */
	hold: Record<string, number>;
}

/**
 * Normalises the Balance response (pure function): each Kraken asset can exist
 * under several codes (ADA, ADA.F in flexible earn, SOL.S staked…) that map to
 * the same readable symbol. Before, the LAST key overwrote the others
 * (10 ADA + 1,000 ADA.F → 1,000): they are now added. « .HOLD » amounts are set
 * apart (EUR.HOLD = deposit not credited yet).
 */
export function normalizeBalances(raw: Record<string, string | number>): NormalizedBalances {
	const balances: Record<string, number> = {};
	const hold: Record<string, number> = {};
	for (const [krakenAsset, value] of Object.entries(raw)) {
		const qty = Number(value);
		if (!Number.isFinite(qty) || qty <= 0) continue;
		const target = /\.HOLD$/i.test(krakenAsset) ? hold : balances;
		const base = displaySymbol(krakenAsset.toUpperCase());
		const symbol = BALANCE_ALIASES[base] ?? base;
		target[symbol] = (target[symbol] ?? 0) + qty;
	}
	return { balances, hold };
}

/** "Twin" assets of the same price in the Balance response: ETH2.S (staked ETH) is worth ETH. */
const BALANCE_ALIASES: Record<string, string> = { ETH2: 'ETH' };

/** Detailed balances (held + pending). Throws if the network/CORS blocks. */
export async function fetchBalanceDetailed(keysOverride?: KrakenKeys): Promise<NormalizedBalances> {
	if (!keysOverride && !hasKeys()) throw new Error('no-keys');
	return normalizeBalances(await privateCall<KrakenBalanceResult>('Balance', {}, keysOverride));
}

/**
 * Account balances → { readable symbol: quantity } (assets > 0, « .HOLD »
 * excluded). Uses the keys stored on the server side, unless `keysOverride` is
 * given (testing entered keys without storing them).
 */
export async function fetchBalance(keysOverride?: KrakenKeys): Promise<Record<string, number>> {
	return (await fetchBalanceDetailed(keysOverride)).balances;
}
