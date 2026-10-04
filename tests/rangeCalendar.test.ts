import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	addDays,
	clampIso,
	dayLabel,
	daysInMonth,
	inRange,
	isIsoDate,
	marksOn,
	monthGrid,
	monthTitle,
	monthWeeks,
	moveFocus,
	orderRange,
	outOfBounds,
	rangeDays,
	rangeLabel,
	revealMonth,
	shiftMonth,
	suggestVacationLabel,
	weekdayOf,
	canTurn
} from '../src/lib/rangeCalendar';
import { placeNear } from '../src/lib/actions/floating';

const TODAY = '2026-10-04';

test('month grid starts on Monday: October 2026 begins on a Thursday', () => {
	const g = monthGrid('2026-10');
	assert.equal(g.leading, 3);
	assert.equal(g.days.length, 31);
	assert.deepEqual(g.days[0], { date: '2026-10-01', day: 1, weekday: 3 });
	assert.equal(g.days[3]!.weekday, 6, '4 October 2026 is a Sunday');
	assert.equal(monthGrid('2026-06').leading, 0, '1 June 2026 is a Monday');
	assert.equal(monthGrid('2026-02').days.length, 28);
	assert.equal(daysInMonth('2028-02'), 29);
});

test('day arithmetic in UTC, across months, years and the DST change', () => {
	assert.equal(addDays('2026-10-24', 2), '2026-10-26');
	assert.equal(addDays('2026-12-31', 1), '2027-01-01');
	assert.equal(addDays('2026-03-01', -1), '2026-02-28');
	assert.equal(weekdayOf('2026-10-25'), 6);
	assert.equal(shiftMonth('2026-01', -1), '2025-12');
	assert.equal(shiftMonth('2026-11', 3), '2027-02');
	assert.equal(rangeDays('2026-10-03', '2026-10-12'), 10);
	assert.equal(rangeDays('2026-10-12', '2026-10-03'), 10, 'order does not matter');
	assert.equal(rangeDays('2026-10-04', '2026-10-04'), 1);
});

test('range helpers: order, membership, bounds and ISO validation', () => {
	assert.deepEqual(orderRange('2026-10-12', '2026-10-03'), ['2026-10-03', '2026-10-12']);
	assert.ok(inRange('2026-10-05', '2026-10-12', '2026-10-03'));
	assert.ok(inRange('2026-10-03', '2026-10-03', '2026-10-12'));
	assert.ok(!inRange('2026-10-13', '2026-10-03', '2026-10-12'));
	assert.ok(!inRange('2026-10-05', '', '2026-10-12'));
	assert.ok(outOfBounds('2026-09-30', '2026-10-01'));
	assert.ok(!outOfBounds('2026-10-01', '2026-10-01', '2026-10-31'));
	assert.equal(clampIso('2027-01-02', '', '2026-12-31'), '2026-12-31');
	assert.ok(isIsoDate('2028-02-29'));
	assert.ok(!isIsoDate('2026-02-29'));
	assert.ok(!isIsoDate('2026-10-4'));
});

test('keyboard moves: days, weeks, months (day clamped) and week ends', () => {
	assert.equal(moveFocus('2026-10-01', 'ArrowLeft'), '2026-09-30');
	assert.equal(moveFocus('2026-10-01', 'ArrowDown'), '2026-10-08');
	assert.equal(moveFocus('2026-01-31', 'PageDown'), '2026-02-28');
	assert.equal(moveFocus('2026-03-31', 'PageUp'), '2026-02-28');
	assert.equal(moveFocus('2026-10-01', 'Home'), '2026-09-28', 'Monday of that week');
	assert.equal(moveFocus('2026-10-01', 'End'), '2026-10-04', 'Sunday of that week');
	assert.equal(moveFocus('2026-10-01', 'Enter'), null);
});

test('visible strip follows the focused month', () => {
	assert.equal(revealMonth('2026-09', 2, '2026-10'), '2026-09');
	assert.equal(revealMonth('2026-09', 2, '2026-11'), '2026-10');
	assert.equal(revealMonth('2026-09', 2, '2026-07'), '2026-07');
	assert.equal(revealMonth('2026-09', 1, '2026-10'), '2026-10');
});

