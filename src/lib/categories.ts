import type { Category, CategoryId, Transaction } from './types';
import { normalizeHeader } from './csvCore';
import { merchantKey, keyIncludesKeyword, rawLabelKey } from './merchant';
import { merchantDictFor } from './merchantDict';
import { subDictCategoryFor, subMerchantDictFor, TOTAL_TOKENS } from './subDict';
import { flowKind } from './flow';
import { persistJson } from './storage';
import { isWealthLine } from './scope';

/** Categories, classification and override persistence. */

export const OVERRIDES_KEY = 'budget:overrides';
export const RULES_KEY = 'budget:cat-rules';

// Colours: dedicated categorical palette (never a UI token: --accent stays
// reserved for Revenus/links/curve). Validated (dataviz script, all pairs) on
// 2026-10-03: with 10 muted categories no palette passes every colour-blindness
// threshold — identity is also carried by the labels (legends, cards).
// Default keywords now live in merchantDict.ts (MERCHANT_DICT, single source) —
// no more `keywords` per category.
export const CATEGORIES: Category[] = [
	{ id: 'alimentation', label: 'Alimentation', color: '#c77f3e' },
	{ id: 'logement', label: 'Logement', color: '#7aa14e' },
	{ id: 'energie', label: 'Énergie', color: '#a9912b' },
	{ id: 'transport', label: 'Transport', color: '#0081b1' },
	// Voiture: your car (loan, insurance, maintenance, fuel, tolls); Transport keeps trains, buses, taxis.
	// Green farthest from the 12 other colours (ΔE ≥ 16 in normal vision, ≥ 6 with colour blindness)
	{ id: 'voiture', label: 'Voiture', color: '#297613' },
	{ id: 'abonnements', label: 'Abonnements', color: '#9e5598' },
	// Loisirs: raspberry (the former salmon #d07758 was a 2nd orange, ΔE 4.3 with Alimentation in normal vision)
	{ id: 'loisirs', label: 'Loisirs', color: '#b04a66' },
	{ id: 'sante', label: 'Santé', color: '#00a99c' },
	{ id: 'revenus', label: 'Revenus', color: '#c9a86c' },
	{ id: 'vacances', label: 'Vacances', color: '#5d94da' },
	// Impôts: huge one-off amounts (tax notices) — a separate envelope, never « vacances »
	{ id: 'impots', label: 'Impôts', color: '#5951ac' },
	// Épargne & transferts: OUTSIDE spending and income (savings accounts, transfers to oneself, Kraken…), see flow.ts
	{ id: 'epargne', label: 'Épargne & transferts', color: '#6f8fa6' },
	{ id: 'autre', label: 'Autre', color: '#8a857a' }
];

const CATEGORY_BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]));

export function getCategory(id: CategoryId): Category {
	return CATEGORY_BY_ID.get(id) ?? CATEGORY_BY_ID.get('autre')!;
}

/**
 * Stable key of a transaction: simple hash (djb2) of date+amount+label.
 * Identifies manual overrides and deduplicates imports.
 * The label is canonicalised WITHOUT spaces: the Crédit Mutuel CSV export
 * sometimes inserts a hyphenation space inside a word (« PRELEVEME NT ») where
 * the XLSX has the continuous label (« PRELEVEMENT ») — without this, ~2 % of
 * operations would be re-imported as duplicates in a cross CSV↔XLSX import.
 * The rank of a strict duplicate in the same batch is appended (missing =
 * first occurrence: historical keys unchanged).
 */
const keyCache = new WeakMap<Transaction, { dup: number | undefined; key: string }>();

/**
 * Stable key of an operation. Memoised per object: an operation is never mutated once stored (an
 * edit replaces it), only `dup_index` may be set right after parsing, hence the check.
 */
export function txKey(tx: Transaction): string {
	const hit = keyCache.get(tx);
	if (hit && hit.dup === tx.dup_index) return hit.key;
	const key = computeTxKey(tx);
	keyCache.set(tx, { dup: tx.dup_index, key });
	return key;
}

