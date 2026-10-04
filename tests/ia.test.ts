import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CategoryId } from '../src/lib/types';
import { parseActions, validateAction, describeAction, actionKeys, applyAction, type ActionEffects } from '../src/lib/aiActions';
import type { AssetInput } from '../src/lib/assets';
import { mdToHtml } from '../src/lib/aiMarkdown';
import { HEIC_MESSAGE, receiptQuestion, receiptRefusal } from '../src/lib/aiReceipt';

const ctx = {
	categoryIds: new Set(['alimentation', 'loisirs', 'vacances', 'autre']),
	txKeys: new Set(['k1', 'k2', 'k3']),
	vehicleIds: new Set(['v1'])
};
const label = (id: CategoryId) => ({ alimentation: 'Alimentation', loisirs: 'Loisirs' })[id as 'alimentation'] ?? id;

test('valid actions: typed, rounded, keyword normalised', () => {
	const { actions, rejected } = parseActions(
		[
			{ type: 'set_budget', categoryId: 'loisirs', amount: 300.456, why: 'moyenne 6 mois' },
			{ type: 'recategorize', keys: ['k1', 'k2', 'k1'], categoryId: 'alimentation' },
			{ type: 'add_rule', keyword: '  uber   eats ', categoryId: 'alimentation' },
			{ type: 'exclude', keys: ['k3'] },
			{ type: 'set_note', key: 'k2', note: ' remboursé ' },
			{ type: 'add_goal', name: 'Apport', targetAmount: 30000.4, targetDate: '2028-06-30' }
		],
		ctx
	);
	assert.equal(rejected.length, 0);
	assert.deepEqual(actions[0], { type: 'set_budget', categoryId: 'loisirs', amount: 300.46, why: 'moyenne 6 mois' });
	assert.deepEqual(actions[1], { type: 'recategorize', keys: ['k1', 'k2'], categoryId: 'alimentation' });
	assert.deepEqual(actions[2], { type: 'add_rule', keyword: 'UBER EATS', categoryId: 'alimentation' });
	assert.deepEqual(actions[4], { type: 'set_note', key: 'k2', note: 'remboursé' });
	assert.deepEqual(actions[5], { type: 'add_goal', name: 'Apport', targetAmount: 30000, targetDate: '2028-06-30' });
});

test('invalid actions: rejected with a reason, never applied on a best-effort basis', () => {
	const bad = [
		{ type: 'delete_everything' },
		{ type: 'set_budget', categoryId: 'inexistante', amount: 10 },
		{ type: 'set_budget', categoryId: 'loisirs', amount: -5 },
		{ type: 'set_budget', categoryId: 'loisirs', amount: 'beaucoup' },
		{ type: 'recategorize', keys: ['k1', 'inconnue'], categoryId: 'loisirs' },
		{ type: 'recategorize', keys: [], categoryId: 'loisirs' },
		{ type: 'add_rule', keyword: 'ab', categoryId: 'loisirs' },
		{ type: 'add_rule', keyword: 'AIRBNB', categoryId: 'vacances' },
		{ type: 'set_note', key: 'k9', note: 'x' },
		{ type: 'add_goal', name: 'X', targetAmount: 100, targetDate: '30/06/2028' },
		'pas un objet',
		null
	];
	const { actions, rejected } = parseActions(bad, ctx);
	assert.equal(actions.length, 0);
	assert.equal(rejected.length, bad.length);
	assert.match(rejected[0]!.reason, /inconnu/);
	assert.match(rejected[4]!.reason, /introuvable/);
	assert.match(rejected[7]!.reason, /Vacances/);
});

test('{ actions: [...] } format accepted; other formats reported; missing = nothing', () => {
	assert.equal(parseActions({ actions: [{ type: 'exclude', keys: ['k1'] }] }, ctx).actions.length, 1);
	assert.equal(parseActions({ foo: 1 }, ctx).rejected.length, 1);
	assert.deepEqual(parseActions(undefined, ctx), { actions: [], rejected: [] });
});

test('cap of 50 actions', () => {
	const many = Array.from({ length: 60 }, () => ({ type: 'exclude', keys: ['k1'] }));
	const r = parseActions(many, ctx);
	assert.equal(r.actions.length, 50);
	assert.match(r.rejected[0]!.reason, /10 action/);
});

