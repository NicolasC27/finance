/**
 * Geometry of the trip map, pure and import-free (the server loads this file too): the Web
 * Mercator projection behind a slippy map (world pixels, tile indices), the view that fits a set
 * of places, the distance between places, and the reading of a Nominatim answer. Nothing here
 * touches the network or the DOM.
 */

export interface LonLat {
	lon: number;
	lat: number;
}

export interface Point {
	x: number;
	y: number;
}

export interface MapView {
	center: LonLat;
	/** Integer zoom level, 0 = the whole world in one tile. */
	zoom: number;
}

export interface MapTile {
	/** Unique in a view, even when the world repeats across the antimeridian. */
	key: string;
	z: number;
	x: number;
	y: number;
	/** Position in the viewport, pixels from its top-left corner. */
	left: number;
	top: number;
}

export type TileStyle = 'light' | 'dark';
/** The basemap comes in two layers: the drawing, then the names over it (and over the lines of the plan). */
export type TileLayer = 'base' | 'labels';

export interface TileRequest {
	style: TileStyle;
	layer: TileLayer;
	z: number;
	x: number;
	y: number;
}

/** What the geocoder found for a place name. */
export interface GeoHit {
	lat: number;
	lon: number;
	/** Full address as the geocoder writes it, for a tooltip. */
	label: string;
}

export const TILE_SIZE = 256;
export const MIN_ZOOM = 2;
/** The gray canvas basemaps stop at 16 (about 2 m per pixel: streets and their names). */
export const MAX_ZOOM = 16;
/** Zoom of the view fitted on several places, at most (two neighbours still get some context). */
const FIT_MAX_ZOOM = 16;
const SINGLE_ZOOM = 15;
const MAX_LAT = 85.05112878;
const EARTH_KM = 6371;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const round5 = (n: number) => Math.round(n * 100_000) / 100_000;

/** Width of the world in pixels at a zoom level. */
export const worldSize = (zoom: number): number => TILE_SIZE * 2 ** zoom;

/** A place has coordinates. */
export function isLocated<T extends { lat: number | null; lon: number | null }>(p: T): p is T & LonLat {
	return typeof p.lat === 'number' && typeof p.lon === 'number' && Number.isFinite(p.lat) && Number.isFinite(p.lon);
}

/** Position of a place in world pixels at a zoom level (Web Mercator). */
export function project(p: LonLat, zoom: number): Point {
	const size = worldSize(zoom);
	const lat = (clamp(p.lat, -MAX_LAT, MAX_LAT) * Math.PI) / 180;
	return { x: ((p.lon + 180) / 360) * size, y: ((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * size };
}

/** Place at a world pixel position (the inverse of `project`); the longitude wraps around. */
export function unproject(p: Point, zoom: number): LonLat {
	const size = worldSize(zoom);
	const lon = (p.x / size) * 360 - 180;
	const n = Math.PI - (2 * Math.PI * p.y) / size;
	return { lon: ((((lon + 180) % 360) + 360) % 360) - 180, lat: (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))) };
}

/** The view showing all the places with a margin, null without places or size; one place is shown from the street level. */
export function fitView(points: readonly LonLat[], width: number, height: number, padding = 48): MapView | null {
	if (!points.length || width <= 0 || height <= 0) return null;
	if (points.length === 1) return { center: { lon: points[0]!.lon, lat: points[0]!.lat }, zoom: SINGLE_ZOOM };
	const at0 = points.map((p) => project(p, 0));
	const minX = Math.min(...at0.map((p) => p.x));
	const maxX = Math.max(...at0.map((p) => p.x));
	const minY = Math.min(...at0.map((p) => p.y));
	const maxY = Math.max(...at0.map((p) => p.y));
	const innerW = Math.max(1, width - 2 * padding);
	const innerH = Math.max(1, height - 2 * padding);
	const scale = Math.min(innerW / Math.max(maxX - minX, 1e-9), innerH / Math.max(maxY - minY, 1e-9));
	const zoom = clamp(Math.floor(Math.log2(scale)), MIN_ZOOM, FIT_MAX_ZOOM);
	return { center: unproject({ x: (minX + maxX) / 2, y: (minY + maxY) / 2 }, 0), zoom };
}

