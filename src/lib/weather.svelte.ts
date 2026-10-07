import { persistJson } from './storage';
import { describeFailure, fetchLocal } from './localApi';
import { isPlace, type Place, type Weather } from './weather';

/**
 * Weather, app side: the place chosen in Réglages (persisted), the current weather read from the
 * local server (which alone calls Open-Meteo) and refreshed every 30 minutes while a place is set.
 * A failed refresh keeps the last reading and says so; one retry follows a minute later, and
 * another when the browser comes back online.
 */

const PLACE_KEY = 'budget:weather-place';
const REFRESH_MS = 30 * 60_000;
const RETRY_MS = 60_000;

function loadPlace(): Place | null {
	if (typeof localStorage === 'undefined') return null;
	try {
		const raw = localStorage.getItem(PLACE_KEY);
		const p: unknown = raw ? JSON.parse(raw) : null;
		return isPlace(p) ? p : null;
	} catch {
		return null;
	}
}

export const weatherState = $state({
	/** Place chosen in Réglages, null until then (nothing is fetched). */
	place: loadPlace() as Place | null,
	/** Last weather read, null before the first answer; kept through a failed refresh. */
	weather: null as Weather | null,
	/** Why the last refresh failed ('' when it succeeded), shown in Réglages and the badge tooltip. */
	error: ''
});

let timer: ReturnType<typeof setInterval> | null = null;
let retry: ReturnType<typeof setTimeout> | null = null;
/** Number of the latest request: an older answer, late or failed, is ignored. */
let seq = 0;
let listening = false;

/** Reads the weather of the chosen place from the local server. */
export async function refreshWeather(): Promise<void> {
	const place = weatherState.place;
	if (!place) return;
	const id = ++seq;
	if (retry) clearTimeout(retry);
	retry = null;
	try {
		const body = await fetchLocal<{ weather?: Weather }>(`/__weather?lat=${place.lat}&lon=${place.lon}`);
		if (!body.weather) throw new Error('réponse incomplète du serveur local');
		if (id !== seq) return;
		weatherState.weather = body.weather;
		weatherState.error = '';
	} catch (e) {
		if (id !== seq) return;
		weatherState.error = describeFailure(e);
		retry = setTimeout(() => void refreshWeather(), RETRY_MS);
	}
}

/** Starts the refresh cycle (on mount, and whenever the place changes). */
export function initWeather(): void {
	if (timer) clearInterval(timer);
	timer = null;
	if (!listening && typeof window !== 'undefined') {
		window.addEventListener('online', () => void refreshWeather());
		listening = true;
	}
	if (!weatherState.place) return;
	void refreshWeather();
	timer = setInterval(() => void refreshWeather(), REFRESH_MS);
}

/** Chooses a place (null forgets it) and remembers it. */
export function setPlace(place: Place | null): void {
	seq++;
	weatherState.place = place;
	weatherState.weather = null;
	weatherState.error = '';
	if (place) persistJson(PLACE_KEY, place);
	else {
		try {
			localStorage.removeItem(PLACE_KEY);
		} catch {
		}
	}
	initWeather();
}

/** Places matching a town name, through the local server. */
export async function findPlaces(query: string): Promise<Place[]> {
	const body = await fetchLocal<{ places?: unknown }>(`/__weather/places?q=${encodeURIComponent(query)}`);
	return Array.isArray(body.places) ? body.places.filter(isPlace) : [];
}
