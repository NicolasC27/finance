<script lang="ts">
	import ModuleOptionsButton from '$lib/components/ModuleOptionsButton.svelte';
	import { clearModuleActions, setModuleActions } from '$lib/sidePanel.svelte';
	import { PANEL_SLIDE_MS } from '$lib/sidePanelLayout';
	import { isPending } from '$lib/data';
	import { budgetState } from '$lib/budget.svelte';
	import { getTransactions, getMerchantCategoryMap, txState } from '$lib/store.svelte';
	import { getBudgetTransactions } from '$lib/transfers.svelte';
	import { getAccountsView } from '$lib/wealth.svelte';
	import { buildMonthlyReport } from '$lib/report';
	import { buildSankeyFlows, type SankeyNode } from '$lib/sankey';
	import { categorize } from '$lib/categories';
	import { subcategorize } from '$lib/subcategories';
	import { daysInMonth, isBudgetFlow } from '$lib/totals';
	import { formatEUR, formatMonth, formatPct, monthKeyOf } from '$lib/format';
	import { uiState } from '$lib/ui.svelte';
	import { navigate } from '$lib/router.svelte';
	import MonthNavigator from '$lib/components/MonthNavigator.svelte';
	import SankeyFlow from '$lib/components/SankeyFlow.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';

	/**
	 * /rapport page: private-bank style 'monthly edition' (SPEC v12 §2): kicker + very large serif
	 * month + double rule, sections numbered automatically in the margin (CSS counter), colophon, A4
	 * print.
	 */

	// Months of the budget flows (no more hidden Kraken months since 2018), falling back to every
	// operation
	const months = $derived.by(() => {
		const flows = getBudgetTransactions().filter(isBudgetFlow);
		const src = flows.length > 0 ? flows : getTransactions().filter((tx) => !isPending(tx));
		return [...new Set(src.map((tx) => monthKeyOf(tx.booking_date)))].sort();
	});

	// Initialises the selected month to the latest available month
	$effect(() => {
		if (months.length > 0 && !months.includes(budgetState.selectedMonth)) {
			budgetState.selectedMonth = months[months.length - 1]!;
		}
	});

	// Budget scope (v13): excluded internal transfers leave the report
	const report = $derived(
		buildMonthlyReport(getBudgetTransactions(), budgetState.overrides, budgetState.budgets, budgetState.selectedMonth, getMerchantCategoryMap())
	);

	/** 'Where the money goes' Sankey: same operations and categories as the report. */
	const sankey = $derived.by(() => {
		if (!report) return null;
		const overrides = budgetState.overrides;
		const merchantMap = getMerchantCategoryMap();
		return buildSankeyFlows(
			getBudgetTransactions(),
			report.monthKey,
			(tx) => categorize(tx, overrides, undefined, merchantMap),
			(tx) => subcategorize(tx, overrides, undefined, merchantMap)
		);
	});

	/** Click on a Sankey item: its operations of the month in Transactions. */
	function openFlow(node: SankeyNode) {
		if (!report || !node.categoryId) return;
		const last = daysInMonth(report.monthKey);
		uiState.txFilter = {
			categoryId: node.categoryId,
			...(node.subId ? { subId: node.subId } : {}),
			from: `${report.monthKey}-01`,
			to: `${report.monthKey}-${String(last).padStart(2, '0')}`
		};
		navigate('/transactions');
	}

	/** Colophon data: confirmed operations of the month + detected accounts. */
	const opsCount = $derived(
		getTransactions().filter((tx) => !isPending(tx) && monthKeyOf(tx.booking_date) === report?.monthKey).length
	);
	const accountsCount = $derived(getAccountsView().length);

	/** Long generation date ('13 août 2026') for the colophon. */
	const generatedAt = new Intl.DateTimeFormat('fr-FR', {
		day: 'numeric',
		month: 'long',
		year: 'numeric'
	}).format(new Date());

	/** Change arrow vs last year (positive = increase). */
	function delta(now: number, before: number | undefined): { pct: number; up: boolean } | null {
		if (before === undefined || before === 0) return null;
		const pct = Math.round(((now - before) / Math.abs(before)) * 100);
		return { pct: Math.abs(pct), up: pct >= 0 };
	}

	/** Percentage with 1 decimal, French format ('83,1'). */
	const fmtPct = (v: number): string => v.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

	/** Prints once the side panel has slid away, so it never ends up on the paper. */
	function printReport() {
		uiState.moduleOptions = null;
		setTimeout(() => window.print(), PANEL_SLIDE_MS + 60);
	}

	/** The page hands « Imprimer » to the « ⚙ Rapport » panel while it is shown. */
	$effect(() => {
		setModuleActions('rapport', { render: reportActions });
		return () => clearModuleActions('rapport');
	});
</script>

