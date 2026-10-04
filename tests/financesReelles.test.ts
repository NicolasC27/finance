import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Transaction } from '../src/lib/types';
import { priceFactor, sectorInflation, livretARate, averageLivretARate, SECTOR_INFLATION } from '../src/lib/inflation';
import { principalBefore, remainingCost, currentInstallment, loanInstallments, estimateRate, earlyRepaymentFee, principalParts, simulateEarlyRepayment, amortizationTable, rateFromInstallment } from '../src/lib/loanCost';
import { priceRise, abnormalRise, periodsPerYear } from '../src/lib/priceRises';
import { comparePriceItems, inflationByCategory, personalInflation, priceItemOf, PRICE_ITEM_BY_SUBCATEGORY, type PriceItem } from '../src/lib/personalInflation';
import { returnSummary, cryptoRealReturn, averageSavings, monthsToReach, projectNetWorth, realReturn, regulatedRate } from '../src/lib/realReturn';
import { undoableIndexation, indexationToSuggest, indexBudgets, readIndexation, type Indexation } from '../src/lib/indexation';
import { SUBCATEGORIES } from '../src/lib/subDict';

/** Real return, projection, personal inflation, price rises, indexed budgets, loan cost. */

const tx = (date: string, amount: number, label: string, account = 'cm-00000012345'): Transaction => ({
	transaction_amount: { amount: Math.abs(amount).toFixed(2), currency: 'EUR' },
	booking_date: date,
	value_date: date,
	remittance_information: [label],
	credit_debit_indicator: amount < 0 ? 'DBIT' : 'CRDT',
	account
});

/**
 * Livret A in 2025: 3 % in January, 2.4 % from February to July, 1.7 % from August
 * to December. A full year equals that year's inflation; two years chain.
 */
test('inflation: INSEE items, Livret A and price rise between two dates', () => {
	assert.equal(sectorInflation(2023, 'alimentation'), 11.8);
	assert.equal(sectorInflation(2025, 'energie'), -5.6);
	assert.equal(sectorInflation(2025, 'ensemble'), 0.9);
	assert.equal(sectorInflation(2019, 'services'), null, 'année non couverte');
	for (const [year, s] of Object.entries(SECTOR_INFLATION)) assert.equal(Object.keys(s).length, 5, year);
	assert.deepEqual(livretARate('2026-10-03'), { taux: 1.7, depuis: '2026-08-01' });
	assert.equal(livretARate('2023-01-31').taux, 2.0);
	assert.equal(livretARate('2023-02-01').taux, 3.0);
	assert.ok(Math.abs(averageLivretARate(2025) - (3 + 2.4 * 6 + 1.7 * 5) / 12) < 1e-9);
	assert.ok(Math.abs(averageLivretARate(2026, '2026-02') - (1.7 + 1.5) / 2) < 1e-9);
	assert.ok(Math.abs(priceFactor('2023-01-01', '2024-01-01') - 1.049) < 1e-9);
	assert.ok(Math.abs(priceFactor('2023-01-01', '2025-01-01') - 1.049 * 1.02) < 1e-9);
	assert.equal(priceFactor('2025-05-01', '2025-05-01'), 1);
	const half = priceFactor('2024-01-01', '2024-07-01');
	assert.ok(half > 1.009 && half < 1.011, String(half));
});

/**
 * 8 000 € at 5.5 % over 48 months: payment ≈ 186.05 €. Full repayment avoids all
 * interest, no penalty under 10 000 €; a partial one keeps the payment and ends
 * earlier. Penalty above 10 000 € over 12 months: 1 % (0.5 % under a year),
 * capped at the avoided interest. Running the amortisation backwards finds the
 * original principal.
 */
