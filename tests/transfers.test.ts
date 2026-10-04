import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Transaction } from '../src/lib/types';
import { txKey } from '../src/lib/categories';
import { detectTransferPairs, holderNamesFromLabels, pairKeys } from '../src/lib/transfers';

/**
 * Internal transfer detection (batch 4 of the 2026-10-03 review).
 * Each case documents a fixed false positive or a real transfer to keep.
 */

const tx = (account: string, booking: string, amount: string, cd: 'DBIT' | 'CRDT', label: string): Transaction => ({
	transaction_amount: { amount, currency: 'EUR' },
	booking_date: booking,
	value_date: booking,
	remittance_information: [label],
	credit_debit_indicator: cd,
	account
});

const HOLDER = holderNamesFromLabels(['C/C EUROCOMPTE CONFORT M GREGOIRE MARCHAND']);

test('holder names extracted from the register', () => {
	assert.deepEqual(HOLDER, ['GREGOIRE', 'MARCHAND']);
});

test('real case: VIR −12 000 € C/C ↔ VER INI +12 000 € LDDS (different accounts) → one pair', () => {
	const debit = tx('cm-1', '2026-03-05', '12000.00', 'DBIT', 'VIR 102780000100012345680');
	const credit = tx('cm-2', '2026-03-05', '12000.00', 'CRDT', 'VER INI 102780000100012345678');
	const pairs = detectTransferPairs([debit, credit], HOLDER);
	assert.equal(pairs.length, 1);
	assert.equal(pairs[0]!.debitKey, txKey(debit));
	assert.equal(pairs[0]!.creditKey, txKey(credit));
	assert.equal(pairs[0]!.amount, 12000);
});

test('one-to-one pairing: an ATM withdrawal does not « validate » the credit of a real transfer', () => {
	const atmWithdrawal = tx('cm-1', '2026-09-03', '100.00', 'DBIT', 'RETRAIT DAB 0309 POITIERS');
	const transfer = tx('cm-1', '2026-09-05', '100.00', 'DBIT', 'VIR 102780000100012345678');
	const initialDeposit = tx('cm-2', '2026-09-05', '100.00', 'CRDT', 'VER INI 102780000100012345680');
	const pairs = detectTransferPairs([atmWithdrawal, transfer, initialDeposit], HOLDER);
	assert.equal(pairs.length, 1, 'une seule paire');
	assert.deepEqual(pairKeys(pairs[0]!).sort(), [txKey(transfer), txKey(initialDeposit)].sort());
	assert.ok(!pairs.some((p) => pairKeys(p).includes(txKey(atmWithdrawal))), 'le retrait reste dans le budget');
});

test('one-to-one pairing: two identical transfers in the same week → two pairs, each with the closest match', () => {
	const d1 = tx('cm-1', '2026-09-01', '100.00', 'DBIT', 'VIR EPARGNE MENSUELLE');
	const d2 = tx('cm-1', '2026-09-04', '100.00', 'DBIT', 'VIR EPARGNE MENSUELLE BIS');
	const c1 = tx('cm-2', '2026-09-01', '100.00', 'CRDT', 'VER INI 1');
	const c2 = tx('cm-2', '2026-09-04', '100.00', 'CRDT', 'VER INI 2');
	const pairs = detectTransferPairs([d1, d2, c1, c2], HOLDER);
	assert.equal(pairs.length, 2);
	const byDebit = new Map(pairs.map((p) => [p.debitKey, p.creditKey]));
	assert.equal(byDebit.get(txKey(d1)), txKey(c1));
	assert.equal(byDebit.get(txKey(d2)), txKey(c2));
	assert.ok(pairs.every((p) => p.days === 0));
});

test('« amount/date » pair: both labels must look like a transfer', () => {
	const fnac = tx('cm-1', '2026-09-12', '50.00', 'DBIT', 'PAIEMENT CB 1209 POITIERS FNAC CARTE 1234');
	const friend = tx('cm-2', '2026-09-14', '50.00', 'CRDT', 'VIR SEPA DUPONT PIERRE');
	assert.equal(detectTransferPairs([fnac, friend], HOLDER).length, 0);
});

