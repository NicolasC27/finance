import { persistJson } from './storage';
import { extractPdfPages } from './pdfNatixis';
import { mergeBenefitMonths, parseFranceTravailStatement, type BenefitMonth } from './franceTravail';

/**
 * France Travail statements, app side (`budget:france-travail`): the benefit months read from the
 * imported PDFs, used by the income tax estimate.
 */

const KEY = 'budget:france-travail';

function load(): BenefitMonth[] {
	if (typeof localStorage === 'undefined') return [];
	try {
		const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { months?: unknown } | null;
		const ok = (m: unknown): m is BenefitMonth => !!m && typeof m === 'object' && typeof (m as BenefitMonth).month === 'string' && typeof (m as BenefitMonth).net === 'number' && typeof (m as BenefitMonth).tax === 'number';
		return Array.isArray(v?.months) ? v.months.filter(ok) : [];
	} catch {
		return [];
	}
}

export const franceTravailState = $state({ months: load() });

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const label = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;

/** Reads France Travail statements (PDF); returns one summary per file, in order. */
export async function importFranceTravailPdf(files: readonly File[]): Promise<string[]> {
	const out: string[] = [];
	for (const f of files) {
		try {
			const r = parseFranceTravailStatement(await extractPdfPages(await f.arrayBuffer()));
			if ('error' in r) {
				out.push(r.error);
				continue;
			}
			franceTravailState.months = mergeBenefitMonths(franceTravailState.months, r.months);
			out.push(`Relevé France Travail ${r.months.map((m) => `${label(m.month)} : ${m.net.toLocaleString('fr-FR')} € net`).join(', ')}`);
		} catch (e) {
			out.push(`lecture impossible (${e instanceof Error ? e.message : String(e)})`);
		}
	}
	persistJson(KEY, { months: franceTravailState.months });
	return out;
}

/** Removes every imported month. */
export function clearFranceTravail(): void {
	franceTravailState.months = [];
	persistJson(KEY, { months: [] });
}