test('describeAction / actionKeys', () => {
	const a = validateAction({ type: 'recategorize', keys: ['k1', 'k2'], categoryId: 'alimentation' }, ctx);
	assert.ok(typeof a !== 'string');
	assert.equal(describeAction(a, label), 'Classer 2 opérations en « Alimentation »');
	assert.deepEqual(actionKeys(a), ['k1', 'k2']);
	const b = validateAction({ type: 'set_budget', categoryId: 'loisirs', amount: 0 }, ctx);
	assert.ok(typeof b !== 'string');
	assert.equal(describeAction(b, label), 'Retirer le budget « Loisirs »');
});

test('markdown: everything is escaped, only our own tags come out', () => {
	const html = mdToHtml('<script>alert(1)</script> **gras** <img src=x onerror=alert(1)>');
	assert.ok(!html.includes('<script>'));
	assert.ok(!html.includes('<img'));
	assert.ok(html.includes('&lt;script&gt;'));
	assert.ok(html.includes('<strong>gras</strong>'));
	assert.ok(!mdToHtml('[x](javascript:alert(1))').includes('href'));
	assert.ok(mdToHtml('[doc](https://exemple.fr/a?b=1&c=2)').includes('href="https://exemple.fr/a?b=1&amp;c=2"'));
});

test('markdown: headings, lists, tables with numeric columns', () => {
	const html = mdToHtml('## Bilan\n\n- un\n- deux\n\n| Poste | Montant |\n|---|---:|\n| Loyer | 1 095 € |\n\n1. a\n2. b');
	assert.ok(html.includes('<h4>Bilan</h4>'));
	assert.ok(html.includes('<ul><li>un</li><li>deux</li></ul>'));
	assert.ok(html.includes('<td class="num">1 095 €</td>'));
	assert.ok(html.includes('<ol><li>a</li><li>b</li></ol>'));
});

/**
 * Fake effects: in-memory state + log of the effects called. Demo transactions
 * (init.demo) cannot be modified: nothing is written for them.
 */
function fakeEffects(init: { overrides?: Record<string, CategoryId>; notes?: Record<string, string>; excluded?: string[]; tags?: Record<string, string[]>; demo?: string[] } = {}) {
	const state = {
		overrides: { ...(init.overrides ?? {}) } as Record<string, CategoryId>,
		notes: { ...(init.notes ?? {}) } as Record<string, string>,
		tags: structuredClone(init.tags ?? {}) as Record<string, string[]>,
		excluded: [...(init.excluded ?? [])],
		biens: [] as (AssetInput & { id: string })[],
		releves: [] as { assetId: string; date: string; km: number }[],
		appels: [] as string[]
	};
	const log = (name: string) => state.appels.push(name);
	const fx: ActionEffects = {
		budget: () => (log('budget'), undefined),
		setBudget: () => log('setBudget'),
		overrides: () => (log('overrides'), state.overrides),
		setOverrides: (next) => (log('setOverrides'), (state.overrides = next)),
		addRule: (keyword) => (log('addRule'), { keyword }),
		restoreRule: () => log('restoreRule'),
		isExcluded: (k) => state.excluded.includes(k),
		excludeKeys: (keys) => (log('excludeKeys'), (state.excluded = [...state.excluded, ...keys])),
		includeKeys: (keys) => (log('includeKeys'), (state.excluded = state.excluded.filter((k) => !keys.includes(k)))),
		note: (k) => state.notes[k] ?? '',
		setNote: (k, n) => (log('setNote'), (state.notes[k] = n), true),
		tags: (k) => [...(state.tags[k] ?? [])],
		setTags: (changes) => {
			log('setTags');
			if (changes.some((c) => init.demo?.includes(c.key))) return false;
			for (const c of changes) {
				if (c.tags.length) state.tags[c.key] = [...c.tags];
				else delete state.tags[c.key];
			}
			return true;
		},
		addGoal: () => (log('addGoal'), { id: 'g1' }),
		removeGoal: () => log('removeGoal'),
		addBien: (b) => (log('addBien'), state.biens.push({ id: `b${state.biens.length + 1}`, ...b }), { id: `b${state.biens.length}` }),
		removeBien: (id) => (log('removeBien'), (state.biens = state.biens.filter((b) => b.id !== id))),
		logKm: (assetId, r) => (log('logKm'), state.releves.push({ assetId, date: r.date, km: r.km }), null),
		removeKm: (assetId, r) => (log('removeKm'), (state.releves = state.releves.filter((x) => x.assetId !== assetId || x.date !== r.date || x.km !== r.km)))
	};
	return { etat: state, fx };
}

