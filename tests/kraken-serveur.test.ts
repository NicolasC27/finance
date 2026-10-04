import { test } from 'node:test';
import assert from 'node:assert/strict';
import { privateCall, areValidKeys, allowedParams, signRequest } from '../server/kraken';

/** Kraken private calls signed by the server (server/kraken.ts). */

const SECRET = 'kQH5HW/8p1uGOVjbgWA7FunAmGO8lsSUXNsu3eow76sz84Q18fWxnyRzBHCd3pd5nE9qa99HAZtuZuj6F1huXg==';

/** Former browser computation (WebCrypto), which worked with Kraken. */
async function browserSignature(path: string, nonce: string, body: string, secret: string): Promise<string> {
	const enc = new TextEncoder();
	const sha = await crypto.subtle.digest('SHA-256', enc.encode(nonce + body));
	const key = await crypto.subtle.importKey('raw', Buffer.from(secret, 'base64'), { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']);
	const sig = await crypto.subtle.sign('HMAC', key, new Uint8Array([...enc.encode(path), ...new Uint8Array(sha)]));
	return Buffer.from(sig).toString('base64');
}

test('signature: Kraken documentation example, identical to the former browser computation', async () => {
	const body = 'nonce=1616492376594&ordertype=limit&pair=XBTUSD&price=37500&type=buy&volume=1.25';
	assert.equal(
		signRequest('/0/private/AddOrder', '1616492376594', body, SECRET),
		'4/dpxb3iT4tp/ZCVEwSnEsLxx0bqyhLpdfOpc6fn7OR8+UClSV5n9E6aSS8MPtnRfp32bAb0nmbRn6H8ndwLUQ=='
	);
	const balance = 'nonce=1700000000000';
	assert.equal(signRequest('/0/private/Balance', '1700000000000', balance, SECRET), await browserSignature('/0/private/Balance', '1700000000000', balance, SECRET));
});

/** Refused without any network call. */
test('read-only: only Balance and Ledgers go through, with their known parameters', async () => {
	assert.deepEqual(allowedParams('Balance', { pair: 'XBTEUR' }), {});
	assert.deepEqual(allowedParams('Ledgers', { start: 1700000000, ofs: 50, volume: 1, asset: 'XXBT' }), { start: '1700000000', ofs: '50', asset: 'XXBT' });
	assert.deepEqual(allowedParams('Ledgers', { asset: 'X&volume=9' }), {});
	for (const m of ['AddOrder', 'Withdraw', 'CancelAll', 'WalletTransfer', 'toString', '__proto__']) assert.equal(allowedParams(m, {}), null, m);
	const r = await privateCall('Withdraw', { amount: 1 }, { key: 'A'.repeat(56), secret: SECRET });
	assert.match(r.error[0]!, /non autorisée/);
});

test('keys: Kraken format required', () => {
	assert.ok(areValidKeys({ key: 'A'.repeat(56), secret: SECRET }));
	assert.ok(!areValidKeys({ key: 'court', secret: SECRET }));
	assert.ok(!areValidKeys({ key: 'A'.repeat(56), secret: 'pas du base64 !' }));
	assert.ok(!areValidKeys(null));
});
