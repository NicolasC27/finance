import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CategoryId, Transaction } from '../src/lib/types';
import { annotateMonth, MAX_NOTES } from '../src/lib/annotations';

/** Annotated statement of the monthly report. */

const tx = (label: string, date: string, amount: number, cat: CategoryId = 'loisirs'): Transaction => ({
	transaction_amount: { amount: Math.abs(amount).toFixed(2), currency: 'EUR' },
	booking_date: date,
	value_date: date,
	remittance_information: [label],
	credit_debit_indicator: amount >= 0 ? 'CRDT' : 'DBIT',
	virtual_category: cat
});
const catOf = (t: Transaction): CategoryId => t.virtual_category as CategoryId;
const kinds = (txs: Transaction[]) => annotateMonth(txs, '2026-09', catOf).map((n) => [n.tx.remittance_information[0], n.kind]);

const history = [tx('BOULANGERIE DUPONT', '2026-06-03', -8), tx('BOULANGERIE DUPONT', '2026-07-03', -9), tx('BOULANGERIE DUPONT', '2026-08-03', -10)];

test('annotations: the biggest expense comes first', () => {
	const notes = annotateMonth([...history, tx('MAGASIN MEUBLES', '2026-09-12', -480), tx('BOULANGERIE DUPONT', '2026-09-02', -9)], '2026-09', catOf);
	assert.equal(notes[0]!.kind, 'biggest');
	assert.equal(notes[0]!.amount, 480);
	assert.equal(notes[0]!.note, 'plus grosse dépense du mois');
});

test('annotations: an amount far above the merchant habit is flagged with the ratio', () => {
	const notes = annotateMonth([...history, tx('MAGASIN MEUBLES', '2026-09-12', -480), tx('BOULANGERIE DUPONT', '2026-09-20', -45)], '2026-09', catOf);
	const unusual = notes.find((n) => n.kind === 'unusual');
	assert.ok(unusual);
	assert.match(unusual.note, /^5× plus que d'habitude/);
});

test('annotations: a merchant first seen last month and debited again the same amount starts a subscription', () => {
	assert.deepEqual(kinds([...history, tx('MUSIQUE PREMIUM', '2026-08-05', -13.37, 'abonnements'), tx('MUSIQUE PREMIUM', '2026-09-05', -13.37, 'abonnements'), tx('MAGASIN MEUBLES', '2026-09-12', -480)]), [
		['MAGASIN MEUBLES', 'biggest'],
		['MUSIQUE PREMIUM', 'subscription']
	]);
});

test('annotations: new merchants need two earlier months of history and 20 € or more', () => {
	const month = [tx('MAGASIN MEUBLES', '2026-09-12', -480), tx('LIBRAIRIE CENTRALE', '2026-09-14', -32), tx('KIOSQUE', '2026-09-15', -4)];
	assert.deepEqual(kinds([...history, ...month]), [
		['MAGASIN MEUBLES', 'biggest'],
		['LIBRAIRIE CENTRALE', 'new']
	]);
	assert.deepEqual(kinds(month), [['MAGASIN MEUBLES', 'biggest']]);
});

test('annotations: income, refunds and other months are ignored; at most five notes', () => {
	assert.deepEqual(annotateMonth([tx('SALAIRE', '2026-09-28', 2000, 'revenus')], '2026-09', catOf), []);
	const shops = ['ATELIER', 'BAZAR', 'CAVE', 'DROGUERIE', 'EPICERIE', 'FLEURISTE', 'GALERIE', 'HALLE', 'IMPRIMERIE'];
	const many = shops.map((name, i) => tx(name, '2026-09-10', -(30 + i)));
	assert.equal(annotateMonth([...history, ...many], '2026-09', catOf).length, MAX_NOTES);
});
