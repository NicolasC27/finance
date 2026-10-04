import { warnPersistFailure } from './storage';

/**
 * App data in the PROJECT DATABASE (`donnees/budget.db`, encrypted SQLite,
 * through the vite-plugin-donnees.ts plugin) instead of localStorage.
 *
 * At startup, BEFORE loading the app (main.ts):
 * 1. read every data key (GET /__data);
 * 2. one-time migration: empty database + data in the browser → send the
 *    batch, read it back and compare key by key, and ONLY if everything is
 *    identical, erase the browser copy;
 * 3. `window.localStorage` is replaced by an in-memory storage whose every
 *    write goes to the database (grouped per key, ~300 ms). App code keeps
 *    calling `localStorage` without knowing about the database.
 *
 * Kraken API keys: moved once to the system keyring (the server signs the
 * calls), then erased from the browser. What stays in the browser: the AI
 * relay token and a copy of the theme (no flash before loading). Without a
 * data server (static hosting, old server), everything stays in the browser
 * as before. Server present but database unreachable (locked keyring, access
 * refused…) → 'erreur' mode: the app doesn't start, nothing is written
 * elsewhere.
 *
 * Several tabs: each keeps its copy. Every write carries the version it read;
 * if the data changed elsewhere, the server refuses (409) instead of
 * overwriting, and the tab offers to reload. A background tab whose data
 * changed reloads as soon as it comes back into view.
 */

const ENDPOINT = '/__data';
const HEADERS = { 'x-budget-data': '1' };
const PREFIX = 'budget:';
/** Secrets: never written to the database. */
const SECRET_KEYS: ReadonlySet<string> = new Set(['budget:kraken-keys', 'budget:ia-config']);
/** Former browser Kraken keys, to move to the keyring. */
const KRAKEN_KEYS = 'budget:kraken-keys';
/** Also copied to the browser (anti-flash script in index.html). */
const MIRROR_KEYS: ReadonlySet<string> = new Set(['budget:theme']);
const WRITE_DELAY_MS = 300;
const RETRY_MS = 5000;

export const diskState = {
	/**
	 * 'disk': data in the database; 'browser': localStorage fallback (no data
	 * server); 'erreur': database unreachable, the app doesn't start.
	 */
	mode: 'browser' as 'disk' | 'browser' | 'erreur',
	/** Server-side database path (display). */
	dir: '',
	/** Number of keys migrated from the browser at this startup (0 otherwise). */
	migrated: 0,
	/** Reason when the database is unreachable ('erreur' mode). */
	erreur: '',
	/** Secrets stored server side (keyring): never their value, only their presence. */
	secrets: { kraken: false }
};

/** Equality of two raw values (semantic for JSON). */
function sameValue(a: string | undefined, b: string | undefined): boolean {
	if (a === b) return true;
	if (a === undefined || b === undefined) return false;
	try {
		return JSON.stringify(JSON.parse(a)) === JSON.stringify(JSON.parse(b));
	} catch {
		return false;
	}
}

/** « Changed in another tab » warnings (shown by main.ts). */
let onConflict: ((key: string) => void) | null = null;
let onStale: (() => void) | null = null;
export function onChangesElsewhere(h: { conflit: (key: string) => void; perime: () => void }): void {
	onConflict = h.conflit;
	onStale = h.perime;
}

/** Channel between tabs, opened in the browser only (under Node it would keep the process alive). */
let channel: BroadcastChannel | null = null;

class DiskStorage {
	private dirty = new Set<string>();
	private timer: ReturnType<typeof setTimeout> | null = null;
	/** Pending sends: a write waits for the previous one (otherwise a false conflict with itself). */
	private file: Promise<void> = Promise.resolve();
	private conflits = new Set<string>();

	constructor(
		private mem: Map<string, string>,
		private real: Storage,
		/** Server version of each key (null: missing); null = server without version control. */
		private versions: Map<string, string | null> | null
	) {
		document.addEventListener('visibilitychange', () => {
			if (document.visibilityState === 'hidden') void this.flush();
		});
		window.addEventListener('pagehide', () => void this.flush(true));
	}

	private onDisk(key: string): boolean {
		return key.startsWith(PREFIX) && !SECRET_KEYS.has(key);
	}

