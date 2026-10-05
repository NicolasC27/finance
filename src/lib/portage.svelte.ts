/**
 * Portage salarial (`budget:portage`): reactive store. Imported documents (activity account,
 * payslips, expense reports), matching choices, culture vouchers; computed entries for the budget
 * (src/lib/portage.ts), added to getBudgetTransactions().
 */

import type { CategoryId } from './types';
import { persistJson } from './storage';
import { categorize, txKey } from './categories';
import { budgetState } from './budget.svelte';
import { getMerchantCategoryMap, getTransactions } from './store.svelte';
import { taxAlerts, pendingMoney, portageEntries, mergePortageDocument, readPortageDocument, emptyPortage, portageTaxProvisions, matchAllReports, targetRate, type ExpenseLine, type ExpenseReport, type PortageData, type TaxSetting, SWILE_DAILY_CAP } from './portage';

export const PORTAGE_KEY = 'budget:portage';

const canStore = typeof localStorage !== 'undefined';

function load(): PortageData {
	if (!canStore) return emptyPortage();
	try {
		const p = JSON.parse(localStorage.getItem(PORTAGE_KEY) ?? 'null') as Partial<PortageData> | null;
		if (!p || typeof p !== 'object') return emptyPortage();
		const tax: TaxSetting = {
			...(typeof p.impot?.provision === 'boolean' ? { provision: p.impot.provision } : {}),
			...(typeof p.impot?.taux === 'number' && Number.isFinite(p.impot.taux) ? { taux: p.impot.taux } : {})
		};
		return {
			...(p.compte ? { compte: p.compte } : {}),
			...(Object.keys(tax).length ? { impot: tax } : {}),
			paies: Array.isArray(p.paies) ? p.paies : [],
			notes: Array.isArray(p.notes) ? p.notes : [],
			choix: p.choix && typeof p.choix === 'object' ? p.choix : {},
			cheques: {
				credits: Array.isArray(p.cheques?.credits) ? p.cheques.credits : [],
				depenses: Array.isArray(p.cheques?.depenses) ? p.cheques.depenses : []
			},
			swile: Array.isArray(p.swile) ? p.swile : [],
			...(typeof p.swilePlafond === 'number' && p.swilePlafond > 0 ? { swilePlafond: p.swilePlafond } : {})
		};
	} catch {
		return emptyPortage();
	}
}

export const portageState = $state({ data: load() });

function persist(): void {
	if (canStore) persistJson(PORTAGE_KEY, portageState.data);
}

const catOf = (tx: Parameters<typeof categorize>[0]): CategoryId => categorize(tx, budgetState.overrides, undefined, getMerchantCategoryMap());

const entries = $derived(portageEntries(portageState.data, getTransactions(), txKey, catOf));
const matches = $derived(matchAllReports(portageState.data, getTransactions(), txKey));
const pending = $derived(pendingMoney(portageState.data, getTransactions()));
const provisions = $derived(portageTaxProvisions(portageState.data));
const target = $derived(targetRate(portageState.data));
const alerts = $derived(taxAlerts(portageState.data.paies, { provisions }));

/** Alerts on the withholding tax (rate increase, rate too low for the salary). */
export function getTaxAlerts() {
	return alerts;
}

/** Tax set aside each month when the withheld rate is too low ('Impôts' expense in the budget). */
export function getPortageTaxProvisions() {
	return provisions;
}

/** Target rate of the provision (setting, else neutral rate of the last salary). */
export function getTargetRate() {
	return target;
}

/** Provision setting: `taux: null` = back to the automatic neutral rate. */
export function setTaxSetting(r: { provision?: boolean; taux?: number | null }): void {
	const tax: TaxSetting = { ...portageState.data.impot };
	if (r.provision !== undefined) tax.provision = r.provision;
	if (r.taux === null) delete tax.taux;
	else if (r.taux !== undefined) tax.taux = r.taux;
	portageState.data = { ...portageState.data, impot: tax };
	persist();
}

/** Computed entries (meal vouchers, culture vouchers, expenses, tax provision): budget only, never the balances. */
export function getPortageEntries() {
	return entries;
}

export function getMatches() {
	return matches;
}

export function getPendingMoney() {
	return pending;
}