test('loan cost: amortisation, remaining interest, early repayment', () => {
	const r = 5.5 / 1200;
	const payment = Math.round(((8000 * r) / (1 - Math.pow(1 + r, -48))) * 100) / 100;
	const p = { capital: 8000, mensualite: payment, taux: 5.5 };
	const t = amortizationTable(p);
	assert.equal(t.length, 48);
	assert.equal(t[t.length - 1]!.restant, 0);
	assert.ok(t[1]!.capital > t[0]!.capital, 'la part de capital grandit');
	const c = remainingCost(p)!;
	assert.ok(Math.abs(c.interets - (48 * payment - 8000)) < 1, String(c.interets));
	assert.equal(remainingCost({ capital: 8000, mensualite: 30, taux: 5.5 }), null, 'échéance < intérêts : jamais remboursé');
	const full = simulateEarlyRepayment(p, 99_999)!;
	assert.equal(full.montant, 8000);
	assert.equal(full.interetsEvites, c.interets);
	assert.equal(full.echeancesApres, 0);
	assert.equal(full.indemnite, 0);
	const partial = simulateEarlyRepayment(p, 2000)!;
	assert.ok(partial.echeancesEnMoins >= 12 && partial.echeancesApres > 0, JSON.stringify(partial));
	assert.ok(partial.interetsEvites > 0 && partial.interetsEvites < c.interets);
	assert.equal(earlyRepaymentFee(15_000, 24, 900), 150);
	assert.equal(earlyRepaymentFee(15_000, 10, 900), 75);
	assert.equal(earlyRepaymentFee(15_000, 24, 40), 40);
	assert.equal(earlyRepaymentFee(6000, 24, 900, 5000), 60, 'déjà 5 000 € remboursés dans l’année');
	const after12 = t[11]!.restant;
	assert.ok(Math.abs(principalBefore({ ...p, capital: after12 }, 12) - 8000) < 1);
});

/**
 * Without a recognised account number and with a single tracked loan, the most
 * recent payment series is used.
 */
test('loan cost: instalments and rate found in the statements', () => {
	const r = 4.8 / 1200;
	const P = 210;
	let capital = 9000;
	const txs: Transaction[] = [];
	const parts: number[] = [];
	for (let m = 1; m <= 9; m++) {
		const date = `2026-0${m}-06`;
		txs.push(tx(date, -P, 'ECH PRET AUTO 01234 005678 01 UTILISATION N°001'));
		const capitalPart = Math.round((P - capital * r) * 100) / 100;
		capital -= capitalPart;
		parts.push(capitalPart);
		if (m >= 8) txs.push(tx(date, capitalPart, 'MENSUALITE PRELEVEE', 'cm-00000567801'));
	}
	txs.push(tx('2026-05-10', -45, 'PRLV SEPA FREE MOBILE'), tx('2026-05-12', -300, 'ECH PRET IMMO 09999 111111 02'));
	const installments = loanInstallments(txs, 'cm-00000567801');
	assert.equal(installments.length, 9, 'le prêt immo (autre numéro) n’est pas compté');
	assert.equal(currentInstallment(installments), 210);
	const principalRows = principalParts(txs, 'cm-00000567801');
	assert.deepEqual(principalRows.map((x) => x.montant), parts.slice(-2));
	assert.equal(estimateRate(installments, principalRows, Math.round(capital * 100) / 100), 4.8);
	assert.equal(rateFromInstallment(100, 120, 5000), null, 'part de capital > échéance');
	assert.equal(loanInstallments(txs, 'cm-00000000042', true).length, 9);
	assert.equal(loanInstallments(txs, 'cm-00000000042').length, 0);
});

/**
 * Insurance at 18.40 € until December, 21.20 € since January. A rise at the
 * inflation pace raises no alert; a short history (< 6 months) says nothing;
 * under a year of history the rise is annualised. Tolls depend on usage and are
 * never a « price rise »; a new price seen once is not a rise yet; a big rise of
 * a fixed price (+40 %) is detected.
 */
