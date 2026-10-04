import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Transaction } from '../src/lib/types';
import { categorize, setVacationPredicate } from '../src/lib/categories';
import { subcategorize } from '../src/lib/subcategories';
import type { Asset } from '../src/lib/assets';
import { monthlyCost, plateDate, estimateKm, kmAt, kmPerYear, valuationLinks, bodyPalette, kmPoints, nextMilestones, priceTrend, vehicleValue, type CarExpense } from '../src/lib/vehicle';

/** Voiture category (bank, dictionary, holidays) and vehicle sheet (odometer, monthly cost, deadlines). */

const tx = (label: string, amount: number, extra: Partial<Transaction> = {}): Transaction => ({
	transaction_amount: { amount: Math.abs(amount).toFixed(2), currency: 'EUR' },
	booking_date: '2026-08-10',
	value_date: '2026-08-10',
	remittance_information: [label],
	credit_debit_indicator: amount >= 0 ? 'CRDT' : 'DBIT',
	...extra
});
const vehicleCategory = (sub: string) => ({ bank_category: 'Véhicule', bank_subcategory: sub });
const classify = (t: Transaction) => `${categorize(t, {}, [], new Map())}/${subcategorize(t, {}, [], new Map()) ?? '-'}`;

/**
 * A card payment filed under « Achat / crédit / leasing » is never a loan payment
 * (parking); « Entretien » outside Véhicule is not the car.
 */
test('Crédit Mutuel « Véhicule / … »: your car; « Véhicule, divers » (trains…) stays Transport', () => {
	assert.equal(classify(tx('PAIEMENT CB 1510 POITIERS RELAIS POITIERS CARTE 3456', -75.78, vehicleCategory('Carburant'))), 'voiture/carburant');
	assert.equal(classify(tx('PAIEMENT CB 0304 GARAGE DU PONT CARTE 0000', -412.40, vehicleCategory('Entretien'))), 'voiture/entretien-auto');
	assert.equal(classify(tx('PRLV SEPA AUTOROUTES DU SUD DE MH030963300047330157 082026', -59, vehicleCategory('Parking / péage'))), 'voiture/peages-parkings');
	assert.equal(classify(tx('AUTOMOBILE AA00000000', -58.90, vehicleCategory('Assurance'))), 'voiture/assurance-auto');
	assert.equal(classify(tx('ECH PRET AUTO 00000 000000 01', -176.20, vehicleCategory('Achat / crédit / leasing'))), 'voiture/credit-auto');
	assert.equal(classify(tx('PAIEMENT PSC 1311 16 POITIERS GESTA 8 AUT CARTE 3456', -2.6, vehicleCategory('Achat / crédit / leasing'))), 'voiture/peages-parkings');
	assert.equal(classify(tx('PAIEMENT CB 2307 PARIS 12 SNCF WEB MOBILE CARTE 2345', -20.5, vehicleCategory('Véhicule, divers'))), 'transport/voyages');
	assert.equal(classify(tx('RATP', -4.2, { bank_category: 'Vie quotidienne', bank_subcategory: 'Transport / taxi / location' })), 'transport/transports-commun');
	assert.notEqual(categorize(tx('PAIEMENT CB 0101 JARDINERIE', -40, { bank_category: 'Logement / maison', bank_subcategory: 'Entretien' }), {}, [], new Map()), 'voiture');
});

test('no bank category (Krak card, direct debits): Voiture dictionary', () => {
	const krak = { account: 'krak-card' };
	assert.equal(classify(tx('CARTE KRAK CT 16 PAYQR22-7PP3PY-KDECPY', -78, krak)), 'voiture/controle-technique');
	assert.equal(classify(tx('CARTE KRAK RÉFÉRENCE AUTOMOBILES PAYRQB3-DCLU3D-3LCA4O', -498.59, krak)), 'voiture/entretien-auto');
	assert.equal(classify(tx('CARTE KRAK TotalEnergies PAYOVCE-XGA4ZC-FRO4DQ', -80, krak)), 'voiture/carburant');
	assert.equal(classify(tx('CARTE KRAK Easy Park PAYZHD3-TLXLMW-TODEO6', -9.45, krak)), 'voiture/peages-parkings');
	assert.equal(classify(tx('PRLV SEPA AUTOROUTES DU SUD DE LK025653560047330157 112025', -10.5)), 'voiture/peages-parkings');
	assert.equal(classify(tx('PAIEMENT CB 0301 VILLENEUVE D NORAUTO E COMME CARTE 3456', -54.95)), 'voiture/entretien-auto');
	assert.equal(classify(tx('PAIEMENT CB 1208 PARIS LA DEFE LW-SNCF CONNECT CARTE 2345', -154.5)), 'transport/voyages');
});

