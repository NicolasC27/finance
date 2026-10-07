/**
 * Calls to the local app server (vite-plugin-donnees.ts): the access header it requires
 * (server/acces.ts), its error bodies read as one French message whatever their shape
 * (`{ error: [...] }` from the Kraken and weather routes, `{ error, message }` from the access
 * and database refusals), and the browser's own failures said in French.
 */

export const LOCAL_HEADERS = { 'x-budget-data': '1' };

/** Readable message of an error response from the local server. */
export function serverError(body: { error?: unknown; message?: unknown }, status: number): string {
	if (Array.isArray(body.error) && body.error.length) return body.error.map(String).join(', ');
	if (typeof body.message === 'string') return body.message;
	if (typeof body.error === 'string' && body.error) return body.error;
	return `serveur local : erreur ${status}`;
}

/** The failure of a fetch to the local server, in French (the server itself answers in French). */
export function describeFailure(e: unknown): string {
	if (e instanceof DOMException && e.name === 'TimeoutError') return 'le serveur ne répond pas';
	if (e instanceof TypeError) return 'serveur local injoignable';
	if (e instanceof SyntaxError) return 'réponse illisible du serveur local';
	return e instanceof Error ? e.message : String(e);
}

/** GET on the local server: the JSON body, or an Error carrying the server's message. */
export async function fetchLocal<T>(path: string): Promise<T> {
	const res = await fetch(path, { headers: LOCAL_HEADERS, cache: 'no-store' });
	const body = (await res.json().catch(() => ({}))) as T & { error?: unknown; message?: unknown };
	if (!res.ok) throw new Error(serverError(body, res.status));
	return body;
}
