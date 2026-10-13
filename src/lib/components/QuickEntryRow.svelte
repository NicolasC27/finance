<script lang="ts">
	import { untrack } from 'svelte';
	import { getCategory } from '$lib/categories';
	import { todayIso } from '$lib/forecast';
	import { formatDate, formatEUR } from '$lib/format';
	import { instalmentPlan, instalmentText, parseQuickEntry, withoutCashWords, type QuickDraft } from '$lib/quickEntry';
	import { QUICK_SUBCATEGORIES, quickAccounts, saveQuickPayment, suggestCategory } from '$lib/quickEntry.svelte';
	import { showSuccess, uiState } from '$lib/ui.svelte';
	import { knownPeople } from '$lib/refunds.svelte';
	import { cashChipLabel } from '$lib/wallet.svelte';
	import CategoryMark from './CategoryMark.svelte';

	/**
	 * Quick entry as a row of the list, like the empty first row of a spreadsheet: a sentence typed
	 * there (« leboncoin 20,25 € », « resto hier 34 € swile ») is read as you type and the category
	 * and the amount show at the right. Enter saves it on the spot (card, first current account,
	 * suggested category) when nothing needs a look; a named voucher, an unknown category or a
	 * future date open the full dialog instead, as Shift+Enter always does, with the sentence
	 * handed over and handed back if the dialog is cancelled. « en 3 fois » shows one dot per
	 * instalment (filled: counted today). The « Liquide » chip (on by itself for « en liquide »,
	 * « espèces », « cash ») sends the spend to the cash wallet instead of the card, with no
	 * statement to wait for. `compact`: the dashboard card.
	 */
	let { compact = false }: { compact?: boolean } = $props();

	let text = $state('');
	let handedOver = $state(false);
	/** Cash chip pressed by hand (null: follow the sentence). */
	let cashPicked = $state<boolean | null>(null);
	let field = $state<HTMLInputElement | null>(null);

	const draft = $derived.by(() => {
		const parsed = parseQuickEntry(text, todayIso(), knownPeople());
		return 'error' in parsed ? null : parsed;
	});
	const suggestion = $derived(draft ? suggestCategory(draft.label, draft.credit) : null);
	const categoryId = $derived(draft?.categoryId ?? suggestion?.categoryId ?? 'autre');
	const subId = $derived.by(() => {
		const auto = draft?.categoryId === categoryId && draft?.subId ? draft.subId : suggestion?.categoryId === categoryId ? suggestion.subId : null;
		return auto && QUICK_SUBCATEGORIES.some((s) => s.id === auto && s.categoryId === categoryId) ? auto : null;
	});
	const cash = $derived(cashPicked ?? draft?.payment === 'cash');
	const plan = $derived(draft?.instalments && !draft.credit && !draft.payment && !cash ? instalmentPlan(draft, todayIso()) : null);
	const ready = $derived(!!draft && draft.label.trim().length > 0 && draft.amount > 0 && draft.amount < 1_000_000);
	/** What Enter needs the dialog for: a voucher to split, a person to check, a category to choose, a date to check. */
	const needsALook = $derived(!!draft && ((draft.payment !== undefined && draft.payment !== 'cash') || draft.forWhom !== undefined || (!draft.categoryId && suggestion?.source === 'none') || draft.date > todayIso()));

	function save() {
		if (!draft || !ready) return;
		const entry: QuickDraft = { label: draft.label.trim(), amount: Math.round(draft.amount * 100) / 100, credit: draft.credit, date: draft.date, ...(plan ? { instalments: plan.length } : {}) };
		const account = quickAccounts()[0]?.id ?? 'cm';
		const r = saveQuickPayment(entry, account, categoryId, subId, cash ? 'cash' : 'card');
		text = '';
		cashPicked = null;
		showSuccess(`${entry.credit ? 'Rentrée' : 'Dépense'} ajoutée : ${entry.label} ${entry.credit ? '+' : '−'}${formatEUR(entry.amount)}, ${r.summary}`, 'Annuler', r.undo);
	}

	function details() {
		const named = draft?.payment === 'cash';
		uiState.quickEntryText = cash === named ? text : cash ? `${text} en liquide` : withoutCashWords(text);
		handedOver = true;
		text = '';
		cashPicked = null;
		uiState.quickEntryOpen = true;
	}

	/** Cash chip: toggles the payment and gives the focus back to the field, so Enter still saves. */
	function toggleCash() {
		cashPicked = !cash;
		field?.focus();
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
			cashPicked = null;
			(e.currentTarget as HTMLInputElement).blur();
		}
	}
</script>

<div class="flex items-center gap-2.5 {compact ? 'px-2 py-1.5' : 'px-4 py-1.5'}">
	<span class="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md" style="color: var(--accent); background-color: var(--accent-soft);" aria-hidden="true">
		<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
	</span>
	<input
		bind:this={field}
		bind:value={text}
		type="text"
		class="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-[var(--text-3)]"
		placeholder={compact ? 'Nouvelle dépense : leboncoin 20,25 €…' : 'Nouvelle dépense : leboncoin 20,25 € · resto hier 34 € swile'}
		aria-label="Saisir une dépense : une phrase puis Entrée ; Maj+Entrée pour les détails"
		title="Une phrase suffit : marchand, montant, et la date si ce n'est pas aujourd'hui. Entrée : enregistrée tout de suite · Maj+Entrée : les détails"
		autocomplete="off"
		spellcheck="false"
		maxlength="300"
		oninput={(e) => {
			if (!e.currentTarget.value.trim()) cashPicked = null;
		}}
		onkeydown={onKey}
	/>
	{#if draft}
		<span class="meta-xs hidden shrink-0 items-center gap-1.5 sm:flex">
			<CategoryMark id={categoryId} size={16} />
			{getCategory(categoryId).label}{draft.date !== todayIso() ? ` · ${formatDate(draft.date)}` : ''}
			{#if plan}
				<span class="instalments" title={instalmentText(plan, todayIso())}>
					· en {plan.length} fois
					{#each plan as p (p.n)}<i class:due={p.due} aria-hidden="true"></i>{/each}
					<span class="sr-only">: {instalmentText(plan, todayIso())}</span>
				</span>
			{/if}
		</span>
		<button type="button" class="chip shrink-0 cursor-pointer {cash ? 'chip-accent' : 'chip-muted'}" aria-pressed={cash} title={cash ? 'Payé en liquide : sort du porte-monnaie, sans relevé à attendre' : 'Payé en liquide ? Le porte-monnaie se remplit avec tes retraits'} onmousedown={(e) => e.preventDefault()} onclick={toggleCash}>{cashChipLabel()}</button>
		<span class="tabular shrink-0 text-[13px] font-medium {draft.credit ? 'text-accent' : 'text-debit'}">{draft.credit ? '+' : '−'}{formatEUR(draft.amount)}</span>
		{#if !compact}<span class="meta-xs hidden shrink-0 xl:inline">{needsALook ? '↵ vérifier' : plan ? `↵ enregistrer les ${plan.length} échéances` : '↵ enregistrer · ⇧↵ détails'}</span>{/if}
	{:else if text.trim()}
		<span class="meta-xs shrink-0">et le montant ?</span>
	{/if}
</div>

<style>
	.instalments {
		display: inline-flex;
		align-items: center;
		gap: 3px;
	}
	.instalments i {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		border: 1px solid var(--accent);
	}
	.instalments i:first-of-type {
		margin-left: 3px;
	}
	.instalments i.due {
		background-color: var(--accent);
	}
</style>
