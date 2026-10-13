import type { CategoryId, Transaction } from './types';
import { CATEGORIES, categorize, getCategory, ruleFor, txKey, type CatRule } from './categories';
import { SUBCATEGORIES, getSubcategory, subcategorize } from './subcategories';
import { budgetState, patchOverrides, restoreSubOverrides, setOverride, setSubOverride, setTxSubOverrides } from './budget.svelte';
import { restoreRule, ruleImpact, rulesState, setOverrideAndRule } from './rules.svelte';
import { getMerchantCategoryMap, getTransactions } from './store.svelte';
import { excludeKeys, isInternal, transferState, unexcludeKeys } from './transfers.svelte';
import { getSortQueue, keepInOther, sortQueueState, unkeep } from './sortQueue.svelte';
import { KIND_LABELS, accountKind, accountState } from './accounts.svelte';
import { aiState } from './ai.svelte';
import { showToast } from './ui.svelte';
import { createRequestTracker } from './aiLayout';
import { isPlannedInstalment } from './data';
import { merchantKey, merchantLabel } from './merchant';
import {
	TRIAGE_BATCH_SIZE,
	buildTriageRequest,
	changedOps,
	groupProposals,
	parseTriageAnswer,
	privacyContext,
	revertValues,
	sureProposals,
	triageBatches,
	triageCatalogue,
	triageHolderNames,
	undoMessage,
	written,
	type TriageGroup,
	type TriageHistoryEntry,
	type TriageKind,
	type TriageProposal,
	type TriageRequest,
	type WrittenValue
} from './aiTriage';

/**
 * « ✨ Proposer avec l'IA » on /trier: sends the « À trier » queue to the local relay (POST /tri) in
 * batches, keeps the AI report IN MEMORY only (never persisted), and applies what the user validates
 * through the same helpers as the manual sorting (override, opt-in rule, keep in « Autre », hide an
 * internal transfer), each with an undo for the session. An undo only puts back the operations whose
 * entries all still hold what its step wrote: a choice made by hand since is never overwritten.
 */

/** Longest wait for one batch (the relay itself stops Claude after 150 s). */
const TIMEOUT_MS = 170_000;
/** Most batches per run: the most recent operations of a very long queue first. */
const MAX_BATCHES = 5;

export type TriageStatus = 'idle' | 'running' | 'done' | 'error';
/** Same failure cases as the other AI features (« Organiser par l'IA », quick entry, Analyse IA). */
export type TriageErrorKind = 'config' | 'offline' | 'bad-token' | 'busy' | 'timeout' | 'quota' | 'relay' | 'unreadable';

/** A proposal of the run with the key of its operation. */
export interface StoredProposal extends TriageProposal {
	key: string;
}

/** A report line: the proposal and the operation, still in the queue. */
export interface TriageReportItem extends StoredProposal {
	tx: Transaction;
}

/** What the user picks instead of the proposal (changed category, subcategory, opt-in rule). */
export interface TriageChoice {
	kind?: TriageKind;
	categoryId?: CategoryId;
	/** null: no subcategory (automatic one kept). */
	subId?: string | null;
	/** « Toujours pour ce commerçant »: only applied when the rule is not generic. */
	always?: boolean;
}

/** Run, report and decisions of « Proposer avec l'IA » (memory only, never persisted). */
export const aiTriageState = $state({
	status: 'idle' as TriageStatus,
	error: '',
	errorKind: null as TriageErrorKind | null,
	/** The error comes from the relay setup: the page offers to open « Analyse IA ». */
	toAiPage: false,
	/** Stopped by the user: the report holds the batches answered before. */
	stopped: false,
	batchesDone: 0,
	batchesTotal: 0,
	/** Operations sent this run, and queued ones left out (beyond MAX_BATCHES). */
	sent: 0,
	leftOut: 0,
	summaries: [] as string[],
	proposals: [] as StoredProposal[],
	/** Proposals refused by the checks (unknown operation or category). */
	dropped: 0,
	/** Ids of the proposals validated or rejected during this report. */
	applied: [] as string[],
	rejected: [] as string[],
	/**
	 * Undo stack of the session (labels shown by the page; the last one is undone first). Validations
	 * stay undoable after a new run or « Fermer le rapport »; rejections only belong to their report.
	 */
	undo: [] as { label: string; seq: number }[]
});

