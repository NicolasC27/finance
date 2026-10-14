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
	import { annotateMonth } from '$lib/annotations';
	import { merchantLabel } from '$lib/merchant';
	import { buildSankeyFlows, type SankeyNode } from '$lib/sankey';
	import { categorize } from '$lib/categories';
	import { subcategorize } from '$lib/subcategories';
	import { daysInMonth, isBudgetFlow } from '$lib/totals';
	import { formatDateShort, formatEUR, formatMonth, formatPct, monthKeyOf, truncateLabel } from '$lib/format';
	import { reducedMotion } from '$lib/motion.svelte';
	import { uiState } from '$lib/ui.svelte';
	import { navigate } from '$lib/router.svelte';
	import MonthNavigator from '$lib/components/MonthNavigator.svelte';
	import SankeyFlow from '$lib/components/SankeyFlow.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';

	/**
	 * /rapport page: 'L'édition du mois' — the monthly report as a scrolled narrative. Cover (~70vh)
	 * with a giant serif month and the verdict as lede, sticky chapter rail with scrollspy (desktop,
	 * no-print), chapters revealed on scroll (use:reveal), comparative bars growing when visible
	 * (use:grow), rAF count-ups (use:countup), and an inverted accent epilogue holding the colophon.
	 * prefers-reduced-motion disables reveals, grows and count-ups (final state at once). The A4
	 * print layout of app.css is preserved: every class it targets (.report, .report-section,
	 * .report-num, .report-section-head, .report-label, .edition-kicker, .edition-rule,
	 * .print-header, .colophon, .bar-track, .no-print, .hero-in-*) is kept, and the component
	 * @media print neutralises the choreography (inverted finale included).
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

	/** Annotated statement: the operations that made the month, each with its margin note. */
	const notes = $derived.by(() => {
		if (!report) return [];
		const overrides = budgetState.overrides;
		const merchantMap = getMerchantCategoryMap();
		return annotateMonth(getBudgetTransactions(), report.monthKey, (tx) => categorize(tx, overrides, undefined, merchantMap));
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

	/* ---- Story choreography (CSS + IntersectionObserver + rAF only) ---- */

	/** Hero lede: the verdict sentence split around its key figure (set in italic, tone colour). */
	const lede = $derived.by(() => {
		if (!report) return { before: '', amount: '', after: '', color: 'var(--accent)' };
		const amount = formatEUR(Math.abs(report.current.net));
		const text = report.verdict.text;
		const at = text.indexOf(amount);
		const color = report.verdict.tone === 'teal' ? 'var(--accent)' : 'var(--accent-2)';
		if (at === -1) return { before: text, amount: '', after: '', color };
		return { before: text.slice(0, at), amount, after: text.slice(at + amount.length), color };
	});

	/** Closing line of the epilogue, derived from the verdict tone. */
	const finaleLine = $derived(
		!report ? '' : report.verdict.tone === 'teal' ? 'Un mois qui respire.' : 'Un mois sous tension — mais maîtrisé.'
	);

	/** Savings rate for the count-up ('12 %'). */
	const fmtRate = (v: number): string => `${Math.round(v)} %`;

	/**
	 * Print snapshot: every pending scroll animation jumps to its final state before the sheet is
	 * laid out (the @media print rules of the component do the same for the CSS side).
	 */
	const finalizers = new Set<() => void>();
	$effect(() => {
		const finalizeAll = () => finalizers.forEach((fn) => fn());
		window.addEventListener('beforeprint', finalizeAll);
		return () => window.removeEventListener('beforeprint', finalizeAll);
	});

	/** Runs `fn` once when the node enters the viewport; returns the unobserve cleanup. */
	function whenVisible(node: HTMLElement, fn: () => void): () => void {
		if (typeof IntersectionObserver === 'undefined') {
			fn();
			return () => {};
		}
		const io = new IntersectionObserver(
			(entries) => {
				if (entries.some((e) => e.isIntersecting)) {
					fn();
					io.disconnect();
				}
			},
			{ rootMargin: '0px 0px -8% 0px' }
		);
		io.observe(node);
		return () => io.disconnect();
	}

	/** Stagger cadence of the reveals (60 ms per rank, capped). */
	const stagger = (index: number): string => `${Math.min(Math.max(index, 0), 6) * 60}ms`;

	/**
	 * Action `use:reveal={index}`: fades/slides the node in (opacity 0→1, translateY 14px→0) when it
	 * enters the viewport, with a 60 ms stagger per rank. Reduced motion: nothing hidden at all.
	 */
	function reveal(node: HTMLElement, index: number = 0) {
		if (reducedMotion.current) return;
		node.style.opacity = '0';
		node.style.transform = 'translateY(14px)';
		node.style.transitionDelay = stagger(index);
		const show = () => {
			node.style.opacity = '1';
			node.style.transform = 'translateY(0)';
		};
		const unobserve = whenVisible(node, show);
		const finalize = () => {
			node.style.transitionDelay = '0ms';
			show();
		};
		finalizers.add(finalize);
		return {
			destroy() {
				unobserve();
				finalizers.delete(finalize);
			}
		};
	}

	/**
	 * Action `use:grow={index}`: comparative bar animating its width from 0 to --bar-w when visible
	 * (the width then follows --bar-w, so a month change morphs the bar). Reduced motion: final
	 * width at once.
	 */
	function grow(node: HTMLElement, index: number = 0) {
		if (reducedMotion.current) return;
		node.style.width = '0%';
		node.style.transitionDelay = stagger(index);
		const show = () => {
			node.style.width = 'var(--bar-w, 0%)';
		};
		const unobserve = whenVisible(node, show);
		const finalize = () => {
			node.style.transitionDelay = '0ms';
			show();
		};
		finalizers.add(finalize);
		return {
			destroy() {
				unobserve();
				finalizers.delete(finalize);
			}
		};
	}

	type CountupParam = number | { value: number; format?: (v: number) => string };

	/**
	 * Action `use:countup={value}` (or { value, format }): rAF count-up from 0 to the value (~900 ms,
	 * ease-out cubic, formatEUR by default), triggered at the first entry in the viewport. The final
	 * value is rendered immediately so paper/printing never misses a figure; a later value change
	 * (month change) jumps to the new final value. Reduced motion: no count-up.
	 */
	function countup(node: HTMLElement, param: CountupParam) {
		let value = typeof param === 'number' ? param : param.value;
		let format = (typeof param === 'object' ? param.format : undefined) ?? formatEUR;
		let raf = 0;
		let played = false;

		const render = (v: number) => {
			node.textContent = format(v);
		};
		const finish = () => {
			cancelAnimationFrame(raf);
			render(value);
		};
		const play = () => {
			if (played) return;
			played = true;
			if (reducedMotion.current) {
				finish();
				return;
			}
			const start = performance.now();
			const tick = (now: number) => {
				const t = Math.min(1, (now - start) / 900);
				render(value * (1 - Math.pow(1 - t, 3)));
				if (t < 1) raf = requestAnimationFrame(tick);
			};
			raf = requestAnimationFrame(tick);
		};

		render(value); // final value visible until the count-up takes over
		const unobserve = whenVisible(node, play);
		const finalize = () => {
			played = true;
			unobserve();
			finish();
		};
		finalizers.add(finalize);

		return {
			update(next: CountupParam) {
				value = typeof next === 'number' ? next : next.value;
				format = (typeof next === 'object' ? next.format : undefined) ?? formatEUR;
				if (!played) render(value);
				else finish();
			},
			destroy() {
				cancelAnimationFrame(raf);
				unobserve();
				finalizers.delete(finalize);
			}
		};
	}

	/* ---- Chapter rail + scrollspy ---- */

	interface Chapter {
		id: string;
		label: string;
		num: string;
	}

	/**
	 * Rail chapters, numbered exactly like the CSS counter of .report-num (the sections 03 and 04
	 * are conditional, the numbering follows the rendered sections).
	 */
	const chapters = $derived.by((): Chapter[] => {
		if (!report) return [];
		const list = [
			{ id: 'vue-ensemble', label: "Vue d'ensemble" },
			{ id: 'flux', label: 'Flux du mois' },
			...(report.topCategories.length > 0 ? [{ id: 'categories', label: 'Catégories' }] : []),
			...(report.topSubcategories.length > 0 ? [{ id: 'sous-categories', label: 'Sous-catégories' }] : []),
			...(notes.length > 0 ? [{ id: 'releve', label: 'Relevé annoté' }] : []),
			{ id: 'faits-marquants', label: 'Faits marquants' }
		];
		return list.map((c, i) => ({ ...c, num: String(i + 1).padStart(2, '0') }));
	});

	let activeChapter = $state('');
	const spyNodes = new Map<HTMLElement, string>();
	let spyObserver: IntersectionObserver | null = null;

	/** Scrollspy: the active chapter is the one crossing the middle band of the viewport. */
	function spy(node: HTMLElement, id: string) {
		if (typeof IntersectionObserver === 'undefined') return;
		spyNodes.set(node, id);
		if (!spyObserver) {
			spyObserver = new IntersectionObserver(
				(entries) => {
					for (const entry of entries) {
						if (entry.isIntersecting) activeChapter = spyNodes.get(entry.target as HTMLElement) ?? activeChapter;
					}
				},
				{ rootMargin: '-45% 0px -50% 0px' }
			);
		}
		spyObserver.observe(node);
		return {
			destroy() {
				spyObserver?.unobserve(node);
				spyNodes.delete(node);
				if (spyNodes.size === 0) {
					spyObserver?.disconnect();
					spyObserver = null;
				}
			}
		};
	}

	// First chapter active by default, reset when the chapter list changes
	$effect(() => {
		const ids = chapters.map((c) => c.id);
		if (ids.length > 0 && !ids.includes(activeChapter)) activeChapter = ids[0]!;
	});

	/** Rail click: smooth scroll to the chapter (instant under reduced motion). */
	function scrollToChapter(id: string) {
		activeChapter = id;
		document.getElementById(id)?.scrollIntoView({ behavior: reducedMotion.current ? 'auto' : 'smooth', block: 'start' });
	}
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
	<div class="story-wrap">
		<!-- Chapter rail (desktop ≥1100px, no-print): sticky scrollspy summary -->
		<nav class="story-rail no-print" aria-label="Sommaire de l'édition">
			<p class="rail-title">Sommaire</p>
			<ol class="rail-list">
				{#each chapters as ch (ch.id)}
					<li>
						<button
							type="button"
							class="rail-item"
							class:rail-active={activeChapter === ch.id}
							aria-current={activeChapter === ch.id ? 'true' : undefined}
							onclick={() => scrollToChapter(ch.id)}
						>
							<span class="rail-num serif">{ch.num}</span>
							<span>{ch.label}</span>
						</button>
					</li>
				{/each}
			</ol>
		</nav>

		<div class="report">
			<!-- Plain header repeated on every printed page -->
			<div class="print-header" aria-hidden="true">Édition mensuelle — {formatMonth(report.monthKey)}</div>

			<!-- Cover (~70vh): kicker + giant serif month + verdict lede + double rule -->
			<header class="story-hero">
				<div class="flex flex-wrap items-center justify-between gap-3">
					<p class="edition-kicker">Édition mensuelle</p>
					<div class="no-print flex items-center gap-3">
						<MonthNavigator {months} />
						<ModuleOptionsButton module="rapport" />
					</div>
				</div>
				<div class="story-hero-main">
					<h1 class="serif edition-month story-month">{formatMonth(report.monthKey)}</h1>
					<p class="serif story-lede">
						{lede.before}{#if lede.amount}<em class="lede-key" style="color: {lede.color};">{lede.amount}</em>{/if}{lede.after}
					</p>
					{#if report.cutoffDay}
						<!-- Current month: figures cut at the date, compared with the previous month at the same date -->
						<p class="meta-xs mt-2">Édition provisoire, arrêtée au {report.cutoffDay} — comparaisons au {report.cutoffDay} du mois précédent.</p>
					{/if}
				</div>
				<div class="edition-rule" aria-hidden="true"></div>
			</header>

			<!-- 01 · Overview: generated verdict (teal on surplus, amber on deficit, never red) -->
			<div class="report-section story-reveal mb-8" id="vue-ensemble" use:spy={'vue-ensemble'} use:reveal>
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

			<!-- 02 · Month flows: income, spending, savings vs last year (rAF count-ups) -->
			<div class="report-section story-reveal mb-8" id="flux" use:spy={'flux'} use:reveal>
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
							] as row, i (row.label)}
								{@const d = delta(row.value, row.prev)}
								<div class="story-reveal" use:reveal={i + 1}>
									<p class="meta-xs">{row.label}</p>
									<p class="tabular mt-1 text-lg font-semibold" use:countup={row.value}></p>
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
							<div class="story-reveal" use:reveal={4}>
								<p class="meta-xs">Taux d'épargne</p>
								{#if report.current.savingsRate !== null}
									<p class="tabular mt-1 text-lg font-semibold" use:countup={{ value: report.current.savingsRate, format: fmtRate }}></p>
								{:else}
									<p class="tabular mt-1 text-lg font-semibold">—</p>
								{/if}
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
				<div class="report-section story-reveal mb-8" id="categories" use:spy={'categories'} use:reveal>
					<span class="report-num" aria-hidden="true"></span>
					<div>
						<header class="report-section-head">
							<h2 class="report-label">Catégories</h2>
						</header>
						<section class="card hero-in-3 p-5">
							<div class="space-y-4">
								{#each report.topCategories as cat, i (cat.categoryId)}
									<div class="story-reveal" use:reveal={i}>
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
											<div class="bar-fill" use:grow={i} style="--bar-w: {(cat.current / maxVal) * 100}%; background-color: {cat.color};"></div>
										</div>
										{#if cat.previous > 0}
											<div class="bar-track mt-1 h-1.5 overflow-hidden rounded-full" style="background-color: var(--surface-hover);">
												<div class="bar-fill opacity-45" use:grow={i} style="--bar-w: {(cat.previous / maxVal) * 100}%; background-color: {cat.color};"></div>
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
				<div class="report-section story-reveal mb-8" id="sous-categories" use:spy={'sous-categories'} use:reveal>
					<span class="report-num" aria-hidden="true"></span>
					<div>
						<header class="report-section-head">
							<h2 class="report-label">Sous-catégories</h2>
						</header>
						<section class="card hero-in-3 p-5">
							<ul class="space-y-3 text-sm">
								{#each report.topSubcategories as sub, i (sub.subId)}
									{@const d = delta(sub.current, sub.previous)}
									<li class="story-reveal flex items-baseline justify-between gap-3" use:reveal={i}>
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

			<!-- Annotated statement: the month's notable operations, a note in the margin of each -->
			{#if notes.length > 0}
				<div class="report-section story-reveal mb-8" id="releve" use:spy={'releve'} use:reveal>
					<span class="report-num" aria-hidden="true"></span>
					<div>
						<header class="report-section-head">
							<h2 class="report-label">Relevé annoté</h2>
						</header>
						<section class="card hero-in-3 p-5">
							<ol class="statement">
								{#each notes as n, i (n.kind + n.tx.booking_date + n.amount + i)}
									<li class="statement-row story-reveal" use:reveal={i}>
										<span class="statement-date tabular">{formatDateShort(n.tx.booking_date)}</span>
										<span class="statement-label" title={n.tx.remittance_information.join(' ')}>{truncateLabel(merchantLabel(n.tx.remittance_information), 34)}</span>
										<span class="statement-amount tabular">−{formatEUR(n.amount)}</span>
										<span class="statement-note serif" class:statement-note-key={n.kind === 'biggest' || n.kind === 'unusual'}>{n.note}</span>
									</li>
								{/each}
							</ol>
						</section>
					</div>
				</div>
			{/if}

			<!-- 05 · Highlights -->
			<div class="report-section story-reveal" id="faits-marquants" use:spy={'faits-marquants'} use:reveal>
				<span class="report-num" aria-hidden="true"></span>
				<div>
					<header class="report-section-head">
						<h2 class="report-label">Faits marquants</h2>
					</header>
					<section class="card hero-in-3 p-5">
						<ul class="space-y-3 text-sm">
							{#if report.biggest && notes.length === 0}
								<li class="story-reveal flex items-baseline justify-between gap-3" use:reveal={0}>
									<span class="text-secondary">Plus grosse dépense</span>
									<span class="text-right font-medium">{report.biggest.label} · <span class="tabular">{formatEUR(report.biggest.amount)}</span></span>
								</li>
							{/if}
							{#if report.budgetRespect}
								<li class="story-reveal flex items-baseline justify-between gap-3" use:reveal={1}>
									<span class="text-secondary">Respect du budget</span>
									<span class="tabular font-medium" style="color: {report.budgetRespect.within === report.budgetRespect.total ? 'var(--accent)' : 'var(--amber)'};">
										{report.budgetRespect.within}/{report.budgetRespect.total} catégories dans les enveloppes
									</span>
								</li>
							{/if}
							{#if report.incomeAvg3 !== null && report.incomeVsAvgPct !== null}
								<li class="story-reveal flex items-baseline justify-between gap-3" use:reveal={2}>
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

			<!-- Epilogue: full-bleed accent band (white paper / black ink when printing) -->
			<section class="story-finale story-reveal" use:reveal>
				<p class="serif finale-line">{finaleLine}</p>
				<!-- Colophon: discreet end-of-edition line -->
				<footer class="colophon finale-colophon">
					<p>
						Généré le {generatedAt} · {opsCount} opération{opsCount > 1 ? 's' : ''} · {accountsCount} compte{accountsCount > 1 ? 's' : ''}
					</p>
				</footer>
			</section>
		</div>
	</div>
{/if}

<!-- Action of the « ⚙ Rapport » panel -->
{#snippet reportActions()}
	<button type="button" class="btn btn-secondary btn-sm" onclick={printReport}>Imprimer ou enregistrer en PDF</button>
{/snippet}

<style>
	/* ---- Scrolled narrative layout ('L'édition du mois') ---- */

	/* Reading column, alone below 1100px, flanked by the chapter rail above */
	.story-wrap {
		max-width: 760px;
		margin-inline: auto;
	}

	.story-rail {
		display: none;
	}

	@media (min-width: 1100px) {
		.story-wrap {
			max-width: 1024px;
			display: grid;
			grid-template-columns: 200px minmax(0, 760px);
			column-gap: 4rem;
		}

		.story-rail {
			display: block;
			position: sticky;
			top: 5rem;
			padding-top: 4.5rem; /* roughly level with the first chapter */
		}
	}

	.rail-title {
		font-size: 10.5px;
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.14em;
		color: var(--text-3);
	}

	.rail-list {
		margin-top: 0.9rem;
		padding: 0;
		list-style: none;
	}

	.rail-item {
		display: flex;
		align-items: baseline;
		gap: 0.6rem;
		width: 100%;
		padding: 0.4rem 0 0.4rem 0.9rem;
		border-left: 1px solid var(--border-subtle);
		font-size: 13px;
		text-align: left;
		cursor: pointer;
		color: var(--text-3);
		transition:
			color var(--motion-base) ease,
			border-color var(--motion-base) ease;
	}

	.rail-item:hover {
		color: var(--text-2);
	}

	.rail-item.rail-active {
		color: var(--accent);
		border-left-color: var(--accent);
	}

	.rail-num {
		font-size: 12px;
		color: inherit;
		opacity: 0.7;
	}

	/* ---- Cover (~70vh): controls row on top, title block centred, double rule at the bottom ---- */
	.story-hero {
		min-height: 70vh;
		display: flex;
		flex-direction: column;
	}

	.story-hero-main {
		flex: 1;
		display: flex;
		flex-direction: column;
		justify-content: center;
		padding-block: 3rem 2rem;
	}

	/* Giant serif month (overrides the quieter .edition-month of app.css) */
	.story-month {
		font-size: clamp(44px, 9vw, 96px);
		line-height: 1.02;
		letter-spacing: -0.02em;
	}

	.story-lede {
		margin-top: 1.2rem;
		max-width: 38ch;
		font-size: clamp(17px, 1.8vw, 20px);
		line-height: 1.55;
		color: var(--text-2);
	}

	.lede-key {
		font-style: italic;
	}

	/* Scrollspy anchor offset (fixed header clearance) */
	.report-section {
		scroll-margin-top: 5rem;
	}

	/*
	 * Scroll reveal: the use:reveal action sets the hidden state inline (opacity 0, translateY
	 * 14px) before the first paint, the transition itself lives here. Reduced motion: the action
	 * hides nothing and the transition is cut.
	 */
	.story-reveal {
		transition:
			opacity var(--motion-slow) var(--ease-out),
			transform var(--motion-slow) var(--ease-out);
	}

	/*
	 * Annotated statement: date, label and amount like a bank statement line, the note set in the
	 * margin in italic serif after a short rule (below the line on narrow screens).
	 */
	.statement {
		list-style: none;
		padding: 0;
		margin: 0;
	}

	.statement-row {
		display: grid;
		grid-template-columns: 4.5rem minmax(0, 1fr) auto;
		column-gap: 0.9rem;
		align-items: baseline;
		padding: 0.55rem 0;
		border-bottom: 1px solid var(--border-subtle);
		font-size: 13px;
	}

	.statement-row:last-child {
		border-bottom: 0;
	}

	.statement-date {
		color: var(--text-3);
		font-size: 12px;
	}

	.statement-label {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-weight: 500;
	}

	.statement-amount {
		text-align: right;
		font-weight: 500;
	}

	.statement-note {
		grid-column: 2 / -1;
		margin-top: 0.15rem;
		font-size: 14px;
		font-style: italic;
		color: var(--text-2);
	}

	.statement-note::before {
		content: '';
		display: inline-block;
		width: 1.1rem;
		margin-right: 0.45rem;
		vertical-align: middle;
		border-top: 1px solid currentColor;
		opacity: 0.6;
	}

	.statement-note-key {
		color: var(--accent);
	}

	@media (min-width: 900px) {
		.statement-row {
			grid-template-columns: 4.5rem minmax(0, 1fr) auto minmax(12rem, 16rem);
		}

		.statement-note {
			grid-column: auto;
			margin-top: 0;
			padding-left: 0.4rem;
		}
	}

	/* Comparative bar fill: target width carried by --bar-w (the use:grow action starts from 0) */
	.bar-fill {
		width: var(--bar-w, 0%);
		height: 100%;
		border-radius: 9999px;
		transition: width var(--motion-slow) var(--ease-out);
	}

	/*
	 * Epilogue: inverted band, accent background painted full-bleed by an oversized box-shadow
	 * clipped vertically (no horizontal overflow), cream text — the one sanctioned hard-coded
	 * colour — with the colophon inside.
	 */
	.story-finale {
		margin-top: 4rem;
		padding: 4rem 0 3rem;
		background-color: var(--accent);
		box-shadow: 0 0 0 100vmax var(--accent);
		clip-path: inset(0 -100vmax);
		color: #fffdf7;
	}

	.finale-line {
		max-width: 20ch;
		font-size: clamp(28px, 5vw, 48px);
		line-height: 1.12;
		letter-spacing: -0.01em;
		color: #fffdf7;
	}

	.finale-colophon {
		margin-top: 2.5rem;
		border-top-color: color-mix(in srgb, #fffdf7 30%, transparent);
		color: color-mix(in srgb, #fffdf7 78%, transparent);
	}

	@media (prefers-reduced-motion: reduce) {
		/* Final state at once, even over the inline styles the actions may have set */
		.story-reveal {
			opacity: 1 !important;
			transform: none !important;
			transition: none;
		}

		.bar-fill {
			width: var(--bar-w, 0%) !important;
			transition: none;
		}

		.rail-item {
			transition: none;
		}
	}

	/* Print: no scroll choreography on paper, inverted finale neutralised (white paper, black ink) */
	@media print {
		.story-reveal {
			opacity: 1 !important;
			transform: none !important;
			transition: none !important;
		}

		.bar-fill {
			width: var(--bar-w, 0%) !important;
			transition: none !important;
		}

		.story-hero {
			min-height: 0;
		}

		.story-hero-main {
			padding-block: 1rem 0.5rem;
		}

		.statement-row {
			grid-template-columns: 4rem minmax(0, 1fr) auto 14rem;
		}

		.statement-note {
			grid-column: auto;
			margin-top: 0;
			color: #1c1c1c !important;
		}

		.story-finale {
			margin-top: 0;
			padding: 0;
			background-color: #ffffff !important;
			box-shadow: none !important;
			clip-path: none !important;
			color: #1c1c1c !important;
		}

		.finale-line {
			color: #1c1c1c !important;
		}

		.finale-colophon {
			border-top-color: #e2ded4 !important;
			color: #6b6b66 !important;
		}
	}
</style>
