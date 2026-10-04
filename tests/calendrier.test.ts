import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CategoryId, Transaction } from '../src/lib/types';
import { budgetSpend, calendarMonth, countWeekdays, purchaseDate, purchaseMonthRange, rangePurchases, weekdayAverages, weekdayOf } from '../src/lib/spendingCalendar';

/** Spending calendar by purchase date (Transactions page, Calendar view). Fictitious data. */

const tx = (label: string, booking: string, amount: number, extra: Partial<Transaction> = {}): Transaction => ({
	transaction_amount: { amount: Math.abs(amount).toFixed(2), currency: 'EUR' },
	booking_date: booking,
	value_date: booking,
	remittance_information: [label],
	credit_debit_indicator: amount >= 0 ? 'CRDT' : 'DBIT',
	...extra
});
// Forced categories: the test is about the calendar, not categorisation
const catOf = (t: Transaction): CategoryId => {
	const label = t.remittance_information.join(' ');
	if (label.includes('SALAIRE')) return 'revenus';
	if (label.includes('LIVRET')) return 'epargne';
	return 'alimentation';
};

test('purchaseDate: DDMM from the card label, otherwise the booking date', () => {
	assert.equal(purchaseDate(tx('PAIEMENT CB 1809 VILLE EPICERIE CARTE 0000', '2026-09-22', -12)), '2026-09-18');
	assert.equal(purchaseDate(tx('PAIEMENT PSC 2709 VILLE BOULANGERIE CARTE 0000', '2026-09-29', -3)), '2026-09-27');
	assert.equal(purchaseDate(tx('PRLV SEPA FOURNISSEUR', '2026-09-05', -40)), '2026-09-05');
	assert.equal(purchaseDate(tx('PAIEMENT CB 0110 VILLE X', '', -5)), '', 'opération en cours');
});

/** 2026-09-28 is a Monday, 2026-10-03 a Saturday, 2026-10-04 a Sunday. */
test('weekdayOf: Monday = 0, Sunday = 6', () => {
	assert.equal(weekdayOf('2026-09-28'), 0);
	assert.equal(weekdayOf('2026-10-03'), 5);
	assert.equal(weekdayOf('2026-10-04'), 6);
});

/** A purchase on Saturday 26/09 is booked on Monday 28/09. */
test('calendarMonth: spending on the purchase date, not the booking date', () => {
	const txs = [
		tx('PAIEMENT CB 2609 VILLE MARCHE CARTE 0000', '2026-09-28', -45.5),
		tx('PAIEMENT CB 2609 VILLE FROMAGER CARTE 0000', '2026-09-28', -12.3),
		tx('PRLV SEPA FOURNISSEUR', '2026-09-28', -20)
	];
	const cal = calendarMonth(txs, '2026-09', catOf);
	assert.equal(cal.days.length, 30);
	assert.equal(cal.leading, 1, 'le 1er septembre 2026 est un mardi');
	const d26 = cal.days[25]!;
	assert.equal(d26.date, '2026-09-26');
	assert.equal(d26.spend, 57.8);
	assert.equal(d26.count, 2);
	assert.equal(d26.weekday, 5);
	assert.equal(cal.days[27]!.spend, 20, 'prélèvement : date comptable');
	assert.equal(cal.total, 77.8);
	assert.equal(cal.max, 57.8);
	assert.equal(cal.activeDays, 2);
});

test('calendarMonth: a purchase on 31/12 booked in January → December of the previous year', () => {
	const txs = [tx('PAIEMENT CB 3112 VILLE TRAITEUR CARTE 0000', '2027-01-04', -80)];
	const dec = calendarMonth(txs, '2026-12', catOf);
	const jan = calendarMonth(txs, '2027-01', catOf);
	assert.equal(dec.days[30]!.spend, 80);
	assert.equal(dec.total, 80);
	assert.equal(jan.total, 0);
	assert.equal(jan.activeDays, 0);
	assert.deepEqual(purchaseMonthRange(txs, catOf), { first: '2026-12', last: '2026-12' });
});

/**
 * A store credit on the purchase day is deducted, as in the Budget; a refund alone
 * on another day gives a negative day.
 */
test('calendarMonth: a refund lowers the day; income, savings, pending and wealth lines excluded', () => {
	const txs = [
		tx('PAIEMENT CB 1009 VILLE MAGASIN CARTE 0000', '2026-09-11', -60),
		tx('AVOIR CB 1009 VILLE MAGASIN', '2026-09-10', 25),
		tx('REMBOURSEMENT ACHAT', '2026-09-15', 18),
		tx('VIR SALAIRE EMPLOYEUR', '2026-09-10', 2500),
		tx('VIREMENT VERS LIVRET', '2026-09-10', -300),
		tx('PAIEMENT CB 1009 VILLE ATTENTE', '', -9),
		tx('ACHAT ETF', '2026-09-10', -500, { account: 'kraken', source: 'kraken' })
	];
	const cal = calendarMonth(txs, '2026-09', catOf);
	assert.equal(cal.days[9]!.spend, 35);
	assert.equal(cal.days[9]!.count, 2);
	assert.equal(cal.days[14]!.spend, -18);
	assert.equal(cal.max, 35);
	assert.equal(cal.total, 17);
	assert.equal(budgetSpend(txs[3]!, catOf), null, 'revenu');
	assert.equal(budgetSpend(txs[4]!, catOf), null, 'épargne');
	assert.equal(budgetSpend(txs[5]!, catOf), null, 'en cours');
	assert.equal(budgetSpend(txs[6]!, catOf), null, 'ligne de patrimoine');
});

