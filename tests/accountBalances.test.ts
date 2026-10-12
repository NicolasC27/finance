import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Transaction } from '../src/lib/types';
import type { AccountInfo } from '../src/lib/accounts.svelte';
import { computeAccounts } from '../src/lib/accountBalances';

const ACC = 'cm-00012345678';
const NOW = new Date(2026, 9, 12);

function op(date: string, amount: number, extra: Partial<Transaction> = {}): Transaction {
	return {
		transaction_amount: { amount: Math.abs(amount).toFixed(2), currency: 'EUR' },
		booking_date: date,
		value_date: date,
		remittance_information: [`OP ${date} ${amount}`],
		credit_debit_indicator: amount < 0 ? 'DBIT' : 'CRDT',
		account: ACC,
		source: 'cm-csv',
		...extra
	};
}

const registry = (extra: Partial<AccountInfo> = {}): AccountInfo[] => [{ id: ACC, label: 'Compte courant fictif', last4: '5678', kind: 'courant', ...extra }];
const view = (txs: Transaction[], reg: AccountInfo[]) => computeAccounts(txs, reg, NOW).find((a) => a.id === ACC)!;

test('an undated declared balance no longer hides a newer statement balance', () => {
	const txs = [op('2026-10-01', -50, { balance_after: 1950 }), op('2026-10-10', -30, { balance_after: 1920 })];
	const acc = view(txs, registry({ balance: 1500 }));
	assert.equal(acc.balance, 1920);
	assert.equal(acc.declared, undefined);
	assert.equal(acc.computedFrom, 'balance');
});

test('operations after the last statement balance are added, pending ones are not', () => {
	const txs = [
		op('2026-10-10', -30, { balance_after: 1920 }),
		op('2026-10-11', -12.5, { source: 'manual' }),
		op('2026-11-12', -100, { source: 'manual', value_date: '' })
	];
	assert.equal(view(txs, registry()).balance, 1907.5);
});

test('an undated declared balance stays the fallback of an account without statement balance', () => {
	assert.equal(view([], registry({ balance: 1500 })).balance, 1500);
	const flows = [op('2026-10-02', -20)];
	assert.equal(view(flows, registry({ balance: 1500 })).balance, 1500);
});

test('a dated declared balance wins when it is the freshest anchor, and loses when older', () => {
	const txs = [op('2026-10-05', -40, { balance_after: 960 }), op('2026-10-09', -10, { source: 'manual' })];
	const newer = view(txs, registry({ balance: 1000, balanceAt: '2026-10-07' }));
	assert.equal(newer.declared, 990);
	assert.equal(newer.balance, 990);
	const older = view(txs, registry({ balance: 1000, balanceAt: '2026-10-01' }));
	assert.equal(older.declared, undefined);
	assert.equal(older.balance, 950);
});

test('the latest balance_after wins by date, the first one met on equal dates', () => {
	const txs = [op('2026-10-06', -5, { balance_after: 800 }), op('2026-10-06', -7, { balance_after: 805 }), op('2026-10-03', -1, { balance_after: 812 })];
	assert.equal(view(txs, registry()).balance, 800);
});

test('quick entries of the anchor day count, bank rows of that day are already in the balance', () => {
	const txs = [op('2026-10-12', -39, { balance_after: 900 }), op('2026-10-12', -15, { source: 'manual' }), op('2026-10-12', -8)];
	assert.equal(view(txs, registry()).balance, 885);
	const reconciled = view([op('2026-10-12', -15, { source: 'manual' })], registry({ balance: 1000, balanceAt: '2026-10-12' }));
	assert.equal(reconciled.balance, 985);
});