{#if txState.loadError}
	<div class="card p-6 text-sm" style="color: var(--amber);">{txState.loadError}</div>
{:else if !txState.loaded}
	<header class="mb-8">
		<Skeleton h={28} w={200} class="mb-2" />
		<Skeleton h={14} w={160} />
	</header>
	<Skeleton h={120} rounded={8} class="mb-4" />
	<Skeleton h={220} rounded={8} />
{:else if report}
	<div class="report mx-auto max-w-[760px]">
		<!-- Plain header repeated on every printed page -->
		<div class="print-header" aria-hidden="true">Édition mensuelle — {formatMonth(report.monthKey)}</div>

		<!-- Edition header: kicker + very large serif month + double rule -->
		<header class="mb-8">
			<div class="mb-5 flex flex-wrap items-center justify-between gap-3">
				<p class="edition-kicker">Édition mensuelle</p>
				<div class="no-print flex items-center gap-3">
					<MonthNavigator {months} />
					<ModuleOptionsButton module="rapport" />
				</div>
			</div>
			<h1 class="serif edition-month">{formatMonth(report.monthKey)}</h1>
			{#if report.cutoffDay}
				<!-- Current month: figures cut at the date, compared with the previous month at the same date -->
				<p class="meta-xs mt-1">Édition provisoire, arrêtée au {report.cutoffDay} — comparaisons au {report.cutoffDay} du mois précédent.</p>
			{/if}
			<div class="edition-rule" aria-hidden="true"></div>
		</header>

		<!-- 01 · Overview: generated verdict (teal on surplus, amber on deficit, never red) -->
		<div class="report-section mb-8">
			<span class="report-num" aria-hidden="true"></span>
			<div>
				<header class="report-section-head">
					<h2 class="report-label">Vue d'ensemble</h2>
				</header>
				<section class="card hero-in-1 p-5">
					<p class="serif text-xl leading-snug" style="color: {report.verdict.tone === 'teal' ? 'var(--accent)' : 'var(--accent-2)'};">
						{report.verdict.text}
					</p>
				</section>
			</div>
		</div>

		<!-- 02 · Month flows: income, spending, savings vs last year -->
		<div class="report-section mb-8">
			<span class="report-num" aria-hidden="true"></span>
			<div>
				<header class="report-section-head">
					<h2 class="report-label">Flux du mois</h2>
				</header>
				<section class="card hero-in-2 p-5">
					<div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
						{#each [
							{ label: 'Entrées', value: report.current.income, prev: report.previous?.income, goodUp: true },
							{ label: 'Sorties', value: report.current.expenses, prev: report.previous?.expenses, goodUp: false },
							{ label: 'Épargne nette', value: report.current.net, prev: report.previous?.net, goodUp: true }
						] as row (row.label)}
							{@const d = delta(row.value, row.prev)}
							<div>
								<p class="meta-xs">{row.label}</p>
								<p class="tabular mt-1 text-lg font-semibold">{formatEUR(row.value)}</p>
								{#if d}
									<p
										class="tabular mt-0.5 text-[12px] font-medium"
										style="color: {d.up === row.goodUp ? 'var(--accent)' : 'var(--amber)'};"
										title="vs mois précédent"
									>
										{d.up ? '▲' : '▼'} {d.pct} %
									</p>
								{:else}
									<p class="meta-xs mt-0.5">—</p>
								{/if}
							</div>
						{/each}
						<div>
							<p class="meta-xs">Taux d'épargne</p>
							<p class="tabular mt-1 text-lg font-semibold">
								{report.current.savingsRate !== null ? `${Math.round(report.current.savingsRate)} %` : '—'}
							</p>
							{#if report.previous?.savingsRate !== null && report.previous?.savingsRate !== undefined}
								{@const diff = Math.round((report.current.savingsRate ?? 0) - report.previous.savingsRate)}
								<p class="tabular mt-0.5 text-[12px] font-medium" style="color: {diff >= 0 ? 'var(--accent)' : 'var(--amber)'};">
									{diff >= 0 ? '▲' : '▼'} {Math.abs(diff)} pts
								</p>
							{/if}
						</div>
					</div>
					<!-- Where the money goes: income sources → Entrées → spending items -->
					{#if sankey}
						<div class="mt-4 border-t pt-3" style="border-color: var(--border-subtle);">
							<SankeyFlow flows={sankey} monthLabel={formatMonth(report.monthKey)} partial={report.cutoffDay !== null} onSelect={openFlow} />
							<p class="meta-xs no-print mt-1">Survolez un flux pour le détail · cliquez un poste pour voir ses opérations</p>
						</div>
					{/if}
				</section>
			</div>
		</div>

		<!-- 03 · Categories: top 3 as comparative bars this year vs last year -->
		{#if report.topCategories.length > 0}
			{@const maxVal = Math.max(...report.topCategories.flatMap((c) => [c.current, c.previous]), 1)}
			<div class="report-section mb-8">
				<span class="report-num" aria-hidden="true"></span>
				<div>
					<header class="report-section-head">
						<h2 class="report-label">Catégories</h2>
					</header>
					<section class="card hero-in-3 p-5">
						<div class="space-y-4">
							{#each report.topCategories as cat (cat.categoryId)}
								<div>
									<div class="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
										<span class="font-medium">{cat.label}</span>
										<span class="tabular text-secondary">
											{formatEUR(cat.current)}
											{#if cat.previous > 0}
												<span class="meta-xs">vs {formatEUR(cat.previous)}</span>
											{/if}
										</span>
									</div>
									<!-- This year (solid, category colour) / last year (faded); neutral grey tracks when printing -->
									<div class="bar-track h-2.5 overflow-hidden rounded-full" style="background-color: var(--surface-hover);">
										<div class="h-full rounded-full" style="width: {(cat.current / maxVal) * 100}%; background-color: {cat.color};"></div>
									</div>
									{#if cat.previous > 0}
										<div class="bar-track mt-1 h-1.5 overflow-hidden rounded-full" style="background-color: var(--surface-hover);">
											<div class="h-full rounded-full opacity-45" style="width: {(cat.previous / maxVal) * 100}%; background-color: {cat.color};"></div>
										</div>
									{/if}
								</div>
							{/each}
						</div>
						<p class="meta-xs mt-3">Barre pleine : mois courant · barre fine : mois précédent</p>
					</section>
				</div>
			</div>
		{/if}

		<!-- 04 · Subcategories (v11): top 5 of the month, change vs last year -->
		{#if report.topSubcategories.length > 0}
			<div class="report-section mb-8">
				<span class="report-num" aria-hidden="true"></span>
				<div>
					<header class="report-section-head">
						<h2 class="report-label">Sous-catégories</h2>
					</header>
					<section class="card hero-in-3 p-5">
						<ul class="space-y-3 text-sm">
							{#each report.topSubcategories as sub (sub.subId)}
								{@const d = delta(sub.current, sub.previous)}
								<li class="flex items-baseline justify-between gap-3">
									<span class="font-medium">{sub.label}</span>
									<span class="tabular text-right text-secondary">
										<span class="font-medium" style="color: var(--text);">{formatEUR(sub.current)}</span>
										<span class="meta-xs"> · {fmtPct(sub.share)} % des sorties</span>
										{#if d}
											<!-- Spending: decrease = favourable (accent), increase = neutral (--debit) -->
											<span
												class="ml-2 text-[12px] font-medium"
												style="color: {d.up ? 'var(--debit)' : 'var(--accent)'};"
												title="vs mois précédent ({formatEUR(sub.previous)})"
											>
												{d.up ? '▲' : '▼'} {d.pct} %
											</span>
										{:else}
											<span class="meta-xs ml-2">nouveau</span>
										{/if}
									</span>
								</li>
							{/each}
						</ul>
						<p class="meta-xs mt-3">Sous-catégories calculées automatiquement — le reliquat non détecté reste dans « Autres ».</p>
					</section>
				</div>
			</div>
		{/if}

		<!-- 05 · Highlights -->
		<div class="report-section">
			<span class="report-num" aria-hidden="true"></span>
			<div>
				<header class="report-section-head">
					<h2 class="report-label">Faits marquants</h2>
				</header>
				<section class="card hero-in-3 p-5">
					<ul class="space-y-3 text-sm">
						{#if report.biggest}
							<li class="flex items-baseline justify-between gap-3">
								<span class="text-secondary">Plus grosse dépense</span>
								<span class="text-right font-medium">{report.biggest.label} · <span class="tabular">{formatEUR(report.biggest.amount)}</span></span>
							</li>
						{/if}
						{#if report.budgetRespect}
							<li class="flex items-baseline justify-between gap-3">
								<span class="text-secondary">Respect du budget</span>
								<span class="tabular font-medium" style="color: {report.budgetRespect.within === report.budgetRespect.total ? 'var(--accent)' : 'var(--amber)'};">
									{report.budgetRespect.within}/{report.budgetRespect.total} catégories dans les enveloppes
								</span>
							</li>
						{/if}
						{#if report.incomeAvg3 !== null && report.incomeVsAvgPct !== null}
							<li class="flex items-baseline justify-between gap-3">
								<span class="text-secondary">Revenus vs moyenne 3 mois</span>
								<span class="tabular font-medium" style="color: {report.incomeVsAvgPct >= 0 ? 'var(--accent)' : 'var(--amber)'};">
									{formatPct(report.incomeVsAvgPct, 1, true)}
									<span class="meta-xs">(moy. {formatEUR(report.incomeAvg3)})</span>
								</span>
							</li>
						{/if}
					</ul>
				</section>
			</div>
		</div>

		<!-- Colophon: discreet end-of-edition line -->
		<footer class="colophon">
			<p>
				Généré le {generatedAt} · {opsCount} opération{opsCount > 1 ? 's' : ''} · {accountsCount} compte{accountsCount > 1 ? 's' : ''}
			</p>
		</footer>
	</div>
{/if}

<!-- Action of the « ⚙ Rapport » panel -->
{#snippet reportActions()}
	<button type="button" class="btn btn-secondary btn-sm" onclick={printReport}>Imprimer ou enregistrer en PDF</button>
{/snippet}
