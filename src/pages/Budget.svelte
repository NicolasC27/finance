<script lang="ts">
	import MonthWaterfall from '$lib/components/MonthWaterfall.svelte';
	import { monthsEndingAt } from '$lib/spendCharts';
	import { onMount } from 'svelte';
	import type { CategoryId } from '$lib/types';
	import { isPending } from '$lib/data';
	import { CATEGORIES, categorize } from '$lib/categories';
	import { isExpenseCategory } from '$lib/flow';
	import { monthTotals, isBudgetFlow } from '$lib/totals';
	import { budgetState } from '$lib/budget.svelte';
	import { getTransactions, getMerchantCategoryMap, txState } from '$lib/store.svelte';
	import { getBudgetTransactions } from '$lib/transfers.svelte';
	import { monthKeyOf } from '$lib/format';
	import StatCard from '$lib/components/StatCard.svelte';
	import MonthNavigator from '$lib/components/MonthNavigator.svelte';
	import CategoryBudgetCard from '$lib/components/CategoryBudgetCard.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import PageTitle from '$lib/components/PageTitle.svelte';
	import BudgetIndexation from '$lib/components/BudgetIndexation.svelte';
	import Block from '$lib/components/Block.svelte';
	import TileCanvas from '$lib/components/TileCanvas.svelte';
	import { orderedIds, setBlockElement, storeByDefault } from '$lib/layout.svelte';
	import type { BlockElement, BlockSize } from '$lib/layoutModel';
	import { LIST_COLUMNS, cardColumns } from '$lib/tileGrid';
	import { isSectionCollapsed, toggleSectionCollapse } from '$lib/ui.svelte';
	import { BUDGET_BLOCKS, categoriesToShow, sectionsToMigrate, type BudgetBlockId } from '$lib/budgetLayout';

	/** 'Intelligence' sections and the advice engine in separate chunks (gzip budget of the main bundle). */
	const goalsSection = import('$lib/components/GoalsSection.svelte');
	const vacationsSection = import('$lib/components/VacationsSection.svelte');
	const advisorCard = import('$lib/components/AdvisorCard.svelte');
	const forecastSection = import('$lib/components/ForecastSection.svelte');
	const advisorLib = import('$lib/advisor');

	/**
	 * Budget page: envelope tracking per category, per month. Every section is a tile of the page
	 * canvas (moved, resized, stored, optional elements); the former collapsible sections that were
	 * collapsed start stored, once (see budgetLayout.ts).
	 */

	const SUMMARY_ELEMENTS: BlockElement[] = [
		{ id: 'budgete', label: 'Total budgété' },
		{ id: 'depense', label: 'Total dépensé' },
		{ id: 'reste', label: 'Reste disponible' }
	];
	const GOALS_ELEMENTS: BlockElement[] = [
		{ id: 'rythme', label: 'Rythme mensuel à tenir' },
		{ id: 'anneau', label: 'Anneau de progression' },
		{ id: 'boutons', label: 'Boutons + / − rapides' }
	];
	const VACATIONS_ELEMENTS: BlockElement[] = [
		{ id: 'explication', label: 'Explication' },
		{ id: 'dates', label: 'Dates de chaque période' },
		{ id: 'operations', label: "Nombre d'opérations" },
		{ id: 'total', label: 'Total par période' }
	];
	const CATEGORIES_ELEMENTS: BlockElement[] = [
		{ id: 'indexation', label: "Indexation sur l'inflation" },
		{ id: 'detail', label: 'Dépensé et reste' },
		{ id: 'pourcentage', label: 'Pourcentage consommé' },
		{ id: 'vides', label: 'Catégories sans budget ni dépense' },
		{ id: 'tendance', label: 'Tendance sur 6 mois' }
	];
	const CASCADE_ELEMENTS: BlockElement[] = [{ id: 'montants', label: 'Montants sur les barres' }];
	const ADVICE_ELEMENTS: BlockElement[] = [
		{ id: 'base', label: 'Base de calcul' },
		{ id: 'liste', label: 'Cibles par catégorie' },
		{ id: 'capacite', label: "Capacité d'épargne" },
		{ id: 'appliquer', label: 'Bouton « Tout appliquer »' }
	];
	const FORECAST_ELEMENTS: BlockElement[] = [
		{ id: 'totaux', label: 'Totaux 30 / 60 / 90 jours' },
		{ id: 'echeances', label: 'Échéances détectées' },
		{ id: 'confiance', label: 'Colonne « Confiance »' },
		{ id: 'categories', label: 'Mois prochain par catégorie' }
	];
	const WIDE: readonly BlockSize[] = ['M', 'L', 'XL'];
	const FULL: readonly BlockSize[] = ['L', 'XL'];

	/** Budgets when the page opened: a category whose budget changed since stays on screen (« vides » hidden). */
	const budgetsAtOpen: Partial<Record<CategoryId, number>> = $state.snapshot(budgetState.budgets);
	const touched = (id: string): boolean => (budgetState.budgets[id as CategoryId] ?? 0) !== (budgetsAtOpen[id as CategoryId] ?? 0);

	/** Prévisions exist as soon as one booked budget operation exists (same rule as ForecastSection). */
	const hasForecast = $derived(getBudgetTransactions().some((tx) => !isPending(tx)));

	/**
	 * One-time hand-over: a former section that was collapsed (stored choice, or Conseils and
	 * Prévisions collapsed by default) starts as a stored block; the section is then marked expanded
	 * so the next visit leaves the block to the user. Conseils and Prévisions only move once they
	 * exist (advice needs enough history), so nothing is stored for an absent block.
	 */
	async function migrateSections(): Promise<void> {
		const { buildAdvice } = await advisorLib;
		const hasAdvice = buildAdvice(getBudgetTransactions(), budgetState.overrides, budgetState.budgets, getMerchantCategoryMap()) !== null;
		const present = (block: BudgetBlockId): boolean => (block === 'conseils' ? hasAdvice : block === 'previsions' ? hasForecast : true);
		for (const { section, block } of sectionsToMigrate(isSectionCollapsed, present)) {
			storeByDefault('budget', block);
			toggleSectionCollapse(section);
		}
	}

	onMount(() => {
		void migrateSections();
	});

	/**
	 * Months present in the budget flows (navigator bounds; no more hidden Kraken months since 2018).
	 */
	const months = $derived.by(() => {
		const flows = getBudgetTransactions().filter(isBudgetFlow);
		const src = flows.length > 0 ? flows : getTransactions().filter((tx) => !isPending(tx));
		return [...new Set(src.map((tx) => monthKeyOf(tx.booking_date)))].sort();
	});

	// Envelopes: SPENDING categories (neither income nor savings & transfers)
	const expenseCategories = CATEGORIES.filter((c) => isExpenseCategory(c.id));

	// Initialises the selected month to the latest available month
	$effect(() => {
		if (months.length > 0 && !months.includes(budgetState.selectedMonth)) {
			budgetState.selectedMonth = months[months.length - 1]!;
		}
	});

	/**
	 * Net spending per category in the selected month, same computation as the Dashboard, the Rapport
	 * and the insights (totals.ts): internal transfers, wealth and savings excluded, refunds deducted.
	 */
	const spentByCategory = $derived(
		monthTotals(getBudgetTransactions(), budgetState.selectedMonth, (tx): CategoryId => categorize(tx, budgetState.overrides, undefined, getMerchantCategoryMap())).byCategory
	);

	/** Spending per category over the 6 months ending with the selected one (envelope sparklines). */
	const trendByCategory = $derived.by(() => {
		const mm = getMerchantCategoryMap();
		const txs = getBudgetTransactions();
		const catOf = (tx: Parameters<typeof categorize>[0]): CategoryId => categorize(tx, budgetState.overrides, undefined, mm);
		const per = monthsEndingAt(budgetState.selectedMonth || new Date().toISOString().slice(0, 7), 6).map((m) => monthTotals(txs, m, catOf).byCategory);
		return new Map(expenseCategories.map((c) => [c.id, per.map((b) => Math.max(0, b.get(c.id) ?? 0))]));
	});

	const totalBudgeted = $derived(expenseCategories.reduce((sum, c) => sum + (budgetState.budgets[c.id] ?? 0), 0));
	const totalSpent = $derived(expenseCategories.reduce((sum, c) => sum + (spentByCategory.get(c.id) ?? 0), 0));
	const remaining = $derived(totalBudgeted - totalSpent);
