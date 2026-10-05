import Database from 'better-sqlite3-multiple-ciphers';
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { chmodSync, closeSync, copyFileSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeSecret, readSecret } from './trousseau.ts';
import { pointsToKeep, type PointInfo } from '../src/lib/restorePoints.ts';

/**
 * App database: `donnees/budget.db`, encrypted twice.
 *
 * - WHOLE FILE encrypted (SQLCipher 4: AES-256 + HMAC-SHA512 per page):
 *   without the key, neither the data, the key names, the dates nor even the
 *   structure can be read.
 * - `donnees` table: one row per `budget:*` key (same split as the former
 *   localStorage, the app sees no difference). Each value is also compressed,
 *   then encrypted with AES-256-GCM and bound to its key (a value copied under
 *   another key is rejected).
 * - `archives` table: encrypted copies of imported batches (pre-SQLite files,
 *   migration from the browser).
 * - `documents` table: vault of original files (statements, tax notices…),
 *   encrypted like the values (npm run base -- coffre).
 * - Master key: 256 random bits in the system keyring (server/trousseau.ts),
 *   never in the project. The file key is derived from it (HKDF): a single key
 *   to back up.
 * - Backup: before the first write of the day, copy of the database (hence
 *   encrypted) in `historique/budget-YYYY-MM-DD.db`, 14 days kept.
 * - Restore points: snapshots of every value, encrypted, in the `points` table (before an import, a
 *   bulk edit, an AI action, a restore, once a day, or on demand); going back replaces the values in
 *   one transaction after the snapshot was decrypted and checked, and saves the current state first.
 *   Grandfather-father-son retention (restorePoints.ts).
 * - Permissions: folder 0700, database and backups 0600.
 */

