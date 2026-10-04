import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLayoutRequest, createRequestTracker, blockHints, readLayoutAnswer, safeText, validateAiTree, type AiBlockMeta, firstJsonObject, parseLenientJson } from '../src/lib/aiLayout';
import { leafIds, type TileNode } from '../src/lib/tiles';

const TREE: TileNode = {
	dir: 'col',
	ratio: 0.3,
	a: { dir: 'row', ratio: 0.5, a: { id: 'kpis' }, b: { id: 'alertes' } },
	b: { dir: 'row', ratio: 0.65, a: { id: 'balance' }, b: { id: 'donut' } }
};
const VISIBLE = ['kpis', 'alertes', 'balance', 'donut'];

const META: Record<string, AiBlockMeta> = {
	kpis: { title: 'Indicateurs', elements: [{ id: 'solde', label: 'Solde actuel' }, { id: 'budget', label: 'Budget consommé' }] },
	alertes: { title: 'Alertes impôt (2)', elements: [] },
	balance: { title: 'Évolution du solde', elements: [{ id: 'projection', label: 'Projection fin de mois' }] },
	donut: { title: 'Dépenses du mois', elements: [{ id: 'legende', label: 'Liste des catégories' }] },
	notes: { title: 'Bloc-notes', elements: [] }
};

/** Every string value of a payload, keys included. */
function allStrings(v: unknown): string[] {
	if (typeof v === 'string') return [v];
	if (Array.isArray(v)) return v.flatMap(allStrings);
	if (v && typeof v === 'object') return Object.entries(v).flatMap(([k, x]) => [k, ...allStrings(x)]);
	return [];
}

test('validation: a complete tree passes, ratios clamped between 0.1 and 0.9', () => {
	const extremes: TileNode = { dir: 'row', ratio: 0.99, a: { dir: 'col', ratio: -3, a: { id: 'kpis' }, b: { id: 'alertes' } }, b: { dir: 'col', ratio: 0.5, a: { id: 'balance' }, b: { id: 'donut' } } };
	const r = validateAiTree(extremes, VISIBLE);
	assert.ok('arbre' in r);
	const tree = r.arbre as { ratio: number; a: { ratio: number } };
	assert.equal(tree.ratio, 0.9);
	assert.equal(tree.a.ratio, 0.1);
	assert.deepEqual(leafIds(r.arbre), ['kpis', 'alertes', 'balance', 'donut']);
	assert.ok('arbre' in validateAiTree(TREE, VISIBLE));
});

test('validation: unknown block, duplicate, missing block, invalid direction or ratio → readable refusal', () => {
	const titles = { donut: 'Dépenses du mois' };
	const unknownBlock = validateAiTree({ dir: 'row', ratio: 0.5, a: TREE, b: { id: 'pirate' } }, VISIBLE);
	assert.ok('erreur' in unknownBlock && /inconnu/.test(unknownBlock.erreur));
	const duplicate = validateAiTree({ dir: 'row', ratio: 0.5, a: TREE, b: { id: 'kpis' } }, VISIBLE);
	assert.ok('erreur' in duplicate && /deux fois/.test(duplicate.erreur));
	const missing = validateAiTree({ dir: 'row', ratio: 0.5, a: { id: 'kpis' }, b: { dir: 'col', ratio: 0.5, a: { id: 'alertes' }, b: { id: 'balance' } } }, VISIBLE, titles);
	assert.ok('erreur' in missing && missing.erreur.includes('« Dépenses du mois »'));
	const direction = validateAiTree({ dir: 'diagonal', ratio: 0.5, a: { id: 'kpis' }, b: { id: 'donut' } }, ['kpis', 'donut']);
	assert.ok('erreur' in direction && /direction/.test(direction.erreur));
	const ratio = validateAiTree({ dir: 'row', ratio: 'moitié', a: { id: 'kpis' }, b: { id: 'donut' } }, ['kpis', 'donut']);
	assert.ok('erreur' in ratio && /proportion/.test(ratio.erreur));
	assert.ok('erreur' in validateAiTree(null, VISIBLE));
	assert.ok('erreur' in validateAiTree([{ id: 'kpis' }], VISIBLE));
	let deep: unknown = { id: 'kpis' };
	for (let i = 0; i < 60; i++) deep = { dir: 'row', ratio: 0.5, a: deep, b: { id: 'donut' } };
	assert.ok('erreur' in validateAiTree(deep, ['kpis', 'donut']));
});

