import { persistJson } from './storage';
import { atlasCode, sanitizeVisits, type Visit } from './atlas';
import { newId } from './trips';

/**
 * Manual visits of the atlas (`budget:atlas`): trips from before the app, a country and a year
 * each. Raw state replaced on change; the trips themselves are read from trips.svelte.ts.
 */

const ATLAS_KEY = 'budget:atlas';

function load(): Visit[] {
	if (typeof localStorage === 'undefined') return [];
	try {
		return sanitizeVisits(JSON.parse(localStorage.getItem(ATLAS_KEY) ?? '[]'));
	} catch {
		return [];
	}
}

class AtlasState {
	visits = $state.raw<Visit[]>(load());
}

export const atlasState = new AtlasState();

function persist(): void {
	if (typeof localStorage !== 'undefined') persistJson(ATLAS_KEY, atlasState.visits);
}

/** Adds a visit when the country is known; returns it, or null. */
export function addVisit(country: string, year: number): Visit | null {
	const name = country.trim();
	if (!atlasCode(name) || !Number.isInteger(year) || year < 1900 || year > 2100) return null;
	const visit: Visit = { id: newId('visit'), country: name, year };
	atlasState.visits = [...atlasState.visits, visit];
	persist();
	return visit;
}

export function removeVisit(id: string): void {
	atlasState.visits = atlasState.visits.filter((v) => v.id !== id);
	persist();
}