/** What one validation wrote, entry by entry, for a compare-and-restore undo. */
interface StepWrites {
	overrides: WrittenValue<CategoryId>[];
	subsByTx: WrittenValue<string | null>[];
	subsByMerchant: WrittenValue<string | null>[];
	rules: WrittenValue<CatRule>[];
	/** Rule keywords the user had refused before the step (refused again when their rule is undone). */
	refusedRules: string[];
	/** Operations kept in « Autre » by the step (by txKey). */
	kept: WrittenValue<true>[];
	excluded: WrittenValue<true>[];
	/** Hidden keys the user had chosen to keep visible before (transfer dialog). */
	dismissedTransfers: string[];
}

interface UndoEntry {
	seq: number;
	/** Run whose report the ids belong to. */
	run: number;
	ids: string[];
	decision: 'applied' | 'rejected';
	/** null for a rejection (nothing written). */
	writes: StepWrites | null;
}

/** Write logs of the undo stack, in step with aiTriageState.undo (not reactive: only read when undoing). */
let undoRuns: UndoEntry[] = [];
let undoSeq = 0;
/** Current run: proposal ids (t1, t2…) only mean something inside their run. */
let runNumber = 0;
const tracker = createRequestTracker();
let controller: AbortController | null = null;

const report = $derived.by((): TriageReportItem[] => {
	const byKey = new Map(getSortQueue().map((tx): [string, Transaction] => [txKey(tx), tx]));
	const rejected = new Set(aiTriageState.rejected);
	return aiTriageState.proposals.flatMap((p) => {
		const tx = byKey.get(p.key);
		return tx && !rejected.has(p.id) ? [{ ...p, tx }] : [];
	});
});
const groups = $derived(groupProposals(report));
const sure = $derived(sureProposals(report));

/** Report lines whose operation is still in the queue (validated and rejected ones left). */
export function getTriageReport(): TriageReportItem[] {
	return report;
}

/** Report grouped by proposed category, then « garder en Autre », then internal transfers. */
export function getTriageGroups(): TriageGroup<TriageReportItem>[] {
	return groups;
}

/** Lines « Valider les sûres » would apply. */
export function getSureProposals(): TriageReportItem[] {
	return sure;
}

/** Summary of the AI over every batch. */
export function triageSummary(): string {
	return aiTriageState.summaries.filter(Boolean).join(' ');
}

/**
 * What an opt-in « toujours » rule would do for this operation: allowed only for a precise merchant
 * (ruleImpact not generic) and never for « Vacances »; `count` operations would follow it.
 */
export function triageRuleOption(tx: Transaction, categoryId?: CategoryId): { allowed: boolean; count: number; reason: string } {
	const impact = ruleImpact(tx);
	if (!impact) return { allowed: false, count: 0, reason: 'libellé sans commerçant' };
	if (categoryId === 'vacances') return { allowed: false, count: impact.count, reason: 'les vacances dépendent de la période, pas du commerçant' };
	return { allowed: !impact.generic, count: impact.count, reason: impact.reason };
}

/** Account sent to the AI: its kind only (« Compte courant »), never its number, label nor holder. */
function aiAccountKind(id: string): string {
	return KIND_LABELS[accountKind(id)];
}

/**
 * Categorised operations outside the queue, internal transfers and hidden operations left out: the
 * habits the AI leans on (buildTriageRequest also drops every line that would name a person).
 */
function categorisedHistory(queueKeys: ReadonlySet<string>): TriageHistoryEntry[] {
	const overrides = budgetState.overrides;
	const rules = rulesState.rules;
	const merchantMap = getMerchantCategoryMap();
	return getTransactions().flatMap((tx): TriageHistoryEntry[] => {
		const key = txKey(tx);
		if (queueKeys.has(key) || isPlannedInstalment(tx) || isInternal(key)) return [];
		return [{ tx, categoryId: categorize(tx, overrides, rules, merchantMap), subId: subcategorize(tx, overrides, rules, merchantMap), manual: key in overrides || !!ruleFor(tx, rules) }];
	});
}

