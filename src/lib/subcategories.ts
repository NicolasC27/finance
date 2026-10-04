import type { CategoryId, Transaction } from './types';
import { normalizeHeader } from './csvCore';
import { merchantKey, rawLabelKey } from './merchant';
import { categorize, naturalCategory, txKey, type CatRule, type MerchantCategoryMap } from './categories';
import { signedAmount, spendAmount } from './data';
import { persistJson } from './storage';

/**
 * Subcategories (SPEC v11): FINE analysis, not management: budgets, learnt rules and goals stay
 * per category (9 categories unchanged). Computed, deterministic display, pure function usable
 * outside the browser (tsx tests); a manual override (per operation or per merchant, see
 * `SubOverrides`) wins over the computation.
 */

export { SUBCATEGORIES, SUB_MERCHANT_DICT, getSubcategory, subcategoriesFor, type Subcategory } from './subDict';
import { SUB_BY_ID, TOTAL_TOKENS, subMerchantDictFor } from './subDict';

// ---------- 1. Explicit bank subcategories (SPEC §2.1) ----------

/**
 * Explicit table bank_subcategory (normalizeHeader form) → subcategory. 'assurance' and
 * 'entretien' are resolved from the PARENT bank category (vehicule → assurance-auto /
 * entretien-auto, logement maison → assurance-habitat, otherwise null: the bank does not decide).
 * The real value 'Loyer / charges' normalises to 'loyer charges': the three keys ('loyer',
 * 'charges', 'loyer charges') are covered.
 */
const BANK_SUB_MAP: Record<string, string> = {
	'petit commercant': 'petits-commercants',
	'grande surface': 'courses',
	'snacks repas au travail': 'restaurants',
	restaurant: 'restaurants',
	carburant: 'carburant',
	'parking peage': 'peages-parkings',
	'frais bancaires': 'frais-bancaires',
	'remise de cheque': 'cheques-virements',
	cheques: 'cheques-virements',
	'virements internes': 'cheques-virements',
	loyer: 'loyer-charges',
	charges: 'loyer-charges',
	'loyer charges': 'loyer-charges'
};

/** Card payment: never a loan instalment (the bank files car parks under 'Achat / crédit / leasing'). */
const CARD_RE = /^(PAIEMENTS? (CB|PSC|MOB)|CB |CARTE KRAK)\b/i;

/** Subcategory deduced from the bank fields, undefined outside the table. */
function bankSubcategoryFor(tx: Transaction): string | undefined {
	if (!tx.bank_subcategory) return undefined;
	const sub = normalizeHeader(tx.bank_subcategory);
	const parent = tx.bank_category ? normalizeHeader(tx.bank_category) : '';
	if (sub === 'assurance') {
		if (parent === 'vehicule') return 'assurance-auto';
		if (parent === 'logement maison') return 'assurance-habitat';
		return undefined;
	}
	if (sub === 'entretien') return parent === 'vehicule' ? 'entretien-auto' : undefined;
	if (sub === 'achat credit leasing') return CARD_RE.test(tx.remittance_information.join(' ').trim()) ? undefined : 'credit-auto';
	return BANK_SUB_MAP[sub];
}

/**
 * Fine classification (SPEC v11 §2) done by subcategorize, pure and testable:
 * 0) manual override (operation, then merchant; '—' for the whole merchant forces none), then the
 *    external hook (Amazon: deduced from the items), each only if consistent with the resolved
 *    category;
 * 1) explicit bank_subcategory (table §2.1): the bank knows, but only if consistent with the
 *    DISPLAYED category (override, vacances…), so no more 'Loisirs › Restaurants' or 'Revenus ›
 *    Chèques & virements';
 * 2) fine merchant dictionary SUB_MERCHANT_DICT (longest token); technical prefixes removed by
 *    merchantKey still carry meaning ('ECH PRET …' = loan instalment, 'REM CHQ …' = cheque
 *    deposit); TOTALENERGIES is energy OR a fuel station, and a resolved 'voiture' category means
 *    fuel;
 * 3) parent consistency: a subcategory is kept ONLY if its categoryId matches the resolved
 *    category of the tx (categorize), otherwise null (never a displayed contradiction); for
 *    Vacances, accommodation/flights come from the dictionary, otherwise the natural category of
 *    the spending becomes the subcategory;
 * 4) null → the tx falls into the 'Autres' bucket of the drill-down.
 *
 * Same optional parameters as categorize (overrides / rules / cross votes) so parent consistency
 * reflects exactly the displayed category.
 */
/**
 * External hook: subcategory known elsewhere (items of a matched Amazon order…). Returns
 * undefined to let the engine decide.
 */
let subcategoryHook: ((tx: Transaction) => string | null | undefined) | null = null;
export function setSubcategoryHook(fn: ((tx: Transaction) => string | null | undefined) | null): void {
	subcategoryHook = fn;
}

