import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Transaction } from '../src/lib/types';
import { categorize, ruleFor, setVacationPredicate, type CatRule } from '../src/lib/categories';
import { MERCHANT_DICT, merchantDictFor } from '../src/lib/merchantDict';
import { SUB_MERCHANT_DICT, subMerchantDictFor } from '../src/lib/subDict';
import { merchantKey, rawLabelKey } from '../src/lib/merchant';

/** Classification (batch 5 of the review): refunds, sales, Krak card, TotalEnergies, holidays. */

const tx = (label: string, amount: number, extra: Partial<Transaction> = {}): Transaction => ({
	transaction_amount: { amount: Math.abs(amount).toFixed(2), currency: 'EUR' },
	booking_date: '2026-08-10',
	value_date: '2026-08-10',
	remittance_information: [label],
	credit_debit_indicator: amount >= 0 ? 'CRDT' : 'DBIT',
	...extra
});
const cat = (t: Transaction) => categorize(t, {}, [], new Map());

/** The bank category of a credit counts (CM CSV). */
test('refunds: the merchant wins over the generic word REMBOURSEMENT', () => {
	assert.equal(cat(tx('VIR REMBOURSEMENT CPAM', 28.4)), 'sante');
	assert.equal(cat(tx('VIR MUTUELLE MGEN REMBOURSEMENT', 40)), 'sante');
	assert.equal(cat(tx('VIR SNCF REMBOURSEMENT BILLET', 35)), 'transport');
	assert.equal(cat(tx('VIR SALAIRE ACME SAS', 2450)), 'revenus');
	assert.equal(cat(tx('VIR CPAM DE LA CHARENTE', 12, { bank_category: 'Santé' })), 'sante');
});

test('Krak card: a credit is never income; a Vinted sale on the bank account = income', () => {
	assert.equal(cat(tx('CARTE KRAK Leboncoin', 132.19, { account: 'krak-card' })), 'autre');
	assert.equal(cat(tx('CARTE KRAK Amazon', 19.9, { account: 'krak-card' })), 'loisirs');
	assert.equal(cat(tx('VIR VINTED', 300)), 'revenus', 'une vente, pas un remboursement qui rend les Loisirs négatifs');
});

test('TotalEnergies: direct debit = energy, card payment = fuel (Voiture)', () => {
	assert.equal(cat(tx('PRLV SEPA TOTALENERGIES ELECTRICITE ET GAZ', -80)), 'energie');
	assert.equal(cat(tx('PAIEMENT CB 0408 POITIERS TOTALENERGIES CARTE 1234', -70)), 'voiture');
	assert.equal(cat(tx('CARTE KRAK TotalEnergies', -80, { account: 'krak-card' })), 'voiture');
	assert.equal(cat(tx('PAIEMENT CB 0408 RELAIS TOTAL', -50)), 'voiture');
});

test('tokens mangled by merchantKey: looked up in the raw label', () => {
	assert.equal(merchantKey(['CARTE KRAK CT 16']), 'CT');
	assert.equal(cat(tx('CARTE KRAK CT 16', -78, { account: 'krak-card' })), 'voiture');
	assert.equal(cat(tx('PRLV SEPA CENTURY 21 GESTION', -650)), 'logement');
});

test('false friends: AUBERGE, HOTEL DE VILLE, SUMUP, ACTION LOGEMENT', () => {
	assert.notEqual(cat(tx('PAIEMENT CB 1208 AUBERGE DU PONT', -45)), 'vacances');
	assert.equal(cat(tx('PAIEMENT CB 1208 HOTEL DE VILLE POITIERS', -12)), 'autre');
	assert.notEqual(cat(tx('PAIEMENT PSC 1208 SUMUP *COIFFURE', -25)), 'alimentation');
	assert.equal(cat(tx('PRLV SEPA ACTION LOGEMENT SERVICES', -120)), 'logement');
});

test('Impôts and Épargne & transferts categories', () => {
	assert.equal(cat(tx('PRLV SEPA DGFIP IMPOT 2025', -1200)), 'impots');
	assert.equal(cat(tx('VIR LIVRET A', -500)), 'epargne');
	assert.equal(cat(tx('VIR LIVRET A', 500)), 'epargne', 'retour de l’épargne : pas un revenu');
	assert.equal(cat(tx('VIR SEPA LIVRET BLEU', -200, { bank_category: 'Epargne' })), 'epargne');
	assert.equal(cat(tx('VIR 102780000100012345680', -300, { bank_category: 'Hors budget' })), 'epargne');
});

test('holidays: variable spending yes, fixed costs from « autre » no', () => {
	setVacationPredicate(() => true);
	try {
		assert.equal(cat(tx('PAIEMENT CB 1002 LE REFUGE RESTAURANT CARTE 1234', -40)), 'vacances');
		assert.equal(cat(tx('ECH PRET PERSO 00000000000000000000001', -150)), 'autre');
		assert.equal(cat(tx('F COTIS EUROCOMPTE CONFORT', -12.8)), 'autre');
		assert.equal(cat(tx('VIR INST A UN PROCHE', -200)), 'autre');
	} finally {
		setVacationPredicate(null);
	}
});

test('rules: the most specific one wins, not the oldest', () => {
	const rules: CatRule[] = [
		{ keyword: 'POITIERS', categoryId: 'loisirs', createdAt: 1 },
		{ keyword: 'POITIERS CED E LECLERC', categoryId: 'alimentation', createdAt: 2 }
	];
	assert.equal(ruleFor(tx('PAIEMENT CB 0308 POITIERS CED E LECLERC', -60), rules)?.categoryId, 'alimentation');
	assert.equal(ruleFor(tx('RETRAIT DAB 1507 POITIERS', -60), rules)?.categoryId, 'loisirs');
});

test('dictionaries: every token matches a label that contains it (no dead token)', () => {
	const dead: string[] = [];
	for (const [c, tokens] of Object.entries(MERCHANT_DICT)) {
		if (c === 'revenus') continue;
		for (const token of tokens) {
			const label = [`PAIEMENT CB 0101 ${token}`];
			if (merchantDictFor(merchantKey(label), rawLabelKey(label)) === undefined) dead.push(token);
		}
	}
	for (const tokens of Object.values(SUB_MERCHANT_DICT)) {
		for (const token of tokens) {
			const label = [`PAIEMENT CB 0101 ${token}`];
			if (!subMerchantDictFor(merchantKey(label), rawLabelKey(label))) dead.push(token);
		}
	}
	assert.deepEqual(dead, []);
});
