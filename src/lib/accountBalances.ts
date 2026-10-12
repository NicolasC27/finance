import type { Transaction } from './types';
import type { AccountInfo } from './accounts.svelte';
import { isPending, signedAmount } from './data';
import { NON_BANK_ACCOUNTS, isBankTx } from './scope';
import { detectAccountKind, type AccountKind } from './csvCore';

/**
 * Detected accounts and their balances (pure, testable): what Patrimoine lists and what the
 * « Solde actuel » of the home page adds up.
 */

const r2 = (v: number): number => Math.round(v * 100) / 100;

/** Sources of a real bank statement (Crédit Mutuel CSV/XLSX, OFX/QIF/CAMT statements). */
const IMPORTED_BANK_SOURCES: ReadonlySet<Transaction['source']> = new Set(['cm-csv', 'cm-xlsx', 'ofx', 'qif', 'camt']);

/**
 * Transaction of the implicit generic account ('cm') outside imports: demo data, excluded
 * from the detected accounts (it still contributes to the total through the generic flows).
 */
export function isImplicitDemo(tx: Transaction): boolean {
	return (tx.account ?? 'cm') === 'cm' && !IMPORTED_BANK_SOURCES.has(tx.source);
}

export interface AccountView {
	id: string;
	label: string;
	last4: string;
	kind: AccountKind;
	/**
	 * DECLARED balance (XLSX summary sheet / reconciliation) + flows after its date, when it is the
	 * freshest anchor of the account; undefined otherwise.
	 */
	declared?: number;
	/** Computed balance: last known balance_after + the operations booked after it, else cumulative flows. */
	computed: number;
	/** Where the computation comes from: the statement Balance column, or the plain sum of imported flows. */
	computedFrom: 'balance' | 'flow';
	/** Balance used: the declared one when it is the freshest, the computed one otherwise. */
	balance: number;
	/** Signed sum of the current month. */
	monthVar: number;
	txCount: number;
}

/** Readable fallback label when the registry does not know the id. */
function fallbackAccountLabel(id: string): string {
	if (id === 'cm') return 'Compte Courant';
	const m = /^cm-(?:\d{7})(\d{4})$/.exec(id);
	if (m) return `Compte ••${m[1]}`;
	if (id.startsWith('cm-')) return `Compte ${id.slice(3)}`;
	return id;
}

/**
 * Detected-accounts view: distinct ids of imported transactions ∪ registry (implicit demo and
 * Natixis/Kraken excluded: they have their own cards), kind + declared balance from the registry,
 * computed balance, current-month change and number of operations. A registry account with no
 * remaining transaction shows 0 operations (entry kept).
 *
 * The balance starts from the freshest dated anchor and adds the operations booked after it, and
 * the quick entries of its very day (typed after the import or the reconciliation); pending ones
 * never:
 * - the statement's last balance_after (latest date wins; on equal dates the FIRST one met wins,
 *   CM exports are reverse-chronological);
 * - a dated declared balance, when it is not older than that balance_after.
 * An undated declared balance (registry older than `balanceAt`) is only a fallback for an account
 * without any balance_after: it used to win forever and froze the home balance. Non-bank accounts
 * (Kraken, Natixis, Krak card) never come from the registry.
 */
export function computeAccounts(txs: Transaction[], registry: AccountInfo[], now = new Date()): AccountView[] {
	const nowKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
	interface Acc {
		flow: number;
		monthVar: number;
		txCount: number;
		lastAt: string;
		lastBalance: number | null;
		ops: { date: string; amount: number; manual: boolean }[];
	}
	const byAccount = new Map<string, Acc>();
	const ensure = (id: string): Acc => {
		let acc = byAccount.get(id);
		if (!acc) {
			acc = { flow: 0, monthVar: 0, txCount: 0, lastAt: '', lastBalance: null, ops: [] };
			byAccount.set(id, acc);
		}
		return acc;
	};
	for (const tx of txs) {
		if (!isBankTx(tx)) continue;
		if (isImplicitDemo(tx)) continue;
		const acc = ensure(tx.account ?? 'cm');
		if (isPending(tx)) continue;
		const amount = signedAmount(tx);
		acc.txCount++;
		acc.flow = r2(acc.flow + amount);
		acc.ops.push({ date: tx.booking_date, amount, manual: tx.source === 'manual' });
		if (tx.booking_date.slice(0, 7) === nowKey) acc.monthVar = r2(acc.monthVar + amount);
		if (tx.balance_after !== undefined && tx.booking_date > acc.lastAt) {
			acc.lastAt = tx.booking_date;
			acc.lastBalance = tx.balance_after;
		}
	}
	for (const info of registry) {
		if (NON_BANK_ACCOUNTS.has(info.id)) continue;
		ensure(info.id);
	}
	return [...byAccount.entries()]
		.map(([id, acc]) => {
			const reg = registry.find((a) => a.id === id);
			const label = reg?.label ?? fallbackAccountLabel(id);
			const after = (from: string) => r2(acc.ops.reduce((sum, o) => (o.date > from || (o.manual && o.date === from) ? sum + o.amount : sum), 0));
			const fromStatement = acc.lastBalance !== null;
			const computed = fromStatement ? r2(acc.lastBalance! + after(acc.lastAt)) : acc.flow;
			const last4 = reg?.last4 ?? (/^cm-(?:\d{7})(\d{4})$/.exec(id)?.[1] || '••••');
			let declared: number | undefined;
			if (reg?.balance !== undefined) {
				if (reg.balanceAt) {
					if (!fromStatement || reg.balanceAt >= acc.lastAt) declared = r2(reg.balance + after(reg.balanceAt));
				} else if (!fromStatement) declared = reg.balance;
			}
			return {
				id,
				label,
				last4,
				kind: reg?.kind ?? detectAccountKind(label, id),
				...(declared !== undefined ? { declared } : {}),
				computed,
				computedFrom: (fromStatement ? 'balance' : 'flow') as AccountView['computedFrom'],
				balance: declared ?? computed,
				monthVar: acc.monthVar,
				txCount: acc.txCount
			};
		})
		.sort((a, b) => b.balance - a.balance);
}
