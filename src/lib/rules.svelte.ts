import type { CategoryId, Transaction } from './types';
import { txKey, loadCatRuleStore, saveCatRuleStore, naturalCategory, getCategory, type CatRule } from './categories';
import { budgetState, setOverride } from './budget.svelte';
import { merchantKey, merchantLabel, keyIncludesKeyword } from './merchant';
import { getTransactions, getMerchantCategoryMap } from './store.svelte';

/**
 * Reactive store of learnt categorisation rules (`budget:cat-rules`): after a manual override, a
 * discreet 'Toujours catégoriser … ?' prompt (once per keyword, accepted or refused, persisted).
 * Since v10 the keyword is the merchantKey (stable merchant key): the operation date, the card
 * number and the UIR reference no longer break the rematching.
 */

const initial = loadCatRuleStore();

export const rulesState = $state({
	rules: initial.rules,
	dismissed: initial.dismissed,
	/** Current prompt (one at a time, non intrusive). */
	prompt: null as { keyword: string; label: string; categoryId: CategoryId } | null
});

function persist(): void {
	saveCatRuleStore({ rules: rulesState.rules, dismissed: rulesState.dismissed });
}

/**
 * Invalidates the categorisation derivations again: categorize() reads the rules through a
 * non-reactive cache, so a new overrides reference is forced.
 */
function touchOverrides(): void {
	budgetState.overrides = { ...budgetState.overrides };
}

/**
 * Keyword extracted from a transaction (SPEC v10 §2): the FULL merchantKey, city included
 * ('RUELLE SUR TO MAISON FRUGIER'). Word-boundary inclusion matching (ruleFor) makes the rule
 * work immediately on every operation of the same merchant+place; to cover other cities of the
 * same merchant the user corrects once more, and inclusion then links the two keys.
 */
export function extractKeyword(tx: Transaction): string {
	return merchantKey(tx.remittance_information);
}

/** Merchant keys that do not name ONE merchant (payment intermediaries, technical labels). */
const GENERIC_KEYWORDS: ReadonlySet<string> = new Set([
	'PAYPAL', 'SUMUP', 'COMMERCANT INCONNU', 'VIR', 'VIREMENT', 'PRLV', 'CB', 'CARTE', 'RETRAIT DAB',
	'REMISE CHEQUE', 'FRAIS BANCAIRES', 'COMMISSION BANCAIRE', 'WERO', 'LYDIA', 'STRIPE'
]);

export interface RuleImpact {
	keyword: string;
	/** Operations the rule would touch (keyword included in their merchant key). */
	count: number;
	/** Natural categories (excluding 'autre') of those operations. */
	categories: CategoryId[];
	/** Discouraged rule: generic keyword or merchants of different kinds. */
	generic: boolean;
	reason: string;
}

/**
 * What an 'always' rule on the merchant of `tx` would do, shown BEFORE creating it. A key reduced
 * to a city name ('POITIERS': E.Leclerc, bakeries, PMU…) covers different categories: the rule
 * is then discouraged (a dozen operations switched in one keystroke).
 */
export function ruleImpact(tx: Transaction, txs: Transaction[] = getTransactions()): RuleImpact | null {
	const keyword = extractKeyword(tx);
	if (!keyword) return null;
	const merchantMap = getMerchantCategoryMap();
	const cats = new Set<CategoryId>();
	let count = 0;
	for (const t of txs) {
		if (!keyIncludesKeyword(merchantKey(t.remittance_information), keyword)) continue;
		count++;
		const c = naturalCategory(t, merchantMap);
		if (c !== 'autre' && c !== 'revenus') cats.add(c);
	}
	let reason = '';
	if (GENERIC_KEYWORDS.has(keyword) || keyword.length < 3) reason = 'libellé trop générique';
	else if (cats.size >= 2) reason = `couvre des commerçants différents (${[...cats].map((c) => getCategory(c).label).join(', ')})`;
	return { keyword, count, categories: [...cats], generic: reason !== '', reason };
}

/**
 * Manual override + matching rule proposal: offered once per keyword (never if a rule already
 * exists or the keyword was refused, never for 'Vacances', which depends on a period and not a
 * merchant, and never for a bare city key). The prompt shows the merchantLabel ('Maison
 * Frugier'), not the raw key.
 */