/** Ends the run on an error (proposals already received stay in the report). */
function fail(kind: TriageErrorKind, message: string, toAiPage = false): void {
	aiTriageState.status = 'error';
	aiTriageState.errorKind = kind;
	aiTriageState.error = message;
	aiTriageState.toAiPage = toAiPage;
	controller = null;
}

type BatchResult = { body: unknown } | { kind: TriageErrorKind; message: string; toAiPage?: boolean };

/** One batch through the relay, with the same readable errors as « Organiser par l'IA ». */
async function postBatch(request: TriageRequest, signal: AbortSignal): Promise<BatchResult> {
	let res: Response;
	try {
		res = await fetch(`${aiState.url}/tri`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', 'x-ia-token': aiState.token },
			body: JSON.stringify(request),
			signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)])
		});
	} catch (e) {
		if (e instanceof DOMException && e.name === 'TimeoutError') return { kind: 'timeout', message: "L'IA n'a pas répondu à temps : réessaie dans un instant." };
		if (signal.aborted) return { kind: 'relay', message: 'Arrêté.' };
		if (e instanceof TypeError) aiState.connection = 'offline';
		return { kind: 'offline', message: 'Relais IA injoignable : lance « npm run ia » (voir la page Analyse IA).', toAiPage: true };
	}
	const body = (await res.json().catch(() => ({}))) as { error?: string; quota?: boolean; reason?: string };
	if (res.status === 401) {
		aiState.connection = 'bad-token';
		return { kind: 'bad-token', message: 'Jeton du relais IA refusé : recolle-le dans la page Analyse IA.', toAiPage: true };
	}
	if (res.status === 409) return { kind: 'busy', message: 'Le relais IA travaille déjà sur une autre demande : réessaie dans un instant.' };
	if (res.status === 429 || body.quota === true) return { kind: 'quota', message: `Quota Claude atteint : réessaie plus tard${body.error ? ` (${body.error})` : ''}.` };
	if (res.status === 404) return { kind: 'relay', message: 'Relais IA trop ancien : redémarre-le (npm run ia:install ou npm run ia) pour avoir le tri par l’IA.', toAiPage: true };
	if (body.reason === 'timeout') return { kind: 'timeout', message: "L'IA a mis trop longtemps sur ce lot : réessaie dans un instant." };
	if (body.reason === 'unreadable') return { kind: 'unreadable', message: "Réponse de l'IA illisible : réessaie dans un instant." };
	if (!res.ok) return { kind: 'relay', message: `L'IA n'a pas pu trier : ${body.error ?? `erreur ${res.status}`}.` };
	aiState.connection = 'ok';
	return { body };
}

/** Proposals the relay already refused (its `rejected` count), bounded by the batch size. */
function relayDropped(body: unknown, size: number): number {
	const n = body && typeof body === 'object' ? (body as { rejected?: unknown }).rejected : undefined;
	return typeof n === 'number' && Number.isInteger(n) && n > 0 ? Math.min(n, size) : 0;
}

/** Forgets the report and its decisions; validations stay on the undo stack, rejections leave it. */
function resetReport(): void {
	undoRuns = undoRuns.filter((e) => e.decision === 'applied');
	const kept = new Set(undoRuns.map((e) => e.seq));
	aiTriageState.undo = aiTriageState.undo.filter((u) => kept.has(u.seq));
	aiTriageState.error = '';
	aiTriageState.errorKind = null;
	aiTriageState.toAiPage = false;
	aiTriageState.stopped = false;
	aiTriageState.batchesDone = 0;
	aiTriageState.batchesTotal = 0;
	aiTriageState.sent = 0;
	aiTriageState.leftOut = 0;
	aiTriageState.summaries = [];
	aiTriageState.proposals = [];
	aiTriageState.dropped = 0;
	aiTriageState.applied = [];
	aiTriageState.rejected = [];
}

/**
 * « ✨ Proposer avec l'IA »: the queue (most recent first, at most MAX_BATCHES × TRIAGE_BATCH_SIZE
 * operations) goes to the relay batch by batch; each answer is checked and added to the report as it
 * comes. Operations sorted meanwhile are not sent. A new run replaces the previous report.
 */