function computeTxKey(tx: Transaction): string {
	const canonicalLabel = tx.remittance_information.join(' ').replace(/\s+/g, '');
	const dup = tx.dup_index ? `|#${tx.dup_index}` : '';
	const raw = `${tx.booking_date}|${tx.value_date}|${tx.transaction_amount.amount}|${tx.credit_debit_indicator}|${canonicalLabel}${dup}`;
	let hash = 5381;
	for (let i = 0; i < raw.length; i++) {
		hash = ((hash << 5) + hash + raw.charCodeAt(i)) | 0;
	}
	return (hash >>> 0).toString(36);
}

/**
 * Rank of STRICT duplicates within one import batch (same txKey): the 2nd
 * occurrence gets dup_index 1, the 3rd 2… — two identical coffees on the same
 * day stay two operations. Re-importing the same file gives the same ranks,
 * hence the same keys (cross-import deduplication holds). A rank already set
 * is kept; the first occurrence keeps its historical key.
 */
export function assignDupIndexes(batch: Transaction[]): Transaction[] {
	const seen = new Map<string, number>();
	return batch.map((tx) => {
		if (tx.dup_index) return tx;
		const key = txKey(tx);
		const n = seen.get(key) ?? 0;
		seen.set(key, n + 1);
		return n === 0 ? tx : { ...tx, dup_index: n };
	});
}

// ---------- Learned categorisation rules (`budget:cat-rules`) ----------

/** Learned rule: keyword (normalised upper-case label) → category. */
export interface CatRule {
	keyword: string;
	categoryId: CategoryId;
	createdAt: number;
}

/** Persisted content: rules + keywords the user declined. */
export interface CatRuleStore {
	rules: CatRule[];
	dismissed: string[];
	/** Format version (the v10 keyword migration is applied only once). */
	version?: number;
}

/** Current rule store version: the keyword migration no longer replays on every load. */
const RULES_VERSION = 10;

let ruleStoreCache: CatRuleStore | null = null;

/**
 * Reads the rule store (memoised; { rules: [], dismissed: [] } when missing or
 * invalid). The v6-v9 → v10 migration runs ONCE: merchantKey is not idempotent
 * (« CARTE KRAKEN » → « KRAKEN »), so replaying it on every load rewrote rules.
 */
export function loadCatRuleStore(): CatRuleStore {
	if (ruleStoreCache) return ruleStoreCache;
	let store: CatRuleStore = { rules: [], dismissed: [] };
	let version = RULES_VERSION;
	if (typeof localStorage !== 'undefined') {
		try {
			const parsed = JSON.parse(localStorage.getItem(RULES_KEY) ?? 'null') as Partial<CatRuleStore> | null;
			if (parsed && Array.isArray(parsed.rules)) {
				store = {
					rules: parsed.rules.filter((r) => r && typeof r.keyword === 'string' && typeof r.categoryId === 'string'),
					dismissed: Array.isArray(parsed.dismissed) ? parsed.dismissed.filter((d) => typeof d === 'string') : []
				};
				version = typeof parsed.version === 'number' ? parsed.version : 0;
			}
		} catch {
		}
	}
	if (version < RULES_VERSION) store = migrateRuleKeywords(store, true);
	ruleStoreCache = store;
	return store;
}

/**
 * Soft v6-v9 → v10 migration (silent, once at load): old rules learned on the
 * raw normalised label contain noise tokens (DDMM dates, card numbers, UIR
 * references…) that never matched again. Each keyword is cleaned through
 * merchantKey (best effort) and the store rewritten; inclusion matching
 * (ruleFor) makes them useful. When two old rules merge, the most recent one
 * wins; with nothing to change, the store is still saved once to record the
 * version.
 */
