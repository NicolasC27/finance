import { parseNominatim, type GeoHit, type TileLayer, type TileRequest, type TileStyle } from '../src/lib/geo.ts';

/**
 * Map of a trip through the local server, so the browser never calls another site. A place typed
 * in a day plan goes to Nominatim (OpenStreetMap's geocoder) with the destination as context; the
 * map tiles come from Esri's gray canvas basemaps (ArcGIS Online, light or dark, the names in a
 * layer of their own), free without key with the attribution the map shows. Nominatim asks for
 * one request a second at most and an identifying User-Agent: the calls are queued 1.1 s apart
 * and the answers (found or not) are cached a day. Tiles are kept in memory while they fit in
 * 48 MB, six downloads at a time.
 */

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services';
const LAYERS: Record<TileStyle, Record<TileLayer, string>> = {
	light: { base: 'Canvas/World_Light_Gray_Base', labels: 'Canvas/World_Light_Gray_Reference' },
	dark: { base: 'Canvas/World_Dark_Gray_Base', labels: 'Canvas/World_Dark_Gray_Reference' }
};
const USER_AGENT = 'Budget/1.0 (personal finance app running locally)';
const TIMEOUT_MS = 8_000;
const GEOCODE_SPACING_MS = 1_100;
const GEOCODE_CACHE_MS = 24 * 3_600_000;
const GEOCODE_MAX = 300;
const TILE_MAX_BYTES = 512 * 1024;
const TILE_CACHE_BYTES = 48 * 1024 * 1024;
const TILE_PARALLEL = 6;

interface Tile {
	bytes: Buffer;
	type: string;
}

const geocodes = new Map<string, { at: number; hit: GeoHit | null }>();
const tiles = new Map<string, Tile>();
let tileBytesHeld = 0;
let queue: Promise<unknown> = Promise.resolve();
let active = 0;
const waiting: (() => void)[] = [];

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Geocoder calls one at a time, 1.1 s apart. */
function spaced<T>(job: () => Promise<T>): Promise<T> {
	const run = queue.then(job, job);
	queue = run.then(
		() => sleep(GEOCODE_SPACING_MS),
		() => sleep(GEOCODE_SPACING_MS)
	);
	return run;
}

/** At most six tile downloads at a time. */
async function limited<T>(job: () => Promise<T>): Promise<T> {
	if (active >= TILE_PARALLEL) await new Promise<void>((r) => waiting.push(r));
	active++;
	try {
		return await job();
	} finally {
		active--;
		waiting.shift()?.();
	}
}

async function search(query: string, cc: string): Promise<GeoHit | null> {
	const url = `${NOMINATIM}?format=jsonv2&limit=1&accept-language=fr&q=${encodeURIComponent(query)}${cc ? `&countrycodes=${cc}` : ''}`;
	const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: 'application/json', 'user-agent': USER_AGENT } });
	if (!res.ok) throw new Error(`Nominatim : HTTP ${res.status}`);
	return parseNominatim(await res.json());
}

/**
 * Coordinates of a place: searched with the destination appended (« Tour de Belém, Lisbonne »),
 * then alone within the country when that finds nothing; null when the geocoder knows neither.
 */
export async function geocode(query: string, near: string, cc: string, now = Date.now()): Promise<GeoHit | null> {
	const key = `${cc}|${near}|${query}`.toLowerCase();
	const known = geocodes.get(key);
	if (known && now - known.at < GEOCODE_CACHE_MS) return known.hit;
	let hit: GeoHit | null = null;
	for (const q of near && near.toLowerCase() !== query.toLowerCase() ? [`${query}, ${near}`, query] : [query]) {
		hit = await spaced(() => search(q, cc));
		if (hit) break;
	}
	geocodes.delete(key);
	geocodes.set(key, { at: now, hit });
	while (geocodes.size > GEOCODE_MAX) geocodes.delete(geocodes.keys().next().value!);
	return hit;
}

async function readCapped(res: Response, max: number): Promise<Buffer> {
	const chunks: Uint8Array[] = [];
	let size = 0;
	for await (const chunk of res.body as AsyncIterable<Uint8Array>) {
		size += chunk.length;
		if (size > max) throw new Error('tuile trop lourde');
		chunks.push(chunk);
	}
	return Buffer.concat(chunks);
}

/** Bytes and content type of a basemap tile, from the memory cache when it has them. */
export async function tileBytes(t: TileRequest): Promise<Tile> {
	const key = `${t.style}/${t.layer}/${t.z}/${t.x}/${t.y}`;
	const hit = tiles.get(key);
	if (hit) {
		tiles.delete(key);
		tiles.set(key, hit);
		return hit;
	}
	const tile = await limited(async () => {
		const res = await fetch(`${ESRI}/${LAYERS[t.style][t.layer]}/MapServer/tile/${t.z}/${t.y}/${t.x}`, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'user-agent': USER_AGENT } });
		if (!res.ok) throw new Error(`ArcGIS Online : HTTP ${res.status}`);
		const type = res.headers.get('content-type') ?? '';
		if (!type.startsWith('image/')) throw new Error('ArcGIS Online : pas une image');
		return { bytes: await readCapped(res, TILE_MAX_BYTES), type };
	});
	tiles.set(key, tile);
	tileBytesHeld += tile.bytes.length;
	while (tileBytesHeld > TILE_CACHE_BYTES && tiles.size > 1) {
		const [oldest, value] = tiles.entries().next().value!;
		tiles.delete(oldest);
		tileBytesHeld -= value.bytes.length;
	}
	return tile;
}
