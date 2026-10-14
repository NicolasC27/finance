import { persistJson } from './storage';
import { addVacation, assignVacation, effectiveDate, updateVacation, vacationFor, vacationOf, vacationState } from './vacations.svelte';
import { getBudgetTransactions, isExcluded } from './transfers.svelte';
import { budgetState } from './budget.svelte';
import { getMerchantCategoryMap } from './store.svelte';
import { categorize, txKey } from './categories';
import { attachmentFor } from './tripAttach';
import { buildStay, splitBudget, type PastStay } from './tripEstimates';
import { wishTripInput, type Wish } from './wishes';
import { removeWish } from './wishes.svelte';
import { subcategorize } from './subcategories';
import { isPending, spendAmount } from './data';
import { defaultChecklist, envelopeActuals, newId, reshiftChecklist, sanitizeTrips, tripDays, withBoughtQuote, type ChecklistItem, type EnvelopeId, type Quote, type Trip, type TripDay, type TripInput, type TripPlace } from './trips';
import { movePlace, reorderPlace, trimDays, withDay, withNewDay, withoutDay } from './itinerary';
import { copyPacking, templateItems, type PackItem, type PackTemplateId } from './packing';

/**
 * Trips, app side (`budget:trips`): persistence and the links with the rest of the app. A trip
 * with dates owns a vacation period (created or redated from the trip), so its spending is
 * reclassified « Vacances » and read back per envelope; a savings goal can fund it. The array is
 * raw state, replaced on every change.
 */

const TRIPS_KEY = 'budget:trips';

function load(): Trip[] {
	if (typeof localStorage === 'undefined') return [];
	try {
		return sanitizeTrips(JSON.parse(localStorage.getItem(TRIPS_KEY) ?? '[]'));
	} catch {
		return [];
	}
}

class TripsState {
	trips = $state.raw<Trip[]>(load());
}

export const tripsState = new TripsState();

function persist(): void {
	if (typeof localStorage !== 'undefined') persistJson(TRIPS_KEY, tripsState.trips);
}

function replace(id: string, change: (trip: Trip) => Trip): void {
	tripsState.trips = tripsState.trips.map((t) => (t.id === id ? change(t) : t));
	persist();
}

/** Creates the trip (and its vacation period when dated) with the default checklist, and the envelopes given (an estimate from past stays, a wish's budget). */
export function addTrip(input: TripInput, envelopes: Partial<Record<EnvelopeId, number>> = {}): Trip {
	const periodId = input.start && input.end ? addVacation(input.name, input.start, input.end).id : null;
	const trip: Trip = { id: newId('trip'), ...input, periodId, goalId: null, envelopes: { ...envelopes }, checklist: defaultChecklist(input, () => newId('ck')), quotes: [], days: [], packing: [], createdAt: Date.now() };
	tripsState.trips = [...tripsState.trips, trip];
	persist();
	return trip;
}

/** Changes the identity fields; new dates redate (or create) the period and shift the open checklist deadlines. */
export function updateTrip(id: string, patch: Partial<TripInput>): void {
	replace(id, (t) => {
		const next = { ...t, ...patch };
		let periodId = t.periodId;
		let checklist = t.checklist;
		if (next.start && next.end && (next.start !== t.start || next.end !== t.end || next.name !== t.name)) {
			if (periodId && vacationState.periods.some((p) => p.id === periodId)) updateVacation(periodId, { label: next.name, start: next.start, end: next.end });
			else periodId = addVacation(next.name, next.start, next.end).id;
			checklist = reshiftChecklist(t.checklist, t.start, next.start);
		}
		return { ...next, periodId, checklist };
	});
}

/** Forgets the trip; its vacation period stays (the reclassified spending is real). */
export function removeTrip(id: string): void {
	tripsState.trips = tripsState.trips.filter((t) => t.id !== id);
	persist();
}

export function setEnvelope(id: string, envelope: EnvelopeId, planned: number): void {
	replace(id, (t) => {
		const envelopes = { ...t.envelopes };
		if (planned > 0) envelopes[envelope] = Math.round(planned * 100) / 100;
		else delete envelopes[envelope];
		return { ...t, envelopes };
	});
}

export function setGoal(id: string, goalId: string | null): void {
	replace(id, (t) => ({ ...t, goalId }));
}

