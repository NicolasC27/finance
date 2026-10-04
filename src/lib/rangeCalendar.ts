/**
 * Date logic of the French range calendar (pure module, testable with tsx): Monday-first month
 * grids, ISO day arithmetic in UTC (no time-zone drift), range ordering and length, keyboard moves,
 * min/max bounds and the French labels shown under the grid (« du 3 au 12 oct. · 10 jours »).
 * Dates are ISO strings 'YYYY-MM-DD', months are 'YYYY-MM'.
 */

const pad = (n: number) => String(n).padStart(2, '0');
const DAY_MS = 86_400_000;

/** One day cell of a month grid; weekday 0 = Monday … 6 = Sunday. */
export interface CalendarDay {
	date: string;
	day: number;
	weekday: number;
}

/** Month grid: empty cells before the 1st (Monday-first week) and the days of the month. */
export interface MonthGrid {
	month: string;
	leading: number;
	days: CalendarDay[];
}

/** Existing zone painted on the calendar (a vacation period, for instance). */
export interface CalendarMark {
	start: string;
	end: string;
	label: string;
}

/** Keys that move the keyboard focus inside the calendar. */
export type FocusKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown' | 'PageUp' | 'PageDown' | 'Home' | 'End';

/** Single-letter weekday headers, Monday first. */
export const WEEK_HEADERS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'] as const;
/** Weekday names for assistive technology, Monday first. */
export const WEEK_NAMES = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'] as const;

const shortDay = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const shortDayYear = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const shortMonth = new Intl.DateTimeFormat('fr-FR', { month: 'short', timeZone: 'UTC' });
const longDay = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const longMonth = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const monthName = new Intl.DateTimeFormat('fr-FR', { month: 'long', timeZone: 'UTC' });

