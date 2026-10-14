import { budgetState } from './budget.svelte';
import { txKey } from './categories';
import { getCurrentMonth, getSpentThisMonth } from './envelopes.svelte';
import { todayIso } from './rangeCalendar';
import { getSchedule } from './schedule.svelte';
import { diffSince, isNewVisit, takeSnapshot, type VisitData, type VisitDiff, type VisitSnapshot } from './sinceVisit';
import { persistJson } from './storage';
import { getListedTransactions } from './transfers.svelte';

/**
 * « Depuis ta dernière visite », app side: the snapshot of the previous visit (`budget:last-visit`,
 * a preference of this browser) is compared with the data once per load of the home page; the
 * result stays for the tab (sessionStorage) so a reload during the visit shows the same line. The
 * snapshot is refreshed at each load and when the tab is hidden, so the next visit starts from what
 * was last seen.
 */

const SNAPSHOT_KEY = 'budget:last-visit';
const DIFF_KEY = 'budget:visit-diff';
const DISMISSED_KEY = 'budget:visit-dismissed';

/** Deadlines a snapshot keeps (days ahead). */
const DUE_DAYS = 45;

export const visitState = $state<{ diff: VisitDiff | null; dismissed: boolean }>({ diff: null, dismissed: false });

let registered = false;

function currentData(now: Date): VisitData {
	return {
		now,
		day: todayIso(now),
		month: getCurrentMonth(),
		operations: getListedTransactions()
			.filter((tx) => tx.booking_date)
			.map((tx) => ({ key: txKey(tx), date: tx.booking_date })),
		spent: getSpentThisMonth(),
		budgets: budgetState.budgets,
		due: getSchedule(DUE_DAYS).map((i) => ({ id: i.id, label: i.label, date: i.date }))
	};
}

function readJson<T>(storage: Storage, key: string): T | null {
	try {
		const raw = storage.getItem(key);
		return raw ? (JSON.parse(raw) as T) : null;
	} catch {
		return null;
	}
}

function saveSnapshot(): void {
	persistJson(SNAPSHOT_KEY, takeSnapshot(currentData(new Date())));
}

/** Reads the visit once the data is loaded (home page); later calls do nothing. */
export function registerVisit(): void {
	if (registered || typeof localStorage === 'undefined') return;
	registered = true;
	const now = new Date();
	const previous = readJson<VisitSnapshot>(localStorage, SNAPSHOT_KEY);
	const fresh = previous !== null && Array.isArray(previous.keys) && isNewVisit(previous, now);
	const diff = fresh ? diffSince(previous, currentData(now)) : previous ? readJson<VisitDiff>(sessionStorage, DIFF_KEY) : null;
	try {
		if (fresh) sessionStorage.removeItem(DISMISSED_KEY);
		if (diff) sessionStorage.setItem(DIFF_KEY, JSON.stringify(diff));
		else sessionStorage.removeItem(DIFF_KEY);
		visitState.dismissed = sessionStorage.getItem(DISMISSED_KEY) === '1';
	} catch {
	}
	visitState.diff = diff;
	saveSnapshot();
	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'hidden') saveSnapshot();
	});
}

/** Hides the line for the rest of the visit. */
export function dismissVisit(): void {
	visitState.dismissed = true;
	try {
		sessionStorage.setItem(DISMISSED_KEY, '1');
	} catch {
		return;
	}
}
