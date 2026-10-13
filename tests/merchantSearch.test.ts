import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Transaction } from '../src/lib/types';
import { latestMerchantQuery, listLabel, matchesSearch, merchantSearchQuery, spelledStretch, transactionSearchText } from '../src/lib/merchantSearch';

const tx = (label: string, extra: Partial<Transaction> = {}, date = '2026-10-12'): Transaction => ({
	transaction_amount: { amount: '12.00', currency: 'EUR' },
	booking_date: date,
	value_date: date,
	remittance_information: [label],
	credit_debit_indicator: 'DBIT',
	...extra
});

test('short name found in the operation: searched as shown', () => {
	const t = tx('PRLV SEPA ENERGIE CLIENTS PARTICULIERS');
	assert.equal(merchantSearchQuery(t), 'Energie Clients Particuliers');
	assert.ok(matchesSearch(t, merchantSearchQuery(t)));
});

test('card payment: the stretch spelling the merchant, without the card date, lists its other days', () => {
	const t = tx('PAIEMENT CB 1210 VILLEFICTIVE E.MARCHE CARTE 1234');
	assert.equal(listLabel(t), 'Villefictive E Marche');
	assert.equal(matchesSearch(t, listLabel(t)), false, 'le nom affiché ne trouve pas l’opération');
	const q = merchantSearchQuery(t);
	assert.equal(q, 'villefictive e.marche');
	assert.ok(matchesSearch(t, q));
	assert.ok(matchesSearch(tx('PAIEMENT CB 0309 VILLEFICTIVE E.MARCHE CARTE 1234', {}, '2026-09-04'), q), 'même marchand, autre jour');
	assert.equal(matchesSearch(tx('PAIEMENT CB 1210 VILLEFICTIVE BOULANGERIE CARTE 1234'), q), false, 'autre marchand de la ville');
});

test('dotted name and accents of the raw label are spelled as they are written', () => {
	assert.equal(merchantSearchQuery(tx('PRLV SEPA STREAMFLIX.COM')), 'streamflix.com');
	const cafe = tx('PAIEMENT CB 1210 VILLEFICTIVE CAFÉ DU PORT CARTE 1234');
	assert.equal(merchantSearchQuery(cafe), 'villefictive café du port');
	assert.ok(matchesSearch(cafe, merchantSearchQuery(cafe)));
});

test('a number between two words keeps the longest stretch, never a lone city', () => {
	assert.equal(merchantSearchQuery(tx('PAIEMENT CB 1210 VILLEFICTIVE 12 GARE EXPRESS CARTE 1234')), 'gare express');
	assert.equal(spelledStretch('Villefictive Gare Express Nord', 'cb villefictive 12 gare 3 express 4 nord'), null, 'moins de la moitié des mots : rien');
	assert.equal(spelledStretch('E Ab', 'e 1 ab'), null, 'trop court');
});

test('two-word name split by a number or a reference: both words and what stands between, never one word alone', () => {
	const shop = tx('PAIEMENT CB 1210 VILLEFICTIVE 15 BOULANGERIE CARTE 1234');
	assert.equal(listLabel(shop), 'Villefictive Boulangerie');
	assert.equal(spelledStretch('Villefictive Boulangerie', 'cb 1210 villefictive 15 boulangerie'), null, 'un mot seul sur deux : rien');
	const q = merchantSearchQuery(shop);
	assert.equal(q, 'villefictive 15 boulangerie');
	assert.ok(matchesSearch(tx('PAIEMENT CB 0309 VILLEFICTIVE 15 BOULANGERIE CARTE 1234', {}, '2026-09-03'), q), 'même boutique, autre jour');
	assert.equal(matchesSearch(tx('PAIEMENT CB 1210 VILLEFICTIVE PRIMEUR CARTE 1234'), q), false, 'pas toute la ville');
	assert.equal(merchantSearchQuery(tx('PRLV SEPA EXEMPLE REF12345-678 ASSURANCES')), 'exemple ref12345-678 assurances', 'jamais le seul mot générique');
	assert.equal(merchantSearchQuery(tx('PAIEMENT CB 1210 VILLEFICTIVE 12 GARE 3 EXPRESS 4 NORD CARTE 1234')), 'villefictive 12 gare 3 express 4 nord');
	assert.equal(merchantSearchQuery(tx('PAIEMENT CB 1210 VILLEFICTIVE 1 E 2 M CARTE 1234')), 'villefictive 1 e 2 m', 'sans la date de la carte');
});

