import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Transaction } from '../src/lib/types';
import { categorize, txKey } from '../src/lib/categories';
import { validateAsset } from '../src/lib/assets';
import { portageTaxProvisions, matchAllReports, type PortageData } from '../src/lib/portage';
import { generateDemo } from '../scripts/demo.ts';

/** Demo data (npm run demo): stable, valid, and every page has something to show. */

const demo = generateDemo('2026-10-03');
const txs = JSON.parse(demo['budget:imported-txs']!) as Transaction[];

test('demo: stable, 18 months of transactions, every spending category represented', () => {
	assert.deepEqual(generateDemo('2026-10-03'), demo, 'même graine : mêmes données');
	assert.ok(txs.length > 600, String(txs.length));
	const months = new Set(txs.map((t) => t.booking_date.slice(0, 7)));
	assert.ok(months.has('2025-04') && months.has('2026-09'));
	assert.ok(txs.every((t) => t.booking_date <= '2026-10-03'), 'rien dans le futur');
	assert.equal(new Set(txs.map(txKey)).size, txs.length, 'aucune clé en double');
	const cats = new Set(txs.map((t) => categorize(t, {}, [], new Map())));
	for (const c of ['alimentation', 'logement', 'energie', 'transport', 'voiture', 'abonnements', 'loisirs', 'sante', 'revenus', 'epargne', 'impots', 'autre'] as const) assert.ok(cats.has(c), c);
});

test('demo: valid assets (car with odometer readings), matched portage and tax provision', () => {
	const assets = JSON.parse(demo['budget:biens']!) as unknown[];
	for (const b of assets) assert.equal(typeof validateAsset(b), 'object', JSON.stringify(b).slice(0, 60));
	const portage = JSON.parse(demo['budget:portage']!) as PortageData;
	const lines = [...matchAllReports(portage, txs, txKey).values()].flat();
	assert.ok(lines.length > 0, 'lignes de notes de frais');
	assert.deepEqual(
		lines.map((r) => [r.ligne.id, r.etat]),
		lines.map((r) => [r.ligne.id, r.ligne.id === '1002-2' ? 'indemnite' : r.ligne.id === '1002-5' ? 'probable' : 'rapprochee']),
		'chaque achat retrouvé, l’indemnité de télétravail reconnue, l’achat en dollars à confirmer'
	);
	assert.ok(portageTaxProvisions(portage).length === 4, 'taux de prélèvement bas : provision chaque mois');
	const accounts = JSON.parse(demo['budget:accounts']!) as { balance: number; kind: string }[];
	assert.ok(accounts.every((c) => (c.kind === 'pret' ? c.balance < 0 : c.balance > 0)), JSON.stringify(accounts));
});
