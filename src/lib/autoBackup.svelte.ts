import { collectBackup, restoreBackup, downloadBackup } from './backup';
import { deriveKey, encryptBackup, decryptBackup, decryptWithKey, PBKDF2_ITERATIONS, type EncryptedBackupFile } from './backupCrypto';
import { uiState } from './ui.svelte';

export { deriveKey, encryptBackup, decryptBackup, type EncryptedBackupFile } from './backupCrypto';

/**
 * ENCRYPTED automatic backup into a chosen folder (File System Access API:
 * Chrome, Edge, Opera; not Firefox/Safari).
 *
 * - The folder (e.g. a Drive/Dropbox synced folder) is chosen once; its access
 *   handle is remembered in IndexedDB.
 * - `budget-sauvegarde.enc.json` is rewritten on every change (checked every
 *   30 s and when the tab goes to the background), plus a daily copy
 *   `budget-sauvegarde-AAAA-MM-JJ.enc.json`: the last 7 are kept (rotation).
 * - Safeguard: a state WITHOUT operations never overwrites a backup that had
 *   some (reset, cleaned browser, blank tab).
 * - AES-256-GCM encryption, key derived from your passphrase (PBKDF2, 310,000
 *   iterations). The derived key is kept in IndexedDB as NON-extractable: the
 *   backup runs without asking for the passphrase again, but the file can only
 *   be read with it (on another machine it must be typed to restore).
 * Encryption itself lives in backupCrypto.ts (pure).
 */

const DB_NAME = 'budget-autobackup';
const STORE = 'kv';
const FILE_NAME = 'budget-sauvegarde.enc.json';
/** Daily copies: budget-sauvegarde-AAAA-MM-JJ.enc.json (7 kept). */
const DAILY_RE = /^budget-sauvegarde-(\d{4}-\d{2}-\d{2})\.enc\.json$/;
const DAILY_KEEP = 7;
const INTERVAL_MS = 30_000;

type DirHandle = FileSystemDirectoryHandle & {
	queryPermission?: (d: { mode: 'readwrite' }) => Promise<PermissionState>;
	requestPermission?: (d: { mode: 'readwrite' }) => Promise<PermissionState>;
	keys?: () => AsyncIterableIterator<string>;
};

/** Metadata of the last successful write (anti-overwrite safeguard). */
interface WriteMeta {
	at: number;
	txCount: number;
}

export const autoBackupState = $state({
	supported: typeof window !== 'undefined' && 'showDirectoryPicker' in window,
	enabled: false,
	folderName: '',
	/** 'granted' | 'prompt' (a click is needed to resume after a restart) | 'denied'. */
	permission: 'prompt' as PermissionState,
	lastAt: 0,
	error: '',
	/** Encrypted file chosen for a restore: the dialog asks for the passphrase. */
	pendingRestore: null as EncryptedBackupFile | null
});

// ---------- IndexedDB (folder handle + non-extractable key + salt) ----------

function openDb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, 1);
		req.onupgradeneeded = () => req.result.createObjectStore(STORE);
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

async function kvGet<T>(key: string): Promise<T | undefined> {
	const db = await openDb();
	return new Promise((resolve, reject) => {
		const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
		req.onsuccess = () => resolve(req.result as T | undefined);
		req.onerror = () => reject(req.error);
	});
}

async function kvSet(key: string, value: unknown): Promise<void> {
	const db = await openDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE, 'readwrite');
		tx.objectStore(STORE).put(value, key);
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
	});
}

async function kvDel(key: string): Promise<void> {
	const db = await openDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE, 'readwrite');
		tx.objectStore(STORE).delete(key);
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
	});
}

// ---------- Lifecycle ----------

let timer: number | null = null;
let listening = false;
let lastHash = '';

async function hashOf(text: string): Promise<string> {
	const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
	return btoa(String.fromCharCode(...new Uint8Array(d)));
}

/** Number of imported operations in a backup (0 when missing/unreadable). */
function txCountOf(data: Record<string, string>): number {
	try {
		const parsed = JSON.parse(data['budget:imported-txs'] ?? '[]') as unknown;
		return Array.isArray(parsed) ? parsed.length : 0;
	} catch {
		return 0;
	}
}

