/**
 * Crypto news for the top held asset (SPEC v14 §G).
 *
 * Free public source: CryptoCompare min-api v2 (no key).
 * DEFENSIVE fetch: 8 s timeout (AbortController), 30 min localStorage cache,
 * 4 headlines max. Offline or error → empty list, the section is simply
 * hidden: no error bubbles up, never a console.error.
 */

export const NEWS_KEY = 'budget:crypto-news';
const TTL_MS = 30 * 60 * 1000; // 30 min
const TIMEOUT_MS = 8_000;
const MAX_ITEMS = 4;

export interface CryptoNewsItem {
	id: string;
	title: string;
	url: string;
	source: string;
	/** Publication timestamp in ms. */
	publishedAt: number;
}

interface NewsCache {
	at: number;
	category: string;
	items: CryptoNewsItem[];
}

/** Documented response of the /data/v2/news/ endpoint (used fields only). */
interface CryptoCompareNewsResponse {
	Data?: { id?: string; title?: string; url?: string; source?: string; published_on?: number }[];
}

/**
 * Safe external link: http(s) only. The URL comes from a third-party API; a
 * `javascript:` URL would run in the origin that stores the Kraken secret.
 */
export function isSafeHttpUrl(url: unknown): url is string {
	if (typeof url !== 'string') return false;
	try {
		const u = new URL(url);
		return u.protocol === 'https:' || u.protocol === 'http:';
	} catch {
		return false;
	}
}

/** Reads the news cache; links from an older cache are re-checked on read. */
export function loadNewsCache(): NewsCache | null {
	if (typeof localStorage === 'undefined') return null;
	try {
		const raw = localStorage.getItem(NEWS_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as NewsCache;
		if (!parsed || typeof parsed.at !== 'number' || !Array.isArray(parsed.items)) return null;
		return { ...parsed, items: parsed.items.filter((n) => n && isSafeHttpUrl(n.url)) };
	} catch {
		return null;
	}
}

/** Saves the news cache; when the quota is exceeded the cache is simply lost. */
function saveNewsCache(cache: NewsCache): void {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(NEWS_KEY, JSON.stringify(cache));
	} catch {
	}
}

/**
 * Fetches the symbol's headlines (e.g. « BTC »). Serves the cache when fresh;
 * on a network failure (offline, timeout, HTTP error), serves the cache of the
 * right category EVEN WHEN STALE, otherwise []. Never throws.
 */
export async function fetchCryptoNews(category: string): Promise<CryptoNewsItem[]> {
	const cat = category.trim().toUpperCase();
	if (!cat) return [];
	const cached = loadNewsCache();
	if (cached && cached.category === cat && Date.now() - cached.at < TTL_MS) return cached.items;

	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
	try {
		const res = await fetch(`https://min-api.cryptocompare.com/data/v2/news/?categories=${encodeURIComponent(cat)}`, {
			signal: ctrl.signal
		});
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const json = (await res.json()) as CryptoCompareNewsResponse;
		const items: CryptoNewsItem[] = (json.Data ?? [])
			.filter((n) => typeof n.title === 'string' && isSafeHttpUrl(n.url) && typeof n.published_on === 'number')
			.slice(0, MAX_ITEMS)
			.map((n) => ({
				id: typeof n.id === 'string' ? n.id : n.url!,
				title: n.title!,
				url: n.url!,
				source: typeof n.source === 'string' && n.source ? n.source : 'cryptocompare',
				publishedAt: n.published_on! * 1000
			}));
		saveNewsCache({ at: Date.now(), category: cat, items });
		return items;
	} catch {
		return cached && cached.category === cat ? cached.items : [];
	} finally {
		clearTimeout(timer);
	}
}

/** Compact French relative date: « il y a 20 min », « il y a 3 h », « il y a 2 j ». */
export function relativeAge(publishedAt: number, now = Date.now()): string {
	const minutes = Math.max(0, Math.round((now - publishedAt) / 60_000));
	if (minutes < 1) return "à l'instant";
	if (minutes < 60) return `il y a ${minutes} min`;
	const hours = Math.round(minutes / 60);
	if (hours < 24) return `il y a ${hours} h`;
	const days = Math.round(hours / 24);
	return `il y a ${days} j`;
}