function migrateRuleKeywords(store: CatRuleStore, markVersion = false): CatRuleStore {
	let changed = false;
	const byKeyword = new Map<string, CatRule>();
	for (const rule of store.rules) {
		const cleaned = merchantKey([rule.keyword]);
		if (cleaned && cleaned !== rule.keyword) changed = true;
		const keyword = cleaned || rule.keyword;
		const existing = byKeyword.get(keyword);
		if (existing && existing.createdAt >= rule.createdAt) {
			changed = true;
			continue;
		}
		if (existing) changed = true;
		byKeyword.set(keyword, { ...rule, keyword });
	}
	if (!changed) {
		if (markVersion && store.rules.length > 0) saveCatRuleStore(store);
		return store;
	}
	const migrated: CatRuleStore = {
		rules: [...byKeyword.values()],
		dismissed: store.dismissed
	};
	saveCatRuleStore(migrated);
	return migrated;
}

/** Persists the rule store and updates the memory cache (a failed write is reported by a toast; rules stay in memory). */
export function saveCatRuleStore(store: CatRuleStore): void {
	ruleStoreCache = store;
	persistJson(RULES_KEY, { rules: store.rules, dismissed: store.dismissed, version: RULES_VERSION });
}

/**
 * Learned rule matching a transaction (SPEC v10 §2): the keyword (a
 * merchantKey) is searched by INCLUSION at word boundaries in the
 * transaction's merchant key. « SHOP DU PORT » matches « VILLE SHOP DU PORT »,
 * not « SHOP DU PORTAIL ». The most PRECISE rule wins (longest keyword), not
 * the oldest: « VILLE EPICERIE DU PORT → Alimentation » beats
 * « VILLE → Loisirs ».
 */
const ruleCache = new WeakMap<Transaction, { rules: readonly CatRule[]; rule: CatRule | undefined }>();

/** Longest rule whose keyword the merchant key includes; memoised per operation and rule list (rules are replaced as a whole on every change). */
export function ruleFor(tx: Transaction, rules: CatRule[]): CatRule | undefined {
	const hit = ruleCache.get(tx);
	if (hit && hit.rules === rules) return hit.rule;
	const key = merchantKey(tx.remittance_information);
	let best: CatRule | undefined;
	for (const r of rules) {
		if (keyIncludesKeyword(key, r.keyword) && (!best || r.keyword.length > best.keyword.length)) best = r;
	}
	ruleCache.set(tx, { rules, rule: best });
	return best;
}

/**
 * Bank categories (CM export) → app categories.
 * Keys = normalised form (normalizeHeader) of the bank category.
 */
const BANK_CATEGORY_MAP: Record<string, CategoryId> = {
	alimentation: 'alimentation',
	'logement maison': 'logement',
	vehicule: 'transport',
	transport: 'transport',
	numerique: 'abonnements',
	'autres depenses': 'autre',
	// Off-budget / Savings: neither spending nor income (previously « autre », one more expense)
	'hors budget': 'epargne',
	sante: 'sante',
	'impots et taxes': 'impots',
	impots: 'impots',
	epargne: 'epargne',
	revenus: 'revenus',
	salaires: 'revenus',
	retrait: 'autre',
	'loisirs sport': 'loisirs',
	loisirs: 'loisirs',
	sport: 'loisirs',
	'vacances voyages': 'vacances',
	voyages: 'vacances',
	'restaurants bars': 'alimentation',
	abonnements: 'abonnements',
	energie: 'energie'
};

/** Refinements by bank subcategory (take priority over the category). */
const BANK_SUBCATEGORY_MAP: Record<string, CategoryId> = {
	'snacks repas au travail': 'alimentation',
	'grande surface': 'alimentation',
	'petit commercant': 'alimentation',
	'achat credit leasing': 'voiture',
	carburant: 'voiture',
	'parking peage': 'voiture',
	'frais bancaires': 'autre',
	'virements internes': 'epargne',
	'remise de cheque': 'revenus'
};

/**
 * App category inferred from the bank fields (subcategory first), undefined
 * when unknown. « Véhicule / Assurance » and « Véhicule / Entretien » mean your
 * car (« Véhicule, divers » — trains, swimming pool… — stays Transport).
 * Exported for cross-learning (merchantCategoryMap votes in store.svelte.ts).
 */
