import { test } from 'node:test';
import assert from 'node:assert/strict';
import { benefitTaxable, benefitYear, looksLikeFranceTravailStatement, paidMonthOf, mergeBenefitMonths, parseFranceTravailStatement } from '../src/lib/franceTravail';

const page = (texts: string[]) => [texts.map((text, i) => ({ y: i, items: [], text }))];

const STATEMENT = page([
	'Numéro France Travail 00000000000',
	'RELEVE DE SITUATION DU 30/05/2026',
	'PERIODE DU 06/03/2026 AU 31/03/2026 (26 jours)',
	'Carence 26',
	'PERIODE DU 01/04/2026 AU 30/04/2026 (30 jours)',
	'Carence 3',
	"Allocation d'Aide au 27 1 620,00 81,00 101,25 98,00 1 339,75",
	"Retour à l'Emploi",
	'Le montant de l’impôt sur le revenu prélevé à la source est de 98,00 €, calculé sur la base d’un taux',
	'personnalisé de 7,00 % transmis par la Direction générale des Finances publiques (DGFIP).',
	'FRANCE TRAVAIL EXEMPLE'
]);

test('parseFranceTravailStatement: month, amounts due, rate', () => {
	assert.equal(looksLikeFranceTravailStatement(STATEMENT), true);
	const r = parseFranceTravailStatement(STATEMENT);
	assert.ok(!('error' in r));
	assert.equal(r.rate, 7);
	assert.equal(r.statement, '2026-05-30');
	assert.deepEqual(r.months, [{ month: '2026-04', days: 27, gross: 1620, pension: 81, social: 101.25, tax: 98, net: 1339.75, rate: 7, statement: '2026-05-30' }]);
	assert.equal(benefitTaxable(r.months[0]!), 1400, 'base du prélèvement : 98 ÷ 7 %');
});

test('parseFranceTravailStatement: amounts already paid on the line, the amounts due count', () => {
	const r = parseFranceTravailStatement(page(['FRANCE TRAVAIL', 'RELEVE DE SITUATION DU 01/07/2026', 'PERIODE DU 01/06/2026 AU 30/06/2026 (30 jours)', "Allocation d'Aide au 30 1 800,00 90,00 112,50 112,00 1 485,50 30 1 800,00 90,00 112,50 112,00 1 485,50"]));
	assert.ok(!('error' in r));
	assert.equal(r.months[0]!.net, 1485.5);
	assert.equal(r.months[0]!.gross, 1800);
});

test('parseFranceTravailStatement: amounts on the line below, no thousands space', () => {
	const r = parseFranceTravailStatement(page(['FRANCE TRAVAIL', 'RELEVE DE SITUATION DU 29/07/2026', 'FT00 PERIODE DU 01/07/2026 AU 31/07/2026 (31 jours)', "Allocation d'Aide au", '31 2000,50 100,00 120,00 140,00 1640,50', "Retour à l'Emploi"]));
	assert.ok(!('error' in r));
	assert.deepEqual([r.months[0]!.month, r.months[0]!.days, r.months[0]!.gross, r.months[0]!.net], ['2026-07', 31, 2000.5, 1640.5]);
});

test('parseFranceTravailStatement: other documents refused', () => {
	assert.equal(looksLikeFranceTravailStatement(page(['Avis de situation déclarative', 'impots.gouv.fr'])), false);
	assert.ok('error' in parseFranceTravailStatement(page(['RELEVE DE SITUATION DU 01/03/2026', 'FRANCE TRAVAIL', 'Carence 7'])));
});

test('benefitTaxable without a rate, mergeBenefitMonths keeps the newest statement', () => {
	const m = { month: '2026-05', days: 31, gross: 1000, pension: 50, social: 67, tax: 0, net: 883, rate: 0, statement: '2026-06-01' };
	assert.equal(benefitTaxable(m), 912);
	const merged = mergeBenefitMonths([m], [{ ...m, net: 900, statement: '2026-06-15' }, { ...m, month: '2026-04' }]);
	assert.deepEqual(merged.map((x) => `${x.month}:${x.net}`), ['2026-04:883', '2026-05:900']);
	assert.equal(mergeBenefitMonths(merged, [{ ...m, net: 1, statement: '2026-05-01' }])[1]!.net, 900, 'un relevé plus ancien ne remplace pas');
});

test('benefitYear and paidMonthOf: taxed when paid, a credit pays the month before', () => {
	const base = { month: '2026-12', days: 31, gross: 1000, pension: 50, social: 67, tax: 70, net: 813, rate: 7, statement: '2027-01-02' };
	assert.equal(benefitYear({ ...base, paidOn: '2027-01-05' }), 2027);
	assert.equal(benefitYear(base), 2026, 'sans date de règlement : mois de la période');
	assert.equal(paidMonthOf('2026-05-04'), '2026-04');
	assert.equal(paidMonthOf('2027-01-05'), '2026-12');
});
