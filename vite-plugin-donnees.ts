import type { Plugin, Connect, Logger, ViteDevServer, PreviewServer } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { isAllowedKey, VersionConflict, DATA_STORE_FILE, isValidDocumentName, openDataStore, type DataStore } from './server/base.ts';
import { accessRefusal } from './server/acces.ts';
import { privateCall, areValidKeys, deleteKrakenKeys, saveKrakenKeys, readKrakenKeys } from './server/kraken.ts';
import { cleanCoordinates, dailyAt, searchPlaces, weatherAt } from './server/weather.ts';
import { cleanWidth, findPhoto, photoBytes } from './server/photo.ts';
import { geocode, tileBytes } from './server/geo.ts';
import { cleanQuery, QUERY_RULE } from './src/lib/weather.ts';
import { isPhotoFile } from './src/lib/photo.ts';
import { cleanCountryCode, cleanGeoQuery, cleanTile } from './src/lib/geo.ts';

/**
 * Local app server: data in an ENCRYPTED SQLITE DATABASE (server/base.ts)
 * and Kraken private calls signed on the server (server/kraken.ts), for the
 * browser (src/lib/diskStorage.ts, kraken.ts).
 *
 *   GET    /__data                 → { dir, data: { key: raw value }, versions: { key: version }, secrets: { kraken } }
 *   PUT    /__data/<key>           → writes the value (body = raw string) → { version }
 *   DELETE /__data/<key>           → deletes the key
 *     (x-budget-version header = version read by the tab, empty when the key is missing:
 *      409 when the data changed elsewhere in the meantime, never silently overwritten)
 *   POST   /__data/import          → writes a batch { data } (migration from the browser)
 *   POST   /__data/documents?nom=vehicules/… → stores a document (body = bytes) in the encrypted vault
 *   PUT    /__secrets/kraken       → { key, secret, tester? }: tested (Balance) then stored in the keyring
 *   DELETE /__secrets/kraken       → forgets the keys
 *   POST   /__kraken/<Method>      → { params, cles? }: signed private call (Balance, Ledgers)
 *   GET    /__weather/places?q=    → places matching a town name (Open-Meteo geocoding)
 *   GET    /__weather?lat=&lon=     → current weather and the day's range (Open-Meteo, cached 20 min)
 *   GET    /__weather/daily?lat=&lon= → 16-day forecast, { daily: [{ date, code, max, min, precipitation }] } (cached an hour)
 *   GET    /__photo?q=              → Wikivoyage banner of a place, { photo: { file, kind } | null } (Wikidata, cached a day)
 *   GET    /__photo/file?f=&w=      → that Wikimedia Commons file at width 480 or 1600 (image bytes, cached)
 *   GET    /__geo?q=&near=&cc=      → coordinates of a place of a day plan, { hit: { lat, lon, label } | null } (Nominatim, cached a day)
 *   GET    /__tile?s=&l=&z=&x=&y=   → a basemap tile, light or dark, base drawing or labels (Esri gray canvas, image bytes, cached)
 *
 * Access: local app only (server/acces.ts). The Kraken secret key never goes
 * back to the browser. Database unavailable (locked keyring, missing key…)
 * → 503 with the reason: the app shows it instead of falling back to the
 * browser.
 */

const MAX_BODY = 60 * 1024 * 1024;
const MAX_JSON = 64 * 1024;
const MAX_DOCUMENT = 30 * 1024 * 1024;

function readBody(req: IncomingMessage, max = MAX_BODY): Promise<string> {
	return readBytes(req, max).then((b) => b.toString('utf8'));
}

function readBytes(req: IncomingMessage, max = MAX_BODY): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		let size = 0;
		const chunks: Buffer[] = [];
		req.on('data', (c: Buffer) => {
			size += c.length;
			if (size > max) {
				reject(new Error('corps trop volumineux'));
				req.destroy();
				return;
			}
			chunks.push(c);
		});
		req.on('end', () => resolve(Buffer.concat(chunks)));
		req.on('error', reject);
	});
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
	const v: unknown = JSON.parse((await readBody(req, MAX_JSON)) || '{}');
	return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}