test('holidays: fuel and tolls follow the trip; loan, insurance and servicing stay in Voiture', () => {
	setVacationPredicate((t) => t.booking_date >= '2026-08-01' && t.booking_date <= '2026-08-20');
	try {
		assert.equal(classify(tx('PAIEMENT CB 0708 POITIERS RELAIS POITIERS CARTE 2345', -50.07, vehicleCategory('Carburant'))), 'vacances/vac-transport');
		assert.equal(classify(tx('CARTE KRAK TotalEnergies PAYNXMF', -30, { account: 'krak-card' })), 'vacances/vac-transport');
		assert.equal(classify(tx('AUTOMOBILE AA00000000', -58.90, vehicleCategory('Assurance'))), 'voiture/assurance-auto');
		assert.equal(classify(tx('ECH PRET AUTO 00000 000000 01', -176.20, vehicleCategory('Achat / crédit / leasing'))), 'voiture/credit-auto');
		assert.equal(classify(tx('CARTE KRAK RÉFÉRENCE AUTOMOBILES PAYRQB3', -498.59, { account: 'krak-card' })), 'voiture/entretien-auto');
	} finally {
		setVacationPredicate(null);
	}
});

/* ---------- Vehicle sheet ---------- */


const CAR: Asset = {
	id: 'v1',
	type: 'vehicule',
	name: 'Toyota C-HR',
	purchaseDate: '2024-03-15',
	purchasePrice: 24900,
	linkedTxKeys: [],
	vehicle: {
		firstRegistration: '2022-03-15',
		kmAtPurchase: 20000,
		kmLog: [
			{ date: '2025-04-03', km: 38000, source: 'facture' },
			{ date: '2026-03-31', km: 54000, source: 'ct' }
		]
	}
};

test('odometer: interpolated between readings, extended at the average pace; km per calendar year', () => {
	const pts = kmPoints(CAR);
	assert.deepEqual(pts.map((p) => [p.date, p.km, p.source]), [['2024-03-15', 20000, 'achat'], ['2025-04-03', 38000, 'facture'], ['2026-03-31', 54000, 'ct']]);
	assert.equal(kmAt(pts, '2024-01-01'), 20000, 'avant le premier point : compteur du premier point');
	assert.equal(kmAt(pts, '2025-04-03'), 38000);
	const pace = (54000 - 20000) / ((Date.parse('2026-03-31') - Date.parse('2024-03-15')) / 86_400_000);
	assert.equal(kmAt(pts, '2026-10-03'), Math.round(54000 + pace * 186), 'après le dernier relevé : rythme moyen');
	const perYear = kmPerYear(pts, '2026-10-03');
	assert.equal(perYear.moyenne, Math.round(pace * 365.25));
	assert.deepEqual(perYear.annees.map((a) => [a.annee, a.partiel, a.estime]), [[2024, true, false], [2025, false, false], [2026, true, true]]);
	assert.equal(perYear.annees.reduce((s, a) => s + a.km, 0), (kmAt(pts, '2026-10-03') ?? 0) - 20000, 'les années s’additionnent');
});

/**
 * Transactions before the purchase are ignored and refunds are deducted. A balance
 * paid on purchase day, filed « Crédit » by the bank but linked to the asset, is
 * the purchase itself. With a dated estimate, the loss is spread until the
 * estimate date.
 */
