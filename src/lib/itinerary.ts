import { isLocated, pathKm } from './geo';
import { newId, plannedTotal, shiftDays, tripDays, type Trip, type TripDay, type TripPlace } from './trips';

/**
 * Day-by-day plan of a trip (pure, testable): the days as the page lists them (dated from the
 * departure, or day ideas without dates), the cost of each day against the per-day budget, and
 * the moves of places between days. Days are stored by position, so a new departure date moves
 * the whole plan with it; trailing empty days are not stored.
 */

export interface DayView {
	/** 0-based position (day 1 = 0). */
	index: number;
	/** ISO date when the trip has dates, '' otherwise. */
	date: string;
	/** What was written for the day, null when nothing yet. */
	day: TripDay | null;
	/** The day lies after the trip's return (the dates were shortened after writing). */
	beyond: boolean;
}

const round = (n: number) => Math.round(n * 100) / 100;

/** The days to list: every day of the stay (plus the written ones beyond it), or the day ideas of an undated trip. */
export function dayList(trip: Pick<Trip, 'start' | 'end' | 'days'>): DayView[] {
	const length = tripDays(trip);
	const count = Math.max(length, trip.days.length);
	return Array.from({ length: count }, (_, index) => ({ index, date: length ? shiftDays(trip.start, index) : '', day: trip.days[index] ?? null, beyond: length > 0 && index >= length }));
}

/** Planned cost of a day: the sum of its places' costs. */
export function dayCost(day: TripDay | null): number {
	return day ? round(day.places.reduce((s, p) => s + (p.cost ?? 0), 0)) : 0;
}

/** Planned cost of the whole plan. */
export function itineraryTotal(trip: Pick<Trip, 'days'>): number {
	return round(trip.days.reduce((s, d) => s + dayCost(d), 0));
}

/** Distance walked between the located places of a day in their order, km as the crow flies (0 with fewer than two). */
export function dayKm(day: TripDay | null): number {
	return day ? pathKm(day.places.filter(isLocated)) : 0;
}

/**
 * One colour per day on the map and in the list, in a fixed order (adjacent pairs checked for
 * colour-blind readers; pins and badges carry their number too). A trip beyond eight days reuses
 * them from the start.
 */
export const DAY_COLORS = ['#2f5fe0', '#e3641a', '#8d3ad6', '#1f9a4e', '#e0318a', '#0f98b5', '#b8860b', '#c0392b'] as const;

export const dayColor = (index: number): string => DAY_COLORS[((index % DAY_COLORS.length) + DAY_COLORS.length) % DAY_COLORS.length]!;

/** Envelopes' total spread over the days of the stay, null without dates. */
export function perDayBudget(trip: Pick<Trip, 'start' | 'end' | 'envelopes'>): number | null {
	const length = tripDays(trip);
	return length ? round(plannedTotal(trip) / length) : null;
}

const emptyDay = (): TripDay => ({ id: newId('day'), title: '', notes: '', places: [] });
const isEmpty = (d: TripDay) => !d.title && !d.notes && d.places.length === 0;

/** Days padded with empty ones up to `index`, so the day exists. */
function padded(days: readonly TripDay[], index: number): TripDay[] {
	const out = [...days];
	while (out.length <= index) out.push(emptyDay());
	return out;
}

/** Trailing empty days removed: a dated trip implies them, so the store trims after each change (an undated trip keeps its day ideas). */
export function trimDays(days: readonly TripDay[]): TripDay[] {
	let end = days.length;
	while (end > 0 && isEmpty(days[end - 1]!)) end--;
	return days.slice(0, end);
}

/** The day at `index` changed through `change` (created empty first when needed). */
export function withDay(days: readonly TripDay[], index: number, change: (day: TripDay) => TripDay): TripDay[] {
	return padded(days, index).map((d, i) => (i === index ? change(d) : d));
}

/** A new day idea appended. */
export function withNewDay(days: readonly TripDay[]): TripDay[] {
	return [...days, emptyDay()];
}

/** The day at `index` removed, the following ones moving up one position. */
export function withoutDay(days: readonly TripDay[], index: number): TripDay[] {
	return days.filter((_, i) => i !== index);
}

/** The place moved from one day to another (at the end), the days padded when the target is further than written. */
export function movePlace(days: readonly TripDay[], from: number, placeId: string, to: number): TripDay[] {
	const place = days[from]?.places.find((p) => p.id === placeId);
	if (!place || from === to || to < 0) return [...days];
	return padded(days, Math.max(from, to)).map((d, i) => (i === from ? { ...d, places: d.places.filter((p) => p.id !== placeId) } : i === to ? { ...d, places: [...d.places, place] } : d));
}

/** The place moved up (−1) or down (+1) inside its day; nothing at the ends. */
export function reorderPlace(days: readonly TripDay[], index: number, placeId: string, delta: -1 | 1): TripDay[] {
	const day = days[index];
	if (!day) return [...days];
	const at = day.places.findIndex((p) => p.id === placeId);
	const target = at + delta;
	if (at < 0 || target < 0 || target >= day.places.length) return [...days];
	const places = [...day.places];
	[places[at], places[target]] = [places[target]!, places[at]!];
	return days.map((d, i) => (i === index ? { ...d, places } : d));
}

/** A place as the form gives it, cleaned: name required, link http(s) or empty, cost positive or null. */
export function cleanPlace(input: { name: string; url: string; cost: string; envelope: TripPlace['envelope'] }): Omit<TripPlace, 'id'> | null {
	const name = input.name.replace(/\s+/g, ' ').trim();
	if (!name) return null;
	const url = input.url.trim();
	if (url && !/^https?:\/\//i.test(url)) return null;
	const n = Number(input.cost.replace(/\s/g, '').replace(',', '.'));
	const cost = input.cost.trim() === '' ? null : Number.isFinite(n) && n >= 0 ? round(n) : null;
	if (input.cost.trim() !== '' && cost === null) return null;
	return { name: name.slice(0, 80), url, cost, envelope: input.envelope, lat: null, lon: null };
}
