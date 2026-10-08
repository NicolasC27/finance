import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyPortage, lastTarget, portageTaxProvisions, settlementText, taxAlerts, yearAlert, type Payslip, type PortageData, type PortageYears, type PortageYearTax } from '../src/lib/portage';

/** Invented payslips: one month of 2025, two of 2026, all withheld at 7,5 %. */
const slip = (mois: string, base: number, taux: number): Payslip => ({ mois, rembFrais: 0, netPaye: base, pas: { base, taux, montant: Math.round(base * taux) / 100 } });
const payslips: Payslip[] = [slip('2025-12', 4000, 7.5), slip('2026-06', 4000, 7.5), slip('2026-07', 4200, 7.5)];
const data: PortageData = { ...emptyPortage(), paies: payslips };
const est = (patch: Partial<PortageYearTax> = {}): PortageYearTax => ({
	year: 2026,
	tax: 3000,
	withheldSoFar: 1500,
	withheldToCome: 900,
	balance: 600,
	instalments: 4,
	rateToAvoid: 12.3,
	portageRate: 9,
	income: { before: 10000, benefits: 6000, portage: 8200, projected: 21000, partner: 0, other: 0 },
	projectedMonths: 5,
	otherTax: 0,
	household: { couple: false, children: 0 },
	stoppedAt: null,
	exactRules: true,
	...patch
});
const years = (...list: PortageYearTax[]): PortageYears => new Map(list.map((y) => [y.year, y]));
const rows = (d: PortageData, y?: PortageYears) => portageTaxProvisions(d, y).map((p) => [p.mois, p.tauxVise, p.montant]);

test('target: typed by hand, else the average of the month’s year when estimated, else the neutral rate of the last salary', () => {
	assert.deepEqual(lastTarget(data), { rate: 13.8, source: 'neutre' });
	assert.deepEqual(lastTarget(data, years(est())), { rate: 9, source: 'annee' });
	assert.deepEqual(lastTarget(data, years(est({ year: 2025 }))), { rate: 13.8, source: 'neutre' }, 'the estimate of another year does not apply');
	assert.deepEqual(lastTarget(data, years(est({ portageRate: null }))), { rate: 13.8, source: 'neutre' });
	assert.deepEqual(lastTarget({ ...data, impot: { taux: 10 } }, years(est())), { rate: 10, source: 'manuel' });
});

test('provisions of an estimated year: a running total, each year its own rate', () => {
	assert.deepEqual(rows(data, years(est())), [
		['2025-12', 13.8, 252],
		['2026-06', 9, 60],
		['2026-07', 9, 63]
	]);
	assert.deepEqual(rows(data, years(est(), est({ year: 2025, portageRate: 8 })))[0], ['2025-12', 8, 20], 'the previous year keeps its own estimate');
	assert.deepEqual(rows({ ...data, impot: { taux: 10 } }, years(est())).map((r) => r[2]), [100, 100, 105], 'a rate typed by hand wins');
	assert.deepEqual(portageTaxProvisions({ ...data, impot: { provision: false } }, years(est())), []);
	assert.deepEqual(rows(data).map((r) => r[1]), [13.8, 13.8, 13.8], 'without an estimate, as before');
});

test('provisions: a month withheld above the year’s rate gives back what was set aside, never below zero', () => {
	const raised = { ...data, paies: [...payslips.slice(1), slip('2026-08', 4000, 19), slip('2026-09', 4000, 19)] };
	assert.deepEqual(rows(raised, years(est())), [
		['2026-06', 9, 60],
		['2026-07', 9, 63],
		['2026-08', 9, -123]
	]);
	assert.equal(
		portageTaxProvisions(raised, years(est())).reduce((s, p) => s + p.montant, 0),
		0,
		'the tax is not counted twice'
	);
	assert.deepEqual(rows(data, years(est({ portageRate: 5 }))).slice(1), [], 'a refunded year sets nothing aside');
	assert.deepEqual(rows(data, years(est({ portageRate: 7.52 }))).slice(1), [['2026-07', 7.52, 1.64]], 'cents wait for the next month');
});