export async function startTriage(): Promise<void> {
	if (aiTriageState.status === 'running') return;
	const queue = getSortQueue();
	if (!queue.length) return;
	resetReport();
	runNumber++;
	if (!aiState.token) return fail('config', 'Relais IA non configuré : colle son jeton dans la page Analyse IA.', true);
	const batches = triageBatches(queue.slice(0, MAX_BATCHES * TRIAGE_BATCH_SIZE));
	const catalogue = triageCatalogue(CATEGORIES, SUBCATEGORIES);
	const history = categorisedHistory(new Set(queue.map(txKey)));
	const privacy = privacyContext({ holderNames: triageHolderNames(accountState.accounts.map((a) => a.label)), history, catalogue });
	const ticket = tracker.demarrer();
	const mine = new AbortController();
	controller = mine;
	aiTriageState.status = 'running';
	aiTriageState.batchesTotal = batches.length;
	aiTriageState.sent = Math.min(queue.length, MAX_BATCHES * TRIAGE_BATCH_SIZE);
	aiTriageState.leftOut = Math.max(0, queue.length - aiTriageState.sent);
	for (const [i, batch] of batches.entries()) {
		const live = new Set(getSortQueue().map(txKey));
		const pending = batch.filter((tx) => live.has(txKey(tx)));
		if (!pending.length) {
			aiTriageState.batchesDone = i + 1;
			continue;
		}
		const { request, byId } = buildTriageRequest(pending, history, catalogue, { accountKind: aiAccountKind, privacy, firstId: i * TRIAGE_BATCH_SIZE + 1 });
		const result = await postBatch(request, mine.signal);
		if (!tracker.estCourant(ticket)) return;
		if (!('body' in result)) return fail(result.kind, result.message, result.toAiPage);
		const answer = parseTriageAnswer(result.body, byId.keys(), catalogue);
		if ('error' in answer) return fail('unreadable', answer.error);
		aiTriageState.proposals = [...aiTriageState.proposals, ...answer.propositions.map((p): StoredProposal => ({ ...p, key: txKey(byId.get(p.id)!) }))];
		aiTriageState.summaries = [...aiTriageState.summaries, answer.summary];
		aiTriageState.dropped += answer.rejected + relayDropped(result.body, pending.length);
		aiTriageState.batchesDone = i + 1;
	}
	controller = null;
	aiTriageState.status = 'done';
}

/** « Arrêter »: the relay stops Claude; the batches already answered stay in the report. */
export function abortTriage(): void {
	if (aiTriageState.status !== 'running') return;
	tracker.annuler();
	controller?.abort();
	controller = null;
	aiTriageState.stopped = true;
	aiTriageState.status = aiTriageState.proposals.length ? 'done' : 'idle';
}

/** Closes the report (nothing is undone: validated lines stay sorted). */
export function clearTriage(): void {
	abortTriage();
	resetReport();
	aiTriageState.status = 'idle';
}

/** Pushes an undo entry and records the decision. */
function record(ids: string[], decision: UndoEntry['decision'], label: string, writes: StepWrites | null): void {
	const seq = ++undoSeq;
	undoRuns = [...undoRuns, { seq, run: runNumber, ids, decision, writes }];
	aiTriageState.undo = [...aiTriageState.undo, { label, seq }];
	aiTriageState[decision] = [...aiTriageState[decision], ...ids];
}

/** An empty write log. */
function noWrites(): StepWrites {
	return { overrides: [], subsByTx: [], subsByMerchant: [], rules: [], refusedRules: [], kept: [], excluded: [], dismissedTransfers: [] };
}

/** Keys among `keys` the user had chosen to keep visible (transfer dialog), for an exact undo of excludeKeys. */
function dismissedAmong(keys: readonly string[]): string[] {
	const dismissed = new Set(transferState.dismissed);
	return keys.filter((k) => dismissed.has(k));
}

/** A stored subcategory entry: undefined when there is none, null when « no subcategory » was chosen. */
function storedSub(map: Record<string, string | null>, key: string): string | null | undefined {
	return key in map ? map[key] : undefined;
}

/** The subcategory entries a change on `tx` may touch (by operation, by merchant), as they are now. */
function subEntries(tx: Transaction): { key: string; mk: string; byTx: string | null | undefined; byMerchant: string | null | undefined } {
	const key = txKey(tx);
	const mk = merchantKey(tx.remittance_information);
	const { byTx, byMerchant } = budgetState.subOverrides;
	return { key, mk, byTx: storedSub(byTx, key), byMerchant: mk ? storedSub(byMerchant, mk) : undefined };
}

