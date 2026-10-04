import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CategoryId, Transaction } from '../src/lib/types';
import { categorize } from '../src/lib/categories';
import { subcategorize } from '../src/lib/subcategories';
import { monthTotals } from '../src/lib/totals';
import { buildMonthlyReport } from '../src/lib/report';
import { buildSankeyFlows, layoutSankey, relaxLabels, sankeySummary, type SankeyNode } from '../src/lib/sankey';

/** « Where the money goes » Sankey of the Report (entirely fictitious data). */

const tx = (label: string, date: string, amount: number, extra: Partial<Transaction> = {}): Transaction => ({
	transaction_amount: { amount: Math.abs(amount).toFixed(2), currency: 'EUR' },
	booking_date: date,
	value_date: date,
	remittance_information: [label],
	credit_debit_indicator: amount >= 0 ? 'CRDT' : 'DBIT',
	...extra
});
const catOf = (t: Transaction): CategoryId => categorize(t, {}, [], new Map());
const subOf = (t: Transaction): string | null => subcategorize(t, {}, [], new Map());
const cents = (v: number) => Math.round(v * 100);
const sum = (nodes: SankeyNode[]) => nodes.reduce((s, n) => s + cents(n.value), 0);
const ids = (nodes: SankeyNode[]) => nodes.map((n) => n.id);

const september: Transaction[] = [
	tx('VIR SEPA ACME CONSEIL SALAIRE SEPTEMBRE', '2026-09-28', 3200),
	tx('VIR CAF PRESTATIONS FAMILIALES', '2026-09-05', 180),
	tx('VIR M DUPONT REMBOURSEMENT DINER', '2026-09-12', 25),
	tx('PRLV SEPA LOYER FONCIA', '2026-09-03', -820),
	tx('PAIEMENT CB 0309 PARIS CARREFOUR CITY', '2026-09-04', -84.3),
	tx('PAIEMENT CB 1009 PARIS BOULANGERIE DU COIN', '2026-09-11', -4.2),
	tx('PRLV SEPA EDF CLIENTS PARTICULIERS', '2026-09-08', -71),
	tx('PAIEMENT CB 0509 NANTES SNCF', '2026-09-07', -46),
	tx('PAIEMENT CB 0609 PARIS PHARMACIE CENTRALE', '2026-09-08', -18.4),
	tx('PRLV SEPA NETFLIX', '2026-09-15', -13.49),
	tx('PAIEMENT CB 0809 TOTALENERGIES STATION', '2026-09-09', -62),
	// Outside the flows: transfer to a savings account, pending transaction, another month
	tx('VIREMENT VERS LIVRET A', '2026-09-29', -500),
	tx('PAIEMENT CB EN COURS', '', -40),
	tx('PRLV SEPA LOYER FONCIA', '2026-08-03', -820)
];

/** The savings account, the pending transaction and August are absent. */
test('buildSankeyFlows: flows are conserved and match the Report KPIs', () => {
	const flows = buildSankeyFlows(september, '2026-09', catOf, subOf);
	assert.ok(flows);
	assert.equal(sum(flows.left), sum(flows.right), 'Σ gauche = Σ droite');
	assert.equal(sum(flows.left), cents(flows.total), 'le nœud central porte le total');

	const t = monthTotals(september, '2026-09', catOf);
	const report = buildMonthlyReport(september, {}, {}, '2026-09', new Map(), '2026-10-15');
	assert.ok(report);
	assert.equal(flows.income, report.current.income);
	assert.equal(flows.expenses, report.current.expenses);
	assert.equal(flows.net, report.current.net);
	const savings = flows.right.find((n) => n.kind === 'savings');
	assert.ok(savings, 'mois excédentaire : épargne nette à droite');
	assert.equal(savings.value, t.net, 'épargne nette du Sankey = KPI Épargne nette');
	assert.equal(sum(flows.left.filter((n) => n.kind === 'source')), cents(t.income), 'sources = Entrées');
	assert.equal(sum(flows.right.filter((n) => n.kind === 'category' || n.kind === 'others')), cents(t.expenses), 'postes = Sorties');
	assert.ok(!flows.left.some((n) => n.kind === 'draw'));
	assert.ok(!ids(flows.right).includes('cat:epargne'));
	assert.equal(flows.right.find((n) => n.id === 'cat:logement')?.value, 820);
});

