/** Business types of the budget dashboard. */

export interface TransactionAmount {
	amount: string;
	currency: string;
}

/** Transaction: demo JSON + extended fields coming from imports (CSV/XLSX). */
export interface Transaction {
	transaction_amount: TransactionAmount;
	booking_date: string; // "" → pending
	value_date: string; // "" → pending
	remittance_information: string[];
	credit_debit_indicator: 'CRDT' | 'DBIT';
	// ---- Extended fields (optional, imports) ----
	note?: string; // Personal note
	bank_category?: string; // Bank category ('A catégoriser' ignored on import)
	bank_subcategory?: string;
	balance_after?: number; // Balance after the operation
	checked?: boolean; // Cleared operation
	tags?: string[];
	analysis_date?: string; // Analysis date (CM export)
	// 'ofx' | 'qif' | 'camt': standard statements (statements.ts); 'cash': cash wallet entry (wallet.ts)
	source?: 'demo' | 'cm-csv' | 'cm-xlsx' | 'natixis-csv' | 'kraken' | 'kraken-csv' | 'krak-pdf' | 'portage' | 'ofx' | 'qif' | 'camt' | 'manual' | 'cash';
	/**
	 * Quick entry (source 'manual') the user split from the bank operation it was paired with: never
	 * paired automatically again.
	 */
	quick_keep?: boolean;
	/**
	 * Instalment of a quick entry paid in several times (« en 3 fois »): rank and count. The next ones
	 * wait without a value date (not counted) until the bank debit replaces them.
	 */
	instalment?: { n: number; of: number };
	/**
	 * Computed entry outside the bank (source 'portage': meal vouchers, culture vouchers, reimbursed
	 * expenses; source 'cash': cash wallet spends and write-offs), never in the balances. Imposed
	 * category for portage; for cash, the typed category, which overrides and holidays can change.
	 */
	virtual_category?: CategoryId;
	/** Subcategory of a computed entry (Swile meal, culture voucher purchase), checked against its category. */
	virtual_subcategory?: string;
	/**
	 * Originating account: 'cm' (implicit demo), 'cm-XXXXXXXXXXX' (identified Crédit Mutuel account),
	 * 'natixis', 'kraken'…
	 */
	account?: string;
	/**
	 * Rank of a strictly identical operation (dates, amount, direction, label) in its import batch:
	 * absent for the first, 1 for the second… Part of txKey: two identical coffees on the same day no
	 * longer merge.
	 */
	dup_index?: number;
}

export type CategoryId =
	| 'alimentation'
	| 'logement'
	| 'energie'
	| 'transport'
	| 'voiture'
	| 'abonnements'
	| 'loisirs'
	| 'sante'
	| 'revenus'
	| 'vacances'
	| 'impots'
	| 'epargne'
	| 'autre';

export interface Category {
	id: CategoryId;
	label: string;
	/** Categorisation keywords live in merchantDict.ts (MERCHANT_DICT). */
	color: string;
}

export interface Budget {
	categoryId: CategoryId;
	amount: number;
}
