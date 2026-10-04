import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assetTotals, validateAsset, assetValue, type Asset } from '../src/lib/assets';

/** Assets (src/lib/assets.ts): validated entry, vehicles and odometer readings, totals separate from the financial net worth. */

const asset = (b: Partial<Asset>): Asset => ({ id: 'x', type: 'autre', name: 'Bien', purchaseDate: '2024-01-01', purchasePrice: 0, linkedTxKeys: [], ...b });

test('input: cleaned and bounded; decimal comma accepted; readable refusals', () => {
	assert.deepEqual(validateAsset({ name: '  Ampli   Atoll ', type: 'hifi', purchaseDate: '2024-12-03', purchasePrice: '2300,5', estimatedValue: '', linkedTxKeys: ['a', 'a', 3], note: '  ' }), {
		type: 'hifi',
		name: 'Ampli Atoll',
		purchaseDate: '2024-12-03',
		purchasePrice: 2300.5,
		linkedTxKeys: ['a']
	});
	assert.match(String(validateAsset({ name: 'x', type: 'hifi', purchaseDate: '2024-02-30', purchasePrice: 1 })), /date/);
	assert.match(String(validateAsset({ name: 'x', type: 'auto', purchaseDate: '2024-02-03', purchasePrice: 1 })), /type de bien/);
	assert.match(String(validateAsset({ name: 'x', type: 'hifi', purchaseDate: '2024-02-03', purchasePrice: 1, linkedTxKeys: ['k9'] }, { txKeys: new Set(['k1']) })), /introuvable/);
	assert.match(String(validateAsset({ name: 'x', type: 'hifi', purchaseDate: '2024-02-03', purchasePrice: 1e9 })), /prix/);
	assert.match(String(validateAsset({ name: 'x', type: 'hifi', purchaseDate: '2024-02-03', purchasePrice: 1, vehicle: { kmAtPurchase: 10 } })), /réservés au type « vehicule »/);
});

test('legacy format (category) read back as type; estimate date', () => {
	const v = validateAsset({ name: 'Piano', category: 'instrument', purchaseDate: '2025-09-18', purchasePrice: 11000, estimatedValue: 9500, valueDate: '2026-10-01' });
	assert.equal(typeof v === 'object' && v.type, 'instrument');
	assert.equal(typeof v === 'object' && v.valueDate, '2026-10-01');
	assert.ok(typeof v === 'object' && !('category' in v));
});

/** A vehicle without fields has no readings; an invalid reading is refused. */
test('vehicle: first registration, odometer at purchase, readings sorted and deduplicated', () => {
	const v = validateAsset({
		name: 'Toyota C-HR',
		type: 'vehicule',
		purchaseDate: '2024-03-15',
		purchasePrice: 24900,
		vehicle: {
			firstRegistration: '2022-03-15',
			kmAtPurchase: '21 500 km',
			kmLog: [
				{ date: '2026-03-31', km: 61200, source: 'ct' },
				{ date: '2025-04-03', km: 42000, source: 'facture' },
				{ date: '2025-04-03', km: 42000, source: 'saisie' }
			]
		}
	});
	assert.ok(typeof v === 'object');
	assert.deepEqual(v.vehicle, {
		kmLog: [
			{ date: '2025-04-03', km: 42000, source: 'facture' },
			{ date: '2026-03-31', km: 61200, source: 'ct' }
		],
		firstRegistration: '2022-03-15',
		kmAtPurchase: 21500
	});
	assert.deepEqual((validateAsset({ name: 'Vélo cargo', type: 'vehicule', purchaseDate: '2024-01-01', purchasePrice: 3000 }) as Asset).vehicle, { kmLog: [] });
	assert.match(String(validateAsset({ name: 'x', type: 'vehicule', purchaseDate: '2024-01-01', purchasePrice: 1, vehicle: { kmLog: [{ date: '2024-13-01', km: 5 }] } })), /date du relevé/);
	assert.match(String(validateAsset({ name: 'x', type: 'vehicule', purchaseDate: '2024-01-01', purchasePrice: 1, vehicle: { kmLog: [{ date: '2024-02-01', km: 5, source: 'garage' }] } })), /source/);
});

test('totals: paid, estimated (purchase price used when there is no estimate), count without an estimate', () => {
	const assets = [
		asset({ name: 'Piano', type: 'instrument', purchasePrice: 11000, estimatedValue: 9500 }),
		asset({ name: 'Enceintes', type: 'hifi', purchasePrice: 2946 }),
		asset({ name: 'Ampli', type: 'hifi', purchasePrice: 2300 })
	];
	assert.equal(assetValue(assets[0]!), 9500);
	assert.equal(assetValue(assets[1]!), 2946);
	assert.deepEqual(assetTotals(assets), { paye: 16246, estime: 14746, sansEstimation: 2 });
	assert.deepEqual(assetTotals([]), { paye: 0, estime: 0, sansEstimation: 0 });
});

test('vehicle: normalised plate, bought used, colour, photo, detailed valuation; readable refusals', () => {
	const base = { name: 'Toyota C-HR', type: 'vehicule', purchaseDate: '2024-03-15', purchasePrice: 24900 };
	const v = validateAsset({
		...base,
		vehicle: {
			plate: ' ab 123 cd ',
			version: '  2.0 Hybride   180 ch Design BVA ',
			boughtUsed: true,
			color: '#C8102E',
			photo: 'data:image/webp;base64,AAAA',
			cote: { date: '2026-10-03', reprise: '15 500'.replace(' ', ''), particulier: 17500, pro: 19500, kmHypothese: '55 000', annonces: [{ libelle: ' 2.0 122 Style ', annee: 2020, km: 60811, prix: 19499, source: 'L’argus', url: 'https://occasion.largus.fr/auto/x' }, { libelle: 'sans lien', km: 82018, prix: 18990, url: 'javascript:alert(1)' }] }
		}
	}) as Asset;
	assert.equal(v.vehicle?.plate, 'AB-123-CD');
	assert.equal(v.vehicle?.version, '2.0 Hybride 180 ch Design BVA');
	assert.equal(v.vehicle?.boughtUsed, true);
	assert.equal(v.vehicle?.color, '#c8102e');
	assert.equal(v.vehicle?.cote?.kmHypothese, 55000);
	assert.deepEqual(v.vehicle?.cote?.annonces.map((a) => [a.libelle, a.url ?? null]), [['2.0 122 Style', 'https://occasion.largus.fr/auto/x'], ['sans lien', null]], 'lien non https retiré');
	assert.match(String(validateAsset({ ...base, vehicle: { plate: '??' } })), /plaque/);
	assert.match(String(validateAsset({ ...base, vehicle: { color: 'rouge' } })), /couleur/);
	assert.match(String(validateAsset({ ...base, vehicle: { photo: 'https://exemple.fr/x.jpg' } })), /photo/);
	assert.match(String(validateAsset({ ...base, vehicle: { cote: { date: '2026-13-01' } } })), /date de la cote/);
	assert.match(String(validateAsset({ ...base, vehicle: { boughtUsed: 'oui' } })), /boughtUsed/);
});