/** The tiles covering a viewport centred on the view, with their position in it. */
export function visibleTiles(view: MapView, width: number, height: number): MapTile[] {
	if (width <= 0 || height <= 0) return [];
	const z = clamp(Math.round(view.zoom), 0, MAX_ZOOM);
	const n = 2 ** z;
	const c = project(view.center, z);
	const left = c.x - width / 2;
	const top = c.y - height / 2;
	const x0 = Math.floor(left / TILE_SIZE);
	const x1 = Math.floor((left + width) / TILE_SIZE);
	const y0 = Math.max(0, Math.floor(top / TILE_SIZE));
	const y1 = Math.min(n - 1, Math.floor((top + height) / TILE_SIZE));
	const out: MapTile[] = [];
	for (let y = y0; y <= y1; y++) {
		for (let x = x0; x <= x1; x++) {
			out.push({ key: `${z}/${x}/${y}`, z, x: ((x % n) + n) % n, y, left: x * TILE_SIZE - left, top: y * TILE_SIZE - top });
		}
	}
	return out;
}

/** Great-circle distance in km. */
export function distanceKm(a: LonLat, b: LonLat): number {
	const rad = Math.PI / 180;
	const dLat = (b.lat - a.lat) * rad;
	const dLon = (b.lon - a.lon) * rad;
	const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
	return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Length of the path through the points in order, in km rounded to 0.1. */
export function pathKm(points: readonly LonLat[]): number {
	let total = 0;
	for (let i = 1; i < points.length; i++) total += distanceKm(points[i - 1]!, points[i]!);
	return Math.round(total * 10) / 10;
}

/** A place name as typed, cleaned for the geocoder: 1 to 120 characters, no control character. */
export function cleanGeoQuery(q: unknown): string | null {
	if (typeof q !== 'string') return null;
	const text = q.normalize('NFC').replace(/\s+/g, ' ').trim();
	// eslint-disable-next-line no-control-regex
	return text.length >= 1 && text.length <= 120 && !/[\u0000-\u001f\u007f]/.test(text) ? text : null;
}

/** An ISO 3166-1 alpha-2 code in lower case, '' when the value is not one. */
export function cleanCountryCode(cc: unknown): string {
	return typeof cc === 'string' && /^[a-z]{2}$/i.test(cc) ? cc.toLowerCase() : '';
}

/** The first usable result of a Nominatim search (`format=jsonv2`), null when none. */
export function parseNominatim(json: unknown): GeoHit | null {
	if (!Array.isArray(json)) return null;
	for (const item of json as { lat?: unknown; lon?: unknown; display_name?: unknown }[]) {
		const lat = Number(item?.lat);
		const lon = Number(item?.lon);
		if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
			return { lat: round5(lat), lon: round5(lon), label: typeof item.display_name === 'string' ? item.display_name.slice(0, 160) : '' };
		}
	}
	return null;
}

/** Tile parameters read from a query string, null unless they name an existing tile of a known style and layer. */
export function cleanTile(s: unknown, l: unknown, z: unknown, x: unknown, y: unknown): TileRequest | null {
	if (s !== 'light' && s !== 'dark') return null;
	if (l !== 'base' && l !== 'labels') return null;
	const zi = Number(z);
	const xi = Number(x);
	const yi = Number(y);
	if (!Number.isInteger(zi) || !Number.isInteger(xi) || !Number.isInteger(yi) || zi < 0 || zi > MAX_ZOOM) return null;
	const n = 2 ** zi;
	if (xi < 0 || xi >= n || yi < 0 || yi >= n) return null;
	return { style: s, layer: l, z: zi, x: xi, y: yi };
}
