import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Transaction } from '../src/lib/types';
import { categorize, setVacationPredicate, CATEGORIES, txKey } from '../src/lib/categories';
import { subcategorize, setSubOverridesSource } from '../src/lib/subcategories';
import { hasInternalKeyword } from '../src/lib/transfers';
import { parseKrakLines } from '../src/lib/pdfKrak';
import { merchantKey } from '../src/lib/merchant';
import { effectiveDate } from '../src/lib/vacationDate';
import { merchantLabel } from '../src/lib/merchant';
import { truncateLabel } from '../src/lib/format';
import { parseKrakenLedgerText } from '../src/lib/csvKraken';
import { computeTaxReport } from '../src/lib/cryptoTax';
import { applyPerfEntries, emptyPerf, computePerformance, assetPnl } from '../src/lib/krakenPerf';
import { parseAmazonOrders, matchAmazonOrders, matchesAmazonHeader, inferCategory } from '../src/lib/amazonOrders';
import { toEur } from '../src/lib/fiat';

/**
 * Tests of the pure engines (no browser). Run: npm test
 * Each case documents an intended behaviour or a fixed bug.
 */

const tx = (label: string, booking: string, amount = '10.00', cd: 'DBIT' | 'CRDT' = 'DBIT', extra: Partial<Transaction> = {}): Transaction => ({
	transaction_amount: { amount, currency: 'EUR' },
	booking_date: booking,
	value_date: booking,
	remittance_information: [label],
	credit_debit_indicator: cd,
	...extra
});

test('categories: 13 categories including Voiture, Vacances, Impôts and Épargne & transferts', () => {
	assert.equal(CATEGORIES.length, 13);
	for (const id of ['voiture', 'vacances', 'impots', 'epargne'] as const) assert.ok(CATEGORIES.some((c) => c.id === id));
});

test('actual date of a CM card payment (DDMM from the label, across a year boundary)', () => {
	assert.equal(effectiveDate(tx('PAIEMENT CB 0308 108,00 EUR ANTHROPIC* CARTE 09', '2026-08-05')), '2026-08-03');
	assert.equal(effectiveDate(tx('PAIEMENT PSC 0208 TERCE SUMUP *FROMAGE', '2026-08-05')), '2026-08-02');
	assert.equal(effectiveDate(tx('2 PAIEMENTS 2701 POITIERS', '2026-01-29')), '2026-01-27');
	assert.equal(effectiveDate(tx('RETRAIT DAB 1507 PARIS', '2026-07-17')), '2026-07-15');
	assert.equal(effectiveDate(tx('PAIEMENT CB 2812 PARIS', '2027-01-02')), '2026-12-28');
	assert.equal(effectiveDate(tx('PRLV SEPA EDF', '2026-08-10')), '2026-08-10');
});

test('holidays: variable spending reclassified, fixed costs and income untouched, override takes priority', () => {
	setVacationPredicate((t) => {
		const d = effectiveDate(t);
		return d >= '2026-08-01' && d <= '2026-08-10';
	});
	try {
		assert.equal(categorize(tx('PAIEMENT CB 0508 LA FOURCHETTE RESTAURANT', '2026-08-12')), 'vacances');
		assert.equal(categorize(tx('PAIEMENT CB 0308 CARREFOUR CITY', '2026-08-06')), 'vacances');
		assert.equal(categorize(tx('PRLV SEPA EDF', '2026-08-05')), 'energie');
		assert.equal(categorize(tx('PAIEMENT CB 0408 NETFLIX', '2026-08-05')), 'abonnements');
		assert.equal(categorize(tx('VIR SALAIRE', '2026-08-05', '2000', 'CRDT')), 'revenus');
		assert.equal(categorize(tx('PAIEMENT CB 3007 CARREFOUR CITY', '2026-08-02')), 'alimentation');
		const t = tx('PAIEMENT CB 0508 LA FOURCHETTE', '2026-08-12');
		assert.equal(categorize(t, { [txKey(t)]: 'loisirs' }), 'loisirs');
	} finally {
		setVacationPredicate(null);
	}
});

