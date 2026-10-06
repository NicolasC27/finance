import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeTax, defaultTaxYear, isUnemploymentBenefit, professionalDeduction, projectMonths, regularisation, taxParts } from '../src/lib/incomeTax';
import { currentLawFor, rulesFor, rulesWarning, TAX_RULES } from '../src/lib/incomeTaxRules';

const R2025 = TAX_RULES[2025]!;
const R2026 = TAX_RULES[2026]!;

test('taxParts: couple, children, single parent', () => {
	assert.equal(taxParts({ couple: false, children: 0 }), 1);
	assert.equal(taxParts({ couple: true, children: 0 }), 2);
	assert.equal(taxParts({ couple: true, children: 2 }), 3);
	assert.equal(taxParts({ couple: true, children: 3 }), 4);
	assert.equal(taxParts({ couple: false, children: 1 }), 2, 'parent isolé : ½ part en plus');
});

test('professionalDeduction: 10 % between the floor and the cap', () => {
	assert.equal(professionalDeduction(30000, R2025), 3000);
	assert.equal(professionalDeduction(3000, R2025), 509);
	assert.equal(professionalDeduction(300, R2025), 300, 'jamais plus que le salaire');
	assert.equal(professionalDeduction(200000, R2025), 14555);
	assert.equal(professionalDeduction(0, R2025), 0);
});

test('computeTax: single 30 000 € of salary (income 2025), décote applied', () => {
	const r = computeTax({ salaries: [30000], otherIncome: 0, household: { couple: false, children: 0 }, reductions: 0 }, R2025);
	assert.equal(r.netIncome, 27000);
	assert.equal(r.grossTax, 1694);
	assert.equal(r.decote, 130);
	assert.equal(r.netTax, 1564);
	assert.equal(r.marginalRate, 11);
});

test('computeTax: published example, couple with two children (income 2025)', () => {
	const r = computeTax({ salaries: [30000, 25000], otherIncome: 0, household: { couple: true, children: 2 }, reductions: 0 }, R2025);
	assert.equal(r.netIncome, 49500);
	assert.equal(r.parts, 3);
	assert.equal(r.grossTax, 1617);
	assert.equal(r.capped, false);
	assert.equal(r.decote, 751);
	assert.equal(r.netTax, 866);
});

test('computeTax: family quotient cap for a high-income single parent', () => {
	const r = computeTax({ salaries: [120000], otherIncome: 0, household: { couple: false, children: 1 }, reductions: 0 }, R2025);
	assert.equal(r.netIncome, 108000);
	assert.equal(r.capped, true);
	assert.equal(r.grossTax, 23819);
	assert.equal(r.decote, 0);
	assert.equal(r.marginalRate, 41, 'plafonné : tranche calculée sans la part de l’enfant');
});

test('computeTax: actual expenses, reductions, collection threshold', () => {
	const real = computeTax({ salaries: [40000], actualExpenses: [6000], otherIncome: 0, household: { couple: false, children: 0 }, reductions: 0 }, R2026);
	assert.equal(real.deduction, 6000);
	const small = computeTax({ salaries: [14000], otherIncome: 0, household: { couple: false, children: 0 }, reductions: 0 }, R2026);
	assert.equal(small.netTax, 0, 'sous 61 € : non recouvré');
	const withCredit = computeTax({ salaries: [40000], otherIncome: 0, household: { couple: false, children: 0 }, reductions: 500 }, R2026);
	const without = computeTax({ salaries: [40000], otherIncome: 0, household: { couple: false, children: 0 }, reductions: 0 }, R2026);
	assert.equal(without.netTax - withCredit.netTax, 500);
});

test('rulesFor: known year exact, later year falls back to the last known one', () => {
	assert.equal(rulesFor(2026).exact, true);
	assert.equal(rulesFor(2026).provisional, true);
	assert.equal(rulesFor(2028).exact, false);
	assert.equal(rulesFor(2028).incomeYear, 2026);
});

test('projectMonths and regularisation: payslips read, months projected to December', () => {
	const slips = [
		{ month: '2026-08', taxable: 4000, rate: 6.1, withheld: 244 },
		{ month: '2026-09', taxable: 4000, rate: 6.1, withheld: 244 },
		{ month: '2025-12', taxable: 9999, rate: 1, withheld: 99 }
	];
	const months = projectMonths(slips, 2026);
	assert.deepEqual(months.map((m) => m.month), ['2026-08', '2026-09', '2026-10', '2026-11', '2026-12']);
	assert.deepEqual(months.map((m) => m.projected), [false, false, true, true, true]);
	assert.equal(months[4]!.withheld, 244);
	const reg = regularisation(6000, months, { withheld: 1500 });
	assert.equal(reg.withheldSoFar, 1988);
	assert.equal(reg.withheldToCome, 732);
	assert.equal(reg.balance, 3280);
	assert.equal(reg.instalments, 4);
	assert.equal(reg.remainingTaxable, 12000);
	assert.equal(reg.rateToAvoid, 33.4);
	assert.equal(regularisation(200, months, { withheld: 0 }).balance < 0, true, 'trop prélevé : remboursement');
	assert.equal(regularisation(1500, months, { withheld: 0 }).instalments, 1, '280 € : un seul prélèvement');
	assert.equal(regularisation(2000, months, { withheld: 0 }).instalments, 4);
	assert.equal(projectMonths(slips, 2024).length, 0);
});

test('currentLawFor: the voted scale while the year is still a bill', () => {
	assert.equal(currentLawFor(2026)?.incomeYear, 2025, 'revenus 2026 : loi de finances 2026 en vigueur');
	assert.equal(currentLawFor(2025), null, 'année déjà votée : pas de comparaison');
	const input = { salaries: [44254], otherIncome: 0, household: { couple: false, children: 0 }, reductions: 0 };
	const bill = computeTax(input, rulesFor(2026)).netTax;
	const current = computeTax(input, currentLawFor(2026)!).netTax;
	assert.ok(current > bill, `sans indexation l’impôt est plus élevé (${current} > ${bill})`);
});

test('rulesWarning: provisional scale after 1 January, missing year', () => {
	assert.equal(rulesWarning(2026, '2026-10-06'), null, 'projet en cours de vote : normal');
	assert.match(rulesWarning(2026, '2027-01-02')!, /mettre à jour/);
	assert.match(rulesWarning(2027, '2027-03-01')!, /pas encore dans l’app.*revenus 2026.*vient aussi encore du projet/);
	assert.equal(rulesWarning(2025, '2027-05-01'), null, 'année votée : rien à signaler');
});

test('defaultTaxYear: last year until October unless its notice is there', () => {
	assert.equal(defaultTaxYear('2027-03-10', false), 2026);
	assert.equal(defaultTaxYear('2027-08-20', true), 2027, 'avis reçu : année en cours');
	assert.equal(defaultTaxYear('2026-10-06', false), 2026);
	assert.equal(defaultTaxYear('2027-12-01', false), 2027);
});

test('isUnemploymentBenefit: France Travail and Pôle emploi credits', () => {
	assert.equal(isUnemploymentBenefit('VIR FRANCE TRAVAIL ARE 202603'), true);
	assert.equal(isUnemploymentBenefit('Pôle Emploi'), true);
	assert.equal(isUnemploymentBenefit('POLEEMPLOI'), true);
	assert.equal(isUnemploymentBenefit('VIREMENT SALAIRE ACME'), false);
	assert.equal(isUnemploymentBenefit('Travail Temporaire Interim'), false);
});
