import type { Transaction } from './types';
import { setVacationPredicate, txKey } from './categories';
import { budgetState, setOverride, clearOverride } from './budget.svelte';
import { isExcluded } from './transfers.svelte';
import { effectiveDate } from './vacationDate';
import { persistJson } from './storage';

export { effectiveDate } from './vacationDate';

/**
 * Vacation periods (runes store, persisted in `budget:vacations`).
 *
 * During a period, VARIABLE spending (alimentation, loisirs, transport, autre; see
 * VACATION_ELIGIBLE in categories.ts) is reclassified as 'Vacances'. Fixed charges, subscriptions,
 * health and income do not move; a manual override or a learnt rule keeps priority. Never applied
 * to movements that are not spending: Kraken/Natixis lines (wealth), internal transfers and
 * operations hidden from the budget.
 *
 * Reference date: Crédit Mutuel books card payments several days after the purchase. The REAL date
 * is read from the label ('PAIEMENT CB 0308 …', 'PAIEMENT PSC 0208 …', 'RETRAIT DAB 1507',
 * '2 PAIEMENTS 2701 …'); otherwise the booking date.
 *
 * Manual assignment (`budget:vacation-assign`): an operation can be attached to a given period
 * whatever its date (a friend's repayment received a month later, a rental deposit paid before
 * leaving…). The assignment also forces the Vacances category.
 */

export interface VacationPeriod {
	id: string;
	label: string;
	/** ISO bounds (YYYY-MM-DD), inclusive. */
	start: string;
	end: string;
}

const VACATIONS_KEY = 'budget:vacations';
const ASSIGN_KEY = 'budget:vacation-assign';
const canStore = typeof localStorage !== 'undefined';

function loadAssignments(): Record<string, string> {
	if (!canStore) return {};
	try {
		const parsed = JSON.parse(localStorage.getItem(ASSIGN_KEY) ?? '{}') as Record<string, string>;
		return parsed && typeof parsed === 'object' ? parsed : {};
	} catch {
		return {};
	}
}

function load(): VacationPeriod[] {
	if (!canStore) return [];
	try {
		const parsed = JSON.parse(localStorage.getItem(VACATIONS_KEY) ?? '[]') as VacationPeriod[];
		return Array.isArray(parsed)
			? parsed.filter((p) => p && typeof p.start === 'string' && typeof p.end === 'string')
			: [];
	} catch {
		return [];
	}
}

export const vacationState = $state({
	periods: load(),
	/** Operation key → period id (manual assignment). */
	assignments: loadAssignments()
});

function persist(): void {
	if (!canStore) return;
	persistJson(VACATIONS_KEY, vacationState.periods);
}

/** Adds a period (bounds put back in order if inverted). */
export function addVacation(label: string, start: string, end: string): VacationPeriod {
	const [a, b] = start <= end ? [start, end] : [end, start];
	const period: VacationPeriod = {
		id: `vac-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
		label: label.trim() || 'Vacances',
		start: a,
		end: b
	};
	vacationState.periods = [...vacationState.periods, period].sort((x, y) => x.start.localeCompare(y.start));
	persist();
	return period;
}

/** Renames and/or redates a period (bounds put back in order). */
export function updateVacation(id: string, patch: Partial<Pick<VacationPeriod, 'label' | 'start' | 'end'>>): void {
	vacationState.periods = vacationState.periods
		.map((p) => {
			if (p.id !== id) return p;
			const start = patch.start ?? p.start;
			const end = patch.end ?? p.end;
			const [a, b] = start <= end ? [start, end] : [end, start];
			return { ...p, label: (patch.label ?? p.label).trim() || p.label, start: a, end: b };
		})
		.sort((x, y) => x.start.localeCompare(y.start));
	persist();
}

export function removeVacation(id: string): void {
	vacationState.periods = vacationState.periods.filter((p) => p.id !== id);
	persist();
	const next = { ...vacationState.assignments };
	for (const k of Object.keys(next)) if (next[k] === id) delete next[k];
	vacationState.assignments = next;
	persistAssignments();
}

function persistAssignments(): void {
	if (!canStore) return;
	persistJson(ASSIGN_KEY, vacationState.assignments);
}

/** Manually assigned period (if it still exists), else null. */
export function assignedVacation(tx: Transaction): VacationPeriod | null {
	const id = vacationState.assignments[txKey(tx)];
	if (!id) return null;
	return vacationState.periods.find((p) => p.id === id) ?? null;
}

/** Explicitly detached (value '': 'never on vacation', even inside a period). */
export function isDetached(tx: Transaction): boolean {
	return vacationState.assignments[txKey(tx)] === '';
}

/**
 * Attaches the operation to a period (category forced to Vacances), or detaches it (`null`): the
 * Vacances override is removed and, if the date falls in a period, a '' marker prevents the
 * automatic reclassification.
 */
export function assignVacation(tx: Transaction, periodId: string | null): void {
	const key = txKey(tx);
	const next = { ...vacationState.assignments };
	if (periodId) {
		next[key] = periodId;
		setOverride(key, 'vacances');
	} else {
		if (vacationFor(tx)) next[key] = '';
		else delete next[key];
		if (budgetState.overrides[key] === 'vacances') clearOverride(key);
	}
	vacationState.assignments = next;
	persistAssignments();
}

/** Period of the operation: manual assignment, else the real date (null if detached). */
export function vacationOf(tx: Transaction): VacationPeriod | null {
	if (isDetached(tx)) return null;
	return assignedVacation(tx) ?? vacationFor(tx);
}

/** The period containing the real date of the operation, or null. */
export function vacationFor(tx: Transaction): VacationPeriod | null {
	if (vacationState.periods.length === 0) return null;
	const d = effectiveDate(tx);
	if (!d) return null;
	return vacationState.periods.find((p) => p.start <= d && d <= p.end) ?? null;
}

export function isDuringVacation(tx: Transaction): boolean {
	if (isExcluded(txKey(tx))) return false;
	if (isDetached(tx)) return false;
	return vacationFor(tx) !== null;
}

// Plugs the predicate into the categorisation engine (pure file, no runes).
// vacationState is read at call time: reactive in every $derived that categorises.
setVacationPredicate(isDuringVacation);
