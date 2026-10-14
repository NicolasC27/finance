import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildStay, DEFAULT_SPLIT, describeEstimate, estimateFor, estimatedEnvelopes, monthsUntil, savingsPlan, seasonOf, shares, splitBudget } from '../src/lib/tripEstimates';
import type { EnvelopeId } from '../src/lib/trips';

const env = (p: Partial<Record<EnvelopeId, number>>): Record<EnvelopeId, number> => ({ transport: 0, hebergement: 0, repas: 0, activites: 0, assurance: 0, extras: 0, ...p });
const stay = (id: string, label: string, country: string, start: string, end: string, by: Partial<Record<EnvelopeId, number>>) => buildStay({ id, label, start, end }, country, env(by))!;
const basque = stay('b', 'Pays basque', '', '2025-08-02', '2025-08-14', { hebergement: 642, repas: 200, activites: 68 });
const tignes = stay('t', 'Ski à Tignes', '', '2026-02-14', '2026-02-21', { activites: 597, repas: 120 });
const rome = stay('r', 'Rome en mai', 'Italie', '2025-05-01', '2025-05-05', { repas: 150, activites: 100 });
const money = (n: number) => `${n} €`;

test('seasonOf: meteorological seasons, null without a month', () => {
	assert.equal(seasonOf('2026-02-14'), 'hiver');
	assert.equal(seasonOf('2026-12-01'), 'hiver');
	assert.equal(seasonOf('2025-04-10'), 'printemps');
	assert.equal(seasonOf('2025-08-02'), 'ete');
	assert.equal(seasonOf('2025-10-01'), 'automne');
	assert.equal(seasonOf(''), null);
});

test('buildStay: days, total and per day; nothing without spending or dates', () => {
	assert.equal(basque.days, 13);
	assert.equal(basque.total, 910);
	assert.equal(basque.perDay, 70);
	assert.equal(basque.season, 'ete');
	assert.equal(buildStay({ id: 'x', label: 'x', start: '2025-01-01', end: '2025-01-03' }, '', env({})), null);
	assert.equal(buildStay({ id: 'x', label: 'x', start: '', end: '' }, '', env({ repas: 10 })), null);
});

test('estimateFor: same place first, then same season, then all stays; none without history', () => {
	const stays = [basque, tignes, rome];
	assert.equal(estimateFor({ destination: 'Lisbonne', country: 'Portugal', start: '2027-04-10' }, []), null);
	const italy = estimateFor({ destination: 'Florence', country: 'Italie', start: '2027-04-10' }, stays)!;
	assert.equal(italy.basis, 'destination');
	assert.equal(italy.stays[0]!.id, 'r');
	assert.equal(italy.perDay, 50);
	const byLabel = estimateFor({ destination: 'Pays basque', country: '', start: '2027-02-01' }, stays)!;
	assert.equal(byLabel.basis, 'destination');
	assert.equal(byLabel.stays[0]!.id, 'b');
	const summer = estimateFor({ destination: 'Lisbonne', country: 'Portugal', start: '2026-07-01' }, stays)!;
	assert.equal(summer.basis, 'saison');
	assert.equal(summer.perDay, 70);
	const autumn = estimateFor({ destination: 'Lisbonne', country: 'Portugal', start: '2026-10-01' }, stays)!;
	assert.equal(autumn.basis, 'moyenne');
	assert.equal(autumn.stays.length, 3);
	assert.equal(autumn.perDay, Math.round(((70 + 89.63 + 50) / 3) * 100) / 100);
	assert.equal(autumn.stays[0]!.id, 't');
});

test('splitBudget: tens of euros by the shares, the biggest envelope taking the remainder, the default split when nothing is known', () => {
	assert.deepEqual(splitBudget(1000), { transport: 350, hebergement: 350, repas: 180, activites: 120 });
	const odd = splitBudget(995);
	assert.equal(Object.values(odd).reduce((s, v) => s + v, 0), 995);
	assert.equal(odd.transport, 345);
	const fromStay = splitBudget(700, shares(basque.byEnvelope));
	assert.equal(Object.values(fromStay).reduce((s, v) => s + v, 0), 700);
	assert.deepEqual(Object.keys(fromStay).sort(), ['activites', 'hebergement', 'repas']);
	assert.deepEqual(splitBudget(0), {});
	assert.deepEqual(splitBudget(1000, env({})), splitBudget(1000, DEFAULT_SPLIT));
	assert.deepEqual(splitBudget(4), { extras: 4 });
});

test('estimatedEnvelopes: the per-day figure over the days, split like the stay', () => {
	const e = estimateFor({ destination: 'Pays basque', country: '', start: '2027-08-01' }, [basque])!;
	const envelopes = estimatedEnvelopes(e, 7);
	assert.equal(Object.values(envelopes).reduce((s, v) => s + v, 0), 490);
	assert.ok(envelopes.hebergement! > envelopes.repas!);
	assert.deepEqual(estimatedEnvelopes(e, 0), {});
});

test('monthsUntil and savingsPlan', () => {
	assert.equal(monthsUntil('2026-10-08', '2027-04-10'), 6);
	assert.equal(monthsUntil('2026-10-08', '2026-10-30'), 1);
	assert.equal(monthsUntil('2026-10-08', '2026-01-01'), 1);
	const trip = { start: '2027-04-10', envelopes: { transport: 320, hebergement: 560, repas: 350, activites: 120, extras: 80 } };
	assert.deepEqual(savingsPlan(trip, 0, 880.5, '2026-10-08'), { remaining: 549.5, months: 6, monthly: 92 });
	assert.deepEqual(savingsPlan(trip, 2000, 0, '2026-10-08'), { remaining: 0, months: 6, monthly: 0 });
	assert.equal(savingsPlan({ start: '', envelopes: trip.envelopes }, 0, 0, '2026-10-08'), null);
	assert.equal(savingsPlan({ start: '2026-10-01', envelopes: trip.envelopes }, 0, 0, '2026-10-08'), null);
	assert.equal(savingsPlan({ start: '2027-04-10', envelopes: {} }, 0, 0, '2026-10-08'), null);
});

test('describeEstimate: one sentence per basis', () => {
	const stays = [basque, tignes, rome];
	assert.equal(describeEstimate(estimateFor({ destination: 'Rome', country: 'Italie', start: '2027-04-10' }, stays)!, money), 'Rome en mai (mai 2025) t’a coûté 50 €/jour');
	assert.equal(describeEstimate(estimateFor({ destination: 'Lisbonne', country: '', start: '2026-07-01' }, stays)!, money), 'ton séjour d’été : 70 €/jour');
	assert.equal(describeEstimate(estimateFor({ destination: 'Lisbonne', country: '', start: '2026-10-01' }, stays)!, money), 'tes 3 séjours : 69.88 €/jour en moyenne');
});