/** Already hidden: nothing to redo, and undo does not include it again. */
test('exclude: changes ONLY excluded — the transaction note and category stay intact, even after undo', () => {
	const { etat: state, fx } = fakeEffects({ overrides: { k1: 'loisirs' }, notes: { k1: 'Achat ampli Atoll IN300' } });
	const undo = applyAction({ type: 'exclude', keys: ['k1', 'k2'] }, fx);
	assert.deepEqual(state.excluded, ['k1', 'k2']);
	assert.deepEqual(state.overrides, { k1: 'loisirs' });
	assert.deepEqual(state.notes, { k1: 'Achat ampli Atoll IN300' });
	assert.deepEqual(state.appels, ['excludeKeys'], 'aucun autre effet que excludeKeys');
	undo();
	assert.deepEqual(state.excluded, []);
	assert.deepEqual(state.overrides, { k1: 'loisirs' });
	assert.deepEqual(state.notes, { k1: 'Achat ampli Atoll IN300' });
	const { etat: e2, fx: fx2 } = fakeEffects({ excluded: ['k1'] });
	applyAction({ type: 'exclude', keys: ['k1'] }, fx2)();
	assert.deepEqual(e2.excluded, ['k1']);
});

/** The old format (category) is still understood. */
test('add_asset: validated like an asset (type, date, amounts, existing transactions); applied then undoable', () => {
	const piano = { type: 'add_asset', name: ' Piano ', assetType: 'instrument', purchaseDate: '2025-09-18', purchasePrice: '11000', linkedTxKeys: ['k1', 'k2', 'k1'], note: 'payé en 2 fois' };
	const { actions, rejected } = parseActions(
		[
			piano,
			{ ...piano, assetType: 'voiture' },
			{ ...piano, purchaseDate: '18/09/2025' },
			{ ...piano, purchasePrice: -1 },
			{ ...piano, estimatedValue: 'beaucoup' },
			{ ...piano, linkedTxKeys: ['inconnue'] },
			{ ...piano, name: '' }
		],
		ctx
	);
	assert.equal(rejected.length, 6);
	assert.deepEqual(actions[0], { type: 'add_asset', bien: { type: 'instrument', name: 'Piano', purchaseDate: '2025-09-18', purchasePrice: 11000, linkedTxKeys: ['k1', 'k2'], note: 'payé en 2 fois' } });
	assert.equal(describeAction(actions[0]!, label).replace(/[\u202f\u00a0]/g, ' '), 'Nouveau bien « Piano » (Instrument) : 11 000 € payés le 18/09/2025 · 2 opérations rattachées');
	assert.deepEqual(actionKeys(actions[0]!), ['k1', 'k2']);
	assert.equal(parseActions([{ ...piano, assetType: undefined, category: 'hifi' }], ctx).actions.length, 1);
	const { etat: state, fx } = fakeEffects();
	const undo = applyAction(actions[0]!, fx);
	assert.deepEqual(state.biens, [{ id: 'b1', type: 'instrument', name: 'Piano', purchaseDate: '2025-09-18', purchasePrice: 11000, linkedTxKeys: ['k1', 'k2'], note: 'payé en 2 fois' }]);
	assert.deepEqual(state.appels, ['addBien']);
	undo();
	assert.deepEqual(state.biens, []);
});

