import { cleanQuery } from './weather';
import { sanitizePacking, type PackItem } from './packing';

/**
 * Trips (pure, testable): a trip as a first-class object with its envelopes, booking checklist,
 * quotes and link hub. Dates are ISO (AAAA-MM-JJ). Money in euros. Everything the page shows is
 * derived here from the stored trip; the store (trips.svelte.ts) only persists and links trips to
 * vacation periods and goals.
 */

export type TripStatus = 'idee' | 'prevu' | 'reserve' | 'termine';

export const TRIP_STATUSES: readonly { id: TripStatus; label: string }[] = [
	{ id: 'idee', label: 'Idée' },
	{ id: 'prevu', label: 'Prévu' },
	{ id: 'reserve', label: 'Réservé' },
	{ id: 'termine', label: 'Terminé' }
];

export type EnvelopeId = 'transport' | 'hebergement' | 'repas' | 'activites' | 'assurance' | 'extras';

/** Envelopes of a trip; `subs` = subcategories of « Vacances » whose operations count as actual spending. */
export const ENVELOPES: readonly { id: EnvelopeId; label: string; subs: readonly string[] }[] = [
	{ id: 'transport', label: 'Transport', subs: ['vols', 'vac-transport'] },
	{ id: 'hebergement', label: 'Hébergement', subs: ['hebergement'] },
	{ id: 'repas', label: 'Repas & courses', subs: ['vac-alimentation'] },
	{ id: 'activites', label: 'Activités', subs: ['vac-loisirs'] },
	{ id: 'assurance', label: 'Assurance', subs: [] },
	{ id: 'extras', label: 'Extras', subs: ['sur-place'] }
];

export type ChecklistKind = 'acompte' | 'solde' | 'annulation' | 'passeport' | 'visa' | 'assurance' | 'voiture' | 'animaux' | 'courrier' | 'enregistrement' | 'libre';

export interface ChecklistItem {
	id: string;
	kind: ChecklistKind;
	label: string;
	/** Deadline, '' when the user has not set one. */
	date: string;
	done: boolean;
}

export interface Quote {
	id: string;
	/** Site or seller. */
	site: string;
	/** What was quoted (« Vol A/R Lyon–Lisbonne », « Appartement vieille ville »). */
	label: string;
	price: number;
	url: string;
	conditions: string;
	/** Day the price was seen. */
	date: string;
	envelope: EnvelopeId;
	bought: boolean;
}

/** A place of a day of the plan: what to see or do, where it is described, what it should cost. */
export interface TripPlace {
	id: string;
	name: string;
	url: string;
	/** Planned cost, null when free or unknown. */
	cost: number | null;
	envelope: EnvelopeId;
	/** Where it is on the map (geocoded from its name), null while unknown. */
	lat: number | null;
	lon: number | null;
}

/** A day of the plan, by position: the first entry is day 1 (its date comes from the trip's departure). */
export interface TripDay {
	id: string;
	title: string;
	notes: string;
	places: TripPlace[];
}

export interface Trip {
	id: string;
	name: string;
	destination: string;
	/** Country, '' when unknown; « France » and the EU change the checklist (no passport line). */
	country: string;
	start: string;
	end: string;
	travellers: number;
	status: TripStatus;
	notes: string;
	/** Place whose photo illustrates the trip, '' = the destination, then the country. */
	photo: string;
	/** Vacation period reclassifying the spending (created from the dates), null without dates. */
	periodId: string | null;
	/** Savings goal funding the trip, null when none. */
	goalId: string | null;
	/** Planned amount per envelope (missing = 0). */
	envelopes: Partial<Record<EnvelopeId, number>>;
	checklist: ChecklistItem[];
	quotes: Quote[];
	/** Day-by-day plan, day 1 first; without dates these are day ideas. */
	days: TripDay[];
	/** Packing list. */
	packing: PackItem[];
	createdAt: number;
}

