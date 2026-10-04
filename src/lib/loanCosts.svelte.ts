import { getLoanViews, loanState, type LoanView } from './loans.svelte';
import { shiftMonth } from './loans';
import { getTransactions } from './store.svelte';
import { principalBefore, remainingCost, currentInstallment, loanInstallments, estimateRate, principalParts, type RemainingCost, type LoanParams, type Payment } from './loanCost';
import { financeSettings, type LoanSetting } from './financeSettings.svelte';

/**
 * Cost of the running loans (reactive): instalment (current account),
 * principal part (loan account), derived rate, remaining table. Shared by the
 * « Coût réel des crédits » card and the estimated end of loan accounts (real
 * amortisation: the principal part grows every month).
 */

export interface LoanCostView {
	v: LoanView;
	reglage: LoanSetting;
	echeances: Payment[];
	/** Instalments seen up to the last statement of the loan account. */
	payees: Payment[];
	paye: number;
	/** Original principal derived back from the paid instalments (null without a rate or with a short history). */
	origine: number | null;
	interetsPayes: number | null;
	tauxReleve: number | null;
	echeanceReleve: number | null;
	mensualite: number;
	capital: number;
	taux: number | null;
	p: LoanParams | null;
	cout: RemainingCost | null;
	/** Month (YYYY-MM) of the last paid or assumed-paid instalment (base of the end dates). */
	moisBase: string;
}

/** Month (YYYY-MM) of the `n`-th instalment after the base month. */
export function installmentMonth(c: Pick<LoanCostView, 'moisBase'>, n: number): string {
	return shiftMonth(c.moisBase, n);
}

/**
 * One view per running loan (a paid-off loan has no cost left). The base month
 * is the loan account's last statement plus the months elapsed since then
 * (instalments assumed paid).
 */
const costs = $derived.by((): LoanCostView[] => {
	const txs = getTransactions();
	const views = [...getLoanViews().values()].filter((v) => v.currentBalance < 0 || financeSettings.credits[v.accountId]?.capital);
	return views.map((v) => {
		const rec = loanState.loans[v.accountId];
		const setting = financeSettings.credits[v.accountId] ?? {};
		const installments = loanInstallments(txs, v.accountId, views.length === 1);
		const parts = principalParts(txs, v.accountId);
		const statementPrincipal = Math.abs(rec?.balance ?? v.currentBalance);
		const statementRate = estimateRate(installments, parts, statementPrincipal);
		const statementInstallment = currentInstallment(installments);
		const monthlyPayment = setting.echeance ?? statementInstallment ?? v.effectivePayment;
		const capital = setting.capital ?? Math.abs(v.currentBalance);
		const rate = setting.taux ?? statementRate;
		const p = rate !== null && capital > 0 ? { capital, mensualite: monthlyPayment, taux: rate } : null;
		const cost = p ? remainingCost(p) : null;
		const paidInstallments = rec ? installments.filter((e) => e.date <= rec.lastSeenAt) : installments;
		const paidTotal = Math.round(paidInstallments.reduce((s, e) => s + e.montant, 0) * 100) / 100;
		const originalPrincipal = p && paidInstallments.length >= 3 && setting.capital === undefined ? principalBefore({ capital: statementPrincipal, mensualite: monthlyPayment, taux: p.taux }, paidInstallments.length) : null;
		const baseMonth = shiftMonth((rec?.lastSeenAt ?? v.estimatedAt).slice(0, 7), v.monthsElapsed);
		return { v, reglage: setting, echeances: installments, payees: paidInstallments, paye: paidTotal, origine: originalPrincipal, interetsPayes: originalPrincipal !== null ? Math.max(0, paidTotal - (originalPrincipal - statementPrincipal)) : null, tauxReleve: statementRate, echeanceReleve: statementInstallment, mensualite: monthlyPayment, capital, taux: rate, p, cout: cost, moisBase: baseMonth };
	});
});

export function getLoanCosts(): LoanCostView[] {
	return costs;
}

/** Month of the last instalment (YYYY-MM) from the real amortisation, null when the rate is unknown. */
export function amortizedEndMonth(accountId: string): string | null {
	const c = costs.find((x) => x.v.accountId === accountId);
	return c?.cout ? installmentMonth(c, c.cout.echeances) : null;
}
