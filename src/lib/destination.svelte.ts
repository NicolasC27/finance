import { describeFailure, fetchLocal } from './localApi';
import { findPlaces } from './weather.svelte';
import { cleanQuery, pickPlace, type DailyWeather, type Place, type Weather } from './weather';

/**
 * Weather and clock of a trip's destination, app side: the names of the destination go once to
 * the geocoder (through the local server, like the home town; the destination, then its first
 * place when it names several, then the country), then the weather of the place found is read
 * again every 20 minutes while a page asks for it. A failure keeps what is known and is retried
 * five minutes later. One entry per destination, raw state replaced on change.
 */

const FRESH_MS = 20 * 60_000;
const DAILY_FRESH_MS = 60 * 60_000;
const RETRY_MS = 5 * 60_000;

export interface DestinationInfo {
	/** Place found by the geocoder, null when it knows none. */
	place: Place | null;
	weather: Weather | null;
	/** Time of the last attempt. */
	at: number;
	/** Why the last attempt failed, '' when it succeeded. */
	error: string;
	/** 16-day forecast, asked only for the days of a trip close to departure; null until then. */
	daily: DailyWeather[] | null;
	/** Time of the last forecast attempt (0 = never). */
	dailyAt: number;
}

const update = (key: string, patch: Partial<DestinationInfo>): void => {
	const current = destinationState.info[key] ?? { place: null, weather: null, at: 0, error: '', daily: null, dailyAt: 0 };
	destinationState.info = { ...destinationState.info, [key]: { ...current, ...patch } };
};

class DestinationState {
	info = $state.raw<Record<string, DestinationInfo>>({});
}

export const destinationState = new DestinationState();

const inflight = new Map<string, Promise<void>>();

/** Key of a trip's destination in the state, from the names tried for it (destination, its first place, country). */
export const destinationKey = (queries: readonly string[]): string => queries.map((q) => cleanQuery(q)?.toLowerCase() ?? '').filter(Boolean).join('|');

/** Looks the names up in turn (once) and refreshes the weather of the place found when older than 20 minutes. */
export function ensureDestination(queries: readonly string[], country: string): Promise<void> {
	const names = queries.map((q) => cleanQuery(q)).filter((q): q is string => q !== null);
	const key = destinationKey(names);
	if (!key) return Promise.resolve();
	const current = destinationState.info[key];
	if (current && Date.now() - current.at < (current.error ? RETRY_MS : FRESH_MS)) return Promise.resolve();
	const running = inflight.get(key);
	if (running) return running;
	const job = (async () => {
		let place = current?.place ?? null;
		let weather = current?.weather ?? null;
		let error = '';
		try {
			for (const name of names) {
				if (place) break;
				place = pickPlace(await findPlaces(name), country);
			}
			if (!place) error = 'lieu introuvable';
			else {
				const body = await fetchLocal<{ weather?: Weather }>(`/__weather?lat=${place.lat}&lon=${place.lon}`);
				weather = body.weather ?? weather;
			}
		} catch (e) {
			error = describeFailure(e);
		}
		update(key, { place, weather, at: Date.now(), error });
	})().finally(() => inflight.delete(key));
	inflight.set(key, job);
	return job;
}

/** Reads the 16-day forecast of the place (found first when needed), at most once an hour; a failure is retried after five minutes. */
export function ensureDaily(queries: readonly string[], country: string): Promise<void> {
	const key = destinationKey(queries);
	if (!key) return Promise.resolve();
	const dailyKey = `${key}#daily`;
	const running = inflight.get(dailyKey);
	if (running) return running;
	const job = (async () => {
		await ensureDestination(queries, country);
		const current = destinationState.info[key];
		if (!current?.place) return;
		if (current.dailyAt && Date.now() - current.dailyAt < (current.daily ? DAILY_FRESH_MS : RETRY_MS)) return;
		try {
			const body = await fetchLocal<{ daily?: DailyWeather[] }>(`/__weather/daily?lat=${current.place.lat}&lon=${current.place.lon}`);
			update(key, { daily: Array.isArray(body.daily) ? body.daily : current.daily, dailyAt: Date.now() });
		} catch {
			update(key, { dailyAt: Date.now() });
		}
	})().finally(() => inflight.delete(dailyKey));
	inflight.set(dailyKey, job);
	return job;
}