export const DATA_STORE_FILE = 'budget.db';
const KEY_RE = /^budget:[a-z0-9-]{1,80}$/;
/** Secrets: never in the database (Kraken keys: keyring; AI token: browser). */
export const SECRET_KEYS: ReadonlySet<string> = new Set(['budget:kraken-keys', 'budget:ia-config']);
const HISTORY_DAYS = 14;
/** Value format byte: 1 = raw deflate then AES-256-GCM. */
const FORMAT = 1;
const HEADER_SIZE = 1 + 12 + 16;
const MAX_PLAINTEXT = 256 * 1024 * 1024;
const CANARY = 'budget-fintech';
const BACKUP_RE = /^budget-\d{4}-\d{2}-\d{2}\.db$/;
/** Former data files (storage before SQLite). */
const LEGACY_FILE_RE = /^([a-z0-9-]{1,80})\.(json|txt)(\.tmp)?$/;
/** Header of a NON-encrypted SQLite file (database before SQLCipher). */
const PLAINTEXT_HEADER = Buffer.from('SQLite format 3\0', 'latin1');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
	cle TEXT PRIMARY KEY,
	valeur ANY NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS donnees (
	cle TEXT PRIMARY KEY CHECK (substr(cle, 1, 7) = 'budget:'),
	valeur BLOB NOT NULL, -- chiffrée (AES-256-GCM)
	modifie_le TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS archives (
	id INTEGER PRIMARY KEY,
	origine TEXT NOT NULL,
	cree_le TEXT NOT NULL,
	contenu BLOB NOT NULL -- chiffré : { clé: valeur brute }
) STRICT;
CREATE TABLE IF NOT EXISTS documents (
	nom TEXT PRIMARY KEY, -- chemin relatif au projet (ex. impot/avis-2025.pdf)
	contenu BLOB NOT NULL, -- chiffré (AES-256-GCM)
	octets INTEGER NOT NULL,
	ajoute_le TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS points (
	id INTEGER PRIMARY KEY,
	cree_le TEXT NOT NULL,
	raison TEXT NOT NULL,
	octets INTEGER NOT NULL,
	contenu BLOB NOT NULL -- chiffré : { clé: valeur }
) STRICT;
PRAGMA user_version = 3;
`;

type Db = Database.Database;

/**
 * Write refused: the data changed since the tab read it (another tab,
 * another window). Without this check, a tab left open with an old copy would
 * silently overwrite changes made elsewhere.
 */
export class VersionConflict extends Error {
	readonly actuelle: string | null;
	constructor(key: string, current: string | null) {
		super(`${key} a été modifiée ailleurs (autre onglet) : recharge la page.`);
		this.actuelle = current;
	}
}

let lastTimestamp = 0;
/** Write version: strictly increasing ISO timestamp (two writes in the same ms stay distinct). */
function nextTimestamp(): string {
	lastTimestamp = Math.max(Date.now(), lastTimestamp + 1);
	return new Date(lastTimestamp).toISOString();
}

/** Key accepted by the database: an app key, secrets excluded. */
export function isAllowedKey(key: string): boolean {
	return KEY_RE.test(key) && !SECRET_KEYS.has(key);
}

/* ---------- Value encryption ---------- */

/** Bytes → encrypted bytes (format | iv | tag | data), `context` authenticated. */
export function encryptBytes(key: Buffer, context: string, plaintext: Buffer): Buffer {
	const iv = randomBytes(12);
	const c = createCipheriv('aes-256-gcm', key, iv);
	c.setAAD(Buffer.from(context, 'utf8'));
	const ciphertext = Buffer.concat([c.update(deflateRawSync(plaintext)), c.final()]);
	return Buffer.concat([Buffer.from([FORMAT]), iv, c.getAuthTag(), ciphertext]);
}

/**
 * Inverse of `encryptBytes`; throws when the key, the context or the bytes do not match.
 * final() checks authenticity BEFORE any decompression.
 */
export function decryptBytes(key: Buffer, context: string, bytes: Uint8Array): Buffer {
	const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (b.length < HEADER_SIZE || b[0] !== FORMAT) throw new Error('format de valeur inconnu');
	const d = createDecipheriv('aes-256-gcm', key, b.subarray(1, 13));
	d.setAAD(Buffer.from(context, 'utf8'));
	d.setAuthTag(b.subarray(13, HEADER_SIZE));
	const zip = Buffer.concat([d.update(b.subarray(HEADER_SIZE)), d.final()]);
	return inflateRawSync(zip, { maxOutputLength: MAX_PLAINTEXT });
}

export const encrypt = (key: Buffer, context: string, text: string): Buffer => encryptBytes(key, context, Buffer.from(text, 'utf8'));
export const decrypt = (key: Buffer, context: string, bytes: Uint8Array): string => decryptBytes(key, context, bytes).toString('utf8');

/** Accepted document name: relative path, without « .. » or NUL character. */
export function isValidDocumentName(name: string): boolean {
	return name.length > 0 && name.length <= 300 && !name.includes('\0') && !name.startsWith('/') && !name.split('/').some((p) => p === '' || p === '.' || p === '..');
}

/* ---------- File encryption (SQLCipher) ---------- */

/** SQLCipher key derived from the master key (separate from the value key). */
export function fileKey(masterKey: Buffer): Buffer {
	return Buffer.from(hkdfSync('sha256', masterKey, Buffer.alloc(0), 'budget-fintech:sqlcipher', 32));
}

/** Call on every connection, before any read. Raw key: no slow derivation. */
function unlock(db: Db, key: Buffer): void {
	db.pragma(`cipher = 'sqlcipher'`);
	db.pragma('legacy = 4');
	db.pragma(`key = "x'${key.toString('hex')}'"`);
}

type FileState = 'absent' | 'vide' | 'clair' | 'chiffre';

function fileState(file: string): FileState {
	if (!existsSync(file)) return 'absent';
	if (statSync(file).size === 0) return 'vide';
	const header = Buffer.alloc(16);
	const fd = openSync(file, 'r');
	try {
		readSync(fd, header, 0, 16, 0);
	} finally {
		closeSync(fd);
	}
	return header.equals(PLAINTEXT_HEADER) ? 'clair' : 'chiffre';
}

/**
 * Encrypts a plaintext SQLite file (database before SQLCipher, or its
 * backups): encrypts a COPY, checks it, then replaces atomically. The original
 * is never modified in place.
 */
export function encryptFile(file: string, key: Buffer): void {
	const copy = `${file}.chiffrement`;
	rmSync(copy, { force: true });
	copyFileSync(file, copy);
	chmodSync(copy, 0o600);
	try {
		const db = new Database(copy);
		try {
			const before = (db.prepare('SELECT count(*) AS n FROM sqlite_master').get() as { n: number }).n;
			db.pragma(`cipher = 'sqlcipher'`);
			db.pragma('legacy = 4');
			db.pragma(`rekey = "x'${key.toString('hex')}'"`);
			db.close();
			if (fileState(copy) !== 'chiffre') throw new Error('copie toujours en clair');
			const checkDb = new Database(copy, { readonly: true, fileMustExist: true });
			try {
				unlock(checkDb, key);
				const after = (checkDb.prepare('SELECT count(*) AS n FROM sqlite_master').get() as { n: number }).n;
				if (after !== before) throw new Error('structure différente après chiffrement');
				const integrity = String(checkDb.pragma('integrity_check', { simple: true }));
				if (integrity !== 'ok') throw new Error(`intégrité : ${integrity}`);
			} finally {
				checkDb.close();
			}
		} finally {
			if (db.open) db.close();
		}
		renameSync(copy, file);
	} catch (e) {
		rmSync(copy, { force: true });
		throw new Error(`Chiffrement de ${file} impossible (fichier d'origine intact) : ${e instanceof Error ? e.message : String(e)}`);
	}
}

/* ---------- Master key (system keyring) ---------- */

const keyringEntry = (name: string) => ({ base: name });

/** Master key stored in the keyring; null when missing. */
export async function readKeyringKey(name: string): Promise<Buffer | null> {
	const raw = await readSecret(keyringEntry(name));
	if (raw === null) return null;
	const key = Buffer.from(raw, 'base64');
	if (key.length !== 32) throw new Error(`Clé du trousseau invalide (entrée « ${name} »).`);
	return key;
}

/** Stores the master key in the keyring (read back to check it). */
export async function saveKeyringKey(name: string, key: Buffer): Promise<void> {
	await writeSecret(`Budget FinTech — clé de chiffrement des données (${name})`, keyringEntry(name), key.toString('base64'));
}

/* ---------- Former files (storage before SQLite) ---------- */

/** `xxx.json` / `xxx.txt` files of a folder → { key: raw value }. Throws on an unreadable file. */
export function readLegacyFiles(dir: string): Record<string, string> {
	const data: Record<string, string> = {};
	if (!existsSync(dir)) return data;
	for (const name of readdirSync(dir).sort()) {
		const m = LEGACY_FILE_RE.exec(name);
		if (!m || m[3]) continue;
		const content = readFileSync(join(dir, name), 'utf8');
		try {
			data[`budget:${m[1]}`] = m[2] === 'json' ? JSON.stringify(JSON.parse(content)) : content;
		} catch {
			throw new Error(`Fichier illisible : ${join(dir, name)}`);
		}
	}
	return data;
}

/* ---------- Database ---------- */

export interface Migration {
	/** Keys imported from the files. */
	cles: number;
	/** Archived batches (files + former history folders). */
	archives: number;
	/** Folder where the plaintext files were moved. */
	dossier: string;
}

export interface DataStoreState {
	fichier: string;
	/** Whole file encrypted (SQLCipher)? */
	fichierChiffre: boolean;
	cles: { cle: string; octets: number; modifie_le: string }[];
	archives: { id: number; origine: string; cree_le: string; octets: number }[];
	documents: { nom: string; octets: number; ajoute_le: string }[];
	sauvegardes: string[];
	integrite: string;
}

export interface DataStore {
	readonly fichier: string;
	/** Migration of the former JSON files done on opening (null otherwise). */
	readonly migration: Migration | null;
	/** Files encrypted on opening (database before SQLCipher and its backups), 0 otherwise. */
	readonly fichiersChiffres: number;
	lireTout(): Record<string, string>;
	/** Version (timestamp) of each key, for the concurrent-write check. */
	versions(): Record<string, string>;
	/**
	 * Writes a key; returns its new version. `expectedVersion` (null = key
	 * missing): refused with VersionConflict when the key changed in the meantime.
	 */
	ecrire(key: string, value: string, expectedVersion?: string | null): string;
	supprimer(key: string, expectedVersion?: string | null): void;
	/** Writes a batch (and archives it as is); returns the number of keys written. */
	importer(batch: Record<string, unknown>, origin: string): number;
	lireArchive(id: number): Record<string, string>;
	/** Stores (or replaces) an original file in the encrypted vault. */
	ajouterDocument(name: string, content: Buffer): void;
	lireDocument(name: string): Buffer | null;
	etat(): DataStoreState;
	/** Takes a restore point of every value now (reason shown in the history); null when there is no data yet. */
	creerPoint(raison: string): PointInfo | null;
	/** Restore points, newest first. */
	points(): PointInfo[];
	/** Values of a restore point, decrypted and checked (throws when unreadable). */
	lirePoint(id: number): Record<string, string>;
	/**
	 * Goes back to a restore point: decrypted and checked first (the database is untouched on any
	 * error), the current state is saved as a new point, then every value is replaced in one
	 * transaction. Returns the point that holds the state before going back.
	 */
	restaurerPoint(id: number): PointInfo;
	fermer(): void;
}

export interface DataStoreOptions {
	/** Master key given directly (tests); otherwise the keyring one. */
	cle?: Buffer;
	/** Keyring entry (default: BUDGET_DB_NOM or « principale »). */
	nom?: string;
	/** Read-only (command-line tool): no creation, no migration, no backup. */
	lectureSeule?: boolean;
}

type Row = { cle: string; valeur: Uint8Array };

function localDay(d = new Date()): string {
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function listBackups(dir: string): string[] {
	const hist = join(dir, 'historique');
	return existsSync(hist) ? readdirSync(hist).filter((n) => BACKUP_RE.test(n)).sort() : [];
}

function transaction<T>(db: Db, f: () => T): T {
	db.exec('BEGIN IMMEDIATE');
	try {
		const r = f();
		db.exec('COMMIT');
		return r;
	} catch (e) {
		db.exec('ROLLBACK');
		throw e;
	}
}

/**
 * Decrypts every value. An unreadable value is never ignored silently: the app
 * would rewrite the key with default values.
 */
function readAll(db: Db, key: Buffer): Record<string, string> {
	const data: Record<string, string> = {};
	for (const r of db.prepare('SELECT cle, valeur FROM donnees ORDER BY cle').all() as Row[]) {
		try {
			data[r.cle] = decrypt(key, r.cle, r.valeur);
		} catch {
			throw new Error(`Valeur illisible pour ${r.cle} (base altérée ?) : restaure une sauvegarde de historique/.`);
		}
	}
	return data;
}

/**
 * Opens (or creates) the database of folder `dir`. On the way, once:
 * - database before SQLCipher (plaintext file) and its backups → encrypted
 *   (in read-only mode, such a database is read as is);
 * - former `donnees/*.json|txt` files → imported, checked, then moved to
 *   `avant-sqlite-<timestamp>/` (encrypted copy kept as an archive).
 */
export async function openDataStore(dir: string, options: DataStoreOptions = {}): Promise<DataStore> {
	const file = join(dir, DATA_STORE_FILE);
	const readOnly = options.lectureSeule === true;
	let state = fileState(file);
	if (readOnly && (state === 'absent' || state === 'vide')) throw new Error(`Base introuvable : ${file}`);
	if (!readOnly) {
		mkdirSync(dir, { recursive: true, mode: 0o700 });
		chmodSync(dir, 0o700);
	}

	const name = options.nom ?? process.env.BUDGET_DB_NOM ?? 'principale';
	let key = options.cle ?? (await readKeyringKey(name));
	if (!key) {
		if (state === 'clair' || state === 'chiffre') throw new Error(`Clé introuvable dans le trousseau (entrée « ${name} ») : ${file} ne peut pas être déchiffrée. Restaure-la : npm run base -- restaurer-cle`);
		if (listBackups(dir).length) throw new Error(`Clé introuvable dans le trousseau alors que des sauvegardes existent dans ${join(dir, 'historique')} : aucune nouvelle clé créée. Restaure-la : npm run base -- restaurer-cle`);
		if (readOnly) throw new Error(`Base vide et sans clé : ${file}`);
		key = randomBytes(32);
		await saveKeyringKey(name, key);
	}
	const sqlcipherKey = fileKey(key);

	let encryptedFiles = 0;
	if (state === 'clair' && !readOnly) {
		checkPlaintextCanary(file, key, name);
		encryptFile(file, sqlcipherKey);
		encryptedFiles++;
		state = 'chiffre';
	}
	if (!readOnly) {
		for (const backupName of listBackups(dir)) {
			const s = join(dir, 'historique', backupName);
			if (fileState(s) !== 'clair') continue;
			try {
				encryptFile(s, sqlcipherKey);
				encryptedFiles++;
			} catch (e) {
				console.error(`[donnees] ${e instanceof Error ? e.message : String(e)}`);
			}
		}
		if (state === 'absent') writeFileSync(file, '', { mode: 0o600, flag: 'wx' });
		chmodSync(file, 0o600);
	}

	const db = new Database(file, { readonly: readOnly, fileMustExist: readOnly, timeout: 5000 });
	try {
		if (state !== 'clair') unlock(db, sqlcipherKey);
		try {
			db.prepare('SELECT count(*) FROM sqlite_master').get();
		} catch {
			throw new Error(`Clé incorrecte : ${file} ne se déchiffre pas avec la clé du trousseau (entrée « ${name} »).`);
		}
		if (!readOnly) {
			db.pragma('synchronous = FULL');
			db.exec(SCHEMA);
		}
		const canary = (db.prepare(`SELECT valeur FROM meta WHERE cle = 'temoin'`).get() as { valeur: Uint8Array } | undefined)?.valeur;
		if (canary) {
			if (!isValidCanary(key, canary)) throw new Error(`Clé incorrecte : ${file} ne se déchiffre pas avec la clé du trousseau (entrée « ${name} »).`);
		} else if (readOnly) {
			throw new Error(`Base non initialisée : ${file}`);
		} else {
			const ins = db.prepare('INSERT INTO meta (cle, valeur) VALUES (?, ?)');
			ins.run('temoin', encrypt(key, 'meta:temoin', CANARY));
			ins.run('cree_le', new Date().toISOString());
		}
		return createStore(db, key, dir, file, readOnly, encryptedFiles);
	} catch (e) {
		db.close();
		throw e;
	}
}

function isValidCanary(key: Buffer, canary: Uint8Array): boolean {
	try {
		return decrypt(key, 'meta:temoin', canary) === CANARY;
	} catch {
		return false;
	}
}

/** Before encrypting a plaintext database: it must belong to this key (otherwise nothing is touched). */
function checkPlaintextCanary(file: string, key: Buffer, name: string): void {
	const db = new Database(file, { readonly: true, fileMustExist: true });
	try {
		const canary = (db.prepare(`SELECT valeur FROM meta WHERE cle = 'temoin'`).get() as { valeur: Uint8Array } | undefined)?.valeur;
		if (canary && !isValidCanary(key, canary)) throw new Error(`Clé incorrecte : ${file} ne se déchiffre pas avec la clé du trousseau (entrée « ${name} »).`);
	} finally {
		db.close();
	}
}

/**
 * Database handle over an open connection. Before the first write of the day,
 * the (encrypted) file is copied to historique/ under a write lock (no write
 * during the copy), 14 days kept; a failed backup does not block the write but
 * is reported in the terminal.
 */
function createStore(db: Db, key: Buffer, dir: string, file: string, readOnly: boolean, encryptedFiles: number): DataStore {
	const writeRow = (k: string, v: string, when: string) =>
		db
			.prepare('INSERT INTO donnees (cle, valeur, modifie_le) VALUES (?, ?, ?) ON CONFLICT (cle) DO UPDATE SET valeur = excluded.valeur, modifie_le = excluded.modifie_le')
			.run(k, encrypt(key, k, v), when);
	const archiveBatch = (origin: string, content: Record<string, string>, when: string) =>
		db.prepare('INSERT INTO archives (origine, cree_le, contenu) VALUES (?, ?, ?)').run(origin, when, encrypt(key, 'archive', JSON.stringify(content)));
	const assertWritable = () => {
		if (readOnly) throw new Error('base ouverte en lecture seule');
	};
	const versionOf = (k: string): string | null => (db.prepare('SELECT modifie_le FROM donnees WHERE cle = ?').get(k) as { modifie_le: string } | undefined)?.modifie_le ?? null;
	const checkVersion = (k: string, expected: string | null | undefined) => {
		if (expected === undefined) return;
		const current = versionOf(k);
		if (current !== expected) throw new VersionConflict(k, current);
	};
	const checkKey = (k: string) => {
		if (!isAllowedKey(k)) throw new Error(`clé refusée : ${k}`);
	};

	const listPoints = (): PointInfo[] => db.prepare('SELECT id, cree_le, raison, octets FROM points ORDER BY id DESC').all() as PointInfo[];
	const insertPoint = (reason: string, data: Record<string, string>): PointInfo => {
		const when = new Date().toISOString();
		const blob = encrypt(key, 'point', JSON.stringify(data));
		const raison = reason.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 200) || 'point manuel';
		const r = db.prepare('INSERT INTO points (cree_le, raison, octets, contenu) VALUES (?, ?, ?, ?)').run(when, raison, blob.length, blob);
		return { id: Number(r.lastInsertRowid), cree_le: when, raison, octets: blob.length };
	};
	const prunePoints = () => {
		const keep = pointsToKeep(listPoints(), Date.now());
		for (const p of listPoints()) if (!keep.has(p.id)) db.prepare('DELETE FROM points WHERE id = ?').run(p.id);
	};
	const hasData = () => !!db.prepare('SELECT 1 FROM donnees LIMIT 1').get();
	const takePoint = (reason: string): PointInfo | null => {
		if (!hasData()) return null;
		const p = transaction(db, () => insertPoint(reason, readAll(db, key)));
		prunePoints();
		return p;
	};
	const readPoint = (id: number): Record<string, string> => {
		const r = db.prepare('SELECT contenu FROM points WHERE id = ?').get(id) as { contenu: Uint8Array } | undefined;
		if (!r) throw new Error(`point de restauration ${id} introuvable`);
		let data: unknown;
		try {
			data = JSON.parse(decrypt(key, 'point', r.contenu));
		} catch {
			throw new Error('Point de restauration illisible (altéré ou chiffré avec une autre clé) : rien n’a été modifié.');
		}
		if (!data || typeof data !== 'object' || Array.isArray(data) || !Object.entries(data).every(([k, v]) => isAllowedKey(k) && typeof v === 'string')) {
			throw new Error('Point de restauration incohérent : rien n’a été modifié.');
		}
		return data as Record<string, string>;
	};

	let backupDay = '';
	const backUpToday = () => {
		const day = localDay();
		if (day === backupDay) return;
		const hist = join(dir, 'historique');
		const target = join(hist, `budget-${day}.db`);
		if (!existsSync(target) && db.prepare('SELECT 1 FROM donnees LIMIT 1').get()) {
			mkdirSync(hist, { recursive: true, mode: 0o700 });
			chmodSync(hist, 0o700);
			const tmp = `${target}.tmp`;
			db.exec('BEGIN IMMEDIATE');
			try {
				copyFileSync(file, tmp);
			} finally {
				db.exec('COMMIT');
			}
			chmodSync(tmp, 0o600);
			renameSync(tmp, target);
			const allBackups = listBackups(dir);
			for (const old of allBackups.slice(0, Math.max(0, allBackups.length - HISTORY_DAYS))) rmSync(join(hist, old), { force: true });
		}
		if (!(db.prepare('SELECT 1 FROM points WHERE substr(cree_le, 1, 10) = ? AND raison = ?').get(new Date().toISOString().slice(0, 10), 'quotidien'))) takePoint('quotidien');
		backupDay = day;
	};
	const tryBackUpToday = () => {
		try {
			backUpToday();
		} catch (e) {
			console.error(`[donnees] sauvegarde du jour impossible : ${e instanceof Error ? e.message : String(e)}`);
		}
	};

	const store: DataStore = {
		fichier: file,
		migration: null,
		fichiersChiffres: encryptedFiles,
		lireTout: () => readAll(db, key),
		versions: () => Object.fromEntries((db.prepare('SELECT cle, modifie_le FROM donnees').all() as { cle: string; modifie_le: string }[]).map((r) => [r.cle, r.modifie_le])),
		ecrire(k, v, expected) {
			assertWritable();
			checkKey(k);
			tryBackUpToday();
			const when = nextTimestamp();
			transaction(db, () => {
				checkVersion(k, expected);
				writeRow(k, v, when);
			});
			return when;
		},
		supprimer(k, expected) {
			assertWritable();
			checkKey(k);
			tryBackUpToday();
			transaction(db, () => {
				checkVersion(k, expected);
				db.prepare('DELETE FROM donnees WHERE cle = ?').run(k);
			});
		},
		importer(batch, origin) {
			assertWritable();
			const entries = Object.entries(batch).filter((e): e is [string, string] => isAllowedKey(e[0]) && typeof e[1] === 'string');
			tryBackUpToday();
			takePoint(`avant import : ${origin}`);
			const when = nextTimestamp();
			transaction(db, () => {
				archiveBatch(origin, Object.fromEntries(entries), when);
				for (const [k, v] of entries) writeRow(k, v, when);
			});
			return entries.length;
		},
		lireArchive(id) {
			const r = db.prepare('SELECT contenu FROM archives WHERE id = ?').get(id) as { contenu: Uint8Array } | undefined;
			if (!r) throw new Error(`archive ${id} introuvable`);
			return JSON.parse(decrypt(key, 'archive', r.contenu)) as Record<string, string>;
		},
		ajouterDocument(name, content) {
			assertWritable();
			if (!isValidDocumentName(name)) throw new Error(`nom de document refusé : ${name}`);
			tryBackUpToday();
			db.prepare(
				'INSERT INTO documents (nom, contenu, octets, ajoute_le) VALUES (?, ?, ?, ?) ON CONFLICT (nom) DO UPDATE SET contenu = excluded.contenu, octets = excluded.octets, ajoute_le = excluded.ajoute_le'
			).run(name, encryptBytes(key, `document:${name}`, content), content.length, new Date().toISOString());
		},
		lireDocument(name) {
			const r = db.prepare('SELECT contenu FROM documents WHERE nom = ?').get(name) as { contenu: Uint8Array } | undefined;
			return r ? decryptBytes(key, `document:${name}`, r.contenu) : null;
		},
		etat() {
			return {
				fichier: file,
				fichierChiffre: fileState(file) === 'chiffre',
				cles: db.prepare('SELECT cle, length(valeur) AS octets, modifie_le FROM donnees ORDER BY cle').all() as DataStoreState['cles'],
				archives: db.prepare('SELECT id, origine, cree_le, length(contenu) AS octets FROM archives ORDER BY id').all() as DataStoreState['archives'],
				documents: db.prepare('SELECT nom, octets, ajoute_le FROM documents ORDER BY nom').all() as DataStoreState['documents'],
				sauvegardes: listBackups(dir),
				integrite: String(db.pragma('integrity_check', { simple: true }))
			};
		},
		creerPoint(raison) {
			assertWritable();
			return takePoint(raison);
		},
		points: () => listPoints(),
		lirePoint: (id) => readPoint(id),
		restaurerPoint(id) {
			assertWritable();
			const data = readPoint(id);
			const point = listPoints().find((p) => p.id === id)!;
			const check = String(db.pragma('quick_check', { simple: true }));
			if (check !== 'ok') throw new Error(`Base en mauvais état (${check}) : retour en arrière refusé, rien n’a été modifié.`);
			const when = nextTimestamp();
			const before = transaction(db, () => {
				const label = new Date(point.cree_le).toLocaleString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
				const saved = insertPoint(`avant retour au point du ${label}`, readAll(db, key));
				db.prepare('DELETE FROM donnees').run();
				for (const [k, v] of Object.entries(data)) writeRow(k, v, when);
				return saved;
			});
			prunePoints();
			return before;
		},
		fermer() {
			if (db.open) db.close();
		}
	};

	if (readOnly) return store;
	return { ...store, migration: migrateLegacyFiles(db, key, dir, writeRow, archiveBatch) };
}

/**
 * One-time import of the former files (database still empty): data +
 * archives of the former history folders, read back and compared INSIDE the
 * transaction (nothing is committed if a byte differs), then the plaintext
 * files are moved to `avant-sqlite-<timestamp>/`. Files written by the old
 * server during the switch are imported afterwards: they are necessarily newer.
 */
function migrateLegacyFiles(
	db: Db,
	key: Buffer,
	dir: string,
	writeRow: (k: string, v: string, when: string) => unknown,
	archiveBatch: (origin: string, content: Record<string, string>, when: string) => unknown
): Migration | null {
	if (db.prepare('SELECT 1 FROM donnees LIMIT 1').get()) return null;
	const files = readLegacyFiles(dir);
	const keys = Object.keys(files);
	if (!keys.length) return null;

	const hist = join(dir, 'historique');
	const batches: { origine: string; contenu: Record<string, string> }[] = [{ origine: 'fichiers donnees/ (avant SQLite)', contenu: files }];
	const folders: string[] = [];
	if (existsSync(hist)) {
		for (const name of readdirSync(hist).sort()) {
			const folderPath = join(hist, name);
			if (!statSync(folderPath).isDirectory()) continue;
			if (/^\d{4}-\d{2}-\d{2}$/.test(name)) batches.push({ origine: `historique/${name}`, contenu: readLegacyFiles(folderPath) });
			else if (name.startsWith('migration-') && existsSync(join(folderPath, 'navigateur.json')))
				batches.push({ origine: `historique/${name}`, contenu: JSON.parse(readFileSync(join(folderPath, 'navigateur.json'), 'utf8')) as Record<string, string> });
			else continue;
			folders.push(name);
		}
	}

	const when = new Date().toISOString();
	transaction(db, () => {
		for (const batch of batches) archiveBatch(batch.origine, batch.contenu, when);
		for (const k of keys) writeRow(k, files[k]!, when);
		const reread = readAll(db, key);
		if (Object.keys(reread).length !== keys.length || keys.some((k) => reread[k] !== files[k])) {
			throw new Error('Migration annulée : la relecture diffère des fichiers (rien n’a été déplacé).');
		}
	});

	const folder = join(dir, `avant-sqlite-${when.replace(/[:.]/g, '-')}`);
	mkdirSync(join(folder, 'historique'), { recursive: true, mode: 0o700 });
	chmodSync(folder, 0o700);
	const moveFiles = (prefix: string) => {
		for (const name of readdirSync(dir)) if (LEGACY_FILE_RE.test(name)) renameSync(join(dir, name), join(folder, prefix + name));
	};
	moveFiles('');
	for (const name of folders) renameSync(join(hist, name), join(folder, 'historique', name));
	const lateFiles = readLegacyFiles(dir);
	if (Object.keys(lateFiles).length) {
		const now = new Date().toISOString();
		transaction(db, () => {
			for (const [k, v] of Object.entries(lateFiles)) writeRow(k, v, now);
		});
		moveFiles('tardif-');
	}
	return { cles: keys.length, archives: batches.length, dossier: folder };
}