test('price rises: one year apart, annualised, compared with inflation', () => {
	const monthly = (start: string, n: number, amount: (i: number) => number) =>
		Array.from({ length: n }, (_, i) => {
			const d = new Date(`${start}T00:00:00Z`);
			d.setUTCMonth(d.getUTCMonth() + i);
			return { date: d.toISOString().slice(0, 10), montant: amount(i) };
		});
	const insurance = monthly('2025-04-10', 18, (i) => (i < 9 ? 18.4 : 21.2));
	const h = priceRise(insurance, 12)!;
	assert.equal(h.avant, 18.4);
	assert.equal(h.apres, 21.2);
	assert.equal(h.hausse, 15.2);
	assert.ok(Math.abs(h.parAn - 15.2) < 1.5, String(h.parAn));
	assert.equal(h.coutAn, 33.6);
	assert.ok(abnormalRise(h, 3));
	const stable = priceRise(monthly('2025-04-10', 18, (i) => (i < 9 ? 40 : 41.2)), 12)!;
	assert.equal(stable.hausse, 3);
	assert.equal(abnormalRise(stable, 3), false);
	assert.equal(priceRise(monthly('2026-06-01', 4, () => 10), 12), null);
	const eight = priceRise(monthly('2026-01-05', 9, (i) => (i < 4 ? 10 : 11)), 12)!;
	assert.ok(eight.parAn > eight.hausse, JSON.stringify(eight));
	const tolls = monthly('2025-04-20', 18, (i) => [12, 31, 8.5, 44, 19, 27][i % 6]!);
	assert.equal(priceRise(tolls, 12), null);
	assert.equal(priceRise(monthly('2025-04-10', 18, (i) => (i < 17 ? 30 : 39)), 12), null);
	assert.equal(priceRise(monthly('2025-04-10', 18, (i) => (i < 12 ? 30 : 42)), 12)?.hausse, 40);
	assert.equal(periodsPerYear('trimestrielle'), 4);
	assert.equal(periodsPerYear('hebdomadaire'), 52);
});

/**
 * Every expense subcategory maps to a CPI item (or is explicitly excluded).
 * Spending up 10 % while prices rise 2.3 % → +7.5 % in volume. Only comparable
 * months count; small amounts show no variation. Per category, Voiture = fuel
 * (energy) + insurance (services).
 */
test('personal inflation: items weighted by your spending', () => {
	for (const s of SUBCATEGORIES.filter((x) => x.categoryId !== 'revenus')) assert.ok(s.id in PRICE_ITEM_BY_SUBCATEGORY, s.id);
	assert.equal(priceItemOf('voiture', 'carburant'), 'energie');
	assert.equal(priceItemOf('voiture', 'credit-auto'), null);
	assert.equal(priceItemOf('voiture'), 'ensemble');
	assert.equal(priceItemOf('impots'), null);
	const spend = new Map<PriceItem, number>([
		['energie', 1000],
		['services', 3000]
	]);
	const p = personalInflation(spend, 2025)!;
	assert.equal(p.taux, Math.round((0.25 * -5.6 + 0.75 * 2.3) * 10) / 10);
	assert.equal(p.officielle, 0.9);
	assert.equal(p.postes[0]!.poste, 'services');
	assert.equal(personalInflation(spend, 2018), null);
	assert.equal(personalInflation(new Map(), 2025), null);
	const rows = comparePriceItems(new Map<PriceItem, number>([['services', 1100]]), new Map<PriceItem, number>([['services', 1000]]), 2025);
	assert.equal(rows[0]!.variation, 10);
	assert.equal(rows[0]!.volume, Math.round(((1.1 / 1.023 - 1) * 100) * 10) / 10);
	const comp = comparePriceItems(new Map<PriceItem, number>([['services', 2400], ['tabac', 60]]), new Map<PriceItem, number>([['services', 1000], ['tabac', 40]]), 2025, new Map<PriceItem, number>([['services', 1050], ['tabac', 30]]));
	assert.equal(comp.find((l) => l.poste === 'services')!.variation, 5);
	assert.equal(comp.find((l) => l.poste === 'tabac')!.variation, null);
	const byCategory = inflationByCategory(
		[
			{ categoryId: 'voiture', poste: 'energie', montant: 600 },
			{ categoryId: 'voiture', poste: 'services', montant: 400 }
		],
		2024
	);
	assert.equal(byCategory.get('voiture'), Math.round((0.6 * 2.3 + 0.4 * 2.7) * 10) / 10);
	assert.equal(byCategory.get('alimentation'), 1.4, 'sans dépense : poste par défaut');
	assert.equal(byCategory.has('impots'), false, 'les impôts ne sont pas indexés');
});

/**
 * Crypto: 10 000 € put in early 2023, worth 12 000 € → +20 %, less once inflation
 * is deducted.
 */
