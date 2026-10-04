import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseKrakenLedgerText } from '../src/lib/csvKraken';
import { applyPerfEntries, emptyPerf, computePerformance, summarizeLedger } from '../src/lib/krakenPerf';
import { normalizeBalances, dayChangePct, isPriceable } from '../src/lib/kraken';
import { computeTaxReport, pfuRate } from '../src/lib/cryptoTax';
import { isSafeHttpUrl } from '../src/lib/cryptoNews';

/** Fixes of the crypto batch (2026-10-03 review): balances, average cost, flows, links. */

const HEADER = '"txid","refid","time","type","subtype","aclass","wallet","asset","wallet2","amount","fee","balance"';
const ledger = (rows: string) => parseKrakenLedgerText(`${HEADER}\n${rows}\n`).entries;

/**
 * A pending deposit no longer replaces the real balance; staked ETH (ETH2.S) counts with ETH.
 */
test('API balances: suffixed variants added up, .HOLD kept apart, key order has no effect', () => {
	const a = normalizeBalances({ ADA: '100.5', 'ADA.F': '80000', ZEUR: '0.76', 'EUR.HOLD': '250', 'SOL.S': '1', SOL: '2', 'ETH2.S': '0.5', XETH: '1' });
	assert.equal(a.balances['ADA'], 80100.5);
	assert.equal(a.balances['SOL'], 3);
	assert.equal(a.balances['EUR'], 0.76);
	assert.equal(a.hold['EUR'], 250);
	assert.equal(a.balances['ETH'], 1.5);
	const b = normalizeBalances({ 'ADA.F': '80000', ADA: '100.5' });
	assert.equal(b.balances['ADA'], 80100.5);
	assert.deepEqual(normalizeBalances({ KFEE: '0', ADA: 'abc' }).balances, {});
});

test('prices: fiat and fee credits never requested from Ticker; daily change vs the opening price', () => {
	assert.equal(isPriceable('USD'), false);
	assert.equal(isPriceable('EUR'), false);
	assert.equal(isPriceable('KFEE'), false);
	assert.equal(isPriceable('DOGE'), true);
	assert.equal(Math.round(dayChangePct(110, 100) * 10) / 10, 10);
	assert.equal(dayChangePct(110, 0), 0);
});

/**
 * 100 ADA bought for 30 €, 10 ADA of reward (fee 2) BEFORE the full sale, then 5 ADA
 * (fee 1) after. Before the fix, the 8 net ADA received before the sale were added
 * at the end → 12 ADA; now 8 + 4 net (not 15 gross).
 */
test('average cost (PRU): rewards in chronological order and NET of the fee', () => {
	const entries = ledger(`"L1","R1","2024-01-01 10:00:00","trade","","currency","spot","ZEUR","","-30.0000","0","70.0000"
"L2","R1","2024-01-01 10:00:00","trade","","currency","spot","ADA","","100","0","100"
"L3","R2","2024-02-01 10:00:00","staking","","currency","spot","ADA","","10","2","108"
"L4","R3","2024-03-01 10:00:00","trade","","currency","spot","ADA","","-108","0","0"
"L5","R3","2024-03-01 10:00:00","trade","","currency","spot","ZEUR","","54.0000","0","124.0000"
"L6","R4","2024-04-01 10:00:00","staking","","currency","spot","ADA","","5","1","4"`);
	const st = applyPerfEntries(emptyPerf(), entries);
	assert.equal(st.costBasis['ADA']!.qty, 4);
	assert.equal(st.costBasis['ADA']!.cost, 0);
	const sum = summarizeLedger(entries);
	assert.equal(sum.earnTotal['ADA'], 12);
	assert.equal(sum.assetBalances['ADA'], 4);
});

/**
 * Neither the cancelled withdrawal (−99 +99) nor the fees count; KFEE is no longer
 * a « movement without price »; 500 € + 100 USDC × 0.85.
 */
