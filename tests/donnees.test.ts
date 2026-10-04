import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3-multiple-ciphers';
import { encrypt, isAllowedKey, VersionConflict, decrypt, readLegacyFiles, openDataStore } from '../server/base';
import { accessRefusal } from '../server/acces';

/** Encrypted SQLite database (server/base.ts) and access control (server/acces.ts). */

const key = randomBytes(32);
const MARKER = 'BOULANGERIE-MARQUEUR-EN-CLAIR';
const tempDir = () => mkdtempSync(join(tmpdir(), 'base-'));
const permissions = (p: string) => statSync(p).mode & 0o777;
/** SQLite file readable without a key (« SQLite format 3 » header)? */
const isPlaintext = (p: string) => readFileSync(p).subarray(0, 15).toString('latin1') === 'SQLite format 3';

test('keys: only app keys go into the database, never the secrets', () => {
	assert.ok(isAllowedKey('budget:imported-txs'));
	assert.ok(!isAllowedKey('budget:../../etc/passwd'));
	assert.ok(!isAllowedKey('autre:cle'));
	assert.ok(!isAllowedKey('budget:kraken-keys'));
	assert.ok(!isAllowedKey('budget:ia-config'));
});

test('encryption: faithful round trip; wrong key, another row key or a modified byte → rejected', () => {
	const text = JSON.stringify({ a: 1, b: [1.5, 'é'], c: MARKER });
	const bytes = encrypt(key, 'budget:notes', text);
	assert.ok(!bytes.includes(Buffer.from(MARKER)));
	assert.equal(decrypt(key, 'budget:notes', bytes), text);
	assert.throws(() => decrypt(randomBytes(32), 'budget:notes', bytes));
	assert.throws(() => decrypt(key, 'budget:budgets', bytes));
	const tampered = Buffer.from(bytes);
	tampered[tampered.length - 1] ^= 1;
	assert.throws(() => decrypt(key, 'budget:notes', tampered));
});

test('database: write, read back after reopening, delete; no plaintext data in the file, permissions 0600/0700', async () => {
	const dir = tempDir();
	const txs = JSON.stringify([{ booking_date: '2026-09-12', remittance_information: [MARKER], transaction_amount: { amount: '2.50', currency: 'EUR' } }]);
	const b = await openDataStore(dir, { cle: key });
	b.ecrire('budget:imported-txs', txs);
	b.ecrire('budget:theme', 'papier');
	assert.throws(() => b.ecrire('budget:kraken-keys', '{}'), /refusée/);
	b.fermer();

	const b2 = await openDataStore(dir, { cle: key });
	assert.deepEqual(b2.lireTout(), { 'budget:imported-txs': txs, 'budget:theme': 'papier' });
	b2.supprimer('budget:theme');
	assert.deepEqual(Object.keys(b2.lireTout()), ['budget:imported-txs']);
	b2.fermer();

	const file = join(dir, 'budget.db');
	assert.ok(!readFileSync(file).includes(Buffer.from(MARKER)));
	assert.ok(!readFileSync(file).includes(Buffer.from('budget:imported-txs')), 'noms des clés chiffrés aussi');
	assert.ok(!isPlaintext(file), 'fichier entier chiffré');
	assert.equal(permissions(file), 0o600);
	assert.equal(permissions(dir), 0o700);
});

test('database: wrong key refused, nothing is read', async () => {
	const dir = tempDir();
	(await openDataStore(dir, { cle: key })).fermer();
	await assert.rejects(openDataStore(dir, { cle: randomBytes(32) }), /Clé incorrecte/);
});

/**
 * An empty database has nothing to back up yet; a new process gets its own first
 * write of the day.
 */
test('daily backup: encrypted copy (0600) of the state before the first write of the day', async () => {
	const dir = tempDir();
	const b = await openDataStore(dir, { cle: key });
	b.ecrire('budget:notes', '"avant"');
	b.fermer();
	const b2 = await openDataStore(dir, { cle: key });
	b2.ecrire('budget:notes', '"après"');
	b2.ecrire('budget:notes', '"encore après"');
	b2.fermer();
	const copies = readdirSync(join(dir, 'historique'));
	assert.equal(copies.length, 1);
	assert.match(copies[0]!, /^budget-\d{4}-\d{2}-\d{2}\.db$/);
	assert.equal(permissions(join(dir, 'historique', copies[0]!)), 0o600);
	assert.ok(!isPlaintext(join(dir, 'historique', copies[0]!)), 'sauvegarde chiffrée');
	const copyDir = join(dir, 'copie');
	mkdirSync(copyDir);
	writeFileSync(join(copyDir, 'budget.db'), readFileSync(join(dir, 'historique', copies[0]!)));
	const reread = await openDataStore(copyDir, { cle: key, lectureSeule: true });
	assert.deepEqual(reread.lireTout(), { 'budget:notes': '"avant"' });
	reread.fermer();
});

