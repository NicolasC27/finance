<script lang="ts">
	import { untrack } from 'svelte';
	import { getCategory } from '$lib/categories';
	import { todayIso } from '$lib/forecast';
	import { formatDate, formatEUR } from '$lib/format';
	import { parseQuickEntry, type QuickDraft } from '$lib/quickEntry';
	import { QUICK_SUBCATEGORIES, quickAccounts, saveQuickPayment, suggestCategory } from '$lib/quickEntry.svelte';
	import { showSuccess, uiState } from '$lib/ui.svelte';
	import CategoryMark from './CategoryMark.svelte';

	/**
	 * Quick entry as a row of the list, like the empty first row of a spreadsheet: a sentence typed
	 * there (« leboncoin 20,25 € », « resto hier 34 € swile ») is read as you type and the category
	 * and the amount show at the right. Enter saves it on the spot (card, first current account,
	 * suggested category) when nothing needs a look; a named voucher, an unknown category or a
	 * future date open the full dialog instead, as Shift+Enter always does, with the sentence
	 * handed over and handed back if the dialog is cancelled. `compact`: the dashboard card.
	 */
	let { compact = false }: { compact?: boolean } = $props();

	let text = $state('');
	let handedOver = $state(false);

	const draft = $derived.by(() => {
		const parsed = parseQuickEntry(text, todayIso());
		return 'error' in parsed ? null : parsed;
	});
	const suggestion = $derived(draft ? suggestCategory(draft.label, draft.credit) : null);
	const categoryId = $derived(draft?.categoryId ?? suggestion?.categoryId ?? 'autre');
	const subId = $derived.by(() => {
		const auto = draft?.categoryId === categoryId && draft?.subId ? draft.subId : suggestion?.categoryId === categoryId ? suggestion.subId : null;
		return auto && QUICK_SUBCATEGORIES.some((s) => s.id === auto && s.categoryId === categoryId) ? auto : null;
	});
	const ready = $derived(!!draft && draft.label.trim().length > 0 && draft.amount > 0 && draft.amount < 1_000_000);
	/** What Enter needs the dialog for: a voucher to split, a category to choose, a date to check. */
	const needsALook = $derived(!!draft && (draft.payment !== undefined || (!draft.categoryId && suggestion?.source === 'none') || draft.date > todayIso()));

	function save() {
		if (!draft || !ready) return;
		const entry: QuickDraft = { label: draft.label.trim(), amount: Math.round(draft.amount * 100) / 100, credit: draft.credit, date: draft.date };
		const account = quickAccounts()[0]?.id ?? 'cm';
		const r = saveQuickPayment(entry, account, categoryId, subId, 'card');
		text = '';
		showSuccess(`${entry.credit ? 'Rentrée' : 'Dépense'} ajoutée : ${entry.label} ${entry.credit ? '+' : '−'}${formatEUR(entry.amount)}, ${r.summary}`, 'Annuler', r.undo);
	}

	function details() {
		uiState.quickEntryText = text;
		handedOver = true;
		text = '';
		uiState.quickEntryOpen = true;
	}

	$effect(() => {
		if (uiState.quickEntryOpen || !handedOver) return;
		handedOver = false;
		text = untrack(() => uiState.quickEntryText);
		uiState.quickEntryText = '';
	});

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			if (!ready) return;
			if (e.shiftKey || needsALook) details();
			else save();
		} else if (e.key === 'Escape') {
			text = '';
			(e.currentTarget as HTMLInputElement).blur();
		}
	}
</script>

<div class="flex items-center gap-2.5 {compact ? 'px-2 py-1.5' : 'px-4 py-1.5'}">
	<span class="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md" style="color: var(--accent); background-color: var(--accent-soft);" aria-hidden="true">
		<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
	</span>
	<input
		bind:value={text}
		type="text"
		class="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-[var(--text-3)]"
		placeholder={compact ? 'Nouvelle dépense : leboncoin 20,25 €…' : 'Nouvelle dépense : leboncoin 20,25 € · resto hier 34 € swile'}
		aria-label="Saisir une dépense : une phrase puis Entrée ; Maj+Entrée pour les détails"
		title="Une phrase suffit : marchand, montant, et la date si ce n'est pas aujourd'hui. Entrée : enregistrée tout de suite · Maj+Entrée : les détails"
		autocomplete="off"
		spellcheck="false"
		maxlength="300"
		onkeydown={onKey}
	/>
	{#if draft}
		<span class="meta-xs hidden shrink-0 items-center gap-1.5 sm:flex">
			<CategoryMark id={categoryId} size={16} />
			{getCategory(categoryId).label}{draft.date !== todayIso() ? ` · ${formatDate(draft.date)}` : ''}
		</span>
		<span class="tabular shrink-0 text-[13px] font-medium {draft.credit ? 'text-accent' : 'text-debit'}">{draft.credit ? '+' : '−'}{formatEUR(draft.amount)}</span>
		{#if !compact}<span class="meta-xs hidden shrink-0 xl:inline">{needsALook ? '↵ vérifier' : '↵ enregistrer · ⇧↵ détails'}</span>{/if}
	{:else if text.trim()}
		<span class="meta-xs shrink-0">et le montant ?</span>
	{/if}
</div>