export interface TripInput {
	name: string;
	destination: string;
	country: string;
	start: string;
	end: string;
	travellers: number;
	status: TripStatus;
	notes: string;
	photo: string;
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY = 86_400_000;

export const newId = (prefix: string): string => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

/** Day shifted by `n` days (ISO in, ISO out). */
export function shiftDays(iso: string, n: number): string {
	return new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
}

/** Inclusive number of days of the trip, 0 without both dates. */
export function tripDays(trip: Pick<Trip, 'start' | 'end'>): number {
	if (!ISO_RE.test(trip.start) || !ISO_RE.test(trip.end)) return 0;
	return Math.max(1, Math.round((Date.parse(`${trip.end}T00:00:00Z`) - Date.parse(`${trip.start}T00:00:00Z`)) / DAY) + 1);
}

/** Days until departure (negative once left), null without a start date. */
export function daysUntil(trip: Pick<Trip, 'start'>, today: string): number | null {
	if (!ISO_RE.test(trip.start)) return null;
	return Math.round((Date.parse(`${trip.start}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY);
}

export type TripPhase = { kind: 'idea' } | { kind: 'before'; days: number } | { kind: 'during'; day: number; days: number } | { kind: 'after'; days: number };

/** Where the trip stands today: an idea without dates, before departure (days left), on the spot (day n of N), or back (days since the return). */
export function tripPhase(trip: Pick<Trip, 'start' | 'end'>, today: string): TripPhase {
	const until = daysUntil(trip, today);
	if (until === null) return { kind: 'idea' };
	if (until > 0) return { kind: 'before', days: until };
	const days = tripDays(trip);
	if (-until < days) return { kind: 'during', day: 1 - until, days };
	return { kind: 'after', days: -until - days + 1 };
}

/** The hero's figure and its caption: « J−185 · avant le départ », « Jour 3 · sur 7 », « Terminé · retour il y a 12 j », « Idée · dates à fixer ». */
export function phaseLabel(phase: TripPhase): { big: string; small: string } {
	switch (phase.kind) {
		case 'idea':
			return { big: 'Idée', small: 'dates à fixer' };
		case 'before':
			return phase.days === 1 ? { big: 'J−1', small: 'départ demain' } : { big: `J−${phase.days}`, small: 'avant le départ' };
		case 'during':
			return { big: `Jour ${phase.day}`, small: `sur ${phase.days}` };
		case 'after':
			return { big: 'Terminé', small: phase.days < 60 ? `retour il y a ${phase.days} j` : `retour il y a ${Math.round(phase.days / 30)} mois` };
	}
}

const weekdayDay = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric' });
const monthYear = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' });
const dayMonth = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
const dayMonthYear = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

/** « sam. 10 → ven. 16 avril 2027 » within a month, « jeu. 29 avr. → mar. 4 mai 2027 » across months, both years when they differ; '' without dates. */
export function formatTripDates(start: string, end: string): string {
	if (!ISO_RE.test(start) || !ISO_RE.test(end)) return '';
	const a = new Date(`${start}T12:00:00`);
	const b = new Date(`${end}T12:00:00`);
	if (start.slice(0, 7) === end.slice(0, 7)) return `${weekdayDay.format(a)} → ${weekdayDay.format(b)} ${monthYear.format(b)}`;
	if (start.slice(0, 4) === end.slice(0, 4)) return `${dayMonth.format(a)} → ${dayMonthYear.format(b)}`;
	return `${dayMonthYear.format(a)} → ${dayMonthYear.format(b)}`;
}

/** « 14:32 » at the destination (IANA zone), '' when the zone is unknown. */
export function clockAt(timezone: string | undefined, now: number): string {
	if (!timezone) return '';
	try {
		return new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: timezone }).format(now);
	} catch {
		return '';
	}
}

function offsetMinutes(timezone: string | undefined, now: number): number {
	const name = new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: 'longOffset' }).formatToParts(now).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
	const m = /^GMT(?:([+-])(\d{2}):(\d{2}))?$/.exec(name);
	if (!m) throw new Error(name);
	return m[1] ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
}

/** Hours the destination is ahead (+) or behind (−) of home at that instant: « +8 h », « −5 h », « +5 h 30 », '' when the same or unknown. */
export function zoneOffset(timezone: string | undefined, now: number, homeZone?: string): string {
	if (!timezone) return '';
	try {
		const diff = offsetMinutes(timezone, now) - offsetMinutes(homeZone, now);
		if (diff === 0) return '';
		const sign = diff < 0 ? '−' : '+';
		const h = Math.floor(Math.abs(diff) / 60);
		const min = Math.abs(diff) % 60;
		return `${sign}${h} h${min ? ` ${String(min).padStart(2, '0')}` : ''}`;
	} catch {
		return '';
	}
}

const SEVERAL_PLACES = /\s*(?:,|;|\/|&|\+|\bet\b|\bpuis\b| - | – )\s*/i;

/** The first place a destination names (« Tokyo et Kyoto » → « Tokyo »), as context for the geocoder. */
export function mainPlace(destination: string): string {
	return destination.split(SEVERAL_PLACES)[0]?.trim() ?? '';
}

/**
 * Queries tried in turn for a trip's photo, as the local server accepts them: the place chosen
 * for it, the destination, its first place when it names several (« Tokyo et Kyoto »), the country.
 */
export function photoQueries(trip: Pick<Trip, 'photo' | 'destination' | 'country'>): string[] {
	const out: string[] = [];
	for (const raw of [trip.photo, trip.destination, trip.destination.split(SEVERAL_PLACES)[0] ?? '', trip.country]) {
		const q = cleanQuery(raw);
		if (q && !out.includes(q)) out.push(q);
	}
	return out;
}

/** Next open dated point of the checklist (the overdue ones first: they still need doing), null when none. */
export function nextDeadline(checklist: readonly ChecklistItem[]): ChecklistItem | null {
	return checklist.filter((c) => !c.done && ISO_RE.test(c.date)).sort((a, b) => a.date.localeCompare(b.date))[0] ?? null;
}

/** Sum of the planned envelopes. */
export function plannedTotal(trip: Pick<Trip, 'envelopes'>): number {
	return Math.round(ENVELOPES.reduce((s, e) => s + (trip.envelopes[e.id] ?? 0), 0) * 100) / 100;
}

/** Planned budget per day and per traveller, null without dates. */
export function perDay(trip: Pick<Trip, 'start' | 'end' | 'envelopes' | 'travellers'>): { total: number; perPerson: number } | null {
	const days = tripDays(trip);
	if (days === 0) return null;
	const total = plannedTotal(trip) / days;
	return { total: Math.round(total * 100) / 100, perPerson: Math.round((total / Math.max(1, trip.travellers)) * 100) / 100 };
}

/** Countries whose nationals need no passport for a French traveller (EU, EEA, Switzerland): the passport line is skipped. */
const NO_PASSPORT = new Set(['', 'france', 'allemagne', 'autriche', 'belgique', 'bulgarie', 'chypre', 'croatie', 'danemark', 'espagne', 'estonie', 'finlande', 'grece', 'grèce', 'hongrie', 'irlande', 'islande', 'italie', 'lettonie', 'liechtenstein', 'lituanie', 'luxembourg', 'malte', 'norvege', 'norvège', 'pays-bas', 'pologne', 'portugal', 'republique tcheque', 'république tchèque', 'tchequie', 'tchéquie', 'roumanie', 'slovaquie', 'slovenie', 'slovénie', 'suede', 'suède', 'suisse', 'monaco', 'andorre']);

const normalize = (s: string) => s.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** The destination is outside the EU/EEA/Switzerland (passport and visa lines). */
export function isFarAbroad(country: string): boolean {
	return !NO_PASSPORT.has(normalize(country)) && !NO_PASSPORT.has(country.trim().toLowerCase());
}

/**
 * Default booking checklist of a trip, dated from the departure when known: deposit (J−60),
 * balance (J−30), free-cancellation limit (J−7), passport valid six months after the return and
 * visa/ESTA (far abroad only, J−90 and J−45), travel insurance (J−30), car rental (J−21), kennel
 * and mail hold (undated, J−14), check-in (J−1).
 */
export function defaultChecklist(trip: Pick<Trip, 'start' | 'end' | 'country'>, idOf: (kind: ChecklistKind) => string = (k) => `ck-${k}`): ChecklistItem[] {
	const dated = ISO_RE.test(trip.start);
	const at = (n: number) => (dated ? shiftDays(trip.start, -n) : '');
	const far = isFarAbroad(trip.country);
	const items: ChecklistItem[] = [
		{ id: idOf('acompte'), kind: 'acompte', label: 'Acompte versé', date: at(60), done: false },
		{ id: idOf('solde'), kind: 'solde', label: 'Solde réglé', date: at(30), done: false },
		{ id: idOf('annulation'), kind: 'annulation', label: 'Limite d’annulation gratuite', date: at(7), done: false },
		...(far
			? [
					{ id: idOf('passeport'), kind: 'passeport' as const, label: `Passeport valable 6 mois après le retour${dated && ISO_RE.test(trip.end) ? ` (jusqu’au ${shiftDays(trip.end, 183)})` : ''}`, date: at(90), done: false },
					{ id: idOf('visa'), kind: 'visa' as const, label: 'Visa / ESTA demandé', date: at(45), done: false }
				]
			: []),
		{ id: idOf('assurance'), kind: 'assurance', label: 'Assurance voyage (vérifier ce que la carte couvre déjà)', date: at(30), done: false },
		{ id: idOf('voiture'), kind: 'voiture', label: 'Location de voiture', date: at(21), done: false },
		{ id: idOf('animaux'), kind: 'animaux', label: 'Garde des animaux', date: '', done: false },
		{ id: idOf('courrier'), kind: 'courrier', label: 'Réexpédition du courrier', date: at(14), done: false },
		{ id: idOf('enregistrement'), kind: 'enregistrement', label: 'Enregistrement / check-in', date: at(1), done: false }
	];
	return items;
}

/** Checklist dates follow a new departure: every default item keeps its lead time; free items and done items stay. */
export function reshiftChecklist(checklist: readonly ChecklistItem[], oldStart: string, newStart: string): ChecklistItem[] {
	if (!ISO_RE.test(oldStart) || !ISO_RE.test(newStart) || oldStart === newStart) return [...checklist];
	const delta = Math.round((Date.parse(`${newStart}T00:00:00Z`) - Date.parse(`${oldStart}T00:00:00Z`)) / DAY);
	return checklist.map((c) => (c.kind !== 'libre' && c.date && !c.done ? { ...c, date: shiftDays(c.date, delta) } : c));
}

/** Trips in reading order: running or coming first (by departure), then ideas without dates, then past trips (latest first). */
/** The trip the home page shows: the one under way, else the next dated one, null when none is coming. */
export function nextTrip(trips: readonly Trip[], today: string): Trip | null {
	return trips.filter((t) => t.start && t.end && t.status !== 'termine' && t.end >= today).sort((a, b) => a.start.localeCompare(b.start))[0] ?? null;
}

export function sortTrips(trips: readonly Trip[], today: string): Trip[] {
	const rank = (t: Trip) => (!t.start ? 1 : t.end && t.end < today ? 2 : 0);
	return [...trips].sort((a, b) => {
		const r = rank(a) - rank(b);
		if (r !== 0) return r;
		if (rank(a) === 2) return b.start.localeCompare(a.start);
		if (rank(a) === 0) return a.start.localeCompare(b.start);
		return b.createdAt - a.createdAt;
	});
}

/** Actual spending per envelope from the operations of the trip's period: each subcategory of « Vacances » feeds one envelope, unknown ones « Extras ». */
export function envelopeActuals(ops: readonly { sub: string | null; amount: number }[]): Record<EnvelopeId, number> {
	const out = Object.fromEntries(ENVELOPES.map((e) => [e.id, 0])) as Record<EnvelopeId, number>;
	const bySub = new Map<string, EnvelopeId>();
	for (const e of ENVELOPES) for (const s of e.subs) bySub.set(s, e.id);
	for (const op of ops) {
		const id = (op.sub && bySub.get(op.sub)) || 'extras';
		out[id] = Math.round((out[id] + op.amount) * 100) / 100;
	}
	return out;
}

/** The quote is bought: the other quotes of its envelope are not, and the envelope's planned amount becomes its price. */
export function withBoughtQuote(trip: Trip, quoteId: string): Trip {
	const quote = trip.quotes.find((q) => q.id === quoteId);
	if (!quote) return trip;
	const bought = !quote.bought;
	return {
		...trip,
		quotes: trip.quotes.map((q) => (q.id === quoteId ? { ...q, bought } : q.envelope === quote.envelope && bought ? { ...q, bought: false } : q)),
		envelopes: bought ? { ...trip.envelopes, [quote.envelope]: quote.price } : trip.envelopes
	};
}

/** Quotes of an envelope, cheapest first, the bought one on top. */
export function compareQuotes(quotes: readonly Quote[], envelope: EnvelopeId): Quote[] {
	return quotes.filter((q) => q.envelope === envelope).sort((a, b) => Number(b.bought) - Number(a.bought) || a.price - b.price);
}

/** Checks a trip form: name required, dates in order, travellers 1–20. */
export function validateTrip(input: TripInput): { ok: true; value: TripInput } | { ok: false; error: string } {
	const name = input.name.trim();
	if (!name) return { ok: false, error: 'Donne un nom au voyage.' };
	if ((input.start && !ISO_RE.test(input.start)) || (input.end && !ISO_RE.test(input.end))) return { ok: false, error: 'Dates au format AAAA-MM-JJ.' };
	if (input.start && input.end && input.end < input.start) return { ok: false, error: 'Le retour est avant le départ.' };
	if ((input.start && !input.end) || (!input.start && input.end)) return { ok: false, error: 'Donne les deux dates, ou aucune.' };
	const travellers = Math.round(Number(input.travellers));
	if (!Number.isFinite(travellers) || travellers < 1 || travellers > 20) return { ok: false, error: 'Entre 1 et 20 voyageurs.' };
	const photo = input.photo.replace(/\s+/g, ' ').trim();
	if (photo.length > 60) return { ok: false, error: 'Nom de lieu trop long pour la photo (60 caractères).' };
	return { ok: true, value: { ...input, name, destination: input.destination.trim(), country: input.country.trim(), notes: input.notes.trim(), photo, travellers } };
}

const money = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v * 100) / 100 : null);
const degrees = (v: unknown, max: number): number | null => (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= max ? v : null);

/** Stored days read back: a day needs an id; a place needs an id and a name; unknown envelopes become Extras; coordinates stay together or not at all. */
export function sanitizeDays(raw: unknown): TripDay[] {
	if (!Array.isArray(raw)) return [];
	const out: TripDay[] = [];
	for (const d of raw as Partial<TripDay>[]) {
		if (!d || typeof d !== 'object' || typeof d.id !== 'string') continue;
		out.push({
			id: d.id,
			title: typeof d.title === 'string' ? d.title : '',
			notes: typeof d.notes === 'string' ? d.notes : '',
			places: Array.isArray(d.places)
				? d.places
						.filter((p) => p && typeof p.id === 'string' && typeof p.name === 'string')
						.map((p) => {
							const lat = degrees(p.lat, 90);
							const lon = degrees(p.lon, 180);
							const located = lat !== null && lon !== null;
							return { id: p.id, name: p.name, url: typeof p.url === 'string' ? p.url : '', cost: money(p.cost), envelope: ENVELOPES.some((e) => e.id === p.envelope) ? p.envelope : 'extras', lat: located ? lat : null, lon: located ? lon : null };
						})
				: []
		});
	}
	return out;
}

/** Stored trips read back, invalid entries dropped and missing fields filled. */
export function sanitizeTrips(raw: unknown): Trip[] {
	if (!Array.isArray(raw)) return [];
	const out: Trip[] = [];
	for (const t of raw as Partial<Trip>[]) {
		if (!t || typeof t !== 'object' || typeof t.id !== 'string' || typeof t.name !== 'string') continue;
		out.push({
			id: t.id,
			name: t.name,
			destination: typeof t.destination === 'string' ? t.destination : '',
			country: typeof t.country === 'string' ? t.country : '',
			start: typeof t.start === 'string' && ISO_RE.test(t.start) ? t.start : '',
			end: typeof t.end === 'string' && ISO_RE.test(t.end) ? t.end : '',
			travellers: typeof t.travellers === 'number' && t.travellers >= 1 ? Math.round(t.travellers) : 1,
			status: TRIP_STATUSES.some((s) => s.id === t.status) ? (t.status as TripStatus) : 'idee',
			notes: typeof t.notes === 'string' ? t.notes : '',
			photo: typeof t.photo === 'string' ? t.photo : '',
			periodId: typeof t.periodId === 'string' ? t.periodId : null,
			goalId: typeof t.goalId === 'string' ? t.goalId : null,
			envelopes: t.envelopes && typeof t.envelopes === 'object' ? Object.fromEntries(ENVELOPES.filter((e) => typeof (t.envelopes as Record<string, unknown>)[e.id] === 'number').map((e) => [e.id, (t.envelopes as Record<string, number>)[e.id]])) : {},
			checklist: Array.isArray(t.checklist) ? t.checklist.filter((c) => c && typeof c.id === 'string' && typeof c.label === 'string').map((c) => ({ id: c.id, kind: c.kind ?? 'libre', label: c.label, date: typeof c.date === 'string' ? c.date : '', done: !!c.done })) : [],
			quotes: Array.isArray(t.quotes) ? t.quotes.filter((q) => q && typeof q.id === 'string' && typeof q.price === 'number').map((q) => ({ id: q.id, site: q.site ?? '', label: q.label ?? '', price: q.price, url: q.url ?? '', conditions: q.conditions ?? '', date: q.date ?? '', envelope: ENVELOPES.some((e) => e.id === q.envelope) ? q.envelope : 'extras', bought: !!q.bought })) : [],
			days: sanitizeDays(t.days),
			packing: sanitizePacking(t.packing),
			createdAt: typeof t.createdAt === 'number' ? t.createdAt : 0
		});
	}
	return out;
}

// ---------- Link hub ----------

export type LinkGroup = 'vols' | 'trains' | 'bus' | 'hebergement' | 'voiture' | 'bons-plans' | 'ski' | 'camping' | 'ferries' | 'activites' | 'assurance' | 'officiel';

export const LINK_GROUPS: readonly { id: LinkGroup; label: string }[] = [
	{ id: 'vols', label: 'Vols' },
	{ id: 'trains', label: 'Trains' },
	{ id: 'bus', label: 'Bus & covoiturage' },
	{ id: 'hebergement', label: 'Hébergement' },
	{ id: 'voiture', label: 'Voiture' },
	{ id: 'bons-plans', label: 'Bons plans' },
	{ id: 'ski', label: 'Ski' },
	{ id: 'camping', label: 'Camping' },
	{ id: 'ferries', label: 'Ferries' },
	{ id: 'activites', label: 'Activités' },
	{ id: 'assurance', label: 'Assurance' },
	{ id: 'officiel', label: 'Officiel' }
];

export interface TripLink {
	label: string;
	group: LinkGroup;
	url: string;
	/** The dates and the destination are in the URL. */
	prefilled: boolean;
}

type LinkDef = { label: string; group: LinkGroup; home: string; search?: (t: { dest: string; start: string; end: string; n: number }) => string };

const enc = encodeURIComponent;

/** Sites of the hub. `search` builds a pre-filled URL (only when the site documents such parameters); the home page otherwise. */
const LINK_DEFS: readonly LinkDef[] = [
	{ label: 'Google Flights', group: 'vols', home: 'https://www.google.com/travel/flights', search: ({ dest, start, end }) => `https://www.google.com/travel/flights?q=${enc(`vols vers ${dest} du ${start} au ${end}`)}` },
	{ label: 'Skyscanner', group: 'vols', home: 'https://www.skyscanner.fr/' },
	{ label: 'Kayak', group: 'vols', home: 'https://www.kayak.fr/flights' },
	{ label: 'SNCF Connect', group: 'trains', home: 'https://www.sncf-connect.com/' },
	{ label: 'Ouigo', group: 'trains', home: 'https://www.ouigo.com/' },
	{ label: 'Trainline', group: 'trains', home: 'https://www.thetrainline.com/fr' },
	{ label: 'FlixBus', group: 'bus', home: 'https://www.flixbus.fr/' },
	{ label: 'BlaBlaCar', group: 'bus', home: 'https://www.blablacar.fr/' },
	{ label: 'Booking', group: 'hebergement', home: 'https://www.booking.com/', search: ({ dest, start, end, n }) => `https://www.booking.com/searchresults.fr.html?ss=${enc(dest)}&checkin=${start}&checkout=${end}&group_adults=${n}&no_rooms=1` },
	{ label: 'Airbnb', group: 'hebergement', home: 'https://www.airbnb.fr/', search: ({ dest, start, end, n }) => `https://www.airbnb.fr/s/${enc(dest)}/homes?checkin=${start}&checkout=${end}&adults=${n}` },
	{ label: 'Abritel', group: 'hebergement', home: 'https://www.abritel.fr/', search: ({ dest, start, end, n }) => `https://www.abritel.fr/search?destination=${enc(dest)}&startDate=${start}&endDate=${end}&adults=${n}` },
	{ label: 'Gîtes de France', group: 'hebergement', home: 'https://www.gites-de-france.com/' },
	{ label: 'Hostelworld', group: 'hebergement', home: 'https://www.hostelworld.com/', search: ({ dest, start, end, n }) => `https://www.hostelworld.com/s?q=${enc(dest)}&from=${start}&to=${end}&guests=${n}` },
	{ label: 'Rentalcars', group: 'voiture', home: 'https://www.rentalcars.com/fr/' },
	{ label: 'Getaround', group: 'voiture', home: 'https://fr.getaround.com/' },
	{ label: 'Voyage Privé', group: 'bons-plans', home: 'https://www.voyage-prive.com/' },
	{ label: 'Lastminute', group: 'bons-plans', home: 'https://www.fr.lastminute.com/' },
	{ label: 'Promovacances', group: 'bons-plans', home: 'https://www.promovacances.com/' },
	{ label: 'Veepee Voyages', group: 'bons-plans', home: 'https://www.veepee.fr/' },
	{ label: 'Travelski', group: 'ski', home: 'https://www.travelski.com/' },
	{ label: 'Skiset', group: 'ski', home: 'https://www.skiset.com/' },
	{ label: 'Huttopia', group: 'camping', home: 'https://europe.huttopia.com/' },
	{ label: 'Direct Ferries', group: 'ferries', home: 'https://www.directferries.fr/' },
	{ label: 'GetYourGuide', group: 'activites', home: 'https://www.getyourguide.fr/', search: ({ dest, start, end }) => `https://www.getyourguide.fr/s/?q=${enc(dest)}&date_from=${start}&date_to=${end}` },
	{ label: 'Civitatis', group: 'activites', home: 'https://www.civitatis.com/fr/' },
	{ label: 'Chapka', group: 'assurance', home: 'https://www.chapkadirect.fr/' },
	{ label: 'Passeport (ANTS)', group: 'officiel', home: 'https://ants.gouv.fr/' },
	{ label: 'Conseils aux voyageurs', group: 'officiel', home: 'https://www.diplomatie.gouv.fr/fr/conseils-aux-voyageurs/' },
	{ label: 'ESTA (États-Unis)', group: 'officiel', home: 'https://esta.cbp.dhs.gov/' }
];

/** Links of the hub for a trip: pre-filled with its destination and dates when the site accepts them. */
export function tripLinks(trip: Pick<Trip, 'destination' | 'start' | 'end' | 'travellers'>): TripLink[] {
	const ready = trip.destination.trim() !== '' && ISO_RE.test(trip.start) && ISO_RE.test(trip.end);
	const params = { dest: trip.destination.trim(), start: trip.start, end: trip.end, n: Math.max(1, trip.travellers) };
	return LINK_DEFS.map((d) => (ready && d.search ? { label: d.label, group: d.group, url: d.search(params), prefilled: true } : { label: d.label, group: d.group, url: d.home, prefilled: false }));
}