export function toggleChecklist(id: string, itemId: string): void {
	replace(id, (t) => ({ ...t, checklist: t.checklist.map((c) => (c.id === itemId ? { ...c, done: !c.done } : c)) }));
}

export function setChecklistDate(id: string, itemId: string, date: string): void {
	replace(id, (t) => ({ ...t, checklist: t.checklist.map((c) => (c.id === itemId ? { ...c, date } : c)) }));
}

export function addChecklistItem(id: string, label: string, date = ''): void {
	const item: ChecklistItem = { id: newId('ck'), kind: 'libre', label: label.trim(), date, done: false };
	if (!item.label) return;
	replace(id, (t) => ({ ...t, checklist: [...t.checklist, item] }));
}

export function removeChecklistItem(id: string, itemId: string): void {
	replace(id, (t) => ({ ...t, checklist: t.checklist.filter((c) => c.id !== itemId) }));
}

export function addQuote(id: string, quote: Omit<Quote, 'id' | 'bought'>): void {
	replace(id, (t) => ({ ...t, quotes: [...t.quotes, { ...quote, id: newId('q'), bought: false }] }));
}

export function removeQuote(id: string, quoteId: string): void {
	replace(id, (t) => ({ ...t, quotes: t.quotes.filter((q) => q.id !== quoteId) }));
}

/** « Acheté » on a quote (again to undo): the envelope takes its price. */
export function toggleBought(id: string, quoteId: string): void {
	replace(id, (t) => withBoughtQuote(t, quoteId));
}

// ---------- Day-by-day plan ----------

/** Days of a dated trip lose their trailing empty ones (implied by the dates); an undated trip keeps its day ideas. */
const withDays = (t: Trip, days: TripDay[]): Trip => ({ ...t, days: tripDays(t) ? trimDays(days) : days });

/** Replaces the whole plan (undo of a move or a removal). */
export function setDays(id: string, days: TripDay[]): void {
	replace(id, (t) => withDays(t, days));
}

export function setDay(id: string, index: number, patch: Partial<Pick<TripDay, 'title' | 'notes'>>): void {
	replace(id, (t) => withDays(t, withDay(t.days, index, (d) => ({ ...d, ...patch }))));
}

/** Adds the place at the end of the day and returns its id (for the geocoding that follows). */
export function addPlace(id: string, index: number, place: Omit<TripPlace, 'id'>): string {
	const placeId = newId('pl');
	replace(id, (t) => withDays(t, withDay(t.days, index, (d) => ({ ...d, places: [...d.places, { ...place, id: placeId }] }))));
	return placeId;
}

export function updatePlace(id: string, index: number, placeId: string, patch: Partial<Omit<TripPlace, 'id'>>): void {
	replace(id, (t) => withDays(t, withDay(t.days, index, (d) => ({ ...d, places: d.places.map((p) => (p.id === placeId ? { ...p, ...patch } : p)) }))));
}

export function removePlace(id: string, index: number, placeId: string): void {
	replace(id, (t) => withDays(t, withDay(t.days, index, (d) => ({ ...d, places: d.places.filter((p) => p.id !== placeId) }))));
}

export function movePlaceTo(id: string, from: number, placeId: string, to: number): void {
	replace(id, (t) => withDays(t, movePlace(t.days, from, placeId, to)));
}

export function reorderPlaceIn(id: string, index: number, placeId: string, delta: -1 | 1): void {
	replace(id, (t) => withDays(t, reorderPlace(t.days, index, placeId, delta)));
}

/** A day idea for an undated trip (or a day written beyond the dates). */
export function addDayIdea(id: string): void {
	replace(id, (t) => ({ ...t, days: withNewDay(t.days) }));
}

export function removeDay(id: string, index: number): void {
	replace(id, (t) => withDays(t, withoutDay(t.days, index)));
}

// ---------- Packing list ----------

/** Replaces the whole list (undo). */
export function setPacking(id: string, items: PackItem[]): void {
	replace(id, (t) => ({ ...t, packing: items }));
}

export function addPackItems(id: string, items: readonly PackItem[]): void {
	if (items.length) replace(id, (t) => ({ ...t, packing: [...t.packing, ...items] }));
}

