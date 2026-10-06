import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addMonths, buildSchedule, isLoanLabel, carItems, goalItems, loanItems, recurringItems, savingsItems, scheduleTotal, taxItems } from '../src/lib/schedule';

const FROM = '2026-10-05';
const TO90 = '2027-01-03';

test('addMonths: keeps the day, clamps to the end of short months', () => {
	assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
	assert.equal(addMonths('2026-01-31', 2), '2026-03-31');
	assert.equal(addMonths('2026-11-15', 3), '2027-02-15');
});

test('recurringItems: every occurrence inside the horizon, by cadence', () => {
	const items = recurringItems(
		[
			{ key: 'NETFLIX', label: 'Netflix', amount: 13.49, cadence: 'mensuelle', nextDate: '2026-10-12', confidence: 'haute' },
			{ key: 'EAU', label: 'Eau', amount: 60, cadence: 'trimestrielle', nextDate: '2026-11-20', confidence: 'moyenne' },
			{ key: 'PAS', label: 'Impôt à la source', amount: 120, cadence: 'mensuelle', nextDate: '2026-10-15', confidence: 'haute', tax: true }
		],
		FROM,
		TO90
	);
	assert.deepEqual(items.filter((i) => i.label === 'Netflix').map((i) => i.date), ['2026-10-12', '2026-11-12', '2026-12-12']);
	assert.deepEqual(items.filter((i) => i.label === 'Eau').map((i) => i.date), ['2026-11-20']);
	assert.ok(items.filter((i) => i.label === 'Impôt à la source').every((i) => i.kind === 'tax'));
});

test('loanItems: monthly instalments on the same day, the last one flagged', () => {
	const items = loanItems([{ accountId: 'pret', label: 'Prêt auto', payment: 210, lastPaymentDate: '2026-09-06', endMonth: '2026-12' }], FROM, '2027-06-30');
	assert.deepEqual(items.map((i) => i.date), ['2026-10-06', '2026-11-06', '2026-12-06']);
	assert.match(items.at(-1)!.label, /^Dernière échéance/);
	assert.ok(items.every((i) => i.sensitive && i.amount === 210));
});

test('loanItems: end month alone still gives the last instalment', () => {
	const items = loanItems([{ accountId: 'pret', label: 'Prêt', payment: 0, lastPaymentDate: null, endMonth: '2026-11' }], FROM, TO90);
	assert.equal(items.length, 1);
	assert.equal(items[0]!.date, '2026-11-05');
});

test('taxItems: only balances still to pay inside the horizon', () => {
	const items = taxItems(
		[
			{ year: 2025, remaining: 400, remainingDueDate: '2026-11-25' },
			{ year: 2024, remaining: 300, remainingDueDate: '2025-11-25' },
			{ year: 2023 }
		],
		FROM,
		TO90
	);
	assert.deepEqual(items.map((i) => [i.date, i.amount]), [['2026-11-25', 400]]);
});

test('carItems: dated milestones and the next insurance anniversary', () => {
	const items = carItems(
		[
			{
				id: 'c1',
				name: 'Clio',
				milestones: [
					{ id: 'ct', label: 'Contrôle technique', date: '2026-12-01', detail: 'tous les 2 ans' },
					{ id: 'garantie', label: 'Fin de garantie', date: null, detail: 'à renseigner' }
				],
				insuranceSince: '2024-11-10'
			}
		],
		FROM,
		TO90
	);
	assert.deepEqual(items.map((i) => [i.date, i.label.split(' · ')[0]]), [['2026-12-01', 'Contrôle technique'], ['2026-11-10', "Anniversaire de l'assurance"]]);
});

test('carItems: no anniversary before the first year', () => {
	assert.equal(carItems([{ id: 'c1', name: 'Clio', milestones: [], insuranceSince: '2026-10-20' }], FROM, TO90).length, 0);
});

test('savingsItems: grouped per release date, retirement and unknown dates left out', () => {
	const items = savingsItems(
		[
			{ fund: 'Monétaire', availableAt: '2026-12-01', amount: 1000 },
			{ fund: 'Actions', availableAt: '2026-12-01', amount: 500.5 },
			{ fund: 'Retraite', availableAt: 'retraite', amount: 9000 },
			{ fund: 'X', availableAt: 'inconnue', amount: 10 }
		],
		FROM,
		TO90
	);
	assert.deepEqual(items.map((i) => [i.date, i.amount]), [['2026-12-01', 1500.5]]);
});

test('goalItems: target dates of goals not reached yet, amount left', () => {
	const items = goalItems(
		[
			{ id: 'a', name: 'Vélo', targetDate: '2026-12-20', targetAmount: 800, currentAmount: 500 },
			{ id: 'b', name: 'Atteint', targetDate: '2026-12-20', targetAmount: 800, currentAmount: 800 },
			{ id: 'c', name: 'Sans date', targetAmount: 800, currentAmount: 0 }
		],
		FROM,
		TO90
	);
	assert.deepEqual(items.map((i) => [i.label, i.amount]), [['Objectif · Vélo', 300]]);
});

test('buildSchedule: a detected debit that is a loan instalment is dropped, sorted, horizon applied', () => {
	const debits = recurringItems([{ key: 'ECH PRET', label: 'Ech prêt auto', amount: 210, cadence: 'mensuelle', nextDate: '2026-10-06', confidence: 'haute' }], FROM, TO90);
	const loans = loanItems([{ accountId: 'pret', label: 'Prêt auto', payment: 210, lastPaymentDate: '2026-09-06', endMonth: '2030-01' }], FROM, TO90);
	const other = recurringItems([{ key: 'GYM', label: 'Salle', amount: 30, cadence: 'mensuelle', nextDate: '2026-10-06', confidence: 'haute' }], FROM, TO90);
	const all = buildSchedule([debits, loans, other, loans], FROM, '2026-10-31');
	assert.deepEqual(all.map((i) => [i.date, i.kind, i.label]), [
		['2026-10-06', 'loan', 'Échéance · Prêt auto'],
		['2026-10-06', 'debit', 'Salle']
	]);
	assert.equal(scheduleTotal(all), 240);
});

test('isLoanLabel and recurringItems: loan debits from the current account become « Crédits »', () => {
	assert.equal(isLoanLabel('Credit Conso Utilisation'), true);
	assert.equal(isLoanLabel('Ech prêt auto'), true);
	assert.equal(isLoanLabel('CETELEM'), true);
	assert.equal(isLoanLabel('Assurance Habitation'), false);
	assert.equal(isLoanLabel('Crédit Mutuel Assurance'), false);
	assert.equal(isLoanLabel('Autoroutes Du Sud De'), false);
	const items = recurringItems([{ key: 'CONSO', label: 'Credit Conso Mensuel', amount: 150, cadence: 'mensuelle', nextDate: '2026-10-06', confidence: 'haute', loan: true }], FROM, TO90);
	assert.ok(items.length > 0 && items.every((i) => i.kind === 'loan'));
	const kept = buildSchedule([items], FROM, TO90);
	assert.equal(kept.length, items.length, 'un crédit vu en prélèvement n’est pas supprimé par lui-même');
});