/** Logs the subcategory entries of `tx` the step changed (`before` → as they are now). */
function logSubs(writes: StepWrites, tx: Transaction, before: ReturnType<typeof subEntries>): void {
	const after = subEntries(tx);
	writes.subsByTx.push(...written(after.key, after.key, before.byTx, after.byTx));
	if (after.mk) writes.subsByMerchant.push(...written(after.mk, after.key, before.byMerchant, after.byMerchant));
}

/** Same rule: same category and same creation time (a rule changed since is another one). */
function sameRule(a: CatRule | undefined, b: CatRule | undefined): boolean {
	return a === b || (!!a && !!b && a.categoryId === b.categoryId && a.createdAt === b.createdAt);
}

/** The rule of a keyword as it is now. */
function currentRule(keyword: string): CatRule | undefined {
	return rulesState.rules.find((r) => r.keyword === keyword);
}

/** A subcategory id when it belongs to the category, else null. */
function subOf(categoryId: CategoryId, subId: string | null | undefined): string | null {
	return subId && getSubcategory(subId)?.categoryId === categoryId ? subId : null;
}

/** Category (and subcategory) for one operation, with the « toujours » rule when allowed; returns what it wrote. */
function applyCategory(tx: Transaction, categoryId: CategoryId, subId: string | null, always: boolean): { writes: StepWrites; ruleCount: number } {
	const key = txKey(tx);
	const writes = noWrites();
	const previous = budgetState.overrides[key];
	const option = always ? triageRuleOption(tx, categoryId) : null;
	const withRule = !!option?.allowed;
	const subs = subEntries(tx);
	const refused = rulesState.dismissed.includes(merchantKey(tx.remittance_information));
	const rule = withRule ? setOverrideAndRule(tx, categoryId) : (setOverride(key, categoryId), null);
	if (subId) setSubOverride(tx, subId, rule ? 'merchant' : 'tx');
	writes.overrides.push(...written(key, key, previous, budgetState.overrides[key]));
	if (rule) {
		writes.rules.push(...written(rule.keyword, key, rule.previous, currentRule(rule.keyword), sameRule));
		if (refused) writes.refusedRules.push(rule.keyword);
	}
	logSubs(writes, tx, subs);
	return { writes, ruleCount: rule && option ? option.count : 0 };
}

/** « Garder en Autre » for one operation, logged in `writes`. */
function keepLogged(writes: StepWrites, tx: Transaction, key: string): void {
	const before = sortQueueState.kept.includes(key) ? true : undefined;
	keepInOther(tx);
	writes.kept.push(...written<true>(key, key, before, sortQueueState.kept.includes(key) ? true : undefined));
}

/** Undoes « Garder en Autre » for operations given by key (unkeep takes the operation: found among all of them). */
function unkeepByKey(keys: readonly string[]): void {
	if (!keys.length) return;
	const wanted = new Set(keys);
	for (const tx of getTransactions()) if (wanted.has(txKey(tx))) unkeep(tx);
}

/** Hides operations from the budget (internal transfers), logged in `writes`. */
function excludeLogged(writes: StepWrites, keys: readonly string[]): void {
	if (!keys.length) return;
	const before = new Set(transferState.excluded);
	writes.dismissedTransfers.push(...dismissedAmong(keys));
	excludeKeys([...keys]);
	const after = new Set(transferState.excluded);
	for (const key of keys) writes.excluded.push(...written<true>(key, key, before.has(key) ? true : undefined, after.has(key) ? true : undefined));
}

/**
 * Compare-and-restore undo of one step, operation by operation: an operation whose entries all
 * still hold what the step wrote goes back to its values from before (category, subcategory, rule,
 * « Autre », hidden), in one write per store; an operation with one entry changed since (a choice
 * made by hand, another tool) is left whole as it is. Every entry is compared once (changedOps,
 * before any write), then restored (revertValues). Returns the operations left alone and the
 * operations of the step.
 */
