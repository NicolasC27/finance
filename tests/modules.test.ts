import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALL_MODULES, MODULES, moduleOfRoute, modulesFromData, sanitizeModules, toggleModule } from '../src/lib/modules';

/** Fake storage: the keys given, as JSON strings (or raw strings to test invalid JSON). */
const storage = (data: Record<string, unknown>) => (key: string) => (key in data ? (typeof data[key] === 'string' ? (data[key] as string) : JSON.stringify(data[key])) : null);

test('new install without data: essential pages only', () => {
	assert.deepEqual(modulesFromData(storage({})), []);
	assert.deepEqual(modulesFromData(storage({ 'budget:theme': 'papier', 'budget:imported-txs': [] })), []);
});

test('existing user: every module holding data stays on', () => {
	const all = modulesFromData(
		storage({
			'budget:imported-txs': [{ source: 'cm-csv' }],
			'budget:biens': [{ type: 'vehicule' }],
			'budget:portage': { mois: [1] },
			'budget:krak-card': { '2026-09': {} },
			'budget:ia-chat': [{ role: 'user' }]
		})
	);
	assert.deepEqual(all, [...ALL_MODULES]);
});

test('transactions alone: Analyse, Patrimoine and Rapport; no Voiture, Portage, Crypto or IA', () => {
	assert.deepEqual(modulesFromData(storage({ 'budget:imported-txs': [{ source: 'cm-csv', account: 'cm-00000000001' }] })), ['analyse', 'patrimoine', 'rapport']);
});

test('signals per module: vehicle (type or former category), crypto from Kraken operations, AI from its config', () => {
	assert.deepEqual(modulesFromData(storage({ 'budget:biens': [{ type: 'instrument' }] })), ['patrimoine']);
	assert.deepEqual(modulesFromData(storage({ 'budget:biens': [{ category: 'vehicule' }] })), ['patrimoine', 'voiture']);
	assert.ok(modulesFromData(storage({ 'budget:imported-txs': [{ source: 'kraken-csv' }] })).includes('crypto'));
	assert.ok(modulesFromData(storage({ 'budget:imported-txs': [{ account: 'kraken' }] })).includes('crypto'));
	assert.deepEqual(modulesFromData(storage({ 'budget:ia-config': { url: 'http://127.0.0.1:8791', token: 'x' } })), ['ia']);
	assert.deepEqual(modulesFromData(storage({ 'budget:portage': '{oops' })), []);
});

test('stored choice: unknown ids dropped, canonical order; invalid gives null', () => {
	assert.equal(sanitizeModules(null), null);
	assert.equal(sanitizeModules(['voiture']), null);
	assert.equal(sanitizeModules({ active: 'voiture' }), null);
	assert.deepEqual(sanitizeModules({ active: ['voiture', 'unknown', 'analyse'] }), ['analyse', 'voiture']);
	assert.deepEqual(sanitizeModules({ active: [] }), []);
});

test('switching a module on or off, and the module of a page', () => {
	assert.deepEqual(toggleModule(['analyse'], 'voiture', true), ['analyse', 'voiture']);
	assert.deepEqual(toggleModule(['analyse', 'voiture'], 'voiture', false), ['analyse']);
	assert.deepEqual(toggleModule([], 'portage', false), []);
	assert.equal(moduleOfRoute('/voiture'), 'voiture');
	assert.equal(moduleOfRoute('/'), null);
	assert.equal(moduleOfRoute('/transactions'), null);
	assert.equal(MODULES.every((m) => m.description.length > 20 && m.description.length < 100), true);
});