function send(res: ServerResponse, status: number, body: unknown): void {
	res.statusCode = status;
	res.setHeader('content-type', 'application/json; charset=utf-8');
	res.setHeader('cache-control', 'no-store');
	res.end(JSON.stringify(body));
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Vite plugin: routes on both the dev and the preview server.
 * - The database is opened once, when the server starts listening (after a
 *   Vite restart, the old instance has closed its connection by then); a
 *   failed opening is retried on the next request (keyring unlocked meanwhile…).
 * - Kraken routes keep the secret key on the server: only the result goes back.
 *   A keyring that is temporarily unavailable reads as « not configured ».
 * - Vehicle documents imported in the app (purchase order, invoice) are stored
 *   encrypted in the vault.
 */
export function dataPlugin(dir: string, label = dir): Plugin {
	const displayPath = join(label, DATA_STORE_FILE);
	let store: DataStore | null = null;
	let opening: Promise<DataStore> | null = null;
	let logger: Logger | null = null;

	const getStore = (): Promise<DataStore> => {
		opening ??= openDataStore(dir).then(
			(b) => {
				store = b;
				logger?.info(`  ➜  Données : ${displayPath} (SQLCipher + AES-256-GCM, clé dans le trousseau)`);
				if (b.fichiersChiffres) logger?.info(`  ➜  ${b.fichiersChiffres} fichier(s) de base chiffré(s) en entier (SQLCipher).`);
				if (b.migration) {
					logger?.info(`  ➜  ${b.migration.cles} clés importées depuis les fichiers JSON, vérifiées et archivées dans la base.`);
					logger?.warn(`  ➜  Copie en clair déplacée dans ${b.migration.dossier} : supprime-la après vérification.`);
				}
				return b;
			},
			(e: unknown) => {
				opening = null;
				logger?.error(`  ✗  Base de données inaccessible : ${message(e)}`);
				throw e;
			}
		);
		return opening;
	};

	async function kraken(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
		if (path === '/__secrets/kraken') {
			if (req.method === 'DELETE') {
				await deleteKrakenKeys();
				return send(res, 200, { ok: true });
			}
			if (req.method !== 'PUT') return send(res, 405, { error: ['méthode non gérée'] });
			const body = await readJson(req);
			const keys = { key: String(body.key ?? '').trim(), secret: String(body.secret ?? '').trim() };
			if (!areValidKeys(keys)) return send(res, 400, { error: ['Clés au mauvais format (attendu : clé et secret base64 de Kraken).'] });
			let result: unknown = null;
			if (body.tester !== false) {
				const r = await privateCall('Balance', {}, keys);
				if (r.error.length) return send(res, 400, { error: r.error });
				result = r.result;
			}
			await saveKrakenKeys(keys);
			return send(res, 200, { ok: true, result });
		}
		const method = path.slice('/__kraken/'.length);
		if (req.method !== 'POST') return send(res, 405, { error: ['méthode non gérée'] });
		const body = await readJson(req);
		const keys = body.cles === undefined ? await readKrakenKeys() : areValidKeys(body.cles) ? body.cles : null;
		if (!keys) return send(res, 200, { error: [body.cles === undefined ? 'no-keys' : 'Clés au mauvais format.'] });
		try {
			return send(res, 200, await privateCall(method, body.params, keys));
		} catch (e) {
			return send(res, 502, { error: [message(e)] });
		}
	}

	/** Weather routes: the server is the only one to call Open-Meteo, for the place chosen in Réglages. */
	async function weather(req: IncomingMessage, res: ServerResponse, path: string, params: URLSearchParams): Promise<void> {
		if (req.method !== 'GET') return send(res, 405, { error: ['méthode non gérée'] });
		try {
			if (path === '/__weather/places') {
				const q = cleanQuery(params.get('q'));
				if (!q) return send(res, 400, { error: [QUERY_RULE] });
				return send(res, 200, { places: await searchPlaces(q) });
			}
			if (path === '/__weather' || path === '/__weather/daily') {
				const c = cleanCoordinates(params.get('lat'), params.get('lon'));
				if (!c) return send(res, 400, { error: ['Coordonnées attendues.'] });
				if (path === '/__weather/daily') return send(res, 200, { daily: await dailyAt(c.lat, c.lon) });
				return send(res, 200, { weather: await weatherAt(c.lat, c.lon) });
			}
			return send(res, 404, { error: ['route inconnue'] });
		} catch (e) {
			return send(res, 502, { error: [message(e)] });
		}
	}

	/** Photo routes: the server alone asks Wikidata and Wikimedia Commons for the banner of a trip's destination. */
	async function photo(req: IncomingMessage, res: ServerResponse, path: string, params: URLSearchParams): Promise<void> {
		if (req.method !== 'GET') return send(res, 405, { error: ['méthode non gérée'] });
		try {
			if (path === '/__photo') {
				const q = cleanQuery(params.get('q'));
				if (!q) return send(res, 400, { error: [QUERY_RULE] });
				return send(res, 200, { photo: await findPhoto(q) });
			}
			if (path === '/__photo/file') {
				const file = params.get('f');
				const width = cleanWidth(params.get('w'));
				if (!isPhotoFile(file) || !width) return send(res, 400, { error: ['Fichier Commons et largeur (480 ou 1600) attendus.'] });
				const { bytes, type } = await photoBytes(file, width);
				res.statusCode = 200;
				res.setHeader('content-type', type);
				res.setHeader('content-length', bytes.length);
				res.setHeader('cache-control', 'private, max-age=604800, immutable');
				res.end(bytes);
				return;
			}
			return send(res, 404, { error: ['route inconnue'] });
		} catch (e) {
			return send(res, 502, { error: [message(e)] });
		}
	}

	/** Map routes: the server alone asks Nominatim where a place of a day plan is, and ArcGIS Online for the map tiles. */
	async function map(req: IncomingMessage, res: ServerResponse, path: string, params: URLSearchParams): Promise<void> {
		if (req.method !== 'GET') return send(res, 405, { error: ['méthode non gérée'] });
		try {
			if (path === '/__geo') {
				const q = cleanGeoQuery(params.get('q'));
				if (!q) return send(res, 400, { error: ['Nom de lieu attendu (1 à 120 caractères).'] });
				return send(res, 200, { hit: await geocode(q, cleanGeoQuery(params.get('near')) ?? '', cleanCountryCode(params.get('cc'))) });
			}
			if (path === '/__tile') {
				const t = cleanTile(params.get('s'), params.get('l'), params.get('z'), params.get('x'), params.get('y'));
				if (!t) return send(res, 400, { error: ['Tuile attendue : s=light|dark, l=base|labels, z, x, y.'] });
				const { bytes, type } = await tileBytes(t);
				res.statusCode = 200;
				res.setHeader('content-type', type);
				res.setHeader('content-length', bytes.length);
				res.setHeader('cache-control', 'private, max-age=604800, immutable');
				res.end(bytes);
				return;
			}
			return send(res, 404, { error: ['route inconnue'] });
		} catch (e) {
			return send(res, 502, { error: [message(e)] });
		}
	}

	/** Data routes: the encrypted database, opened on the first call. */
	async function data(req: IncomingMessage, res: ServerResponse, path: string, params: URLSearchParams): Promise<void> {
		let b: DataStore;
		try {
			b = await getStore();
		} catch (e) {
			return send(res, 503, { error: 'base-indisponible', message: message(e) });
		}
		if (req.method === 'GET' && path === '/__data') {
			let hasKrakenKeys = false;
			try {
				hasKrakenKeys = (await readKrakenKeys()) !== null;
			} catch {
				hasKrakenKeys = false;
			}
			return send(res, 200, { dir: displayPath, data: b.lireTout(), versions: b.versions(), secrets: { kraken: hasKrakenKeys } });
		}
		if (req.method === 'POST' && path === '/__data/documents') {
			const name = params.get('nom') ?? '';
			if (!name.startsWith('vehicules/') || !isValidDocumentName(name)) return send(res, 400, { error: 'nom de document refusé' });
			const bytes = await readBytes(req, MAX_DOCUMENT);
			if (!bytes.length) return send(res, 400, { error: 'document vide' });
			b.ajouterDocument(name, bytes);
			return send(res, 200, { ok: true, nom: name, octets: bytes.length });
		}
		if (req.method === 'POST' && path === '/__data/import') {
			const { data } = JSON.parse(await readBody(req)) as { data?: Record<string, unknown> };
			return send(res, 200, { written: b.importer(data ?? {}, 'navigateur (migration)') });
		}
		if (path === '/__data/points' || path.startsWith('/__data/points/')) {
			const m = /^\/__data\/points(?:\/(\d+)(\/restaurer)?)?$/.exec(path);
			if (!m) return send(res, 404, { error: 'inconnu' });
			try {
				if (!m[1] && req.method === 'GET') return send(res, 200, { points: b.points() });
				if (!m[1] && req.method === 'POST') {
					const { raison } = JSON.parse((await readBody(req)) || '{}') as { raison?: unknown };
					return send(res, 200, { point: b.creerPoint(typeof raison === 'string' ? raison : 'point manuel') });
				}
				if (m[1] && !m[2] && req.method === 'GET') return send(res, 200, { data: b.lirePoint(Number(m[1])) });
				if (m[1] && m[2] && req.method === 'POST') return send(res, 200, { avant: b.restaurerPoint(Number(m[1])) });
			} catch (e) {
				return send(res, 422, { error: message(e) });
			}
			return send(res, 405, { error: 'méthode non gérée' });
		}
		const key = decodeURIComponent(path.slice('/__data/'.length));
		if (!isAllowedKey(key)) return send(res, 400, { error: 'clé refusée' });
		const header = req.headers['x-budget-version'];
		const expected = typeof header === 'string' ? header || null : undefined;
		try {
			if (req.method === 'PUT') return send(res, 200, { ok: true, version: b.ecrire(key, await readBody(req), expected) });
			if (req.method === 'DELETE') {
				b.supprimer(key, expected);
				return send(res, 200, { ok: true, version: null });
			}
		} catch (e) {
			if (e instanceof VersionConflict) return send(res, 409, { error: 'conflit', message: e.message, version: e.actuelle });
			throw e;
		}
		return send(res, 405, { error: 'méthode non gérée' });
	}

	type Route = (req: IncomingMessage, res: ServerResponse, path: string, params: URLSearchParams) => Promise<void>;
	/** Path prefix → handler; a prefix ending with « / » matches below it only, the others match the path itself too. */
	const ROUTES: [string, Route][] = [
		['/__data', data],
		['/__secrets/', kraken],
		['/__kraken/', kraken],
		['/__weather', weather],
		['/__photo', photo],
		['/__geo', map],
		['/__tile', map]
	];

	const handler: Connect.NextHandleFunction = (req, res, next) => {
		const url = new URL(req.url ?? '', 'http://localhost');
		const path = url.pathname;
		const route = ROUTES.find(([r]) => path === r || path.startsWith(r.endsWith('/') ? r : `${r}/`));
		if (!route) return next();
		void (async () => {
			try {
				const refusal = accessRefusal(req);
				if (refusal) return send(res, 403, { error: 'interdit', message: refusal });
				return await route[1](req, res, path, url.searchParams);
			} catch (e) {
				return send(res, 500, { error: message(e) });
			}
		})();
	};

	const install = (server: ViteDevServer | PreviewServer) => {
		logger = server.config.logger;
		server.middlewares.use(handler);
		server.httpServer?.once('listening', () => void getStore().catch(() => undefined));
		server.httpServer?.once('close', () => {
			store?.fermer();
			store = null;
			opening = null;
		});
	};

	return {
		name: 'budget-donnees-sqlite',
		configureServer: install,
		configurePreviewServer: install
	};
}
