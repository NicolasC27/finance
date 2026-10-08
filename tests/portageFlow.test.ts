import { test } from 'node:test';
import assert from 'node:assert/strict';
import { invoiceFlow, roundPercents } from '../src/lib/portageFlow';
import type { ActivityMonth, Payslip } from '../src/lib/portage';

/** Figures as the parser stores them: the statement's deductions keep their minus sign. */
const activity: ActivityMonth = { mois: '2026-09', jours: 21, ca: 10920, fraisGestion: -655.2, reserve: -436.8, brut: 5390, netApresImpot: 3878.35, impot: 317.65, reserveDisponible: 120 };
const payslip: Payslip = { mois: '2026-09', brut: 5390, rembFrais: 62.4, pas: { base: 4235.4, taux: 7.5, montant: 317.65 }, netPaye: 3878.35, datePaiement: '2026-09-28' };
const sum = (f: { segments: { amount: number }[] }) => Math.round(f.segments.reduce((s, x) => s + x.amount, 0) * 100) / 100;
const by = (f: { segments: { id: string; amount: number }[] }) => Object.fromEntries(f.segments.map((s) => [s.id, s.amount]));

test('invoiceFlow: the parts add up to the revenue whatever the sign of the statement rows, employer charges being the rest', () => {
	const flow = invoiceFlow(activity, payslip)!;
	assert.equal(flow.total, 10920);
	assert.deepEqual(
		flow.segments.map((s) => s.id),
		['gestion', 'reserve', 'patronales', 'cotisations', 'impot', 'frais', 'net']
	);
	const parts = by(flow);
	assert.equal(parts.gestion, 655.2);
	assert.equal(parts.net, 3815.95);
	assert.equal(parts.cotisations, 1256.4);
	assert.equal(parts.patronales, 4375.6);
	assert.equal(sum(flow), 10920);
	assert.equal(flow.gap, 0);
	assert.equal(Math.round(flow.netShare * 1000) / 1000, 0.349);
	assert.equal(
		flow.segments.reduce((s, x) => s + x.percent, 0),
		100
	);
	assert.deepEqual(invoiceFlow({ ...activity, fraisGestion: 655.2, reserve: 436.8 }, payslip)!.segments, flow.segments);
});

test('invoiceFlow: meal-voucher share, known contributions, activity charges and provision are their own parts', () => {
	const withheld: Payslip = { ...payslip, titresRestaurant: { nombre: 20, partSalariale: 110, partPatronale: 110 }, netPaye: 3768.35 };
	const flow = invoiceFlow(activity, withheld)!;
	const parts = by(flow);
	assert.equal(parts.titres, 110);
	assert.equal(parts.cotisations, 1256.4);
	assert.equal(parts.net, 3705.95);
	assert.equal(sum(flow), 10920);
	const known = invoiceFlow({ ...activity, chargesSalariales: -1200, chargesPatronales: -3900, chargesActivite: -180, provision: -150, cheques: -100 }, payslip)!;
	const k = by(known);
	assert.equal(k.cotisations, 1200);
	assert.equal(k.patronales, 3900);
	assert.equal(k.activite, 180);
	assert.equal(k.provision, 150);
	assert.equal(k.cheques, 100);
	assert.equal(k.autres, 102);
	assert.equal(by(invoiceFlow({ ...activity, chargesPatronales: -9000 }, payslip)!).patronales, 4375.6, 'a figure above the rest is capped');
	assert.equal(sum(known), 10920);
});

test('invoiceFlow: the statement alone works, no revenue gives null, inconsistent documents show a gap but shares of the revenue', () => {
	const alone = invoiceFlow(activity, undefined)!;
	assert.equal(by(alone).net, 3878.35);
	assert.equal(alone.segments.some((s) => s.id === 'frais'), false);
	assert.equal(invoiceFlow(undefined, payslip), null);
	assert.equal(invoiceFlow({ mois: '2026-09' }, payslip), null);
	const off = invoiceFlow({ mois: '2026-09', ca: 1000, fraisGestion: -60, brut: 1200 }, { mois: '2026-09', rembFrais: 0, netPaye: 900 })!;
	assert.equal(Math.round(off.netShare * 100), 90);
	assert.equal(off.gap, 260);
	assert.ok(off.segments.every((s) => s.amount > 0));
	assert.equal(
		off.segments.reduce((s, x) => s + x.percent, 0),
		126
	);
});

test('roundPercents: whole numbers that add up, the largest remainders rounded up first', () => {
	assert.deepEqual(roundPercents([655.2, 436.8, 4375.6, 1256.4, 317.65, 62.4, 3815.95]), [6, 4, 40, 11, 3, 1, 35]);
	assert.deepEqual(roundPercents([1, 1, 1]), [34, 33, 33]);
	assert.deepEqual(roundPercents([0, 0]), [0, 0]);
	assert.deepEqual(roundPercents([3, 1], 50), [38, 12]);
});