export function bankCategoryFor(tx: Transaction): CategoryId | undefined {
	if (tx.bank_subcategory) {
		const subKey = normalizeHeader(tx.bank_subcategory);
		if ((subKey === 'assurance' || subKey === 'entretien') && tx.bank_category && normalizeHeader(tx.bank_category) === 'vehicule') return 'voiture';
		const sub = BANK_SUBCATEGORY_MAP[subKey];
		if (sub) return sub;
	}
	if (tx.bank_category) {
		const key = normalizeHeader(tx.bank_category);
		return BANK_CATEGORY_MAP[key] ?? bankCategoryByKeyword(key) ?? bankCategoryByKeyword(normalizeHeader(tx.bank_subcategory ?? ''));
	}
	return undefined;
}

/**
 * Keyword fallback when the exact bank label is not in the table
 * (« Loisirs / Sport », « Restaurants & bars », « Vacances / Voyages »…): the
 * CM taxonomy evolves, and that must not drop operations into « autre ».
 */
const BANK_KEYWORD_RULES: [RegExp, CategoryId][] = [
	[/\b(vacance|voyage|hotel|sejour)/, 'vacances'],
	[/\b(loisir|sport|culture|cadeau|shopping|mode|habillement|vetement|high tech|multimedia|jeu)/, 'loisirs'],
	[/\b(aliment|restau|bar|cafe|course|supermarche|boulang)/, 'alimentation'],
	[/\b(logement|maison|loyer|habitat|immobilier|mobilier|equipement)/, 'logement'],
	[/\b(energie|electricite|gaz|eau|chauffage)/, 'energie'],
	[/\b(vehicule|transport|auto|carburant|peage|parking|train|avion)/, 'transport'],
	[/\b(numerique|abonnement|telecom|telephon|internet|logiciel|streaming)/, 'abonnements'],
	[/\b(sante|medical|pharma|mutuelle|medecin)/, 'sante'],
	[/\b(impot|taxe|fiscal)/, 'impots'],
	[/\b(epargne|placement|livret)/, 'epargne'],
	[/\b(revenu|salaire|remboursement|allocation|pension)/, 'revenus']
];

function bankCategoryByKeyword(key: string): CategoryId | undefined {
	if (!key) return undefined;
	for (const [re, cat] of BANK_KEYWORD_RULES) if (re.test(key)) return cat;
	return undefined;
}

/** Cross votes bank → merchant (merchantKey → majority category). */
export type MerchantCategoryMap = Map<string, CategoryId>;

/**
 * « Operation during a vacation » predicate, injected by vacations.svelte.ts
 * (this file stays pure, without runes: testable with tsx). Read on every
 * call, hence reactive inside the $derived that categorise.
 */
let vacationPredicate: ((tx: Transaction) => boolean) | null = null;
export function setVacationPredicate(fn: ((tx: Transaction) => boolean) | null): void {
	vacationPredicate = fn;
}

/** Categories a vacation absorbs: variable everyday spending, never fixed charges or income. */
export const VACATION_ELIGIBLE: ReadonlySet<CategoryId> = new Set<CategoryId>(['alimentation', 'loisirs', 'transport', 'voiture', 'autre']);

/** Car during a vacation: only fuel, tolls and parking follow the trip (never loan, insurance or maintenance). */
function isTripCarExpense(tx: Transaction): boolean {
	const sub = tx.bank_subcategory ? normalizeHeader(tx.bank_subcategory) : '';
	if (sub) return sub === 'carburant' || sub === 'parking peage';
	const m = subMerchantDictFor(merchantKey(tx.remittance_information), rawLabelKey(tx.remittance_information));
	return m?.subId === 'carburant' || m?.subId === 'peages-parkings' || (m?.subId === 'electricite-gaz' && TOTAL_TOKENS.has(m.token));
}

/**
 * Markers of a transfer to one's own account (KRAKEN, « VER INI », « VIREMENT
 * INTERNE »): shared with internal-transfer detection (transfers.ts). Never a
 * vacation expense, even during a period.
 */
