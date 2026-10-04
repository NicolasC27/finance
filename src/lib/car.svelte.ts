/**
 * Car: operations of the Voiture category ready for the vehicle sheet (src/lib/vehicle.ts),
 * shared by the Voiture page and the AI analysis.
 */

import type { CategoryId } from './types';
import type { Asset } from './assets';
import { categorize, naturalCategory, txKey } from './categories';
import { subcategorize } from './subcategories';
import { signedAmount } from './data';
import { budgetState } from './budget.svelte';
import { rulesState } from './rules.svelte';
import { getMerchantCategoryMap } from './store.svelte';
import { getBudgetTransactions } from './transfers.svelte';
import { getLoanCosts, type LoanCostView } from './loanCosts.svelte';
import { principalBefore } from './loanCost';
import { monthlyCost, estimateKm, kmPerYear, kmPoints, nextMilestones, pendingProposal, retainedValue, vehicleValue, type CarExpense } from './vehicle';
import { modulesState } from './modules.svelte';

/** Voiture operations of the budget (fuel and tolls reclassified as Vacances included: they are still a car cost). */
const expenses = $derived.by((): CarExpense[] => {
	const overrides = budgetState.overrides;
	const rules = rulesState.rules;
	const mm = getMerchantCategoryMap();
	const out: CarExpense[] = [];
	for (const tx of getBudgetTransactions()) {
		let cat: CategoryId = categorize(tx, overrides, rules, mm);
		let ov = overrides;
		if (cat === 'vacances' && naturalCategory(tx, mm) === 'voiture') {
			cat = 'voiture';
			ov = { ...overrides, [txKey(tx)]: 'voiture' };
		}
		if (cat !== 'voiture') continue;
		out.push({ date: tx.booking_date, montant: -signedAmount(tx), sub: subcategorize(tx, ov, rules, mm), key: txKey(tx) });
	}
	return out;
});

export function getCarExpenses(): CarExpense[] {
	return expenses;
}

/**
 * Interest paid on the payments seen: from the 'Coût réel des crédits' card; otherwise (capital
 * entered by hand, so no original capital traced back) recomputed from the current capital, the
 * payment and the rate.
 */
function interestPaid(c: LoanCostView): number | null {
	if (c.interetsPayes !== null) return c.interetsPayes;
	if (!c.p || c.payees.length < 3) return null;
	return Math.max(0, c.paye - (principalBefore(c.p, c.payees.length) - c.p.capital));
}

/**
 * Interest share of the 'Crédit auto' payments: that of the tracked loan ('Coût réel des crédits'
 * card) whose instalments are these payments, at least one in two on the same date with the same
 * amount. null if no loan matches or its rate is unknown.
 */
const interestShare = $derived.by((): number | null => {
	const installments = expenses.filter((d) => d.sub === 'credit-auto');
	if (!installments.length) return null;
	const keyOf = (date: string, amount: number) => `${date}|${amount.toFixed(2)}`;
	const wanted = new Set(installments.map((d) => keyOf(d.date, d.montant)));
	let best: { part: number; communes: number } | null = null;
	for (const c of getLoanCosts()) {
		const interest = interestPaid(c);
		if (interest === null || c.paye <= 0) continue;
		const matches = c.echeances.filter((e) => wanted.has(keyOf(e.date, e.montant))).length;
		if (matches * 2 >= installments.length && (!best || matches > best.communes)) best = { part: interest / c.paye, communes: matches };
	}
	return best ? Math.min(1, Math.max(0, best.part)) : null;
});

/**
 * Full sheet of a vehicle at a date (Voiture page, AI export); today's odometer = last reading +
 * km estimated since (pace, fuel, tolls). The Voiture options (confirmation, theoretical
 * depreciation, reminder delay, loss of value in the cost) shape the value and the cost.
 */
export function vehicleSheet(b: Asset, today: string) {
	const points = kmPoints(b);
	const estimation = estimateKm(points, expenses, today);
	const options = modulesState.car;
	return {
		points,
		km: kmPerYear(points, today),
		kmAujourdhui: estimation?.km ?? null,
		estimation,
		cout: monthlyCost(b, expenses, today, { partInterets: interestShare, depreciation: options.depreciation, countLoss: options.countValueLoss }),
		etapes: nextMilestones(b, expenses, today, estimation?.km),
		valeur: vehicleValue(b, today, options.depreciation),
		retenue: retainedValue(b, today, { confirmation: options.confirmValue, depreciation: options.depreciation, revalidateMonths: options.revalidateMonths }),
		proposition: pendingProposal(b)
	};
}