/** Refused by the app (asset deleted meanwhile): the action fails, nothing is applied. */
test('add_asset for a vehicle (odometer, readings) and log_km: validated, described, undoable', () => {
	const car = {
		type: 'add_asset',
		assetType: 'vehicule',
		name: 'Toyota C-HR',
		purchaseDate: '2024-03-15',
		purchasePrice: 24900,
		linkedTxKeys: ['k1', 'k2'],
		vehicle: { firstRegistration: '2022-03-15', kmAtPurchase: 20000, kmLog: [{ date: '2026-03-31', km: 54000, source: 'ct' }] }
	};
	const { actions, rejected } = parseActions(
		[
			car,
			{ type: 'log_km', assetId: 'v1', date: '2026-09-30', km: '58 200', source: 'facture' },
			{ type: 'log_km', assetId: 'v1', date: '2026-09-30', km: 58200 },
			{ type: 'log_km', assetId: 'piano', date: '2026-09-30', km: 10 },
			{ type: 'log_km', assetId: 'v1', date: '2026-02-30', km: 10 },
			{ type: 'log_km', assetId: 'v1', date: '2026-09-30', km: -5 },
			{ type: 'log_km', assetId: 'v1', date: '2026-09-30', km: 10, source: 'garage' }
		],
		ctx
	);
	assert.deepEqual(rejected.map((r) => r.reason.split(' ')[0]), ['véhicule', 'date', 'kilométrage', 'source']);
	const v = actions[0]!;
	assert.ok(v.type === 'add_asset');
	assert.deepEqual(v.bien.vehicle, { firstRegistration: '2022-03-15', kmAtPurchase: 20000, kmLog: [{ date: '2026-03-31', km: 54000, source: 'ct' }] });
	assert.equal(describeAction(v, label).replace(/[\u202f\u00a0]/g, ' '), 'Nouveau bien « Toyota C-HR » (Véhicule) : 24 900 € payés le 15/03/2024 · 20 000 km à l’achat · 1 relevé du compteur · 2 opérations rattachées'.replace('’', "'"));
	assert.deepEqual(actions[1], { type: 'log_km', assetId: 'v1', date: '2026-09-30', km: 58200, source: 'facture' });
	assert.equal(actions[2]!.type === 'log_km' && actions[2]!.source, 'saisie', 'source absente : saisie');
	assert.equal(describeAction(actions[1]!, label, (id) => (id === 'v1' ? 'Toyota C-HR' : undefined)).replace(/[\u202f\u00a0]/g, ' '), 'Relevé du compteur « Toyota C-HR » : 58 200 km le 30/09/2026 (facture)');
	const { etat: state, fx } = fakeEffects();
	const undo = applyAction(actions[1]!, fx);
	assert.deepEqual(state.releves, [{ assetId: 'v1', date: '2026-09-30', km: 58200 }]);
	assert.deepEqual(state.appels, ['logKm'], 'aucun autre effet');
	undo();
	assert.deepEqual(state.releves, []);
	assert.throws(() => applyAction(actions[1]!, { ...fx, logKm: () => 'bien introuvable' }), /introuvable/);
});

test('tag: validated (tags trimmed, no case-only duplicates), described, transactions listed', () => {
	const { actions, rejected } = parseActions(
		[
			{ type: 'tag', keys: ['k1', 'k2', 'k1'], add: ['  courses ', 'Courses', 'maison   bricolage'], why: 'ticket Leclerc' },
			{ type: 'tag', keys: ['k3'], remove: ['amazon'] },
			{ type: 'tag', keys: ['k3'], add: ['cadeau'], remove: [] }
		],
		ctx
	);
	assert.equal(rejected.length, 0);
	assert.deepEqual(actions[0], { type: 'tag', keys: ['k1', 'k2'], add: ['courses', 'maison bricolage'], why: 'ticket Leclerc' });
	assert.deepEqual(actions[1], { type: 'tag', keys: ['k3'], remove: ['amazon'] });
	assert.deepEqual(actions[2], { type: 'tag', keys: ['k3'], add: ['cadeau'] }, 'liste vide omise');
	assert.equal(describeAction(actions[0]!, label), 'Tags sur 2 opérations : ajouter « courses », « maison bricolage »');
	assert.equal(describeAction(actions[1]!, label), 'Tags sur 1 opération : retirer « amazon »');
	assert.deepEqual(actionKeys(actions[0]!), ['k1', 'k2']);
});

