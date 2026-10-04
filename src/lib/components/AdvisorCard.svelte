<script lang="ts">
	import { buildAdvice, type AdvisorResult } from '$lib/advisor';
	import { budgetState, setBudget } from '$lib/budget.svelte';
	import { getMerchantCategoryMap } from '$lib/store.svelte';
	import { getBudgetTransactions } from '$lib/transfers.svelte';
	import { uiState, showToast } from '$lib/ui.svelte';
	import type { CategoryId } from '$lib/types';
	import { formatEUR } from '$lib/format';

	/**
	 * 'Conseils' card (Budget page block): target budgets per item based on a recalibrated 50/30/20
	 * rule, Apply buttons, savings capacity panel. The basis sentence, target list, savings capacity
	 * and « Tout appliquer » follow the block's « Éléments affichés »; `twoColumns` lays the targets
	 * out on two columns once the nearest `@container` (the tile) is at least 576 px wide, whatever the
	 * window width. `advice` can be passed when the page already
	 * computed it (it renders the block only when there is advice); otherwise the card computes it,
	 * on the budget scope (internal transfers excluded from averages and salary).
	 */
	let {
		advice: given,
		showBasis = true,
		showList = true,
		showCapacity = true,
		showApplyAll = true,
		twoColumns = true
	}: { advice?: AdvisorResult | null; showBasis?: boolean; showList?: boolean; showCapacity?: boolean; showApplyAll?: boolean; twoColumns?: boolean } = $props();

	const advice = $derived(given !== undefined ? given : buildAdvice(getBudgetTransactions(), budgetState.overrides, budgetState.budgets, getMerchantCategoryMap()));

	/**
	 * Applies every target, with 'Annuler' (before: overwritten with no way back, even when the
	 * section was collapsed).
	 */
	function applyAll() {
		if (!advice) return;
		const before: Partial<Record<CategoryId, number>> = { ...budgetState.budgets };
		let n = 0;
		for (const row of advice.advice) {
			if (row.target > 0 && row.target !== (before[row.categoryId] ?? 0)) {
				setBudget(row.categoryId, row.target);
				n++;
			}
		}
		if (n === 0) {
			showToast('Les budgets sont déjà sur les cibles conseillées');
			return;
		}
		showToast(`${n} budget${n > 1 ? 's' : ''} mis à jour`, 'Annuler', () => {
			for (const row of advice!.advice) setBudget(row.categoryId, before[row.categoryId] ?? 0);
		});
	}

	/** Prefills the goal form with the suggestion (Objectifs section). */
	function createSuggestedGoal() {
		if (!advice?.goalSuggestion) return;
		uiState.goalPrefill = { name: advice.goalSuggestion.name, targetAmount: advice.goalSuggestion.amount };
	}
</script>

{#if advice}
	<!-- Card with its header (collapsing is done by the block); 'Tout appliquer' stays at the top -->
	<section class="card card-lift fade-slide p-4" style="--stagger: 120ms;">
		<div class="flex items-center justify-between gap-3">
			<h2 class="label-xs">Conseils</h2>
			{#if showApplyAll}
				<button type="button" class="btn btn-accent btn-sm shrink-0" onclick={applyAll}>
					Tout appliquer
				</button>
			{/if}
		</div>
		{#if showBasis}
			<p class="meta-xs mt-1.5">
				Sur la base de
				<span class="tabular font-medium" style="color: var(--text);">{formatEUR(advice.salary)}/mois</span>
				{advice.salarySource === 'recurring' ? 'de salaire détecté' : 'de revenus médians'} — référentiel
				{Math.round(advice.reference.needs * 100)}/{Math.round(advice.reference.wants * 100)}/{Math.round(advice.reference.savings * 100)}
				(besoins / envies / épargne).
				{#if advice.calibrated}
					<span style="color: var(--amber);">
						Paliers recalibrés : votre logement pèse {Math.round(advice.rentShare * 100)} % de vos revenus.
					</span>
				{/if}
			</p>
		{/if}

		<!-- Two columns when the tile is wide: 8 tips fit in 4 rows -->
		{#if showList}
			<ul class="mt-3 grid gap-x-8 {twoColumns ? '@xl:grid-cols-2' : ''}">
				{#each advice.advice as row (row.categoryId)}
					<li class="flex flex-wrap items-center gap-x-2.5 gap-y-1 border-b py-1.5 text-[13px]" style="border-color: var(--border-subtle);">
						<span class="min-w-0 flex-1 truncate font-medium">{row.label}</span>
						<span class="tabular text-secondary" title="Budget actuel">
							{row.current > 0 ? formatEUR(row.current) : '—'}
						</span>
						<span class="text-secondary" aria-hidden="true">→</span>
						<span class="tabular font-semibold" title="Budget cible conseillé">{formatEUR(row.target)}</span>
						{#if row.current > 0}
							<span
								class="chip tabular {row.tone === 'amber' ? 'chip-amber' : 'chip-accent'}"
								title={row.tone === 'amber' ? 'Budget actuel au-dessus de la cible' : 'Budget proche de la cible'}
							>
								{row.tone === 'amber' ? `+${row.deltaPct} %` : 'OK'}
							</span>
						{/if}
						<button type="button" class="btn btn-secondary btn-sm" onclick={() => setBudget(row.categoryId, row.target)}>
							Appliquer
						</button>
					</li>
				{/each}
			</ul>
		{/if}

		<!-- Savings capacity panel → prefilled goal -->
		{#if showCapacity && advice.goalSuggestion}
			<div class="mt-3 pt-1 text-[13px] leading-relaxed">
				Le référentiel vise une épargne de
				<span class="tabular font-semibold" style="color: var(--accent);">{formatEUR(advice.savingsCapacity)}/mois</span>
				— un objectif {advice.goalSuggestion.name} de {formatEUR(advice.goalSuggestion.amount)} est atteignable en
				~{advice.goalSuggestion.months} mois.
				<button
					type="button"
					class="press cursor-pointer font-medium transition-colors hover:underline"
					style="color: var(--accent);"
					onclick={createSuggestedGoal}
				>
					Créer cet objectif
				</button>
			</div>
		{/if}
	</section>
{/if}