test('dictionary: lodging and airlines → vacances; AI → abonnements/ia', () => {
	assert.equal(categorize(tx('PAIEMENT CB 1506 AIRBNB * HMXYZ', '2026-06-17')), 'vacances');
	assert.equal(categorize(tx('PAIEMENT CB 1006 EASYJET', '2026-06-12')), 'vacances');
	const anth = tx('PAIEMENT CB 0308 108,00 EUR ANTHROPIC* CARTE 09', '2026-08-05');
	assert.equal(categorize(anth), 'abonnements');
	assert.equal(subcategorize(anth), 'ia');
	assert.equal(subcategorize(tx('PAIEMENT CB 0101 GITHUB', '2026-01-02')), 'logiciels');
	const piano = tx('VIR INST BIROLLEAU VINCENT (EI) CU3W26274M193690', '2026-10-01', '150.00');
	assert.equal(categorize(piano), 'loisirs');
	assert.equal(subcategorize(piano), 'musique-cours');
});

test('refunds: credit from a known merchant → its category; private person → revenus; cheque deposit → revenus even when reversed', () => {
	assert.equal(categorize(tx('SINGAP MOONSHOT AI', '2026-09-01', '13.35', 'CRDT')), 'abonnements');
	assert.equal(categorize(tx('PAIEMENT CB 0101 CARREFOUR CITY', '2026-09-01', '20', 'CRDT')), 'alimentation');
	assert.equal(categorize(tx('WERO MR LEROY SANTUCCI ANTOINE', '2026-09-01', '30', 'CRDT')), 'revenus');
	assert.equal(categorize(tx('REM CHQ REF46592-20075 E0000000001049814', '2026-08-06', '10498.14', 'DBIT')), 'revenus');
	assert.equal(categorize(tx('REM CHQ REF15589-16518 00', '2026-08-05', '10498.14', 'CRDT')), 'revenus');
	assert.equal(categorize(tx('MENSUALITE PRELEVEE', '2026-09-05', '165.33', 'CRDT')), 'autre');
});

test('unknown bank category: keyword fallback', () => {
	assert.equal(categorize(tx('PAIEMENT CB 1209 POITIERS TH POITIERS', '2026-09-14', '27', 'DBIT', { bank_category: 'Loisirs / Sport' })), 'loisirs');
	assert.equal(categorize(tx('PAIEMENT CB 1209 X', '2026-09-14', '27', 'DBIT', { bank_category: 'Vacances / Voyages' })), 'vacances');
	assert.equal(categorize(tx('PAIEMENT CB 1209 X', '2026-09-14', '27', 'DBIT', { bank_category: 'Truc inconnu', bank_subcategory: 'Petit commerçant' })), 'alimentation');
});

test('labels: instant transfers and references cleaned up, foreign-currency amount removed', () => {
	assert.equal(merchantLabel(['VIR INST BIROLLEAU VINCENT EI CU3W26274M193690']), 'Birolleau Vincent Ei');
	assert.equal(merchantLabel(['PAIEMENT CB 0308 108,00 EUR ANTHROPIC* CARTE 09']), 'Anthropic');
	assert.equal(merchantLabel(['VIR SEPA EMET LOYER FONCIA REF123456-7']), 'Loyer Foncia');
	assert.equal(truncateLabel('Inst Biroileau Vincent Ei Cu3w26274m193690', 22).length <= 22, true);
});

test('fiat: approximate yearly conversion', () => {
	assert.equal(toEur(100, 'EUR', '2024-01-01'), 100);
	assert.ok(Math.abs((toEur(100, 'USD', '2024-06-01') ?? 0) - 92) < 1);
	assert.equal(toEur(1, 'XYZ', '2024-01-01'), null);
});

const LEDGER_HEADER = '"txid","refid","time","type","subtype","aclass","wallet","asset","wallet2","amount","fee","balance"';

