import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CategoryId, Transaction } from '../src/lib/types';
import { txKey } from '../src/lib/categories';
import {
	dayDate,
	datesSentence,
	elsewhereLabel,
	fileTarget,
	historyCountLabel,
	merchantHistory,
	monthName,
	priceChange,
	priceChangeLabel,
	type HistoryBar
} from '../src/lib/operationDetail';

/** Detail of an operation: the dates sentence and the merchant history line (#89). */

const op = (label: string, date: string, amount: number, extra: Partial<Transaction> = {}): Transaction => ({
	transaction_amount: { amount: Math.abs(amount).toFixed(2), currency: 'EUR' },
	booking_date: date,
	value_date: date,
	remittance_information: [label],
	credit_debit_indicator: amount >= 0 ? 'CRDT' : 'DBIT',
	source: 'cm-csv',
	...extra
});

const bar = (amount: number, date = '2026-01-10'): HistoryBar => ({ key: `${date}|${amount}`, date, amount, current: false });

test('datesSentence: une seule date quand achat et débit coïncident', () => {
	assert.equal(datesSentence({ purchase: '2026-08-19', booking: '2026-08-19', credit: false }, 2026), 'Débité le 19 août');
	assert.equal(datesSentence({ purchase: '', booking: '2026-08-19', credit: true }, 2026), 'Crédité le 19 août');
});

test('datesSentence: achat puis débit, le mois écrit une fois', () => {
	assert.equal(datesSentence({ purchase: '2026-08-18', booking: '2026-08-19', credit: false }, 2026), 'Acheté le 18 août · débité le 19');
	assert.equal(datesSentence({ purchase: '2026-09-30', booking: '2026-10-02', credit: false }, 2026), 'Acheté le 30 sept. · débité le 2 oct.');
	assert.equal(datesSentence({ purchase: '2026-08-18', booking: '2026-08-19', credit: false, withdrawal: true }, 2026), 'Retiré le 18 août · débité le 19');
	assert.equal(datesSentence({ purchase: '2026-08-18', booking: '2026-08-20', credit: true }, 2026), 'Le 18 août · crédité le 20');
});

test('datesSentence: l’année seulement hors de l’année en cours ou à cheval', () => {
	assert.equal(datesSentence({ purchase: '2025-12-30', booking: '2026-01-02', credit: false }, 2026), 'Acheté le 30 déc. 2025 · débité le 2 janv.');
	assert.equal(datesSentence({ purchase: '2025-03-04', booking: '2025-03-05', credit: false }, 2026), 'Acheté le 4 mars 2025 · débité le 5');
});

test('datesSentence: en cours, échéance prévue, saisie rapide', () => {
	assert.equal(datesSentence({ purchase: '', booking: '', credit: false }, 2026), 'Pas encore débité');
	assert.equal(datesSentence({ purchase: '', booking: '2026-08-19', credit: false, state: 'pending' }, 2026), 'Le 19 août · pas encore débité');
	assert.equal(datesSentence({ purchase: '2026-08-18', booking: '2026-08-19', credit: false, state: 'pending' }, 2026), 'Acheté le 18 août · pas encore débité');
	assert.equal(datesSentence({ purchase: '2026-08-19', booking: '2026-08-19', credit: true, state: 'pending' }, 2026), 'Le 19 août · pas encore crédité');
	assert.equal(datesSentence({ purchase: '', booking: '2026-11-05', credit: false, state: 'planned' }, 2026), 'Échéance prévue le 5 nov.');
	assert.equal(datesSentence({ purchase: '', booking: '2026-08-19', credit: false, state: 'typed' }, 2026), 'Payé le 19 août');
	assert.equal(datesSentence({ purchase: '', booking: '2026-08-19', credit: true, state: 'typed' }, 2026), 'Reçu le 19 août');
});

test('dayDate: « 1er » pour le premier du mois, l’année au besoin', () => {
	assert.equal(dayDate('2026-10-01', 2026), '1er oct.');
	assert.equal(dayDate('2026-08-19', 2026), '19 août');
	assert.equal(dayDate('2025-03-01', 2026), '1er mars 2025');
	assert.equal(dayDate('2026-03-01', 2026, true), '1er mars 2026');
	assert.equal(datesSentence({ purchase: '2026-09-30', booking: '2026-10-01', credit: false }, 2026), 'Acheté le 30 sept. · débité le 1er oct.');
	assert.equal(datesSentence({ purchase: '2026-10-01', booking: '2026-10-02', credit: false }, 2026), 'Acheté le 1er oct. · débité le 2');
});

