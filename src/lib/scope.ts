import type { Transaction } from './types';

/**
 * Operation scopes: the SINGLE source (the 2026-10-03 review found 5 diverging definitions of
 * 'outside the bank'). Pure module.
 *
 * - Bank account: everything except Kraken (platform movements), Natixis (employee savings) and
 *   the Krak card (paid from the Kraken balance, already reflected in the crypto value). Base of
 *   the balances and of the balance curve.
 * - Wealth line: Kraken / Natixis, value movements and never cash flows: excluded from spending
 *   and income. Krak card spending, however, is real spending (budget).
 */

/** Accounts whose lines are NOT bank-account flows. */
export const NON_BANK_ACCOUNTS: ReadonlySet<string> = new Set(['kraken', 'natixis', 'krak-card']);

/** Wealth accounts: their lines are neither spending nor income. */
export const WEALTH_ACCOUNTS: ReadonlySet<string> = new Set(['kraken', 'natixis']);

/** Kraken mentioned in a label (transfers to/from the platform). */
export const KRAKEN_RE = /\bKRAKEN\b/i;

/** Effective account of an operation (demo fallback 'cm'). */
export function accountOf(tx: Transaction): string {
	return tx.account ?? 'cm';
}

/** Operation of a bank account (balances, balance curve, projection). */
export function isBankTx(tx: Transaction): boolean {
	return !NON_BANK_ACCOUNTS.has(accountOf(tx));
}

/** Wealth line (Kraken/Natixis): outside spending and income. */
export function isWealthLine(tx: Transaction): boolean {
	return WEALTH_ACCOUNTS.has(accountOf(tx));
}