/** The asset sold is valued at its sale price: VG = 0.5 × 24 000 + 0.1 × 3 000 = 12 300. */
test('taxation: official 150 VH bis example (buy 1 BTC for 10 000 €, sell 0.5 BTC at 20 000 €/BTC → 5 000 € gain)', () => {
	const csv = `${LEDGER_HEADER}
"L1","R1","2024-01-05 10:00:00","deposit","","currency","spot","ZEUR","","10000.0000","0.0000","10000.0000"
"L2","R2","2024-01-06 10:00:00","trade","","currency","spot","ZEUR","","-10000.0000","0.0000","0.0000"
"L3","R2","2024-01-06 10:00:00","trade","","currency","spot","XXBT","","1.0000000000","0.0000000000","1.0000000000"
"L4","R3","2024-06-01 10:00:00","trade","","currency","spot","XXBT","","-0.5000000000","0.0000000000","0.5000000000"
"L5","R3","2024-06-01 10:00:00","trade","","currency","spot","ZEUR","","10000.0000","0.0000","10000.0000"
"L6","R4","2024-07-01 10:00:00","trade","","currency","spot","ZEUR","","-300.0000","0.0000","9700.0000"
"L7","R4","2024-07-01 10:00:00","trade","","currency","spot","XETH","","0.1000000000","0.0000000000","0.1000000000"
"L8","R5","2025-02-01 10:00:00","trade","","currency","spot","XXBT","","-0.2500000000","0.0000000000","0.2500000000"
"L9","R5","2025-02-01 10:00:00","trade","","currency","spot","ZEUR","","6000.0000","10.0000","15690.0000"
`;
	const prices: Record<string, number> = { 'ETH|2025-02-01': 3000 };
	const r = computeTaxReport(parseKrakenLedgerText(csv).entries, (a, d) => prices[`${a}|${d}`]);
	const y2024 = r.years.find((y) => y.year === 2024)!;
	const y2025 = r.years.find((y) => y.year === 2025)!;
	assert.equal(y2024.netGain, 5000);
	assert.equal(y2024.taxEstimate, 1500);
	assert.equal(y2025.netGain, 3404.63);
	assert.equal(r.warnings.length, 0);
});

test('taxation: several orders in the same second do not distort the portfolio value (2018 bug)', () => {
	const csv = `${LEDGER_HEADER}
"L1","R1","2018-05-07 10:00:00","deposit","","currency","spot","ZEUR","","2000.0000","0.0000","2000.0000"
"L2","R2","2018-05-07 10:00:01","trade","","currency","spot","ZEUR","","-1600.0000","0.0000","400.0000"
"L3","R2","2018-05-07 10:00:01","trade","","currency","spot","XETH","","2.6600000000","0.0000000000","2.6600000000"
"L4","R3","2018-05-07 10:00:01","trade","","currency","spot","XETH","","-2.6600000000","0.0000000000","0.0000000000"
"L5","R3","2018-05-07 10:00:01","trade","","currency","spot","ZEUR","","1607.0000","0.0000","2007.0000"
`;
	const r = computeTaxReport(parseKrakenLedgerText(csv).entries, () => undefined);
	const c = r.years[0]!.cessions[0]!;
	assert.ok(Math.abs(c.portfolioValue - 1607) < 1, `VG attendue ≈ 1607, obtenue ${c.portfolioValue}`);
	assert.ok(Math.abs(c.gain - 7) < 1, `PV attendue ≈ 7, obtenue ${c.gain}`);
});

test('ledger: scientific notation accepted (3.8e-7)', () => {
	const csv = `${LEDGER_HEADER}
"L1","R1","2024-01-08 10:00:00","spend","","currency","spot","ADA","","-149809.792172","0","3.8e-7"
`;
	const { entries, errors } = parseKrakenLedgerText(csv);
	assert.equal(errors.length, 0);
	assert.equal(entries[0]!.balance, 3.8e-7);
});

/**
 * 0.01 BTC sent × 60 000 €: the withdrawal fee (0.00005 BTC) is a cost, not an
 * outflow. Partial coverage: the gain is only computed on the quantity with a
 * known cost.
 */
