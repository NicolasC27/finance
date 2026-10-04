import { execFile } from 'node:child_process';

/**
 * System keyring (Secret Service: GNOME Keyring / KWallet) through
 * `secret-tool`: the only place where the app's secrets live (database key,
 * Kraken API keys). Never in the project, never in the browser.
 * Every entry carries the attribute application=budget-fintech.
 */

const APPLICATION = 'budget-fintech';

function secretTool(args: string[], input = ''): Promise<{ code: number; sortie: string; erreur: string }> {
	return new Promise((resolve, reject) => {
		const child = execFile('secret-tool', args, { timeout: 120_000, encoding: 'utf8' }, (err, stdout, stderr) => {
			if (err?.code === 'ENOENT') return reject(new Error('secret-tool introuvable : installe le paquet libsecret.'));
			if (err?.killed) return reject(new Error('Trousseau du système sans réponse (verrouillé ?) : déverrouille-le puis recharge la page.'));
			resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, sortie: stdout, erreur: stderr });
		});
		child.stdin?.end(input);
	});
}

const attributes = (pairs: Record<string, string>) => ['application', APPLICATION, ...Object.entries(pairs).flat()];

/** Value of an entry; null when missing. */
export async function readSecret(pairs: Record<string, string>): Promise<string | null> {
	const r = await secretTool(['lookup', ...attributes(pairs)]);
	if (r.code === 0) return r.sortie.trim();
	if (r.erreur.trim()) throw new Error(`Trousseau du système inaccessible : ${r.erreur.trim()}`);
	return null;
}

/** Stores (or replaces) an entry, then reads it back: a secret that was not kept would be lost on restart. */
export async function writeSecret(label: string, pairs: Record<string, string>, value: string): Promise<void> {
	const r = await secretTool(['store', '--label', label, ...attributes(pairs)], value);
	if (r.code !== 0) throw new Error(`Impossible de ranger le secret dans le trousseau : ${r.erreur.trim() || `code ${r.code}`}`);
	if ((await readSecret(pairs)) !== value.trim()) throw new Error('Le secret rangé dans le trousseau ne se relit pas à l’identique.');
}

/** Deletes an entry (no error when it does not exist). */
export async function deleteSecret(pairs: Record<string, string>): Promise<void> {
	const r = await secretTool(['clear', ...attributes(pairs)]);
	if (r.code !== 0 && r.erreur.trim()) throw new Error(`Trousseau du système inaccessible : ${r.erreur.trim()}`);
}
