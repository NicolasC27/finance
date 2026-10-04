import { getAccountsView, getEmployeeSavingsTotal, getNatixisCashCounted, type AccountView } from './wealth.svelte';
import { natixisState } from './natixisHoldings.svelte';
import { regulatedRate, type Investment } from './realReturn';
import { financeSettings } from './financeSettings.svelte';

/**
 * Savings placements and their nominal yield (reactive): current accounts (0 %), savings accounts
 * (regulated rate recognised from the label), employee savings (yearly performance of the Natixis
 * funds). A typed rate always wins. Base of the Real return and Projection cards.
 */

export interface InvestmentView extends Investment {
	/** Rate typed by hand. */
	saisi: boolean;
	/** Rate not found: to be typed (in-house savings account, LEP, fund without performance). */
	aSaisir: boolean;
}

/** Short account name (never the holder). */
export function shortAccountName(a: Pick<AccountView, 'kind' | 'label' | 'last4'>, multiple: boolean): string {
	const l = a.label.toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
	if (a.kind === 'courant') return `Compte courant${multiple ? ` ••${a.last4}` : ''}`;
	if (/DEVELOPPEMENT DURABLE|\bLDDS?\b/.test(l)) return 'LDDS';
	if (/\bLIVRET A\b/.test(l)) return 'Livret A';
	if (/LIVRET BLEU/.test(l)) return 'Livret bleu';
	if (/\bLEP\b|EPARGNE POPULAIRE/.test(l)) return 'LEP';
	return a.label.replace(/\s+(M|MME|MLLE|MR)\s+.*$/i, '').trim() || 'Livret';
}

const investments = $derived.by((): InvestmentView[] => {
	const today = new Date().toISOString().slice(0, 10);
	const accounts = getAccountsView().filter((a) => a.balance > 0 && (a.kind === 'courant' || a.kind === 'livret'));
	const currentAccountCount = accounts.filter((a) => a.kind === 'courant').length;
	const out: InvestmentView[] = accounts.map((a) => {
		const typedRate = financeSettings.rendements[a.id];
		const auto = a.kind === 'livret' ? regulatedRate(a.label, today) : { taux: 0, source: 'compte non rémunéré' };
		return {
			id: a.id,
			label: shortAccountName(a, currentAccountCount > 1),
			type: a.kind === 'courant' ? 'courant' : 'livret',
			montant: a.balance,
			taux: typedRate ?? auto?.taux ?? 0,
			source: typedRate !== undefined ? 'taux saisi' : (auto?.source ?? 'taux à saisir (livret non réglementé)'),
			saisi: typedRate !== undefined,
			aSaisir: typedRate === undefined && !auto
		};
	});
	const employeeSavings = Math.round((getEmployeeSavingsTotal() + getNatixisCashCounted()) * 100) / 100;
	if (employeeSavings > 0) {
		const h = natixisState.holdings?.holdings ?? [];
		const withPerf = h.filter((x) => x.perfY !== undefined);
		const weight = withPerf.reduce((s, x) => s + x.amount, 0);
		const perf = weight > 0 ? Math.round((withPerf.reduce((s, x) => s + x.amount * x.perfY!, 0) / weight) * 100) / 100 : null;
		const typedRate = financeSettings.rendements['natixis'];
		const year = natixisState.perfs?.year;
		out.push({
			id: 'natixis',
			label: 'Épargne salariale',
			type: 'salariale',
			montant: employeeSavings,
			taux: typedRate ?? perf ?? 0,
			source: typedRate !== undefined ? 'taux saisi' : perf !== null ? `performance ${year ? `${year} ` : ''}de tes fonds` : 'performance inconnue : saisis un taux',
			saisi: typedRate !== undefined,
			aSaisir: typedRate === undefined && perf === null
		});
	}
	return out;
});

export function getInvestments(): InvestmentView[] {
	return investments;
}