test('monthName: l’année seulement hors de l’année donnée', () => {
	assert.equal(monthName('2026-03-12', 2026), 'mars');
	assert.equal(monthName('2025-12-01', 2026), 'décembre 2025');
});

test('priceChange: un prix fixe qui change, jamais des montants qui varient à chaque fois', () => {
	assert.deepEqual(priceChange([bar(9.99, '2026-05-02'), bar(9.99, '2026-06-02'), bar(12.39, '2026-07-02')]), { delta: 2.4, since: '2026-07-02' });
	assert.deepEqual(priceChange([bar(9.99), bar(9.99), bar(9.99), bar(12.39, '2026-07-02'), bar(12.39, '2026-08-02')]), { delta: 2.4, since: '2026-07-02' });
	assert.deepEqual(priceChange([bar(15), bar(15), bar(12.5, '2026-08-02')]), { delta: -2.5, since: '2026-08-02' });
	assert.equal(priceChange([bar(42.1), bar(17.3), bar(28.9)]), null);
	assert.equal(priceChange([bar(9.99), bar(12.39), bar(12.39)]), null);
	assert.equal(priceChange([bar(9.99), bar(9.99), bar(9.99)]), null);
	assert.equal(priceChange([bar(9.99), bar(12.39)]), null);
});

test('merchantHistory: même marchand et même sens, les plus anciens d’abord, l’opération ouverte marquée', () => {
	const ops = [
		op('PRLV SEPA STREAMFLIX ABONNEMENT', '2026-05-03', -9.99),
		op('PRLV SEPA STREAMFLIX ABONNEMENT', '2026-06-03', -9.99),
		op('PRLV SEPA STREAMFLIX ABONNEMENT', '2026-07-03', -12.39),
		op('PRLV SEPA STREAMFLIX ABONNEMENT', '2026-04-03', -9.99),
		op('VIR STREAMFLIX REMBOURSEMENT', '2026-06-10', 9.99),
		op('PAIEMENT CB 0207 EPICERIE FICTIVE', '2026-07-02', -23.4)
	];
	const open = ops[2]!;
	const cats = new Map<string, CategoryId>([[txKey(open), 'loisirs']]);
	const catOf = (t: Transaction): CategoryId => cats.get(txKey(t)) ?? 'abonnements';
	const h = merchantHistory(open, ops, catOf)!;
	assert.equal(h.count, 4);
	assert.equal(h.credit, false);
	assert.equal(h.first, '2026-04-03');
	assert.deepEqual(h.bars.map((b) => b.amount), [9.99, 9.99, 9.99, 12.39]);
	assert.deepEqual(h.bars.map((b) => b.current), [false, false, false, true]);
	assert.deepEqual(h.change, { delta: 2.4, since: '2026-07-03' });
	assert.deepEqual(h.elsewhere, { categoryId: 'abonnements', count: 3, of: 3 });
});

test('merchantHistory: Vacances, rangée par la date, ne compte jamais comme « ailleurs »', () => {
	const ops = [
		op('PAIEMENT CB BOULANGERIE FICTIVE', '2026-02-10', -4.2),
		op('PAIEMENT CB BOULANGERIE FICTIVE', '2026-02-16', -3.9),
		op('PAIEMENT CB BOULANGERIE FICTIVE', '2026-02-17', -5.1),
		op('PAIEMENT CB BOULANGERIE FICTIVE', '2026-03-02', -4.4)
	];
	const holiday = new Set([txKey(ops[1]!), txKey(ops[2]!)]);
	const catOf = (t: Transaction): CategoryId => (holiday.has(txKey(t)) ? 'vacances' : 'alimentation');
	assert.equal(merchantHistory(ops[1]!, ops, catOf)!.elsewhere, null);
	assert.equal(merchantHistory(ops[3]!, ops, catOf)!.elsewhere, null);
	const misfiled = (t: Transaction): CategoryId => (t === ops[3] ? 'loisirs' : catOf(t));
	assert.deepEqual(merchantHistory(ops[3]!, ops, misfiled)!.elsewhere, { categoryId: 'alimentation', count: 1, of: 1 });
});

test('merchantHistory: rien sans autre opération du marchand, ni pour une échéance prévue', () => {
	const alone = op('PAIEMENT CB 0207 EPICERIE FICTIVE', '2026-07-02', -23.4);
	assert.equal(merchantHistory(alone, [alone, op('PAIEMENT CB 0507 BOULANGERIE FICTIVE', '2026-07-05', -3.2)], () => 'alimentation'), null);
	const planned = op('PAIEMENT CB 0207 EPICERIE FICTIVE', '2026-09-02', -23.4, { source: 'manual', instalment: { n: 2, of: 3 }, value_date: '' });
	assert.equal(merchantHistory(alone, [alone, planned], () => 'alimentation'), null);
});