test('batch import (browser migration): writes, archives the batch, ignores secrets and foreign keys', async () => {
	const dir = tempDir();
	const b = await openDataStore(dir, { cle: key });
	const n = b.importer({ 'budget:budgets': '[1]', 'budget:kraken-keys': '{"k":1}', 'x:y': '1', 'budget:notes': 3 }, 'navigateur');
	assert.equal(n, 1);
	assert.deepEqual(b.lireTout(), { 'budget:budgets': '[1]' });
	const archive = b.etat().archives;
	assert.equal(archive.length, 1);
	assert.deepEqual(b.lireArchive(archive[0]!.id), { 'budget:budgets': '[1]' });
	b.fermer();
});

/**
 * No plaintext file is left in donnees/: everything is in avant-sqlite-…/. Reopening
 * does not migrate again.
 */
test('legacy file migration: imported, checked, archived, then moved out of donnees/', async () => {
	const dir = tempDir();
	const txs = [{ booking_date: '2026-09-12', remittance_information: [MARKER] }];
	writeFileSync(join(dir, 'imported-txs.json'), JSON.stringify(txs, null, '\t'));
	writeFileSync(join(dir, 'theme.txt'), 'encre');
	mkdirSync(join(dir, 'historique', '2026-10-02'), { recursive: true });
	writeFileSync(join(dir, 'historique', '2026-10-02', 'budgets.json'), '[1]');
	mkdirSync(join(dir, 'historique', 'migration-2026-10-03T08-12-52-495Z'));
	writeFileSync(join(dir, 'historique', 'migration-2026-10-03T08-12-52-495Z', 'navigateur.json'), JSON.stringify({ 'budget:notes': '"n"' }));

	const b = await openDataStore(dir, { cle: key });
	assert.deepEqual(b.migration && { cles: b.migration.cles, archives: b.migration.archives }, { cles: 2, archives: 3 });
	assert.deepEqual(b.lireTout(), { 'budget:imported-txs': JSON.stringify(txs), 'budget:theme': 'encre' });
	const origins = b.etat().archives.map((a) => a.origine);
	assert.deepEqual(origins, ['fichiers donnees/ (avant SQLite)', 'historique/2026-10-02', 'historique/migration-2026-10-03T08-12-52-495Z']);
	assert.deepEqual(b.lireArchive(b.etat().archives[1]!.id), { 'budget:budgets': '[1]' });
	b.fermer();

	const remaining = readdirSync(dir).sort();
	assert.equal(remaining.length, 3);
	assert.match(remaining[0]!, /^avant-sqlite-/);
	assert.deepEqual(remaining.slice(1), ['budget.db', 'historique']);
	assert.deepEqual(readdirSync(join(dir, 'historique')), []);
	assert.deepEqual(readdirSync(join(dir, remaining[0]!)).sort(), ['historique', 'imported-txs.json', 'theme.txt']);
	assert.equal(permissions(join(dir, remaining[0]!)), 0o700);
	assert.ok(!readFileSync(join(dir, 'budget.db')).includes(Buffer.from(MARKER)));

	const b2 = await openDataStore(dir, { cle: key });
	assert.equal(b2.migration, null);
	b2.fermer();
});

test('legacy files: a damaged JSON file blocks the migration instead of being lost', async () => {
	const dir = tempDir();
	writeFileSync(join(dir, 'budgets.json'), '{ cassé');
	assert.throws(() => readLegacyFiles(dir), /illisible/);
	await assert.rejects(openDataStore(dir, { cle: key }), /illisible/);
	assert.ok(existsSync(join(dir, 'budgets.json')));
});

/** Includes DNS rebinding. */
test('access: local app only (loopback, local host, same origin, header)', () => {
	const req = (headers: Record<string, string>, remoteAddress = '127.0.0.1') =>
		({ headers: { host: 'localhost:5173', 'x-budget-data': '1', ...headers }, socket: { remoteAddress } }) as unknown as Parameters<typeof accessRefusal>[0];
	assert.equal(accessRefusal(req({})), null);
	assert.equal(accessRefusal(req({ origin: 'http://localhost:5173', 'sec-fetch-site': 'same-origin' })), null);
	assert.equal(accessRefusal(req({ host: '[::1]:5173' }, '::1')), null);
	assert.match(accessRefusal(req({}, '192.168.1.20'))!, /non locale/);
	assert.match(accessRefusal(req({ host: 'evil.example:5173' }))!, /hôte/);
	assert.match(accessRefusal(req({ origin: 'http://localhost:3000' }))!, /origine/);
	assert.match(accessRefusal(req({ 'sec-fetch-site': 'same-site' }))!, /autre site/);
	assert.match(accessRefusal(req({ 'x-budget-data': '' }))!, /en-tête/);
});