test('monthly cost with the loss of value: depreciation + Voiture items since the purchase; the purchase itself replaced by depreciation', () => {
	const expenses: CarExpense[] = [
		{ date: '2024-03-06', montant: 2100, sub: 'achat-vehicule' },
		{ date: '2024-03-15', montant: 22800, sub: 'achat-vehicule' },
		{ date: '2023-12-01', montant: 999, sub: 'carburant' },
		{ date: '2025-04-07', montant: 412.40, sub: 'entretien-auto' },
		{ date: '2026-03-31', montant: 78, sub: 'controle-technique' },
		{ date: '2026-05-06', montant: 176.20, sub: 'credit-auto' },
		{ date: '2026-05-06', montant: 58.90, sub: 'assurance-auto' },
		{ date: '2026-05-22', montant: 50, sub: 'carburant' },
		{ date: '2026-06-01', montant: -10, sub: 'carburant' },
		{ date: '2026-06-19', montant: 19.2, sub: 'peages-parkings' },
		{ date: '2025-12-17', montant: 709, sub: 'equipement-auto' },
		{ date: '2026-07-07', montant: 12, sub: null }
	];
	expenses.push({ date: '2024-03-05', montant: 2000, sub: 'credit-auto', key: 'solde' });
	const c = monthlyCost({ ...CAR, linkedTxKeys: ['solde'] }, expenses, '2026-10-03', { countLoss: true });
	const months = (Date.parse('2026-10-03') - Date.parse('2024-03-15')) / 86_400_000 / 30.4375;
	assert.equal(c.mois, Math.round(months * 10) / 10);
	const byItem = Object.fromEntries(c.lignes.map((l) => [l.poste, l.total]));
	assert.deepEqual(byItem, { amortissement: 24900 - vehicleValue(CAR, '2026-10-03').valeur, credit: 176.20, assurance: 58.90, entretien: 490.40, carburant: 40, peages: 19.2, equipement: 709, autres: 12 });
	assert.ok(c.amortissementParDefaut, 'sans estimation : cote par défaut −15 %/an');
	assert.equal(c.total, Math.round(c.lignes.reduce((s, l) => s + l.parMois, 0) * 100) / 100);
	const estimated = monthlyCost({ ...CAR, estimatedValue: 18100, valueDate: '2026-02-28' }, [], '2026-10-03', { countLoss: true });
	assert.equal(estimated.amortissementParDefaut, false);
	const monthsToEstimate = (Date.parse('2026-02-28') - Date.parse('2024-03-15')) / 86_400_000 / 30.4375;
	assert.equal(estimated.lignes[0]!.parMois, Math.round((6800 / monthsToEstimate) * 100) / 100);
});

/**
 * Unknown rate: full monthly payments (the principal is then counted twice and the
 * page says so). Known rate: the principal pays the purchase price, already in the
 * loss of value, so only interest counts. Account outflows (what the budget sees)
 * keep full payments + insurance, purchase excluded. Loss of value = price −
 * valuation, spread until the valuation date. No loan: no loan block.
 */
test('monthly cost: with the interest share of the loan, only the interest counts; account outflows and loss breakdown', () => {
	const expenses: CarExpense[] = [
		{ date: '2024-03-15', montant: 22800, sub: 'achat-vehicule' },
		{ date: '2026-05-06', montant: 200, sub: 'credit-auto' },
		{ date: '2026-06-06', montant: 200, sub: 'credit-auto' },
		{ date: '2026-05-06', montant: 60, sub: 'assurance-auto' }
	];
	const asset: Asset = { ...CAR, estimatedValue: 18100, valueDate: '2026-02-28' };
	const fullPayments = monthlyCost(asset, expenses, '2026-10-03', { countLoss: true });
	const interestOnly = monthlyCost(asset, expenses, '2026-10-03', { partInterets: 0.25, countLoss: true });
	const credit = (c: ReturnType<typeof monthlyCost>) => c.lignes.find((l) => l.poste === 'credit')!;
	assert.equal(credit(fullPayments).total, 400);
	assert.equal(credit(fullPayments).label, 'Crédit (mensualités entières)');
	assert.deepEqual(fullPayments.credit, { mensualites: 400, interets: null });
	assert.equal(credit(interestOnly).total, 100);
	assert.equal(credit(interestOnly).label, 'Intérêts du crédit');
	assert.deepEqual(interestOnly.credit, { mensualites: 400, interets: 100 });
	assert.ok(interestOnly.total < fullPayments.total);
	const months = (Date.parse('2026-10-03') - Date.parse('2024-03-15')) / 86_400_000 / 30.4375;
	assert.equal(interestOnly.sortiesParMois, Math.round((460 / months) * 100) / 100);
	assert.equal(interestOnly.sortiesParMois, fullPayments.sortiesParMois);
	const monthsToValuation = (Date.parse('2026-02-28') - Date.parse('2024-03-15')) / 86_400_000 / 30.4375;
	assert.deepEqual(interestOnly.perte, { prix: 24900, valeur: 18100, mois: Math.round(monthsToValuation * 10) / 10, parMois: Math.round((6800 / monthsToValuation) * 100) / 100 });
	assert.equal(interestOnly.lignes[0]!.label, 'Perte de valeur');
	assert.equal(monthlyCost(asset, expenses.filter((d) => d.sub !== 'credit-auto'), '2026-10-03').credit, null);
});

/**
 * Default cost (Voiture option off): the money spent on the car. No loss-of-value line, loan
 * payments in full even with a known interest share, total = account outflows. The loss is still
 * computed, for the explanation and the switch.
 */
