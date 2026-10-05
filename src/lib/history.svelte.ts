import { checkpoint, diskState, settleWrites } from './diskStorage';
import { setRestoreHooks } from './backup';
import type { PointInfo } from './restorePoints';

/**
 * Restore points, app side: taken on the server right before a risky change (import, bulk edit,
 * AI action, restore) through the storage queue, so the point holds the data before it; listed,
 * read for a difference summary, and rolled back (the page then reloads the restored data).
 */

const HEADERS = { 'x-budget-data': '1', 'content-type': 'application/json' };

async function call<T>(path: string, init?: RequestInit): Promise<T> {
	const res = await fetch(`/__data/points${path}`, { headers: HEADERS, cache: 'no-store', ...init });
	const body = (await res.json().catch(() => ({}))) as T & { error?: string };
	if (!res.ok) throw new Error(body.error ?? `erreur ${res.status}`);
	return body;
}

/** Restore points are available (data in the encrypted database). */
export function hasRestorePoints(): boolean {
	return diskState.mode === 'disk';
}

/**
 * Takes a restore point before a risky change; call it synchronously right BEFORE the change. A
 * failure never blocks the change (it is only reported in the console).
 */
export function restorePoint(reason: string): Promise<PointInfo | null> {
	const run = checkpoint(() => call<{ point: PointInfo | null }>('', { method: 'POST', body: JSON.stringify({ raison: reason }) }).then((r) => r.point));
	return (run ?? Promise.resolve(null)).catch((e: unknown) => {
		console.error('[points] point de restauration impossible :', e);
		return null;
	});
}

setRestoreHooks({ before: () => restorePoint('avant restauration d’une sauvegarde'), settle: settleWrites });

export async function listRestorePoints(): Promise<PointInfo[]> {
	return (await call<{ points: PointInfo[] }>('')).points;
}

export async function readRestorePoint(id: number): Promise<Record<string, string>> {
	return (await call<{ data: Record<string, string> }>(`/${id}`)).data;
}

/** Current data as the server will see it (every budget: key of the storage). */
export function currentData(): Record<string, string> {
	const out: Record<string, string> = {};
	for (let i = 0; i < localStorage.length; i++) {
		const k = localStorage.key(i);
		if (k?.startsWith('budget:')) out[k] = localStorage.getItem(k) ?? '';
	}
	return out;
}

/** Goes back to a point (current state saved first on the server), then reloads the page. */
export async function rollbackTo(id: number): Promise<PointInfo> {
	const run = checkpoint(() => call<{ avant: PointInfo }>(`/${id}/restaurer`, { method: 'POST' }));
	if (!run) throw new Error('Historique indisponible : les données ne sont pas dans la base.');
	const r = await run;
	return r.avant;
}
