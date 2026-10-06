import { categorize } from './categories';
import { budgetState } from './budget.svelte';
import { getMerchantCategoryMap } from './store.svelte';
import { getBudgetTransactions } from './transfers.svelte';
import { monthTotals } from './totals';
import { getLoanViews, loanState } from './loans.svelte';
import { getCryptoTotal } from './wealth.svelte';
import { getInvestments } from './investments.svelte';
import { monthsBefore } from './priceItems.svelte';
import { LONG_TERM_INFLATION } from './inflation';
import { averageSavings, realReturn } from './realReturn';

/**
 * Inputs shared by the net-worth projection and the what-if simulator: usual monthly income,
 * spending and balance over the last 12 complete months (loan account rows left out, their
 * principal counted once in loanPrincipal), and the real return of the current mix.
 */

const currentMonth = new Date().toISOString().slice(0, 7);

const averages = $derived.by(() => {
	const txs = getBudgetTransactions().filter((t) => !(t.account && t.account in loanState.loans));
	const mm = getMerchantCategoryMap();
	const catOf = (tx: Parameters<typeof categorize>[0]) => categorize(tx, budgetState.overrides, undefined, mm);
	const monthsWithData = new Set(txs.map((t) => t.booking_date.slice(0, 7)));
	const totals = monthsBefore(currentMonth, 12)
		.filter((m) => monthsWithData.has(m))
		.map((m) => monthTotals(txs, m, catOf));
	return {
		income: averageSavings(totals.map((t) => t.income)),
		expenses: averageSavings(totals.map((t) => t.expenses)),
		net: averageSavings(totals.map((t) => t.net)),
		months: totals.length
	};
});

const loanPrincipal = $derived(Math.round([...getLoanViews().values()].filter((l) => l.monthsRemaining > 0).reduce((s, l) => s + l.effectivePayment, 0)));

const autoRealRate = $derived.by(() => {
	const investments = getInvestments();
	const assetsTotal = investments.reduce((s, p) => s + p.montant, 0) + getCryptoTotal();
	const rate = assetsTotal > 0 ? investments.reduce((s, p) => s + p.montant * p.taux, 0) / assetsTotal : 0;
	return Math.round(realReturn(rate, LONG_TERM_INFLATION) * 10) / 10;
});

/** Average monthly income, spending and balance (€) over the last 12 complete months with data. */
export function getBudgetAverages(): { income: number; expenses: number; net: number; months: number } {
	return averages;
}

/** Loan principal repaid each month: debt goes down, wealth goes up. */
export function getLoanPrincipal(): number {
	return loanPrincipal;
}

/** Real return of the current mix (crypto and current accounts at 0 %, long-term inflation). */
export function getAutoRealRate(): number {
	return autoRealRate;
}