export function setOverrideAndPrompt(tx: Transaction, categoryId: CategoryId): void {
	setOverride(txKey(tx), categoryId);
	const keyword = extractKeyword(tx);
	if (!keyword || categoryId === 'vacances') return;
	if (rulesState.rules.some((r) => r.keyword === keyword)) return;
	if (rulesState.dismissed.includes(keyword)) return;
	if (ruleImpact(tx)?.generic) return;
	rulesState.prompt = { keyword, label: merchantLabel(tx.remittance_information), categoryId };
}

/** 'Oui': creates the rule (replaces any rule on the same keyword). */
export function acceptRule(): void {
	const p = rulesState.prompt;
	if (!p) return;
	rulesState.rules = [
		...rulesState.rules.filter((r) => r.keyword !== p.keyword),
		{ keyword: p.keyword, categoryId: p.categoryId, createdAt: Date.now() }
	];
	rulesState.prompt = null;
	persist();
	touchOverrides();
}

/** 'Non, juste celle-ci': the keyword is never offered again. */
export function declineRule(): void {
	const p = rulesState.prompt;
	if (!p) return;
	rulesState.dismissed = [...rulesState.dismissed, p.keyword];
	rulesState.prompt = null;
	persist();
}

/**
 * Withdraws the prompt `raised` by a change that is undone, while it is still the one shown (one
 * answered or replaced since stays as it is), and puts back `previous`, the prompt it replaced (an
 * unanswered offer raised by an earlier change). Nothing is persisted: the keyword can be offered
 * again.
 */
export function withdrawPrompt(raised: typeof rulesState.prompt, previous: typeof rulesState.prompt = null): void {
	if (raised && rulesState.prompt === raised) rulesState.prompt = previous;
}

/**
 * Override + immediate rule for the merchant (sorting box: 'toujours pour ce commerçant'
 * ticked), without going through the prompt.
 */
export function setOverrideAndRule(tx: Transaction, categoryId: CategoryId): { keyword: string; previous?: CatRule } | null {
	setOverride(txKey(tx), categoryId);
	const keyword = extractKeyword(tx);
	if (!keyword || categoryId === 'vacances') return null;
	const previous = rulesState.rules.find((r) => r.keyword === keyword);
	rulesState.rules = [...rulesState.rules.filter((r) => r.keyword !== keyword), { keyword, categoryId, createdAt: Date.now() }];
	rulesState.dismissed = rulesState.dismissed.filter((k) => k !== keyword);
	rulesState.prompt = null;
	persist();
	touchOverrides();
	return { keyword, ...(previous ? { previous } : {}) };
}

/**
 * Undoes a rule created by setOverrideAndRule: removed, or put back to its previous state;
 * `dismissed` puts the keyword back among the refused ones when it was before.
 */
export function restoreRule(keyword: string, previous?: CatRule, dismissed = false): void {
	rulesState.rules = [...rulesState.rules.filter((r) => r.keyword !== keyword), ...(previous ? [previous] : [])];
	if (dismissed && !rulesState.dismissed.includes(keyword)) rulesState.dismissed = [...rulesState.dismissed, keyword];
	persist();
	touchOverrides();
}

/** Adds (or replaces) a 'keyword → category' rule (AI analysis); returns the old one so restoreRule can undo. */
export function addRule(keyword: string, categoryId: CategoryId): { keyword: string; previous?: CatRule } {
	const previous = rulesState.rules.find((r) => r.keyword === keyword);
	rulesState.rules = [...rulesState.rules.filter((r) => r.keyword !== keyword), { keyword, categoryId, createdAt: Date.now() }];
	rulesState.dismissed = rulesState.dismissed.filter((k) => k !== keyword);
	persist();
	touchOverrides();
	return { keyword, ...(previous ? { previous } : {}) };
}

/** Deletes a rule (managed from the Transactions page). */
export function removeRule(keyword: string): void {
	rulesState.rules = rulesState.rules.filter((r) => r.keyword !== keyword);
	persist();
	touchOverrides();
}

export type { CatRule };
