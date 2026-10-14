import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CategoryId, Transaction } from '../src/lib/types';
import { buildRibbon, ribbonScale } from '../src/lib/monthRibbon';

/** « Fil du mois » of the home page. */

const tx = (label: string, date: string, amount: number, cat: CategoryId): Transaction => ({
	transaction_amount: { amount: Math.abs(amount).toFixed(2), currency: 'EUR' },
	booking_date: date,
	value_date: date,
	remittance_information: [label],
	credit_debit_indicator: amount >= 0 ? 'CRDT' : 'DBIT',
	virtual_category: cat
});
const catOf = (t: Transaction): CategoryId => t.virtual_category as CategoryId;

const ribbon = buildRibbon({
	month: '2026-10',
	today: '2026-10-14',
	txs: [
		tx('CARREFOUR', '2026-10-03', -63.2, 'alimentation'),
		tx('CINEMA', '2026-10-03', -12, 'loisirs'),
		tx('REMBOURSEMENT AMI', '2026-10-03', 6, 'loisirs'),
		tx('SALAIRE OCTOBRE', '2026-10-01', 2400, 'revenus'),
		tx('EPARGNE', '2026-10-02', -300, 'epargne'),
		tx('CARREFOUR', '2026-09-30', -40, 'alimentation'),
		tx('LIBRAIRIE', '2026-10-20', -15, 'loisirs')
	],
	catOf,
	due: [
		{ date: '2026-10-15', label: 'Netflix', amount: 15.32 },
		{ date: '2026-10-05', label: 'Loyer', amount: 820 },
		{ date: '2026-11-05', label: 'Loyer', amount: 820 }
	],
	expectedIncome: [{ date: '2026-10-28', label: 'Allocation', amount: 180 }]
});

test('ribbon: one slot per day with weekday, past and today', () => {
	assert.equal(ribbon.length, 31);
	assert.equal(ribbon[0]!.weekday, 3, '1 October 2026 is a Thursday');
	assert.equal(ribbon[13]!.today, true);
	assert.equal(ribbon[13]!.past, true);
	assert.equal(ribbon[14]!.past, false);
});

test('ribbon: past days add up spending net of refunds, income apart, savings ignored', () => {
	assert.equal(ribbon[2]!.spent, 69.2);
	assert.deepEqual(ribbon[2]!.spends.map((s) => s.amount), [63.2, 12], 'biggest first, the refund only lowers the day total');
	assert.equal(ribbon[0]!.income.length, 1);
	assert.equal(ribbon[1]!.spent, 0);
});

test('ribbon: future days show expected debits and income only; past deadlines and other months are left out', () => {
	assert.deepEqual(ribbon[14]!.due, [{ label: 'Netflix', amount: 15.32 }]);
	assert.deepEqual(ribbon[4]!.due, []);
	assert.deepEqual(ribbon[27]!.income, [{ label: 'Allocation', amount: 180 }]);
	assert.equal(ribbon[19]!.spent, 0, 'an operation dated after today is not shown as spent');
});

test('ribbon: the scale is the heaviest day, spent or expected', () => {
	assert.equal(ribbonScale(ribbon), 69.2);
	assert.equal(ribbonScale([]), 1);
});

test('ribbon: a debit due today stays until the bank books it; a reminder without amount is no debit', () => {
	const days = buildRibbon({
		month: '2026-10',
		today: '2026-10-14',
		txs: [tx('BOULANGERIE', '2026-10-14', -4.5, 'alimentation')],
		catOf,
		due: [
			{ date: '2026-10-14', label: 'Loyer', amount: 820 },
			{ date: '2026-10-20', label: "Anniversaire de l'assurance" }
		],
		expectedIncome: []
	});
	assert.equal(days[13]!.spent, 4.5);
	assert.deepEqual(days[13]!.due, [{ label: 'Loyer', amount: 820 }]);
	assert.deepEqual(days[19]!.due, []);
	assert.equal(ribbonScale(days), 824.5, 'today stacks spent and expected');
});
