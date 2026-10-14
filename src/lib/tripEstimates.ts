import { ENVELOPES, plannedTotal, tripDays, type EnvelopeId, type Trip } from './trips';

/**
 * The money side of a trip before it happens (pure, testable): what past stays cost per day
 * (the vacation periods with their spending), the estimate for a new trip from the closest of
 * them (same destination, else same season, else all of them), the split of a budget into
 * envelopes, and the monthly amount to put aside until the departure.
 */

export type Season = 'hiver' | 'printemps' | 'ete' | 'automne';

export const SEASONS: readonly { id: Season; label: string }[] = [
	{ id: 'printemps', label: 'Printemps' },
	{ id: 'ete', label: 'Été' },
	{ id: 'automne', label: 'Automne' },
	{ id: 'hiver', label: 'Hiver' }
];

/** Season of an ISO date (meteorological: December starts the winter), null without a month. */
export function seasonOf(iso: string): Season | null {
	const m = Number(iso.slice(5, 7));
	if (!m || m > 12) return null;
	return m <= 2 || m === 12 ? 'hiver' : m <= 5 ? 'printemps' : m <= 8 ? 'ete' : 'automne';
}

export const seasonLabel = (s: Season): string => SEASONS.find((x) => x.id === s)?.label ?? s;

/** A past vacation period with what it cost. */
export interface PastStay {
	id: string;
	label: string;
	/** Country of the trip that owns the period, '' for a period without trip. */
	country: string;
	start: string;
	end: string;
	days: number;
	total: number;
	perDay: number;
	byEnvelope: Record<EnvelopeId, number>;
	season: Season;
}

const round = (n: number) => Math.round(n * 100) / 100;
const sumOf = (r: Record<EnvelopeId, number>) => ENVELOPES.reduce((s, e) => s + (r[e.id] ?? 0), 0);
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const words = (s: string) => fold(s).split(/[^a-z0-9]+/).filter((w) => w.length >= 4);

/** The stay of a period, null when it has no days or no spending. */
export function buildStay(period: { id: string; label: string; start: string; end: string }, country: string, byEnvelope: Record<EnvelopeId, number>): PastStay | null {
	const days = tripDays(period);
	const total = round(sumOf(byEnvelope));
	const season = seasonOf(period.start);
	if (!days || total <= 0 || !season) return null;
	return { id: period.id, label: period.label, country, start: period.start, end: period.end, days, total, perDay: round(total / days), byEnvelope, season };
}

export type EstimateBasis = 'destination' | 'saison' | 'moyenne';

export interface Estimate {
	perDay: number;
	basis: EstimateBasis;
	/** The stay(s) the figure comes from, most recent first. */
	stays: PastStay[];
	/** Share of each envelope in those stays (sum 1, or all 0 when nothing is known). */
	split: Record<EnvelopeId, number>;
}

/** Shares of the envelopes in a spending record. */
export function shares(byEnvelope: Record<EnvelopeId, number>): Record<EnvelopeId, number> {
	const total = sumOf(byEnvelope);
	return Object.fromEntries(ENVELOPES.map((e) => [e.id, total > 0 ? (byEnvelope[e.id] ?? 0) / total : 0])) as Record<EnvelopeId, number>;
}

const sumEnvelopes = (stays: readonly PastStay[]): Record<EnvelopeId, number> => Object.fromEntries(ENVELOPES.map((e) => [e.id, stays.reduce((s, st) => s + (st.byEnvelope[e.id] ?? 0), 0)])) as Record<EnvelopeId, number>;

/** The stay was in the same place: same country, or a word of the destination in its label (and the other way round). */
function sameDestination(stay: PastStay, target: { destination: string; country: string }): boolean {
	const country = fold(target.country.trim());
	if (country && fold(stay.country.trim()) === country) return true;
	const label = fold(stay.label);
	const destination = fold(target.destination);
	return words(target.destination).some((w) => label.includes(w)) || words(stay.label).some((w) => destination.includes(w));
}

/**
 * Cost per day to expect for a trip: the most recent stay in the same place (the same season
 * first), else the average of the stays in the same season, else of all of them; null without
 * any stay.
 */