test('performance: cancelled withdrawal netted, fees not counted as outflows, hybrid earn = outflow, KFEE ignored', () => {
	const entries = ledger(`"L1","F1","2026-01-01 10:00:00","deposit","","currency","spot","ZEUR","","1000","0","1000"
"L2","F2","2026-01-02 10:00:00","withdrawal","","currency","spot","ZEUR","","-99","1","900"
"L3","F2","2026-01-02 10:05:00","withdrawal","","currency","spot","ZEUR","","99","-1","1000"
"L4","F3","2026-01-03 10:00:00","withdrawal","","currency","spot","ZEUR","","-500","1","499"
"L5","F4","2022-10-16 01:45:19","deposit","","currency","spot","KFEE","","3500","0","3500"
"L6","R5","2026-01-04 10:00:00","receive","","currency","spot","USDC","","100","0","100"
"L7","R5","2026-01-04 10:00:00","spend","","currency","spot","ZEUR","","-85","0","414"
"L8","F6","2026-01-04 10:00:01","hybridearnwithdrawal","","currency","spot","USDC","","-100","0","0"`);
	const st = applyPerfEntries(emptyPerf(), entries);
	assert.equal(st.withdrawalsEur, 500);
	assert.equal(st.costBasis['USDC']!.qty, 0);
	const p = computePerformance(st, 414, (asset) => (asset === 'USDC' ? 0.85 : undefined));
	assert.equal(p.unpricedFlows, 0);
	assert.equal(p.withdrawn, 585);
});

/** Before the fix: a phantom 209.6251, and 0. */
test('ledger balances: rows of the same second out of order, autoallocation pair, lone row', () => {
	const entries = ledger(`"L1","T1","2026-01-05 10:21:31","spend","","currency","spot","USD","","-192.3992","0","0"
"L2","T1","2026-01-05 10:21:31","receive","","currency","spot","USD","","192.3992","0","192.3992"
"L3","T2","2026-07-15 13:06:08","spend","","currency","spot","USD","","-209.6251","0","0"
"L4","T2","2026-07-15 13:06:08","receive","","currency","spot","USD","","209.6251","0","209.6251"
"L5","R1","2024-04-01 10:00:00","trade","","currency","spot","XETH","","0.00000606","0","0.00000606"
"L6","E1","2024-04-12 22:18:44","transfer","autoallocation","currency","spot","XETH","","0.00000606","0","0.00000606"
"L7","E1","2024-04-12 22:18:44","transfer","autoallocation","currency","spot","XETH","","-0.00000606","0","0"
"L8","S1","2024-04-18 20:45:32","staking","","currency","spot","XETH","","1.2e-9","2e-10","0.000006061"`);
	const sum = summarizeLedger(entries);
	assert.equal(sum.assetBalances['USD'], 0);
	const eth = sum.balanceHistory.filter((h) => h.asset === 'ETH');
	assert.equal(eth.find((h) => h.date === '2024-04-12')!.balance, 0.00000606);
	assert.equal(sum.assetBalances['ETH'], 0.000006061);
});

/** VG = 1 BTC × 20 000 (sale price) + 10 ETH × 1 000 = 30 000 (before: ETH at 0 → 20 000). */
test('taxation: an autoallocation pair does not remove the asset from the portfolio value', () => {
	const csv = `${HEADER}
"L1","R1","2024-01-05 10:00:00","deposit","","currency","spot","ZEUR","","20000","0","20000"
"L2","R2","2024-01-06 10:00:00","trade","","currency","spot","ZEUR","","-10000","0","10000"
"L3","R2","2024-01-06 10:00:00","trade","","currency","spot","XXBT","","1","0","1"
"L4","R3","2024-01-07 10:00:00","trade","","currency","spot","ZEUR","","-10000","0","0"
"L5","R3","2024-01-07 10:00:00","trade","","currency","spot","XETH","","10","0","10"
"L6","E1","2024-03-01 10:00:00","transfer","autoallocation","currency","spot","XETH","","10","0","10"
"L7","E1","2024-03-01 10:00:00","transfer","autoallocation","currency","spot","XETH","","-10","0","0"
"L8","R4","2024-06-01 10:00:00","trade","","currency","spot","XXBT","","-0.5","0","0.5"
"L9","R4","2024-06-01 10:00:00","trade","","currency","spot","ZEUR","","10000","0","10000"
`;
	const r = computeTaxReport(parseKrakenLedgerText(csv).entries, (a) => (a === 'ETH' ? 1000 : undefined));
	const c = r.years[0]!.cessions[0]!;
	assert.equal(c.portfolioValue, 30000);
	assert.equal(pfuRate(2024), 0.3);
});

test('news: http(s) links only', () => {
	assert.equal(isSafeHttpUrl('https://www.coindesk.com/a'), true);
	assert.equal(isSafeHttpUrl('http://example.com'), true);
	assert.equal(isSafeHttpUrl('javascript:alert(1)'), false);
	assert.equal(isSafeHttpUrl('data:text/html,x'), false);
	assert.equal(isSafeHttpUrl('/relative'), false);
	assert.equal(isSafeHttpUrl(undefined), false);
});
