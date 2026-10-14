import { fetchLocal, LOCAL_HEADERS } from './localApi';
import { updatePlace } from './trips.svelte';
import { countryOf } from './countries';
import { mainPlace, type Trip } from './trips';
import type { GeoHit, TileLayer, TileStyle } from './geo';

/**
 * Map of a trip, app side: a place of a day plan is located once through the local server (its
 * name with the destination as context, within the country when known) and the coordinates are
 * stored on the place; the tiles of the map are fetched through the server too, with its access
 * header (an <img src> could not send it), and kept as blob URLs for the session.
 */

const TILES_KEPT = 600;

class GeoState {
	/** Place id → being located, or not found by the last attempt; a located place is absent. */
	locating = $state.raw<Record<string, 'pending' | 'none'>>({});
}

export const geoState = new GeoState();

const mark = (placeId: string, state: 'pending' | 'none' | null): void => {
	const next = { ...geoState.locating };
	if (state) next[placeId] = state;
	else delete next[placeId];
	geoState.locating = next;
};

/** Finds the place on the map and stores its coordinates; false when the geocoder knows nothing by that name. */
export async function locatePlace(trip: Pick<Trip, 'id' | 'destination' | 'country'>, dayIndex: number, placeId: string, query: string, countryCode = ''): Promise<boolean> {
	const q = query.replace(/\s+/g, ' ').trim();
	if (!q) return false;
	const cc = countryOf(trip.country)?.code.toLowerCase() ?? countryCode.toLowerCase();
	const near = mainPlace(trip.destination);
	mark(placeId, 'pending');
	try {
		const body = await fetchLocal<{ hit?: GeoHit | null }>(`/__geo?q=${encodeURIComponent(q)}&near=${encodeURIComponent(near)}&cc=${encodeURIComponent(cc)}`);
		const hit = body.hit;
		if (hit && Number.isFinite(hit.lat) && Number.isFinite(hit.lon)) {
			updatePlace(trip.id, dayIndex, placeId, { lat: hit.lat, lon: hit.lon });
			mark(placeId, null);
			return true;
		}
	} catch {
		// the server said why; the place just stays off the map
	}
	mark(placeId, 'none');
	return false;
}

const tiles = new Map<string, Promise<string>>();

/** Blob URL of a tile, fetched once per style, layer, zoom and position; the oldest are released beyond 600. */
export function tileBlob(style: TileStyle, layer: TileLayer, z: number, x: number, y: number): Promise<string> {
	const key = `${style}/${layer}/${z}/${x}/${y}`;
	const known = tiles.get(key);
	if (known) return known;
	const job = fetch(`/__tile?s=${style}&l=${layer}&z=${z}&x=${x}&y=${y}`, { headers: LOCAL_HEADERS }).then(async (res) => {
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		return URL.createObjectURL(await res.blob());
	});
	job.catch(() => tiles.delete(key));
	tiles.set(key, job);
	while (tiles.size > TILES_KEPT) {
		const [oldest, old] = tiles.entries().next().value!;
		tiles.delete(oldest);
		void old.then(
			(url) => URL.revokeObjectURL(url),
			() => {}
		);
	}
	return job;
}