test('name heuristic: first name first AND another name of the holder', () => {
	const own = tx('cm-1', '2026-09-10', '300.00', 'CRDT', 'VIR INST GREGOIRE PAUL-HENRI MARCHAND EPARGNE');
	const titled = tx('cm-1', '2026-09-11', '200.00', 'DBIT', 'VIR INST M. MARCHAND GREGOIRE LIVRET');
	const friend = tx('cm-1', '2026-09-12', '35.00', 'CRDT', 'VIR INST GREGOIRE MARTIN RESTO SAMEDI');
	const salary = tx('cm-1', '2026-09-28', '2851.40', 'CRDT', 'VIR SAS EXEMPLECORP MARCHAND GREGOIR');
	const pairs = detectTransferPairs([own, titled, friend, salary], HOLDER);
	const keys = new Set(pairs.flatMap(pairKeys));
	assert.ok(keys.has(txKey(own)), 'virement vers soi (prénom + nom)');
	assert.ok(keys.has(txKey(titled)), 'civilité ignorée');
	assert.ok(!keys.has(txKey(friend)), 'ami au même prénom : pas interne');
	assert.ok(!keys.has(txKey(salary)), 'salaire : l’employeur précède le nom');
	assert.equal(pairs.find((p) => pairKeys(p).includes(txKey(own)))!.reason, 'keyword');
});

test('name heuristic disabled with a single name in the register', () => {
	const solo = holderNamesFromLabels(['C/C EUROCOMPTE M DUPONT']);
	const t = tx('cm-1', '2026-09-10', '300.00', 'CRDT', 'VIR INST DUPONT EPARGNE');
	assert.equal(detectTransferPairs([t], solo).length, 0);
});

/** Even with a bank « virement » credit of the same amount: not a bank ↔ Kraken movement. */
test('Kraken account rows: never lone candidates (KRAKEN SUBSCRIPTION = real expense)', () => {
	const sub = tx('kraken', '2026-01-06', '49.99', 'DBIT', 'KRAKEN SUBSCRIPTION LQ7ZQ-ABCDE-FGHIJ');
	assert.equal(detectTransferPairs([sub], HOLDER).length, 0);
	const transfer = tx('cm-1', '2026-01-07', '49.99', 'CRDT', 'VIR SEPA REMBOURSEMENT');
	assert.equal(detectTransferPairs([sub, transfer], HOLDER).length, 0);
});

test('Kraken account rows: can be paired as the counterpart of a bank transfer', () => {
	const bank = tx('cm-1', '2026-02-10', '500.00', 'DBIT', 'VIR INST GREGOIRE PAUL-HENRI MARCHAND KRAKEN TX//ABC');
	const deposit = tx('kraken', '2026-02-12', '500.00', 'CRDT', 'KRAKEN DEPOSIT LXYZ-123');
	const pairs = detectTransferPairs([bank, deposit], HOLDER);
	assert.equal(pairs.length, 1);
	assert.deepEqual(pairKeys(pairs[0]!).sort(), [txKey(bank), txKey(deposit)].sort());
	assert.equal(pairs[0]!.days, 2);
});

test('transfer to Kraken without an imported counterpart: lone « keyword » candidate', () => {
	const bank = tx('cm-1', '2026-02-10', '749.00', 'DBIT', 'VIR INST GREGOIRE PAUL-HENRI MARCHAND KRAKEN TX//DEF');
	const pairs = detectTransferPairs([bank], HOLDER);
	assert.equal(pairs.length, 1);
	assert.deepEqual(pairs[0], { debitKey: txKey(bank), creditKey: '', amount: 749, days: 0, reason: 'keyword' });
});

/** The « VER INI » credit stays a lone candidate (internal marker). */
test('pending transactions (no date) ignored, gap > 7 days refused', () => {
	const credit = tx('cm-2', '2026-09-05', '100.00', 'CRDT', 'VER INI 2');
	const pending = { ...tx('cm-1', '', '100.00', 'DBIT', 'VIR 1'), value_date: '' };
	const late = tx('cm-1', '2026-09-20', '100.00', 'DBIT', 'VIR 3');
	for (const debit of [pending, late]) {
		const pairs = detectTransferPairs([debit, credit], HOLDER);
		assert.ok(!pairs.some((p) => p.debitKey === txKey(debit)), 'jamais apparié');
		assert.deepEqual(
			pairs.map((p) => [p.debitKey, p.creditKey, p.reason]),
			[['', txKey(credit), 'keyword']]
		);
	}
});
