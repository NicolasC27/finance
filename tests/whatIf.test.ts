import { test } from 'node:test';
import assert from 'node:assert/strict';
import { goalReach, loanPayment, loanTotalCost, readScenarios, simulate, type Baseline } from '../src/lib/whatIf';
import { projectNetWorth } from '../src/lib/realReturn';

const BASE: Baseline = { income: 3000, expenses: 2400, loanPrincipal: 0, netWorth: 10000, realRate: 2 };

test('loanPayment: exact annuity, known values', () => {
	assert.equal(loanPayment(20000, 5, 60), 377.42);
	assert.equal(loanPayment(200000, 3.5, 300), 1001.25);
	assert.equal(loanPayment(12000, 0, 48), 250);
	assert.equal(loanPayment(0, 5, 60), 0);
	assert.equal(loanPayment(1000, 5, 0), 0);
});

test('loanTotalCost: instalments × months − amount', () => {
	assert.equal(loanTotalCost(20000, 5, 60), 2645.2);
	assert.equal(loanTotalCost(12000, 0, 48), 0);
});

test('simulate: no change = the existing projection', () => {
	const s = simulate({ ...BASE, loanPrincipal: 150 }, [], 120);
	assert.equal(s.savings, 600);
	assert.equal(s.savingsRate, 20);
	assert.deepEqual(s.path, projectNetWorth({ depart: 10000, epargneMois: 750, reel: 2 }, 120));
});

test('simulate: income and expense changes move the monthly budget', () => {
	const s = simulate(BASE, [
		{ id: 'a', type: 'income', label: 'Temps partiel', amount: -500 },
		{ id: 'b', type: 'expense', label: 'Loyer plus cher', amount: 200 },
		{ id: 'c', type: 'expense', label: 'Abonnement en moins', amount: -50 }
	]);
	assert.equal(s.income, 2500);
	assert.equal(s.expenses, 2550);
	assert.equal(s.savings, -50);
	assert.equal(s.savingsRate, -2);
});

test('simulate: a loan costs its instalment until it ends, then savings come back', () => {
	const s = simulate({ ...BASE, realRate: 0 }, [{ id: 'l', type: 'loan', label: 'Voiture', amount: 20000, rate: 5, months: 60 }], 72, { inflation: 0 });
	assert.equal(s.loanPayments, 377.42);
	assert.equal(s.savings, 222.58);
	assert.equal(s.loans[0]!.totalCost, 2645.2);
	assert.equal(s.path[0], 10000 - 20000);
	assert.equal(s.schedule[0], 222.58);
	assert.equal(s.schedule[60], 600);
	assert.ok(Math.abs(s.path[60]! - (10000 + 600 * 60 - 20000 - 2645.2)) <= 1, `après le crédit : ${s.path[60]}`);
	assert.equal(s.path[72]! - s.path[60]!, 600 * 12);
});

test('simulate: inflation makes the fixed instalments lighter in today\'s euros', () => {
	const loan = [{ id: 'l', type: 'loan' as const, label: 'Voiture', amount: 20000, rate: 5, months: 60 }];
	const flat = simulate({ ...BASE, realRate: 0 }, loan, 60, { inflation: 0 });
	const real = simulate({ ...BASE, realRate: 0 }, loan, 60, { inflation: 2 });
	assert.equal(real.schedule[0]!, Math.round((600 - 377.42 / Math.pow(1.02, 1 / 12)) * 100) / 100);
	assert.ok(real.schedule[59]! > flat.schedule[59]!, 'dernière mensualité plus légère');
	assert.ok(real.path[60]! > flat.path[60]!, 'patrimoine plus haut une fois l’inflation comptée');
	assert.equal(real.path[0], flat.path[0]);
});

test('simulate: one-off purchase lowers the start, a windfall raises it', () => {
	assert.equal(simulate(BASE, [{ id: 'o', type: 'oneoff', label: 'Apport', amount: 4000 }], 12).path[0], 6000);
	assert.equal(simulate(BASE, [{ id: 'o', type: 'oneoff', label: 'Prime', amount: -1000 }], 12).path[0], 11000);
});

test('simulate: invalid loans are ignored', () => {
	const s = simulate(BASE, [{ id: 'l', type: 'loan', label: '', amount: 5000, rate: 4, months: 0 }]);
	assert.equal(s.loans.length, 0);
	assert.equal(s.savings, 600);
});

test('goalReach: months until a goal funded by the monthly savings', () => {
	assert.equal(goalReach(1000, 4000, Array(24).fill(500), 0), 6);
	assert.equal(goalReach(5000, 4000, [], 0), 0);
	assert.equal(goalReach(0, 4000, Array(24).fill(-10), 0), null);
	assert.equal(goalReach(0, 1000, [100, 100, 800], 0), 3);
});

test('readScenarios: keeps valid scenarios and changes only', () => {
	const out = readScenarios([
		{ id: 's', name: 'Voiture', changes: [{ id: 'l', type: 'loan', label: 'Crédit', amount: 15000, rate: 4.9, months: 48 }, { id: 'x', type: 'bogus', amount: 1 }, { id: 'y', type: 'income', amount: 'a' }] },
		{ name: 'sans id' },
		null
	]);
	assert.equal(out.length, 1);
	assert.deepEqual(out[0]!.changes, [{ id: 'l', type: 'loan', label: 'Crédit', amount: 15000, rate: 4.9, months: 48 }]);
	assert.deepEqual(readScenarios('nope'), []);
});
