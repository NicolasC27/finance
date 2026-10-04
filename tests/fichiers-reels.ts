import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { openDataStore } from '../server/base.ts';

/**
 * Owner's real files (non-regression tests): at the project root if still
 * there, otherwise in the database's encrypted vault (donnees/budget.db, key in
 * the keyring). Not found → tests skipped.
 * BUDGET_PROJET: another project root.
 */
const ROOT = process.env.BUDGET_PROJET ?? resolve(import.meta.dirname, '../..');
type Bytes = Buffer<ArrayBuffer>;
let vault: Promise<Map<string, Bytes>> | null = null;

/**
 * Reads the encrypted vault once; no database or an unavailable keyring gives an
 * empty map, so the tests are skipped.
 */
function readVault(): Promise<Map<string, Bytes>> {
	vault ??= (async () => {
		const docs = new Map<string, Bytes>();
		try {
			const store = await openDataStore(join(ROOT, 'donnees'), { lectureSeule: true });
			try {
				for (const d of store.etat().documents) docs.set(d.nom, Buffer.from(store.lireDocument(d.nom)!));
			} finally {
				store.fermer();
			}
		} catch {
		}
		return docs;
	})();
	return vault;
}

/** Content of a file (path relative to the project); null when not found. */
export async function realFile(name: string): Promise<Bytes | null> {
	const p = resolve(ROOT, name);
	if (existsSync(p)) return readFileSync(p);
	return (await readVault()).get(name) ?? null;
}

/** `ext` files of a folder (relative to the project), sorted by name. */
export async function realFolder(folder: string, ext: string): Promise<{ nom: string; contenu: Bytes }[]> {
	const p = resolve(ROOT, folder);
	const list = existsSync(p)
		? readdirSync(p)
				.filter((f) => f.endsWith(ext))
				.map((f) => ({ nom: f, contenu: readFileSync(join(p, f)) }))
		: [...(await readVault()).entries()].filter(([n]) => n.startsWith(`${folder}/`) && n.endsWith(ext)).map(([n, content]) => ({ nom: n.slice(folder.length + 1), contenu: content }));
	return list.sort((a, b) => (a.nom < b.nom ? -1 : a.nom > b.nom ? 1 : 0));
}