	private allKeys(): string[] {
		const keys = [...this.mem.keys()];
		for (let i = 0; i < this.real.length; i++) {
			const k = this.real.key(i);
			if (k && !this.onDisk(k) && !keys.includes(k)) keys.push(k);
		}
		return keys;
	}

	get length(): number {
		return this.allKeys().length;
	}

	key(index: number): string | null {
		return this.allKeys()[index] ?? null;
	}

	getItem(key: string): string | null {
		if (!this.onDisk(key)) return this.real.getItem(key);
		return this.mem.get(key) ?? null;
	}

	setItem(key: string, value: string): void {
		if (!this.onDisk(key)) return this.real.setItem(key, value);
		this.mem.set(key, String(value));
		if (MIRROR_KEYS.has(key)) this.real.setItem(key, String(value));
		this.schedule(key);
	}

	removeItem(key: string): void {
		if (!this.onDisk(key)) return this.real.removeItem(key);
		this.mem.delete(key);
		if (MIRROR_KEYS.has(key)) this.real.removeItem(key);
		this.schedule(key);
	}

	clear(): void {
		for (const k of this.allKeys()) this.removeItem(k);
	}

	private schedule(key: string): void {
		this.dirty.add(key);
		if (this.timer) clearTimeout(this.timer);
		this.timer = setTimeout(() => void this.flush(), WRITE_DELAY_MS);
	}

	/** Sends the changed keys after the pending sends (when the page is leaving: immediately). */
	flush(keepalive = false): Promise<void> {
		if (keepalive) return this.envoyer(true);
		this.file = this.file.then(() => this.envoyer(false));
		return this.file;
	}

	/**
	 * On a network failure the keys stay queued (retry in 5 s); a conflict is
	 * never resent: a 409 means the key changed in another tab, nothing is
	 * overwritten and the user reloads. keepalive is only used for small values
	 * (browser limit ~64 KB).
	 */
	private async envoyer(keepalive: boolean): Promise<void> {
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = null;
		}
		const keys = [...this.dirty];
		this.dirty.clear();
		let failed = false;
		const written: string[] = [];
		await Promise.all(
			keys.map(async (key) => {
				const value = this.mem.get(key);
				const headers: Record<string, string> = { ...HEADERS, 'content-type': 'text/plain;charset=utf-8' };
				if (this.versions) headers['x-budget-version'] = this.versions.get(key) ?? '';
				try {
					const res = await fetch(`${ENDPOINT}/${encodeURIComponent(key)}`, {
						method: value === undefined ? 'DELETE' : 'PUT',
						headers,
						body: value,
						keepalive: keepalive && (value?.length ?? 0) < 60_000
					});
					if (res.status === 409) {
						if (!this.conflits.has(key)) onConflict?.(key);
						this.conflits.add(key);
						return;
					}
					if (!res.ok) throw new Error(String(res.status));
					if (this.versions && !keepalive) {
						const body = (await res.json().catch(() => ({}))) as { version?: unknown };
						this.versions.set(key, typeof body.version === 'string' ? body.version : null);
					}
					written.push(key);
				} catch {
					this.dirty.add(key);
					failed = true;
				}
			})
		);
		if (written.length) channel?.postMessage({ type: 'ecrit', keys: written });
		if (failed) {
			warnPersistFailure();
			if (!this.timer) this.timer = setTimeout(() => void this.flush(), RETRY_MS);
		}
	}
}

/** Listens to the other tabs' writes: this copy becomes stale, and a background tab reloads (fresh data) as soon as it comes back. */
function watchOtherTabs(): void {
	if (typeof BroadcastChannel === 'undefined') return;
	channel = new BroadcastChannel('budget-donnees');
	let stale = false;
	channel.addEventListener('message', (e: MessageEvent) => {
		if ((e.data as { type?: string } | null)?.type !== 'ecrit') return;
		if (!stale && document.visibilityState === 'visible') onStale?.();
		stale = true;
	});
	document.addEventListener('visibilitychange', () => {
		if (stale && document.visibilityState === 'visible') location.reload();
	});
}

/** `budget:` keys present in a Storage. */
function budgetKeys(store: Storage): string[] {
	const keys: string[] = [];
	for (let i = 0; i < store.length; i++) {
		const k = store.key(i);
		if (k && k.startsWith(PREFIX)) keys.push(k);
	}
	return keys;
}