/** Cap: 200 transactions per action (one write per transaction). */
test('tag: readable rejections (nothing to do, tag too long or empty, invalid list, conflict, unknown transaction)', () => {
	const bad = [
		{ type: 'tag', keys: ['k1'] },
		{ type: 'tag', keys: ['k1'], add: [], remove: [] },
		{ type: 'tag', keys: ['k1'], add: ['x'.repeat(31)] },
		{ type: 'tag', keys: ['k1'], add: ['   '] },
		{ type: 'tag', keys: ['k1'], add: [42] },
		{ type: 'tag', keys: ['k1'], add: 'courses' },
		{ type: 'tag', keys: ['k1'], add: Array.from({ length: 11 }, (_, i) => `t${i}`) },
		{ type: 'tag', keys: ['k1'], add: ['Cadeau'], remove: ['cadeau'] },
		{ type: 'tag', keys: ['k9'], add: ['courses'] },
		{ type: 'tag', keys: [], add: ['courses'] }
	];
	const { actions, rejected } = parseActions(bad, ctx);
	assert.equal(actions.length, 0);
	assert.deepEqual(
		rejected.map((r) => r.reason.split(' ').slice(0, 2).join(' ')),
		['aucun tag', 'aucun tag', 'tag invalide', 'tag invalide', 'tag invalide', '« add', 'trop de', 'tag «', '1 opération(s)', 'liste «']
	);
	assert.match(rejected[7]!.reason, /à la fois ajouté et retiré/);
	const keys = Array.from({ length: 201 }, (_, i) => `t${i}`);
	assert.match(String(validateAction({ type: 'tag', keys, add: ['x'] }, { ...ctx, txKeys: new Set(keys) })), /200/);
});

/** Already up to date: no write, undo without effect. */
test('tag: merges without overwriting existing tags, case-insensitive removal, exact undo', () => {
	const { etat: state, fx } = fakeEffects({ tags: { k1: ['amazon', 'Maison'], k2: ['courses'] }, notes: { k1: 'garder' }, overrides: { k1: 'loisirs' } });
	const action = validateAction({ type: 'tag', keys: ['k1', 'k2', 'k3'], add: ['maison', 'courses'], remove: ['AMAZON'] }, ctx);
	assert.ok(typeof action !== 'string');
	const undo = applyAction(action, fx);
	assert.deepEqual(state.tags, { k1: ['Maison', 'courses'], k2: ['courses', 'maison'], k3: ['maison', 'courses'] }, 'casse existante gardée, pas de doublon');
	assert.deepEqual(state.appels, ['setTags'], 'un seul effet : ni note ni catégorie touchées');
	assert.deepEqual(state.notes, { k1: 'garder' });
	assert.deepEqual(state.overrides, { k1: 'loisirs' });
	undo();
	assert.deepEqual(state.tags, { k1: ['amazon', 'Maison'], k2: ['courses'] });
	const { etat: e2, fx: fx2 } = fakeEffects({ tags: { k1: ['courses'] } });
	applyAction({ type: 'tag', keys: ['k1'], add: ['Courses'] }, fx2)();
	assert.deepEqual(e2.appels, []);
	assert.deepEqual(e2.tags, { k1: ['courses'] });
});

test('tag: a demo transaction makes the whole action fail, nothing is written', () => {
	const { etat: state, fx } = fakeEffects({ tags: { k1: ['a'] }, demo: ['k2'] });
	assert.throws(() => applyAction({ type: 'tag', keys: ['k1', 'k2'], add: ['b'] }, fx), /démonstration/);
	assert.deepEqual(state.tags, { k1: ['a'] });
});

test('receipt: accepted formats, HEIC explained, question prepared with the typed detail', () => {
	assert.equal(receiptRefusal('ticket.JPG'), null);
	assert.equal(receiptRefusal('reçu.pdf'), null);
	assert.equal(receiptRefusal('scan.webp'), null);
	assert.equal(receiptRefusal('IMG_0042.HEIC'), HEIC_MESSAGE);
	assert.match(receiptRefusal('ticket.docx') ?? '', /non pris en charge/);
	assert.match(receiptQuestion(1), /^🧾 Analyse ce ticket de caisse : retrouve l'opération bancaire/);
	assert.ok(!receiptQuestion(1).includes('Précision'));
	assert.match(receiptQuestion(2, '  cadeau pour   Léa '), /ces 2 tickets de caisse.*Précision : cadeau pour Léa$/);
});
