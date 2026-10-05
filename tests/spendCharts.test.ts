import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCalendar, levelOf, monthsEndingAt, waterfallSteps, type DayTotal } from '../src/lib/spendCharts';

const day = (amount: number, merchants: [string, number][] = []): DayTotal => ({ amount, merchants: new Map(merchants) });

test('calendrier : semaines du lundi, fin au jour donné, niveaux par percentiles', () => {
	const days = new Map<string, DayTotal>([
		['2026-10-03', day(120, [['Carrefour', 80], ['Boulangerie', 6], ['Fnac', 34], ['Café', 2]])],
		['2026-10-01', day(10)],
		['2026-09-30', day(30)],
		['2026-09-29', day(60)],
		['2025-01-01', day(999)]
	]);
	const c = buildCalendar(days, '2026-10-03', 2);
	assert.equal(c.cells[0]!.date, '2026-09-21', 'lundi de la première semaine');
	assert.equal(c.cells[0]!.row, 0);
	const last = c.cells[c.cells.length - 1]!;
	assert.deepEqual([last.date, last.col, last.row], ['2026-10-03', 1, 5], 'samedi de la 2e semaine');
	assert.equal(last.level, 4);
	assert.deepEqual(last.top.map((t) => t.label), ['Carrefour', 'Fnac', 'Boulangerie']);
	assert.equal(c.cells.find((x) => x.date === '2026-10-02')!.level, 0);
	assert.equal(c.total, 220, 'hors période ignoré');
	assert.equal(c.emptyDays, c.cells.length - 4);
	assert.equal(c.byWeekday[5], 60, 'samedi : 120 sur deux samedis');
	assert.deepEqual(c.months.map((m) => m.key), ['2026-09']);
	assert.equal(levelOf(0, [1, 2, 3]), 0);
	assert.equal(levelOf(2.5, [1, 2, 3]), 3);
});

test('cascade du mois : revenus, dépenses triées (queue en « Autres »), épargne ou dépassement', () => {
	const s = waterfallSteps(3000, [
		{ id: 'a', label: 'A', amount: 100 },
		{ id: 'b', label: 'B', amount: 900 },
		{ id: 'c', label: 'C', amount: 50 },
		{ id: 'd', label: 'D', amount: 0 }
	], 2);
	assert.deepEqual(s.map((x) => x.id), ['income', 'b', 'autres', 'result']);
	assert.deepEqual([s[1]!.from, s[1]!.to], [3000, 2100]);
	assert.equal(s[2]!.amount, 150);
	assert.deepEqual([s[3]!.label, s[3]!.to], ['Épargne', 1950]);
	const over = waterfallSteps(1000, [{ id: 'x', label: 'X', amount: 1200 }]);
	assert.deepEqual([over[2]!.label, over[2]!.to], ['Dépassement', -200]);
});

test('mois glissants', () => {
	assert.deepEqual(monthsEndingAt('2026-02', 3), ['2025-12', '2026-01', '2026-02']);
});