export const INTERNAL_TRANSFER_RE = /\bKRAKEN\b|\bVER INI\b|\bVIREMENT INTERNE\b/i;

/** Wealth movement (Kraken/Natixis line or transfer to one's own account): never reclassified as Vacances. */
export function isWealthMovement(tx: Transaction): boolean {
	if (isWealthLine(tx)) return true;
	return INTERNAL_TRANSFER_RE.test(tx.remittance_information.join(' '));
}

/**
 * Classification (SPEC v10 §3), pure function testable outside the browser:
 * 0) computed entry (Portage): its category is fixed at the source;
 * 1) individual override 2) learned rule (inclusion on merchantKey) — both
 *    take priority over the defaults and over the implicit « revenus » of
 *    credits, since the user decided explicitly; on a wealth movement (Kraken
 *    line, transfer to oneself) a « Vacances » set by mistake is ignored;
 * 3) natural category (baseCategory);
 * 4) vacation: VARIABLE spending during a declared period becomes « vacances »
 *    — never fixed charges of « autre » (loan payment, instalment, fee, direct
 *    debits and transfers: hundreds of euros were absorbed over a real
 *    two-month period).
 */
export function categorize(
	tx: Transaction,
	overrides?: Record<string, CategoryId>,
	rules?: CatRule[],
	merchantMap?: MerchantCategoryMap
): CategoryId {
	if (tx.virtual_category) return tx.virtual_category;
	const key = txKey(tx);
	const wealth = isWealthMovement(tx);
	if (overrides && overrides[key]) return wealth && overrides[key] === 'vacances' ? 'epargne' : overrides[key];

	const rule = ruleFor(tx, rules ?? loadCatRuleStore().rules);
	if (rule) return wealth && rule.categoryId === 'vacances' ? 'epargne' : rule.categoryId;

	const base = baseCategory(tx, merchantMap);
	if (VACATION_ELIGIBLE.has(base) && (base !== 'voiture' || isTripCarExpense(tx)) && !wealth && !FIXED_CHARGE_RE.test(tx.remittance_information.join(' ').trim()) && vacationPredicate?.(tx)) return 'vacances';
	return base;
}

/** Labels of fixed charges or movements, never reclassified as « Vacances ». */
const FIXED_CHARGE_RE = /^(VIR|VIREMENT|PRLV|PRELEVEMENT|ECH(EANCE)? PRET|MENSUALITE|F COTIS|FRAIS|COM CARTE|COTIS)\b/i;

/** Card payment (CB, PSC, Krak card): TotalEnergies there is a fuel station. */
const CARD_PAYMENT_RE = /^(PAIEMENTS? (CB|PSC)|CB |CARTE KRAK)/;

/** Peer-to-peer sale platforms: a credit there is a SALE, not a refund. */
const SALE_PLATFORMS_RE = /\b(VINTED|LEBONCOIN)\b/;

/** Exported natural category (no override, rule or vacation): « Alimentation » for a restaurant during a vacation. */
export function naturalCategory(tx: Transaction, merchantMap?: MerchantCategoryMap): CategoryId {
	return baseCategory(tx, merchantMap);
}

