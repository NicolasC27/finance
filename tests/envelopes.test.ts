import { test } from 'node:test';
import assert from 'node:assert/strict';
import { envelopeGauge, gaugeTitle } from '../src/lib/envelopes';

/** Envelope gauge of the category marks. */

test('envelope gauge: share of the budget, capped fill, over budget flagged', () => {
	assert.deepEqual(envelopeGauge(74, 100), { fill: 0.74, pct: 74, over: false });
	assert.deepEqual(envelopeGauge(150, 100), { fill: 1, pct: 150, over: true });
	assert.deepEqual(envelopeGauge(100, 100), { fill: 1, pct: 100, over: false });
});

test('envelope gauge: no budget, no gauge; refunds read as empty', () => {
	assert.equal(envelopeGauge(40, undefined), null);
	assert.equal(envelopeGauge(40, 0), null);
	assert.deepEqual(envelopeGauge(-12, 80), { fill: 0, pct: 0, over: false });
});

test('envelope gauge: tooltip names the category and the share', () => {
	assert.equal(gaugeTitle('Alimentation', { fill: 0.74, pct: 74, over: false }), "Alimentation · 74 % de l'enveloppe");
	assert.equal(gaugeTitle('Loisirs', { fill: 1, pct: 112, over: true }), "Loisirs · 112 % de l'enveloppe (dépassée)");
});