test('performance: contributions, outflows, cost basis, crypto flows valued', () => {
	const csv = `${LEDGER_HEADER}
"L1","R1","2025-01-05 10:00:00","deposit","","currency","spot","ZEUR","","1000.0000","0.0000","1000.0000"
"L2","R2","2025-01-06 10:00:00","trade","","currency","spot","ZEUR","","-500.0000","0.0000","500.0000"
"L3","R2","2025-01-06 10:00:00","trade","","currency","spot","XXBT","","0.0200000000","0.0000000000","0.0200000000"
"L4","R3","2025-06-01 10:00:00","withdrawal","","currency","spot","XXBT","","-0.0100000000","0.0000500000","0.0099500000"
"L5","R4","2025-07-01 10:00:00","deposit","","currency","spot","XETH","","0.5000000000","0.0000000000","0.5000000000"
`;
	const st = applyPerfEntries(emptyPerf(), parseKrakenLedgerText(csv).entries);
	const priceAt = (asset: string, date: string) => (asset === 'BTC' && date === '2025-06-01' ? 60000 : asset === 'ETH' && date === '2025-07-01' ? 2000 : undefined);
	const value = 500 + 0.00995 * 70000 + 0.5 * 2400;
	const p = computePerformance(st, value, priceAt);
	assert.equal(p.invested, 2000);
	assert.equal(p.withdrawn, 600);
	assert.equal(p.unpricedFlows, 0);
	const pnl = assetPnl(st.costBasis['BTC'], 0.00995, 70000)!;
	assert.equal(Math.round(pnl.avgCost), 25000);
	const partial = assetPnl({ qty: 0.001, cost: 50, boughtEur: 50, soldEur: 0, realized: 0 }, 1, 70000)!;
	assert.ok(partial.coverage < 0.01 && Math.abs(partial.pnlEur) < 100);
});

