/**
 * Assets (`budget:biens`): reactive store. Saved like the other data (project
 * database, backup.ts which carries every `budget:*` key). An operation is
 * linked to a single asset only.
 */

import { persistJson } from './storage';
import { assetTotals, sortReadings, validateAsset, validateReading, type Asset, type AssetInput, type KmReading } from './assets';

export const ASSETS_KEY = 'budget:biens';

const canStore = typeof localStorage !== 'undefined';

/** Stored assets; `ancienFormat`: at least one asset still uses `category` (before vehicles existed). */
function loadAssets(): { biens: Asset[]; ancienFormat: boolean } {
	if (!canStore) return { biens: [], ancienFormat: false };
	try {
		const parsed: unknown = JSON.parse(localStorage.getItem(ASSETS_KEY) ?? '[]');
		if (!Array.isArray(parsed)) return { biens: [], ancienFormat: false };
		const assets = parsed.flatMap((raw: unknown): Asset[] => {
			const id = raw && typeof raw === 'object' ? (raw as { id?: unknown }).id : undefined;
			const v = validateAsset(raw);
			return typeof id === 'string' && typeof v !== 'string' ? [{ id, ...v }] : [];
		});
		return { biens: assets, ancienFormat: parsed.some((raw) => raw && typeof raw === 'object' && 'category' in raw && !('type' in raw)) };
	} catch {
		return { biens: [], ancienFormat: false };
	}
}

const loaded = loadAssets();

export const assetsState = $state({
	biens: loaded.biens
});

function persist(): void {
	if (canStore) persistJson(ASSETS_KEY, assetsState.biens);
}

// Assets from before vehicles (`category`) are rewritten once in the new format (`type`)
if (loaded.ancienFormat) persist();

/** Asset totals (paid, estimated). */
export function getAssetTotals() {
	return assetTotals(assetsState.biens);
}

/** Creates an asset; its operations leave any other asset. */
export function addAsset(input: AssetInput): Asset {
	const asset: Asset = { id: `b-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`, ...input };
	const taken = new Set(asset.linkedTxKeys);
	assetsState.biens = [...assetsState.biens.map((b) => (b.linkedTxKeys.some((k) => taken.has(k)) ? { ...b, linkedTxKeys: b.linkedTxKeys.filter((k) => !taken.has(k)) } : b)), asset];
	persist();
	return asset;
}

/** Updates an asset (form). */
export function updateAsset(id: string, patch: Partial<AssetInput>): void {
	assetsState.biens = assetsState.biens.map((b) => (b.id === id ? { ...b, ...patch } : b));
	persist();
}

/** Deletes an asset; returns it so the deletion can be undone (restoreAsset). */
export function removeAsset(id: string): Asset | undefined {
	const old = assetsState.biens.find((b) => b.id === id);
	assetsState.biens = assetsState.biens.filter((b) => b.id !== id);
	persist();
	return old;
}

/** Undoes a deletion. */
export function restoreAsset(asset: Asset): void {
	if (assetsState.biens.some((b) => b.id === asset.id)) return;
	assetsState.biens = [...assetsState.biens, asset];
	persist();
}

/** Asset an operation is linked to. */
export function assetOfTx(key: string): Asset | undefined {
	return assetsState.biens.find((b) => b.linkedTxKeys.includes(key));
}

/** Links an operation to an asset (and unlinks it from any other). */
export function attachTx(assetId: string, key: string): void {
	assetsState.biens = assetsState.biens.map((b) => {
		const rest = b.linkedTxKeys.filter((k) => k !== key);
		return b.id === assetId ? { ...b, linkedTxKeys: [...rest, key] } : rest.length !== b.linkedTxKeys.length ? { ...b, linkedTxKeys: rest } : b;
	});
	persist();
}

/** Unlinks an operation from its asset. */
export function detachTx(key: string): void {
	assetsState.biens = assetsState.biens.map((b) => (b.linkedTxKeys.includes(key) ? { ...b, linkedTxKeys: b.linkedTxKeys.filter((k) => k !== key) } : b));
	persist();
}

/** Adds an odometer reading; returns the refusal reason, or null. */
export function logKm(assetId: string, raw: unknown): string | null {
	const b = assetsState.biens.find((x) => x.id === assetId);
	if (!b) return 'bien introuvable';
	if (b.type !== 'vehicule') return 'relevé réservé aux véhicules';
	const r = validateReading(raw);
	if (typeof r === 'string') return r;
	const vehicle = { ...(b.vehicle ?? { kmLog: [] }) };
	vehicle.kmLog = sortReadings([...vehicle.kmLog, r]);
	assetsState.biens = assetsState.biens.map((x) => (x.id === assetId ? { ...x, vehicle } : x));
	persist();
	return null;
}

/** Removes a reading (same date, same odometer). */
export function removeKm(assetId: string, r: Pick<KmReading, 'date' | 'km'>): void {
	assetsState.biens = assetsState.biens.map((x) =>
		x.id === assetId && x.vehicle ? { ...x, vehicle: { ...x.vehicle, kmLog: x.vehicle.kmLog.filter((k) => k.date !== r.date || k.km !== r.km) } } : x
	);
	persist();
}
