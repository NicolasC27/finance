import { test } from 'node:test';
import assert from 'node:assert/strict';
import { valueSourceOf, validateAsset, validateValuation, valueNeedsConfirmation, type Asset, type VehicleValuation } from '../src/lib/assets';
import {
	ANNUAL_DEPRECIATION,
	DEFAULT_CAR_OPTIONS,
	sanitizeCarOptions,
	patchConfirmValue,
	patchIgnoreProposal,
	patchRetainValue,
	patchAcceptProposal,
	pendingProposal,
	retainedValue,
	vehicleValue,
	residualByAge,
	kmFactor,
	marketLevel,
	marketValue,
	firstRegistrationOf,
	USED_CAR_MARKET
} from '../src/lib/vehicle';

const CAR: Asset = {
	id: 'v1',
	type: 'vehicule',
	name: 'Citadine fictive',
	purchaseDate: '2024-03-01',
	purchasePrice: 20000,
	linkedTxKeys: [],
	vehicle: { kmLog: [] }
};

const aiValuation = (privateSale: number, extra: Partial<VehicleValuation> = {}): VehicleValuation => ({ date: '2026-10-01', particulier: privateSale, auto: true, annonces: [{ libelle: 'Annonce fictive', km: 50000, prix: privateSale }], ...extra });

test('no retained value: theoretical estimate at the flat rate (flat model), never « à confirmer »', () => {
	const r = retainedValue(CAR, '2026-03-01', { model: 'flat' });
	const years = (Date.parse('2026-03-01') - Date.parse('2024-03-01')) / 86_400_000 / 365.25;
	assert.equal(r.theorique, true);
	assert.equal(r.valeur, Math.round(20000 * (1 - ANNUAL_DEPRECIATION) ** years));
	assert.equal(r.source, null);
	assert.equal(r.confirmee, true);
	assert.equal(r.aRevalider, false);
});

/** Other assets were always typed by hand: they are never « à confirmer ». */
test('legacy value (no source): retained but to be confirmed; AI source if it comes from the AI valuation, otherwise typed', () => {
	const fromAi: Asset = { ...CAR, estimatedValue: 15000, valueDate: '2026-09-01', vehicle: { kmLog: [], cote: aiValuation(15000) } };
	const typed: Asset = { ...CAR, estimatedValue: 14000, valueDate: '2026-09-01' };
	assert.equal(valueSourceOf(fromAi), 'ia');
	assert.equal(valueSourceOf(typed), 'saisie');
	assert.equal(valueSourceOf(CAR), null);
	assert.equal(valueNeedsConfirmation(fromAi), true);
	const r = retainedValue(fromAi, '2026-10-04');
	assert.deepEqual({ valeur: r.valeur, theorique: r.theorique, source: r.source, confirmee: r.confirmee }, { valeur: 15000, theorique: false, source: 'ia', confirmee: false });
	assert.equal(valueNeedsConfirmation({ ...typed, type: 'instrument', vehicle: undefined }), false);
});

test('to be revalidated after 6 months', () => {
	const b: Asset = { ...CAR, estimatedValue: 15000, valueDate: '2026-03-01', valueSource: 'reprise', valueConfirmed: true };
	assert.equal(retainedValue(b, '2026-08-20').aRevalider, false);
	assert.equal(retainedValue(b, '2026-09-15').aRevalider, true);
	assert.equal(retainedValue(b, '2026-09-15').confirmee, true);
});

/** A typed valuation (not auto) or an already decided proposal is not pending either. */
test('an AI proposal never changes the retained value until it is accepted', () => {
	const b: Asset = { ...CAR, estimatedValue: 19000, valueDate: '2026-09-01', valueSource: 'reprise', valueConfirmed: true, vehicle: { kmLog: [], cote: aiValuation(18400) } };
	assert.equal(vehicleValue(b, '2026-10-04').valeur, 19000);
	assert.equal(pendingProposal(b)?.particulier, 18400);
	assert.equal(pendingProposal({ ...b, vehicle: { kmLog: [], cote: { ...aiValuation(18400), auto: undefined } } }), null);
	assert.equal(pendingProposal({ ...b, vehicle: { kmLog: [], cote: aiValuation(18400, { decision: 'ignoree' }) } }), null);
});