export function estimateFor(target: { destination: string; country: string; start: string }, stays: readonly PastStay[]): Estimate | null {
	if (!stays.length) return null;
	const recentFirst = [...stays].sort((a, b) => b.start.localeCompare(a.start));
	const season = seasonOf(target.start);
	const same = recentFirst.filter((s) => sameDestination(s, target));
	if (same.length) {
		const best = same.find((s) => s.season === season) ?? same[0]!;
		return { perDay: best.perDay, basis: 'destination', stays: [best], split: shares(best.byEnvelope) };
	}
	const seasonal = season ? recentFirst.filter((s) => s.season === season) : [];
	const pool = seasonal.length ? seasonal : recentFirst;
	return { perDay: round(pool.reduce((s, st) => s + st.perDay, 0) / pool.length), basis: seasonal.length ? 'saison' : 'moyenne', stays: pool, split: shares(sumEnvelopes(pool)) };
}

/** How a budget is spread when nothing is known: flights and beds first. */
export const DEFAULT_SPLIT: Record<EnvelopeId, number> = { transport: 0.35, hebergement: 0.35, repas: 0.18, activites: 0.12, assurance: 0, extras: 0 };

/** A total spread into envelopes by shares (the default ones when they are all 0), in tens of euros, the biggest envelope taking the remainder. */
export function splitBudget(total: number, split: Record<EnvelopeId, number> = DEFAULT_SPLIT): Partial<Record<EnvelopeId, number>> {
	const whole = Math.round(total);
	if (whole <= 0) return {};
	const sum = ENVELOPES.reduce((s, e) => s + (split[e.id] ?? 0), 0);
	const weights = sum > 0 ? split : DEFAULT_SPLIT;
	const scale = sum > 0 ? sum : 1;
	const out: Partial<Record<EnvelopeId, number>> = {};
	let placed = 0;
	let biggest: EnvelopeId | null = null;
	for (const e of ENVELOPES) {
		const v = Math.round((whole * (weights[e.id] ?? 0)) / scale / 10) * 10;
		if (v <= 0) continue;
		out[e.id] = v;
		placed += v;
		if (biggest === null || v > out[biggest]!) biggest = e.id;
	}
	if (biggest === null) return { extras: whole };
	out[biggest] = out[biggest]! + (whole - placed);
	return out;
}

/** Envelopes of a trip of `days` days from an estimate. */
export function estimatedEnvelopes(estimate: Estimate, days: number): Partial<Record<EnvelopeId, number>> {
	return days > 0 ? splitBudget(estimate.perDay * days, estimate.split) : {};
}

/** Calendar months from one date to another (at least 1 when the second is later). */
export function monthsUntil(today: string, iso: string): number {
	const months = (Number(iso.slice(0, 4)) - Number(today.slice(0, 4))) * 12 + (Number(iso.slice(5, 7)) - Number(today.slice(5, 7)));
	return Math.max(1, months);
}

export interface SavingsPlan {
	/** Planned total minus what is already spent and saved. */
	remaining: number;
	months: number;
	monthly: number;
}

/** Monthly amount to put aside until the departure, null for an undated, past or unbudgeted trip. */
export function savingsPlan(trip: Pick<Trip, 'start' | 'envelopes'>, saved: number, spent: number, today: string): SavingsPlan | null {
	if (!trip.start || trip.start <= today) return null;
	const planned = plannedTotal(trip);
	if (planned <= 0) return null;
	const remaining = round(Math.max(0, planned - spent - saved));
	const months = monthsUntil(today, trip.start);
	return { remaining, months, monthly: Math.ceil(remaining / months) };
}

const monthYear = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' });

/** The estimate in one sentence (« Le Pays basque t’a coûté 70 €/jour »), `money` formatting the amounts. */
export function describeEstimate(e: Estimate, money: (n: number) => string): string {
	const perDay = `${money(e.perDay)}/jour`;
	if (e.basis === 'destination') {
		const s = e.stays[0]!;
		return `${s.label} (${monthYear.format(new Date(`${s.start}T12:00:00`))}) t’a coûté ${perDay}`;
	}
	const n = e.stays.length;
	if (e.basis === 'saison') return `${n > 1 ? `tes ${n} séjours` : 'ton séjour'} ${seasonPhrase(e.stays[0]!.season)} : ${perDay}${n > 1 ? ' en moyenne' : ''}`;
	return `${n > 1 ? `tes ${n} séjours` : 'ton dernier séjour'} : ${perDay}${n > 1 ? ' en moyenne' : ''}`;
}

const seasonPhrase = (s: Season): string => ({ hiver: 'd’hiver', printemps: 'de printemps', ete: 'd’été', automne: 'd’automne' })[s];
