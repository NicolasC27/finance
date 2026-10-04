import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBackup } from '../src/lib/backup';

/** Backup format: validation and encrypted round trip (Node's native WebCrypto). */

test('backup: format validation', () => {
	assert.ok('error' in parseBackup('nope'));
	assert.ok('error' in parseBackup(JSON.stringify({ app: 'autre', version: 1, data: {} })));
	const ok = parseBackup(JSON.stringify({ app: 'budget', version: 1, exportedAt: '2026-10-02T10:00:00Z', data: { 'budget:theme': '"encre"', 'autre:cle': 'x' } }));
	assert.ok(!('error' in ok));
	if (!('error' in ok)) assert.deepEqual(Object.keys(ok.data), ['budget:theme']);
});

test('encrypted backup: round trip with the right passphrase, refused with a wrong one', async () => {
	const mod = await import('../src/lib/backupCrypto');
	const salt = crypto.getRandomValues(new Uint8Array(16));
	const key = await mod.deriveKey('phrase-secrete-test', salt);
	const backup = { app: 'budget' as const, version: 1, exportedAt: '2026-10-02T10:00:00Z', data: { 'budget:theme': '"encre"', 'budget:budgets': '{"alimentation":420}' } };
	const file = await mod.encryptBackup(backup, key, salt);
	assert.equal(file.enc, 'AES-GCM');
	assert.ok(!JSON.stringify(file).includes('alimentation'), 'le contenu ne doit pas apparaître en clair');
	const back = await mod.decryptBackup(file, 'phrase-secrete-test');
	assert.ok(!('error' in back));
	if (!('error' in back)) assert.deepEqual(back.data, backup.data);
	const bad = await mod.decryptBackup(file, 'mauvaise-phrase');
	assert.ok('error' in bad);
});

/** ~1 MB of JSON: the old btoa(...spread) crashed from ~120 KB. */
test('encrypted backup: 1 MB of realistic data encrypted then decrypted without a RangeError', async () => {
	const mod = await import('../src/lib/backupCrypto');
	const salt = crypto.getRandomValues(new Uint8Array(16));
	const key = await mod.deriveKey('phrase-secrete-test', salt);
	const big = JSON.stringify(Array.from({ length: 4000 }, (_, i) => ({ booking_date: '2026-08-01', label: `PAIEMENT CB ${i} POITIERS COMMERCE`, amount: (i % 97) + 0.5 })));
	assert.ok(big.length > 250_000);
	const backup = { app: 'budget' as const, version: 1, exportedAt: '2026-10-03T10:00:00Z', data: { 'budget:imported-txs': big, 'budget:ledger': big + big } };
	const file = await mod.encryptBackup(backup, key, salt);
	assert.ok(file.data.length > 1_000_000);
	const back = await mod.decryptWithKey(file, key);
	assert.ok(!('error' in back));
	if (!('error' in back)) assert.equal(back.data['budget:imported-txs'], big);
});

test('encrypted backup: the iteration count stored in the file is used for decryption', async () => {
	const mod = await import('../src/lib/backupCrypto');
	const salt = crypto.getRandomValues(new Uint8Array(16));
	const key = await mod.deriveKey('phrase-secrete-test', salt, false, 150_000);
	const backup = { app: 'budget' as const, version: 1, exportedAt: '2026-10-03T10:00:00Z', data: { 'budget:theme': '"encre"' } };
	const file = await mod.encryptBackup(backup, key, salt, 150_000);
	assert.equal(file.iterations, 150_000);
	const back = await mod.decryptBackup(file, 'phrase-secrete-test');
	assert.ok(!('error' in back), 'une sauvegarde à 150 000 itérations reste lisible si la constante change');
});

/** More than 2 blocks of 32 KB (getRandomValues: 64 KB max). */
test('chunked b64: same output as the reference encoding', async () => {
	const { b64 } = await import('../src/lib/backupCrypto');
	const bytes = crypto.getRandomValues(new Uint8Array(60_000));
	assert.equal(b64(bytes), Buffer.from(bytes).toString('base64'));
});