/**
 * « v1 » database: plaintext SQLite file, values encrypted one by one. Reopening
 * has nothing to re-encrypt.
 */
test('pre-SQLCipher database (plaintext file): fully encrypted on opening, backups included, data intact', async () => {
	const dir = tempDir();
	const v1 = (file: string, notes: string) => {
		const db = new Database(file);
		db.exec(`CREATE TABLE meta (cle TEXT PRIMARY KEY, valeur ANY NOT NULL) STRICT;
			CREATE TABLE donnees (cle TEXT PRIMARY KEY, valeur BLOB NOT NULL, modifie_le TEXT NOT NULL) STRICT;
			CREATE TABLE archives (id INTEGER PRIMARY KEY, origine TEXT NOT NULL, cree_le TEXT NOT NULL, contenu BLOB NOT NULL) STRICT;`);
		db.prepare('INSERT INTO meta VALUES (?, ?)').run('temoin', encrypt(key, 'meta:temoin', 'budget-fintech'));
		db.prepare('INSERT INTO donnees VALUES (?, ?, ?)').run('budget:notes', encrypt(key, 'budget:notes', notes), '2026-10-03T08:00:00.000Z');
		db.close();
	};
	v1(join(dir, 'budget.db'), '"courant"');
	mkdirSync(join(dir, 'historique'));
	v1(join(dir, 'historique', 'budget-2026-10-02.db'), '"veille"');
	assert.ok(isPlaintext(join(dir, 'budget.db')));

	const b = await openDataStore(dir, { cle: key });
	assert.equal(b.fichiersChiffres, 2);
	assert.deepEqual(b.lireTout(), { 'budget:notes': '"courant"' });
	assert.equal(b.etat().fichierChiffre, true);
	b.fermer();
	assert.ok(!isPlaintext(join(dir, 'budget.db')));
	assert.ok(!isPlaintext(join(dir, 'historique', 'budget-2026-10-02.db')));
	assert.ok(!existsSync(join(dir, 'budget.db.chiffrement')));

	const copyDir = join(dir, 'copie');
	mkdirSync(copyDir);
	writeFileSync(join(copyDir, 'budget.db'), readFileSync(join(dir, 'historique', 'budget-2026-10-02.db')));
	const previousDay = await openDataStore(copyDir, { cle: key, lectureSeule: true });
	assert.deepEqual(previousDay.lireTout(), { 'budget:notes': '"veille"' });
	previousDay.fermer();

	const b2 = await openDataStore(dir, { cle: key });
	assert.equal(b2.fichiersChiffres, 0);
	b2.fermer();
});

test('plaintext database of ANOTHER key: refused, file left intact', async () => {
	const dir = tempDir();
	const db = new Database(join(dir, 'budget.db'));
	db.exec('CREATE TABLE meta (cle TEXT PRIMARY KEY, valeur ANY NOT NULL) STRICT');
	db.prepare('INSERT INTO meta VALUES (?, ?)').run('temoin', encrypt(randomBytes(32), 'meta:temoin', 'budget-fintech'));
	db.close();
	await assert.rejects(openDataStore(dir, { cle: key }), /Clé incorrecte/);
	assert.ok(isPlaintext(join(dir, 'budget.db')));
});

/**
 * Tab B had read v1: its write is refused and A's data stays intact. Without a
 * version (old client, tool) the write is accepted; a missing key is expected as
 * such.
 */
test('concurrent writes: a stale copy (another tab) cannot overwrite a change made elsewhere', async () => {
	const dir = tempDir();
	const b = await openDataStore(dir, { cle: key });
	const v1 = b.ecrire('budget:notes', '"onglet A"', null);
	assert.equal(b.versions()['budget:notes'], v1);
	const v2 = b.ecrire('budget:notes', '"onglet A, suite"', v1);
	assert.ok(v2 > v1, 'versions strictement croissantes, même dans la même milliseconde');
	assert.throws(() => b.ecrire('budget:notes', '"onglet B périmé"', v1), (e: unknown) => e instanceof VersionConflict && e.actuelle === v2);
	assert.throws(() => b.ecrire('budget:notes', '"création concurrente"', null), VersionConflict);
	assert.throws(() => b.supprimer('budget:notes', v1), VersionConflict);
	assert.deepEqual(b.lireTout(), { 'budget:notes': '"onglet A, suite"' });
	b.ecrire('budget:notes', '"sans contrôle"');
	b.supprimer('budget:notes', b.versions()['budget:notes']!);
	assert.deepEqual(b.lireTout(), {});
	b.fermer();
});
