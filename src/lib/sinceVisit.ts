import type { CategoryId } from './types';
import { addDays } from './rangeCalendar';

/**
 * « Depuis ta dernière visite » (pure): a snapshot of what the home page showed is kept at each
 * visit; the next visit compares the data with it and names what changed.
 */

/** A pause this long between two loads makes a new visit. */
export const VISIT_GAP_MS = 30 * 60 * 1000;

/** Days of operations whose keys a snapshot keeps (a late import of older ones is not « new »). */
export const KEPT_DAYS = 62;

export interface DueItem {
	id: string;
	label: string;
	date: string;
}

export interface VisitSnapshot {
	/** Moment of the visit (ISO timestamp). */
	at: string;
	/** Day of the visit ('YYYY-MM-DD'). */
	day: string;
	/** Keys of the operations booked in the KEPT_DAYS before the visit. */
	keys: string[];
	/** Month whose spending is kept ('YYYY-MM'). */
	month: string;
	/** Spending per category of that month. */
	spent: Partial<Record<CategoryId, number>>;
	/** Deadlines expected after the visit. */
	due: DueItem[];
}

export interface VisitDiff {
	/** Moment of the previous visit. */
	since: string;
	/** Operations that were not there. */
	added: number;
	/** Categories that went past their envelope. */
	crossed: CategoryId[];
	/** Deadlines whose day came. */
	arrived: DueItem[];
}

export interface VisitData {
	now: Date;
	day: string;
	month: string;
	operations: readonly { key: string; date: string }[];
	spent: ReadonlyMap<CategoryId, number>;
	budgets: Partial<Record<CategoryId, number>>;
	due: readonly DueItem[];
}

/** Snapshot of what the visit shows. */
export function takeSnapshot(data: VisitData): VisitSnapshot {
	const from = addDays(data.day, -KEPT_DAYS);
	return {
		at: data.now.toISOString(),
		day: data.day,
		keys: data.operations.filter((o) => o.date >= from).map((o) => o.key),
		month: data.month,
		spent: Object.fromEntries(data.spent),
		due: data.due.map((d) => ({ id: d.id, label: d.label, date: d.date }))
	};
}

/** A load counts as a new visit after a pause of VISIT_GAP_MS. */
export function isNewVisit(previous: VisitSnapshot, now: Date): boolean {
	return now.getTime() - new Date(previous.at).getTime() >= VISIT_GAP_MS;
}

/** What changed since `previous`; null when nothing did. */
export function diffSince(previous: VisitSnapshot, data: VisitData): VisitDiff | null {
	const known = new Set(previous.keys);
	const from = addDays(previous.day, -KEPT_DAYS);
	const added = data.operations.filter((o) => o.date >= from && !known.has(o.key)).length;
	const crossed: CategoryId[] = [];
	if (previous.month === data.month) {
		for (const [id, spent] of data.spent) {
			const budget = data.budgets[id];
			if (!budget || budget <= 0 || spent <= budget) continue;
			if ((previous.spent[id] ?? 0) <= budget) crossed.push(id);
		}
	}
	const arrived = previous.due.filter((d) => d.date > previous.day && d.date <= data.day);
	if (added === 0 && crossed.length === 0 && arrived.length === 0) return null;
	return { since: previous.at, added, crossed, arrived };
}

const weekday = new Intl.DateTimeFormat('fr-FR', { weekday: 'long' });
const dayMonth = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long' });
const monthOnly = new Intl.DateTimeFormat('fr-FR', { month: 'long' });

/** When the previous visit was, as said in a sentence: « plus tôt », « hier », « mardi », « le 3 octobre ». */
export function visitWhen(since: string, now: Date): string {
	const then = new Date(since);
	const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
	const days = Math.round((midnight(now) - midnight(then)) / 86_400_000);
	if (days <= 0) return 'plus tôt';
	if (days === 1) return 'hier';
	if (days < 7) return weekday.format(then);
	return `le ${then.getDate() === 1 ? `1er ${monthOnly.format(then)}` : dayMonth.format(then)}`;
}
