import { persistJson } from './storage';
import { getNetWorth } from './wealth.svelte';
import { financeSettings } from './financeSettings.svelte';
import { getAutoRealRate, getBudgetAverages, getLoanPrincipal } from './projectionBase.svelte';
import { readScenarios, readStudy, type Baseline, type Scenario, type StudySettings } from './whatIf';
import type { JobType } from './loanStudy';
import { portageState } from './portage.svelte';
import { getLoanCosts } from './loanCosts.svelte';
import { getAccountsView, getEmployeeSavingsTotal } from './wealth.svelte';
import { getBudgetTransactions } from './transfers.svelte';
import { getMerchantCategoryMap } from './store.svelte';
import { budgetState } from './budget.svelte';
import { subcategorize } from './subcategories';
import { signedAmount } from './data';
import { monthsBefore } from './priceItems.svelte';

/**
 * What-if simulator, app side: the baseline read from the real data (never written), and the
 * saved scenarios (`budget:scenarios`), the only thing the simulator stores.
 */

const KEY = 'budget:scenarios';

function load(): Scenario[] {
	if (typeof localStorage === 'undefined') return [];
	try {
		return readScenarios(JSON.parse(localStorage.getItem(KEY) ?? '[]'));
	} catch {
		return [];
	}
}

export const scenariosState = $state({ list: load() });

const PROFILE_KEY = 'budget:loan-profile';

/** Household profile of the loan study, shared by every scenario (older scenarios carried their own copy). */
function loadProfile(): StudySettings {
	if (typeof localStorage === 'undefined') return readStudy(null);
	try {
		const raw = JSON.parse(localStorage.getItem(PROFILE_KEY) ?? 'null') as unknown;
		return readStudy(raw ?? scenariosState.list.find((s) => s.study)?.study ?? null);
	} catch {
		return readStudy(null);
	}
}

export const profileState = $state({ study: loadProfile() });

/** Changes the household profile (income, rent, job, household) and saves it. */
export function setProfile(patch: Partial<StudySettings>): void {
	profileState.study = { ...profileState.study, ...patch };
	persistJson(PROFILE_KEY, profileState.study);
}

const baseline = $derived.by((): Baseline => {
	const a = getBudgetAverages();
	return { income: a.income, expenses: a.expenses, loanPrincipal: getLoanPrincipal(), netWorth: getNetWorth(), realRate: financeSettings.projection.reel ?? getAutoRealRate() };
});

export function getBaseline(): Baseline {
	return baseline;
}

/** Saves (adds or replaces) a scenario. */
export function saveScenario(s: Scenario): void {
	const copy: Scenario = JSON.parse(JSON.stringify(s));
	scenariosState.list = scenariosState.list.some((x) => x.id === s.id) ? scenariosState.list.map((x) => (x.id === s.id ? copy : x)) : [...scenariosState.list, copy];
	persistJson(KEY, scenariosState.list);
}

export function removeScenario(id: string): void {
	scenariosState.list = scenariosState.list.filter((x) => x.id !== id);
	persistJson(KEY, scenariosState.list);
}

export interface StudyDefaults {
	/** Net salary before tax (€/month) and where it comes from. */
	salary: number;
	salarySource: string;
	/** Running loans (€/month). */
	existing: { label: string; amount: number }[];
	rent: number;
	job: JobType;
	seniority: number;
	/** Current and savings accounts, usual monthly spending (emergency fund). */
	savings: number;
	monthlySpending: number;
	/** Employee savings (released early for a main residence). */
	employeeSavings: number;
}

const monthIndex = (ym: string) => Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1;

const studyDefaults = $derived.by((): StudyDefaults => {
	const now = new Date().toISOString().slice(0, 7);
	const slips = [...portageState.data.paies].filter((p) => p.mois < now || p.mois === now).sort((a, b) => a.mois.localeCompare(b.mois));
	const allNet = slips.filter((p) => typeof p.netAvantImpot === 'number' && p.netAvantImpot > 0);
	const partialFirst = allNet.length >= 2 && allNet[0]!.netAvantImpot! < 0.8 * allNet[1]!.netAvantImpot!;
	const withNet = (partialFirst ? allNet.slice(1) : allNet).slice(-3);
	const avg = getBudgetAverages();
	const salary = withNet.length ? Math.round(withNet.reduce((s, p) => s + p.netAvantImpot!, 0) / withNet.length) : avg.income;
	const mm = getMerchantCategoryMap();
	const recent = monthsBefore(now, 3);
	const rentTotal = getBudgetTransactions()
		.filter((t) => recent.includes(t.booking_date.slice(0, 7)) && signedAmount(t) < 0 && subcategorize(t, budgetState.overrides, undefined, mm) === 'loyer-charges')
		.reduce((s, t) => s - signedAmount(t), 0);
	return {
		salary,
		salarySource: withNet.length ? `net avant impôt des ${withNet.length} dernières fiches de paie${partialFirst ? ' (premier mois incomplet écarté)' : ''}` : `revenus moyens de ${avg.months} mois`,
		existing: getLoanCosts().filter((c) => c.mensualite > 0).map((c) => ({ label: c.v.label, amount: Math.round(c.mensualite * 100) / 100 })),
		rent: Math.round(rentTotal / 3),
		job: slips.length ? 'portage' : 'cdi',
		seniority: slips.length ? Math.max(0, monthIndex(now) - monthIndex(slips[0]!.mois)) : 24,
		savings: Math.round(getAccountsView().filter((a) => (a.kind === 'courant' || a.kind === 'livret') && a.balance > 0).reduce((s, a) => s + a.balance, 0)),
		monthlySpending: avg.expenses,
		employeeSavings: Math.round(getEmployeeSavingsTotal())
	};
});

/** Household, job and loans read from the app's data, used when the simulation leaves them empty. */
export function getStudyDefaults(): StudyDefaults {
	return studyDefaults;
}