test('Valider: the proposal becomes the confirmed retained value (AI source, dated today); Ignorer: nothing changes', () => {
	const b: Asset = { ...CAR, estimatedValue: 19000, valueDate: '2026-09-01', valueSource: 'reprise', valueConfirmed: true, vehicle: { kmLog: [], cote: aiValuation(18400) } };
	const accepted = patchAcceptProposal(b, '2026-10-04')!;
	assert.equal(accepted.estimatedValue, 18400);
	assert.equal(accepted.valueDate, '2026-10-04');
	assert.equal(accepted.valueSource, 'ia');
	assert.equal(accepted.valueConfirmed, true);
	assert.equal(accepted.vehicle?.cote?.decision, 'validee');
	const ignored = patchIgnoreProposal(b)!;
	assert.equal(ignored.estimatedValue, undefined);
	assert.equal(ignored.vehicle?.cote?.decision, 'ignoree');
	assert.equal(ignored.vehicle?.cote?.annonces.length, 1);
	assert.equal(patchAcceptProposal({ ...b, vehicle: { kmLog: [] } }, '2026-10-04'), null);
});

test('Retenir a typed value and Confirmer the current value', () => {
	assert.deepEqual(patchRetainValue(18499.999, 'argus', '2026-10-04'), { estimatedValue: 18500, valueDate: '2026-10-04', valueSource: 'argus', valueConfirmed: true });
	const oldValue: Asset = { ...CAR, estimatedValue: 15000, valueDate: '2026-09-01', vehicle: { kmLog: [], cote: aiValuation(15000) } };
	assert.deepEqual(patchConfirmValue(oldValue), { valueSource: 'ia', valueConfirmed: true });
	assert.equal(patchConfirmValue(CAR), null);
});

test('stored data validation: source and status kept, unknown source refused, valuation decision kept', () => {
	const ok = validateAsset({ ...CAR, estimatedValue: 18000, valueDate: '2026-10-01', valueSource: 'lacentrale', valueConfirmed: true });
	assert.ok(typeof ok !== 'string');
	assert.equal(ok.valueSource, 'lacentrale');
	assert.equal(ok.valueConfirmed, true);
	assert.match(String(validateAsset({ ...CAR, estimatedValue: 18000, valueSource: 'devin' })), /source de la valeur inconnue/);
	const noValue = validateAsset({ ...CAR, valueSource: 'argus', valueConfirmed: true });
	assert.ok(typeof noValue !== 'string');
	assert.equal(noValue.valueSource, undefined);
	assert.equal(noValue.valueConfirmed, undefined);
	const valuation = validateValuation({ ...aiValuation(18400), decision: 'validee' });
	assert.ok(typeof valuation !== 'string');
	assert.equal(valuation.decision, 'validee');
	assert.equal((validateValuation({ ...aiValuation(18400), decision: 'peut-être' }) as VehicleValuation).decision, undefined);
});

/** Voiture option off (the default): no « à confirmer » anywhere, the retained value simply counts. */
test('confirmation off: no value to confirm, status not tracked', () => {
	const aiValued: Asset = { ...CAR, estimatedValue: 15000, valueDate: '2026-09-01', vehicle: { kmLog: [], cote: aiValuation(15000) } };
	assert.equal(valueNeedsConfirmation(aiValued, false), false);
	assert.equal(valueNeedsConfirmation(aiValued), true);
	const r = retainedValue(aiValued, '2026-10-04', { confirmation: false });
	assert.deepEqual({ valeur: r.valeur, confirmee: r.confirmee, tracked: r.tracked }, { valeur: 15000, confirmee: true, tracked: false });
	assert.equal(retainedValue(aiValued, '2026-10-04').tracked, true);
	assert.equal(DEFAULT_CAR_OPTIONS.confirmValue, false);
});

/** Theoretical depreciation and reminder delay follow the Voiture options. */
test('theoretical depreciation and revalidation reminder follow the options', () => {
	const years = (Date.parse('2026-03-01') - Date.parse('2024-03-01')) / 86_400_000 / 365.25;
	assert.equal(vehicleValue(CAR, '2026-03-01', 0.1, 'flat').valeur, Math.round(20000 * 0.9 ** years));
	assert.equal(retainedValue(CAR, '2026-03-01', { depreciation: 0.1, model: 'flat' }).valeur, Math.round(20000 * 0.9 ** years));
	const b: Asset = { ...CAR, estimatedValue: 15000, valueDate: '2026-06-01', valueSource: 'reprise', valueConfirmed: true };
	assert.equal(retainedValue(b, '2026-08-20').aRevalider, false);
	assert.equal(retainedValue(b, '2026-08-20', { revalidateMonths: 2 }).aRevalider, true);
});

