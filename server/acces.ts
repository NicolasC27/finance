import type { IncomingMessage } from 'node:http';

/**
 * Who may read or write the data (/__data): only the app opened on THIS machine.
 * - local connection (loopback);
 * - local host (localhost, 127.0.0.1, [::1]): blocks "DNS rebinding",
 *   where a third-party site points its domain at 127.0.0.1;
 * - origin, when present, equal to the host: no call from another local page
 *   (other port) nor from a website;
 * - `x-budget-data: 1` header: cannot be sent from another origin without a
 *   CORS preflight, which these routes refuse.
 */

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/i;
const LOOPBACK: ReadonlySet<string> = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/** Reason for refusal, or null when the request is allowed. */
export function accessRefusal(req: Pick<IncomingMessage, 'headers' | 'socket'>): string | null {
	if (!LOOPBACK.has(req.socket.remoteAddress ?? '')) return 'connexion non locale';
	const host = req.headers.host ?? '';
	if (!LOCAL_HOST.test(host)) return `hôte non local (${host || 'absent'}) : ouvre l'app sur http://localhost`;
	const origin = req.headers.origin;
	if (origin !== undefined) {
		let originHost = '';
		try {
			originHost = new URL(origin).host;
		} catch {
			originHost = '';
		}
		if (originHost.toLowerCase() !== host.toLowerCase()) return 'origine différente';
	}
	const site = req.headers['sec-fetch-site'];
	if (site !== undefined && site !== 'same-origin') return 'requête venant d’un autre site';
	if (req.headers['x-budget-data'] !== '1') return 'en-tête x-budget-data manquant';
	return null;
}