test('monthly cost without the loss of value: money spent, full loan payments', () => {
	const expenses: CarExpense[] = [
		{ date: '2024-03-15', montant: 22800, sub: 'achat-vehicule' },
		{ date: '2026-05-06', montant: 200, sub: 'credit-auto' },
		{ date: '2026-06-06', montant: 200, sub: 'credit-auto' },
		{ date: '2026-05-06', montant: 60, sub: 'assurance-auto' }
	];
	const asset: Asset = { ...CAR, estimatedValue: 18100, valueDate: '2026-02-28' };
	const c = monthlyCost(asset, expenses, '2026-10-03', { partInterets: 0.25 });
	assert.equal(c.countsLoss, false);
	assert.deepEqual(c.lignes.map((l) => [l.poste, l.label, l.total]), [['credit', 'Mensualités du crédit', 400], ['assurance', 'Assurance', 60]]);
	assert.ok(Math.abs(c.total - c.sortiesParMois) <= 0.01, `${c.total} ≈ ${c.sortiesParMois}`);
	assert.deepEqual(c.credit, { mensualites: 400, interets: 100 });
	const monthsToValuation = (Date.parse('2026-02-28') - Date.parse('2024-03-15')) / 86_400_000 / 30.4375;
	assert.equal(c.perte.parMois, Math.round((6800 / monthsToValuation) * 100) / 100);
	const withLoss = monthlyCost(asset, expenses, '2026-10-03', { partInterets: 0.25, countLoss: true });
	assert.equal(withLoss.countsLoss, true);
	assert.deepEqual(withLoss.lignes.map((l) => l.poste), ['amortissement', 'credit', 'assurance']);
});

/**
 * Without a known roadworthiness test: 4 years after first registration; the
 * warranty is dated.
 */
test('next milestones: roadworthiness test 2 years after the last one, 100 000 / 150 000 km at the current pace, warranty to fill in', () => {
	const expenses: CarExpense[] = [{ date: '2026-03-31', montant: 78, sub: 'controle-technique' }];
	const e = nextMilestones(CAR, expenses, '2026-10-03');
	const inspection = e.find((x) => x.id === 'ct')!;
	assert.equal(inspection.date, '2028-03-31');
	assert.equal(inspection.etat, 'plus-tard');
	const p100 = e.find((x) => x.id === 'km-100000')!;
	assert.ok(p100.date && p100.date > '2028-01-01' && p100.date < '2030-01-01', p100.date ?? '');
	assert.equal(e.find((x) => x.id === 'garantie')!.etat, 'a-renseigner');
	assert.deepEqual(e.map((x) => x.id).slice(-1), ['garantie'], 'sans date : en dernier');
	const newCar = nextMilestones({ ...CAR, vehicle: { ...CAR.vehicle!, kmLog: [], warrantyEnd: '2026-12-01' } }, [], '2026-10-03');
	assert.equal(newCar.find((x) => x.id === 'ct')!.date, '2026-03-15');
	assert.equal(newCar.find((x) => x.id === 'ct')!.etat, 'passee');
	assert.equal(newCar.find((x) => x.id === 'garantie')!.etat, 'bientot');
});

test('SIV plate: first registration date estimated from the series (interpolated on the last two letters)', () => {
	assert.deepEqual(plateDate('FN-001-AA'), { estimee: '2020-01-13', debut: '2020-01-13', fin: '2020-02-26' });
	const seriesEnd = plateDate('FN-999-ZZ')!;
	assert.ok(seriesEnd.estimee >= '2020-02-24' && seriesEnd.estimee <= '2020-02-26', seriesEnd.estimee);
	assert.equal(plateDate('GA-500-AA')!.debut, '2021-06-15');
	assert.equal(plateDate('AB-123-CD'), null, 'série de 2009, hors table');
	assert.equal(plateDate('1234 AB 75'), null, 'ancien format');
});

