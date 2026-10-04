import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PdfLine } from '../src/lib/pdfNatixis';
import type { Asset } from '../src/lib/assets';
import type { Transaction } from '../src/lib/types';
import { applyVehicleDocument, readVehicleDocument, vehicleOfDocument, type VehicleDocument } from '../src/lib/pdfVehicle';
import { valuationIsStale, valuationFromSearch, purchasePayments } from '../src/lib/vehicle';

/** Vehicle documents (purchase order, workshop invoice) and automations (purchase payments, valuation search). */

const line = (y: number, ...items: [number, string][]): PdfLine => ({ y, items: items.map(([x, str]) => ({ x, str })), text: items.map(([, s]) => s).join(' ').replace(/\s+/g, ' ').trim() });

// Used-car purchase order (a dealer's layout: label, value)
const PURCHASE_ORDER: PdfLine[][] = [[
	line(682, [304, 'Bon de commande véhicule d´occasion N° 42']),
	line(658, [349, 'Date de validation'], [418, '05/03/2023 10:12'], [486, '| Imprimé le'], [535, '05/03/2023']),
	line(556, [45, '> Description du véhicule *']),
	line(536, [111, 'PEUGEOT - 2008 2021 2008 1.2 PureTech 130 S&S EAT8']),
	line(526, [111, 'Allure']),
	line(490, [111, 'Essence sans plomb'], [312, 'CV | Ch DIN | CO2'], [384, '7 | 130 | 128 g/km (WLTP)']),
	line(468, [39, 'Kilométrage'], [111, '31250 - Km non garanti'], [312, 'Immatriculation'], [384, 'AB-123-CD (Aucune)']),
	line(298, [41, 'Total de la commande'], [476, '18 990,00'], [532, '€ TTC'])
]];
// Workshop invoice (table: headers on two lines, values aligned below)
const WORKSHOP_INVOICE: PdfLine[][] = [[
	line(684, [98, 'FACTURE ATELIER']),
	line(652, [12, 'Date'], [98, '12/09/2025']),
	line(608, [12, 'Date de réception'], [124, '08/09/2025']),
	line(572, [406, 'Date 1ère'], [462, 'Date de fin de'], [532, 'Km']),
	line(570, [30, 'Marque'], [130, 'Modèle'], [214, 'Immatriculation'], [330, 'VIN']),
	line(562, [412, 'immat.'], [475, 'garantie']),
	line(556, [87, '2008 1.2 PureTech']),
	line(550, [34, 'PEUGEOT'], [130, '130 S&S EAT8 Allure'], [225, 'AB-123-CD'], [288, 'VF3XXXXXXXXXXXXXX'], [406, '18/06/2021'], [472, '18/06/2023'], [528, '58410']),
	line(484, [12, 'A'], [114, 'ENTRETIEN ANNUEL'])
]];

test('purchase order: used-car purchase, total price, km at delivery, plate, CV, version (trim on the next line)', () => {
	assert.deepEqual(readVehicleDocument(PURCHASE_ORDER), {
		type: 'achat',
		date: '2023-03-05',
		marque: 'Peugeot',
		modele: '2008',
		annee: 2021,
		version: '1.2 PureTech 130 S&S EAT8 Allure',
		plaque: 'AB-123-CD',
		km: 31250,
		kmDate: '2023-03-05',
		prix: 18990,
		cv: 7,
		occasion: true
	});
});

test('workshop invoice: odometer on the drop-off day, first registration and warranty end read from the columns', () => {
	const d = readVehicleDocument(WORKSHOP_INVOICE) as VehicleDocument;
	assert.equal(d.type, 'atelier');
	assert.equal(d.date, '2025-09-12');
	assert.deepEqual([d.marque, d.modele, d.version], ['Peugeot', '2008', '1.2 PureTech 130 S&S EAT8 Allure']);
	assert.deepEqual([d.plaque, d.premiereImmat, d.finGarantie, d.km, d.kmDate], ['AB-123-CD', '2021-06-18', '2023-06-18', 58410, '2025-09-08']);
	assert.match(String((readVehicleDocument([[line(700, [10, 'Relevé de compte'])]]) as { error: string }).error), /aucune information/);
});