test('French labels: one day, inside a month, across months and years', () => {
	assert.equal(rangeLabel('2026-10-04', '2026-10-04', TODAY), '4 oct.');
	assert.equal(rangeLabel('2026-10-03', '2026-10-12', TODAY), 'du 3 au 12 oct. · 10 jours');
	assert.equal(rangeLabel('2026-10-12', '2026-10-03', TODAY), 'du 3 au 12 oct. · 10 jours');
	assert.equal(rangeLabel('2026-09-28', '2026-10-03', TODAY), 'du 28 sept. au 3 oct. · 6 jours');
	assert.equal(rangeLabel('2025-12-28', '2026-01-03', TODAY), 'du 28 déc. 2025 au 3 janv. 2026 · 7 jours');
	assert.equal(rangeLabel('2025-08-02', '2025-08-14', TODAY), 'du 2 au 14 août 2025 · 13 jours');
	assert.equal(rangeLabel('2025-07-04', '2025-07-04', TODAY), '4 juil. 2025');
	assert.equal(rangeLabel('', '2026-10-04', TODAY), '');
	assert.equal(dayLabel('2026-10-01'), 'jeudi 1 octobre 2026');
	assert.equal(monthTitle('2026-10'), 'octobre 2026');
});

test('marks covering a day, and the default vacation name with French elision', () => {
	const marks = [
		{ start: '2026-08-02', end: '2026-08-14', label: 'Pays basque' },
		{ start: '2026-08-14', end: '2026-08-20', label: 'Bretagne' }
	];
	assert.deepEqual(marksOn('2026-08-14', marks).map((m) => m.label), ['Pays basque', 'Bretagne']);
	assert.deepEqual(marksOn('2026-08-01', marks), []);
	assert.equal(suggestVacationLabel('2026-10-17'), 'Vacances d’octobre 2026');
	assert.equal(suggestVacationLabel('2026-08-01'), 'Vacances d’août 2026');
	assert.equal(suggestVacationLabel('2027-05-03'), 'Vacances de mai 2027');
	assert.equal(suggestVacationLabel(''), 'Vacances');
});

test('weeks of a month grid: 7 cells per row, empty cells before the 1st and after the last day', () => {
	const weeks = monthWeeks(monthGrid('2026-10'));
	assert.equal(weeks.length, 5);
	assert.ok(weeks.every((w) => w.length === 7));
	assert.deepEqual(weeks[0]!.slice(0, 4).map((c) => c?.day ?? null), [null, null, null, 1]);
	assert.deepEqual(weeks[4]!.map((c) => c?.day ?? null), [26, 27, 28, 29, 30, 31, null]);
});

test('popover placement: under the anchor, flipped above near the bottom, kept inside the viewport', () => {
	const rect = { left: 900, right: 1050, top: 100, bottom: 130 };
	assert.deepEqual(placeNear(rect, 680, 400, 1440, 900), { left: 752, top: 136 }, 'clamped to the right edge');
	assert.deepEqual(placeNear(rect, 200, 400, 1440, 900, 'end'), { left: 850, top: 136 });
	assert.deepEqual(placeNear({ left: 10, right: 60, top: 800, bottom: 830 }, 300, 400, 1440, 900), { left: 10, top: 394 }, 'flipped above');
});

test('month arrows and slides stop at the bounds: no strip of months that are all out of range', () => {
	assert.equal(canTurn('2026-09', 2, 1, '', '2026-10-04'), false, 'September + October shown, max in October');
	assert.equal(canTurn('2026-08', 2, 1, '', '2026-10-04'), true);
	assert.equal(canTurn('2026-10', 1, 1, '', '2026-10-04'), false);
	assert.equal(canTurn('2026-03', 2, -1, '2026-03-14', ''), false, 'min in the first month shown');
	assert.equal(canTurn('2026-04', 2, -1, '2026-03-14', ''), true);
	assert.equal(canTurn('2026-04', 2, 1), true, 'no bound');
	assert.equal(canTurn('2026-04', 2, 0), false);
});