test('name built in another order than the label: one of its words as a last resort', () => {
	const t = tx('KRAKEN CARTE ABCDE1-FG2HI-JK3LMN');
	assert.equal(listLabel(t), 'Carte Kraken');
	assert.equal(merchantSearchQuery(t), 'kraken');
	assert.ok(matchesSearch(tx('KRAKEN CARTE ZYXWV9-UT8SR-QP7ONM'), merchantSearchQuery(t)));
});

test('the query is read in the label, never in a note the other operations lack', () => {
	const t = tx('PAIEMENT CB 1210 VILLEFICTIVE E.MARCHE CARTE 1234', { note: 'Villefictive E Marche', tags: ['villefictive e marche'] });
	assert.equal(merchantSearchQuery(t), 'villefictive e.marche');
	assert.ok(matchesSearch(tx('PAIEMENT CB 0309 VILLEFICTIVE E.MARCHE CARTE 1234'), merchantSearchQuery(t)));
});

test('cash spend: its written label, accents included (the short name loses them)', () => {
	const t = tx('Liquide : marché', { source: 'cash' });
	assert.equal(merchantSearchQuery(t), 'Liquide : marché');
	assert.ok(matchesSearch(t, merchantSearchQuery(t)));
	assert.equal(matchesSearch(t, 'Liquide : Marche'), false);
});

test('portage entry: its month dropped, every month of the entry is listed', () => {
	const t = tx('Provision impôt · septembre 2026', { source: 'portage' });
	assert.equal(merchantSearchQuery(t), 'Provision impôt');
	assert.ok(matchesSearch(tx('Provision impôt · octobre 2026', { source: 'portage' }), merchantSearchQuery(t)));
});

test('dotted acronym joined in the short name: spelled with its dots, not a generic word alone', () => {
	const t = tx('REMBOURSEMENT C.P.A.M. 1210');
	assert.equal(listLabel(t), 'Remboursement CPAM');
	assert.equal(merchantSearchQuery(t), 'remboursement c.p.a.m');
	assert.equal(matchesSearch(tx('REMBOURSEMENT MUTUELLE 1210'), merchantSearchQuery(t)), false);
});

test('name not written in the label: the cleaned label, still found in the operation', () => {
	const t = tx('REM CHQ REF1234567');
	assert.equal(listLabel(t), 'Remise Cheque');
	const q = merchantSearchQuery(t);
	assert.equal(q, 'Rem Chq Ref1234567');
	assert.ok(matchesSearch(t, q));
	assert.equal(merchantSearchQuery(tx('')), '');
});

test('group of operations (a direct debit): the query of the latest one', () => {
	const group = [
		tx('PRLV SEPA STREAMFLIX.COM 0925', {}, '2026-09-25'),
		tx('PRLV SEPA STREAMFLIX.COM 1025', {}, '2026-10-25'),
		tx('PRLV SEPA STREAMFLIX.COM 0825', {}, '2026-08-25')
	];
	assert.equal(latestMerchantQuery(group), 'streamflix.com');
	assert.ok(group.every((t) => matchesSearch(t, latestMerchantQuery(group))));
	assert.equal(latestMerchantQuery([]), '');
});

test('every query finds its own operation (note and tags searched too)', () => {
	const labels = [
		'PAIEMENT CB 0402 VILLEFICTIVE SUPER 1234 CITY CARTE 1234',
		'RETRAIT DAB 1609 VILLEFICTIVE CARTE 1234',
		'ECH PRET AUTO 00000 000123 01',
		'VIR SEPA M. EXEMPLE',
		'PAYPAL *STREAMCO',
		'CB CAFÉ DE LA GARE 1210',
		'F COTIS EUROCOMPTE'
	];
	for (const label of labels) {
		const t = tx(label, { note: 'note libre', tags: ['vacances'] });
		const q = merchantSearchQuery(t);
		assert.ok(q !== '', label);
		assert.ok(transactionSearchText(t).includes(q.trim().toLowerCase()), label);
	}
});