/** True for a real calendar date written 'YYYY-MM-DD'. */
export function isIsoDate(value: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const [y, m, d] = value.split('-').map(Number) as [number, number, number];
	const t = new Date(Date.UTC(y, m - 1, d));
	return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** UTC midnight timestamp of an ISO date. */
function utc(iso: string): number {
	const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
	return Date.UTC(y, m - 1, d);
}

/** ISO date of a UTC timestamp. */
function isoOfUtc(t: number): string {
	const d = new Date(t);
	return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Today in the local time zone ('YYYY-MM-DD'). */
export function todayIso(now: Date = new Date()): string {
	return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Month key of an ISO date. */
export function monthOf(iso: string): string {
	return iso.slice(0, 7);
}

/** Month key `delta` months away. */
export function shiftMonth(month: string, delta: number): string {
	const [y, m] = month.split('-').map(Number) as [number, number];
	const index = y * 12 + (m - 1) + delta;
	return `${Math.floor(index / 12)}-${pad((index % 12) + 1)}`;
}

/** Number of days in a month. */
export function daysInMonth(month: string): number {
	const [y, m] = month.split('-').map(Number) as [number, number];
	return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** ISO date `n` days away. */
export function addDays(iso: string, n: number): string {
	return isoOfUtc(utc(iso) + n * DAY_MS);
}

/** Weekday of an ISO date, 0 = Monday … 6 = Sunday. */
export function weekdayOf(iso: string): number {
	return (new Date(utc(iso)).getUTCDay() + 6) % 7;
}

/** Monday-first grid of a month. */
export function monthGrid(month: string): MonthGrid {
	const count = daysInMonth(month);
	const days: CalendarDay[] = [];
	for (let day = 1; day <= count; day++) {
		const date = `${month}-${pad(day)}`;
		days.push({ date, day, weekday: weekdayOf(date) });
	}
	return { month, leading: days[0]!.weekday, days };
}

/** Rows of 7 cells of a month grid (Monday first), null for the empty cells before the 1st and after the last day. */
export function monthWeeks(grid: MonthGrid): (CalendarDay | null)[][] {
	const cells: (CalendarDay | null)[] = [...Array.from({ length: grid.leading }, () => null), ...grid.days];
	while (cells.length % 7 !== 0) cells.push(null);
	const weeks: (CalendarDay | null)[][] = [];
	for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
	return weeks;
}

/** The two bounds in chronological order. */
export function orderRange(a: string, b: string): [string, string] {
	return a <= b ? [a, b] : [b, a];
}

/** Number of days of a range, both bounds included. */
export function rangeDays(a: string, b: string): number {
	const [s, e] = orderRange(a, b);
	return Math.round((utc(e) - utc(s)) / DAY_MS) + 1;
}

/** True when `iso` lies inside the range (bounds included, any order). */
export function inRange(iso: string, a: string, b: string): boolean {
	if (!a || !b) return false;
	const [s, e] = orderRange(a, b);
	return s <= iso && iso <= e;
}

/** True when `iso` is outside the optional bounds. */
export function outOfBounds(iso: string, min = '', max = ''): boolean {
	return (min !== '' && iso < min) || (max !== '' && iso > max);
}

/** The date brought back inside the optional bounds. */
export function clampIso(iso: string, min = '', max = ''): string {
	if (min !== '' && iso < min) return min;
	if (max !== '' && iso > max) return max;
	return iso;
}

/**
 * Keyboard move from `iso`: a day with ←/→, a week with ↑/↓, a month with PageUp/PageDown (day
 * kept, clamped to the month length), start or end of the week with Home/End. null for other keys.
 */
export function moveFocus(iso: string, key: string): string | null {
	switch (key as FocusKey) {
		case 'ArrowLeft':
			return addDays(iso, -1);
		case 'ArrowRight':
			return addDays(iso, 1);
		case 'ArrowUp':
			return addDays(iso, -7);
		case 'ArrowDown':
			return addDays(iso, 7);
		case 'PageUp':
		case 'PageDown': {
			const month = shiftMonth(monthOf(iso), key === 'PageUp' ? -1 : 1);
			const day = Math.min(Number(iso.slice(8, 10)), daysInMonth(month));
			return `${month}-${pad(day)}`;
		}
		case 'Home':
			return addDays(iso, -weekdayOf(iso));
		case 'End':
			return addDays(iso, 6 - weekdayOf(iso));
		default:
			return null;
	}
}

/**
 * Whether a strip of `count` months starting at `first` may turn one month backwards (`dir` < 0) or
 * forwards (`dir` > 0) without showing only months outside `min` / `max` (ISO dates, '' = no bound).
 */
export function canTurn(first: string, count: number, dir: number, min = '', max = ''): boolean {
	if (dir < 0) return min === '' || shiftMonth(first, -1) >= monthOf(min);
	if (dir > 0) return max === '' || shiftMonth(first, Math.max(1, count)) <= monthOf(max);
	return false;
}

/** First visible month so that `month` shows in a strip of `count` months starting at `first`. */
export function revealMonth(first: string, count: number, month: string): string {
	if (month < first) return month;
	const last = shiftMonth(first, count - 1);
	return month > last ? shiftMonth(month, -(count - 1)) : first;
}

/** « 3 oct. », with the year when it is not the year of `today`. */
function dayText(iso: string, today: string): string {
	return (iso.slice(0, 4) === today.slice(0, 4) ? shortDay : shortDayYear).format(utc(iso));
}

/**
 * French label of a period: « 4 oct. » for one day, « du 3 au 12 oct. · 10 jours » inside a
 * month, « du 28 sept. au 3 oct. · 6 jours » across months, years shown when they are not the year
 * of `today`. Empty bounds give ''.
 */
export function rangeLabel(a: string, b: string, today: string = todayIso()): string {
	if (!a || !b) return '';
	const [s, e] = orderRange(a, b);
	if (s === e) return dayText(s, today);
	const days = rangeDays(s, e);
	const count = `${days} jour${days > 1 ? 's' : ''}`;
	const sameYear = s.slice(0, 4) === e.slice(0, 4);
	if (sameYear && monthOf(s) === monthOf(e)) {
		const tail = `${shortMonth.format(utc(e))}${e.slice(0, 4) === today.slice(0, 4) ? '' : ` ${e.slice(0, 4)}`}`;
		return `du ${Number(s.slice(8, 10))} au ${Number(e.slice(8, 10))} ${tail} · ${count}`;
	}
	if (sameYear) {
		const fmt = s.slice(0, 4) === today.slice(0, 4) ? shortDay : shortDayYear;
		return `du ${shortDay.format(utc(s))} au ${fmt.format(utc(e))} · ${count}`;
	}
	return `du ${shortDayYear.format(utc(s))} au ${shortDayYear.format(utc(e))} · ${count}`;
}

/** Spoken label of a day: « jeudi 1 octobre 2026 ». */
export function dayLabel(iso: string): string {
	return longDay.format(utc(iso));
}

/** Title of a month: « octobre 2026 ». */
export function monthTitle(month: string): string {
	return longMonth.format(utc(`${month}-01`));
}

/** Marks covering a day. */
export function marksOn(iso: string, marks: readonly CalendarMark[]): CalendarMark[] {
	return marks.filter((m) => inRange(iso, m.start, m.end));
}

/** Default name of a vacation period starting on `start`: « Vacances d'octobre 2026 », « Vacances de mai 2026 ». */
export function suggestVacationLabel(start: string): string {
	if (!isIsoDate(start)) return 'Vacances';
	const name = monthName.format(utc(start));
	const of = /^[aeiouyéèêàâîôûh]/i.test(name) ? 'd’' : 'de ';
	return `Vacances ${of}${name} ${start.slice(0, 4)}`;
}
