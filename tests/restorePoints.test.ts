import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3-multiple-ciphers';
import { fileKey, openDataStore } from '../server/base';
import { diffSnapshots, pointKind, pointsToKeep, type PointInfo } from '../src/lib/restorePoints';

const tempDir = () => mkdtempSync(join(tmpdir(), 'points-'));
const ops = (n: number) => JSON.stringify(Array.from({ length: n }, (_, i) => ({ booking_date: `2026-09-${String(i + 1).padStart(2, '0')}`, value_date: '', transaction_amount: { amount: `${i + 1}.00`, currency: 'EUR' }, credit_debit_indicator: 'DBIT', remittance_information: [`OP ${i}`] })));

test('points de restauration : aller-retour exact, retour annulable', async () => {
	const dir = tempDir();
	const cle = randomBytes(32);
	const b = await openDataStore(dir, { cle });
	assert.equal(b.creerPoint('vide'), null, 'pas de point sans données');
	b.ecrire('budget:imported-txs', ops(3));
	b.ecrire('budget:budgets', '{"alimentation":400}');
	const before = b.lireTout();
	const p = b.creerPoint('avant import OFX : 2 opérations')!;
	assert.equal(p.raison, 'avant import OFX : 2 opérations');
	b.ecrire('budget:imported-txs', ops(5));
	b.ecrire('budget:goals', '[]');
	const after = b.lireTout();
	const saved = b.restaurerPoint(p.id);
	assert.deepEqual(b.lireTout(), before, 'données exactement revenues');
	assert.match(saved.raison, /^avant retour au point du/);
	b.restaurerPoint(saved.id);
	assert.deepEqual(b.lireTout(), after, 'le retour en arrière s’annule');
	assert.ok(b.points().length >= 3);
	b.fermer();
});

test('point altéré refusé, base intacte', async () => {
	const dir = tempDir();
	const cle = randomBytes(32);
	const b = await openDataStore(dir, { cle });
	b.ecrire('budget:budgets', '{"a":1}');
	const p = b.creerPoint('test')!;
	b.ecrire('budget:budgets', '{"a":2}');
	b.fermer();
	const raw = new Database(join(dir, 'budget.db'));
	raw.pragma(`cipher = 'sqlcipher'`);
	raw.pragma('legacy = 4');
	raw.pragma(`key = "x'${fileKey(cle).toString('hex')}'"`);
	raw.prepare('UPDATE points SET contenu = randomblob(200) WHERE id = ?').run(p.id);
	raw.close();
	const b2 = await openDataStore(dir, { cle });
	const stateBefore = b2.lireTout();
	assert.throws(() => b2.restaurerPoint(p.id), /illisible/);
	assert.deepEqual(b2.lireTout(), stateBefore, 'base intacte');
	assert.equal(b2.points().length, 1, 'aucun point ajouté par la tentative');
	assert.throws(() => b2.restaurerPoint(9999), /introuvable/);
	b2.fermer();
});

test('rétention grand-père-père-fils et plafond de taille', () => {
	const now = Date.parse('2026-10-05T12:00:00Z');
	const pts: PointInfo[] = [];
	let id = 1;
	for (let h = 0; h < 24 * 400; h += 6) pts.push({ id: id++, cree_le: new Date(now - h * 3_600_000).toISOString(), raison: 'x', octets: 1000 });
	const keep = pointsToKeep(pts, now);
	const kept = pts.filter((p) => keep.has(p.id));
	const ageDays = (p: PointInfo) => (now - Date.parse(p.cree_le)) / 86_400_000;
	assert.equal(kept.filter((p) => ageDays(p) <= 2).length, 9, 'tout sur 48 h (toutes les 6 h)');
	const days = new Set(kept.filter((p) => ageDays(p) > 2 && ageDays(p) <= 30).map((p) => p.cree_le.slice(0, 10)));
	assert.equal(days.size, kept.filter((p) => ageDays(p) > 2 && ageDays(p) <= 30).length, 'un par jour sur 30 jours');
	assert.ok(kept.some((p) => ageDays(p) > 300), 'mensuels gardés');
	assert.ok(kept.length < 120, String(kept.length));
	const capped = pointsToKeep(pts, now, 20 * 1000);
	assert.equal(capped.size, 20);
	assert.ok(capped.has(1), 'le plus récent toujours gardé');
});

test('différences entre un point et les données actuelles', () => {
	const point = { 'budget:imported-txs': ops(3), 'budget:budgets': '{"a":1}', 'budget:goals': '[]' };
	const cur = JSON.parse(ops(4)) as Record<string, unknown>[];
	cur[0] = { ...cur[0], note: 'changée' };
	const d = diffSnapshots(point, { 'budget:imported-txs': JSON.stringify(cur), 'budget:budgets': '{"a":2}', 'budget:rules': '[]' });
	assert.deepEqual(d, { opsAdded: 1, opsRemoved: 0, opsChanged: 1, changed: ['budgets', 'objectifs', 'règles'] });
});

test('pointKind: reads the kind from the reason', () => {
	assert.equal(pointKind('quotidien'), 'daily');
	assert.equal(pointKind('avant import releve.ofx : 12 opérations'), 'import');
	assert.equal(pointKind('avant import API Kraken : 3 opérations'), 'import');
	assert.equal(pointKind('avant import : fichier.json'), 'import');
	assert.equal(pointKind('avant modification groupée : catégorie de 4 opérations'), 'bulk');
	assert.equal(pointKind('avant action IA : catégorie Courses'), 'ai');
	assert.equal(pointKind('avant 3 actions IA'), 'ai');
	assert.equal(pointKind('avant retour au point du 03/10'), 'restore');
	assert.equal(pointKind('avant restauration d’une sauvegarde'), 'restore');
	assert.equal(pointKind('avant de tout recatégoriser'), 'manual');
});
