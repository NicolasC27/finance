<script lang="ts">
	import SpendingCalendar from '$lib/components/SpendingCalendar.svelte';
	import { segmented } from '$lib/actions/segmented';
	import type { CategoryId, Transaction } from '$lib/types';
	import { CATEGORIES, categorize, getCategory, isWealthMovement } from '$lib/categories';
	import { SUBCATEGORIES, subcategorize } from '$lib/subcategories';
	import { budgetState } from '$lib/budget.svelte';
	import { getTransactions, getMerchantCategoryMap } from '$lib/store.svelte';
	import { getBudgetTransactions } from '$lib/transfers.svelte';
	import { monthlyAnalytics, movingAverage, pctChange } from '$lib/analytics';
	import { isExpenseCategory } from '$lib/flow';
	import { monthCutoffDay, lastFlowDate } from '$lib/totals';
	import { todayIso } from '$lib/forecast';
	import { formatEUR, formatMonth, formatPct } from '$lib/format';
	import { uiState } from '$lib/ui.svelte';
	import { merchantKey, merchantLabel } from '$lib/merchant';
	import { isPending, spendAmount } from '$lib/data';
	import { monthKeyOf, formatDate } from '$lib/format';
	import { navigate } from '$lib/router.svelte';
	import PageTitle from '$lib/components/PageTitle.svelte';
	import ModuleOptionsButton from '$lib/components/ModuleOptionsButton.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import MultiLineChart, { type LineSeries } from '$lib/components/MultiLineChart.svelte';
	import MonthBars from '$lib/components/MonthBars.svelte';
	import Block from '$lib/components/Block.svelte';
	import TileCanvas from '$lib/components/TileCanvas.svelte';
	import SubscriptionsCard from '$lib/components/SubscriptionsCard.svelte';
	import InflationCard from '$lib/components/InflationCard.svelte';
	import { blockPrefs, orderedIds, isFullscreen } from '$lib/layout.svelte';
	import { isElementShown, type BlockElement, type BlockSize } from '$lib/layoutModel';
	import { chartHeight, figureColumns } from '$lib/tileGrid';

	const BLOCKS = ['savings', 'calendar', 'curves', 'inflation', 'merchants', 'subscriptions'] as const;

	/** Optional elements of each Analyse block (the user can hide them; every block is full width by default). */
	const SAVINGS_ELEMENTS: BlockElement[] = [
		{ id: 'explication', label: 'Explication sous le titre' },
		{ id: 'chiffres', label: 'Moyenne, taux et cumul' },
		{ id: 'kraken', label: 'Épargne investie (Kraken)' },
		{ id: 'extremes', label: 'Meilleur et pire mois' }
	];
	const CURVES_ELEMENTS: BlockElement[] = [
		{ id: 'series', label: 'Choix des séries' },
		{ id: 'affiner', label: 'Sous-catégories (Affiner)' },
		{ id: 'moyenne', label: 'Ligne de moyenne' },
		{ id: 'aide', label: 'Aide sous le graphique' },
		{ id: 'tableau', label: 'Tableau mois par mois' }
	];
	const INFLATION_ELEMENTS: BlockElement[] = [
		{ id: 'resume', label: 'Résumé depuis 2020' },
		{ id: 'annees', label: 'Tableau par année' },
		{ id: 'postes', label: 'Ton inflation par poste' },
		{ id: 'notes', label: 'Notes et sources' }
	];
	const MERCHANTS_ELEMENTS: BlockElement[] = [
		{ id: 'filtre', label: 'Champ de filtre' },
		{ id: 'categorie', label: 'Colonne « Catégorie »' },
		{ id: 'moyenne', label: 'Colonne « Moy. »' },
		{ id: 'tendance', label: 'Colonne « Tendance »' },
		{ id: 'dernier', label: 'Colonne « Dernier »' }
	];
	const CALENDAR_ELEMENTS: BlockElement[] = [
		{ id: 'resume', label: 'Résumé (total, jour le plus dépensier)' },
		{ id: 'legende', label: 'Légende' }
	];
	const SUBSCRIPTIONS_ELEMENTS: BlockElement[] = [
		{ id: 'resume', label: 'Résumé (total, alertes)' },
		{ id: 'cadence', label: 'Colonne « Cadence »' },
		{ id: 'annee', label: 'Colonne « Sur 1 an »' },
		{ id: 'alertes', label: 'Colonne « Alerte »' },
		{ id: 'autres', label: 'Dépenses régulières et terminées' }
	];
	const WIDE: readonly BlockSize[] = ['M', 'L', 'XL'];

	/** Heights of what sits above and below the two charts: with a set tile height, each chart takes what is left. */
	let savingsTop = $state(0);
	let savingsBottom = $state(0);
	let curvesTop = $state(0);
	let curvesBottom = $state(0);

	/**
	 * Analyse page: savings per month (income − spending, invested savings separately) and monthly
	 * curves per category / subcategory, over 6, 12, 24 months or the whole history. Click on a month
	 * = filtered Transactions.
	 */

	const UI_KEY = 'budget:analyse-ui';
	type Period = 6 | 12 | 24 | 0;
	interface Ui {
		period: Period;
		series: string[];
		smooth: boolean;
	}
	function loadUi(): Ui {
		try {
			const raw = localStorage.getItem(UI_KEY);
			if (raw) {
				const p = JSON.parse(raw) as Partial<Ui>;
				return { period: ([6, 12, 24, 0] as Period[]).includes(p.period as Period) ? (p.period as Period) : 12, series: Array.isArray(p.series) ? p.series : ['expenses', 'alimentation'], smooth: !!p.smooth };
			}
		} catch {
		}
		return { period: 12, series: ['expenses', 'alimentation'], smooth: false };
	}
	const initial = loadUi();
	let period = $state<Period>(initial.period);
	let selected = $state<string[]>(initial.series);
	let smooth = $state(initial.smooth);
	$effect(() => {
		try {
			localStorage.setItem(UI_KEY, JSON.stringify({ period, series: selected, smooth }));
		} catch {
		}
	});

	const catOf = (tx: Transaction): CategoryId => categorize(tx, budgetState.overrides, undefined, getMerchantCategoryMap());
	const subOf = (tx: Transaction) => subcategorize(tx, budgetState.overrides, undefined, getMerchantCategoryMap());

	const data = $derived(monthlyAnalytics(getBudgetTransactions(), getTransactions(), catOf, subOf, period || undefined));
	const hasData = $derived(data.months.length >= 2);

	// ---- Savings ----
	/**
	 * Current (incomplete) month: shown, but excluded from averages, the running total and the
	 * best/worst month. On the 3rd, before the salary arrived, it dragged the average savings down and
	 * became 'the worst month'.
	 */
	const partialIdx = $derived.by(() => {
		const last = data.months[data.months.length - 1];
		if (!last) return -1;
		return monthCutoffDay(last, lastFlowDate(getBudgetTransactions()), todayIso()) !== null ? data.months.length - 1 : -1;
	});
	/** Months kept for statistics: complete and not empty (a partial import leaves empty months). */
	const statIdx = $derived(data.months.map((_, i) => i).filter((i) => i !== partialIdx && (data.income[i] !== 0 || data.expenses[i] !== 0)));
	const savingsStats = $derived.by(() => {
		let total = 0;
		let best: { index: number; value: number } | null = null;
		let worst: { index: number; value: number } | null = null;
		for (const i of statIdx) {
			const v = data.savings[i]!;
			total += v;
			if (!best || v > best.value) best = { index: i, value: v };
			if (!worst || v < worst.value) worst = { index: i, value: v };
		}
		return { total: Math.round(total * 100) / 100, best, worst };
	});
	const investedTotal = $derived(data.invested.reduce((a, b) => a + b, 0));
	const incomeTotal = $derived(statIdx.reduce((a, i) => a + data.income[i]!, 0));
	const avgRate = $derived(incomeTotal > 0 ? Math.round((savingsStats.total / incomeTotal) * 1000) / 10 : null);
	const activeMonths = $derived(statIdx.length);
	const avgSavings = $derived(activeMonths > 0 ? Math.round((savingsStats.total / activeMonths) * 100) / 100 : 0);
	/** Average of a series over the kept months ('Moy.' column), same base as the KPIs above. */
	function meanOf(values: number[]): number {
		return statIdx.length > 0 ? Math.round((statIdx.reduce((a, i) => a + (values[i] ?? 0), 0) / statIdx.length) * 100) / 100 : 0;
	}

	// ---- Curves ----
	const SPECIAL: { id: string; label: string; color: string }[] = [
		{ id: 'expenses', label: 'Dépenses', color: 'var(--text-secondary)' },
		{ id: 'income', label: 'Revenus', color: 'var(--accent)' },
		{ id: 'savings', label: 'Épargne', color: '#5d94da' }
	];
	const categoriesWithData = $derived(CATEGORIES.filter((c) => isExpenseCategory(c.id) && (data.byCategory[c.id] ?? []).some((v) => v !== 0)));
	/** Subcategories of the selected categories that have data. */
	const subsAvailable = $derived(
		SUBCATEGORIES.filter((s) => selected.includes(s.categoryId) && (data.bySub[s.id] ?? []).some((v) => v !== 0)).map((s) => ({ ...s, color: getCategory(s.categoryId).color }))
	);

	function valuesOf(id: string): number[] | null {
		if (id === 'expenses') return data.expenses;
		if (id === 'income') return data.income;
		if (id === 'savings') return data.savings;
		if (id in data.byCategory) return data.byCategory[id as CategoryId]!;
		if (id in data.bySub) return data.bySub[id]!;
		return null;
	}
	function labelOf(id: string): string {
		return SPECIAL.find((s) => s.id === id)?.label ?? SUBCATEGORIES.find((s) => s.id === id)?.label ?? getCategory(id as CategoryId).label;
	}
	function colorOf(id: string): string {
		const sp = SPECIAL.find((s) => s.id === id);
		if (sp) return sp.color;
		const sub = SUBCATEGORIES.find((s) => s.id === id);
		if (sub) return mix(getCategory(sub.categoryId).color);
		return getCategory(id as CategoryId).color;
	}
	/** Lighter variant of a category colour (subcategory). */
	function mix(hex: string): string {
		return `color-mix(in oklch, ${hex} 70%, white)`;
	}

	const series = $derived.by((): LineSeries[] => {
		const out: LineSeries[] = [];
		for (const id of selected) {
			const values = valuesOf(id);
			if (!values) continue;
			out.push({ id, label: labelOf(id), color: colorOf(id), values });
			if (smooth) out.push({ id: `${id}:ma`, label: `${labelOf(id)} (moy. 3 mois)`, color: colorOf(id), values: movingAverage(values, 3), dashed: true });
		}
		return out;
	});

	function toggle(id: string) {
		selected = selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id];
	}

	// ---- Navigation to Transactions ----
	function monthBounds(key: string): { from: string; to: string } {
		const [y, m] = key.split('-').map(Number) as [number, number];
		const last = new Date(y, m, 0).getDate();
		return { from: `${key}-01`, to: `${key}-${String(last).padStart(2, '0')}` };
	}
	function openMonth(i: number, id?: string) {
		const b = monthBounds(data.months[i]!);
		const filter: NonNullable<typeof uiState.txFilter> = { ...b };
		if (id && id !== 'expenses' && id !== 'savings') {
			if (id === 'income') filter.categoryId = 'revenus';
			else if (id in data.byCategory) filter.categoryId = id as CategoryId;
			else {
				const sub = SUBCATEGORIES.find((s) => s.id === id);
				if (sub) {
					filter.categoryId = sub.categoryId;
					filter.subId = sub.id;
				}
			}
		}
		uiState.txFilter = filter;
		navigate('/transactions');
	}
	/** Click on the chart: the first selected series gives the category filter. */
	function pickFromChart(i: number) {
		openMonth(i, selected[0]);
	}

	// ---- By merchant ----
	interface MerchantRow {
		key: string;
		label: string;
		count: number;
		total: number;
		avg: number;
		last: string;
		category: CategoryId;
		/** Change (%) between the first and second half of the period, null without a base. */
		trend: number | null;
	}
	let merchantQuery = $state('');
	/** The filter only applies while its field is shown: hiding the field never leaves a hidden filter on. */
	const merchantFilterShown = $derived(isElementShown(blockPrefs('analyse', 'merchants'), 'filtre', MERCHANTS_ELEMENTS));
	const merchants = $derived.by((): MerchantRow[] => {
		if (data.months.length === 0) return [];
		const first = data.months[0]!;
		const half = data.months[Math.floor(data.months.length / 2)]!;
		const acc = new Map<string, { label: string; count: number; total: number; last: string; cats: Map<CategoryId, number>; a: number; b: number }>();
		for (const tx of getBudgetTransactions()) {
			if (isPending(tx) || isWealthMovement(tx)) continue;
			const mk = monthKeyOf(tx.booking_date);
			if (mk < first || mk > data.months[data.months.length - 1]!) continue;
			const cat = catOf(tx);
			const sp = spendAmount(tx, cat);
			if (sp === null || sp === 0) continue;
			const key = merchantKey(tx.remittance_information);
			if (!key) continue;
			const e = acc.get(key) ?? { label: merchantLabel(tx.remittance_information), count: 0, total: 0, last: '', cats: new Map(), a: 0, b: 0 };
			e.count++;
			e.total += sp;
			if (tx.booking_date > e.last) e.last = tx.booking_date;
			e.cats.set(cat, (e.cats.get(cat) ?? 0) + sp);
			if (mk < half) e.a += sp;
			else e.b += sp;
			acc.set(key, e);
		}
		const q = merchantFilterShown ? merchantQuery.trim().toLowerCase() : '';
		return [...acc.entries()]
			.map(([key, e]) => {
				const category = [...e.cats.entries()].sort((x, y) => y[1] - x[1])[0]![0];
				return { key, label: e.label, count: e.count, total: Math.round(e.total * 100) / 100, avg: Math.round((e.total / e.count) * 100) / 100, last: e.last, category, trend: data.months.length >= 2 && e.a > 0 ? Math.round(((e.b - e.a) / e.a) * 100) : null };
			})
			.filter((r) => !q || r.label.toLowerCase().includes(q))
			.sort((x, y) => y.total - x.total);
	});
	const merchantsTotal = $derived(merchants.reduce((a, r) => a + r.total, 0));
	// 10 rows by default (density: the page was 2.25 screens tall); 'Voir plus' extends
	let merchantsShown = $state(10);
	function openMerchant(r: MerchantRow) {
		uiState.txSearch = r.label;
		navigate('/transactions');
	}

	const deltaColor = (d: number | null, invert: boolean) => (d === null || Math.abs(d) < 0.05 ? 'var(--text-secondary)' : (d > 0) !== invert ? 'var(--amber)' : 'var(--accent)');