test('merchantHistory: au plus `max` barres, les plus récentes; elsewhere nul quand tout est rangé pareil', () => {
	const ops = Array.from({ length: 15 }, (_, i) => op('PAIEMENT CB EPICERIE FICTIVE', `2026-0${1 + Math.floor(i / 2)}-1${i % 2}`, -(10 + i)));
	const h = merchantHistory(ops[14]!, ops, () => 'alimentation')!;
	assert.equal(h.count, 15);
	assert.equal(h.bars.length, 12);
	assert.equal(h.bars[0]!.amount, 13);
	assert.equal(h.bars.at(-1)!.current, true);
	assert.equal(h.change, null);
	assert.equal(h.elsewhere, null);
});

test('merchantHistory: l’opération ouverte compte même absente de la liste', () => {
	const ops = [op('PAIEMENT CB EPICERIE FICTIVE', '2026-07-01', -12)];
	const open = op('PAIEMENT CB EPICERIE FICTIVE', '', -14, { value_date: '' });
	const h = merchantHistory(open, ops, () => 'alimentation')!;
	assert.equal(h.count, 2);
	assert.deepEqual(h.bars.map((b) => b.current), [false, true]);
	assert.equal(h.first, '2026-07-01');
});

test('fileTarget: classer comme les autres seulement quand plus de la moitié sont ailleurs', () => {
	const ops = [
		op('PAIEMENT CB LIBRAIRIE FICTIVE', '2026-03-04', -12),
		op('PAIEMENT CB LIBRAIRIE FICTIVE', '2026-04-04', -15),
		op('PAIEMENT CB LIBRAIRIE FICTIVE', '2026-05-04', -9),
		op('PAIEMENT CB LIBRAIRIE FICTIVE', '2026-06-04', -11),
		op('PAIEMENT CB LIBRAIRIE FICTIVE', '2026-07-04', -14)
	];
	const open = ops[4]!;
	const filed = (others: CategoryId[]) => {
		const cats = new Map(ops.slice(0, 4).map((o, i) => [txKey(o), others[i]!] as const));
		return merchantHistory(open, ops, (t) => cats.get(txKey(t)) ?? 'autre')!;
	};
	assert.equal(fileTarget(filed(['loisirs', 'loisirs', 'loisirs', 'autre'])), 'loisirs');
	assert.equal(fileTarget(filed(['loisirs', 'loisirs', 'autre', 'autre'])), null);
	assert.equal(fileTarget(filed(['loisirs', 'loisirs', 'sante', 'autre'])), null);
	assert.equal(fileTarget(filed(['loisirs', 'loisirs', 'vacances', 'vacances'])), 'loisirs');
	assert.equal(fileTarget(filed(['autre', 'autre', 'autre', 'autre'])), null);
});

test('libellés: nombre et période, variation de prix (masquée en mode discret), autres catégories', () => {
	const ops = [op('VIR SEPA EMPLOYEUR FICTIF SALAIRE', '2025-12-28', 1000), op('VIR SEPA EMPLOYEUR FICTIF SALAIRE', '2026-01-28', 1000)];
	const h = merchantHistory(ops[1]!, ops, () => 'revenus')!;
	assert.equal(historyCountLabel(h, 2026), '2 versements depuis décembre 2025');
	assert.equal(historyCountLabel({ ...h, credit: false, count: 7, first: '2026-03-02' }, 2026), '7 paiements depuis mars');
	assert.equal(priceChangeLabel({ delta: 2.4, since: '2026-08-02' }, false, false, 2026), 'prix +2,40 € depuis août');
	assert.equal(priceChangeLabel({ delta: -2.5, since: '2026-08-02' }, false, false, 2026), 'prix −2,50 € depuis août');
	assert.equal(priceChangeLabel({ delta: 2.4, since: '2026-08-02' }, true, false, 2026), 'prix en hausse depuis août');
	assert.equal(priceChangeLabel({ delta: 50, since: '2026-06-02' }, false, true, 2026), 'montant +50,00\u00a0€ depuis juin');
	assert.equal(elsewhereLabel({ categoryId: 'abonnements', count: 6, of: 6 }), '6 autres en Abonnements');
	assert.equal(elsewhereLabel({ categoryId: 'loisirs', count: 1, of: 4 }), '1 autre en Loisirs');
});
