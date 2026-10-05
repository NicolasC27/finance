import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUDGET_BLOCKS, SECTION_BLOCKS, categoriesToShow, sectionsToMigrate } from '../src/lib/budgetLayout';

test('Budget blocks: default order = the former page, every former section has its block', () => {
	assert.deepEqual([...BUDGET_BLOCKS], ['resume', 'cascade', 'objectifs', 'vacances', 'categories', 'conseils', 'previsions']);
	for (const s of SECTION_BLOCKS) assert.ok((BUDGET_BLOCKS as readonly string[]).includes(s.block), s.block);
	assert.equal(new Set(SECTION_BLOCKS.map((s) => s.section)).size, SECTION_BLOCKS.length);
});

test('section migration: collapsed sections (saved choice or default) → collapsed blocks, only once', () => {
	const stored: Record<string, boolean> = { goals: false, categories: true };
	const byDefault = new Set(['advisor', 'forecast', 'notes']);
	const isCollapsed = (id: string) => stored[id] ?? byDefault.has(id);
	assert.deepEqual(sectionsToMigrate(isCollapsed), [
		{ section: 'categories', block: 'categories' },
		{ section: 'advisor', block: 'conseils' },
		{ section: 'forecast', block: 'previsions' }
	]);
	for (const { section } of sectionsToMigrate(isCollapsed)) stored[section] = false;
	assert.deepEqual(sectionsToMigrate(isCollapsed), [], 'plus rien à migrer ensuite : le choix reste à l’utilisateur');
});

test('section migration: an expanded Conseils section stays expanded, unknown sections ignored', () => {
	const stored: Record<string, boolean> = { advisor: false, forecast: false, notes: true, other: true };
	assert.deepEqual(sectionsToMigrate((id) => stored[id] ?? false), []);
});

test('section migration: a missing block (no advice yet) is not migrated now, it will be later', () => {
	const stored: Record<string, boolean> = {};
	const byDefault = new Set(['advisor', 'forecast']);
	const isCollapsed = (id: string) => stored[id] ?? byDefault.has(id);
	let hasAdvice = false;
	const present = (block: string) => block !== 'conseils' || hasAdvice;
	assert.deepEqual(sectionsToMigrate(isCollapsed, present), [{ section: 'forecast', block: 'previsions' }]);
	stored.forecast = false;
	hasAdvice = true;
	assert.deepEqual(sectionsToMigrate(isCollapsed, present), [{ section: 'advisor', block: 'conseils' }]);
});

/** A card whose budget changed during the visit (slider dragged down to 0) stays on screen (`keep`). */
test('empty categories: hidden on request, kept when they have a budget, a spend or a refund', () => {
	const cats = [{ id: 'alimentation' }, { id: 'loisirs' }, { id: 'sante' }, { id: 'voiture' }];
	const budgets: Record<string, number> = { alimentation: 400, loisirs: 0, sante: 0, voiture: 0 };
	const spent: Record<string, number> = { alimentation: 120, loisirs: 35, sante: -20, voiture: 0 };
	const ids = (withEmpty: boolean) => categoriesToShow(cats, (id) => budgets[id] ?? 0, (id) => spent[id] ?? 0, withEmpty).map((c) => c.id);
	assert.deepEqual(ids(true), ['alimentation', 'loisirs', 'sante', 'voiture']);
	assert.deepEqual(ids(false), ['alimentation', 'loisirs', 'sante']);
	const kept = categoriesToShow(cats, (id) => budgets[id] ?? 0, (id) => spent[id] ?? 0, false, (id) => id === 'voiture').map((c) => c.id);
	assert.deepEqual(kept, ['alimentation', 'loisirs', 'sante', 'voiture']);
});