</script>

<header class="mb-4 flex flex-wrap items-end justify-between gap-3">
	<PageTitle title="Analyse" />
	<div class="flex flex-wrap items-center gap-2">
		<div class="flex items-center gap-1" role="group" aria-label="Période" use:segmented>
			{#each [[6, '6 mois'], [12, '12 mois'], [24, '24 mois'], [0, 'Tout']] as [p, label] (p)}
				<button type="button" class="chip cursor-pointer {period === p ? 'chip-accent' : 'chip-muted'}" aria-pressed={period === p} onclick={() => (period = p as Period)}>{label}</button>
			{/each}
		</div>
		<ModuleOptionsButton module="analyse" />
	</div>
</header>

{#if !hasData}
	<section class="card p-4">
		<EmptyState inline icon="import" title="Pas assez d'historique" text="Il faut au moins deux mois d'opérations. Importez un export Crédit Mutuel plus long depuis Transactions." />
	</section>
{:else}
	<!-- Customisable blocks on a 12-column grid (one column on small screens) -->
	<TileCanvas page="analyse" defaults={BLOCKS}>
		{#each orderedIds('analyse', BLOCKS) as id (id)}
			{#if id === 'savings'}
				<Block page="analyse" {id} defaults={BLOCKS} title="Épargne par mois" size="XL" sizes={WIDE} elements={SAVINGS_ELEMENTS} class="hero-in-1">
					{#snippet children(show, _size, box)}
						{@const figures = (show('chiffres') ? 3 : 0) + (show('kraken') ? 1 : 0)}
						<div class="flow-root" bind:clientHeight={savingsTop}>
							<div class="mb-3 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
								<h2 class="label-xs">Épargne par mois</h2>
								{#if show('explication')}
									<p class="meta-xs">revenus − dépenses du mois, virements internes exclus{show('kraken') ? ' · barre fine : virements vers Kraken (épargne investie, hors dépenses)' : ''}</p>
								{/if}
							</div>
							{#if figures > 0}
								<!-- Figures per row follow the tile width -->
								<div class="@container mb-3">
									<div class="grid grid-cols-1 gap-3 {figureColumns(figures)}">
										{#if show('chiffres')}
											<div>
												<p class="meta-xs">Épargne moyenne / mois</p>
												<p class="stat-amount tabular" style="color: {avgSavings >= 0 ? 'var(--accent)' : 'var(--amber)'};">{avgSavings >= 0 ? '+' : '−'}{formatEUR(Math.abs(avgSavings))}</p>
											</div>
											<div>
												<p class="meta-xs">Taux d'épargne moyen</p>
												<p class="stat-amount tabular">{avgRate === null ? '—' : formatPct(avgRate, 1)}</p>
											</div>
											<div>
												<p class="meta-xs">Cumul sur {activeMonths} mois</p>
												<p class="stat-amount tabular" style="color: {savingsStats.total >= 0 ? 'var(--accent)' : 'var(--amber)'};">{savingsStats.total >= 0 ? '+' : '−'}{formatEUR(Math.abs(savingsStats.total))}</p>
											</div>
										{/if}
										{#if show('kraken')}
											<div>
												<p class="meta-xs">Investi sur Kraken</p>
												<p class="stat-amount tabular">{formatEUR(investedTotal)}</p>
											</div>
										{/if}
									</div>
								</div>
							{/if}
						</div>
						<MonthBars months={data.months} values={data.savings} secondary={show('kraken') ? data.invested : []} secondaryLabel="vers Kraken" height={isFullscreen('analyse', 'savings') ? 420 : chartHeight(box, savingsTop, savingsBottom, 170)} onPick={(i) => openMonth(i)} />
						<div class="flow-root" bind:clientHeight={savingsBottom}>
							{#if show('extremes') && savingsStats.best && savingsStats.worst && data.months.length > 1}
								<p class="meta-xs mt-2">
									Meilleur mois : <span class="capitalize">{formatMonth(data.months[savingsStats.best.index]!)}</span> ({savingsStats.best.value >= 0 ? '+' : '−'}{formatEUR(Math.abs(savingsStats.best.value))}) ·
									pire : <span class="capitalize">{formatMonth(data.months[savingsStats.worst.index]!)}</span> ({savingsStats.worst.value >= 0 ? '+' : '−'}{formatEUR(Math.abs(savingsStats.worst.value))})
								</p>
							{/if}
						</div>
					{/snippet}
				</Block>
			{:else if id === 'merchants'}
				<Block page="analyse" {id} defaults={BLOCKS} title="Par commerçant" size="XL" sizes={WIDE} elements={MERCHANTS_ELEMENTS} class="hero-in-3">
					{#snippet children(show)}
						<div class="mb-3 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
							<h2 class="label-xs">Par commerçant</h2>
							<div class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
								<p class="meta-xs">{merchants.length} commerçants · {formatEUR(merchantsTotal)} sur la période</p>
								{#if show('filtre')}
									<input type="search" class="input-surface w-44 max-w-full" placeholder="Filtrer…" bind:value={merchantQuery} aria-label="Filtrer les commerçants" />
								{/if}
							</div>
						</div>
						{#if merchants.length === 0}
							<p class="meta-xs">Aucune dépense sur la période.</p>
						{:else}
							<!-- Local horizontal scroll on mobile (the page scrolled by 75 px) -->
							<div class="overflow-x-auto">
								<table class="w-full min-w-[460px] text-xs">
									<thead>
										<tr class="text-left" style="color: var(--text-secondary);">
											<th class="py-1 pr-3 font-medium">Commerçant</th>
											{#if show('categorie')}<th class="py-1 pr-3 font-medium">Catégorie</th>{/if}
											<th class="tabular py-1 pr-3 text-right font-medium">Achats</th>
											<th class="tabular py-1 pr-3 text-right font-medium">Total</th>
											{#if show('moyenne')}<th class="tabular py-1 pr-3 text-right font-medium">Moy.</th>{/if}
											{#if show('tendance')}<th class="tabular py-1 pr-3 text-right font-medium" title="2de moitié de la période vs 1re moitié">Tendance</th>{/if}
											{#if show('dernier')}<th class="tabular py-1 text-right font-medium">Dernier</th>{/if}
										</tr>
									</thead>
									<tbody class="rows">
										{#each merchants.slice(0, merchantsShown) as r (r.key)}
											<tr class="row row-hover border-t" style="border-color: var(--border-subtle);">
												<td class="py-1.5 pr-3">
													<button type="button" class="cursor-pointer text-left font-medium hover:underline" title="Voir les opérations" onclick={() => openMerchant(r)}>{r.label}</button>
												</td>
												{#if show('categorie')}
													<td class="py-1.5 pr-3 whitespace-nowrap text-secondary"><span class="mr-1.5 inline-block h-2 w-2 rounded-full align-middle" style="background-color: {getCategory(r.category).color};"></span>{getCategory(r.category).label}</td>
												{/if}
												<td class="tabular py-1.5 pr-3 text-right">{r.count}</td>
												<td class="tabular py-1.5 pr-3 text-right font-medium">{formatEUR(r.total)}</td>
												{#if show('moyenne')}<td class="tabular py-1.5 pr-3 text-right text-secondary">{formatEUR(r.avg)}</td>{/if}
												{#if show('tendance')}
													<td class="tabular py-1.5 pr-3 text-right" style="color: {r.trend === null ? 'var(--text-secondary)' : r.trend > 10 ? 'var(--amber)' : r.trend < -10 ? 'var(--accent)' : 'var(--text-secondary)'};">{r.trend === null ? '—' : `${r.trend > 0 ? '+' : ''}${r.trend} %`}</td>
												{/if}
												{#if show('dernier')}<td class="tabular py-1.5 text-right whitespace-nowrap text-secondary">{formatDate(r.last)}</td>{/if}
											</tr>
										{/each}
									</tbody>
								</table>
							</div>
							{#if merchants.length > merchantsShown}
								<button type="button" class="btn btn-secondary btn-sm mt-2" onclick={() => (merchantsShown += 25)}>Voir plus ({merchants.length - merchantsShown} restants)</button>
							{/if}
						{/if}
					{/snippet}
				</Block>
			{:else if id === 'calendar'}
				<Block page="analyse" {id} defaults={BLOCKS} title="Calendrier des dépenses" size="XL" sizes={WIDE} elements={CALENDAR_ELEMENTS}>
					{#snippet children(show)}
						<h2 class="label-xs mb-2">Calendrier des dépenses</h2>
						<SpendingCalendar showSummary={show('resume')} showLegend={show('legende')} />
					{/snippet}
				</Block>
			{:else if id === 'subscriptions'}
				<Block page="analyse" {id} defaults={BLOCKS} title="Abonnements & prélèvements" size="XL" sizes={WIDE} elements={SUBSCRIPTIONS_ELEMENTS} class="hero-in-3">
					{#snippet children(show)}
						<SubscriptionsCard showSummary={show('resume')} showCadence={show('cadence')} showYear={show('annee')} showAlerts={show('alertes')} showOtherList={show('autres')} />
					{/snippet}
				</Block>
			{:else if id === 'inflation'}
				<Block page="analyse" {id} defaults={BLOCKS} title="Inflation et pouvoir d'achat" size="XL" sizes={WIDE} elements={INFLATION_ELEMENTS} class="hero-in-3">
					{#snippet children(show)}
						<div class="@container">
							<InflationCard showSummary={show('resume')} showYears={show('annees')} showItems={show('postes')} showNotes={show('notes')} />
						</div>
					{/snippet}
				</Block>
			{:else if id === 'curves'}
				<Block page="analyse" {id} defaults={BLOCKS} title="Courbes mensuelles" size="XL" sizes={WIDE} elements={CURVES_ELEMENTS} class="hero-in-2">
					{#snippet children(show, _size, box)}
						<div class="flow-root" bind:clientHeight={curvesTop}>
							<div class="mb-3 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
								<h2 class="label-xs">Courbes mensuelles</h2>
								<label class="meta-xs flex cursor-pointer items-center gap-1.5">
									<input type="checkbox" bind:checked={smooth} />
									moyenne mobile 3 mois
								</label>
							</div>
							{#if show('series')}
								<div class="mb-2 flex flex-wrap gap-1.5" role="group" aria-label="Séries">
									{#each SPECIAL as s (s.id)}
										<button type="button" class="chip cursor-pointer {selected.includes(s.id) ? 'chip-accent' : 'chip-muted'}" aria-pressed={selected.includes(s.id)} onclick={() => toggle(s.id)}>{s.label}</button>
									{/each}
									<span class="mx-1 self-center opacity-30">|</span>
									{#each categoriesWithData as c (c.id)}
										<button type="button" class="chip cursor-pointer {selected.includes(c.id) ? 'chip-accent' : 'chip-muted'}" aria-pressed={selected.includes(c.id)} onclick={() => toggle(c.id)}>
											<span class="mr-1 inline-block h-2 w-2 rounded-full align-middle" style="background-color: {c.color};"></span>{c.label}
										</button>
									{/each}
								</div>
							{/if}
							{#if show('affiner') && subsAvailable.length > 0}
								<div class="mb-3 flex flex-wrap items-center gap-1.5" role="group" aria-label="Sous-catégories">
									<span class="meta-xs mr-1">Affiner :</span>
									{#each subsAvailable as s (s.id)}
										<button type="button" class="chip cursor-pointer {selected.includes(s.id) ? 'chip-accent' : 'chip-outline'}" aria-pressed={selected.includes(s.id)} onclick={() => toggle(s.id)}>
											<span class="mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle" style="background-color: {s.color};"></span>{s.label}
										</button>
									{/each}
								</div>
							{/if}
						</div>
						<MultiLineChart months={data.months} {series} height={isFullscreen('analyse', 'curves') ? 480 : chartHeight(box, curvesTop, curvesBottom, 240, 140)} showMean={show('moyenne') && !smooth} onPick={pickFromChart} />
						<div class="flow-root" bind:clientHeight={curvesBottom}>
							{#if show('aide')}
								<p class="meta-xs mt-1">{show('moyenne') && !smooth ? 'pointillés : moyenne de la période · ' : ''}clic sur un mois : opérations de « {selected[0] ? labelOf(selected[0]) : 'la période'} »</p>
							{/if}

							{#if show('tableau') && series.length > 0}
								<div class="mt-3 overflow-x-auto">
									<table class="w-full text-xs">
										<thead>
											<tr class="text-left" style="color: var(--text-secondary);">
												<th class="sticky left-0 py-1 pr-3 font-medium" style="background-color: var(--surface);">Série</th>
												{#each data.months as m (m)}
													<th class="tabular py-1 pr-3 text-right font-medium whitespace-nowrap capitalize" title={m === data.months[partialIdx] ? 'Mois en cours : exclu de la moyenne' : undefined}>{formatMonth(m).replace(/^(\w+)\.? (\d{4})$/, '$1 $2')}{m === data.months[partialIdx] ? ' *' : ''}</th>
												{/each}
												<th class="tabular py-1 text-right font-medium">Moy.</th>
											</tr>
										</thead>
										<tbody>
											{#each series.filter((s) => !s.dashed) as s (s.id)}
												{@const invert = s.id === 'income' || s.id === 'savings'}
												<tr class="border-t" style="border-color: var(--border-subtle);">
													<td class="sticky left-0 py-1.5 pr-3 font-medium whitespace-nowrap" style="background-color: var(--surface);">
														<span class="mr-1.5 inline-block h-2 w-2 rounded-full align-middle" style="background-color: {s.color};"></span>{s.label}
													</td>
													{#each s.values as v, i (data.months[i])}
														{@const d = i > 0 ? pctChange(v, s.values[i - 1]!) : null}
														<td class="tabular py-1.5 pr-3 text-right whitespace-nowrap">
															<button type="button" class="cursor-pointer hover:underline" onclick={() => openMonth(i, s.id)}>{formatEUR(v)}</button>
															{#if d !== null}
																<span class="ml-1 text-[10px]" style="color: {deltaColor(d, invert)};">{d > 0 ? '+' : ''}{d.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} %</span>
															{/if}
														</td>
													{/each}
													<td class="tabular py-1.5 text-right font-medium">{formatEUR(meanOf(s.values))}</td>
												</tr>
											{/each}
										</tbody>
									</table>
								</div>
							{/if}
						</div>
					{/snippet}
				</Block>
			{/if}
		{/each}
	</TileCanvas>
{/if}