/**
 * Monday 28/09 to Sunday 04/10/2026 is one full week; Saturday 03/10 to Monday
 * 12/10 has 2 Saturdays, 2 Sundays and 2 Mondays.
 */
test('countWeekdays: number of each weekday between two dates, both included', () => {
	assert.deepEqual(countWeekdays('2026-09-28', '2026-10-04'), [1, 1, 1, 1, 1, 1, 1]);
	assert.deepEqual(countWeekdays('2026-10-03', '2026-10-12'), [2, 1, 1, 1, 1, 2, 2]);
	assert.deepEqual(countWeekdays('2026-10-05', '2026-10-01'), [0, 0, 0, 0, 0, 0, 0]);
	assert.deepEqual(countWeekdays('', '2026-10-01'), [0, 0, 0, 0, 0, 0, 0]);
});

/**
 * Purchases on Saturday 03/10, Saturday 10/10 and Monday 05/10. Without bounds the
 * period runs from the first to the last purchase date; with bounds, purchases
 * outside the period do not count.
 */
test('weekdayAverages: weekday total / number of those weekdays in the period, days without purchases included', () => {
	const txs = [
		tx('PAIEMENT CB 0310 VILLE MARCHE CARTE 0000', '2026-10-05', -30),
		tx('PAIEMENT CB 1010 VILLE MARCHE CARTE 0000', '2026-10-12', -50),
		tx('PAIEMENT CB 0510 VILLE BOULANGERIE CARTE 0000', '2026-10-06', -6),
		tx('VIR SALAIRE EMPLOYEUR', '2026-10-05', 2500)
	];
	const stats = weekdayAverages(txs, catOf, '2026-10-03', '2026-10-16');
	const sat = stats[5]!;
	assert.equal(sat.label, 'Sam');
	assert.equal(sat.days, 2);
	assert.equal(sat.total, 80);
	assert.equal(sat.average, 40);
	assert.equal(stats[0]!.average, 3, 'lundi : 6 € sur 2 lundis');
	assert.equal(stats[2]!.average, 0);
	const auto = weekdayAverages(txs, catOf);
	assert.equal(auto[5]!.days, 2);
	assert.equal(auto[0]!.days, 1);
	assert.equal(weekdayAverages(txs, catOf, '2026-10-04', '2026-10-09')[5]!.total, 0);
});

/** Side panel of the calendar: what a click on a day (or a slide over days) lists. */
test('rangePurchases: one day lists its purchases by purchase date, not booking date', () => {
	const txs = [
		tx('PAIEMENT CB 2609 VILLE MARCHE CARTE 0000', '2026-09-28', -45.5),
		tx('PAIEMENT CB 2609 VILLE FROMAGER CARTE 0000', '2026-09-28', -12.3),
		tx('PRLV SEPA FOURNISSEUR', '2026-09-28', -20)
	];
	const day = rangePurchases(txs, '2026-09-26', '2026-09-26', catOf);
	assert.equal(day.count, 2);
	assert.equal(day.total, 57.8);
	assert.deepEqual(day.items.map((i) => [i.date, i.spend]), [['2026-09-26', 45.5], ['2026-09-26', 12.3]], 'largest first');
	assert.equal(rangePurchases(txs, '2026-09-28', '2026-09-28', catOf).total, 20, 'direct debit: booking date');
});

test('rangePurchases: inclusive range in either order, same total as the calendar cells', () => {
	const txs = [
		tx('PAIEMENT CB 0309 VILLE A CARTE 0000', '2026-09-04', -10),
		tx('PAIEMENT CB 0709 VILLE B CARTE 0000', '2026-09-08', -25.4),
		tx('PAIEMENT CB 1209 VILLE C CARTE 0000', '2026-09-14', -8),
		tx('PAIEMENT CB 1309 VILLE D CARTE 0000', '2026-09-15', -99)
	];
	const range = rangePurchases(txs, '2026-09-12', '2026-09-03', catOf);
	assert.deepEqual(range.items.map((i) => i.date), ['2026-09-03', '2026-09-07', '2026-09-12'], 'sorted by day, bounds included');
	const cells = calendarMonth(txs, '2026-09', catOf).days.filter((d) => d.date >= '2026-09-03' && d.date <= '2026-09-12');
	assert.equal(range.total, Math.round(cells.reduce((s, d) => s + d.spend, 0) * 100) / 100);
	assert.equal(range.count, cells.reduce((s, d) => s + d.count, 0));
});

test('rangePurchases: refunds deducted; income, savings and pending left out', () => {
	const txs = [
		tx('PAIEMENT CB 0509 VILLE MAGASIN CARTE 0000', '2026-09-07', -60),
		tx('REMBOURSEMENT MAGASIN', '2026-09-05', 15),
		tx('VIR SALAIRE EMPLOYEUR FICTIF', '2026-09-05', 2500),
		tx('VIR LIVRET FICTIF', '2026-09-05', -300),
		tx('PAIEMENT CB 0509 VILLE CAFE CARTE 0000', '', -3)
	];
	const day = rangePurchases(txs, '2026-09-05', '2026-09-05', catOf);
	assert.equal(day.count, 2);
	assert.equal(day.total, 45);
	assert.deepEqual(day.items.map((i) => i.spend), [60, -15]);
	assert.equal(rangePurchases([], '2026-09-01', '2026-09-30', catOf).count, 0);
});
