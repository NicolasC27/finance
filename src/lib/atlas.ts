import { WORLD } from './worldMap';
import { countryOf } from './countries';
import { plannedTotal, tripDays, type Trip } from './trips';

/**
 * Atlas (pure, testable): which countries the trips and the manual entries make « visited »,
 * which ones the coming trips make « wished », and the figures: countries and continents,
 * trips and nights per year, what a trip and a night cost on average, the cheapest and the
 * dearest destination. Countries are matched by their French name on the map or by the aliases
 * of the practical table.
 */

/** A trip from before the app, entered by hand. */
export interface Visit {
	id: string;
	country: string;
	year: number;
}

export type AtlasStatus = 'visited' | 'wish';

export interface AtlasEntry {
	code: string;
	name: string;
	continent: string;
	status: AtlasStatus;
	years: number[];
	/** Trip names (manual entries read « saisi »). */
	trips: string[];
}

const fold = (s: string) => s.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[-’']/g, ' ').replace(/\s+/g, ' ');

const byName = new Map<string, string>();
for (const c of WORLD) byName.set(fold(c.name), c.code);
const byCode = new Map(WORLD.map((c) => [c.code, c]));

/** ISO code of a country as typed, null when neither the map nor the practical table knows it. */
export function atlasCode(name: string): string | null {
	return byName.get(fold(name)) ?? countryOf(name)?.code ?? null;
}

/** The trip is over: back before today, or marked finished. */
export const isPastTrip = (trip: Pick<Trip, 'end' | 'status'>, today: string): boolean => trip.status === 'termine' || (trip.end !== '' && trip.end < today);

/** One entry per country touched by a trip, a manual visit or a wish; a country both visited and wished counts as visited. */
export function atlasEntries(trips: readonly Trip[], visits: readonly Visit[], today: string, wishes: readonly { name: string; country: string }[] = []): Map<string, AtlasEntry> {
	const out = new Map<string, AtlasEntry>();
	const add = (code: string, status: AtlasStatus, year: number | null, label: string) => {
		const country = byCode.get(code);
		if (!country) return;
		const entry = out.get(code) ?? { code, name: country.name, continent: country.continent, status, years: [], trips: [] };
		if (status === 'visited') entry.status = 'visited';
		if (year !== null && !entry.years.includes(year)) entry.years.push(year);
		if (!entry.trips.includes(label)) entry.trips.push(label);
		out.set(code, entry);
	};
	for (const t of trips) {
		const code = atlasCode(t.country);
		if (!code) continue;
		add(code, isPastTrip(t, today) ? 'visited' : 'wish', t.start ? Number(t.start.slice(0, 4)) : null, t.name);
	}
	for (const v of visits) {
		const code = atlasCode(v.country);
		if (code) add(code, 'visited', v.year, 'saisi');
	}
	for (const w of wishes) {
		const code = atlasCode(w.country) ?? atlasCode(w.name);
		if (code) add(code, 'wish', null, `envie : ${w.name}`);
	}
	for (const e of out.values()) e.years.sort((a, b) => a - b);
	return out;
}

export interface AtlasYear {
	year: number;
	trips: number;
	nights: number;
}

export interface AtlasStats {
	countries: number;
	continents: number;
	/** Past trips with dates, by year of departure, latest first. */
	perYear: AtlasYear[];
	/** Averages over past trips whose spending is known (null when none). */
	perTrip: number | null;
	perNight: number | null;
	cheapest: { name: string; perNight: number } | null;
	dearest: { name: string; perNight: number } | null;
}

const round = (n: number) => Math.round(n * 100) / 100;

/** Figures of the atlas; `spentOf` gives what a past trip cost (its period's actual spending, the plan when nothing is known). */
export function atlasStats(trips: readonly Trip[], visits: readonly Visit[], today: string, spentOf: (trip: Trip) => number): AtlasStats {
	const entries = atlasEntries(trips, visits, today);
	const visited = [...entries.values()].filter((e) => e.status === 'visited');
	const past = trips.filter((t) => isPastTrip(t, today) && t.start);
	const years = new Map<number, AtlasYear>();
	for (const t of past) {
		const year = Number(t.start.slice(0, 4));
		const y = years.get(year) ?? { year, trips: 0, nights: 0 };
		y.trips++;
		y.nights += Math.max(1, tripDays(t) - 1);
		years.set(year, y);
	}
	const costed = past.map((t) => ({ name: t.name, nights: Math.max(1, tripDays(t) - 1), spent: spentOf(t) || plannedTotal(t) })).filter((t) => t.spent > 0);
	const perNightOf = (t: (typeof costed)[number]) => round(t.spent / t.nights);
	const sorted = [...costed].sort((a, b) => perNightOf(a) - perNightOf(b));
	return {
		countries: visited.length,
		continents: new Set(visited.map((e) => e.continent)).size,
		perYear: [...years.values()].sort((a, b) => b.year - a.year),
		perTrip: costed.length ? round(costed.reduce((s, t) => s + t.spent, 0) / costed.length) : null,
		perNight: costed.length ? round(costed.reduce((s, t) => s + t.spent, 0) / costed.reduce((s, t) => s + t.nights, 0)) : null,
		cheapest: sorted.length ? { name: sorted[0]!.name, perNight: perNightOf(sorted[0]!) } : null,
		dearest: sorted.length > 1 ? { name: sorted[sorted.length - 1]!.name, perNight: perNightOf(sorted[sorted.length - 1]!) } : null
	};
}

/** Manual visits read back: a known country and a plausible year. */
export function sanitizeVisits(raw: unknown): Visit[] {
	if (!Array.isArray(raw)) return [];
	const out: Visit[] = [];
	for (const v of raw as Partial<Visit>[]) {
		if (!v || typeof v !== 'object' || typeof v.id !== 'string' || typeof v.country !== 'string' || typeof v.year !== 'number') continue;
		if (!atlasCode(v.country) || v.year < 1900 || v.year > 2100) continue;
		out.push({ id: v.id, country: v.country, year: Math.round(v.year) });
	}
	return out;
}
