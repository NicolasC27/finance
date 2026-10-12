import { budgetState } from './budget.svelte';
import { getBudgetTransactions } from './transfers.svelte';
import { isPending, isPlannedInstalment, signedAmount, sortByDate } from './data';
import { detectRecurring, forecastRefIso } from './forecast';
import { getMerchantCategoryMap } from './store.svelte';
import { categorize, txKey } from './categories';
import { flowKind } from './flow';
import { amortizedEndMonth, getLoanCosts } from './loanCosts.svelte';
import { getTaxNotices } from './taxes.svelte';
import { assetsState } from './assets.svelte';
import { getCarExpenses, vehicleSheet } from './car.svelte';
import { natixisState } from './natixisHoldings.svelte';
import { goalsState } from './goals.svelte';
import { isModuleActive } from './modules.svelte';
import { addDays, isLoanLabel, buildSchedule, carItems, goalItems, instalmentItems, loanItems, recurringItems, rentItems, rentSource, savingsItems, taxItems, VARIABLE_SUBS, type ScheduleItem } from './schedule';
import { subcategorize } from './subcategories';

/**
 * Schedule, app side: reads every source (detected direct debits, payments in several times,
 * loans, tax notices, vehicles, employee savings, goals) and builds the merged list over the
 * longest horizon once; pages cut it.
 */

export const MAX_HORIZON = 365;

const confirmed = $derived(getBudgetTransactions().filter((tx) => !isPending(tx) && tx.source !== 'portage'));
const fromIso = $derived(forecastRefIso(sortByDate(confirmed)[confirmed.length - 1]?.booking_date ?? ''));

const schedule = $derived.by((): ScheduleItem[] => {
	const from = fromIso;
	if (!from) return [];
	const to = addDays(from, MAX_HORIZON);
	const recurring = detectRecurring(confirmed, budgetState.overrides, from, getMerchantCategoryMap())
		.filter((r) => r.kind === 'debit' && r.active && r.fixed && flowKind(r.categoryId) === 'expense' && !VARIABLE_SUBS.has(r.subId ?? ''))
		.map((r) => ({ key: r.key, label: r.label, amount: r.amount, cadence: r.cadence, nextDate: r.nextDate, confidence: r.confidence, tax: r.categoryId === 'impots', loan: r.categoryId !== 'impots' && isLoanLabel(r.label), categoryId: r.categoryId }));
	const loans = getLoanCosts().map((c) => ({
		accountId: c.v.accountId,
		label: c.v.label,
		payment: c.mensualite,
		lastPaymentDate: [...c.echeances].sort((a, b) => a.date.localeCompare(b.date)).at(-1)?.date ?? null,
		endMonth: amortizedEndMonth(c.v.accountId) ?? (c.v.monthsRemaining > 0 ? c.v.endMonth : null)
	}));
	const vehicles = isModuleActive('voiture') ? assetsState.biens.filter((b) => b.type === 'vehicule').sort((a, b) => b.purchaseDate.localeCompare(a.purchaseDate)) : [];
	const insuranceSince = getCarExpenses().filter((e) => e.sub === 'assurance-auto' && e.montant > 0).map((e) => e.date).sort()[0] ?? null;
	const cars = vehicles.map((b, i) => ({ id: b.id, name: b.name, milestones: vehicleSheet(b, from).etapes.filter((m) => m.id !== 'releve'), insuranceSince: i === 0 ? insuranceSince : null }));
	const mm = getMerchantCategoryMap();
	const rentPayments = confirmed
		.filter((t) => signedAmount(t) < 0 && subcategorize(t, budgetState.overrides, undefined, mm) === 'loyer-charges')
		.map((t) => ({ date: t.booking_date, amount: -signedAmount(t) }));
	const instalments = getBudgetTransactions()
		.filter(isPlannedInstalment)
		.map((t) => ({ key: txKey(t), date: t.booking_date, label: t.remittance_information.join(' '), amount: Math.abs(signedAmount(t)), n: t.instalment!.n, of: t.instalment!.of, categoryId: categorize(t, budgetState.overrides, undefined, mm) }));
	return buildSchedule(
		[
			rentItems(rentSource(rentPayments, from), from, to),
			recurringItems(recurring, from, to),
			instalmentItems(instalments, from, to),
			loanItems(loans, addDays(from, -5), to),
			taxItems(getTaxNotices(), from, to),
			carItems(cars, from, to),
			savingsItems(natixisState.holdings?.holdings ?? [], from, to),
			goalItems(goalsState.goals, from, to)
		],
		from,
		to
	);
});

/** Reference day of the schedule (today, or the last operation when it is later). */
export function getScheduleFrom(): string {
	return fromIso;
}

/** Merged deadlines from the reference day over `days` days. */
export function getSchedule(days: number = MAX_HORIZON): ScheduleItem[] {
	if (!fromIso) return [];
	const to = addDays(fromIso, days);
	return days >= MAX_HORIZON ? schedule : schedule.filter((i) => i.date <= to);
}
