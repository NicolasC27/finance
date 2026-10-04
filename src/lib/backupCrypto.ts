import { parseBackup, type BackupFile } from './backup';

/** Backup encryption (AES-256-GCM, PBKDF2 key) — pure module, testable with tsx. */

export const PBKDF2_ITERATIONS = 310_000;
/** Accepted bounds for the iteration count read from a file (guards against a booby-trapped file). */
const MIN_ITERATIONS = 100_000;
const MAX_ITERATIONS = 5_000_000;

const enc = new TextEncoder();
const dec = new TextDecoder();

/**
 * Base64 in 32 KB chunks. The former `btoa(String.fromCharCode(...bytes))`
 * spread the whole ciphertext as arguments: RangeError (stack overflow) above
 * ~120 KB — the auto-backup was never written with real data.
 */
export function b64(buf: ArrayBuffer | Uint8Array): string {
	const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
	let bin = '';
	for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return btoa(bin);
}
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function deriveKey(passphrase: string, salt: Uint8Array, extractable = false, iterations = PBKDF2_ITERATIONS): Promise<CryptoKey> {
	const base = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
	return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, extractable, ['encrypt', 'decrypt']);
}

export interface EncryptedBackupFile {
	app: 'budget';
	version: number;
	enc: 'AES-GCM';
	kdf: 'PBKDF2-SHA256';
	iterations: number;
	salt: string;
	iv: string;
	exportedAt: string;
	data: string;
}

/** `iterations` = those used to derive `key` (written in the file for decryption). */
export async function encryptBackup(backup: BackupFile, key: CryptoKey, salt: Uint8Array, iterations = PBKDF2_ITERATIONS): Promise<EncryptedBackupFile> {
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(backup)));
	return { app: 'budget', version: backup.version, enc: 'AES-GCM', kdf: 'PBKDF2-SHA256', iterations, salt: b64(salt), iv: b64(iv), exportedAt: backup.exportedAt, data: b64(cipher) };
}

/**
 * Decrypts with the passphrase, using the FILE's iteration count (bounded):
 * raising PBKDF2_ITERATIONS will not make older backups unreadable.
 */
export async function decryptBackup(file: EncryptedBackupFile, passphrase: string): Promise<BackupFile | { error: string }> {
	try {
		const iterations = Number.isInteger(file.iterations) ? Math.min(Math.max(file.iterations, MIN_ITERATIONS), MAX_ITERATIONS) : PBKDF2_ITERATIONS;
		const key = await deriveKey(passphrase, unb64(file.salt), false, iterations);
		const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(file.iv) as BufferSource }, key, unb64(file.data) as BufferSource);
		return parseBackup(dec.decode(plain));
	} catch {
		return { error: 'Phrase secrète incorrecte ou fichier altéré.' };
	}
}

/** Decrypts with an already derived key (auto-backup: re-read the existing file before overwriting it). */
export async function decryptWithKey(file: EncryptedBackupFile, key: CryptoKey): Promise<BackupFile | { error: string }> {
	try {
		const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(file.iv) as BufferSource }, key, unb64(file.data) as BufferSource);
		return parseBackup(dec.decode(plain));
	} catch {
		return { error: 'Fichier illisible avec cette clé.' };
	}
}
