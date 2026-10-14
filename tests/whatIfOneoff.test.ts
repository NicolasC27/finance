import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readScenarios, simulate, type Baseline } from '../src/lib/whatIf';

const BASE: Baseline = { income: 3000, expenses: 2200, loanPrincipal: 0, netWorth: 10000, realRate: 2 };

test('a dated one-off leaves the wealth in its month, not today', () => {
	const plain = simulate(BASE, [], 12);
	const dated = simulate(BASE, [{ id: 'o', type: 'oneoff', label: 'Voyage', amount: 1200, month: 3 }], 12);
	assert.equal(dated.path[0], plain.path[0]);
	assert.equal(dated.path[2], plain.path[2]);
	assert.equal(dated.path[3], plain.path[3]! - 1200);
	assert.ok(dated.path[12]! < plain.path[12]! - 1200);
	assert.equal(dated.oneOff, 1200);
	const beyond = simulate(BASE, [{ id: 'o', type: 'oneoff', label: 'Loin', amount: 1200, month: 30 }], 12);
	assert.deepEqual(beyond.path, plain.path);
});

test('readScenarios keeps the month of a one-off, drops it when meaningless', () => {
	const read = readScenarios([{ id: 's', name: 'n', changes: [{ id: 'a', type: 'oneoff', label: '', amount: 5, month: 4 }, { id: 'b', type: 'oneoff', label: '', amount: 5, month: 0 }, { id: 'c', type: 'expense', label: '', amount: 5, month: 4 }] }]);
	assert.equal(read[0]!.changes[0]!.month, 4);
	assert.equal('month' in read[0]!.changes[1]!, false);
	assert.equal('month' in read[0]!.changes[2]!, false);
});
