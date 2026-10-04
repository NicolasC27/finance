import type { CategoryId, Transaction } from './types';
import { txKey, bankCategoryFor, assignDupIndexes, type MerchantCategoryMap } from './categories';
import { merchantKey } from './merchant';
import { loadDemoTransactions } from './data';
import { persistJson } from './storage';
import { isStatementSource, skipKnownMovements } from './duplicateGuard';

/**
 * Global transaction store: demo (JSON) ∪ imported (CSV/XLSX), deduplicated by txKey. Imported
 * transactions are persisted in localStorage, and so are user deletions (tombstones: never
 * imported again).
 */

export const IMPORTED_KEY = 'budget:imported-txs';
const DELETED_KEY = 'budget:deleted-txkeys';

/** Tombstone cap (FIFO: the oldest go first). */
const DELETED_CAP = 5000;

const canStore = typeof localStorage !== 'undefined';

/** Feedback of the last import (shown in the Transactions page box). */
export interface ImportFeedback {
	added: number;
	duplicates: number;
	/** Duplicates enriched with bank categories (XLSX line without → CSV with). */
	enriched: number;
	ignored: number;
	/** Tombstoned keys: not imported again because the user deleted them. */
	resurrectedBlocked: number;
	errors: string[];
	fileName: string;
	/** Account labels concerned by the import (multi-account feedback). */
	accounts: string[];
	/** Internal transfers already hidden from the budget in the imported batch (v13). */
	maskedTransfers?: number;
	/** OFX/QIF/CAMT statement: movements already known through another export (same account, date, amount), not added. */
	knownElsewhere?: number;
	at: number; // Date.now()
}