/** Today's local date "AAAA-MM-JJ" (name of the daily copy). */
function todayKey(): string {
	const d = new Date();
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function writeFile(handle: DirHandle, name: string, content: string): Promise<void> {
	const file = await handle.getFileHandle(name, { create: true });
	const writable = await file.createWritable();
	await writable.write(content);
	await writable.close();
}

/** Rotation: keeps only the DAILY_KEEP most recent daily copies. */
async function pruneDaily(handle: DirHandle): Promise<void> {
	if (!handle.keys) return;
	const dates: string[] = [];
	for await (const name of handle.keys()) {
		const m = DAILY_RE.exec(name);
		if (m) dates.push(m[1]!);
	}
	dates.sort();
	for (const d of dates.slice(0, Math.max(0, dates.length - DAILY_KEEP))) {
		await handle.removeEntry(`budget-sauvegarde-${d}.enc.json`).catch(() => undefined);
	}
}

/** Operations contained in the existing main file (0 when missing or unreadable). */
async function existingTxCount(handle: DirHandle, key: CryptoKey): Promise<number> {
	try {
		const file = await (await handle.getFileHandle(FILE_NAME)).getFile();
		const res = await decryptWithKey(JSON.parse(await file.text()) as EncryptedBackupFile, key);
		return 'error' in res ? 0 : txCountOf(res.data);
	} catch {
		return 0;
	}
}

/**
 * Writes the backup if it changed (or with `force`); true when an up-to-date
 * copy exists.
 * - Without permission, a click is needed to resume (browser rule).
 * - The file is encrypted, so the API keys may be included.
 * - Safeguard: an empty state never overwrites a backup that had operations;
 *   without metadata (older setup) the existing file is read back to know.
 */
async function writeNow(force = false): Promise<boolean> {
	if (!autoBackupState.enabled) return false;
	const handle = await kvGet<DirHandle>('dir');
	const key = await kvGet<CryptoKey>('key');
	const salt = await kvGet<Uint8Array>('salt');
	if (!handle || !key || !salt) return false;
	const perm = (await handle.queryPermission?.({ mode: 'readwrite' })) ?? 'granted';
	autoBackupState.permission = perm;
	if (perm !== 'granted') return false;
	const backup = collectBackup({ includeSecrets: true });
	const serialized = JSON.stringify(backup.data);
	const h = await hashOf(serialized);
	if (!force && h === lastHash) return true;
	const txCount = txCountOf(backup.data);
	if (txCount === 0) {
		const meta = await kvGet<WriteMeta>('meta');
		const previous = meta?.txCount ?? (await existingTxCount(handle, key));
		if (previous > 0) {
			autoBackupState.error = `Sauvegarde non écrasée : aucune opération dans l'app, ${previous} dans la dernière sauvegarde. Restaurez-la, ou désactivez la sauvegarde auto pour repartir de zéro.`;
			return false;
		}
	}
	try {
		const iterations = (await kvGet<number>('iterations')) ?? PBKDF2_ITERATIONS;
		const content = JSON.stringify(await encryptBackup(backup, key, salt, iterations));
		await writeFile(handle, FILE_NAME, content);
		await writeFile(handle, `budget-sauvegarde-${todayKey()}.enc.json`, content);
		await pruneDaily(handle);
		await kvSet('meta', { at: Date.now(), txCount } satisfies WriteMeta);
		lastHash = h;
		autoBackupState.lastAt = Date.now();
		autoBackupState.error = '';
		return true;
	} catch (e) {
		autoBackupState.error = e instanceof Error ? e.message : 'Écriture impossible';
		return false;
	}
}

/** Writes when the tab goes to the background (reliable, unlike beforeunload). */
function onVisibility(): void {
	if (document.visibilityState === 'hidden') void writeNow();
}

function startTimer(): void {
	if (timer === null) timer = window.setInterval(() => void writeNow(), INTERVAL_MS);
	if (!listening) {
		document.addEventListener('visibilitychange', onVisibility);
		listening = true;
	}
}

/** At startup: resumes the remembered setup (without asking for the passphrase again). */
export async function initAutoBackup(): Promise<void> {
	if (!autoBackupState.supported) return;
	try {
		const handle = await kvGet<DirHandle>('dir');
		const key = await kvGet<CryptoKey>('key');
		if (!handle || !key) return;
		autoBackupState.enabled = true;
		autoBackupState.folderName = handle.name;
		autoBackupState.permission = (await handle.queryPermission?.({ mode: 'readwrite' })) ?? 'granted';
		startTimer();
		if (autoBackupState.permission === 'granted') void writeNow(true);
	} catch (e) {
		autoBackupState.error = e instanceof Error ? e.message : 'Initialisation impossible';
	}
}

/**
 * Enables: folder choice (click required) + passphrase; immediate first write.
 * The first write MUST succeed, otherwise a backup that doesn't exist is never announced.
 */
export async function enableAutoBackup(passphrase: string): Promise<{ ok: boolean; error?: string }> {
	if (!autoBackupState.supported) return { ok: false, error: 'Navigateur non compatible (Chrome, Edge ou Opera requis).' };
	if (passphrase.length < 8) return { ok: false, error: 'Phrase secrète trop courte (8 caractères minimum).' };
	try {
		const picker = (window as unknown as { showDirectoryPicker: (o?: { mode: 'readwrite'; id?: string }) => Promise<DirHandle> }).showDirectoryPicker;
		const handle = await picker({ mode: 'readwrite', id: 'budget-backup' });
		const salt = crypto.getRandomValues(new Uint8Array(16));
		const key = await deriveKey(passphrase, salt, false, PBKDF2_ITERATIONS);
		await kvSet('dir', handle);
		await kvSet('key', key);
		await kvSet('salt', salt);
		await kvSet('iterations', PBKDF2_ITERATIONS);
		autoBackupState.enabled = true;
		autoBackupState.folderName = handle.name;
		autoBackupState.permission = 'granted';
		autoBackupState.error = '';
		startTimer();
		if (!(await writeNow(true))) {
			const error = autoBackupState.error || 'Écriture impossible dans ce dossier.';
			await disableAutoBackup();
			autoBackupState.error = error;
			return { ok: false, error };
		}
		return { ok: true };
	} catch (e) {
		const msg = e instanceof Error ? e.message : 'Annulé';
		return { ok: false, error: /abort/i.test(msg) ? 'Choix du dossier annulé.' : msg };
	}
}

/** Resumes folder access after a restart (click required by the browser). */
export async function resumeAutoBackup(): Promise<void> {
	const handle = await kvGet<DirHandle>('dir');
	if (!handle) return;
	const perm = (await handle.requestPermission?.({ mode: 'readwrite' })) ?? 'granted';
	autoBackupState.permission = perm;
	if (perm === 'granted') await writeNow(true);
}

export async function disableAutoBackup(): Promise<void> {
	await kvDel('dir');
	await kvDel('key');
	await kvDel('salt');
	await kvDel('iterations');
	await kvDel('meta');
	autoBackupState.enabled = false;
	autoBackupState.folderName = '';
	autoBackupState.lastAt = 0;
	if (timer !== null) {
		window.clearInterval(timer);
		timer = null;
	}
}

/**
 * Encrypted restore, step 1: file choice. The passphrase is then typed in the
 * dialog (masked field), no longer through a plain window.prompt.
 */
export async function pickAndRestoreEncrypted(): Promise<void> {
	const input = document.createElement('input');
	input.type = 'file';
	input.accept = '.json,application/json';
	input.onchange = async () => {
		const f = input.files?.[0];
		if (!f) return;
		let parsed: unknown;
		try {
			parsed = JSON.parse(await f.text());
		} catch {
			window.alert('Fichier illisible.');
			return;
		}
		const file = parsed as Partial<EncryptedBackupFile>;
		if (file?.enc !== 'AES-GCM') {
			window.alert('Ce fichier n’est pas une sauvegarde chiffrée (utilisez « Restaurer une sauvegarde » pour un fichier non chiffré).');
			return;
		}
		autoBackupState.pendingRestore = file as EncryptedBackupFile;
		uiState.backupDialogOpen = true;
	};
	input.click();
}

/**
 * Encrypted restore, step 2 (dialog): decrypts with the passphrase, then —
 * after confirmation — downloads a copy of the current state (with a short
 * delay so the download starts) and restores.
 */
export async function restorePendingEncrypted(passphrase: string): Promise<{ error?: string; cancelled?: boolean }> {
	const file = autoBackupState.pendingRestore;
	if (!file) return { error: 'Aucun fichier sélectionné.' };
	const backup = await decryptBackup(file, passphrase);
	if ('error' in backup) return { error: backup.error };
	const n = Object.keys(backup.data).length;
	const when = backup.exportedAt ? new Date(backup.exportedAt).toLocaleString('fr-FR') : 'date inconnue';
	if (!window.confirm(`Restaurer la sauvegarde du ${when} (${n} enregistrements) ? Les données actuelles seront remplacées — une copie en est d'abord téléchargée.`)) {
		return { cancelled: true };
	}
	downloadBackup('-avant-restauration');
	await new Promise((r) => setTimeout(r, 500));
	const res = restoreBackup(backup);
	return res ? { error: res.error } : {};
}