/** Stored options are checked and bounded; anything invalid falls back to the defaults. */
test('car options: sanitised and bounded', () => {
	assert.deepEqual(sanitizeCarOptions(null), DEFAULT_CAR_OPTIONS);
	assert.deepEqual(sanitizeCarOptions({ confirmValue: 'yes', depreciation: 'x', revalidateMonths: null }), DEFAULT_CAR_OPTIONS);
	assert.deepEqual(sanitizeCarOptions({ confirmValue: true, depreciation: 2, revalidateMonths: 0 }), { confirmValue: true, depreciation: 0.6, depreciationModel: 'market', marketEffect: false, revalidateMonths: 1, countValueLoss: false });
	assert.deepEqual(sanitizeCarOptions({ depreciation: 0.12, revalidateMonths: 7.6 }), { confirmValue: false, depreciation: 0.12, depreciationModel: 'market', marketEffect: false, revalidateMonths: 8, countValueLoss: false });
	assert.equal(DEFAULT_CAR_OPTIONS.countValueLoss, false);
	assert.equal(sanitizeCarOptions({ countValueLoss: true }).countValueLoss, true);
	assert.equal(sanitizeCarOptions({ countValueLoss: 'yes' }).countValueLoss, false);
});

test('market model: age, mileage and used-car market relative to the price paid', () => {
	assert.equal(residualByAge(0), 1);
	assert.equal(residualByAge(1), 0.8);
	assert.ok(Math.abs(residualByAge(1.5) - 0.74) < 1e-9);
	assert.ok(Math.abs(residualByAge(5) / residualByAge(4) - 0.9) < 0.001, '≈ −10 %/an après 3 ans');
	assert.ok(residualByAge(8) < residualByAge(6));
	assert.equal(kmFactor(30000, 2, 15000), 1, 'kilométrage habituel : neutre');
	assert.equal(kmFactor(40000, 2, 15000), 0.95, '+10 000 km : −5 %');
	assert.equal(kmFactor(500000, 2, 15000), 0.6, 'borné');
	assert.equal(marketLevel('2025-12-31'), USED_CAR_MARKET[2025]);
	assert.equal(marketLevel('2030-06-01'), USED_CAR_MARKET[2025], 'au-delà de la table : dernier niveau');
	const used: Asset = { ...CAR, purchaseDate: '2024-03-01', purchasePrice: 18000, vehicle: { firstRegistration: '2020-03-01', boughtUsed: true, kmAtPurchase: 60000, kmLog: [{ date: '2025-03-01', km: 75000, source: 'saisie' }] } };
	const v = marketValue(used, '2026-03-01')!;
	const expected = 18000 * (residualByAge(6) / residualByAge(4));
	assert.ok(Math.abs(v - expected) <= 5, `${v} ≈ ${expected} (15 000 km/an : effet kilométrage quasi neutre)`);
	const heavy: Asset = { ...used, vehicle: { ...used.vehicle!, kmLog: [{ date: '2025-03-01', km: 95000, source: 'saisie' }] } };
	assert.ok(marketValue(heavy, '2026-03-01')! < v, 'gros rouleur : valeur plus basse');
	const noDate: Asset = { ...used, vehicle: { ...used.vehicle!, firstRegistration: undefined } };
	assert.deepEqual(firstRegistrationOf(noDate), { date: '2020-03-01', source: 'kilométrage' }, '60 000 km à 15 000 km/an : 4 ans avant l’achat');
	assert.deepEqual(firstRegistrationOf({ ...noDate, name: 'SUV 2019' }), { date: '2019-07-01', source: 'année du modèle' });
	assert.deepEqual(firstRegistrationOf({ ...CAR }), { date: CAR.purchaseDate, source: 'achat neuf' });
	assert.equal(firstRegistrationOf({ ...noDate, vehicle: { ...noDate.vehicle!, plate: 'FA-123-AB' } }).source, 'plaque', 'plaque SIV : date de la série');
	assert.ok(marketValue(noDate, '2026-03-01')! > 0, 'sans carte grise : âge déduit, jamais le taux fixe');
	assert.equal(vehicleValue(used, '2026-03-01').valeur, v, 'modèle par défaut : âge + km');
	const withMarket = marketValue(used, '2026-03-01', true)!;
	assert.ok(Math.abs(withMarket - v * (marketLevel('2026-03-01') / marketLevel('2024-03-01'))) <= 2, 'option marché');
});

test('patchClearValue: back to the computed value', async () => {
	const { patchClearValue } = await import('../src/lib/vehicle');
	const kept: Asset = { ...CAR, estimatedValue: 9000, valueDate: '2026-09-01', valueSource: 'saisie', valueConfirmed: true };
	const cleared = { ...kept, ...patchClearValue() } as Asset;
	assert.equal(vehicleValue(kept, '2026-10-01').parDefaut, false);
	assert.equal(vehicleValue(cleared, '2026-10-01').parDefaut, true);
	assert.equal(JSON.parse(JSON.stringify(cleared)).estimatedValue, undefined, 'champ absent une fois enregistré');
});
