import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareYears, cumulativeInflation, inflationOf, RECENT_INFLATION, type MonthCategoryTotals } from '../src/lib/inflation';

/** INSEE inflation and comparison with spending and income (same months year over year). */

/** 2021 to 2025: 1.6 %; 5.2 %; 4.9 %; 2.0 %; 0.9 % → +15.4 %. */
test('INSEE inflation: yearly averages, current year at the latest year-on-year rate, cumulative', () => {
	assert.deepEqual(inflationOf(2023), { taux: 4.9, definitive: true });
	assert.deepEqual(inflationOf(Number(RECENT_INFLATION.mois.slice(0, 4))), { taux: RECENT_INFLATION.taux, definitive: false });
	assert.equal(inflationOf(1990), null);
	assert.equal(cumulativeInflation(2020, 2025), 15.4);
	assert.equal(cumulativeInflation(2025, 2025), 0);
});

/**
 * 2026: January to September (current October excluded), compared with the same
 * months of 2025; 2025: full year, final inflation 0.9 %; 2024: no previous year.
 */
test('year by year: changes over the same months, current month excluded, inflation-adjusted purchasing power', () => {
	const months: MonthCategoryTotals[] = [];
	for (let m = 1; m <= 12; m++) months.push({ mois: `2024-${String(m).padStart(2, '0')}`, depenses: 2000, revenus: 3000 });
	for (let m = 1; m <= 12; m++) months.push({ mois: `2025-${String(m).padStart(2, '0')}`, depenses: 2100, revenus: 3090 });
	for (let m = 1; m <= 10; m++) months.push({ mois: `2026-${String(m).padStart(2, '0')}`, depenses: 2205, revenus: 3399 });
	const [y26, y25, y24] = compareYears(months, '2026-10');
	assert.deepEqual(y26!.moisCompares, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
	assert.deepEqual([y26!.depenses, y26!.varDepenses, y26!.varRevenus], [2205 * 9, 5, 10]);
	assert.equal(y26!.pouvoirAchat, Math.round(((1.1 / (1 + RECENT_INFLATION.taux / 100) - 1) * 100) * 10) / 10);
	assert.deepEqual([y25!.inflation, y25!.varDepenses, y25!.varRevenus, y25!.pouvoirAchat, y25!.depensesReelles], [0.9, 5, 3, 2.1, 4.1]);
	assert.deepEqual([y24!.varDepenses, y24!.pouvoirAchat, y24!.moisCompares], [null, null, []]);
});
