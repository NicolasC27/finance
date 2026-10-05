<script lang="ts">
	import type { Transaction, CategoryId } from '$lib/types';
	import { CATEGORIES, categorize, getCategory, txKey } from '$lib/categories';
	import { budgetState } from '$lib/budget.svelte';
	import { setOverrideAndPrompt } from '$lib/rules.svelte';
	import { cleanLabel, formatDate, formatEUR } from '$lib/format';
	import { merchantLabel } from '$lib/merchant';
	import { isPending, signedAmount } from '$lib/data';
	import { deleteTransactions, restoreTransactions, getMerchantCategoryMap } from '$lib/store.svelte';
	import { showToast } from '$lib/ui.svelte';
	import CategoryIcon from './CategoryIcon.svelte';

	/**
	 * Transaction row: icon, cleaned label, editable category, date, signed amount. `compact`
	 * (Dashboard): read only, category as text, no select and no deletion.
	 */
	let {
		tx,
		compact = false,
		showDate = true,
		showCategory = true
	}: {
		tx: Transaction;
		compact?: boolean;
		/** Date column (block element of the compact list). */
		showDate?: boolean;
		/** Category column in compact mode (block element). */
		showCategory?: boolean;
	} = $props();

	const pending = $derived(isPending(tx));
	const amount = $derived(signedAmount(tx));
	const categoryId = $derived(categorize(tx, budgetState.overrides, undefined, getMerchantCategoryMap()));
	const category = $derived(getCategory(categoryId));
	// List label: short merchantLabel (SPEC v13 §A), raw label in the tooltip
	const displayLabel = $derived(merchantLabel(tx.remittance_information) || cleanLabel(tx.remittance_information));
	const rawLabel = $derived(tx.remittance_information.join(' ').replace(/\s+/g, ' ').trim());

	function onCategoryChange(event: Event) {
		setOverrideAndPrompt(tx, (event.target as HTMLSelectElement).value as CategoryId);
	}

	/** Deletion: tombstone + toast with undo ('Annuler' reinjects the copy). */
	function onDelete() {
		const key = txKey(tx);
		const { backup } = deleteTransactions([key]);
		showToast('Opération supprimée', 'Annuler', () => restoreTransactions(backup, [key]));
	}
</script>

<div class="row-hover fade-slide group flex items-center gap-2.5 rounded-lg px-2 {compact ? 'py-1' : 'py-1.5'}" class:quick-pending={tx.source === 'manual'}>
	<!-- Bare category icon: 1.5 stroke, category colour (no more tinted square) -->
	<span class="flex h-6 w-6 shrink-0 items-center justify-center" style="color: {category.color};" aria-hidden="true">
		<CategoryIcon id={categoryId} size={15} />
	</span>

	<div class="min-w-0 flex-1">
		<p class="truncate text-[13px] font-medium" title={rawLabel}>
			{displayLabel}
			{#if pending}
				<span class="chip chip-amber ml-2">En cours</span>
			{/if}
			{#if tx.source === 'manual'}
				<span class="chip chip-outline ml-2" title="Saisie rapide : remplacée par l'opération de la banque à l'import du relevé">à rapprocher</span>
			{/if}
		</p>
	</div>

	<!-- Inline date (compact mode); for a pending transaction the 'En cours' badge is enough -->
	{#if showDate}
		<span class="meta-xs tabular hidden w-20 shrink-0 text-right whitespace-nowrap sm:block">{pending ? '—' : formatDate(tx.booking_date)}</span>
	{/if}

	<!-- Category: text in compact mode, override select otherwise -->
	{#if compact}
		{#if showCategory}
			<span class="meta-xs hidden w-24 shrink-0 truncate sm:block" title={category.label}>{category.label}</span>
		{/if}
	{:else}
		<select
			class="input-surface hidden w-28 shrink-0 cursor-pointer sm:block"
			value={categoryId}
			onchange={onCategoryChange}
			aria-label="Catégorie"
		>
			{#each CATEGORIES as cat (cat.id)}
				<option value={cat.id}>{cat.label}</option>
			{/each}
		</select>
	{/if}
	<span class="h-2 w-2 shrink-0 rounded-full sm:hidden" style="background-color: {category.color};" title={category.label}></span>

	<p class="tabular w-24 shrink-0 text-right text-[13px] font-medium {amount >= 0 ? 'text-accent' : 'text-debit'}">
		{amount >= 0 ? '+' : '−'}{formatEUR(Math.abs(amount))}
	</p>

	<!-- Deletion: bare bin (1.5 stroke), revealed when hovering the row (not in compact mode) -->
	{#if !compact}
	<button
		type="button"
		class="shrink-0 cursor-pointer text-secondary opacity-0 transition-all duration-150 group-hover:opacity-100 hover:text-[var(--amber)] focus-visible:opacity-100"
		aria-label="Supprimer cette opération"
		title="Supprimer"
		onclick={onDelete}
	>
		<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
			<path d="M4 7h16" />
			<path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
			<path d="M6.5 7l.8 12a1 1 0 0 0 1 .9h7.4a1 1 0 0 0 1-.9l.8-12" />
			<path d="M10 11v6M14 11v6" />
		</svg>
	</button>
	{/if}
</div>
