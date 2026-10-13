<script module lang="ts">
	/**
	 * Operations sorted by each AI validation step (undo seq → count), for the session counter. Module
	 * level, like the AI report: it survives a page change, never a reload.
	 */
	const aiCounts: Record<number, number> = $state({});
</script>

<script lang="ts">
	import { onMount } from 'svelte';
	import type { CategoryId, Transaction } from '$lib/types';
	import { CATEGORIES, categorize, getCategory, txKey, type CatRule } from '$lib/categories';
	import { subcategorize, subcategoriesFor, getSubcategory } from '$lib/subcategories';
	import { budgetState, setOverride, clearOverride, setSubOverride } from '$lib/budget.svelte';
	import { setOverrideAndRule, restoreRule, ruleImpact, rulesState, extractKeyword } from '$lib/rules.svelte';
	import { getMerchantCategoryMap, updateImported } from '$lib/store.svelte';
	import { excludeKeys, unexcludeKeys, isHidden, transferState } from '$lib/transfers.svelte';
	import { getSortQueue, keepInOther, unkeep } from '$lib/sortQueue.svelte';
	import { vacationFor, assignVacation } from '$lib/vacations.svelte';
	import { signedAmount } from '$lib/data';
	import { formatDate, formatEUR } from '$lib/format';
	import { merchantLabel } from '$lib/merchant';
	import { accountLabel } from '$lib/accounts.svelte';
	import { showToast, uiState, showSuccess } from '$lib/ui.svelte';
	import { navigate, pageSnapshot } from '$lib/router.svelte';
	import {
		aiTriageState,
		startTriage,
		abortTriage,
		clearTriage,
		getTriageReport,
		getTriageGroups,
		getSureProposals,
		triageSummary,
		triageRuleOption,
		applyProposal,
		rejectProposal,
		applySure,
		applyGroup,
		undoLastTriage,
		triageUndoHandle,
		type TriageErrorKind,
		type TriageReportItem
	} from '$lib/aiTriage.svelte';
	import type { TriageChoice } from '$lib/aiTriage.svelte';
	import type { TriageConfidence, TriageProposal } from '$lib/aiTriage';
	import PageTitle from '$lib/components/PageTitle.svelte';
	import CategoryMark from '$lib/components/CategoryMark.svelte';
	import { contextActions, SEPARATOR, type MenuInput } from '$lib/contextMenu.svelte';

	/**
	 * Sorting inbox: operations still in 'Autre' (wealth movements and hidden operations excluded),
	 * one by one, with the keyboard.
	 * 1-9, 0, E: category; S: subcategory; N: note
	 * Enter / →: skip; ←: back; M: hide from the budget
	 * V: holidays (period of the date); G: keep in 'Autre'; R: 'always' rule on/off
	 * I: accept the AI proposal of the card (« ✨ Proposer avec l'IA », report above the card)
	 * Right click: the card offers the same actions as its keys; a report line offers Valider,
	 * another category and Rejeter; the report folds or unfolds all its groups.
	 */

	const CATS = CATEGORIES.filter((c) => c.id !== 'autre');
	const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', 'e'];

	/** Confidence chip of an AI proposal. */
	const CONFIDENCE: Readonly<Record<TriageConfidence, { label: string; chip: string }>> = {
		haute: { label: 'sûre', chip: 'chip-accent' },
		moyenne: { label: 'probable', chip: 'chip-outline' },
		basse: { label: 'à vérifier', chip: 'chip-muted' }
	};
	/** Icon of an AI failure: setup to fix, wait and retry, or unreadable answer. */
	const ERROR_ICONS: Readonly<Record<TriageErrorKind, string>> = {
		config: '⚙',
		offline: '⚙',
		'bad-token': '⚙',
		relay: '⚙',
		busy: '⏳',
		timeout: '⏳',
		quota: '⏳',
		unreadable: '⚠'
	};
	/** Keys that move the choice of a closed list (they would validate a report line at once). */
	const LIST_MOVE_KEYS: ReadonlySet<string> = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown']);

	/** Operations to sort (queue shared with the Sidebar badge: sortQueue.svelte.ts). */
	const queue = $derived(getSortQueue());
	/** Keys skipped (Enter) during this session: reviewed at the end of the queue. */
	let skipped = $state<string[]>([]);
	const pending = $derived(queue.filter((tx) => !skipped.includes(txKey(tx))));
	const current = $derived<Transaction | null>(pending[0] ?? queue.find((tx) => skipped.includes(txKey(tx))) ?? null);

	let done = $state(0);
	/** Operations sorted by AI validations still on the undo stack (an undone step stops counting). */
	const aiDone = $derived(aiTriageState.undo.reduce((sum, u) => sum + (aiCounts[u.seq] ?? 0), 0));
	const sortedCount = $derived(done + aiDone);
	const totalAtStart = $derived(queue.length + sortedCount);
	/** 'Always' rule: unchecked by default (one key must not reclassify a whole merchant). */
	let alwaysRule = $state(false);
	let noteDraft = $state('');
	let noteEl = $state<HTMLInputElement | null>(null);
	let subEl = $state<HTMLSelectElement | null>(null);
	/** Last action of the card (for 'undo'): previous override, the rule it may have created, or the AI step. */
	let last = $state<{
		tx: Transaction;
		label: string;
		kind: 'category' | 'mask' | 'keep' | 'ai';
		prevOverride?: CategoryId;
		rule?: { keyword: string; previous?: CatRule; dismissed: boolean } | null;
		wasDismissed?: string[];
		seq?: number;
	} | null>(null);
	/** An AI step is only undone from the card while it is still the last one of the AI undo stack. */
	const canUndoLast = $derived(!!last && (last.kind !== 'ai' || aiTriageState.undo.at(-1)?.seq === last.seq));

	/** Impact of a rule on the current merchant (number of operations, discouraged rule?). */
	const impact = $derived(current ? ruleImpact(current) : null);
	const canRule = $derived(!!impact && !impact.generic);
	let flash = $state<CategoryId | null>(null);

	/** Opt-in « toujours » of each report line (proposal id → ticked), reset with each run. */
	let alwaysById = $state<Record<string, boolean>>({});
	/** Report groups folded by the user (group key → folded). */
	let folded = $state<Record<string, boolean>>({});

	const report = $derived(getTriageReport());
	const sure = $derived(getSureProposals());
	const summary = $derived(triageSummary());
	const lastAiUndo = $derived(aiTriageState.undo.at(-1) ?? null);
	const showReport = $derived(aiTriageState.status !== 'idle' || report.length > 0);
	/** AI proposal for the operation of the card, when the report has one. */
	const currentProposal = $derived.by((): TriageReportItem | null => {
		const tx = current;
		if (!tx) return null;
		const key = txKey(tx);
		return report.find((r) => r.key === key) ?? null;
	});
	/**
	 * « toujours » option of each category line of the unfolded groups, computed once per merchant
	 * and group (ruleImpact scans every operation).
	 */
	const ruleOptions = $derived.by(() => {
		const byMerchant = new Map<string, ReturnType<typeof triageRuleOption>>();
		const byId = new Map<string, ReturnType<typeof triageRuleOption>>();
		for (const g of getTriageGroups()) {
			if (g.kind !== 'category' || folded[g.key]) continue;
			for (const item of g.items) {
				const k = `${g.key}|${extractKeyword(item.tx)}`;
				const option = byMerchant.get(k) ?? triageRuleOption(item.tx, item.categoryId);
				byMerchant.set(k, option);
				byId.set(item.id, option);
			}
		}
		return byId;
	});

	/** Back, Forward and a reload return to the same operation (the skipped ones stay skipped) and the session's progress. */
	pageSnapshot(
		'triage',
		() => ({ skipped, done }),
		(snap) => {
			if (Array.isArray(snap.skipped) && snap.skipped.every((k) => typeof k === 'string')) skipped = snap.skipped;
			if (Number.isInteger(snap.done) && snap.done >= 0) done = snap.done;
		}
	);

	$effect(() => {
		noteDraft = current?.note ?? '';
	});

	/** Never a 'Vacances' rule (it depends on a period) nor a discouraged rule. */
	function apply(categoryId: CategoryId) {
		const tx = current;
		if (!tx) return;
		const label = merchantLabel(tx.remittance_information) || 'cette opération';
		const prevOverride = budgetState.overrides[txKey(tx)];
		const withRule = alwaysRule && canRule && categoryId !== 'vacances';
		const ruleDismissed = withRule && rulesState.dismissed.includes(extractKeyword(tx));
		const created = withRule ? setOverrideAndRule(tx, categoryId) : (setOverride(txKey(tx), categoryId), null);
		const rule = created ? { ...created, dismissed: ruleDismissed } : null;
		done++;
		last = { tx, label, kind: 'category', ...(prevOverride ? { prevOverride } : {}), rule };
		flash = categoryId;
		window.setTimeout(() => (flash = null), 350);
		const scope = rule && impact ? ` (règle : ${impact.count} opération${impact.count > 1 ? 's' : ''})` : '';
		showToast(`${label} → ${getCategory(categoryId).label}${scope}`, 'Annuler', () => undo());
	}

	/** Really undoes the last action: the override (persisted) AND the rule it created, or the AI step. */
	function undo() {
		if (!last || !canUndoLast) return;
		if (last.kind === 'ai') {
			if (last.seq !== undefined) undoLastTriage(last.seq);
			last = null;
			return;
		}
		const key = txKey(last.tx);
		if (last.kind === 'category') {
			if (last.prevOverride) setOverride(key, last.prevOverride);
			else clearOverride(key);
			if (last.rule) restoreRule(last.rule.keyword, last.rule.previous, last.rule.dismissed);
		} else if (last.kind === 'mask') unexcludeKeys([key], last.wasDismissed ?? []);
		else unkeep(last.tx);
		done = Math.max(0, done - 1);
		last = null;
	}

	function skip() {
		if (!current) return;
		const key = txKey(current);
		skipped = skipped.includes(key) ? [...skipped.filter((k) => k !== key), key] : [...skipped, key];
	}
	function back() {
		if (skipped.length === 0) return;
		skipped = skipped.slice(0, -1);
	}
	function mask() {
		const tx = current;
		if (!tx) return;
		const key = txKey(tx);
		const wasDismissed = transferState.dismissed.includes(key) ? [key] : [];
		excludeKeys([key]);
		done++;
		last = { tx, label: merchantLabel(tx.remittance_information) || 'cette opération', kind: 'mask', wasDismissed };
		showToast('Opération masquée du budget', 'Annuler', () => undo());
	}
	/** 'Garder en Autre': a genuine miscellaneous expense leaves the queue (decision remembered). */
	function keep() {
		const tx = current;
		if (!tx) return;
		keepInOther(tx);
		done++;
		last = { tx, label: merchantLabel(tx.remittance_information) || 'cette opération', kind: 'keep' };
		showToast('Gardée en « Autre »', 'Annuler', () => undo());
	}
	function toVacation() {
		const tx = current;
		if (!tx) return;
		const p = vacationFor(tx);
		if (p) {
			assignVacation(tx, p.id);
			done++;
			showToast(`Rattachée aux vacances « ${p.label} »`);
		} else {
			apply('vacances');
		}
	}
	function saveNote() {
		const tx = current;
		if (!tx) return;
		if ((tx.note ?? '') === noteDraft) return;
		if (updateImported(txKey(tx), { note: noteDraft })) showSuccess('Note enregistrée');
	}
	function onSubChange(e: Event) {
		const tx = current;
		if (!tx) return;
		const v = (e.target as HTMLSelectElement).value;
		setSubOverride(tx, v || null, alwaysRule ? 'merchant' : 'tx');
	}

	/** « ✨ Proposer avec l'IA » / « Relancer l'IA »: a new report, the ticks of the previous one forgotten. */
	function runAi() {
		alwaysById = {};
		void startTriage();
	}
	/** « Fermer le rapport »: nothing is undone (validated lines stay sorted and undoable). */
	function closeReport() {
		alwaysById = {};
		folded = {};
		clearTriage();
	}
	/** Remembers how many operations the AI step just recorded sorted, for the session counter. */
	function countAiStep(n: number) {
		const seq = aiTriageState.undo.at(-1)?.seq;
		if (seq !== undefined && n > 0) aiCounts[seq] = n;
	}
	/** Toast of an AI validation: its « Annuler » undoes that step only, never a later one. */
	function toastAi(label: string) {
		showToast(label, 'Annuler', triageUndoHandle());
	}
	/** Validates one report line (with the rule when « toujours » is ticked and allowed). */
	function validateLine(item: TriageReportItem, choice: TriageChoice = { always: alwaysById[item.id] === true }) {
		const label = applyProposal(item.id, choice);
		if (!label) return;
		countAiStep(1);
		toastAi(label);
	}
	/** « Changer… »: another category, « garder en Autre » or an internal transfer for that line. */
	function changeLine(item: TriageReportItem, e: Event) {
		const select = e.currentTarget as HTMLSelectElement;
		const v = select.value;
		select.value = '';
		if (!v) return;
		validateLine(item, v === 'keep-other' || v === 'internal-transfer' ? { kind: v } : { categoryId: v as CategoryId });
	}
	/**
	 * « Changer… » only acts on a choice picked in its open list: on the closed list a letter
	 * (type-ahead: G → « Garder en Autre ») or an arrow would validate the line at once, so those keys
	 * do nothing there; a click, Space or Alt+↓ opens the list.
	 */
	function guardChangeKeys(e: KeyboardEvent) {
		if (e.altKey || e.ctrlKey || e.metaKey) return;
		if ((e.key.length === 1 && e.key !== ' ') || LIST_MOVE_KEYS.has(e.key)) e.preventDefault();
	}
	/** « Valider les sûres »: every sure line in one undo step, with its own toast. */
	function validateSure() {
		const n = applySure();
		if (!n) return;
		countAiStep(n);
		toastAi(`${n} opération${n > 1 ? 's' : ''} triée${n > 1 ? 's' : ''}`);
	}
	/** « Valider le groupe »: every line of one report group in one undo step, with its own toast. */
	function validateGroup(key: string) {
		const n = applyGroup(key);
		if (!n) return;
		countAiStep(n);
		toastAi(`${n} opération${n > 1 ? 's' : ''} triée${n > 1 ? 's' : ''}`);
	}
	/** « I » / « Accepter »: the AI proposal of the card as proposed (the R box adds the rule when allowed). */
	function acceptAi() {
		const tx = current;
		const p = currentProposal;
		if (!tx || !p) return;
		const label = applyProposal(p.id, { always: alwaysRule });
		if (!label) return;
		countAiStep(1);
		const seq = aiTriageState.undo.at(-1)?.seq;
		last = { tx, label: merchantLabel(tx.remittance_information) || 'cette opération', kind: 'ai', ...(seq !== undefined ? { seq } : {}) };
		flash = p.categoryId ?? 'autre';
		window.setTimeout(() => (flash = null), 350);
		toastAi(label);
	}
	/** What the AI proposes, in words (« Alimentation › Courses », « Garder en « Autre » »…). */
	function proposalTarget(p: TriageProposal): string {
		if (p.kind === 'internal-transfer') return 'Virement interne (masqué du budget)';
		const sub = p.subId ? getSubcategory(p.subId)?.label : undefined;
		const head = p.kind === 'keep-other' ? 'Garder en « Autre »' : getCategory(p.categoryId!).label;
		return sub ? `${head} › ${sub}` : head;
	}
	/** « 1 opération », « 3 opérations ». */
	const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`;

	/** Right-click entries of the card: the actions of its keys. */
	function cardActions(): MenuInput[] {
		const p = currentProposal;
		return [
			p && { label: `Accepter l'IA : ${proposalTarget(p)}`, hint: 'I', onSelect: acceptAi },
			{ label: 'Classer dans', items: CATS.map((c, i) => ({ label: c.label, category: c.id, ...(KEYS[i] ? { hint: KEYS[i].toUpperCase() } : {}), onSelect: () => apply(c.id) })) },
			{ label: 'Garder en « Autre »', hint: 'G', onSelect: keep },
			{ label: 'Masquer du budget', hint: 'M', onSelect: mask },
			{ label: 'Passer', hint: 'Entrée', onSelect: skip },
			last && canUndoLast && { label: `Annuler « ${last.label} »`, hint: 'Z', onSelect: undo }
		];
	}

	/** Right-click entries of a report line: the same choices as its buttons and its « Changer… » list. */
	function lineActions(item: TriageReportItem): MenuInput[] {
		return [
			{ label: `Valider : ${proposalTarget(item)}`, onSelect: () => validateLine(item) },
			{
				label: 'Changer pour',
				items: [
					...CATS.map((c) => ({ label: c.label, category: c.id, onSelect: () => validateLine(item, { categoryId: c.id }) })),
					SEPARATOR,
					{ label: 'Garder en Autre', category: 'autre' as CategoryId, onSelect: () => validateLine(item, { kind: 'keep-other' }) },
					{ label: 'Virement interne', onSelect: () => validateLine(item, { kind: 'internal-transfer' }) }
				]
			},
			{ label: 'Rejeter', onSelect: () => rejectProposal(item.id) }
		];
	}

	/** Right-click entries of a report group header. */
	function groupActions(key: string): MenuInput[] {
		return [
			{ label: 'Valider le groupe', onSelect: () => validateGroup(key) },
			{ label: folded[key] ? 'Déplier le groupe' : 'Replier le groupe', onSelect: () => (folded[key] = !folded[key]) }
		];
	}

	/** Right-click entries of the whole report (after those of a line or a group). */
	function reportActions(): MenuInput[] {
		const keys = getTriageGroups().map((g) => g.key);
		return [
			keys.some((k) => folded[k]) && { label: 'Tout déplier', onSelect: () => (folded = {}) },
			keys.some((k) => !folded[k]) && { label: 'Tout replier', onSelect: () => (folded = Object.fromEntries(keys.map((k) => [k, true]))) },
			sure.length > 0 && { label: `Valider les sûres (${sure.length})`, onSelect: validateSure }
		];
	}

	/** Enter on a focused button or link lets that element act instead of skipping. */
	function onKey(e: KeyboardEvent) {
		if (uiState.paletteOpen || uiState.shortcutsOpen || uiState.dialogDepth > 0) return;
		const t = e.target as HTMLElement;
		const typing = t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT';
		if (typing) {
			if (e.key === 'Escape') (t as HTMLInputElement).blur();
			return;
		}
		if (e.key === 'Enter' && t.closest('button, a')) return;
		if (e.metaKey || e.ctrlKey || e.altKey) return;
		const k = e.key.toLowerCase();
		const idx = KEYS.indexOf(k);
		if (idx >= 0 && CATS[idx]) {
			e.preventDefault();
			apply(CATS[idx]!.id);
		} else if (e.key === 'Enter' || e.key === 'ArrowRight') {
			e.preventDefault();
			skip();
		} else if (e.key === 'ArrowLeft') {
			e.preventDefault();
			back();
		} else if (k === 'm') mask();
		else if (k === 'v') toVacation();
		else if (k === 'g') keep();
		else if (k === 'r' && canRule) alwaysRule = !alwaysRule;
		else if (k === 'i' && currentProposal) {
			e.preventDefault();
			if (!e.repeat) acceptAi();
		} else if (k === 'n') {
			e.preventDefault();
			noteEl?.focus();
		} else if (k === 's') {
			e.preventDefault();
			subEl?.focus();
		} else if (k === 'z' && canUndoLast) undo();
	}

	/**
	 * « I » with an AI proposal on the card: taken in the capture phase, before the app shortcut that
	 * opens the imports, then handled by onKey (a held key accepts one proposal only, never the next
	 * cards unseen).
	 */
	function claimAiKey(e: KeyboardEvent) {
		if ((e.key !== 'i' && e.key !== 'I') || !currentProposal || e.metaKey || e.ctrlKey || e.altKey) return;
		if (uiState.paletteOpen || uiState.shortcutsOpen || uiState.dialogDepth > 0) return;
		if ((e.target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
		e.stopImmediatePropagation();
		onKey(e);
	}

	onMount(() => {
		window.addEventListener('keydown', onKey);
		window.addEventListener('keydown', claimAiKey, true);
		return () => {
			window.removeEventListener('keydown', onKey);
			window.removeEventListener('keydown', claimAiKey, true);
		};
	});

	const currentCat = $derived(current ? categorize(current, budgetState.overrides, undefined, getMerchantCategoryMap()) : null);
	const currentSub = $derived(current ? subcategorize(current, budgetState.overrides, undefined, getMerchantCategoryMap()) : null);
	const progressPct = $derived(totalAtStart > 0 ? Math.round((sortedCount / totalAtStart) * 100) : 100);
</script>

<header class="mb-4 flex flex-wrap items-end justify-between gap-3">
	<!-- Capital 'À' badly drawn in DM Serif (misplaced accent): title in accented lowercase -->
	<PageTitle title="Opérations à trier" />
	<div class="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
		<p class="meta-xs">{queue.length} à classer · {sortedCount} traitée{sortedCount > 1 ? 's' : ''} cette session</p>
		{#if queue.length > 0 && aiTriageState.status !== 'running'}
			<button type="button" class="btn btn-secondary btn-sm" onclick={runAi}>✨ {aiTriageState.proposals.length ? "Relancer l'IA" : "Proposer avec l'IA"}</button>
		{/if}
	</div>
</header>

<div class="mb-3 h-1 w-full overflow-hidden rounded-full" style="background-color: var(--surface-2);" aria-hidden="true">
	<div class="h-full rounded-full transition-[width] duration-300" style="width: {progressPct}%; background-color: var(--accent);"></div>
</div>

{#if aiTriageState.status === 'running'}
	{@const total = Math.max(1, aiTriageState.batchesTotal)}
	<div class="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1" role="status">
		<p class="meta-xs">✨ L'IA lit {plural(aiTriageState.sent, 'opération')}… lot {Math.min(aiTriageState.batchesDone + 1, total)}/{total}</p>
		<div class="h-1 w-20 overflow-hidden rounded-full" style="background-color: var(--surface-2);" aria-hidden="true">
			<div class="h-full rounded-full transition-[width] duration-300" style="width: {(aiTriageState.batchesDone / total) * 100}%; background-color: var(--accent);"></div>
		</div>
		<p class="meta-xs">Les autres fonctions IA répondent « occupé » en attendant.</p>
		<button type="button" class="btn btn-secondary btn-sm" onclick={abortTriage}>Arrêter</button>
	</div>
{/if}

{#if aiTriageState.status === 'error'}
	<section class="card mb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 p-3 text-[13px]" style="border-color: color-mix(in srgb, var(--debit) 45%, var(--hairline));" role="alert">
		<p class="min-w-0 flex-1">
			{#if aiTriageState.errorKind}<span aria-hidden="true">{ERROR_ICONS[aiTriageState.errorKind]}</span>{/if}
			{aiTriageState.error}
			{#if aiTriageState.proposals.length}<span class="meta-xs">Les propositions déjà reçues restent ci-dessous.</span>{/if}
		</p>
		{#if aiTriageState.toAiPage}
			<button type="button" class="btn btn-secondary btn-sm" onclick={() => navigate('/ia')}>Ouvrir Analyse IA</button>
		{/if}
	</section>
{/if}

{#if showReport}
	<section class="card mb-3 p-4" aria-labelledby="ai-report-title" use:contextActions={reportActions}>
		<div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
			<div class="min-w-0">
				<h2 id="ai-report-title" class="label-xs">✨ Rapport de l'IA</h2>
				<p class="meta-xs tabular mt-1">
					{plural(report.length, 'proposition')} · {sure.length} sûre{sure.length > 1 ? 's' : ''} · {aiTriageState.applied.length} validée{aiTriageState.applied.length > 1 ? 's' : ''} · {aiTriageState.rejected.length} rejetée{aiTriageState.rejected.length > 1 ? 's' : ''}
				</p>
			</div>
			<div class="flex min-w-0 flex-wrap items-center gap-2">
				<button type="button" class="btn btn-primary btn-sm" disabled={sure.length === 0} onclick={validateSure}>Valider les sûres ({sure.length})</button>
				{#if lastAiUndo}
					<button type="button" class="btn btn-secondary btn-sm min-w-0 max-w-[16rem]" title="Annuler « {lastAiUndo.label} »" onclick={() => undoLastTriage()}>
						<span class="truncate">Annuler « {lastAiUndo.label} »</span>
					</button>
				{/if}
				<button type="button" class="btn btn-secondary btn-sm" onclick={closeReport}>Fermer le rapport</button>
			</div>
		</div>
		{#if summary}<p class="meta-xs mt-2 line-clamp-2" title={summary}>{summary}</p>{/if}
		{#if aiTriageState.leftOut > 0 || aiTriageState.dropped > 0 || aiTriageState.stopped}
			<p class="meta-xs mt-1">
				{#if aiTriageState.stopped}<span class="text-amber">Arrêté : rapport partiel.</span>{/if}
				{#if aiTriageState.leftOut > 0}{plural(aiTriageState.leftOut, 'opération')} plus ancienne{aiTriageState.leftOut > 1 ? 's' : ''} non envoyée{aiTriageState.leftOut > 1 ? 's' : ''} : relance après ce lot.{/if}
				{#if aiTriageState.dropped > 0}{plural(aiTriageState.dropped, 'proposition')} écartée{aiTriageState.dropped > 1 ? 's' : ''} (opération ou catégorie inconnue).{/if}
			</p>
		{/if}

		{#if report.length > 0}
			<ul class="mt-2 grid max-h-[55vh] grid-cols-[minmax(0,1fr)_auto] gap-x-3 overflow-y-auto overscroll-contain lg:grid-cols-[minmax(0,11rem)_auto_minmax(0,1fr)_auto]">
				{#each getTriageGroups() as g (g.key)}
					{@const color = g.kind === 'category' ? getCategory(g.categoryId!).color : 'var(--text-2)'}
					<li class="sticky top-0 z-[1] col-span-full flex items-center gap-2 border-t px-1 py-1" style="border-color: var(--hairline); background-color: color-mix(in srgb, {color} 6%, var(--surface));" use:contextActions={() => groupActions(g.key)}>
						<button type="button" class="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left text-[13px]" aria-expanded={!folded[g.key]} title={folded[g.key] ? 'Déplier le groupe' : 'Replier le groupe'} onclick={() => (folded[g.key] = !folded[g.key])}>
							<span class="meta-xs w-2.5 shrink-0" aria-hidden="true">{folded[g.key] ? '▸' : '▾'}</span>
							{#if g.kind === 'category'}
								<CategoryMark id={g.categoryId!} size={18} />
								<span class="truncate font-medium">{getCategory(g.categoryId!).label}</span>
							{:else if g.kind === 'keep-other'}
								<CategoryMark id="autre" size={18} />
								<span class="truncate font-medium">Garder en Autre</span>
							{:else}
								<span class="w-[18px] shrink-0 text-center text-secondary" aria-hidden="true">⇄</span>
								<span class="truncate font-medium">Virements internes (masqués du budget)</span>
							{/if}
							<span class="meta-xs tabular shrink-0">{g.items.length}&nbsp;op.</span>
						</button>
						<button type="button" class="btn btn-secondary btn-sm shrink-0" onclick={() => validateGroup(g.key)}>Valider le groupe</button>
					</li>
					{#if !folded[g.key]}
						{#each g.items as item (item.id)}
							{@const a = signedAmount(item.tx)}
							{@const sub = item.subId ? getSubcategory(item.subId)?.label : undefined}
							{@const conf = CONFIDENCE[item.confidence]}
							{@const opt = item.kind === 'category' ? ruleOptions.get(item.id) : undefined}
							<li class="col-span-full grid grid-cols-subgrid items-center gap-y-1 border-t px-1 py-1.5 text-[13px]" style="border-color: var(--border-subtle);" use:contextActions={() => lineActions(item)}>
								<span class="min-w-0 truncate" title={item.tx.remittance_information.join(' ')}>{merchantLabel(item.tx.remittance_information) || item.tx.remittance_information[0]}</span>
								<span class="tabular text-right whitespace-nowrap {a >= 0 ? 'text-accent' : 'text-debit'}">{a >= 0 ? '+' : '−'}{formatEUR(Math.abs(a))}</span>
								<span class="meta-xs col-span-2 flex min-w-0 items-center gap-1.5 lg:col-span-1">
									<span class="tabular shrink-0">{formatDate(item.tx.booking_date)}</span>
									{#if sub}<span class="shrink-0">› {sub}</span>{/if}
									<span class="chip {conf.chip} shrink-0">{conf.label}</span>
									{#if item.reason}<span class="min-w-0 truncate" title={item.reason}>{item.reason}</span>{/if}
								</span>
								<span class="col-span-2 flex flex-wrap items-center gap-1.5 lg:col-span-1 lg:justify-end">
									{#if opt}
										<label class="meta-xs order-last flex items-center gap-1 lg:order-none {opt.allowed ? 'cursor-pointer' : 'opacity-60'}" title={opt.allowed ? `Règle pour ce commerçant : ${plural(opt.count, 'opération')}` : `Règle déconseillée : ${opt.reason}`}>
											<input type="checkbox" bind:checked={alwaysById[item.id]} disabled={!opt.allowed} />
											toujours ({opt.count}&nbsp;op.)
											{#if item.always && opt.allowed}<span class="chip chip-outline">suggéré</span>{/if}
										</label>
									{/if}
									<button type="button" class="btn btn-secondary btn-sm" onclick={() => validateLine(item)}>Valider</button>
									<select class="input-surface w-[6.5rem] cursor-pointer" aria-label="Changer la proposition" onkeydown={guardChangeKeys} onchange={(e) => changeLine(item, e)}>
										<option value="">Changer…</option>
										{#each CATS as c (c.id)}
											<option value={c.id}>{c.label}</option>
										{/each}
										<option value="keep-other">Garder en Autre</option>
										<option value="internal-transfer">Virement interne</option>
									</select>
									<button type="button" class="btn btn-secondary btn-sm" onclick={() => rejectProposal(item.id)}>Rejeter</button>
								</span>
							</li>
						{/each}
					{/if}
				{/each}
			</ul>
		{:else if aiTriageState.status === 'running'}
			<p class="meta-xs mt-2">Les propositions arrivent lot par lot.</p>
		{:else if aiTriageState.status === 'done'}
			<p class="meta-xs mt-2">{aiTriageState.proposals.length ? 'Plus aucune proposition en attente.' : "L'IA n'a rien proposé pour ces opérations."}</p>
		{/if}
	</section>
{/if}

{#if !current}
	<section class="card p-6 text-center">
		<p class="serif text-lg">Tout est trié.</p>
		<p class="meta-xs mt-1">Plus rien à classer. Les échéances de crédit et les frais bancaires restent en « Autre » sans passer par ici.</p>
		<button type="button" class="btn btn-secondary btn-sm mt-3" onclick={() => navigate('/transactions')}>Voir les transactions</button>
	</section>
{:else}
	{@const tx = current}
	{@const amount = signedAmount(tx)}
	{@const label = merchantLabel(tx.remittance_information)}
	<div class="grid grid-cols-1 gap-3 lg:grid-cols-12">
		<section class="card card-lift p-4 lg:col-span-7" style={flash ? `border-color: ${getCategory(flash).color};` : ''} use:contextActions={cardActions}>
			<div class="flex items-start justify-between gap-4">
				<div class="min-w-0">
					<p class="serif truncate text-xl">{label || tx.remittance_information[0]}</p>
					<p class="meta-xs mt-0.5 break-words">{tx.remittance_information.join(' ')}</p>
				</div>
				<p class="tabular shrink-0 text-xl font-semibold {amount >= 0 ? 'text-accent' : 'text-debit'}">{amount >= 0 ? '+' : '−'}{formatEUR(Math.abs(amount))}</p>
			</div>
			<p class="meta-xs mt-2">
				{formatDate(tx.booking_date)}{#if tx.account} · {accountLabel(tx.account)}{/if}
				{#if tx.bank_category} · banque : {tx.bank_category}{#if tx.bank_subcategory} / {tx.bank_subcategory}{/if}{/if}
				{#if isHidden(txKey(tx))} · masquée{/if}
			</p>

			{#if currentProposal}
				{@const p = currentProposal}
				{@const conf = CONFIDENCE[p.confidence]}
				<div class="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border px-2.5 py-1.5 text-[13px]" style="border-color: color-mix(in srgb, var(--accent) 35%, var(--hairline)); background-color: color-mix(in srgb, var(--accent) 5%, transparent);">
					<span class="shrink-0">✨ IA :</span>
					{#if p.kind === 'category'}<CategoryMark id={p.categoryId!} size={16} />{/if}
					<span class="min-w-0 truncate font-medium">{proposalTarget(p)}</span>
					<span class="chip {conf.chip} shrink-0">{conf.label}</span>
					{#if p.reason}<span class="meta-xs min-w-0 flex-1 truncate" title={p.reason}>— {p.reason}</span>{/if}
					<button type="button" class="btn btn-secondary btn-sm ml-auto shrink-0" onclick={acceptAi}>Accepter <kbd class="kbd ml-1">I</kbd></button>
				</div>
			{/if}

			<!-- Categories: keys 1-9, 0 -->
			<div class="mt-4 grid grid-cols-2 gap-1.5 sm:grid-cols-3" role="group" aria-label="Catégorie">
				{#each CATS as c, i (c.id)}
					<button
						type="button"
						class="press flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-[13px] transition-colors hover:border-[var(--text-2)]"
						style="border-color: var(--hairline); background-color: var(--surface);"
						onclick={() => apply(c.id)}
					>
						<kbd class="kbd">{KEYS[i]}</kbd>
						<CategoryMark id={c.id} size={20} />
						<span class="truncate">{c.label}</span>
					</button>
				{/each}
			</div>

			<div class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px]">
				<label class="flex items-center gap-1.5 {canRule ? 'cursor-pointer' : 'opacity-60'}" title={impact?.generic ? `Règle déconseillée : ${impact.reason}` : undefined}>
					<input type="checkbox" bind:checked={alwaysRule} disabled={!canRule} />
					Toujours pour « {label || 'ce libellé'} »
					{#if impact}
						<span class="meta-xs">
							{#if impact.generic}— déconseillé : {impact.reason}{:else}— {impact.count} opération{impact.count > 1 ? 's' : ''}{/if}
						</span>
					{/if}
					<kbd class="kbd">R</kbd>
				</label>
				<label class="flex items-center gap-1.5">
					<span class="text-secondary">Sous-catégorie</span>
					<select bind:this={subEl} class="input-surface cursor-pointer" value={currentSub ?? ''} onchange={onSubChange} aria-label="Sous-catégorie" disabled={!currentCat || currentCat === 'autre' ? subcategoriesFor('autre').length === 0 : false}>
						<option value="">—</option>
						{#each subcategoriesFor(currentCat ?? 'autre') as s (s.id)}
							<option value={s.id}>{s.label}</option>
						{/each}
					</select>
					<kbd class="kbd">S</kbd>
				</label>
			</div>

			<label class="mt-3 block">
				<span class="meta-xs">Note <kbd class="kbd">N</kbd></span>
				<input bind:this={noteEl} type="text" class="input-surface mt-1 w-full" placeholder="ex. cadeau neveu, remboursé par Morgan…" bind:value={noteDraft} onblur={saveNote} onkeydown={(e) => { if (e.key === 'Enter') { saveNote(); (e.target as HTMLInputElement).blur(); } }} />
			</label>

			<div class="mt-4 flex flex-wrap items-center gap-2">
				<button type="button" class="btn btn-secondary btn-sm" onclick={skip}>Passer <kbd class="kbd ml-1">Entrée</kbd></button>
				<button type="button" class="btn btn-secondary btn-sm" disabled={skipped.length === 0} onclick={back}>← Revenir</button>
				<button type="button" class="btn btn-secondary btn-sm" onclick={mask}>Masquer du budget <kbd class="kbd ml-1">M</kbd></button>
				<button type="button" class="btn btn-secondary btn-sm" onclick={toVacation}>Vacances <kbd class="kbd ml-1">V</kbd></button>
				<button type="button" class="btn btn-secondary btn-sm" onclick={keep}>Garder en « Autre » <kbd class="kbd ml-1">G</kbd></button>
				{#if last && canUndoLast}<button type="button" class="btn btn-secondary btn-sm" onclick={undo}>Annuler « {last.label} » <kbd class="kbd ml-1">Z</kbd></button>{/if}
			</div>
		</section>

		<aside class="card p-4 lg:col-span-5">
			<h2 class="label-xs">Suivantes</h2>
			<ul class="mt-2 divide-y divide-[var(--border-subtle)] text-[13px]">
				{#each pending.slice(1, 9) as n (txKey(n))}
					{@const a = signedAmount(n)}
					<li class="flex items-baseline justify-between gap-3 py-1">
						<span class="min-w-0 truncate">{merchantLabel(n.remittance_information) || n.remittance_information[0]}</span>
						<span class="tabular shrink-0 text-secondary">{formatDate(n.booking_date)} · {a >= 0 ? '+' : '−'}{formatEUR(Math.abs(a))}</span>
					</li>
				{:else}
					<li class="py-1 text-secondary">Rien d'autre en attente.</li>
				{/each}
			</ul>
			{#if skipped.length > 0}
				<p class="meta-xs mt-2">{skipped.length} passée{skipped.length > 1 ? 's' : ''}, revues en fin de file.</p>
			{/if}
			<p class="meta-xs mt-3">Une vraie dépense diverse (avocat, coiffeur, virement à un proche) ? « Garder en Autre » (G) la sort de la file pour de bon.</p>
		</aside>
	</div>
{/if}