</script>

{#if txState.loadError}
	<div class="card p-6 text-sm" style="color: var(--amber);">
		{txState.loadError} — vérifiez que <code>/data/transactions.json</code> est accessible.
	</div>
{:else if !txState.loaded}
	<!-- First load: shimmer skeletons -->
	<header class="mb-8">
		<Skeleton h={28} w={140} class="mb-2" />
		<Skeleton h={14} w={240} />
	</header>
	<section class="grid gap-4 sm:grid-cols-3">
		{#each [0, 1, 2] as i (i)}
			<Skeleton h={108} rounded={8} />
		{/each}
	</section>
	<section class="mt-6 grid gap-4 md:grid-cols-2">
		{#each [0, 1, 2, 3] as i (i)}
			<Skeleton h={150} rounded={8} />
		{/each}
	</section>
{:else}
	<header class="mb-4 flex flex-wrap items-center justify-between gap-4">
		<PageTitle title="Budget" kicker="les enveloppes du mois" />
		<div class="flex flex-wrap items-center gap-2">
			<MonthNavigator {months} />
		</div>
	</header>

	<!-- Customisable blocks on a 12-column grid (one column on small screens) -->
	<TileCanvas page="budget" defaults={BUDGET_BLOCKS}>
		{#each orderedIds('budget', BUDGET_BLOCKS) as id (id)}
			{#if id === 'resume'}
				<Block page="budget" {id} defaults={BUDGET_BLOCKS} title="Résumé du mois" size="XL" sizes={FULL} elements={SUMMARY_ELEMENTS} bare>
					{#snippet children(show, _size, box)}
						{@const count = ['budgete', 'depense', 'reste'].filter((k) => show(k)).length}
						{#if count === 0}
							<p class="meta-xs">Aucun total affiché : clic droit sur le bloc › Éléments affichés.</p>
						{:else}
							<!-- Cards per row follow the tile width; with a set tile height they stretch to fill it -->
							<div class="@container">
								<section class="hero-in-1 grid gap-3 {cardColumns(count)}" style={box ? `min-height: ${box.h}px; grid-auto-rows: 1fr;` : ''}>
									{#if show('budgete')}<StatCard label="Total budgété" value={totalBudgeted} hint="toutes catégories" stagger={0} />{/if}
									{#if show('depense')}<StatCard label="Total dépensé" value={totalSpent} hint="mois sélectionné" stagger={70} />{/if}
									{#if show('reste')}
										<StatCard
											label="Reste disponible"
											value={remaining}
											hint={remaining >= 0 ? 'dans les enveloppes' : 'dépassement global'}
											stagger={140}
										/>
									{/if}
								</section>
							</div>
						{/if}
					{/snippet}
				</Block>
			{:else if id === 'cascade'}
				<Block page="budget" {id} defaults={BUDGET_BLOCKS} title="Le mois en cascade" size="XL" sizes={WIDE} elements={CASCADE_ELEMENTS}>
					{#snippet children(show, _size, box)}
						<h2 class="label-xs mb-2">Le mois en cascade</h2>
						<MonthWaterfall month={budgetState.selectedMonth} showAmounts={show('montants')} height={box ? Math.max(160, Math.min(420, box.h - 36)) : 220} />
					{/snippet}
				</Block>
			{:else if id === 'objectifs'}
				<!-- Savings goals (under the summary, before the categories) -->
				<Block page="budget" {id} defaults={BUDGET_BLOCKS} title="Objectifs d'épargne" size="XL" sizes={WIDE} elements={GOALS_ELEMENTS} bare>
					{#snippet children(show)}
						<div class="@container">
							{#await goalsSection then { default: GoalsSection }}
								<GoalsSection showPace={show('rythme')} showRing={show('anneau')} showAdjust={show('boutons')} columns={LIST_COLUMNS} />
							{/await}
						</div>
					{/snippet}
				</Block>
			{:else if id === 'vacances'}
				<!-- Holiday periods: reclassification of variable spending -->
				<Block page="budget" {id} defaults={BUDGET_BLOCKS} title="Périodes de vacances" size="XL" sizes={WIDE} elements={VACATIONS_ELEMENTS} bare>
					{#snippet children(show, _size, box)}
						{#await vacationsSection then { default: VacationsSection }}
							<VacationsSection showExplanation={show('explication')} showDates={show('dates')} showCount={show('operations')} showTotal={show('total')} fill={box?.h ?? null} />
						{/await}
					{/snippet}
				</Block>
			{:else if id === 'categories'}
				<!-- Envelope per category -->
				<Block page="budget" {id} defaults={BUDGET_BLOCKS} title="Budgets par catégorie" size="XL" sizes={FULL} elements={CATEGORIES_ELEMENTS} bare class="hero-in-2">
					{#snippet children(show)}
						{@const shown = categoriesToShow(expenseCategories, (c) => budgetState.budgets[c as CategoryId] ?? 0, (c) => spentByCategory.get(c as CategoryId) ?? 0, show('vides'), touched)}
						{@const masked = expenseCategories.length - shown.length}
						<section class="@container pt-3">
							<h2 class="label-xs mb-3">Budgets par catégorie</h2>
							{#if show('indexation')}<BudgetIndexation />{/if}
							{#if shown.length > 0}
								<div class="grid gap-3 {LIST_COLUMNS}">
									{#each shown as cat, i (cat.id)}
										<CategoryBudgetCard categoryId={cat.id} spent={spentByCategory.get(cat.id) ?? 0} index={i} showDetail={show('detail')} showPercent={show('pourcentage')} trend={show('tendance') ? (trendByCategory.get(cat.id) ?? []) : []} />
									{/each}
								</div>
							{/if}
							{#if masked > 0}
								<p class="meta-xs mt-2">
									{masked} catégorie{masked > 1 ? 's' : ''} sans budget ni dépense masquée{masked > 1 ? 's' : ''} ·
									<button type="button" class="cursor-pointer underline-offset-2 hover:text-[var(--accent)] hover:underline" onclick={() => setBlockElement('budget', 'categories', 'vides', true)}>Afficher</button>
								</p>
							{/if}
						</section>
					{/snippet}
				</Block>
			{:else if id === 'conseils'}
				<!-- Envelope advice (recalibrated 50/30/20): only once there is advice, like before the blocks -->
				{#await advisorLib then { buildAdvice }}
					{@const advice = buildAdvice(getBudgetTransactions(), budgetState.overrides, budgetState.budgets, getMerchantCategoryMap())}
					{#if advice}
						<Block page="budget" {id} defaults={BUDGET_BLOCKS} title="Conseils" size="XL" sizes={WIDE} elements={ADVICE_ELEMENTS} bare>
							{#snippet children(show, _size, box)}
								<!-- The card stretches to the bottom of a tile whose height is set -->
								<div class="@container *:min-h-[var(--tile-fill)]" style={box ? `--tile-fill: ${box.h}px;` : ''}>
									{#await advisorCard then { default: AdvisorCard }}
										<AdvisorCard {advice} showBasis={show('base')} showList={show('liste')} showCapacity={show('capacite')} showApplyAll={show('appliquer')} />
									{/await}
								</div>
							{/snippet}
						</Block>
					{/if}
				{/await}
			{:else if id === 'previsions'}
				<!-- Upcoming payments and forecasts: only once there are booked operations -->
				{#if hasForecast}
					<Block page="budget" {id} defaults={BUDGET_BLOCKS} title="Prévisions de dépenses" size="XL" sizes={WIDE} elements={FORECAST_ELEMENTS} bare>
						{#snippet children(show, _size, box)}
							<div class="*:min-h-[var(--tile-fill)]" style={box ? `--tile-fill: ${box.h}px;` : ''}>
								{#await forecastSection then { default: ForecastSection }}
									<ForecastSection showTotals={show('totaux')} showPayments={show('echeances')} showConfidence={show('confiance')} showCategories={show('categories')} />
								{/await}
							</div>
						{/snippet}
					</Block>
				{/if}
			{/if}
		{/each}
	</TileCanvas>
{/if}

<style>
</style>
