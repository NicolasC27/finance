import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attachKind, attachmentFor, normalizeLabel, placeTokens, TRAVEL_BRANDS } from '../src/lib/tripAttach';

const lisbon = { destination: 'Lisbonne', country: 'Portugal', start: '2027-04-10', end: '2027-04-16' };

test('normalizeLabel and placeTokens', () => {
	assert.equal(normalizeLabel(' Paiement CB 0110 Pastéis-de-Belém, LISBOA '), 'PAIEMENT CB 0110 PASTEIS DE BELEM LISBOA');
	assert.deepEqual(placeTokens({ destination: 'Pays basque', country: '' }), ['BASQUE']);
	const tokens = placeTokens(lisbon);
	assert.ok(tokens.includes('LISBONNE') && tokens.includes('PORTUGAL'));
	assert.ok(!tokens.some((t) => t.length < 4));
	assert.ok(TRAVEL_BRANDS.includes('AIRBNB') && TRAVEL_BRANDS.includes('IBERIA'));
	assert.ok(!TRAVEL_BRANDS.includes('SNCF'), 'everyday travel stays out');
	assert.equal(attachKind('PAIEMENT CB 2509 PARIS 12 SNCF CONNECT', lisbon), null);
});

test('attachKind: fees, brands, currencies, places, nothing', () => {
	assert.equal(attachKind('COMMISSION OPERATION ETRANGER 1,20', lisbon), 'frais');
	assert.equal(attachKind('PAIEMENT CB 0110 LISBOA TAP AIR PORTUGAL CARTE 1234', lisbon), 'marque');
	assert.equal(attachKind('PAIEMENT CB 0210 AIRBNB * STUDIO BAIXA', lisbon), 'marque');
	assert.equal(attachKind('PAIEMENT CB 1204 BANGKOK 1250,00 THB CARTE 1234', lisbon), 'devise');
	assert.equal(attachKind('PAIEMENT CB 1204 LISBONNE MERCEARIA CARTE 1234', lisbon), 'lieu');
	assert.equal(attachKind('PAIEMENT CB 1204 PORTUGAL TELECOM', lisbon), 'lieu');
	assert.equal(attachKind('PRLV SEPA EDF CLIENTS PARTICULIERS', lisbon), null);
	assert.equal(attachKind('PAIEMENT CB 0101 CARREFOUR MARKET', lisbon), null);
	assert.equal(attachKind('PAIEMENT CB 0101 LE PAYS DU PAIN', { destination: 'Pays basque', country: '' }), null);
	assert.equal(attachKind('', lisbon), null);
});

test('attachmentFor: each kind has its window around the trip', () => {
	assert.equal(attachmentFor('PAIEMENT CB 0110 TAP AIR PORTUGAL', '2026-10-01', lisbon), 'marque');
	assert.equal(attachmentFor('PAIEMENT CB 0110 TAP AIR PORTUGAL', '2026-03-01', lisbon), null);
	assert.equal(attachmentFor('PAIEMENT CB 0110 TAP AIR PORTUGAL', '2027-04-21', lisbon), 'marque');
	assert.equal(attachmentFor('PAIEMENT CB 0110 TAP AIR PORTUGAL', '2027-04-22', lisbon), null);
	assert.equal(attachmentFor('PAIEMENT CB 1804 BANGKOK 1250,00 THB', '2027-04-20', lisbon), 'devise');
	assert.equal(attachmentFor('PAIEMENT CB 1804 BANGKOK 1250,00 THB', '2027-05-05', lisbon), null);
	assert.equal(attachmentFor('PAIEMENT CB 0504 LISBONNE MERCEARIA', '2027-03-15', lisbon), 'lieu');
	assert.equal(attachmentFor('PAIEMENT CB 0504 LISBONNE MERCEARIA', '2027-03-01', lisbon), null);
	assert.equal(attachmentFor('COMMISSION OPERATION ETRANGER', '2027-04-25', lisbon), 'frais');
	assert.equal(attachmentFor('COMMISSION OPERATION ETRANGER', '2027-04-01', lisbon), null);
	assert.equal(attachmentFor('PAIEMENT CB 0110 TAP AIR PORTUGAL', '2026-10-01', { ...lisbon, start: '', end: '' }), null);
});