/** Expense report of a matched card purchase (operation detail). */
export function noteOfTx(key: string): { note: ExpenseReport; ligne: ExpenseLine } | undefined {
	for (const report of portageState.data.notes) {
		const r = matches.get(report.numero)?.find((x) => x.etat === 'rapprochee' && x.tx && txKey(x.tx) === key);
		if (r) return { note: report, ligne: r.ligne };
	}
	return undefined;
}

/** Imports InfoPortage PDFs (type recognised automatically); returns a summary per file. */
export async function importPortagePdf(files: File[]): Promise<string[]> {
	const { extractPdfPages } = await import('./pdfNatixis');
	const summaries: string[] = [];
	for (const f of files) {
		try {
			const doc = readPortageDocument(await extractPdfPages(await f.arrayBuffer()));
			if ('error' in doc) {
				summaries.push(`${f.name} : ${doc.error}`);
				continue;
			}
			const r = mergePortageDocument(portageState.data, doc);
			portageState.data = r.data;
			summaries.push(r.resume);
		} catch (e) {
			summaries.push(`${f.name} : lecture impossible (${e instanceof Error ? e.message : String(e)})`);
		}
	}
	persist();
	return summaries;
}

/** Manual choice for an expense line: operation key, 'aucune', 'indemnite'; null = automatic. */
export function chooseMatch(lineId: string, value: string | null): void {
	const choices = { ...portageState.data.choix };
	if (value === null) delete choices[lineId];
	else choices[lineId] = value;
	portageState.data = { ...portageState.data, choix: choices };
	persist();
}

const uid = (p: string) => `${p}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;

export function addCultureVouchers(c: { date: string; montant: number; libelle: string }): void {
	const vouchers = portageState.data.cheques;
	portageState.data = { ...portageState.data, cheques: { ...vouchers, credits: [...vouchers.credits, { id: uid('cc'), ...c }] } };
	persist();
}

export function addVoucherSpend(d: { date: string; montant: number; libelle: string; categoryId: CategoryId; subId?: string }): string {
	const vouchers = portageState.data.cheques;
	const id = uid('cd');
	portageState.data = { ...portageState.data, cheques: { ...vouchers, depenses: [...vouchers.depenses, { id, ...d }] } };
	persist();
	return id;
}

/** Meal paid with the Swile card (quick entry). Returns its id. */
export function addSwileSpend(d: { date: string; montant: number; libelle: string; categoryId: CategoryId; subId?: string }): string {
	const id = uid('sw');
	portageState.data = { ...portageState.data, swile: [...(portageState.data.swile ?? []), { id, ...d }] };
	persist();
	return id;
}

export function removeSwileSpend(id: string): void {
	portageState.data = { ...portageState.data, swile: (portageState.data.swile ?? []).filter((x) => x.id !== id) };
	persist();
}

/** Daily Swile cap (€). */
export function swileCap(): number {
	return portageState.data.swilePlafond ?? SWILE_DAILY_CAP;
}

export function setSwileCap(v: number | null): void {
	const next = { ...portageState.data };
	if (v === null || !(v > 0)) delete next.swilePlafond;
	else next.swilePlafond = Math.round(v * 100) / 100;
	portageState.data = next;
	persist();
}

/** Already paid in Swile on a given day (detailed meals). */
export function swileSpentOn(date: string): number {
	return Math.round((portageState.data.swile ?? []).filter((s) => s.date === date).reduce((s, x) => s + x.montant, 0) * 100) / 100;
}

/** Meal vouchers on the payslips (Swile choice offered in the quick entry). */
export function hasSwile(): boolean {
	return portageState.data.paies.some((p) => (p.titresRestaurant?.nombre ?? 0) > 0);
}

export function removeVoucher(id: string): void {
	const c = portageState.data.cheques;
	portageState.data = { ...portageState.data, cheques: { credits: c.credits.filter((x) => x.id !== id), depenses: c.depenses.filter((x) => x.id !== id) } };
	persist();
}

/** Culture voucher balance (credits − spending). */
export function cultureVoucherBalance(): number {
	const c = portageState.data.cheques;
	return Math.round((c.credits.reduce((s, x) => s + x.montant, 0) - c.depenses.reduce((s, x) => s + x.montant, 0)) * 100) / 100;
}