test('amazon: matching by order, partial shipment, item; cancelled orders and other payers ignored', () => {
	const csv = `"Website","Order ID","Order Date","Currency","Unit Price","Total Owed","Quantity","Payment Instrument Type","Order Status","Ship Date","Product Name"
"Amazon.fr","405-1","2026-09-05T14:02:11Z","EUR","99.99","99.99","1","Visa - 1234","Closed","2026-09-07T08:00:00Z","Clavier mécanique Keychron K2"
"Amazon.fr","405-1","2026-09-05T14:02:11Z","EUR","27.18","27.18","1","Visa - 1234","Closed","2026-09-07T08:00:00Z","Câble USB-C 2 m"
"Amazon.fr","405-2","2026-09-06T10:00:00Z","EUR","59.66","59.66","1","Visa - 1234","Closed","2026-09-07T09:00:00Z","Le Seigneur des Anneaux (Livre)"
"Amazon.fr","405-3","2026-09-18T10:00:00Z","EUR","47.13","47.13","1","Visa - 1234","Closed","2026-09-20T09:00:00Z","Casserole inox 20 cm"
"Amazon.fr","405-3","2026-09-18T10:00:00Z","EUR","19.98","39.96","2","Visa - 1234","Closed","2026-09-19T09:00:00Z","Café en grains bio 1 kg"
"Amazon.fr","405-4","2026-09-10T10:00:00Z","EUR","250.00","250.00","1","Mastercard - 4242","Closed","2026-09-11T09:00:00Z","Robot aspirateur"
"Amazon.fr","405-5","2026-09-12T10:00:00Z","EUR","15.19","15.19","1","Visa - 1234","Cancelled","","Chaussettes"
`;
	assert.ok(matchesAmazonHeader(csv.split('\n')[0]!.split(',').map((h) => h.replace(/"/g, ''))));
	const { orders } = parseAmazonOrders(csv);
	assert.equal(orders.length, 4);
	const bank = [
		tx('PAIEMENT CB 0809 PARIS2441535/ AMAZON PAYMENTS CARTE 1234 UI', '2026-09-09', '127.17'),
		tx('PAIEMENT CB 0209 PARIS2441535/ AMAZON PAYMENTS CARTE 1234 UI', '2026-09-08', '59.66'),
		tx('PAIEMENT CB 1909 PARIS2441535/ AMAZON PAYMENTS CARTE 1234 UI', '2026-09-22', '47.13'),
		tx('PAIEMENT CB 1909 PARIS2441535/ AMAZON PAYMENTS CARTE 1234 UI', '2026-09-21', '39.96'),
		tx('PAIEMENT CB 2909 PARIS2441535/ AMAZON PAYMENTS CARTE 1234 UI', '2026-09-30', '15.19')
	];
	const r = matchAmazonOrders(bank, orders);
	assert.equal(r.matches.length, 4);
	assert.equal(r.unmatchedTx, 1);
	assert.equal(r.unmatchedOrders, 1);
	assert.deepEqual(r.matches.map((m) => m.categoryId).sort(), ['alimentation', 'logement', 'loisirs', 'loisirs']);
	assert.deepEqual(inferCategory([{ name: 'Partition piano Chopin', amount: 20, quantity: 1 }]), { categoryId: 'loisirs', subId: 'musique-cours' });
});

/**
 * A subcategory inconsistent with the category (sante) is ignored and the computed one is used.
 */
test('manual subcategory: per transaction then per merchant, consistent with the category', () => {
	const doc = tx('PAIEMENT CB 1709 BIARD VILLE DR MARTIN PAUL CARTE 1234 UIR01262610182', '2026-09-17');
	assert.equal(subcategorize(doc), 'soins');
	setSubOverridesSource({ byTx: { [txKey(doc)]: null }, byMerchant: {} });
	assert.equal(subcategorize(doc), null, 'null forcé = aucune sous-catégorie');
	setSubOverridesSource({ byTx: {}, byMerchant: { 'BIARD VILLE DR MARTIN PAUL': 'pharmacie' } });
	assert.equal(subcategorize(doc), 'pharmacie');
	setSubOverridesSource({ byTx: { [txKey(doc)]: 'carburant' }, byMerchant: {} });
	assert.equal(subcategorize(doc), 'soins');
	setSubOverridesSource({ byTx: {}, byMerchant: {} });
});

/** Outside the holiday period: normal category and subcategory. */
test('holidays: the subcategory keeps the nature of the spending (Alimentation + Vacances)', () => {
	setVacationPredicate((t) => t.booking_date >= '2026-02-07' && t.booking_date <= '2026-02-14');
	try {
		const restaurant = tx('PAIEMENT CB 1002 LES 2 ALPES LE REFUGE RESTAURANT CARTE 1234', '2026-02-10');
		assert.equal(categorize(restaurant), 'vacances');
		assert.equal(subcategorize(restaurant), 'vac-alimentation');
		const hotel = tx('PAIEMENT CB 0902 BOOKING.COM CARTE 1234', '2026-02-09');
		assert.equal(subcategorize(hotel), 'hebergement');
		const after = tx('PAIEMENT CB 1002 LES 2 ALPES LE REFUGE RESTAURANT CARTE 1234', '2026-03-10');
		assert.equal(categorize(after), 'alimentation');
	} finally {
		setVacationPredicate(null);
	}
});

/**
 * Worst case: everything falls inside a holiday period. An override or a
 * « vacances » rule set by mistake on a Kraken movement is ignored.
 */
test('Kraken / transfers between own accounts: never income, never holidays', () => {
	assert.ok(hasInternalKeyword('VIR INST GREGOIRE PAUL-HENRI MARCHAND KRAKEN TX//ABC'));
	assert.ok(hasInternalKeyword('KRAKEN VIREMENT ENTREE'));
	assert.ok(!hasInternalKeyword('PAIEMENT CB 1002 LE REFUGE RESTAURANT'));
	setVacationPredicate(() => true);
	try {
		const ledgerIn = tx('KRAKEN VIREMENT ENTREE ABC-123', '2026-02-10', '1495.00', 'CRDT', { account: 'kraken' });
		assert.equal(categorize(ledgerIn), 'epargne', 'dépôt Kraken : pas un revenu (Épargne & transferts, hors flux)');
		const ledgerOut = tx('KRAKEN VIREMENT SORTIE ABC-124', '2026-02-10', '1495.00', 'DBIT', { account: 'kraken' });
		assert.equal(categorize(ledgerOut), 'epargne', 'retrait Kraken : pas une dépense de vacances');
		const bankSide = tx('VIR INST GREGOIRE PAUL-HENRI MARCHAND KRAKEN TX//ABC', '2026-02-10', '1495.00', 'DBIT');
		assert.equal(categorize(bankSide), 'epargne', 'virement vers Kraken côté banque : pas vacances, pas une dépense');
		const restaurant = tx('PAIEMENT CB 1002 LE REFUGE RESTAURANT CARTE 1234', '2026-02-10');
		assert.equal(categorize(restaurant), 'vacances', 'une vraie dépense reste reclassée');
		assert.equal(categorize(ledgerOut, { [txKey(ledgerOut)]: 'vacances' }), 'epargne');
		assert.equal(categorize(bankSide, {}, [{ keyword: 'VIREMENT VERS KRAKEN', categoryId: 'vacances' } as never]), 'epargne');
	} finally {
		setVacationPredicate(null);
	}
});

/**
 * August layout: « Everyday » wallet on the detail line. February layout: « Spot » /
 * « Main » split, no Wallet column on the detail. Cashback, internal Spot → card
 * transfers are ignored; refunds are kept.
 */
test('Kraken statement: both layouts (Wallet on the detail line / split Spot-Main), clean merchant key', () => {
	const L = (y: number, items: [number, string][]) => ({ y, items: items.map(([x, str]) => ({ x, str })), text: items.map((i) => i[1]).join(' ') });
	const page = [
		L(600, [[564, 'Statement Period: Aug 01, 2026 - Sep 01, 2026']]),
		L(500, [[31, '2026-08-03'], [89, 'Krak Card']]),
		L(490, [[165, 'EUR'], [200, 'Everyday'], [283, '-32.9300'], [381, '1'], [434, '0'], [467, '-32.9300'], [515, 'MAISON FRUGIER'], [642, 'PAYBNDK-GYOBVD-BA2L4D']]),
		L(480, [[31, '04:14:19'], [89, 'Card Payment']]),
		L(470, [[31, '2026-08-03'], [89, 'Krak Card']]),
		L(460, [[165, 'BTC'], [200, 'Everyday'], [262, '0.0000090016'], [339, '54,981.9358'], [434, '0'], [476, '0.4949'], [515, 'MAISON FRUGIER'], [642, 'PAYBNDK-GYOBVD-BA2L4D']]),
		L(450, [[31, '04:14:21'], [89, 'Cashback Reward']]),
		L(400, [[31, '2026-02-14'], [88, 'Krak Card'], [199, 'Spot']]),
		L(390, [[164, 'EUR'], [266, '-67.7700'], [362, '1'], [422, '0'], [464, '-67.7700'], [508, 'Biocoop'], [642, 'PAYFFEG-6FSPKK-VCBXG6']]),
		L(380, [[31, '08:37:30'], [88, 'Card Payment'], [199, 'Main']]),
		L(370, [[31, '2026-03-02'], [88, 'Krak Card'], [199, 'Spot']]),
		L(360, [[164, 'EUR'], [271, '8.0500'], [362, '1'], [422, '0'], [469, '8.0500'], [508, 'Carrefour'], [642, 'PAYLLHK-INGHS5-VA5RIO']]),
		L(350, [[31, '10:00:00'], [88, 'Refund'], [199, 'Main']]),
		L(340, [[31, '2026-02-13'], [199, 'Spot']]),
		L(330, [[88, 'Transfer'], [164, 'EUR'], [263, '100.0000'], [362, '1'], [422, '0'], [460, '100.0000'], [508, 'WMWS-JVDX-SL3W-8BGF'], [642, 'TRH7LEL-M3G2N-SQLUPF']]),
		L(320, [[31, '13:17:41'], [199, 'Main']])
	];
	const r = parseKrakLines([page]);
	assert.equal(r.month, '2026-08');
	assert.equal(r.activities.length, 5);
	assert.deepEqual(r.stats, { payments: 2, refunds: 1, cashback: 1, other: 1 });
	assert.equal(r.errors.length, 0);
	const [a, b, c] = r.transactions;
	assert.deepEqual([a!.booking_date, a!.transaction_amount.amount, a!.credit_debit_indicator, a!.account], ['2026-08-03', '32.93', 'DBIT', 'krak-card']);
	assert.deepEqual(a!.remittance_information, ['CARTE KRAK MAISON FRUGIER', 'PAYBNDK-GYOBVD-BA2L4D']);
	assert.equal(merchantKey(a!.remittance_information), 'MAISON FRUGIER');
	assert.equal(categorize(a!), 'alimentation');
	assert.deepEqual([b!.transaction_amount.amount, b!.credit_debit_indicator], ['67.77', 'DBIT']);
	assert.equal(merchantKey(b!.remittance_information), 'BIOCOOP');
	assert.deepEqual([c!.transaction_amount.amount, c!.credit_debit_indicator], ['8.05', 'CRDT']);
	assert.equal(categorize(c!), 'alimentation', 'remboursement Carrefour : déduit de l’alimentation');
});