/** Version details: automatic gearbox and power (180 hp → 132 kW ± 6). */
test('valuation links: prefilled searches (model, year, nearby mileage)', () => {
	const l = Object.fromEntries(valuationLinks('Toyota C-HR', 2021, 55000).map((x) => [x.id, x.url]));
	assert.equal(l.largus, 'https://www.largus.fr/cote/voitures-particulieres/toyota/c-hr.html');
	assert.equal(l.autouncle, 'https://www.autouncle.fr/fr/voitures-occasion/Toyota/C-HR/y-2021');
	assert.equal(l.autoscout24, 'https://www.autoscout24.fr/lst/toyota/c-hr?fregfrom=2021&fregto=2021&kmfrom=35000&kmto=75000');
	assert.equal(l.leboncoin, 'https://www.leboncoin.fr/c/voitures/u_car_brand:TOYOTA+u_car_model:TOYOTA_C-HR+regdate:2021-2021+mileage:35000-75000');
	assert.ok(l.histovec?.startsWith('https://histovec.interieur.gouv.fr/'));
	assert.deepEqual(valuationLinks('Bolide', 2020).map((x) => x.id), ['histovec'], 'sans modèle : seul HistoVec');
	assert.equal(valuationLinks('Toyota C-HR', 2022)[2]!.url, 'https://www.autoscout24.fr/lst/toyota/c-hr?fregfrom=2022&fregto=2022', 'sans km : pas de plage');
	const v = Object.fromEntries(valuationLinks('Toyota C-HR', 2021, 55000, '2.0 Hybride 180 ch Design BVA').map((x) => [x.id, x.url]));
	assert.equal(v.autoscout24, 'https://www.autoscout24.fr/lst/toyota/c-hr?fregfrom=2021&fregto=2021&kmfrom=35000&kmto=75000&gear=A&powerfrom=126&powerto=138&powertype=kw');
	assert.equal(v.leboncoin, 'https://www.leboncoin.fr/c/voitures/gearbox:2+u_car_brand:TOYOTA+u_car_model:TOYOTA_C-HR+regdate:2021-2021+mileage:35000-75000');
});

test('price trend (least squares) and paint palette', () => {
	const t = priceTrend([{ km: 40000, prix: 21000 }, { km: 80000, prix: 18000 }])!;
	assert.equal(Math.round(t.pente * 10000), -750, '−75 € par 1 000 km');
	assert.equal(Math.round(t.origine + t.pente * 60000), 19500);
	assert.equal(priceTrend([{ km: 1, prix: 2 }]), null);
	const p = bodyPalette('#c8102e');
	assert.equal(p.length, 4);
	assert.equal(p[1], '#c8102e');
	assert.ok(p.every((c) => /^#[0-9a-f]{6}$/.test(c)));
	assert.equal(bodyPalette('pas une couleur')[1], '#c8102e', 'couleur illisible : rouge par défaut');
});

/**
 * History: 600 € of fuel and 300 € of tolls for 12 000 km (0.05 €/km and
 * 0.025 €/km). Since the reading (200 days): 250 € of fuel, 50 € of tolls. An
 * outlier (another car's tolls: 10 times the pace) is dropped. A reading of the
 * day leaves nothing to estimate; no reading gives null.
 */
test('mileage estimated since the last reading: pace, fuel and tolls calibrated on the history', () => {
	const b: Asset = { ...CAR, vehicle: { kmAtPurchase: 64000, kmLog: [{ date: '2025-03-15', km: 76000, source: 'facture' }] } };
	b.purchaseDate = '2024-03-15';
	const pts = kmPoints(b);
	const expenses: CarExpense[] = [
		{ date: '2024-06-01', montant: 300, sub: 'carburant' },
		{ date: '2024-12-01', montant: 300, sub: 'carburant' },
		{ date: '2024-09-01', montant: 300, sub: 'peages-parkings' },
		{ date: '2025-06-15', montant: 250, sub: 'carburant' },
		{ date: '2025-08-10', montant: 50, sub: 'peages-parkings' }
	];
	const e = estimateKm(pts, expenses, '2025-10-01')!;
	assert.equal(e.depuis.km, 76000);
	assert.equal(e.jours, 200);
	const bySource = Object.fromEntries(e.composantes.map((c) => [c.source, c.km]));
	assert.equal(bySource.carburant, 5000, '250 € ÷ 0,05 €/km');
	assert.equal(bySource.peages, 2000, '50 € ÷ 0,025 €/km');
	assert.equal(bySource.rythme, Math.round((12000 / 365) * 200));
	assert.equal(e.km, Math.round(76000 + bySource.rythme! * 0.5 + 5000 * 0.35 + 2000 * 0.15));
	assert.deepEqual([e.min, e.max], [78000, 76000 + Math.max(5000, bySource.rythme!)]);
	const outlier = estimateKm(pts, [...expenses, { date: '2025-09-01', montant: 900, sub: 'peages-parkings' }], '2025-10-01')!;
	assert.deepEqual(outlier.composantes.map((c) => c.source), ['rythme', 'carburant']);
	assert.equal(estimateKm(pts, expenses, '2025-03-15')!.km, 76000);
	assert.equal(estimateKm([], expenses, '2025-10-01'), null);
});