type ReadResult = { dir: string; data: Record<string, string>; versions: Record<string, string> | null; secrets: { kraken: boolean } } | { erreur: string } | null;

/** null: no data server (including an HTML page from static hosting or an old server); { erreur }: server present but database unreachable. */
async function fetchAll(): Promise<ReadResult> {
	let res: Response;
	try {
		res = await fetch(ENDPOINT, { headers: HEADERS, cache: 'no-store' });
	} catch {
		return null;
	}
	if (res.status === 404) return null;
	type ResponseBody = { dir?: string; data?: Record<string, string>; versions?: Record<string, string>; secrets?: { kraken?: boolean }; error?: string; message?: string };
	let body: ResponseBody | null;
	try {
		body = (await res.json()) as ResponseBody | null;
	} catch {
		return res.ok ? null : { erreur: `réponse ${res.status} du serveur` };
	}
	if (!res.ok) return { erreur: body?.message ?? body?.error ?? `erreur ${res.status}` };
	return body && typeof body.data === 'object'
		? { dir: body.dir ?? '', data: body.data, versions: body.versions && typeof body.versions === 'object' ? body.versions : null, secrets: { kraken: body.secrets?.kraken === true } }
		: null;
}

/**
 * Former browser Kraken keys → system keyring (through the server), then
 * erased from the browser. On failure (server or keyring unavailable) nothing
 * is erased: retried at the next load.
 */
async function migrateKrakenKeys(real: Storage): Promise<void> {
	const raw = real.getItem(KRAKEN_KEYS);
	if (!raw) return;
	try {
		const keys = JSON.parse(raw) as { key?: unknown; secret?: unknown };
		const res = await fetch('/__secrets/kraken', {
			method: 'PUT',
			headers: { ...HEADERS, 'content-type': 'application/json' },
			body: JSON.stringify({ key: keys.key, secret: keys.secret, tester: false })
		});
		if (!res.ok) return;
		real.removeItem(KRAKEN_KEYS);
		diskState.secrets.kraken = true;
	} catch {
	}
}

/**
 * Call once, before the app loads (main.ts). Without a data server the browser
 * stays the storage. The one-time migration from the browser (database
 * without app data) erases nothing on failure, and checks BEFORE erasing by
 * reading back and comparing key by key.
 */
export async function initDiskStorage(): Promise<void> {
	if (typeof window === 'undefined' || typeof localStorage === 'undefined') return;
	const real = window.localStorage;
	const disk = await fetchAll();
	if (!disk) return;
	if ('erreur' in disk) {
		diskState.mode = 'erreur';
		diskState.erreur = disk.erreur;
		return;
	}
	const mem = new Map(Object.entries(disk.data));
	let versions: Map<string, string | null> | null = disk.versions ? new Map(Object.entries(disk.versions)) : null;
	diskState.secrets.kraken = disk.secrets.kraken;
	await migrateKrakenKeys(real);

	const diskHasData = [...mem.keys()].some((k) => !MIRROR_KEYS.has(k));
	const local = budgetKeys(real).filter((k) => !SECRET_KEYS.has(k));
	if (!diskHasData && local.some((k) => !MIRROR_KEYS.has(k))) {
		const payload: Record<string, string> = {};
		for (const k of local) payload[k] = real.getItem(k) ?? '';
		try {
			const res = await fetch(`${ENDPOINT}/import`, {
				method: 'POST',
				headers: { ...HEADERS, 'content-type': 'application/json' },
				body: JSON.stringify({ data: payload })
			});
			if (!res.ok) return;
		} catch {
			return;
		}
		const check = await fetchAll();
		if (!check || 'erreur' in check || !local.every((k) => sameValue(check.data[k], payload[k]))) return;
		for (const k of local) {
			mem.set(k, payload[k]!);
			if (!MIRROR_KEYS.has(k)) real.removeItem(k);
		}
		if (check.versions) versions = new Map(Object.entries(check.versions));
		diskState.migrated = local.length;
	}

	const store = new DiskStorage(mem, real, versions);
	watchOtherTabs();
	Object.defineProperty(window, 'localStorage', { configurable: true, get: () => store });
	diskState.mode = 'disk';
	diskState.dir = disk.dir;
}