test('request: layout metadata only, no amount or number in the texts', () => {
	const trap: Record<string, AiBlockMeta> = {
		...META,
		kpis: { title: 'Solde 12 470,52 € au compte 00012345678', elements: [{ id: 'x', label: 'Reste 1 250,00 EUR' }] }
	};
	const screen = { tree: TREE, size: { w: 1100, h: 820 }, visible: VISIBLE, stored: ['notes'] };
	const sizes = new Map([
		['kpis', { w: 544, h: 240 }],
		['donut', { w: 380, h: 560 }]
	]);
	const d = buildLayoutRequest('dashboard', screen, trap, { balance: 412.6 }, sizes, '  mets les dépenses en avant, pas les 2 300 € de loyer  ');
	assert.deepEqual(Object.keys(d).sort(), ['arbre', 'blocs', 'canevas', 'consigne', 'etroit', 'page', 'ranges']);
	for (const b of d.blocs) for (const k of Object.keys(b)) assert.ok(['id', 'titre', 'elements', 'indices', 'taille', 'hauteurNaturelle'].includes(k), k);
	assert.deepEqual(d.ranges, [{ id: 'notes', titre: 'Bloc-notes' }]);
	assert.equal(d.blocs.find((b) => b.id === 'balance')?.hauteurNaturelle, 413);
	assert.deepEqual(d.blocs.find((b) => b.id === 'kpis')?.taille, { w: 544, h: 240 });
	assert.equal(d.blocs.find((b) => b.id === 'alertes')?.titre, 'Alertes impôt (2)');
	for (const s of allStrings(d)) {
		assert.ok(!/€|\bEUR\b/i.test(s), `montant envoyé : ${s}`);
		assert.ok(!/\d{4,}/.test(s), `numéro envoyé : ${s}`);
		assert.ok(!/\d[\d\s.,]{3,}\d/.test(s), `nombre long envoyé : ${s}`);
	}
	assert.equal(d.consigne, 'mets les dépenses en avant, pas les … de loyer');
});

test('request: narrow screen → nominal canvas, no tile sizes; empty instruction left out', () => {
	const d = buildLayoutRequest('budget', { tree: null, size: { w: 0, h: 0 }, visible: ['a', 'b'], stored: [] }, {}, {}, new Map([['a', { w: 0, h: 0 }]]), '   ');
	assert.equal(d.etroit, true);
	assert.ok(d.canevas.w > 0 && d.canevas.h > 0);
	assert.equal('consigne' in d, false);
	assert.ok(d.blocs.every((b) => !('taille' in b)));
	assert.deepEqual(d.blocs.map((b) => b.titre), ['a', 'b']);
});

test('hints and texts: chart, table, alert, little content; amounts removed', () => {
	assert.deepEqual(blockHints('Évolution du solde', ['Projection fin de mois']), ['graphique']);
	assert.ok(blockHints('Positions', ['Colonne Quantité']).includes('tableau'));
	assert.ok(blockHints('Alertes impôt', []).includes('alerte'));
	assert.ok(blockHints('Objectif', [], 100).includes('peu de contenu'));
	assert.equal(safeText('Payé 1 234,56 € le 3'), 'Payé … le 3');
	assert.equal(safeText('Carte 4970 1234 5678 9012'), 'Carte …');
});

test('answer: relay object, plain text or ```json block; unreadable → refused', () => {
	const obj = readLayoutAnswer({ arbre: TREE, explication: 'Graphiques en grand, 1 250,00 € de loyer mis en avant' });
	assert.ok(!('erreur' in obj));
	assert.equal(obj.explication, 'Graphiques en grand, … de loyer mis en avant');
	const fence = readLayoutAnswer('```json\n{"arbre": {"id": "kpis"}, "explication": "ok"}\n```');
	assert.ok(!('erreur' in fence) && (fence.arbre as { id: string }).id === 'kpis');
	const text = readLayoutAnswer('Voici : {"arbre": {"id": "a"}}');
	assert.ok(!('erreur' in text) && text.explication === '');
	assert.ok('erreur' in readLayoutAnswer('pas de JSON'));
	assert.ok('erreur' in readLayoutAnswer({ explication: 'sans arbre' }));
});

test('numbers of 4 digits or more never leave the app, years included; small counts stay', () => {
	assert.equal(safeText('Objectif 2500'), 'Objectif …');
	assert.equal(safeText('Plafond 1500'), 'Plafond …');
	assert.equal(safeText('Plafond 1 500'), 'Plafond …');
	assert.equal(safeText('Octobre 2026'), 'Octobre …');
	assert.equal(safeText('Alertes (2)'), 'Alertes (2)');
	assert.equal(safeText('Top 10 des postes'), 'Top 10 des postes');
	assert.equal(safeText('Écart 999'), 'Écart 999');
});

test('requests: only the latest ticket is current; a cancel or a newer request makes the older one stale', () => {
	const tracker = createRequestTracker();
	const first = tracker.demarrer();
	assert.equal(tracker.estCourant(first), true);
	tracker.annuler();
	assert.equal(tracker.estCourant(first), false, 'dialog closed: the late answer is dropped');
	const second = tracker.demarrer();
	const third = tracker.demarrer();
	assert.equal(tracker.estCourant(second), false, 'sent again: the first answer never applies');
	assert.equal(tracker.estCourant(third), true);
});

test('AI answer reading survives text around the JSON, a second object and trailing commas', () => {
	const tree = '{"arbre":{"dir":"row","ratio":0.5,"a":{"id":"a"},"b":{"id":"b"}},"explication":"Deux colonnes {égales}"}';
	assert.equal(firstJsonObject(`Voici : ${tree} Et aussi {"autre":1}`), tree);
	assert.equal(firstJsonObject('```json\n' + tree + '\n```'), tree);
	assert.equal(firstJsonObject('{"a":"}"'), null);
	assert.deepEqual(parseLenientJson('{"a":[1,2,],}'), { a: [1, 2] });
	assert.equal(parseLenientJson('{nope'), null);
	const read = readLayoutAnswer('```json\n' + tree.replace('}},', '},},') + '\n```\nCette disposition {met en avant} le solde.');
	assert.ok(!('erreur' in read), 'readable despite the trailing comma and the sentence after the fence');
});