test('real return: savings accounts, employee savings, current account, crypto', () => {
	assert.ok(Math.abs(realReturn(1.7, 3) - (1.017 / 1.03 - 1) * 100) < 1e-9);
	const b = returnSummary(
		[
			{ id: 'cc', label: 'Compte courant', type: 'courant', montant: 5000, taux: 0, source: '' },
			{ id: 'ldds', label: 'LDDS', type: 'livret', montant: 10000, taux: 1.7, source: '' },
			{ id: 'vide', label: 'Vide', type: 'livret', montant: 0, taux: 3, source: '' }
		],
		3
	);
	assert.equal(b.lignes.length, 2);
	assert.equal(b.lignes[0]!.id, 'ldds');
	assert.equal(b.lignes[0]!.gainReelAn, Math.round(10000 * (1.017 / 1.03 - 1)));
	assert.equal(b.lignes[1]!.gainReelAn, Math.round(5000 * (1 / 1.03 - 1)));
	assert.equal(b.total, 15000);
	assert.ok(Math.abs(b.tauxMoyen - (10000 * 1.7) / 15000) < 0.01);
	assert.ok(b.gainReelAn < 0);
	assert.equal(regulatedRate('LIVRET DE DEVELOPPEMENT DURABLE SOLIDAIRE', '2026-10-03')?.taux, 1.7);
	assert.equal(regulatedRate('LIVRET BLEU M ALEX MARTIN', '2024-06-01')?.taux, 3);
	assert.match(regulatedRate('LIVRET A', '2026-10-03')!.source, /1er août 2026/);
	assert.equal(regulatedRate('LEP M ALEX MARTIN', '2026-10-03'), null, 'LEP : taux à saisir');
	assert.equal(regulatedRate('LIVRET FIDELITE', '2026-10-03'), null);
	const c = cryptoRealReturn(10000, 0, 12000, [{ date: '2023-01-01', montant: 10000 }], '2025-01-01')!;
	assert.equal(c.gainPct, 20);
	assert.equal(c.inflation, Math.round((1.049 * 1.02 - 1) * 1000) / 10);
	assert.ok(c.gainReel < c.gain && c.gainReel > 0, JSON.stringify(c));
	assert.equal(cryptoRealReturn(0, 0, 100, [], '2025-01-01'), null);
});

test('projection: constant euros, monthly savings, goal date', () => {
	const noReturn = projectNetWorth({ depart: 10000, epargneMois: 500, reel: 0 }, 24);
	assert.equal(noReturn.length, 25);
	assert.equal(noReturn[24], 22000);
	const withReturn = projectNetWorth({ depart: 10000, epargneMois: 500, reel: 3 }, 12);
	assert.ok(withReturn[12]! > 16000 && Math.abs(withReturn[12]! - (10000 * 1.03 + 500 * 12 * 1.0137)) < 30, String(withReturn[12]));
	assert.equal(monthsToReach({ depart: 10000, epargneMois: 500, reel: 0 }, 13000), 6);
	assert.equal(monthsToReach({ depart: 20000, epargneMois: 500, reel: 0 }, 13000), 0);
	assert.equal(monthsToReach({ depart: 1000, epargneMois: -50, reel: 0 }, 13000), null);
	assert.equal(averageSavings([1000, 1200, 800]), 1000);
	assert.equal(averageSavings([]), 0);
});

test('indexed budgets: rounding, categories without a rate, once a year, undo', () => {
	const { budgets, taux: rates } = indexBudgets({ alimentation: 420, impots: 280, energie: 100 }, (c) => (c === 'impots' ? null : c === 'energie' ? 21.2 : 3));
	assert.deepEqual(budgets, { alimentation: 433, impots: 280, energie: 121 });
	assert.deepEqual(rates, { alimentation: 3, energie: 21.2 });
	const ix: Indexation = { date: '2027-01-04', mode: 'global', taux: rates, avant: { alimentation: 420 }, apres: { alimentation: 433 } };
	assert.equal(indexationToSuggest('2027-01-02', null), true);
	assert.equal(indexationToSuggest('2027-02-02', null), false, 'seulement en janvier');
	assert.equal(indexationToSuggest('2027-01-20', ix), false, 'déjà fait cette année');
	assert.equal(indexationToSuggest('2028-01-03', ix), true);
	assert.equal(undoableIndexation(ix, { alimentation: 433 }, '2027-01-20'), true);
	assert.equal(undoableIndexation(ix, { alimentation: 450 }, '2027-01-20'), false, 'retouchée depuis');
	assert.equal(undoableIndexation(ix, { alimentation: 433 }, '2027-03-01'), false, 'plus de 30 jours');
	assert.equal(readIndexation(JSON.parse(JSON.stringify(ix)))?.date, '2027-01-04');
	assert.equal(readIndexation({ date: 'hier' }), null);
});
