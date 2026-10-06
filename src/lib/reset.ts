/**
 * Full browser reset: every `budget:*` key (imported transactions, deletions, overrides, rules,
 * budgets, goals, accounts, loans, transfers, Kraken (keys, manual, ledger, snapshots, prices),
 * Natixis (holdings, performance), import presets, news). Display preferences (theme, sidebar,
 * collapsed sections) are kept unless explicitly asked. Reloads the page afterwards so every
 * store starts from scratch without special cases.
 */

import { KEPT_ON_RESET } from './prefs';

const PREFIX = 'budget:';
const PREF_KEYS = KEPT_ON_RESET;

/** Data keys currently stored (preferences excluded). */
export function listDataKeys(): string[] {
	if (typeof localStorage === 'undefined') return [];
	const keys: string[] = [];
	for (let i = 0; i < localStorage.length; i++) {
		const k = localStorage.key(i);
		if (k && k.startsWith(PREFIX) && !PREF_KEYS.has(k)) keys.push(k);
	}
	return keys;
}

/** Erases the data (and the preferences when `keepPrefs` is false), then reloads; nothing to erase if storage is unavailable. */
export function resetAll(opts: { keepPrefs?: boolean } = {}): void {
	const keepPrefs = opts.keepPrefs ?? true;
	if (typeof localStorage === 'undefined') return;
	try {
		const toRemove: string[] = [];
		for (let i = 0; i < localStorage.length; i++) {
			const k = localStorage.key(i);
			if (!k || !k.startsWith(PREFIX)) continue;
			if (keepPrefs && PREF_KEYS.has(k)) continue;
			toRemove.push(k);
		}
		for (const k of toRemove) localStorage.removeItem(k);
	} catch {
	}
	window.location.reload();
}
