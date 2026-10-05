import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coverage, readTarget, referenceSpending } from '../src/lib/emergencyFund';

test('épargne de précaution : référence robuste, mois couverts, état', () => {
	assert.equal(referenceSpending([2000, 2100, 1900, 9000]), (2000 + 2100 + 1900 + 2 * 2050) / 4, 'mois exceptionnel plafonné à 2× la médiane');
	assert.equal(referenceSpending([]), 0);
	assert.equal(referenceSpending(Array.from({ length: 15 }, (_, i) => (i < 3 ? 10000 : 2000))), 2000, '12 derniers mois seulement');
	assert.deepEqual(coverage(9000, 2000), { months: 4.5, state: 'within', missing: 0 });
	assert.deepEqual(coverage(4000, 2000), { months: 2, state: 'below', missing: 2000 });
	assert.equal(coverage(20000, 2000).state, 'above');
	assert.equal(coverage(20000, 2000, { min: 6, max: 12 }).state, 'within');
	assert.deepEqual(coverage(1000, 0), { months: null, state: 'unknown', missing: 0 });
	assert.deepEqual(readTarget({ min: 4, max: 2 }), { min: 3, max: 6 });
	assert.deepEqual(readTarget({ min: 2, max: 8 }), { min: 2, max: 8 });
});
