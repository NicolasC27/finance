import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assignDupIndexes, txKey } from '../src/lib/categories';
import type { Transaction } from '../src/lib/types';

/** Strict duplicates of the same batch: two identical coffees on the same day stay two transactions. */

const cafe = (): Transaction => ({
	transaction_amount: { amount: '2.50', currency: 'EUR' },
	booking_date: '2026-09-12',
	value_date: '2026-09-12',
	remittance_information: ['PAIEMENT CB 1209 POITIERS CAFE DU COIN'],
	credit_debit_indicator: 'DBIT'
});

test('assignDupIndexes: the 2nd identical occurrence gets an index, the 1st keeps its historical key', () => {
	const [a, b, c] = assignDupIndexes([cafe(), cafe(), cafe()]);
	assert.equal(a!.dup_index, undefined);
	assert.equal(b!.dup_index, 1);
	assert.equal(c!.dup_index, 2);
	assert.equal(txKey(a!), txKey(cafe()), 'clé de la 1re occurrence inchangée (overrides existants préservés)');
	assert.equal(new Set([a, b, c].map((t) => txKey(t!))).size, 3);
});

test('assignDupIndexes: re-importing the same batch gives exactly the same keys', () => {
	const first = assignDupIndexes([cafe(), cafe()]).map(txKey);
	const again = assignDupIndexes([cafe(), cafe()]).map(txKey);
	assert.deepEqual(first, again);
});

test('assignDupIndexes: different transactions left untouched', () => {
	const other = { ...cafe(), transaction_amount: { amount: '3.10', currency: 'EUR' } };
	const out = assignDupIndexes([cafe(), other]);
	assert.equal(out[0]!.dup_index, undefined);
	assert.equal(out[1]!.dup_index, undefined);
});
