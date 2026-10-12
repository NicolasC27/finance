import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addMonths, buildSchedule, instalmentItems, isLoanLabel, rentItems, rentSource, VARIABLE_SUBS, carItems, goalItems, loanItems, recurringItems, savingsItems, scheduleTotal, taxItems, GROUP_ORDER, groupColor, groupLabel, scheduleGroup, type ScheduleGroup, type ScheduleItem } from '../src/lib/schedule';
import { CATEGORIES, getCategory } from '../src/lib/categories';
import { isExpenseCategory } from '../src/lib/flow';
import type { CategoryId } from '../src/lib/types';

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

test('rentSource and rentItems: rent from « Loyer & charges », whatever the label', () => {
	const pay = [
		{ date: '2026-07-03', amount: 700 },
		{ date: '2026-08-04', amount: 700 },
		{ date: '2026-09-02', amount: 650 },
		{ date: '2026-09-15', amount: 50 },
		{ date: '2026-05-03', amount: 9999 }
	];
	assert.deepEqual(rentSource(pay, '2026-10-06'), { amount: 700, day: 3 });
	assert.equal(rentSource([{ date: '2026-09-03', amount: 700 }], '2026-10-06'), null, 'un seul mois : pas assez');
	const items = rentItems({ amount: 700, day: 3 }, '2026-10-06', '2026-12-31');
	assert.deepEqual(items.map((i) => i.date), ['2026-11-03', '2026-12-03']);
	assert.equal(items[0]!.label, 'Loyer');
	assert.equal(VARIABLE_SUBS.has('peages-parkings'), true);
});

test('buildSchedule: rent wins over the same detected debit; an instalment due just before today is kept once, re-dated', () => {
	const rent = rentItems({ amount: 700, day: 3 }, FROM, TO90);
	const debitRent = recurringItems([{ key: 'VIR LOYER', label: 'Vir loyer octobre', amount: 700, cadence: 'mensuelle', nextDate: '2026-11-04', confidence: 'haute' }], FROM, TO90);
	const merged = buildSchedule([rent, debitRent], FROM, TO90);
	assert.ok(merged.every((i) => i.label === 'Loyer'), 'le virement de loyer détecté ne fait pas doublon');
	const loans = loanItems([{ accountId: 'L', label: 'Crédit', payment: 150, lastPaymentDate: '2026-09-05', endMonth: null }], '2026-10-01', TO90);
	const debit = recurringItems([{ key: 'CONSO', label: 'Credit Conso Mensuel', amount: 150, cadence: 'mensuelle', nextDate: '2026-10-06', confidence: 'haute', loan: true }], '2026-10-06', TO90);
	const out = buildSchedule([loans, debit], '2026-10-06', TO90);
	const oct = out.filter((i) => i.date.startsWith('2026-10'));
	assert.equal(oct.length, 1);
	assert.equal(oct[0]!.date, '2026-10-06');
	assert.match(oct[0]!.label, /Échéance · Crédit/);
});

test('recurringItems and rentItems: the budget category follows the deadline', () => {
	const [netflix] = recurringItems([{ key: 'NETFLIX', label: 'Netflix', amount: 13.49, cadence: 'mensuelle', nextDate: '2026-10-12', confidence: 'haute', categoryId: 'abonnements' }], FROM, '2026-10-31');
	assert.equal(netflix!.categoryId, 'abonnements');
	assert.equal(rentItems({ amount: 700, day: 8 }, FROM, '2026-10-31')[0]!.categoryId, 'logement');
});

test('scheduleGroup: budget category for debits, taxes and the car under theirs, loans, savings and goals apart', () => {
	const item = (kind: ScheduleItem['kind'], categoryId?: CategoryId): ScheduleItem => ({ id: kind, date: FROM, kind, label: kind, href: '/', ...(categoryId ? { categoryId } : {}) });
	assert.equal(scheduleGroup(item('debit', 'abonnements')), 'abonnements');
	assert.equal(scheduleGroup(item('debit')), 'autre');
	assert.equal(scheduleGroup(item('tax')), 'impots');
	assert.equal(scheduleGroup(item('car')), 'voiture');
	assert.equal(scheduleGroup(item('loan', 'voiture')), 'loan');
	assert.equal(scheduleGroup(item('savings')), 'savings');
	assert.equal(scheduleGroup(item('goal')), 'goal');
});

test('groups: each one listed once with its label, own colours never shared with a spending category', () => {
	assert.equal(new Set(GROUP_ORDER).size, GROUP_ORDER.length);
	assert.equal(GROUP_ORDER.length, CATEGORIES.length + 3);
	assert.equal(GROUP_ORDER.at(-1), 'autre');
	const own: ScheduleGroup[] = ['loan', 'savings', 'goal'];
	assert.deepEqual(own.map(groupLabel), ['Crédits', 'Épargne salariale', 'Objectifs']);
	assert.equal(groupLabel('logement'), 'Logement');
	assert.equal(groupColor('logement'), getCategory('logement').color);
	const spending = CATEGORIES.filter((c) => isExpenseCategory(c.id)).map((c) => c.color);
	for (const g of own) assert.ok(!spending.includes(groupColor(g)), g);
	assert.equal(new Set(own.map(groupColor)).size, own.length);
});

test('instalmentItems: expected instalments in the horizon, under their category, hiding the detected debit of the same amount', () => {
	const from = '2026-10-12';
	const to = '2027-10-12';
	const inst = instalmentItems(
		[
			{ key: 'k4', date: '2026-11-12', label: 'fnac', amount: 100, n: 4, of: 4, categoryId: 'loisirs' },
			{ key: 'old', date: '2026-09-12', label: 'fnac', amount: 100, n: 1, of: 4, categoryId: 'loisirs' }
		],
		from,
		to
	);
	assert.deepEqual(inst.map((i) => [i.id, i.label, i.detail, i.categoryId]), [['instalment:k4', 'fnac · 4/4', 'paiement en 4 fois', 'loisirs']]);
	const twin: ScheduleItem = { id: 'debit:fnac:2026-11-13', date: '2026-11-13', kind: 'debit', categoryId: 'loisirs', label: 'Fnac', amount: 100, href: '/transactions' };
	assert.deepEqual(buildSchedule([inst, [twin]], from, to).map((i) => i.id), ['instalment:k4']);
});
