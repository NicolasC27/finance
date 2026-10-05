import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoClaims, creditFrom, matchRefunds, totalOwed, type Credit, type RefundClaim } from '../src/lib/refunds';

const TODAY = '2026-10-05';
const claim = (o: Partial<RefundClaim>): RefundClaim => ({ expenseKey: 'e1', source: 'sante', who: 'Sécu + mutuelle', expected: 30, date: '2026-09-10', categoryId: 'sante', auto: true, ...o });
const credit = (key: string, date: string, amount: number, label: string): Credit => ({ key, date, amount, label });

test('remboursements santé : Sécu puis mutuelle, franchise tolérée', () => {
	const s = matchRefunds([claim({})], [credit('c1', '2026-09-15', 19, 'VIR CPAM DU RHONE'), credit('c2', '2026-09-20', 8, 'VIR MGEN PRESTATIONS'), credit('x', '2026-09-16', 19, 'VIR SALAIRE ACME')], TODAY);
	assert.equal(s[0]!.refunded, 27);
	assert.equal(s[0]!.state, 'refunded', '3 € manquants : participation forfaitaire');
	assert.deepEqual(s[0]!.payments.map((p) => p.key), ['c1', 'c2']);
});

test('un virement pour plusieurs consultations, puis retard', () => {
	const claims = [claim({ expenseKey: 'a', expected: 26.5, date: '2026-09-01' }), claim({ expenseKey: 'b', expected: 26.5, date: '2026-09-03' }), claim({ expenseKey: 'c', expected: 50, date: '2026-09-04' })];
	const s = matchRefunds(claims, [credit('cpam', '2026-09-12', 53, 'VIR AMELI REMBOURSEMENT SOINS')], TODAY, 15);
	assert.deepEqual(s.map((x) => x.state), ['refunded', 'refunded', 'overdue']);
	assert.equal(totalOwed(s), 50);
});

test('avance à un proche : partiel, nom reconnu, jamais avant la dépense', () => {
	const c = claim({ source: 'personne', who: 'Léa Martin', expected: 60, date: '2026-09-25', categoryId: 'autre' });
	const s = matchRefunds([c], [credit('early', '2026-09-20', 60, 'VIR INST DE LEA MARTIN'), credit('p1', '2026-09-28', 30, 'VIR INST DE LEA MARTIN')], TODAY);
	assert.equal(s[0]!.state, 'partial');
	assert.equal(s[0]!.remaining, 30);
	assert.ok(creditFrom(c, 'VIR INST DE MME LEA MARTIN'));
	assert.equal(creditFrom(c, 'VIR SALAIRE ACME'), false);
	assert.ok(creditFrom(claim({}), 'VIR HARMONIE MUTUELLE'));
	assert.ok(creditFrom(claim({}), 'VIR MA PETITE MUTU', ['MA PETITE MUTU']), 'mutuelle vue dans les prélèvements');
	assert.equal(matchRefunds([{ ...c, closed: true }], [], TODAY)[0]!.state, 'closed');
});

test('marquage automatique : soins et avances récents', () => {
	const e = [
		{ key: 'k1', date: '2026-09-01', amount: 26.5, label: 'DR LAMBERT', categoryId: 'sante' as const, subId: 'soins' },
		{ key: 'k2', date: '2026-09-02', amount: 12, label: 'PHARMACIE', categoryId: 'sante' as const, subId: 'pharmacie' },
		{ key: 'k3', date: '2026-09-03', amount: 60, label: 'VIR LEA MARTIN', categoryId: 'autre' as const, subId: 'avances' },
		{ key: 'k4', date: '2025-01-03', amount: 26.5, label: 'DR LAMBERT', categoryId: 'sante' as const, subId: 'soins' }
	];
	const a = autoClaims(e, TODAY);
	assert.deepEqual(a.map((c) => [c.expenseKey, c.source, c.who]), [['k1', 'sante', 'Sécu + mutuelle'], ['k3', 'personne', 'VIR LEA MARTIN']]);
});
