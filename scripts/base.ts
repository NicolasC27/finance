import Database from 'better-sqlite3-multiple-ciphers';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { saveKeyringKey, readKeyringKey, openDataStore } from '../server/base.ts';

/**
 * App database tool (donnees/budget.db): npm run -s base -- <command>
 *
 *   etat                 content, integrity, archives, backups (default)
 *   sql "<query>"        SQL on the decrypted data, in memory (--json available)
 *                        tables: operations, comptes, donnees (key, JSON value)
 *   export [key]         PLAINTEXT data (JSON) on standard output
 *   cle                  prints the encryption key, to keep in a password manager
 *   restaurer-cle        stores a pasted key in the keyring (checked against the database)
 *   coffre               original documents stored in the encrypted vault
 *   coffre-ajouter <paths…>              stores project files/folders there (read back before concluding)
 *   coffre-extraire <name|folder> <dest> takes a PLAINTEXT copy out of it
 *
 * Read-only on the app data (only the server writes it); the vault, however,
 * is filled from here.
 */

const dir = process.env.BUDGET_DATA_DIR ?? fileURLToPath(new URL('../../donnees', import.meta.url));
const entryName = process.env.BUDGET_DB_NOM ?? 'principale';
const PROJECT_DIR = fileURLToPath(new URL('../../', import.meta.url));

/** Convenience tables, recomputed on every query from the JSON values. */
const TABLES = `
CREATE TABLE operations AS SELECT
	j.key + 1 AS n,
	j.value ->> 'booking_date' AS date,
	j.value ->> 'value_date' AS date_valeur,
	CASE j.value ->> 'credit_debit_indicator' WHEN 'DBIT' THEN -1 ELSE 1 END * CAST(j.value -> 'transaction_amount' ->> 'amount' AS REAL) AS montant,
	j.value -> 'transaction_amount' ->> 'currency' AS devise,
	(SELECT group_concat(r.value, ' ') FROM json_each(j.value -> 'remittance_information') r) AS libelle,
	j.value ->> 'account' AS compte,
	j.value ->> 'source' AS source,
	j.value ->> 'bank_category' AS categorie_banque,
	j.value ->> 'bank_subcategory' AS sous_categorie_banque,
	j.value ->> 'balance_after' AS solde_apres,
	j.value ->> 'checked' AS pointee,
	j.value ->> 'note' AS note
FROM json_each((SELECT valeur FROM donnees WHERE cle = 'budget:imported-txs')) j;
CREATE TABLE comptes AS SELECT
	j.value ->> 'id' AS id,
	j.value ->> 'label' AS libelle,
	j.value ->> 'kind' AS type,
	j.value ->> 'balance' AS solde,
	j.value ->> 'currency' AS devise
FROM json_each((SELECT valeur FROM donnees WHERE cle = 'budget:accounts')) j;
`;

const formatNumber = (n: number) => n.toLocaleString('fr-FR');

async function readStore() {
	const store = await openDataStore(dir, { lectureSeule: true });
	try {
		return { etat: store.etat(), data: store.lireTout() };
	} finally {
		store.fermer();
	}
}

async function printStatus(): Promise<void> {
	const { etat: e, data } = await readStore();
	let operations = 0;
	try {
		operations = (JSON.parse(data['budget:imported-txs'] ?? '[]') as unknown[]).length;
	} catch {
		operations = 0;
	}
	const lastChange = e.cles.map((c) => c.modifie_le).sort().at(-1) ?? '—';
	const rows = [
		['Base', e.fichier],
		['Chiffrement', `${e.fichierChiffre ? 'fichier entier (SQLCipher 4)' : 'FICHIER EN CLAIR (pas encore migré)'} + AES-256-GCM par valeur ; clé dans le trousseau (entrée « ${entryName} »)`],
		['Intégrité', `${e.integrite} ; ${e.cles.length} valeurs déchiffrées sans erreur`],
		['Contenu', `${e.cles.length} clés · ${formatNumber(operations)} opérations · modifiée le ${lastChange.slice(0, 16).replace('T', ' ')} (UTC)`],
		['Archives', e.archives.map((a) => a.origine).join(' ; ') || 'aucune'],
		['Coffre', `${e.documents.length} document(s) d'origine chiffré(s)`],
		['Sauvegardes', `${e.sauvegardes.length} dans historique/ (dernière : ${e.sauvegardes.at(-1) ?? '—'})`]
	];
	for (const [k, v] of rows) console.log(`${k!.padEnd(12)} ${v}`);
}

async function sql(args: string[]): Promise<void> {
	const json = args.includes('--json');
	const query = args.filter((a) => a !== '--json').join(' ').trim();
	if (!query) throw new Error('requête manquante : npm run -s base -- sql "SELECT …"');
	const { etat: e, data } = await readStore();
	const mem = new Database(':memory:');
	mem.exec('CREATE TABLE donnees (cle TEXT PRIMARY KEY, valeur TEXT NOT NULL, modifie_le TEXT NOT NULL)');
	const ins = mem.prepare('INSERT INTO donnees VALUES (?, ?, ?)');
	for (const c of e.cles) ins.run(c.cle, data[c.cle]!, c.modifie_le);
	mem.exec(TABLES);
	const rows = mem.prepare(query).all();
	mem.close();
	if (json) console.log(JSON.stringify(rows, null, 2));
	else {
		console.table(rows);
		console.log(`${formatNumber(rows.length)} ligne(s)`);
	}
}