function revertStep(writes: StepWrites): { changed: number; total: number } {
	const keptNow = new Set(sortQueueState.kept);
	const excludedNow = new Set(transferState.excluded);
	const changed = new Set([
		...changedOps(writes.overrides, (k) => budgetState.overrides[k]),
		...changedOps(writes.subsByTx, (k) => storedSub(budgetState.subOverrides.byTx, k)),
		...changedOps(writes.subsByMerchant, (k) => storedSub(budgetState.subOverrides.byMerchant, k)),
		...changedOps(writes.rules, currentRule, sameRule),
		...changedOps(writes.kept, (k) => (keptNow.has(k) ? true : undefined)),
		...changedOps(writes.excluded, (k) => (excludedNow.has(k) ? true : undefined))
	]);
	const overridePatch = Object.fromEntries(Object.entries(revertValues(writes.overrides, changed)).map(([k, v]) => [k, v ?? null]));
	if (Object.keys(overridePatch).length) patchOverrides(overridePatch);
	const byTx = revertValues(writes.subsByTx, changed);
	const byMerchant = revertValues(writes.subsByMerchant, changed);
	if (Object.keys(byTx).length || Object.keys(byMerchant).length) restoreSubOverrides(byTx, byMerchant);
	for (const [keyword, previous] of Object.entries(revertValues(writes.rules, changed))) restoreRule(keyword, previous, writes.refusedRules.includes(keyword));
	unkeepByKey(Object.keys(revertValues(writes.kept, changed)));
	unexcludeKeys(Object.keys(revertValues(writes.excluded, changed)), writes.dismissedTransfers);
	const all = [writes.overrides, writes.subsByTx, writes.subsByMerchant, writes.rules, writes.kept, writes.excluded] as WrittenValue<unknown>[][];
	return { changed: changed.size, total: new Set(all.flat().map((w) => w.op)).size };
}

/**
 * Validates one report line, as proposed or as changed by the user (`choice`): a category (with an
 * opt-in rule only when ruleImpact says it is not generic), « garder en Autre » (keepInOther) or an
 * internal transfer hidden from the budget (excludeKeys). A category « autre » means keep-other.
 * Returns the line's text for the toast (« Leclerc → Alimentation »), or null when the line is gone.
 */
export function applyProposal(id: string, choice: TriageChoice = {}): string | null {
	const item = report.find((r) => r.id === id);
	if (!item) return null;
	const tx = item.tx;
	const name = merchantLabel(tx.remittance_information) || tx.remittance_information[0] || 'Opération';
	const categoryId = choice.categoryId ?? (choice.kind === undefined || choice.kind === 'category' ? item.categoryId : undefined);
	const kind: TriageKind = categoryId === 'autre' ? 'keep-other' : (choice.kind ?? (choice.categoryId ? 'category' : item.kind));
	if (kind === 'category' && !categoryId) return null;
	if (kind === 'category' && categoryId) {
		const wanted = choice.subId !== undefined ? choice.subId : categoryId === item.categoryId ? item.subId : null;
		const { writes, ruleCount } = applyCategory(tx, categoryId, subOf(categoryId, wanted), choice.always === true);
		const label = `${name} → ${getCategory(categoryId).label}${ruleCount ? ` (règle : ${ruleCount} opération${ruleCount > 1 ? 's' : ''})` : ''}`;
		record([id], 'applied', label, writes);
		return label;
	}
	const writes = noWrites();
	if (kind === 'internal-transfer') {
		excludeLogged(writes, [item.key]);
		const label = `${name} masquée du budget (virement interne)`;
		record([id], 'applied', label, writes);
		return label;
	}
	const subId = subOf('autre', choice.subId !== undefined ? choice.subId : item.kind === 'keep-other' ? item.subId : null);
	const subs = subEntries(tx);
	keepLogged(writes, tx, item.key);
	if (subId) setSubOverride(tx, subId, 'tx');
	logSubs(writes, tx, subs);
	const label = `${name} gardée en « Autre »`;
	record([id], 'applied', label, writes);
	return label;
}

/** « Rejeter »: the line leaves the report, the operation stays in the queue (undoable). */
export function rejectProposal(id: string): void {
	if (!report.some((r) => r.id === id)) return;
	record([id], 'rejected', 'Proposition rejetée', null);
}

