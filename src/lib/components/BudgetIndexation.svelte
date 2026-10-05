<script lang="ts">
	import { segmented } from '$lib/actions/segmented';
	import type { CategoryId } from '$lib/types';
	import { getCategory, CATEGORIES } from '$lib/categories';
	import { isExpenseCategory } from '$lib/flow';
	import { budgetState } from '$lib/budget.svelte';
	import { formatEURCompact as formatEUR, formatDate } from '$lib/format';
	import { showToast, showSuccess } from '$lib/ui.svelte';
	import { RECENT_INFLATION, SECTOR_INFLATION } from '$lib/inflation';
	import { inflationByCategory } from '$lib/personalInflation';
	import { undoableIndexation, indexationToSuggest, indexBudgets, type Indexation } from '$lib/indexation';
	import { getPriceItemSpends, monthsBefore } from '$lib/priceItems.svelte';
	import { undoIndexation, applyIndexation, financeSettings } from '$lib/financeSettings.svelte';

	/**
	 * Indexed budgets: in one click, envelopes follow inflation, either everywhere at the same rate
	 * (latest INSEE year-on-year change) or item by item (each category's own inflation, from your
	 * spending over the last 12 months). Offered in January; preview before applying; can be undone
	 * for 30 days (toast, then link).
	 */

	const today = new Date().toISOString().slice(0, 10);
	const MONTH_NAMES = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
	const globalRate = RECENT_INFLATION.taux;
	const source = `INSEE, ${MONTH_NAMES[Number(RECENT_INFLATION.mois.slice(5, 7)) - 1]} ${RECENT_INFLATION.mois.slice(0, 4)} sur un an`;

	let open = $state(false);
	let mode = $state<'global' | 'postes'>('global');

	/** Inflation of each category from your spending over the last 12 complete months. */
	const byCategory = $derived.by(() => {
		const months = new Set(monthsBefore(today.slice(0, 7), 12));
		const year = Math.max(...Object.keys(SECTOR_INFLATION).map(Number));
		return inflationByCategory(getPriceItemSpends().filter((d) => months.has(d.mois)), year);
	});

	/** Expense category envelopes (taxes excluded: they are not prices). */
	const envelopes = $derived(Object.fromEntries(CATEGORIES.filter((c) => isExpenseCategory(c.id) && (budgetState.budgets[c.id] ?? 0) > 0).map((c) => [c.id, budgetState.budgets[c.id]!])) as Partial<Record<CategoryId, number>>);
	const preview = $derived(indexBudgets(envelopes, (c) => (c === 'impots' ? null : mode === 'global' ? globalRate : (byCategory.get(c) ?? globalRate))));
	const rows = $derived((Object.keys(envelopes) as CategoryId[]).map((c) => ({ c, avant: envelopes[c]!, apres: preview.budgets[c]!, taux: preview.taux[c] })));
	const totalBefore = $derived(rows.reduce((s, l) => s + l.avant, 0));
	const totalAfter = $derived(rows.reduce((s, l) => s + l.apres, 0));

	const latest = $derived(financeSettings.indexation);
	const suggested = $derived(indexationToSuggest(today, latest));
	const undoable = $derived(undoableIndexation(latest, budgetState.budgets, today));

	const pct = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`;

	function apply() {
		const ix: Indexation = { date: today, mode, taux: preview.taux, avant: envelopes, apres: preview.budgets };
		const message = `Enveloppes indexées : ${formatEUR(totalBefore)} → ${formatEUR(totalAfter)} par mois`;
		applyIndexation(ix);
		open = false;
		showSuccess(message, 'Annuler', undo);
	}
	function undo() {
		undoIndexation();
		showToast('Indexation annulée : enveloppes d’avant rétablies');
	}
</script>

{#if suggested && !open}
	<div class="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border px-3 py-2 text-[13px]" style="border-color: var(--accent); background-color: var(--accent-soft);">
		<span class="min-w-0 flex-1">Nouvelle année : tes enveloppes peuvent suivre l'inflation ({pct(globalRate)} sur un an).</span>
		<button type="button" class="btn btn-primary btn-sm" onclick={() => (open = true)}>Voir l'aperçu</button>
	</div>
{:else if !open}
	<p class="meta-xs mb-2 flex flex-wrap items-center gap-x-2">
		<button type="button" class="cursor-pointer font-medium hover:underline" style="color: var(--accent);" onclick={() => (open = true)}>Indexer les enveloppes sur l'inflation</button>
		{#if latest}
			<span>· indexées le {formatDate(latest.date)} ({latest.mode === 'global' ? pct(Object.values(latest.taux)[0] ?? 0) : 'par poste'})</span>
			{#if undoable}<button type="button" class="cursor-pointer hover:underline" onclick={undo}>annuler</button>{/if}
		{/if}
	</p>
{/if}

{#if open}
	<div class="mb-3 rounded-lg border p-3 text-[13px]" style="border-color: var(--border);">
		<div class="flex flex-wrap items-center gap-2">
			<span class="font-medium">Indexer les enveloppes</span>
			<div class="flex gap-1" role="group" aria-label="Taux d'indexation" use:segmented>
				<button type="button" class="chip cursor-pointer {mode === 'global' ? 'chip-accent' : 'chip-muted'}" aria-pressed={mode === 'global'} onclick={() => (mode = 'global')}>{pct(globalRate)} partout</button>
				<button type="button" class="chip cursor-pointer {mode === 'postes' ? 'chip-accent' : 'chip-muted'}" aria-pressed={mode === 'postes'} onclick={() => (mode = 'postes')}>poste par poste</button>
			</div>
			<span class="meta-xs flex-1">{mode === 'global' ? source : 'inflation de chaque poste INSEE, pondérée par tes dépenses des 12 derniers mois'}</span>
		</div>
		{#if rows.length === 0}
			<p class="meta-xs mt-2">Aucune enveloppe définie : fixe d'abord tes budgets par catégorie.</p>
		{:else}
			<div class="mt-2 grid gap-x-6 gap-y-0.5 sm:grid-cols-2 lg:grid-cols-3">
				{#each rows as l (l.c)}
					<div class="flex items-baseline gap-2 py-0.5">
						<span class="inline-block h-2 w-2 shrink-0 rounded-full" style="background-color: {getCategory(l.c).color};"></span>
						<span class="min-w-0 flex-1 truncate">{getCategory(l.c).label}</span>
						<span class="tabular text-secondary">{formatEUR(l.avant)}</span>
						<span class="text-secondary">→</span>
						<span class="tabular font-medium">{formatEUR(l.apres)}</span>
						<span class="meta-xs tabular w-14 text-right">{l.taux !== undefined ? pct(l.taux) : 'inchangé'}</span>
					</div>
				{/each}
			</div>
			<div class="mt-2 flex flex-wrap items-center gap-2 border-t pt-2" style="border-color: var(--border-subtle);">
				<span class="flex-1">Total : <span class="tabular">{formatEUR(totalBefore)}</span> → <b class="tabular">{formatEUR(totalAfter)}</b> par mois <span class="meta-xs">({pct(totalBefore > 0 ? (totalAfter / totalBefore - 1) * 100 : 0)})</span></span>
				<button type="button" class="btn btn-primary btn-sm" onclick={apply}>Appliquer</button>
				<button type="button" class="btn btn-secondary btn-sm" onclick={() => (open = false)}>Fermer</button>
			</div>
		{/if}
	</div>
{/if}