async function exportData(requestedKey: string | undefined): Promise<void> {
	const { data } = await readStore();
	const parseValue = (v: string): unknown => {
		try {
			return JSON.parse(v);
		} catch {
			return v;
		}
	};
	if (!requestedKey) {
		console.log(JSON.stringify(Object.fromEntries(Object.entries(data).map(([k, v]) => [k, parseValue(v)])), null, 2));
		return;
	}
	const k = requestedKey.startsWith('budget:') ? requestedKey : `budget:${requestedKey}`;
	if (!(k in data)) throw new Error(`clé absente : ${k}`);
	console.log(JSON.stringify(parseValue(data[k]!), null, 2));
}

async function printKey(): Promise<void> {
	const key = await readKeyringKey(entryName);
	if (!key) throw new Error(`aucune clé dans le trousseau (entrée « ${entryName} »)`);
	console.error('Clé de chiffrement de la base : copie-la dans ton gestionnaire de mots de passe (jamais dans le projet).');
	console.log(key.toString('base64'));
}

async function readLine(prompt: string): Promise<string> {
	if (process.stdin.isTTY) process.stderr.write(prompt);
	const rl = createInterface({ input: process.stdin });
	for await (const line of rl) {
		rl.close();
		return line;
	}
	return '';
}

/** Stores a pasted key in the keyring, after checking that it decrypts the database. */
async function restoreKey(): Promise<void> {
	const key = Buffer.from((await readLine('Colle la clé puis Entrée : ')).trim(), 'base64');
	if (key.length !== 32) throw new Error('clé invalide (44 caractères base64 attendus)');
	(await openDataStore(dir, { cle: key, lectureSeule: true })).fermer();
	await saveKeyringKey(entryName, key);
	console.log(`Clé vérifiée sur ${dir} et rangée dans le trousseau (entrée « ${entryName} »).`);
}

/** Files (recursively) under project paths; refuses anything outside, the code and the database. */
function projectFiles(paths: string[]): string[] {
	const out: string[] = [];
	const visit = (p: string) => {
		const st = statSync(p);
		if (st.isDirectory()) for (const n of readdirSync(p).sort()) visit(join(p, n));
		else if (st.isFile()) out.push(p);
	};
	for (const c of paths) {
		const abs = resolve(PROJECT_DIR, c);
		const rel = relative(PROJECT_DIR, abs);
		const top = rel.split(sep)[0];
		if (!rel || rel.startsWith('..') || top === 'app' || top === 'donnees') throw new Error(`chemin refusé (hors projet, code ou base) : ${c}`);
		visit(abs);
	}
	return out;
}

async function addToVault(paths: string[]): Promise<void> {
	if (!paths.length) throw new Error('chemins manquants : npm run -s base -- coffre-ajouter impot krak …');
	const files = projectFiles(paths);
	const store = await openDataStore(dir);
	try {
		let totalBytes = 0;
		for (const f of files) {
			const docName = relative(PROJECT_DIR, f).split(sep).join('/');
			const content = readFileSync(f);
			store.ajouterDocument(docName, content);
			if (!store.lireDocument(docName)?.equals(content)) throw new Error(`relecture différente : ${docName}`);
			totalBytes += content.length;
		}
		console.log(`${files.length} fichier(s) rangé(s) dans le coffre chiffré et relu(s) à l'identique (${formatNumber(Math.round(totalBytes / 1024))} Ko).`);
		console.log('Les originaux en clair sont toujours là : rien n’est effacé automatiquement.');
	} finally {
		store.fermer();
	}
}

async function listVault(): Promise<void> {
	const { etat: e } = await readStore();
	for (const d of e.documents) console.log(`${d.nom.padEnd(64)} ${formatNumber(Math.max(1, Math.round(d.octets / 1024))).padStart(6)} Ko  ${d.ajoute_le.slice(0, 10)}`);
	console.log(`${e.documents.length} document(s) dans le coffre`);
}

async function extractFromVault(selection: string | undefined, destination: string | undefined): Promise<void> {
	if (!selection || !destination) throw new Error('usage : npm run -s base -- coffre-extraire <nom ou dossier> <dossier de destination>');
	const store = await openDataStore(dir, { lectureSeule: true });
	try {
		const prefix = selection.endsWith('/') ? selection : `${selection}/`;
		const names = store.etat().documents.map((d) => d.nom).filter((n) => n === selection || n.startsWith(prefix));
		if (!names.length) throw new Error(`aucun document « ${selection} » dans le coffre`);
		for (const n of names) {
			const target = resolve(destination, n);
			mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
			writeFileSync(target, store.lireDocument(n)!, { mode: 0o600, flag: 'wx' });
		}
		console.log(`${names.length} fichier(s) extrait(s) EN CLAIR dans ${resolve(destination)} : supprime-les après usage.`);
	} finally {
		store.fermer();
	}
}

const [command = 'etat', ...args] = process.argv.slice(2);
const commands: Record<string, () => Promise<void>> = {
	etat: printStatus,
	sql: () => sql(args),
	export: () => exportData(args[0]),
	cle: printKey,
	'restaurer-cle': restoreKey,
	coffre: listVault,
	'coffre-ajouter': () => addToVault(args),
	'coffre-extraire': () => extractFromVault(args[0], args[1])
};

try {
	const f = commands[command];
	if (!f) throw new Error(`commande inconnue « ${command} » : etat, sql, export, cle, restaurer-cle, coffre, coffre-ajouter, coffre-extraire`);
	await f();
} catch (e) {
	console.error(`✗ ${e instanceof Error ? e.message : String(e)}`);
	process.exitCode = 1;
}