/** Plural « s » of a French word for `n`. */
const s = (n: number) => (n > 1 ? 's' : '');

/**
 * Several lines as proposed, in one write per store (never a rule: one click must not reclassify
 * whole merchants), recorded as ONE undo step. Categories go through the overrides, keep-other
 * through keepInOther, internal transfers through excludeKeys.
 */
function applyBatch(items: readonly TriageReportItem[], label: string): number {
	if (!items.length) return 0;
	const writes = noWrites();
	const patch: Record<string, CategoryId> = {};
	const previous: Record<string, CategoryId | undefined> = {};
	const subs: { tx: Transaction; subId: string | null }[] = [];
	const previousSubs: Record<string, string | null | undefined> = {};
	const kept: TriageReportItem[] = [];
	const hidden: string[] = [];
	for (const item of items) {
		const subId = subOf(item.kind === 'category' ? item.categoryId! : 'autre', item.subId);
		if (item.kind === 'internal-transfer') hidden.push(item.key);
		else if (item.kind === 'keep-other') kept.push(item);
		else {
			patch[item.key] = item.categoryId!;
			previous[item.key] = budgetState.overrides[item.key];
		}
		if (subId && item.kind !== 'internal-transfer') {
			subs.push({ tx: item.tx, subId });
			previousSubs[item.key] = storedSub(budgetState.subOverrides.byTx, item.key);
		}
	}
	if (Object.keys(patch).length) patchOverrides(patch);
	setTxSubOverrides(subs);
	for (const item of kept) keepLogged(writes, item.tx, item.key);
	excludeLogged(writes, hidden);
	for (const key of Object.keys(patch)) writes.overrides.push(...written(key, key, previous[key], budgetState.overrides[key]));
	for (const key of Object.keys(previousSubs)) writes.subsByTx.push(...written(key, key, previousSubs[key], storedSub(budgetState.subOverrides.byTx, key)));
	record(items.map((i) => i.id), 'applied', label, writes);
	return items.length;
}

/** « Valider les sûres »: every category proposed with a high confidence, one undo step. Returns the number of operations sorted. */
export function applySure(): number {
	const n = sure.length;
	return applyBatch(sure, `${n} proposition${s(n)} sûre${s(n)} validée${s(n)}`);
}

/**
 * « Valider le groupe »: every line of one report group (a category, « garder en Autre » or the
 * internal transfers) as proposed, one undo step. Returns the number of operations sorted.
 */
export function applyGroup(key: string): number {
	const group = groups.find((g) => g.key === key);
	if (!group) return 0;
	const n = group.items.length;
	const target = group.kind === 'category' ? `→ ${getCategory(group.categoryId!).label}` : group.kind === 'keep-other' ? 'gardée' + s(n) + ' en « Autre »' : 'masquée' + s(n) + ' du budget';
	return applyBatch(group.items, `${n} opération${s(n)} ${target}`);
}

/**
 * Undoes the last validation or rejection; returns its message, or null when there is nothing to
 * undo. With `seq`, only while that step is still the last one (a toast never undoes a later step).
 * Compare-and-restore: what was changed since the validation (by hand, another tool) stays as it is,
 * and a toast says how many operations were left alone.
 */
export function undoLastTriage(seq?: number): string | null {
	const last = undoRuns.at(-1);
	const shown = aiTriageState.undo.at(-1);
	if (!last || !shown || (seq !== undefined && last.seq !== seq)) return null;
	undoRuns = undoRuns.slice(0, -1);
	aiTriageState.undo = aiTriageState.undo.slice(0, -1);
	const { changed, total } = last.writes ? revertStep(last.writes) : { changed: 0, total: 0 };
	if (last.run === runNumber) {
		const ids = new Set(last.ids);
		aiTriageState[last.decision] = aiTriageState[last.decision].filter((id) => !ids.has(id));
	}
	const message = undoMessage(shown.label, changed, total);
	if (changed) showToast(message);
	return message;
}

/**
 * « Annuler » of the toast shown right after a validation: bound to that step, it does nothing once
 * another step was recorded or undone meanwhile.
 */
export function triageUndoHandle(): () => void {
	const seq = aiTriageState.undo.at(-1)?.seq;
	return () => {
		if (seq !== undefined) undoLastTriage(seq);
	};
}