/**
 * Salary and Remboursements come from subcategories, the CAF from the merchant.
 * Spending items are sorted by decreasing amount with the category colour; the
 * detail lists the item's subcategories, largest first.
 */
test('buildSankeyFlows: sources by subcategory or merchant, spending items sorted and detailed', () => {
	const flows = buildSankeyFlows(september, '2026-09', catOf, subOf)!;
	assert.deepEqual(ids(flows.left), ['src:sub:salaire', 'src:m:CAF PRESTATIONS FAMILIALES', 'src:sub:remboursements']);
	assert.equal(flows.left[0]!.label, 'Salaire');
	assert.equal(flows.left[0]!.subId, 'salaire');
	assert.equal(flows.left[0]!.categoryId, 'revenus');
	const items = flows.right.filter((n) => n.kind === 'category');
	assert.deepEqual(
		items.map((n) => n.value),
		[...items.map((n) => n.value)].sort((a, b) => b - a)
	);
	assert.equal(items[0]!.id, 'cat:logement');
	assert.match(items[0]!.color, /^#[0-9a-f]{6}$/);
	const food = flows.right.find((n) => n.id === 'cat:alimentation')!;
	assert.deepEqual(food.details, [
		{ label: 'Courses', value: 84.3 },
		{ label: 'Petits commerçants', value: 4.2 }
	]);
	assert.equal(food.count, 2);
});

/** Node cap: at most 3 spending nodes, grouping included. */
test('buildSankeyFlows: items under 2 % of outflows grouped into « Autres postes »', () => {
	const flows = buildSankeyFlows(september, '2026-09', catOf, subOf)!;
	const others = flows.right.find((n) => n.id === 'cat:autres');
	assert.ok(others, 'Santé (18,40 €) et Abonnements (13,49 €) < 2 % de 1 119,39 €');
	assert.equal(others.value, 31.89);
	assert.deepEqual(others.details.map((d) => d.label), ['Santé', 'Abonnements']);
	assert.equal(others.categoryId, undefined, 'regroupement non cliquable');
	assert.ok(!ids(flows.right).includes('cat:sante'));
	const capped = buildSankeyFlows(september, '2026-09', catOf, subOf, { maxCategories: 3 })!;
	const items = capped.right.filter((n) => n.kind === 'category' || n.kind === 'others');
	assert.equal(items.length, 3);
	assert.equal(items[2]!.id, 'cat:autres');
	assert.equal(sum(capped.left), sum(capped.right));
});

test('buildSankeyFlows: at most 5 sources, the rest in « Autres revenus »', () => {
	const many = [
		tx('VIR SEPA ACME CONSEIL SALAIRE SEPTEMBRE', '2026-09-28', 2000),
		tx('VIR LOCATAIRE STUDIO LYON', '2026-09-02', 500),
		tx('VIR CAF PRESTATIONS FAMILIALES', '2026-09-05', 300),
		tx('VIR PRIME PARTAGE VALEUR', '2026-09-06', 250),
		tx('VIR ASSOCIATION CHORALE DEFRAIEMENT', '2026-09-09', 200),
		tx('VIR VENTE VELO LEBONCOIN', '2026-09-10', 150),
		tx('VIR CADEAU TANTE ODILE', '2026-09-11', 100),
		tx('PRLV SEPA LOYER FONCIA', '2026-09-03', -820)
	];
	const flows = buildSankeyFlows(many, '2026-09', catOf, subOf)!;
	const sources = flows.left.filter((n) => n.kind === 'source');
	assert.equal(sources.length, 5);
	const bucket = sources[4]!;
	assert.equal(bucket.id, 'src:autres');
	assert.equal(bucket.label, 'Autres revenus');
	assert.equal(bucket.value, 450, 'les trois plus petites sources');
	assert.equal(bucket.details.length, 3);
	assert.equal(sum(sources), cents(monthTotals(many, '2026-09', catOf).income));
});

test('buildSankeyFlows: deficit month → « Puisé dans l’épargne » on the left', () => {
	const deficit = [
		tx('VIR SEPA ACME CONSEIL SALAIRE SEPTEMBRE', '2026-09-28', 900),
		tx('PRLV SEPA LOYER FONCIA', '2026-09-03', -820),
		tx('PAIEMENT CB 0309 PARIS CARREFOUR CITY', '2026-09-04', -230.5)
	];
	const flows = buildSankeyFlows(deficit, '2026-09', catOf, subOf)!;
	const draw = flows.left.find((n) => n.kind === 'draw');
	assert.ok(draw);
	assert.equal(draw.id, flows.left[flows.left.length - 1]!.id, 'en bas de la colonne');
	assert.equal(draw.value, 150.5);
	assert.equal(draw.value, -monthTotals(deficit, '2026-09', catOf).net);
	assert.ok(!flows.right.some((n) => n.kind === 'savings'));
	assert.equal(sum(flows.left), sum(flows.right));
	assert.equal(flows.total, 1050.5);
	assert.match(sankeySummary(flows, 'septembre 2026'), /150,50\s€ puisés dans l'épargne/);
});

/**
 * Cheque paid in in August, reversed in September: negative income this month.
 * Santé: refunded (30 €) more than spent (12 €).
 */
test('buildSankeyFlows: net refund and cancelled income (negative flows) can still be drawn', () => {
	const odd = [
		tx('VIR SEPA ACME CONSEIL SALAIRE SEPTEMBRE', '2026-09-28', 2000),
		tx('REM CHQ REF77 E0000000001 ANNULATION', '2026-09-02', -250),
		tx('VIR CPAM REMBOURSEMENT SOINS', '2026-09-14', 30),
		tx('PAIEMENT CB 0609 PARIS PHARMACIE CENTRALE', '2026-09-08', -12),
		tx('PRLV SEPA LOYER FONCIA', '2026-09-03', -820)
	];
	const flows = buildSankeyFlows(odd, '2026-09', catOf, subOf)!;
	const refund = flows.left.find((n) => n.id === 'remb:sante');
	assert.ok(refund);
	assert.equal(refund.value, 18);
	assert.equal(refund.label, 'Santé (remboursé)');
	const reversal = flows.right.find((n) => n.id === 'deduit');
	assert.ok(reversal);
	assert.equal(reversal.label, 'Déduit des revenus');
	assert.equal(reversal.value, 250);
	assert.ok(flows.left.every((n) => n.value > 0) && flows.right.every((n) => n.value > 0), 'aucun flux négatif');
	assert.equal(sum(flows.left), sum(flows.right));
	const t = monthTotals(odd, '2026-09', catOf);
	assert.equal(flows.right.find((n) => n.kind === 'savings')?.value, t.net, 'épargne nette toujours égale au KPI');
});

/**
 * Expenses refunded in the salary: Salaire subcategory, the net amount is shown and explained.
 */
test('buildSankeyFlows: Portage tab entries named by their written label', () => {
	const portage = (label: string, amount: number, category: CategoryId): Transaction =>
		tx(label, '2026-09-30', amount, { source: 'portage', account: 'portage', virtual_category: category });
	const txs = [
		tx('VIR SEPA ACME CONSEIL SALAIRE SEPTEMBRE', '2026-09-28', 2600),
		portage('Titres-restaurant Swile · septembre', 160, 'revenus'),
		portage('Chèques culture · Crédit de rentrée', 200, 'revenus'),
		portage('Frais avancés remboursés dans le salaire (note de frais août)', -90, 'revenus'),
		tx('PRLV SEPA LOYER FONCIA', '2026-09-03', -820)
	];
	const catOfVirtual = (t: Transaction): CategoryId => t.virtual_category ?? catOf(t);
	const flows = buildSankeyFlows(txs, '2026-09', catOfVirtual, subOf)!;
	const labels = flows.left.map((n) => n.label);
	assert.ok(labels.includes('Titres-restaurant Swile'), labels.join(' | '));
	assert.ok(labels.includes('Chèques culture'), labels.join(' | '));
	const salary = flows.left.find((n) => n.id === 'src:sub:salaire')!;
	assert.equal(salary.value, 2510);
	assert.deepEqual(salary.details, [
		{ label: 'Acme Conseil Salaire Septembre', value: 2600 },
		{ label: 'Frais avancés remboursés dans le salaire', value: -90 }
	]);
	assert.ok(!flows.right.some((n) => n.id === 'deduit'));
	assert.equal(sum(flows.left), sum(flows.right));
	assert.equal(flows.right.find((n) => n.kind === 'savings')?.value, monthTotals(txs, '2026-09', catOfVirtual).net);
});

test('buildSankeyFlows: empty month or no budget flow → null', () => {
	assert.equal(buildSankeyFlows(september, '2026-07', catOf, subOf), null);
	assert.equal(buildSankeyFlows([tx('VIREMENT VERS LIVRET A', '2026-09-29', -500)], '2026-09', catOf, subOf), null);
	assert.equal(buildSankeyFlows([], '2026-09', catOf, subOf), null);
});

/** Too many labels for the height: even distribution. */
test('relaxLabels: pushes overlapping labels apart, within the bounds', () => {
	assert.deepEqual(relaxLabels([10, 12, 14], 10, 0, 100), [10, 20, 30]);
	assert.deepEqual(relaxLabels([95, 96, 97], 10, 0, 100), [80, 90, 100]);
	assert.deepEqual(relaxLabels([5, 50], 10, 8, 100), [8, 50]);
	assert.deepEqual(relaxLabels([1, 1, 1], 30, 0, 40), [0, 20, 40]);
	assert.deepEqual(relaxLabels([], 10, 0, 100), []);
});

/**
 * The central node receives each stack of links. Labels of a column are spaced by
 * at least one label height, and each label stays in front of its node (small
 * nodes spread out, no offset label). Narrow screen: name and amount on two
 * lines, long names truncated.
 */
test('layoutSankey: links as thick as their nodes, readable labels, everything inside the frame', () => {
	const flows = buildSankeyFlows(september, '2026-09', catOf, subOf)!;
	for (const width of [680, 300]) {
		const layout = layoutSankey(flows, { width });
		assert.equal(layout.compact, width < 520);
		assert.ok(layout.height >= 260 && layout.height <= 340, `hauteur ${layout.height}`);
		assert.equal(layout.links.length, flows.left.length + flows.right.length, 'un lien par nœud latéral');
		for (const n of layout.nodes) {
			const link = layout.links.find((l) => l.id === n.id)!;
			assert.equal(link.width, n.h);
			assert.ok(link.d.startsWith('M') && link.d.includes(' C') && link.d.endsWith('Z'), 'ruban fermé');
			assert.ok(n.x >= 0 && n.x + n.w <= layout.width, `${n.id} dans la largeur`);
			assert.ok(n.y >= 0 && n.y + n.h <= layout.height, `${n.id} dans la hauteur`);
		}
		const sumL = layout.nodes.filter((n) => n.node?.side === 'left').reduce((s, n) => s + n.h, 0);
		const sumR = layout.nodes.filter((n) => n.node?.side === 'right').reduce((s, n) => s + n.h, 0);
		assert.ok(Math.abs(layout.center.h - Math.max(sumL, sumR)) < 1e-6);
		const spacing = layout.compact ? 26 : 15;
		for (const side of ['left', 'right'] as const) {
			const ys = layout.nodes.filter((n) => n.node?.side === side).map((n) => n.label.y);
			for (let i = 1; i < ys.length; i++) assert.ok(ys[i]! - ys[i - 1]! >= spacing - 1e-6, `${side} : ${ys.join(', ')}`);
		}
		assert.equal(layout.center.label.name, 'Entrées');
		for (const n of layout.nodes) assert.ok(Math.abs(n.label.y - (n.y + n.h / 2)) < 0.5, `${n.id} : étiquette ${n.label.y} / nœud ${n.y + n.h / 2}`);
	}
	const narrow = layoutSankey(flows, { width: 300 });
	const caf = narrow.nodes.find((n) => n.id === 'src:m:CAF PRESTATIONS FAMILIALES')!;
	assert.equal(caf.label.twoLines, true);
	assert.ok(caf.label.name.endsWith('…'), caf.label.name);
	assert.ok(caf.label.name.length < 'Caf Prestations Familiales'.length);
});
