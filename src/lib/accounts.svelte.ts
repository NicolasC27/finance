import { detectAccountKind, type AccountKind, type ImportedAccount } from './csvCore';

export type { AccountKind, ImportedAccount } from './csvCore';
export { detectAccountKind } from './csvCore';

/**
 * Registry of known accounts (localStorage `budget:accounts`), fed by XLSX
 * imports (« Vos comptes » sheet: label, kind, DECLARED balance, currency) and
 * CSV imports (11-digit number from the file name, or a remapped « Compte »
 * column). Provides readable labels everywhere and lets pages type/group
 * accounts (Patrimoine page, Dashboard card).
 */

export interface AccountInfo {
	id: string; // 'cm-00012345678', 'natixis', 'kraken', …
	label: string;
	last4: string;
	kind: AccountKind;
	balance?: number; // DECLARED balance (XLSX summary sheet, reconciliation); undefined → computed balance
	/**
	 * ISO date at which the declared balance was true: later operations are
	 * added to it (patrimoine.computeAccounts). Missing on entries older than
	 * this field: the declared balance is used as is.
	 */
	balanceAt?: string;
	currency?: string; // 'EUR'
}

/** Account found by an import, with the date of its declared balance if any. */
export type RegisteredAccount = ImportedAccount & { balanceAt?: string };

/** Today's local ISO date. */
function todayIso(): string {
	const d = new Date();
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Readable account kind labels (badges, aria titles). */
export const KIND_LABELS: Record<AccountKind, string> = {
	courant: 'Compte courant',
	livret: 'Livret / épargne',
	pret: 'Crédit',
	crypto: 'Crypto',
	autre: 'Autre compte'
};

const ACCOUNTS_KEY = 'budget:accounts';

/** Loads the registry; a kind missing from storage (v8 → v9 migration) is detected again. */
function loadAccounts(): AccountInfo[] {
	if (typeof localStorage === 'undefined') return [];
	try {
		const parsed = JSON.parse(localStorage.getItem(ACCOUNTS_KEY) ?? '[]') as Partial<AccountInfo>[];
		if (!Array.isArray(parsed)) return [];
		return parsed
			.filter((a) => a && typeof a.id === 'string' && typeof a.label === 'string')
			.map((a) => ({
				id: a.id!,
				label: a.label!,
				last4: typeof a.last4 === 'string' ? a.last4 : '••••',
				kind: a.kind ?? detectAccountKind(a.label!, a.id!),
				...(typeof a.balance === 'number' ? { balance: a.balance } : {}),
				...(typeof a.balanceAt === 'string' ? { balanceAt: a.balanceAt } : {}),
				...(typeof a.currency === 'string' ? { currency: a.currency } : {})
			}));
	} catch {
		return [];
	}
}

/** Reactive registry state (badges, Patrimoine page, Dashboard card). */
export const accountState = $state({ accounts: loadAccounts() });

/** Saves the registry; when storage is unavailable it stays in memory for the session. */
function persist(): void {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accountState.accounts));
	} catch {
	}
}

/**
 * Merges discovered accounts, matched by id:
 * - a label/kind from the summary sheet is NEVER overwritten by a CSV fallback
 *   (« Compte ••7902 », kind 'autre'); a real bank label replaces a fallback one;
 * - the DECLARED balance is refreshed by every XLSX import that provides it (a
 *   CSV never does) and dated (`balanceAt` if given, otherwise the import day);
 *   a declared balance OLDER than the stored one does not overwrite it.
 */
export function registerAccounts(infos: RegisteredAccount[]): void {
	if (infos.length === 0) return;
	const list = [...accountState.accounts];
	let changed = false;
	for (const info of infos) {
		const label = info.label.replace(/\s+/g, ' ').trim();
		const isFallback = !label || label.startsWith('Compte ••');
		const kind = info.kind ?? detectAccountKind(label, info.id);
		const existing = list.find((a) => a.id === info.id);
		if (existing) {
			if (existing.label.startsWith('Compte ••') && !isFallback) {
				existing.label = label;
				existing.kind = kind;
				changed = true;
			}
			if (info.balance !== undefined) {
				const at = info.balanceAt ?? todayIso();
				if (!existing.balanceAt || at >= existing.balanceAt) {
					existing.balance = info.balance;
					existing.balanceAt = at;
					if (info.currency) existing.currency = info.currency;
					changed = true;
				}
			}
		} else {
			list.push({
				id: info.id,
				label: label || `Compte ••${info.last4}`,
				last4: info.last4,
				kind,
				...(info.balance !== undefined ? { balance: info.balance, balanceAt: info.balanceAt ?? todayIso() } : {}),
				...(info.currency ? { currency: info.currency } : {})
			});
			changed = true;
		}
	}
	if (changed) {
		accountState.accounts = list;
		persist();
	}
}

/**
 * Registers the account of a lone CSV when its id carries an 11-digit number.
 * The fallback label « Compte ••XXXX » says nothing about the kind → 'autre'
 * (deliberate: no guessing without a clue; the XLSX summary sheet will fix it
 * when available).
 */
export function registerCsvAccount(id: string): void {
	const m = /^cm-(\d{11})$/.exec(id);
	if (!m) return;
	const last4 = m[1]!.slice(-4);
	registerAccounts([{ id, label: `Compte ••${last4}`, last4, kind: 'autre' }]);
}

/** Displayed account label: registry, otherwise a readable fallback. */
export function accountLabel(id: string): string {
	const known = accountState.accounts.find((a) => a.id === id);
	if (known) return known.label;
	if (id === 'cm') return 'Compte Courant';
	if (id === 'natixis') return 'Natixis';
	if (id === 'kraken') return 'Kraken';
	const m = /^cm-(?:\d{7})(\d{4})$/.exec(id);
	if (m) return `Compte ••${m[1]}`;
	if (id.startsWith('cm-')) return `Compte ${id.slice(3)}`;
	return id;
}

/** Account kind: registry, otherwise detected from the fallback label. */
export function accountKind(id: string): AccountKind {
	const known = accountState.accounts.find((a) => a.id === id);
	if (known) return known.kind;
	return detectAccountKind(accountLabel(id), id);
}

/** Full registry with declared balances (Patrimoine page, Dashboard card). */
export function accountsWithBalances(): AccountInfo[] {
	return accountState.accounts;
}
