import { createHash, createHmac } from 'node:crypto';
import { deleteSecret, writeSecret, readSecret } from './trousseau.ts';

/**
 * Kraken API keys on the SERVER side: stored in the system keyring, never
 * sent back to the browser (neither by the API nor in the data). The server
 * signs private calls itself, limited to READ access (balances, ledger): even
 * a rogue page talking to the server could neither read the secret key nor
 * place an order or a withdrawal.
 */

export interface KrakenApiKeys {
	key: string;
	secret: string;
}

/** Keyring entry; `espace` separates trials (BUDGET_DB_NOM) from the real keys. */
const keyringEntry = () => ({ secret: 'kraken-api', espace: process.env.BUDGET_DB_NOM ?? 'principale' });
const API = 'https://api.kraken.com';
const TIMEOUT_MS = 15_000;
/** Allowed private calls and their parameters (read-only). */
const METHODS: Readonly<Record<string, ReadonlySet<string>>> = {
	Balance: new Set(),
	Ledgers: new Set(['start', 'end', 'ofs', 'asset', 'type', 'aclass'])
};
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** Shape of a Kraken key pair (public key + base64 secret). */
export function areValidKeys(c: unknown): c is KrakenApiKeys {
	if (!c || typeof c !== 'object') return false;
	const { key, secret } = c as Record<string, unknown>;
	return (
		typeof key === 'string' &&
		typeof secret === 'string' &&
		key.length >= 20 &&
		key.length <= 200 &&
		B64.test(key) &&
		secret.length >= 20 &&
		secret.length <= 200 &&
		B64.test(secret)
	);
}

export async function readKrakenKeys(): Promise<KrakenApiKeys | null> {
	const raw = await readSecret(keyringEntry());
	if (!raw) return null;
	try {
		const c: unknown = JSON.parse(raw);
		return areValidKeys(c) ? { key: c.key, secret: c.secret } : null;
	} catch {
		return null;
	}
}

export async function saveKrakenKeys(c: KrakenApiKeys): Promise<void> {
	await writeSecret('Budget FinTech — clés API Kraken (lecture seule)', keyringEntry(), JSON.stringify({ key: c.key, secret: c.secret }));
}

export const deleteKrakenKeys = (): Promise<void> => deleteSecret(keyringEntry());

/** API-Sign = base64(HMAC-SHA512(base64Decode(secret), path + SHA256(nonce + body))). */
export function signRequest(path: string, nonce: string, body: string, secret: string): string {
	const sha = createHash('sha256').update(nonce + body).digest();
	return createHmac('sha512', Buffer.from(secret, 'base64')).update(Buffer.concat([Buffer.from(path), sha])).digest('base64');
}

/** Parameters kept for an allowed method (plain values only); null when the method is refused. */
export function allowedParams(method: string, params: unknown): Record<string, string> | null {
	const allowed = Object.hasOwn(METHODS, method) ? METHODS[method] : undefined;
	if (!allowed) return null;
	const out: Record<string, string> = {};
	if (params && typeof params === 'object') {
		for (const [k, v] of Object.entries(params)) {
			if (!allowed.has(k)) continue;
			const s = String(v);
			if ((typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && /^[A-Za-z0-9.,_-]{0,40}$/.test(s))) out[k] = s;
		}
	}
	return out;
}

let lastNonce = 0;
/** Strictly increasing nonce (same ms scale as the former browser client). */
const nonce = () => String((lastNonce = Math.max(Date.now(), lastNonce + 1)));
let queue: Promise<unknown> = Promise.resolve();

export interface KrakenResponse {
	error: string[];
	result?: unknown;
}

/**
 * Signed private call, serialised: Kraken requires nonces that increase ON
 * ARRIVAL. Method or parameters outside the list → refused without calling.
 */
export function privateCall(method: string, params: unknown, keys: KrakenApiKeys): Promise<KrakenResponse> {
	const allowed = allowedParams(method, params);
	if (!allowed) return Promise.resolve({ error: [`méthode Kraken non autorisée : ${method}`] });
	const run = queue.then(() => privateCallNow(method, allowed, keys));
	queue = run.catch(() => undefined);
	return run;
}

async function privateCallNow(method: string, params: Record<string, string>, keys: KrakenApiKeys): Promise<KrakenResponse> {
	const path = `/0/private/${method}`;
	const n = nonce();
	const body = new URLSearchParams({ nonce: n, ...params }).toString();
	const res = await fetch(API + path, {
		method: 'POST',
		headers: { 'API-Key': keys.key, 'API-Sign': signRequest(path, n, body, keys.secret), 'Content-Type': 'application/x-www-form-urlencoded' },
		body,
		signal: AbortSignal.timeout(TIMEOUT_MS)
	});
	if (!res.ok) throw new Error(`Kraken HTTP ${res.status}`);
	const r = (await res.json()) as KrakenResponse;
	return { error: Array.isArray(r.error) ? r.error.map(String) : [], result: r.result };
}