function loadImported(): Transaction[] {
	if (!canStore) return [];
	try {
		const raw = localStorage.getItem(IMPORTED_KEY);
		if (!raw) return [];
		const parsed = JSON.parse(raw) as Transaction[];
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

function loadDeleted(): string[] {
	if (!canStore) return [];
	try {
		const parsed = JSON.parse(localStorage.getItem(DELETED_KEY) ?? '[]') as string[];
		return Array.isArray(parsed) ? parsed.filter((k) => typeof k === 'string') : [];
	} catch {
		return [];
	}
}

/** Global reactive state (Svelte 5 runes). */
export const txState = $state({
	demo: [] as Transaction[],
	imported: loadImported(),
	deletedKeys: loadDeleted(),
	loaded: false,
	loadError: '',
	feedback: null as ImportFeedback | null
});

/** Persists the imported transactions; false if the write failed (quota: reported by a toast). */
function persistImported(): boolean {
	if (!canStore) return true;
	return persistJson(IMPORTED_KEY, txState.imported);
}

function persistDeleted(): void {
	if (!canStore) return;
	persistJson(DELETED_KEY, txState.deletedKeys);
}

/** Loads the demo transactions (idempotent). */
export async function initTransactions(): Promise<void> {
	if (txState.loaded || txState.loadError) return;
	try {
		txState.demo = await loadDemoTransactions();
		txState.loaded = true;
	} catch (e) {
		txState.loadError = e instanceof Error ? e.message : 'Erreur de chargement';
	}
}

/** Set of tombstoned keys (user deletions). */
const deletedSet = $derived(new Set(txState.deletedKeys));

/** Is the key tombstoned (deleted by the user)? */
export function isDeleted(key: string): boolean {
	return deletedSet.has(key);
}

/** Number of active tombstones ('Restaurer les opérations supprimées' button). */
export function deletedCount(): number {
	return txState.deletedKeys.length;
}

// $derived cannot be exported: private value + accessor (Svelte 5 pattern)
const allTransactions = $derived.by((): Transaction[] => {
	const seen = new Set<string>();
	const all: Transaction[] = [];
	for (const tx of [...txState.demo, ...txState.imported]) {
		const key = txKey(tx);
		if (seen.has(key) || deletedSet.has(key)) continue;
		seen.add(key);
		all.push(tx);
	}
	return all;
});

const keySet = $derived(new Set(allTransactions.map((tx) => txKey(tx))));

/**
 * Bank → merchant cross-learning (SPEC v10 §3), NOT persisted: for each transaction whose bank
 * gives a mapped category, vote for `merchantKey(tx) → categoryId`. Simple majority; on a tie the
 * category of the most recent operation (booking_date) wins. 'autre' votes are ignored: they
 * teach nothing and would hide the built-in dictionary. Direct effect: an imported CSV (with bank
 * categories) categorises the XLSX lines (without) of the same merchants.
 */
const merchantCategoryMap = $derived.by((): MerchantCategoryMap => {
	const votes = new Map<string, Map<CategoryId, { count: number; latest: string }>>();
	for (const tx of allTransactions) {
		const cat = bankCategoryFor(tx);
		if (!cat || cat === 'autre') continue;
		const mKey = merchantKey(tx.remittance_information);
		if (!mKey) continue;
		let perCat = votes.get(mKey);
		if (!perCat) {
			perCat = new Map();
			votes.set(mKey, perCat);
		}
		const entry = perCat.get(cat) ?? { count: 0, latest: '' };
		entry.count += 1;
		if (tx.booking_date > entry.latest) entry.latest = tx.booking_date;
		perCat.set(cat, entry);
	}
	const map: MerchantCategoryMap = new Map();
	for (const [mKey, perCat] of votes) {
		let best: CategoryId | null = null;
		let bestCount = 0;
		let bestLatest = '';
		for (const [cat, entry] of perCat) {
			if (entry.count > bestCount || (entry.count === bestCount && entry.latest >= bestLatest)) {
				best = cat;
				bestCount = entry.count;
				bestLatest = entry.latest;
			}
		}
		if (best) map.set(mKey, best);
	}
	return map;
});

/** Bank → merchant cross votes (merchantKey → majority category). */
export function getMerchantCategoryMap(): MerchantCategoryMap {
	return merchantCategoryMap;
}

/** Effective transactions = (demo ∪ imported) ∖ tombstones, deduplicated. */
export function getTransactions(): Transaction[] {
	return allTransactions;
}

/** Set of existing keys (deduplication on import). */
export function getExistingKeys(): Set<string> {
	return keySet;
}

/**
 * Adds imported transactions: skips duplicates (key already present) AND tombstones (deleted by
 * the user, not imported again), persists the new set and returns the feedback to show.
 * - Reverse guard: after an OFX/QIF/CAMT statement, a CSV/XLSX export of the same period (other
 *   labels, hence other txKeys) only adds the surplus; only statements count as known, so two CSV
 *   exports never interfere.
 * - Strict duplicates within the batch (two identical coffees the same day) are ranked, not merged.
 * - Cross enrichment (SPEC v10 §3): a CSV duplicate can bring bank categories to an XLSX line that
 *   has none, otherwise cross-learning would depend on the import order.
 * - Works on a copy outside the reactive proxy with a single assignment at the end (thousands of
 *   individual $state writes would cost too much).
 * - Full quota: the import only lives in memory and the feedback says it will vanish on reload.
 */
export function addImported(
	incoming: Transaction[],
	meta: { ignored: number; errors: string[]; fileName: string; accounts?: string[]; maskedTransfers?: number; knownElsewhere?: number }
): ImportFeedback {
	const fresh: Transaction[] = [];
	let duplicates = 0;
	let enriched = 0;
	let resurrectedBlocked = 0;
	const importedIdx = new Map<string, number>();
	txState.imported.forEach((tx, i) => importedIdx.set(txKey(tx), i));
	const imported = [...txState.imported];
	let knownElsewhere = meta.knownElsewhere ?? 0;
	let lot = incoming;
	if (!incoming.some(isStatementSource) && imported.some(isStatementSource)) {
		const guarded = skipKnownMovements(imported, incoming, { seulementSi: isStatementSource });
		lot = guarded.kept;
		knownElsewhere += guarded.skipped;
	}
	for (const tx of assignDupIndexes(lot)) {
		const key = txKey(tx);
		if (deletedSet.has(key)) {
			resurrectedBlocked++;
		} else if (keySet.has(key)) {
			duplicates++;
			const idx = importedIdx.get(key);
			if (idx !== undefined) {
				const kept = imported[idx]!;
				if (!kept.bank_category && (tx.bank_category || tx.bank_subcategory)) {
					imported[idx] = {
						...kept,
						bank_category: tx.bank_category ?? kept.bank_category,
						bank_subcategory: tx.bank_subcategory ?? kept.bank_subcategory
					};
					enriched++;
				}
			}
		} else {
			fresh.push(tx);
		}
	}
	txState.imported = [...imported, ...fresh];
	const saved = persistImported();
	const feedback: ImportFeedback = {
		added: fresh.length,
		duplicates,
		enriched,
		ignored: meta.ignored,
		resurrectedBlocked,
		errors: saved ? meta.errors : [...meta.errors, 'Stockage du navigateur plein : cet import n’est PAS enregistré et disparaîtra au rechargement.'],
		fileName: meta.fileName,
		accounts: meta.accounts ?? [],
		...(meta.maskedTransfers !== undefined ? { maskedTransfers: meta.maskedTransfers } : {}),
		...(knownElsewhere ? { knownElsewhere } : {}),
		at: Date.now()
	};
	txState.feedback = feedback;
	return feedback;
}

/** Updates an imported transaction (note, tags…) by key; false if the key is not an imported one. */
export function updateImported(key: string, patch: Partial<Pick<Transaction, 'note' | 'tags' | 'checked'>>): boolean {
	const idx = txState.imported.findIndex((tx) => txKey(tx) === key);
	if (idx === -1) return false;
	const next = [...txState.imported];
	next[idx] = { ...next[idx]!, ...patch };
	txState.imported = next;
	persistImported();
	return true;
}

/**
 * Batch update of imported transactions (tags, notes…): one pass and one write instead of one
 * updateImported per operation. Returns the number of operations changed (keys outside the
 * imported ones, demo: ignored; with `toutOuRien`, a single unknown key cancels everything and
 * returns 0).
 */
export function updateImportedMany(
	patches: ReadonlyMap<string, Partial<Pick<Transaction, 'note' | 'tags' | 'checked'>>>,
	options: { toutOuRien?: boolean } = {}
): number {
	if (patches.size === 0) return 0;
	let changed = 0;
	const next = txState.imported.map((tx) => {
		const patch = patches.get(txKey(tx));
		if (!patch) return tx;
		changed++;
		return { ...tx, ...patch };
	});
	if (changed === 0 || (options.toutOuRien && changed !== patches.size)) return 0;
	txState.imported = next;
	persistImported();
	return changed;
}

/**
 * Deletes transactions: removes the matching imported ones and adds their keys to the tombstones
 * (cap 5000, FIFO). Returns a copy for the in-memory undo.
 */
export function deleteTransactions(keys: string[]): { backup: Transaction[] } {
	const keyList = [...new Set(keys)];
	const wanted = new Set(keyList);
	const backup = allTransactions.filter((tx) => wanted.has(txKey(tx)));
	txState.imported = txState.imported.filter((tx) => !wanted.has(txKey(tx)));
	persistImported();
	const merged = [...txState.deletedKeys.filter((k) => !wanted.has(k)), ...keyList];
	txState.deletedKeys = merged.slice(-DELETED_CAP);
	persistDeleted();
	return { backup };
}

/**
 * Undoes a deletion: removes the keys from the tombstones and puts the saved transactions
 * (demo excluded) back into the imported ones, deduplicated by key.
 */
export function restoreTransactions(backup: Transaction[], keys: string[]): void {
	const wanted = new Set(keys);
	txState.deletedKeys = txState.deletedKeys.filter((k) => !wanted.has(k));
	persistDeleted();
	const existing = new Set(txState.imported.map((tx) => txKey(tx)));
	const back = backup.filter((tx) => tx.source !== 'demo' && wanted.has(txKey(tx)) && !existing.has(txKey(tx)));
	if (back.length > 0) {
		txState.imported = [...txState.imported, ...back];
		persistImported();
	}
}

/** Clears the tombstones: deleted operations become importable again. */
export function resetDeletedTombstones(): number {
	const count = txState.deletedKeys.length;
	txState.deletedKeys = [];
	persistDeleted();
	return count;
}

/**
 * Purges the imported transactions (demo kept, tombstones NOT cleared; unavailable storage is
 * ignored). Returns the removed list: the caller offers 'Annuler' (restoreImported).
 */
export function resetImported(): Transaction[] {
	const removed = txState.imported;
	txState.imported = [];
	txState.feedback = null;
	if (canStore) {
		try {
			localStorage.removeItem(IMPORTED_KEY);
		} catch {
		}
	}
	return removed;
}

/** Undoes resetImported: puts the removed list back (before any newer imported transaction). */
export function restoreImported(list: Transaction[]): void {
	if (list.length === 0) return;
	txState.imported = [...list, ...txState.imported];
	persistImported();
}