test('applied document: creates the vehicle from the purchase, then the invoice completes the same car (plate) without overwriting', () => {
	const purchase = readVehicleDocument(PURCHASE_ORDER) as VehicleDocument;
	const { saisi: input, changements: changes } = applyVehicleDocument(undefined, purchase);
	assert.equal(input.name, 'Peugeot 2008');
	assert.deepEqual([input.purchasePrice, input.purchaseDate, input.vehicle?.kmAtPurchase, input.vehicle?.boughtUsed, input.vehicle?.plate], [18990, '2023-03-05', 31250, true, 'AB-123-CD']);
	assert.equal(input.vehicle?.version, '1.2 PureTech 130 S&S EAT8 Allure · 7 CV');
	assert.ok(changes[0]!.startsWith('nouveau véhicule'));
	const car: Asset = { id: 'v', ...input, vehicle: { ...input.vehicle!, version: 'ma version' } };
	const invoice = readVehicleDocument(WORKSHOP_INVOICE) as VehicleDocument;
	assert.equal(vehicleOfDocument([car], invoice)?.id, 'v', 'même plaque');
	const followUp = applyVehicleDocument(car, invoice);
	assert.equal(followUp.saisi.vehicle?.version, 'ma version', 'version saisie gardée');
	assert.deepEqual(followUp.saisi.vehicle?.kmLog, [{ date: '2025-09-08', km: 58410, source: 'facture' }]);
	assert.deepEqual([followUp.saisi.vehicle?.firstRegistration, followUp.saisi.vehicle?.warrantyEnd, followUp.saisi.purchasePrice], ['2021-06-18', '2023-06-18', 18990]);
	assert.equal(applyVehicleDocument({ ...car, vehicle: followUp.saisi.vehicle }, invoice).changements.length, 0, 'réimporté : rien de nouveau');
	assert.equal(vehicleOfDocument([car], { ...invoice, plaque: 'ZZ-999-ZZ', marque: 'Renault', modele: 'Clio' }), undefined, 'autre voiture');
});

const tx = (date: string, amount: number, label: string): Transaction => ({
	transaction_amount: { amount: Math.abs(amount).toFixed(2), currency: 'EUR' },
	booking_date: date,
	value_date: date,
	remittance_information: [label],
	credit_debit_indicator: amount < 0 ? 'DBIT' : 'CRDT'
});

test('purchase payments: deposit + balance ≈ price, within the purchase window; transactions already linked excluded', () => {
	const b = { id: 'v', type: 'vehicule', name: 'Peugeot 2008', purchaseDate: '2023-03-05', purchasePrice: 18990, linkedTxKeys: [], vehicle: { kmLog: [] } } as Asset;
	const txs = [tx('2023-02-20', -2000, 'VIR ACOMPTE GARAGE'), tx('2023-03-04', -16990, 'VIR SOLDE GARAGE'), tx('2023-03-04', -60, 'COURSES'), tx('2022-10-01', -18990, 'TROP TOT'), tx('2023-03-06', 18990, 'CREDIT')];
	const key = (t: Transaction) => t.remittance_information[0]!;
	assert.deepEqual(purchasePayments(b, txs, key).sort(), ['VIR ACOMPTE GARAGE', 'VIR SOLDE GARAGE']);
	assert.deepEqual(purchasePayments(b, txs, key, new Set(['VIR SOLDE GARAGE'])), [], 'solde déjà pris : plus de combinaison au prix');
	assert.deepEqual(purchasePayments({ ...b, purchasePrice: 0 }, txs, key), []);
});

test('valuation searched by the AI: validated (trade-in ≤ private sale ≤ dealer, complete ads), stale after 30 days', () => {
	const c = valuationFromSearch({ pro: 19200, particulier: 17100.4, reprise: 15000, annonces: [{ libelle: 'Hybride 180 BVA', annee: 2020, km: 98000, prix: 18990, source: 'AutoScout24', url: 'https://www.autoscout24.fr/x' }, { libelle: 'sans prix', km: 1 }, { libelle: 'lien douteux', km: 90000, prix: 18000, url: 'http://exemple' }] }, '2026-10-03')!;
	assert.deepEqual({ ...c, annonces: c.annonces.map((a) => [a.libelle, a.url ?? null]) }, { date: '2026-10-03', particulier: 17100, pro: 19200, reprise: 15000, auto: true, annonces: [['Hybride 180 BVA', 'https://www.autoscout24.fr/x'], ['lien douteux', null]] });
	assert.equal(valuationFromSearch({ pro: 10000, particulier: 17000 }, '2026-10-03'), null, 'pro sous le prix particulier : incohérent');
	assert.equal(valuationFromSearch('n’importe quoi', '2026-10-03'), null);
	assert.equal(valuationIsStale(undefined, '2026-10-03'), true);
	assert.equal(valuationIsStale(c, '2026-10-20'), false);
	assert.equal(valuationIsStale(c, '2026-11-02'), true);
});
