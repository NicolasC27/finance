/**
 * Backup / restore: the whole app state lives in localStorage under the
 * `budget:` prefix. A single JSON file carries everything (another browser,
 * another machine) or restarts after the browser was cleaned.
 */

const PREFIX = 'budget:';
export const BACKUP_VERSION = 1;

/**
 * Secrets never written to a PLAIN backup (a file that ends up in Downloads or
 * on a Drive): Kraken API key + secret. The encrypted auto-backup keeps them;
 * a restore without them keeps the browser's own.
 */
const SECRET_KEYS: ReadonlySet<string> = new Set(['budget:kraken-keys', 'budget:ia-config']);

export interface BackupFile {
	app: 'budget';
	version: number;
	exportedAt: string;
	/** localStorage key → raw value (JSON string as stored). */
	data: Record<string, string>;
}

/** Snapshot of the `budget:*` keys; secrets (API keys) only with `includeSecrets` (encrypted backup). */
export function collectBackup(opts: { includeSecrets?: boolean } = {}): BackupFile {
	const data: Record<string, string> = {};
	if (typeof localStorage !== 'undefined') {
		for (let i = 0; i < localStorage.length; i++) {
			const k = localStorage.key(i);
			if (!k || !k.startsWith(PREFIX)) continue;
			if (!opts.includeSecrets && SECRET_KEYS.has(k)) continue;
			const v = localStorage.getItem(k);
			if (v !== null) data[k] = v;
		}
	}
	return { app: 'budget', version: BACKUP_VERSION, exportedAt: new Date().toISOString(), data };
}

/**
 * Downloads the backup (without API keys); returns the file name and key count.
 * The object URL is revoked later so the download can start (a restore reloads right after).
 */
export function downloadBackup(suffix = ''): { fileName: string; keys: number; bytes: number } {
	const backup = collectBackup();
	const json = JSON.stringify(backup);
	const fileName = `budget-sauvegarde-${backup.exportedAt.slice(0, 10)}${suffix}.json`;
	const blob = new Blob([json], { type: 'application/json' });
	const a = document.createElement('a');
	a.href = URL.createObjectURL(blob);
	a.download = fileName;
	a.click();
	setTimeout(() => URL.revokeObjectURL(a.href), 2000);
	return { fileName, keys: Object.keys(backup.data).length, bytes: json.length };
}

/** Validates a backup file (shape, version). */
export function parseBackup(text: string): BackupFile | { error: string } {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return { error: 'Fichier illisible : ce n’est pas du JSON.' };
	}
	const b = parsed as Partial<BackupFile> | null;
	if (!b || b.app !== 'budget' || typeof b.version !== 'number' || !b.data || typeof b.data !== 'object') {
		return { error: 'Ce fichier n’est pas une sauvegarde de cette application.' };
	}
	if (b.version > BACKUP_VERSION) return { error: `Sauvegarde d’une version plus récente (v${b.version}) : mettez l’application à jour.` };
	const data: Record<string, string> = {};
	for (const [k, v] of Object.entries(b.data)) if (k.startsWith(PREFIX) && typeof v === 'string') data[k] = v;
	if (Object.keys(data).length === 0) return { error: 'Sauvegarde vide.' };
	return { app: 'budget', version: b.version, exportedAt: typeof b.exportedAt === 'string' ? b.exportedAt : '', data };
}

/**
 * Hooks around a restore, plugged by the app (history.svelte.ts): `before` takes a restore point
 * (called synchronously, before the state is replaced), `settle` waits until every write reached
 * the database, so the reload never drops a large value.
 */
let restoreHooks: { before?: () => Promise<unknown>; settle?: () => Promise<void> } = {};

export function setRestoreHooks(h: { before?: () => Promise<unknown>; settle?: () => Promise<void> }): void {
	restoreHooks = h;
}

/**
 * Replaces the WHOLE state with the backup (keys missing from the file are
 * erased, except secrets a plain file never contains), then reloads.
 * Transactional: if a write fails (quota, smaller browser), the original state
 * is written back as is and the error returned — previously the data was
 * already erased when the write crashed.
 */
export function restoreBackup(backup: BackupFile): { error: string } | void {
	if (typeof localStorage === 'undefined') return { error: 'Stockage du navigateur indisponible.' };
	const snapshot: Record<string, string> = {};
	for (let i = 0; i < localStorage.length; i++) {
		const k = localStorage.key(i);
		if (!k || !k.startsWith(PREFIX)) continue;
		const v = localStorage.getItem(k);
		if (v !== null) snapshot[k] = v;
	}
	const keep = (k: string) => SECRET_KEYS.has(k) && !(k in backup.data);
	const point = restoreHooks.before?.();
	try {
		for (const k of Object.keys(snapshot)) if (!keep(k)) localStorage.removeItem(k);
		for (const [k, v] of Object.entries(backup.data)) localStorage.setItem(k, v);
	} catch (e) {
		try {
			for (let i = localStorage.length - 1; i >= 0; i--) {
				const k = localStorage.key(i);
				if (k && k.startsWith(PREFIX)) localStorage.removeItem(k);
			}
			for (const [k, v] of Object.entries(snapshot)) localStorage.setItem(k, v);
		} catch {
		}
		return { error: `Restauration impossible (${e instanceof Error ? e.message : 'écriture refusée'}) : données d'origine conservées.` };
	}
	void Promise.resolve(point)
		.then(() => restoreHooks.settle?.())
		.catch(() => undefined)
		.finally(() => window.location.reload());
}

/**
 * Opens a file picker and restores after confirmation; a copy of the current
 * data is downloaded first, with a short delay so it starts before the reload.
 */
export function pickAndRestore(): void {
	const input = document.createElement('input');
	input.type = 'file';
	input.accept = '.json,application/json';
	input.onchange = async () => {
		const file = input.files?.[0];
		if (!file) return;
		const parsed = parseBackup(await file.text());
		if ('error' in parsed) {
			window.alert(parsed.error);
			return;
		}
		const when = parsed.exportedAt ? new Date(parsed.exportedAt).toLocaleString('fr-FR') : 'date inconnue';
		const n = Object.keys(parsed.data).length;
		if (
			window.confirm(
				`Restaurer la sauvegarde du ${when} (${n} enregistrement${n > 1 ? 's' : ''}) ? Les données actuelles seront remplacées — une copie en est d'abord téléchargée.`
			)
		) {
			downloadBackup('-avant-restauration');
			setTimeout(() => {
				const res = restoreBackup(parsed);
				if (res) window.alert(res.error);
			}, 500);
		}
	};
	input.click();
}