/** Adds what the templates bring (with the essentials), one per traveller unless shared; returns how many items came in. */
export function applyPackTemplates(id: string, templates: readonly PackTemplateId[]): number {
	const trip = tripsState.trips.find((t) => t.id === id);
	if (!trip) return 0;
	const items = templateItems(templates, trip.travellers, trip.packing, () => newId('pk'));
	addPackItems(id, items);
	return items.length;
}

/** Copies another trip's list (unticked) after the current items. */
export function copyPackingFrom(id: string, fromId: string): number {
	const from = tripsState.trips.find((t) => t.id === fromId);
	if (!from) return 0;
	const items = copyPacking(from.packing, () => newId('pk'));
	addPackItems(id, items);
	return items.length;
}

export function togglePackItem(id: string, itemId: string): void {
	replace(id, (t) => ({ ...t, packing: t.packing.map((i) => (i.id === itemId ? { ...i, done: !i.done } : i)) }));
}

export function togglePackForgot(id: string, itemId: string): void {
	replace(id, (t) => ({ ...t, packing: t.packing.map((i) => (i.id === itemId ? { ...i, forgot: !i.forgot } : i)) }));
}

export function removePackItem(id: string, itemId: string): void {
	replace(id, (t) => ({ ...t, packing: t.packing.filter((i) => i.id !== itemId) }));
}

/** Unticks everything (packing again for the next trip reuse, or after a false start). */
export function resetPacking(id: string): void {
	replace(id, (t) => ({ ...t, packing: t.packing.map((i) => ({ ...i, done: false })) }));
}

/** Actual spending per envelope of a vacation period: its operations classified « Vacances », by subcategory. */
export function periodActuals(periodId: string): Record<EnvelopeId, number> {
	const mm = getMerchantCategoryMap();
	const ops: { sub: string | null; amount: number }[] = [];
	for (const tx of getBudgetTransactions()) {
		if (isPending(tx) || vacationOf(tx)?.id !== periodId) continue;
		if (categorize(tx, budgetState.overrides, undefined, mm) !== 'vacances') continue;
		ops.push({ sub: subcategorize(tx, budgetState.overrides, undefined, mm), amount: spendAmount(tx, 'vacances') ?? 0 });
	}
	return envelopeActuals(ops);
}

/** Actual spending per envelope of a trip: those of its period. */
export function tripActuals(trip: Trip): Record<EnvelopeId, number> {
	return trip.periodId ? periodActuals(trip.periodId) : envelopeActuals([]);
}

/** Past stays with known spending: the vacation periods over before today, named after their trip when one owns them. */
export function stayHistory(today: string): PastStay[] {
	const out: PastStay[] = [];
	for (const p of vacationState.periods) {
		if (p.end >= today) continue;
		const trip = tripsState.trips.find((t) => t.periodId === p.id);
		const stay = buildStay({ ...p, label: trip?.name ?? p.label }, trip?.country ?? '', periodActuals(p.id));
		if (stay) out.push(stay);
	}
	return out;
}

/**
 * Attaches to the dated trips the operations outside their period that look like theirs (a
 * travel brand in the year before, a foreign payment around the dates, the bank's fees after):
 * the operation joins the period, so its envelope counts it. An operation already attached,
 * detached or inside a period is left alone. Returns what was attached and the trips concerned.
 */
export function attachTravelPayments(): { count: number; names: string[] } {
	const trips = tripsState.trips.filter((t) => t.start && t.end && t.periodId && vacationState.periods.some((p) => p.id === t.periodId));
	const names = new Set<string>();
	let count = 0;
	if (!trips.length) return { count, names: [] };
	for (const tx of getBudgetTransactions()) {
		if (isPending(tx) || tx.credit_debit_indicator !== 'DBIT') continue;
		const key = txKey(tx);
		if (key in vacationState.assignments || isExcluded(key)) continue;
		const date = effectiveDate(tx);
		if (!date || vacationFor(tx)) continue;
		const label = tx.remittance_information.join(' ');
		const trip = trips.find((t) => attachmentFor(label, date, t));
		if (!trip) continue;
		assignVacation(tx, trip.periodId!);
		names.add(trip.name);
		count++;
	}
	return { count, names: [...names] };
}

/** Turns a wish into a trip (an idea without dates, its budget split into envelopes) and forgets the wish. */
export function tripFromWish(wish: Wish): Trip {
	const trip = addTrip(wishTripInput(wish), splitBudget(wish.budget));
	removeWish(wish.id);
	return trip;
}
