import { SEASONS, type Season } from './tripEstimates';
import type { TripInput } from './trips';

/**
 * Destinations the user dreams of (pure, testable): a name, a country, a budget and a length,
 * ranked by cost per day; when they could be afforded at the current savings pace; what a wish
 * becomes once it turns into a trip.
 */

export interface Wish {
	id: string;
	name: string;
	country: string;
	/** Estimated total, 0 when unknown. */
	budget: number;
	/** Length in days, 0 when unknown. */
	days: number;
	/** Best season to go, '' when any. */
	season: Season | '';
	notes: string;
	createdAt: number;
}

export type WishInput = Omit<Wish, 'id' | 'createdAt'>;

const round = (n: number) => Math.round(n * 100) / 100;
const amount = (s: string) => Number(s.replace(/\s/g, '').replace(',', '.'));

/** A wish as the form gives it, checked: a name, positive figures or none. */
export function validateWish(input: { name: string; country: string; budget: string; days: string; season: string; notes: string }): { ok: true; value: WishInput } | { ok: false; error: string } {
	const name = input.name.replace(/\s+/g, ' ').trim();
	if (!name) return { ok: false, error: 'Un nom, au moins.' };
	if (name.length > 60) return { ok: false, error: 'Nom trop long (60 caractères).' };
	const budget = input.budget.trim() === '' ? 0 : amount(input.budget);
	if (!Number.isFinite(budget) || budget < 0) return { ok: false, error: 'Budget : un montant positif, ou rien.' };
	const days = input.days.trim() === '' ? 0 : Number(input.days);
	if (!Number.isInteger(days) || days < 0 || days > 365) return { ok: false, error: 'Durée : un nombre de jours entier (jusqu’à 365), ou rien.' };
	const season = SEASONS.some((s) => s.id === input.season) ? (input.season as Season) : '';
	return { ok: true, value: { name, country: input.country.trim().slice(0, 40), budget: round(budget), days, season, notes: input.notes.trim().slice(0, 500) } };
}

/** Cost per day, null when the budget or the length is unknown. */
export const perDayOf = (w: Pick<Wish, 'budget' | 'days'>): number | null => (w.budget > 0 && w.days > 0 ? round(w.budget / w.days) : null);

/** Cheapest per day first, the ones without figures last, then by name. */
export function rankWishes(wishes: readonly Wish[]): Wish[] {
	return [...wishes].sort((a, b) => {
		const pa = perDayOf(a);
		const pb = perDayOf(b);
		if (pa === null && pb === null) return a.name.localeCompare(b.name, 'fr');
		if (pa === null) return 1;
		if (pb === null) return -1;
		return pa - pb || a.name.localeCompare(b.name, 'fr');
	});
}

/** Months of saving before the budget is there (0 when it already is), null when nothing is saved each month. */
export function monthsToAfford(budget: number, monthlySavings: number, saved = 0): number | null {
	const left = budget - saved;
	if (left <= 0) return 0;
	if (monthlySavings <= 0) return null;
	return Math.ceil(left / monthlySavings);
}

/** The month `months` after today, as 'YYYY-MM'. */
export function monthAfter(today: string, months: number): string {
	const total = Number(today.slice(0, 4)) * 12 + (Number(today.slice(5, 7)) - 1) + months;
	return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

/** The trip a wish turns into: an idea without dates, its notes kept. */
export function wishTripInput(w: Wish): TripInput {
	return { name: w.name, destination: w.name, country: w.country, start: '', end: '', travellers: 2, status: 'idee', notes: w.notes, photo: '' };
}

/** Stored wishes read back: an id and a name at least, figures positive or 0, unknown seasons dropped. */
export function sanitizeWishes(raw: unknown): Wish[] {
	if (!Array.isArray(raw)) return [];
	const out: Wish[] = [];
	for (const w of raw as Partial<Wish>[]) {
		if (!w || typeof w !== 'object' || typeof w.id !== 'string' || typeof w.name !== 'string' || !w.name.trim()) continue;
		out.push({
			id: w.id,
			name: w.name,
			country: typeof w.country === 'string' ? w.country : '',
			budget: typeof w.budget === 'number' && Number.isFinite(w.budget) && w.budget > 0 ? round(w.budget) : 0,
			days: typeof w.days === 'number' && Number.isInteger(w.days) && w.days > 0 ? w.days : 0,
			season: SEASONS.some((s) => s.id === w.season) ? (w.season as Season) : '',
			notes: typeof w.notes === 'string' ? w.notes : '',
			createdAt: typeof w.createdAt === 'number' ? w.createdAt : 0
		});
	}
	return out;
}
