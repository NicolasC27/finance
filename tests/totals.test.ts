import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CategoryId, Transaction } from '../src/lib/types';
import { monthTotals, monthCutoffDay, dailyCumulativeSpend } from '../src/lib/totals';
import { monthFlows, buildEditorialSummary, buildMonthlyReport } from '../src/lib/report';
import { budgetRemaining } from '../src/lib/insights';
import { detectRecurring, forecastByCategory, forecastTotals } from '../src/lib/forecast';
import { extractLoanRecord } from '../src/lib/loans';
import { categorize } from '../src/lib/categories';

/** Single totals (2026-10-03 review): same figures everywhere, current month compared to date. */

const tx = (label: string, date: string, amount: number, extra: Partial<Transaction> = {}): Transaction => ({
	transaction_amount: { amount: Math.abs(amount).toFixed(2), currency: 'EUR' },
	booking_date: date,
	value_date: date,
	remittance_information: [label],
	credit_debit_indicator: amount >= 0 ? 'CRDT' : 'DBIT',
	...extra
});
const catOf = (t: Transaction): CategoryId => categorize(t, {}, [], new Map());

// Real case of August 2026 (rounded amounts): cheque paid in, reversed, then paid in again
const august: Transaction[] = [
	tx('REM CHQ REF10498 E0000000001', '2026-08-05', 10498.14),
	tx('REM CHQ REF10498 E0000000001 ANNULATION', '2026-08-07', -10498.14),
	tx('REM CHQ REF10498 E0000000002', '2026-08-12', 10498.14),
	tx('PAIEMENT CB 1008 POITIERS CARREFOUR', '2026-08-10', -120.5),
	tx('PRLV SEPA EDF CLIENTS PARTICULIERS', '2026-08-15', -80)
];

test('monthTotals: per category — the reversed cheque cancels out, it does not become 10 498 € of spending', () => {
	const t = monthTotals(august, '2026-08', catOf);
	assert.equal(t.income, 10498.14);
	assert.ok(t.expenses < 300, `sorties ${t.expenses} (avant : > 10 000 € par signe)`);
	assert.equal(monthFlows(august, '2026-08', catOf).expenses, t.expenses, 'Rapport et totaux identiques');
});

test('monthTotals: Kraken/Natixis rows, pending ones and « Épargne & transferts » left out of the flows', () => {
	const txs = [
		tx('PAIEMENT CB 0309 BOULANGERIE', '2026-09-03', -5),
		tx('KRAKEN DEPOSIT ABC', '2026-09-03', 5000, { account: 'kraken' }),
		tx('VER INI 102780000100012345678', '2026-09-04', -12000),
		tx('PAIEMENT CB EN COURS', '', -40)
	];
	const t = monthTotals(txs, '2026-09', catOf);
	assert.equal(t.expenses, 5);
	assert.equal(t.income, 0);
});

test('budgetRemaining: same spent amount as the Budget page (net, per category)', () => {
	const r = budgetRemaining(august, { alimentation: 420, energie: 100 }, '2026-08', catOf);
	assert.ok(r);
	assert.equal(r!.remaining, Math.round((520 - monthTotals(august, '2026-08', catOf).expenses) * 100) / 100);
});

test('monthCutoffDay: current calendar month, and data ending before the end of the month', () => {
	assert.equal(monthCutoffDay('2026-10', '2026-10-03', '2026-10-03'), 3);
	assert.equal(monthCutoffDay('2026-09', '2026-10-03', '2026-10-03'), null);
	assert.equal(monthCutoffDay('2026-09', '2026-09-20', '2026-10-03'), 20);
	assert.equal(monthCutoffDay('2026-09', '2026-09-30', '2026-10-03'), null);
	assert.equal(monthCutoffDay('2026-07', '2026-07-30', '2026-10-03'), null, 'export du 30 sur 31 jours : mois complet');
});

