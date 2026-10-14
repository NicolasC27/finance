import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanPackItem, copyPacking, groupPacking, PACK_TEMPLATES, packingProgress, sanitizePacking, templateItems, weatherProfile, weatherSuggestions, type PackItem } from '../src/lib/packing';

let k = 0;
const idOf = () => `pk-${++k}`;

test('templateItems: the essentials come with any template, one per traveller unless shared, nothing twice', () => {
	const items = templateItems(['plage'], 3, [], idOf);
	const base = PACK_TEMPLATES.find((t) => t.id === 'base')!;
	assert.ok(items.length >= base.items.length + 5);
	const passport = items.find((i) => i.label.startsWith('Carte d’identité'))!;
	assert.equal(passport.qty, 3);
	assert.equal(passport.shared, false);
	const kit = items.find((i) => i.label === 'Trousse à pharmacie')!;
	assert.equal(kit.qty, 1);
	assert.equal(kit.shared, true);
	assert.equal(new Set(items.map((i) => i.label.toLowerCase())).size, items.length);
	const again = templateItems(['plage', 'ville'], 3, items, idOf);
	assert.equal(again.some((i) => i.label === 'Maillots de bain'), false);
	assert.equal(again.some((i) => i.label === 'Tote bag'), true);
	assert.equal(templateItems([], 1, [], idOf).every((i) => i.qty === 1), true);
});

test('weatherProfile and weatherSuggestions: hot, cold and rainy stays, items the list lacks', () => {
	const day = (max: number, min: number, precipitation: number) => ({ date: '2027-04-10', code: 0, max, min, precipitation });
	assert.deepEqual(weatherProfile([day(28, 15, 0), day(25, 14, 0)]), { hot: true, cold: false, rain: false });
	assert.deepEqual(weatherProfile([day(8, 2, 0)]), { hot: false, cold: true, rain: false });
	assert.deepEqual(weatherProfile([day(18, 10, 3), day(17, 9, 2.5)]), { hot: false, cold: false, rain: true });
	assert.deepEqual(weatherProfile([day(18, 10, 11)]), { hot: false, cold: false, rain: true });
	assert.deepEqual(weatherProfile([]), { hot: false, cold: false, rain: false });
	const existing: PackItem[] = [{ id: 'x', category: 'sante', label: 'crème solaire', qty: 1, shared: true, done: false, forgot: false }];
	const s = weatherSuggestions({ hot: true, cold: false, rain: true }, existing, 2, idOf);
	assert.equal(s.some((i) => i.label === 'Crème solaire'), false);
	assert.equal(s.some((i) => i.label === 'Parapluie pliable'), true);
	assert.equal(s.find((i) => i.label === 'Veste de pluie')!.qty, 2);
	assert.deepEqual(weatherSuggestions({ hot: false, cold: false, rain: false }, [], 2, idOf), []);
});

test('progress, copy, groups, cleaning and sanitizing', () => {
	const items: PackItem[] = [
		{ id: 'a', category: 'tech', label: 'Chargeur', qty: 1, shared: true, done: true, forgot: false },
		{ id: 'b', category: 'papiers', label: 'Passeport', qty: 2, shared: false, done: false, forgot: false },
		{ id: 'c', category: 'tech', label: 'Adaptateur', qty: 1, shared: true, done: true, forgot: true }
	];
	assert.deepEqual(packingProgress(items), { done: 2, total: 3 });
	const copy = copyPacking(items, idOf);
	assert.equal(copy[0]!.label, 'Adaptateur');
	assert.equal(copy.every((i) => !i.done && !i.forgot && !['a', 'b', 'c'].includes(i.id)), true);
	assert.deepEqual(groupPacking(items).map((g) => [g.category.id, g.items.length]), [['papiers', 1], ['tech', 2]]);
	assert.deepEqual(cleanPackItem({ label: '  Lunettes   de soleil ', category: 'divers', qty: '2', shared: false }, () => 'n'), { id: 'n', category: 'divers', label: 'Lunettes de soleil', qty: 2, shared: false, done: false, forgot: false });
	assert.equal(cleanPackItem({ label: ' ', category: 'divers', qty: '1', shared: false }, () => 'n'), null);
	assert.equal(cleanPackItem({ label: 'X', category: 'divers', qty: 'abc', shared: true }, () => 'n')!.qty, 1);
	assert.equal(cleanPackItem({ label: 'X', category: 'divers', qty: '500', shared: true }, () => 'n')!.qty, 99);
	const clean = sanitizePacking([{ id: 'a', label: 'OK', category: 'nope', qty: 0 }, { id: 'b' }, null, 'x']);
	assert.deepEqual(clean, [{ id: 'a', category: 'divers', label: 'OK', qty: 1, shared: false, done: false, forgot: false }]);
	assert.deepEqual(sanitizePacking(undefined), []);
});