test('alert: the year’s estimate replaces the neutral rate and takes the rate change in', () => {
	const provisions = portageTaxProvisions(data, years(est()));
	const alerts = taxAlerts(payslips, { provisions, years: years(est()), aujourdhui: '2026-10-08' });
	assert.deepEqual(
		alerts.map((a) => a.niveau),
		['info', 'alerte'],
		'the reminder of the 2025 provision, then the year’s alert'
	);
	const toPay = alerts[1]!;
	assert.equal(toPay.titre, 'Prélèvement trop bas pour ton année 2026 : ≈ 600 € à payer de septembre à décembre 2027');
	for (const part of ['salaire avant le portage', 'chômage', 'dont 5 mois projetés', 'foyer célibataire, sans enfant', 'passe ton taux à ≈ 12,3 %', 'Ton budget a déjà mis de côté 123 €']) assert.ok(toPay.detail.includes(part), `${part} · ${toPay.detail}`);
	const lowered = [payslips[1]!, slip('2026-07', 4200, 6.1)];
	const withChange = taxAlerts(lowered, { years: years(est()) });
	assert.equal(withChange.length, 1, 'no separate « taux en baisse »');
	assert.ok(withChange[0]!.detail.startsWith('Ton taux est passé de 7,5 % à 6,1 % en juillet 2026.'), withChange[0]!.detail);
	assert.equal(taxAlerts(payslips, { years: years(est({ instalments: 1, balance: 280 })) })[0]!.titre, 'Prélèvement trop bas pour ton année 2026 : ≈ 280 € à payer en septembre 2027');
	const refund = taxAlerts(payslips, { years: years(est({ balance: -400, rateToAvoid: 4.2 })) })[0]!;
	assert.deepEqual([refund.niveau, refund.titre], ['info', 'Prélèvement trop haut pour ton année 2026 : ≈ 400 € remboursés à l’été 2027'.replace('’', "'")]);
	assert.ok(refund.detail.includes('Un taux de ≈ 4,2 % suffirait'));
	const matching = taxAlerts(payslips, { years: years(est({ balance: 80 })) })[0]!;
	assert.deepEqual([matching.niveau, matching.titre], ['info', 'Ton taux colle à ton année 2026 : écart ≈ 80 €']);
	const otherYear = taxAlerts(lowered, { years: years(est({ year: 2025 })) });
	assert.deepEqual(
		otherYear.map((a) => a.titre),
		['Taux de prélèvement en baisse : 7,5 % → 6,1 %', 'Taux de prélèvement bas pour ton salaire actuel : 6,1 %'],
		'an estimate of another year: the alerts of before'
	);
});

test('yearAlert: finished or stopped year, no rate needed, approximate scale, other income', () => {
	const done = yearAlert(est({ withheldToCome: 0, rateToAvoid: null, projectedMonths: 0, income: { ...est().income, projected: 0 }, stoppedAt: '2026-06', exactRules: false, otherTax: 240 }), 7.5, 0);
	for (const part of ["Prélevé sur l'année", 'Pas de fiche de paie après juin 2026', "pas encore dans l'app", 'Dont ≈ 240 € sur tes autres revenus']) assert.ok(done.detail.includes(part), `${part} · ${done.detail}`);
	assert.ok(!done.detail.includes('passe ton taux') && !done.detail.includes('projeté'));
	assert.ok(yearAlert(est({ rateToAvoid: 0 }), 7.5, 0).detail.includes('Plus aucun prélèvement ne serait nécessaire'));
	assert.ok(yearAlert(est({ household: { couple: true, children: 2 }, income: { ...est().income, partner: 30000 } }), 7.5, 0).detail.includes('les revenus du foyer'));
	assert.equal(settlementText({ year: 2026, balance: -10, instalments: 0 }), "à l'été 2027");
});
