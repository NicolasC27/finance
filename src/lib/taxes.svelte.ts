import type { TaxNotice } from './pdfTax';
import { getTransactions } from './store.svelte';
import { signedAmount } from './data';

/**
 * Imported tax notices (runes store, persisted in `budget:tax-notices`), one per
 * income year. A supplementary or corrective notice replaces the initial one of
 * the same year (it holds the final amount).
 */

const KEY = 'budget:tax-notices';
const canStore = typeof localStorage !== 'undefined';

function load(): Record<string, TaxNotice> {
	if (!canStore) return {};
	try {
		const parsed = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, TaxNotice>;
		return parsed && typeof parsed === 'object' ? parsed : {};
	} catch {
		return {};
	}
}

export const taxState = $state({
	notices: load()
});

function persist(): void {
	if (!canStore) return;
	try {
		localStorage.setItem(KEY, JSON.stringify(taxState.notices));
	} catch {
	}
}

/** Stores a notice; returns false when it is ignored (an initial notice while a supplementary one exists). Unavailable storage is ignored. */
export function saveTaxNotice(n: TaxNotice): boolean {
	const existing = taxState.notices[n.year];
	if (existing && existing.supplementary && !n.supplementary) return false;
	taxState.notices = { ...taxState.notices, [n.year]: n };
	persist();
	return true;
}

export function removeTaxNotice(year: number): void {
	const next = { ...taxState.notices };
	delete next[year];
	taxState.notices = next;
	persist();
}

/** Notices per income year, newest first. */
export function getTaxNotices(): TaxNotice[] {
	return Object.values(taxState.notices).sort((a, b) => b.year - a.year);
}

/** Is there a notice for this income year? */
export function hasTaxNotice(year: number): boolean {
	return taxState.notices[year] !== undefined;
}

const DGFIP_RE = /DIRECTION G[ÉE]N[ÉE]RALE DES FINANCES|DGFIP|TRESOR PUBLIC|IMPOT(?!S? SUR)|SOLDE IMPOT|DIRECTION GENERALE DE/i;

/**
 * LOCAL taxes and fines, also collected by the DGFIP but unrelated to the
 * income tax of the notice: property tax, housing tax, CFE, TV licence, fines
 * (ANTAI). Excluded from the notice's « Prélevé » column.
 */
const LOCAL_TAX_RE = /FONCI[EÈ]R|HABITATION|\bT\.?F\b|\bT\.?H\b|\bCFE\b|REDEVANCE|AMENDE|ANTAI|CONTRAVENTION/i;

/** Is the transaction an income-tax payment (DGFIP, excluding local taxes and fines)? */
export function isIncomeTaxPayment(label: string): boolean {
	return DGFIP_RE.test(label) && !LOCAL_TAX_RE.test(label);
}

/** Income-tax payments seen on bank statements, by CALENDAR year of payment (debits only). */
export function getDgfipPaidByYear(): Record<number, number> {
	const out: Record<number, number> = {};
	for (const tx of getTransactions()) {
		if (!tx.booking_date) continue;
		const label = tx.remittance_information.join(' ');
		if (!isIncomeTaxPayment(label)) continue;
		const a = signedAmount(tx);
		if (a >= 0) continue;
		const y = Number(tx.booking_date.slice(0, 4));
		out[y] = Math.round(((out[y] ?? 0) - a) * 100) / 100;
	}
	return out;
}
