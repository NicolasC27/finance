import { parseForecast, parsePlaces, type Place, type Weather } from '../src/lib/weather.ts';

/**
 * Weather through the local server, so the browser never calls another site. Two calls leave,
 * both without key or account: the town name typed in Réglages goes to the Open-Meteo geocoder
 * (to find the place), then only the coordinates of the chosen place go to the forecast API.
 * Forecasts are cached 20 minutes and kept as a fallback when Open-Meteo fails; calls time out
 * after 8 seconds.
 */

const GEOCODING = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST = 'https://api.open-meteo.com/v1/forecast';
const TIMEOUT_MS = 8_000;
const CACHE_MS = 20 * 60_000;
const CACHE_MAX = 50;

const cache = new Map<string, { at: number; weather: Weather }>();

const COORDINATE = /^-?\d{1,3}(\.\d+)?$/;

/** Latitude and longitude read from a query string (decimal numbers only), rounded to 2 decimals (about 1 km). */
export function cleanCoordinates(lat: unknown, lon: unknown): { lat: number; lon: number } | null {
	if (typeof lat !== 'string' || typeof lon !== 'string' || !COORDINATE.test(lat.trim()) || !COORDINATE.test(lon.trim())) return null;
	const la = Number(lat);
	const lo = Number(lon);
	if (Math.abs(la) > 90 || Math.abs(lo) > 180) return null;
	return { lat: Math.round(la * 100) / 100, lon: Math.round(lo * 100) / 100 };
}

async function getJson(url: string): Promise<unknown> {
	const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: 'application/json' } });
	if (!res.ok) throw new Error(`Open-Meteo : HTTP ${res.status}`);
	return res.json();
}

/** Up to five places matching a town name, in French. */
export async function searchPlaces(query: string): Promise<Place[]> {
	const url = `${GEOCODING}?name=${encodeURIComponent(query)}&count=5&language=fr&format=json`;
	return parsePlaces(await getJson(url));
}

/** Current weather and the day's range at a place: from the cache when fresh, from Open-Meteo otherwise, the stale entry when that fails. */
export async function weatherAt(lat: number, lon: number, now = Date.now()): Promise<Weather> {
	const key = `${lat},${lon}`;
	const hit = cache.get(key);
	if (hit && now - hit.at < CACHE_MS) return hit.weather;
	const url = `${FORECAST}?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto&forecast_days=1`;
	let weather: Weather | null;
	try {
		weather = parseForecast(await getJson(url));
	} catch (e) {
		if (hit) return hit.weather;
		throw e;
	}
	if (!weather) {
		if (hit) return hit.weather;
		throw new Error('Open-Meteo : réponse incomplète');
	}
	cache.delete(key);
	cache.set(key, { at: now, weather });
	while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
	return weather;
}