/**
 * Manual subcategory overrides (`budget:sub-overrides`):
 * - `byTx`: operation key → subcategory (null = forced 'none');
 * - `byMerchant`: merchantKey → subcategory (all operations of the merchant).
 * An entry is kept only if it belongs to the resolved category (never a displayed contradiction).
 */
export interface SubOverrides {
	byTx: Record<string, string | null>;
	byMerchant: Record<string, string | null>;
}
export const SUB_OVERRIDES_KEY = 'budget:sub-overrides';
let subOverrides: SubOverrides = { byTx: {}, byMerchant: {} };
export function setSubOverridesSource(s: SubOverrides): void {
	subOverrides = s;
}
export function loadSubOverrides(): SubOverrides {
	if (typeof localStorage === 'undefined') return { byTx: {}, byMerchant: {} };
	try {
		const raw = JSON.parse(localStorage.getItem(SUB_OVERRIDES_KEY) ?? '{}') as Partial<SubOverrides>;
		return { byTx: raw.byTx ?? {}, byMerchant: raw.byMerchant ?? {} };
	} catch {
		return { byTx: {}, byMerchant: {} };
	}
}
export function saveSubOverrides(s: SubOverrides): void {
	persistJson(SUB_OVERRIDES_KEY, s);
}

export function subcategorize(
	tx: Transaction,
	overrides?: Record<string, CategoryId>,
	rules?: CatRule[],
	merchantMap?: MerchantCategoryMap
): string | null {
	const key0 = txKey(tx);
	if (key0 in subOverrides.byTx) {
		const forced = subOverrides.byTx[key0];
		if (forced === null) return null;
		const s = SUB_BY_ID.get(forced ?? '');
		if (s && s.categoryId === categorize(tx, overrides, rules, merchantMap)) return forced ?? null;
	}
	const mk = merchantKey(tx.remittance_information);
	if (mk && mk in subOverrides.byMerchant) {
		const forced = subOverrides.byMerchant[mk];
		if (forced === null) return null;
		const s = SUB_BY_ID.get(forced ?? '');
		if (s && s.categoryId === categorize(tx, overrides, rules, merchantMap)) return forced ?? null;
	}

	if (subcategoryHook) {
		const hooked = subcategoryHook(tx);
		if (hooked !== undefined) {
			if (hooked === null) return null;
			const s = SUB_BY_ID.get(hooked);
			if (s && s.categoryId === categorize(tx, overrides, rules, merchantMap)) return hooked;
		}
	}

	const resolved = categorize(tx, overrides, rules, merchantMap);
	const key = merchantKey(tx.remittance_information);
	const rawKey = rawLabelKey(tx.remittance_information);
	const match = subMerchantDictFor(key, rawKey);

	const bank = resolved === 'vacances' ? undefined : bankSubcategoryFor(tx);
	if (bank && SUB_BY_ID.get(bank)?.categoryId === resolved) return bank;

	const raw = tx.remittance_information.join(' ').toUpperCase();
	if (/^ECH(EANCE)?\s+PRET\b/.test(raw)) return resolved === 'autre' ? 'credits' : resolved === 'voiture' ? 'credit-auto' : null;
	if (/^REM(ISE)?\s+CHQ\b|^REMISE\s+CHEQUE\b/.test(raw)) return resolved === 'revenus' ? 'cheques-recus' : null;
	if (resolved === 'vacances' && SUB_BY_ID.get(match?.subId ?? '')?.categoryId !== 'vacances') {
		const natural = naturalCategory(tx, merchantMap);
		if (natural === 'alimentation' || natural === 'loisirs' || natural === 'transport') return `vac-${natural}`;
		if (natural === 'voiture') return 'vac-transport';
		return natural === 'revenus' ? null : 'sur-place';
	}
	if (!match) return null;

	let { subId } = match;
	if (subId === 'electricite-gaz' && TOTAL_TOKENS.has(match.token) && resolved === 'voiture') {
		subId = 'carburant';
	}

	const sub = SUB_BY_ID.get(subId);
	if (!sub || sub.categoryId !== resolved) return null;
	return subId;
}

/**
 * Breakdown of a category's spending (positive) by subcategory, for the donut drill-down and the
 * report. Key null = 'Autres' bucket (remainder without a detected subcategory). `txs` is assumed
 * already filtered (period, no pending) by the caller, so the sum of the values is, up to display
 * rounding, the total spent in the category.
 */
export function spendBySubcategory(
	txs: Transaction[],
	categoryId: CategoryId,
	overrides?: Record<string, CategoryId>,
	merchantMap?: MerchantCategoryMap
): Map<string | null, number> {
	const out = new Map<string | null, number>();
	for (const tx of txs) {
		if (categorize(tx, overrides, undefined, merchantMap) !== categoryId) continue;
		const spend = spendAmount(tx, categoryId);
		if (spend === null) continue;
		const sub = subcategorize(tx, overrides, undefined, merchantMap);
		out.set(sub, (out.get(sub) ?? 0) + spend);
	}
	return out;
}
