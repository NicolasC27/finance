import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Transaction } from '../src/lib/types';
import { detectRecurring } from '../src/lib/forecast';

/** Subscriptions & direct debits: FIXED charges only, not purchase habits. */

const tx = (label: string, date: string, amount: number): Transaction => ({
	transaction_amount: { amount: Math.abs(amount).toFixed(2), currency: 'EUR' },
	booking_date: date,
	value_date: date,
	remittance_information: [label],
	credit_debit_indicator: amount >= 0 ? 'CRDT' : 'DBIT'
});
const months = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09'];
const find = (items: ReturnType<typeof detectRecurring>, word: string) => items.find((r) => r.key.includes(word));

/** Includes a variable energy bill debited every month. */
test('fixed costs: direct debits, card subscription with a price rise, rent paid by transfer', () => {
	const txs = [
		...months.map((m, i) => tx('PRLV SEPA FREE MOBILE', `${m}-0${5 + (i % 2)}`, -19.99)),
		...months.map((m, i) => tx('PAIEMENT CB NETFLIX.COM', `${m}-12`, i < 3 ? -13.49 : -15.99)),
		...months.map((m) => tx('VIR SEPA LOYER APPARTEMENT', `${m}-01`, -890)),
		...months.map((m, i) => tx('PRLV SEPA EDF CLIENTS PARTICULIERS', `${m}-15`, -[80, 80, 210, 80, 95][i]!))
	];
	const items = detectRecurring(txs, {}, '2026-09-30');
	for (const w of ['FREE', 'NETFLIX', 'LOYER', 'EDF']) assert.equal(find(items, w)?.fixed, true, w);
	assert.equal(find(items, 'LOYER')?.monthly, 890, 'mensuel = le montant (plus « 903 €/mois » pour un loyer de 890 €)');
});

test('purchase habits: groceries, withdrawals and coffees are not subscriptions', () => {
	const txs: Transaction[] = [];
	const groceries = [62.4, 118.9, 35.1, 87.3, 54.2, 141.7, 49.9, 96.5, 73.8, 58.6];
	groceries.forEach((a, i) => txs.push(tx('PAIEMENT CB POITIERS E LECLERC CARTE 1234', `2026-0${6 + Math.floor(i / 4)}-${String(2 + (i % 4) * 7).padStart(2, '0')}`, -a)));
	[40, 60, 40, 20, 50].forEach((a, i) => txs.push(tx('RETRAIT DAB POITIERS', `2026-0${5 + i}-10`, -a)));
	[3.2, 5.6, 2.8, 4.4, 6.1].forEach((a, i) => txs.push(tx('PAIEMENT CB CAFE DU COMMERCE', `2026-0${5 + i}-${String(3 + i * 5).padStart(2, '0')}`, -a)));
	const items = detectRecurring(txs, {}, '2026-09-30');
	for (const w of ['LECLERC', 'RETRAIT', 'CAFE']) assert.notEqual(find(items, w)?.fixed, true, w);
});

/**
 * 2019-2020: same insurance, old rate, then two years without import; 2025-2026: a
 * different reference on each payment (real CM format).
 */
test('references changing on every debit and an old history: the insurance is still a fixed cost', () => {
	const txs: Transaction[] = [];
	for (let m = 1; m <= 12; m++) txs.push(tx('PRLV SEPA ASSURANCE HABITATION BF8079552', `2019-${String(m).padStart(2, '0')}-08`, -12.4));
	for (let m = 1; m <= 9; m++) txs.push(tx(`PRLV SEPA ASSURANCE HABITATION BF8079552 RMS2530${m}051358436UI`, `2026-0${m}-0${6 + (m % 3)}`, -19.6));
	const items = detectRecurring(txs, {}, '2026-09-30');
	const insurance = items.find((r) => r.key.includes('ASSURANCE HABITATION'));
	assert.ok(insurance, 'une seule récurrence malgré les références');
	assert.equal(insurance!.fixed, true);
	assert.equal(insurance!.active, true);
	assert.equal(insurance!.monthly, 19.6, 'jugée sur les 13 derniers mois (tarif actuel)');
});
