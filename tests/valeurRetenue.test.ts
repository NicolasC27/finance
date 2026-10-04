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
	vehicleValue
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

test('no retained value: theoretical estimate at −15 %/year, never « à confirmer »', () => {
	const r = retainedValue(CAR, '2026-03-01');
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
	assert.equal(vehicleValue(CAR, '2026-03-01', 0.1).valeur, Math.round(20000 * 0.9 ** years));
	assert.equal(retainedValue(CAR, '2026-03-01', { depreciation: 0.1 }).valeur, Math.round(20000 * 0.9 ** years));
	const b: Asset = { ...CAR, estimatedValue: 15000, valueDate: '2026-06-01', valueSource: 'reprise', valueConfirmed: true };
	assert.equal(retainedValue(b, '2026-08-20').aRevalider, false);
	assert.equal(retainedValue(b, '2026-08-20', { revalidateMonths: 2 }).aRevalider, true);
});

/** Stored options are checked and bounded; anything invalid falls back to the defaults. */
test('car options: sanitised and bounded', () => {
	assert.deepEqual(sanitizeCarOptions(null), DEFAULT_CAR_OPTIONS);
	assert.deepEqual(sanitizeCarOptions({ confirmValue: 'yes', depreciation: 'x', revalidateMonths: null }), DEFAULT_CAR_OPTIONS);
	assert.deepEqual(sanitizeCarOptions({ confirmValue: true, depreciation: 2, revalidateMonths: 0 }), { confirmValue: true, depreciation: 0.6, revalidateMonths: 1, countValueLoss: false });
	assert.deepEqual(sanitizeCarOptions({ depreciation: 0.12, revalidateMonths: 7.6 }), { confirmValue: false, depreciation: 0.12, revalidateMonths: 8, countValueLoss: false });
	assert.equal(DEFAULT_CAR_OPTIONS.countValueLoss, false);
	assert.equal(sanitizeCarOptions({ countValueLoss: true }).countValueLoss, true);
	assert.equal(sanitizeCarOptions({ countValueLoss: 'yes' }).countValueLoss, false);
});
