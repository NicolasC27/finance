import { test } from 'node:test';
import assert from 'node:assert/strict';
import { balancesAt, closesAt, cryptoEurByDay, snapshotsAt, splitByAsset } from '../src/lib/cryptoValue';

const day = (iso: string) => new Date(`${iso}T12:00:00`).getTime();
const btc = [
	{ t: day('2026-01-02'), close: 90_000 },
	{ t: day('2026-01-03'), close: 91_000 },
	{ t: day('2026-01-05'), close: 95_000 }
];

test('closesAt: last candle at or before the end of each day, null before the first', () => {
	assert.deepEqual(closesAt(btc, ['2026-01-01', '2026-01-02', '2026-01-04', '2026-01-05', '2026-02-01']), [null, 90_000, 91_000, 95_000, 95_000]);
	assert.deepEqual(closesAt([], ['2026-01-01']), [null]);
});

test('balancesAt and snapshotsAt: last point at or before the day', () => {
	const series = [
		{ date: '2026-01-02', balance: 0.5 },
		{ date: '2026-01-04', balance: 0.8 }
	];
	assert.deepEqual(balancesAt(series, ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04', '2026-01-09']), [0, 0.5, 0.5, 0.8, 0.8]);
	assert.deepEqual(snapshotsAt([{ date: '2026-01-03', eur: 1000 }], ['2026-01-02', '2026-01-03', '2026-01-04']), [null, 1000, 1000]);
});

test('cryptoEurByDay: snapshots first, then ledger balances × closes with fiat converted, same figures as the day-by-day scan', () => {
	const isos = ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04', '2026-01-05'];
	const ledger = new Map([
		['XBT', [{ date: '2026-01-02', balance: 0.1 }]],
		['USD', [{ date: '2026-01-01', balance: 100 }]]
	]);
	const sources = {
		snapshots: [{ date: '2026-01-04', eur: 12_345 }],
		ledger,
		ohlc: { XBT: btc },
		holdings: [],
		isFiat: (a: string) => a === 'USD',
		toEur: (amount: number, asset: string) => (asset === 'USD' ? amount * 0.9 : null)
	};
	// 01: USD only (90); 02: 0.1 × 90 000 + 90; 03: 0.1 × 91 000 + 90; 04 and 05: snapshot
	assert.deepEqual(cryptoEurByDay(isos, sources), [90, 9090, 9190, 12_345, 12_345]);
	// Without a ledger: current quantities × close of the day, 0 before the first candle
	assert.deepEqual(cryptoEurByDay(isos, { ...sources, snapshots: [], ledger: new Map(), holdings: [{ symbol: 'XBT', qty: 2 }] }), [0, 180_000, 182_000, 182_000, 190_000]);
});

test('splitByAsset: one sorted series per asset, technical assets skipped', () => {
	const split = splitByAsset(
		[
			{ date: '2026-01-01', asset: 'XBT', balance: 1 },
			{ date: '2026-01-01', asset: 'KFEE', balance: 3 },
			{ date: '2026-01-02', asset: 'ETH', balance: 2 },
			{ date: '2026-01-03', asset: 'XBT', balance: 1.5 }
		],
		(a) => a === 'KFEE'
	);
	assert.deepEqual([...split.keys()], ['XBT', 'ETH']);
	assert.deepEqual(split.get('XBT'), [
		{ date: '2026-01-01', balance: 1 },
		{ date: '2026-01-03', balance: 1.5 }
	]);
});
