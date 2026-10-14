import { parseEntityPhoto, parseSearchItem, PHOTO_WIDTHS, type Photo, type PhotoWidth } from '../src/lib/photo.ts';

/**
 * Destination photos through the local server, so the browser never calls another site. The
 * place named in a trip goes to Wikidata (the item whose French article has that name, and its
 * Wikivoyage banner), to the French Wikipedia search when no article has exactly that name, and
 * the chosen file comes from Wikimedia Commons at the width asked. No key or account. Everything
 * is cached in memory: lookups for a day, images while they fit in 40 MB. Calls time out after
 * 8 seconds (16 for an image) and the API calls are spaced out, as Wikimedia asks of anonymous
 * clients.
 */

const WIKIDATA = 'https://www.wikidata.org/w/api.php';
const WIKIPEDIA = 'https://fr.wikipedia.org/w/api.php';
const COMMONS_FILE = 'https://commons.wikimedia.org/wiki/Special:FilePath/';
const USER_AGENT = 'Budget/1.0 (personal finance app running locally)';
const TIMEOUT_MS = 8_000;
const SPACING_MS = 300;
const LOOKUP_MS = 24 * 3_600_000;
const LOOKUP_MAX = 200;
const IMAGE_MAX_BYTES = 8 * 1024 * 1024;
const IMAGE_CACHE_BYTES = 40 * 1024 * 1024;

const lookups = new Map<string, { at: number; photo: Photo | null }>();
const images = new Map<string, { bytes: Buffer; type: string }>();
let imageBytes = 0;
let queue: Promise<unknown> = Promise.resolve();

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** API calls one at a time, 300 ms apart. */
function spaced<T>(job: () => Promise<T>): Promise<T> {
	const run = queue.then(job, job);
	queue = run.then(
		() => sleep(SPACING_MS),
		() => sleep(SPACING_MS)
	);
	return run;
}

async function getJson(url: string): Promise<unknown> {
	const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: 'application/json', 'user-agent': USER_AGENT } });
	if (!res.ok) throw new Error(`Wikimedia : HTTP ${res.status}`);
	return res.json();
}

/** One of the widths the proxy serves, read from a query string. */
export function cleanWidth(w: unknown): PhotoWidth | null {
	const n = Number(w);
	return (PHOTO_WIDTHS as readonly number[]).includes(n) ? (n as PhotoWidth) : null;
}

async function lookup(query: string): Promise<Photo | null> {
	const direct = parseEntityPhoto(await spaced(() => getJson(`${WIKIDATA}?action=wbgetentities&format=json&sites=frwiki&titles=${encodeURIComponent(query)}&props=claims&normalize=1`)));
	if (direct) return direct;
	const item = parseSearchItem(await spaced(() => getJson(`${WIKIPEDIA}?action=query&format=json&formatversion=2&generator=search&gsrsearch=${encodeURIComponent(query)}&gsrlimit=1&gsrnamespace=0&prop=pageprops&ppprop=wikibase_item`)));
	if (!item) return null;
	return parseEntityPhoto(await spaced(() => getJson(`${WIKIDATA}?action=wbgetentities&format=json&ids=${item}&props=claims`)), true);
}

/** Photo of a place (its Wikivoyage banner, else a view of it), null when none; from the cache for a day. */
export async function findPhoto(query: string, now = Date.now()): Promise<Photo | null> {
	const key = query.toLowerCase();
	const hit = lookups.get(key);
	if (hit && now - hit.at < LOOKUP_MS) return hit.photo;
	const photo = await lookup(query);
	lookups.delete(key);
	lookups.set(key, { at: now, photo });
	while (lookups.size > LOOKUP_MAX) lookups.delete(lookups.keys().next().value!);
	return photo;
}

async function readCapped(res: Response, max: number): Promise<Buffer> {
	const chunks: Uint8Array[] = [];
	let size = 0;
	for await (const chunk of res.body as AsyncIterable<Uint8Array>) {
		size += chunk.length;
		if (size > max) throw new Error('image trop lourde');
		chunks.push(chunk);
	}
	return Buffer.concat(chunks);
}

/** Bytes and content type of a Commons file rendered at one of the accepted widths, kept while the cache fits. */
export async function photoBytes(file: string, width: PhotoWidth): Promise<{ bytes: Buffer; type: string }> {
	const key = `${width}:${file}`;
	const hit = images.get(key);
	if (hit) {
		images.delete(key);
		images.set(key, hit);
		return hit;
	}
	const res = await fetch(`${COMMONS_FILE}${encodeURIComponent(file)}?width=${width}`, { signal: AbortSignal.timeout(TIMEOUT_MS * 2), headers: { 'user-agent': USER_AGENT } });
	if (!res.ok) throw new Error(`Wikimedia Commons : HTTP ${res.status}`);
	const type = res.headers.get('content-type') ?? '';
	if (!type.startsWith('image/')) throw new Error('Wikimedia Commons : pas une image');
	const entry = { bytes: await readCapped(res, IMAGE_MAX_BYTES), type };
	images.set(key, entry);
	imageBytes += entry.bytes.length;
	while (imageBytes > IMAGE_CACHE_BYTES && images.size > 1) {
		const [oldest, value] = images.entries().next().value!;
		images.delete(oldest);
		imageBytes -= value.bytes.length;
	}
	return entry;
}
