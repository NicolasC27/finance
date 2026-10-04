import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CategoryId, Transaction } from '../src/lib/types';
import { monthlyAnalytics, monthRange, movingAverage, pctChange, seriesStats } from '../src/lib/analytics';

const tx = (label: string, booking: string, amount: string, cd: 'DBIT' | 'CRDT' = 'DBIT', extra: Partial<Transaction> = {}): Transaction =>
	({
		transaction_amount: { amount, currency: 'EUR' },
		booking_date: booking,
		value_date: booking,
		remittance_information: [label],
		credit_debit_indicator: cd,
		...extra
	}) as Transaction;

/**
 * Test categoriser: KRAKEN goes to epargne like categorize() (movement to/from oneself, outside the flows).
 */
const catOf = (t: Transaction): CategoryId => {
	const l = t.remittance_information[0]!;
	if (/SALAIRE/.test(l)) return 'revenus';
	if (/CARREFOUR|RESTO/.test(l)) return 'alimentation';
	if (/LOYER/.test(l)) return 'logement';
	if (/KRAKEN/.test(l)) return 'epargne';
	return 'autre';
};
const subOf = (t: Transaction) => (/RESTO/.test(t.remittance_information[0]!) ? 'restaurants' : null);

test('monthRange: consecutive months, across a year boundary', () => {
	assert.deepEqual(monthRange('2025-11', '2026-02'), ['2025-11', '2025-12', '2026-01', '2026-02']);
	assert.deepEqual(monthRange('2026-03', '2026-03'), ['2026-03']);
});

/**
 * Refunds are deducted; an empty month (February) is kept; wealth lines are
 * ignored; a Kraken withdrawal kept in the budget is not income; excluded from the
 * budget but « invested » (120 + 40 − 20). Also covers the last N months and the
 * empty case.
 */
test('monthlyAnalytics: net spending per category, income, savings, empty months, amount invested in Kraken', () => {
	const budget = [
		tx('SALAIRE ACME', '2026-01-28', '2500.00', 'CRDT'),
		tx('CB CARREFOUR', '2026-01-10', '120.00'),
		tx('CB RESTO', '2026-01-12', '40.00'),
		tx('CB CARREFOUR REMBOURSEMENT', '2026-01-15', '20.00', 'CRDT'),
		tx('LOYER', '2026-01-05', '900.00'),
		tx('SALAIRE ACME', '2026-03-28', '2500.00', 'CRDT'),
		tx('CB CARREFOUR', '2026-03-10', '200.00'),
		tx('KRAKEN VIREMENT ENTREE X', '2026-03-11', '500.00', 'CRDT', { account: 'kraken' }),
		tx('VIR SEPA PAYWARD KRAKEN WITHDRAWAL', '2026-03-12', '82000.00', 'CRDT')
	];
	const all = [...budget, tx('VIR INST GREGOIRE MARCHAND KRAKEN TX//A', '2026-03-11', '500.00')];
	const a = monthlyAnalytics(budget, all, catOf, subOf);
	assert.deepEqual(a.months, ['2026-01', '2026-02', '2026-03']);
	assert.deepEqual(a.byCategory.alimentation, [140, 0, 200]);
	assert.deepEqual(a.byCategory.logement, [900, 0, 0]);
	assert.deepEqual(a.bySub.restaurants, [40, 0, 0]);
	assert.deepEqual(a.income, [2500, 0, 2500]);
	assert.deepEqual(a.expenses, [1040, 0, 200]);
	assert.deepEqual(a.savings, [1460, 0, 2300]);
	assert.deepEqual(a.savingsRate, [58.4, null, 92]);
	assert.deepEqual(a.invested, [0, 0, 500]);
	assert.deepEqual(monthlyAnalytics(budget, all, catOf, subOf, 2).months, ['2026-02', '2026-03']);
	assert.deepEqual(monthlyAnalytics([], [], catOf, subOf).months, []);
});

test('movingAverage / pctChange / seriesStats', () => {
	assert.deepEqual(movingAverage([10, 20, 30, 40], 3), [10, 15, 20, 30]);
	assert.equal(pctChange(120, 100), 20);
	assert.equal(pctChange(50, 100), -50);
	assert.equal(pctChange(10, 0), null);
	const s = seriesStats([100, -50, 300]);
	assert.equal(s.mean, 116.67);
	assert.equal(s.total, 350);
	assert.deepEqual(s.best, { index: 2, value: 300 });
	assert.deepEqual(s.worst, { index: 1, value: -50 });
});