/**
 * Natural category of an operation:
 * - Cheque deposit: income, even when the bank reverses it (a « REM CHQ … »
 *   debit = rejected/cancelled cheque → negative income, not a big expense).
 * - Loan instalment credited on the loan account (« MENSUALITE PRELEVEE »):
 *   not income — it offsets the instalment debited on the current account
 *   (ECH PRET, in « autre › Échéances de crédit »); it stays in spending, the
 *   difference being interest and insurance.
 * - Kraken ledger lines (« KRAKEN VIREMENT ENTREE … ») and transfers to one's
 *   own account: « Épargne & transferts », outside spending AND income
 *   (previously « autre », so an expense — an unmatched transfer to a savings
 *   account inflated outflows by as much). Kraken+ stays an expense.
 * - Credits: a payment card (Krak card) never receives income, so a credit
 *   there is a refund. A peer-to-peer sale (Vinted, Leboncoin) on the bank is
 *   income, not a refund that would make Loisirs negative. A credit the bank
 *   classified (« Santé » for the health insurance…) refunds that category. A
 *   credit from a KNOWN merchant (dictionaries) is a refund (cancelled
 *   subscription, returned item…) that goes back to its spending category as a
 *   deduction (see spendAmount) — never from « autre », too generic to assert a
 *   refund. Otherwise income.
 * - Debits: bank categories first, then cross-learning (merchant known from
 *   another import), then the embedded dictionaries (longest token; a
 *   fine-grained token implies its category). « revenus » is deliberately
 *   excluded there: credits are already handled, and a DEBIT containing
 *   « SALAIRE » is not income (e.g. « URSSAF … PRÉLÈVEMENT SALAIRE CESU » =
 *   salary paid). TotalEnergies is an energy supplier by direct debit but a
 *   fuel station when paid by card.
 */
const baseCache = new WeakMap<Transaction, { map: MerchantCategoryMap | undefined; category: CategoryId }>();

/** Natural category, memoised per operation and merchant map (the map is rebuilt as a whole when the votes change). */
function baseCategory(tx: Transaction, merchantMap?: MerchantCategoryMap): CategoryId {
	const hit = baseCache.get(tx);
	if (hit && hit.map === merchantMap) return hit.category;
	const category = computeBaseCategory(tx, merchantMap);
	baseCache.set(tx, { map: merchantMap, category });
	return category;
}

function computeBaseCategory(tx: Transaction, merchantMap?: MerchantCategoryMap): CategoryId {
	if (/^REM(ISE)?\s+CHQ\b|^REMISE\s+CHEQUE\b/i.test(tx.remittance_information.join(' '))) return 'revenus';

	if (/^MENSUALITE\s+PRELEVEE/i.test(tx.remittance_information.join(' '))) return 'autre';

	if (/^KRAKEN SUBSCRIPTION\b/i.test(tx.remittance_information.join(' '))) return 'abonnements';
	if (isWealthMovement(tx)) return 'epargne';

	const mKey = merchantKey(tx.remittance_information);
	const raw = rawLabelKey(tx.remittance_information);

	if (tx.credit_debit_indicator === 'CRDT') {
		const onCard = tx.account === 'krak-card';
		if (!onCard && SALE_PLATFORMS_RE.test(mKey)) return 'revenus';
		const bank = bankCategoryFor(tx);
		if (bank && (flowKind(bank) === 'expense' || bank === 'epargne') && bank !== 'autre') return bank;
		const refund = merchantDictFor(mKey, raw) ?? subDictCategoryFor(mKey, raw);
		if (refund && refund !== 'revenus' && refund !== 'autre') return refund;
		return onCard ? 'autre' : 'revenus';
	}

	const bank = bankCategoryFor(tx);
	if (bank) return bank;

	const voted = merchantMap?.get(mKey);
	if (voted) return voted;

	const dict = merchantDictFor(mKey, raw) ?? subDictCategoryFor(mKey, raw);
	if (dict && dict !== 'revenus') {
		if (dict === 'energie' && /\bTOTAL ?ENERGIES?\b/.test(raw) && (tx.account === 'krak-card' || CARD_PAYMENT_RE.test(raw))) return 'voiture';
		return dict;
	}

	return 'autre';
}

/** Reads the overrides from localStorage ({} when missing/invalid). */
export function loadOverrides(): Record<string, CategoryId> {
	if (typeof localStorage === 'undefined') return {};
	try {
		return JSON.parse(localStorage.getItem(OVERRIDES_KEY) ?? '{}') as Record<string, CategoryId>;
	} catch {
		return {};
	}
}

/** Persists the overrides to localStorage. */
export function saveOverrides(overrides: Record<string, CategoryId>): void {
	persistJson(OVERRIDES_KEY, overrides);
}