test('summary: on the 3rd of the month, compared with the 3rd of the previous month (no more « −94 % »)', () => {
	const txs: Transaction[] = [];
	for (let d = 1; d <= 30; d++) txs.push(tx(`PAIEMENT CB COMMERCE ${d}`, `2026-09-${String(d).padStart(2, '0')}`, -50));
	for (let d = 1; d <= 3; d++) {
		txs.push(tx(`PAIEMENT CB COMMERCE A${d}`, `2026-10-0${d}`, -50));
		txs.push(tx(`PAIEMENT CB COMMERCE B${d}`, `2026-10-0${d}`, -10));
	}
	const s = buildEditorialSummary(txs, '2026-10', catOf, '2026-10-03');
	assert.ok(s && !s.sober);
	assert.equal(s!.cutoffDay, 3);
	assert.equal(s!.variation?.pct, 20, '180 € au 3 oct. contre 150 € au 3 sept. = +20 %');
	assert.equal(s!.variation?.down, false);
});

test('report: current month marked provisional, previous month cut off at the same day', () => {
	const txs = [tx('PAIEMENT CB COMMERCE', '2026-09-02', -100), tx('PAIEMENT CB COMMERCE', '2026-09-20', -900), tx('PAIEMENT CB COMMERCE X', '2026-10-02', -100)];
	const r = buildMonthlyReport(txs, {}, {}, '2026-10', undefined, '2026-10-03');
	assert.equal(r?.cutoffDay, 3);
	assert.equal(r?.previous?.expenses, 100);
});

/** Next date = last + median interval (29.5 d). */
test('recurring: a subscription stopped in March is no longer active in October', () => {
	const nf = (d: string) => tx('PRLV SEPA NETFLIX.COM', d, -13.49);
	const [r] = detectRecurring([nf('2026-01-05'), nf('2026-02-05'), nf('2026-03-05')], {}, '2026-10-03');
	assert.equal(r?.active, false);
	assert.equal(r?.expectedDate, '2026-04-04');
	const total = forecastTotals([nf('2026-01-05'), nf('2026-02-05'), nf('2026-03-05')], {}, '2026-10-03', 30);
	assert.equal(total.expected, 0, 'rien de prévu pour un prélèvement arrêté');
	const [live] = detectRecurring([nf('2026-07-05'), nf('2026-08-05'), nf('2026-09-05')], {}, '2026-10-03');
	assert.equal(live?.active, true);
});

test('forecast per category: the current (partial) month no longer drags the trend down', () => {
	const rent = (d: string) => tx('PRLV SEPA FONCIA LOYER', d, -900, { bank_category: 'Logement / maison' });
	const txs = [rent('2026-07-05'), rent('2026-08-05'), rent('2026-09-05'), tx('PAIEMENT CB 0110 BOULANGERIE', '2026-10-01', -3)];
	const housing = forecastByCategory(txs, {}, undefined, '2026-10-03').find((c) => c.categoryId === 'logement');
	assert.deepEqual(housing?.monthly, [900, 900, 900]);
	assert.equal(housing?.expected, 900);
});

test('cumulative spending: a refund brings the curve back down', () => {
	const series = dailyCumulativeSpend([tx('PAIEMENT CB AMAZON', '2026-09-01', -50), tx('AMAZON PAYMENTS EUROPE', '2026-09-02', 20)], '2026-09', catOf);
	assert.equal(series[0], 50);
	assert.equal(series[1], 30);
});

/** A real loan (declared kind 'pret') is still detected. */
test('loans: the Krak card (running total of payments) is never a loan', () => {
	const krak = [tx('CARTE KRAK LEBONCOIN', '2026-04-02', -132.19, { account: 'krak-card' }), tx('CARTE KRAK LEBONCOIN', '2026-04-09', 132.19, { account: 'krak-card' }), tx('CARTE KRAK CARREFOUR', '2026-05-02', -6000, { account: 'krak-card' })];
	assert.equal(extractLoanRecord('krak-card', krak, undefined), null);
	assert.ok(extractLoanRecord('cm-1', [tx('MENSUALITE PRELEVEE', '2026-08-06', 166.3, { account: 'cm-1', balance_after: -5272.86 })], { id: 'cm-1', kind: 'pret', label: 'Prêt' }));
});
