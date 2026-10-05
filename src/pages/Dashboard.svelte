<script lang="ts">
	import { segmented } from '$lib/actions/segmented';
	import type { CategoryId, Transaction } from '$lib/types';
	import { isPending, signedAmount, spendAmount, cumulativeBalance, type BalancePoint, isBankTx } from '$lib/data';
	import { accountOf } from '$lib/scope';
	import { flowKind } from '$lib/flow';
	import { monthTotals, monthCutoffDay, lastFlowDate, isBudgetFlow, daysInMonth } from '$lib/totals';
	import { shiftMonthKey } from '$lib/insights';
	import { categorize, getCategory, isWealthMovement, txKey } from '$lib/categories';
	import { getSubcategory, subcategorize } from '$lib/subcategories';
	import { lighten } from '$lib/color';
	import { budgetState } from '$lib/budget.svelte';
	import { getTransactions, getMerchantCategoryMap, txState } from '$lib/store.svelte';
	import { getBudgetTransactions } from '$lib/transfers.svelte';
	import { getAccountsView, krakenState, refreshPrices } from '$lib/wealth.svelte';
	import { krakenLedgerState } from '$lib/krakenLedger.svelte';
	import { onMount } from 'svelte';
	import Block from '$lib/components/Block.svelte';
	import TileCanvas from '$lib/components/TileCanvas.svelte';
	import type { BlockElement } from '$lib/layoutModel';
	import NotesCard from '$lib/components/NotesCard.svelte';
	import SavingsGoalCard from '$lib/components/SavingsGoalCard.svelte';
	import { orderedIds, isFullscreen, storeByDefault } from '$lib/layout.svelte';
	import { isSectionCollapsed, toggleSectionCollapse } from '$lib/ui.svelte';
	import type { AccountKind } from '$lib/csvCore';
	import { formatMonth, monthKeyOf, formatEUR, formatEURCompact, formatDate, truncateLabel } from '$lib/format';
	import { merchantLabel } from '$lib/merchant';
	import { buildEditorialSummary } from '$lib/report';
	import StatCard from '$lib/components/StatCard.svelte';
	import MonthNavigator from '$lib/components/MonthNavigator.svelte';
	import BalanceChart, { type ChartAnnotation } from '$lib/components/BalanceChart.svelte';
	import TransactionRow from '$lib/components/TransactionRow.svelte';
	import CategoryDonut, { type DonutSlice } from '$lib/components/CategoryDonut.svelte';
	import BudgetRing from '$lib/components/BudgetRing.svelte';
	import InsightsCard from '$lib/components/InsightsCard.svelte';
	import PageTitle from '$lib/components/PageTitle.svelte';
	import { avgDailyNet, todayIso } from '$lib/forecast';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import { navigate } from '$lib/router.svelte';
	import { uiState } from '$lib/ui.svelte';

	// 'À venir' card in a separate chunk (gzip budget of the main bundle)
	const upcomingCard = import('$lib/components/UpcomingCard.svelte');
	import AnimatedAmount from '$lib/components/AnimatedAmount.svelte';

	/** Dashboard page: asymmetric bento layout (12-column grid ≥1100px). */

	function dayKey(d: Date): string {
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
	}

	/** Confirmed transactions (pending excluded). */
	const confirmed = $derived(getTransactions().filter((tx) => !isPending(tx)));

	/**
	 * BUDGET scope (SPEC v13 §C.2): excluded internal transfers leave the totals (income/spending,
	 * donut, summary, forecasts, insights); the current balance and the curve keep the full scope
	 * because that is real money moving (counted in balances, see Patrimoine).
	 */
	const confirmedBudget = $derived(getBudgetTransactions().filter((tx) => !isPending(tx)));

	/** Resolved category (overrides, rules, holidays, cross learning). */
	const catOf = (tx: Transaction): CategoryId => categorize(tx, budgetState.overrides, undefined, getMerchantCategoryMap());

	/**
	 * Months present in the budget FLOWS (bounds of the ‹ month › navigation, shared with the Budget
	 * page): hidden Kraken rows no longer push the navigation back to 2018.
	 */
	const months = $derived.by(() => {
		const flows = confirmedBudget.filter(isBudgetFlow);
		return [...new Set((flows.length > 0 ? flows : confirmed).map((tx) => monthKeyOf(tx.booking_date)))].sort();
	});

	// Selected month: the Budget page's one (budgetState.selectedMonth); defaults to the latest month
	// of the data
	$effect(() => {
		if (months.length > 0 && !months.includes(budgetState.selectedMonth)) {
			budgetState.selectedMonth = months[months.length - 1]!;
		}
	});

	/**
	 * Displayed month (donut, budget health, summary, insights): ‹ › selection or latest month of the
	 * data.
	 */
	const currentMonth = $derived(months.includes(budgetState.selectedMonth) ? budgetState.selectedMonth : (months[months.length - 1] ?? ''));

	/** Flows of the displayed month (budget scope, Kraken/Natixis wealth excluded). */
	const txOfMonth = $derived(confirmedBudget.filter((tx) => isBudgetFlow(tx) && monthKeyOf(tx.booking_date) === currentMonth));

	/** Incomplete (current) month: cutoff day, comparisons at the same day of the previous month. */
	const cutoffDay = $derived(currentMonth ? monthCutoffDay(currentMonth, lastFlowDate(confirmedBudget), todayIso()) : null);

	/** Editorial summary (SPEC v12 §4): computed one-sentence summary of the month. */
	const summary = $derived(buildEditorialSummary(getBudgetTransactions(), currentMonth, catOf));

	const accountsView = $derived(getAccountsView());

	/**
	 * CURRENT accounts (base of the 'Solde actuel', the curve and the projection). Before, the balance
	 * added current + savings + loan accounts (and the Krak card), far above the current account
	 * itself. Savings and loans stay on Patrimoine. null = no register (demo): cumulative bank flows.
	 */
	const liquidIds = $derived.by((): Set<string> | null => {
		if (accountsView.length === 0) return null;
		const currentAccounts = accountsView.filter((a) => a.kind === 'courant');
		const pick = currentAccounts.length > 0 ? currentAccounts : accountsView.filter((a) => a.kind !== 'pret' && a.kind !== 'livret');
		return new Set((pick.length > 0 ? pick : accountsView).map((a) => a.id));
	});
	const liquidConfirmed = $derived(confirmed.filter((tx) => isBankTx(tx) && (!liquidIds || liquidIds.has(accountOf(tx)))));
	/** Cumulative flows of the current accounts (no opening balance). */
	const liquidFlowTotal = $derived(liquidConfirmed.reduce((sum, tx) => sum + signedAmount(tx), 0));
	/**
	 * Current balance = balances of the current accounts (declared by the statement); otherwise
	 * cumulative flows.
	 */
	const balance = $derived.by(() => {
		const ids = liquidIds;
		if (!ids) return Math.round(liquidFlowTotal * 100) / 100;
		return Math.round(accountsView.filter((a) => ids.has(a.id)).reduce((sum, a) => sum + a.balance, 0) * 100) / 100;
	});
	/** Flow → real balance offset: the statement does not contain the opening balance. */
	const balanceOffset = $derived(Math.round((balance - liquidFlowTotal) * 100) / 100);

	/** Change in % (clamped to ±999 %), undefined without a base. */
	const pct = (now: number, before: number) =>
		before !== 0 ? Math.max(-999, Math.min(999, ((now - before) / Math.abs(before)) * 100)) : undefined;

	/**
	 * KPIs of the DISPLAYED month (before: a rolling 30 days that did not follow ‹ ›, so 'Sorties' and
	 * 'Dépensé' disagreed). Income/spending per category (totals.ts), change vs the previous month,
	 * cut at the same day when the month is in progress. Balance: current accounts at the end of the
	 * displayed month. Also builds the daily cumulative series (income/spending sparklines) and the
	 * daily current-account balance over the month (carrying the last known balance).
	 */
	const monthStats = $derived.by(() => {
		if (!currentMonth) return null;
		const cur = monthTotals(txOfMonth, currentMonth, catOf);
		const prevKey = shiftMonthKey(currentMonth, -1);
		const prev = monthTotals(confirmedBudget, prevKey, catOf, cutoffDay);
		const days = daysInMonth(currentMonth);
		const limit = cutoffDay ?? days;

		const inc = new Array<number>(limit).fill(0);
		const exp = new Array<number>(limit).fill(0);
		for (const tx of txOfMonth) {
			const d = Number(tx.booking_date.slice(8, 10));
			if (d < 1 || d > limit) continue;
			const kind = flowKind(catOf(tx));
			if (kind === 'income') inc[d - 1]! += signedAmount(tx);
			else if (kind === 'expense') exp[d - 1]! -= signedAmount(tx);
		}
		let ci = 0;
		let ce = 0;
		const incomeSeries = inc.map((v) => Math.round((ci += v) * 100) / 100);
		const expensesSeries = exp.map((v) => Math.round((ce += v) * 100) / 100);

		const byIso = new Map(allChartPoints.map((p) => [p.iso, p.balance]));
		let bal = allChartPoints.filter((p) => p.iso < `${currentMonth}-01`).at(-1)?.balance ?? allChartPoints[0]?.balance ?? balance;
		const startBalance = bal;
		const balanceSeries: number[] = [];
		for (let d = 1; d <= limit; d++) {
			bal = byIso.get(`${currentMonth}-${String(d).padStart(2, '0')}`) ?? bal;
			balanceSeries.push(bal);
		}
		const balanceEnd = balanceSeries.at(-1) ?? balance;
		return {
			income: cur.income,
			expenses: cur.expenses,
			incomeVar: prev.count > 0 ? pct(cur.income, prev.income) : undefined,
			expensesVar: prev.count > 0 ? pct(cur.expenses, prev.expenses) : undefined,
			prevLabel: cutoffDay ? `vs le ${cutoffDay} ${monthShort(prevKey)}` : `vs ${monthShort(prevKey)}`,
			incomeSeries,
			expensesSeries,
			balanceSeries,
			balanceEnd,
			balanceVar: pct(balanceEnd, startBalance)
		};
	});

	/** Short month ('sept.') for comparison labels. */
	function monthShort(monthKey: string): string {
		const [y, m] = monthKey.split('-').map(Number);
		return new Intl.DateTimeFormat('fr-FR', { month: 'short' }).format(new Date(y!, m! - 1, 15));
	}

	/** The displayed month is the latest of the data: its balance is the CURRENT balance. */
	const isLatestMonth = $derived(currentMonth === months[months.length - 1]);

	/**
	 * Current-account balance curve: cumulative flows aligned on the real balance (last point =
	 * current balance).
	 */
	const allChartPoints = $derived(cumulativeBalance(liquidConfirmed).map((p) => ({ ...p, balance: Math.round((p.balance + balanceOffset) * 100) / 100 })));

	/** Displayed window (1M, 3M, 6M, 1Y, all), persisted. */
	type ChartRangeKey = '1M' | '3M' | '6M' | '1A' | 'all';
	const RANGE_KEY = 'budget:balance-range';
	const RANGES: { key: ChartRangeKey; label: string; days: number }[] = [
		{ key: '1M', label: '1 mois', days: 31 },
		{ key: '3M', label: '3 mois', days: 92 },
		{ key: '6M', label: '6 mois', days: 183 },
		{ key: '1A', label: '1 an', days: 366 },
		{ key: 'all', label: 'Tout', days: 0 }
	];
	function loadRange(): ChartRangeKey {
		try {
			const v = localStorage.getItem(RANGE_KEY);
			return RANGES.some((r) => r.key === v) ? (v as ChartRangeKey) : '3M';
		} catch {
			return '3M';
		}
	}
	let chartRangeKey = $state<ChartRangeKey>(loadRange());
	function setRange(k: ChartRangeKey) {
		chartRangeKey = k;
		try {
			localStorage.setItem(RANGE_KEY, k);
		} catch {
		}
	}
	/** The point just before the window gives the opening balance. */
	const chartPoints = $derived.by(() => {
		const days = RANGES.find((r) => r.key === chartRangeKey)?.days ?? 0;
		if (!days || allChartPoints.length < 2) return allChartPoints;
		const last = allChartPoints[allChartPoints.length - 1]!.date.getTime();
		const start = last - days * 86_400_000;
		const idx = allChartPoints.findIndex((p) => p.date.getTime() >= start);
		if (idx <= 0) return allChartPoints;
		return allChartPoints.slice(idx - 1);
	});

	/** Last 15 transactions, pending first with a badge. */
	/** Recent operations OF THE DISPLAYED MONTH (+ pending ones), most recent first. */
	const recent = $derived(
		getTransactions()
			.filter((tx) => isPending(tx) || monthKeyOf(tx.booking_date) === currentMonth)
			.sort((a, b) => {
				if (isPending(a) !== isPending(b)) return isPending(a) ? -1 : 1;
				return b.booking_date.localeCompare(a.booking_date);
			})
			.slice(0, 15)
	);

	/** Spending of the month per category (donut + budget health). */
	const spentByCategory = $derived.by(() => {
		const totals = new Map<CategoryId, number>();
		for (const tx of txOfMonth) {
			const id = categorize(tx, budgetState.overrides, undefined, getMerchantCategoryMap());
			const spend = spendAmount(tx, id);
			if (spend === null) continue;
			totals.set(id, (totals.get(id) ?? 0) + spend);
		}
		return totals;
	});

	/** A category with a net refund (≤ 0) gets no share: it made the arcs overlap. */
	const donut = $derived.by((): DonutSlice[] => {
		return [...spentByCategory.entries()]
			.map(([id, value]) => {
				const cat = getCategory(id);
				return { id, label: cat.label, value: Math.round(value * 100) / 100, color: cat.color };
			})
			.filter((sl) => sl.value > 0)
			.sort((a, b) => b.value - a.value);
	});
	const donutTotal = $derived(donut.reduce((sum, s) => sum + s.value, 0));

	// ---- Donut drill-down (SPEC v11 §3): category → subcategories ----
	/** Detailed category (local state, no route). */
	let drilled = $state<CategoryId | null>(null);

	/** Spending of the month split by subcategory (null key = 'Autres' bucket). */
	const subSpendByCategory = $derived.by(() => {
		const out = new Map<CategoryId, Map<string | null, number>>();
		for (const tx of txOfMonth) {
			const catId = categorize(tx, budgetState.overrides, undefined, getMerchantCategoryMap());
			const spend = spendAmount(tx, catId);
			if (spend === null) continue;
			const sub = subcategorize(tx, budgetState.overrides, undefined, getMerchantCategoryMap());
			let m = out.get(catId);
			if (!m) {
				m = new Map<string | null, number>();
				out.set(catId, m);
			}
			m.set(sub, (m.get(sub) ?? 0) + spend);
		}
		return out;
	});

	/**
	 * Drillable categories: at least ONE subcategory detected over the period, never a drill-down into
	 * a single-segment 'Autres' donut.
	 */
	const drillable = $derived.by(() => {
		const set = new Set<CategoryId>();
		for (const [catId, m] of subSpendByCategory) {
			if ([...m.keys()].some((k) => k !== null)) set.add(catId);
		}
		return set;
	});

	// Leaves the drill-down when the category is no longer detected (data/filters changed)
	$effect(() => {
		if (drilled && !drillable.has(drilled)) drilled = null;
	});

	/** Scale of tints derived from the category colour (lighten, increasing lightness). */
	function subColorLadder(baseColor: string, n: number): string[] {
		return Array.from({ length: n }, (_, i) => (n <= 1 ? baseColor : lighten(baseColor, (i / (n - 1)) * 0.55)));
	}

	/**
	 * Current donut view: categories, or subcategories of `drilled` ('Autres' bucket last, neutral
	 * tint: --debit at 40 %).
	 */
	const donutView = $derived.by(() => {
		if (!drilled) {
			return { slices: donut, total: donutTotal, centerLabel: 'Dépensé', title: 'Dépenses du mois par catégorie' };
		}
		const cat = getCategory(drilled);
		const spend = subSpendByCategory.get(drilled) ?? new Map<string | null, number>();
		const named = [...spend.entries()]
			.filter(([k, v]) => k !== null && v > 0)
			.map(([subId, v]) => ({ subId: subId as string, value: Math.round(v * 100) / 100 }))
			.sort((a, b) => b.value - a.value);
		const otherTotal = Math.round((spend.get(null) ?? 0) * 100) / 100;
		const colors = subColorLadder(cat.color, named.length);
		const slices: DonutSlice[] = named.map((s, i) => ({
			id: s.subId,
			label: getSubcategory(s.subId)?.label ?? s.subId,
			value: s.value,
			color: colors[i]!
		}));
		if (otherTotal > 0) {
			slices.push({ id: 'autres', label: 'Autres', value: otherTotal, color: 'color-mix(in srgb, var(--debit) 40%, transparent)' });
		}
		const total = Math.round(slices.reduce((sum, s) => sum + s.value, 0) * 100) / 100;
		return { slices, total, centerLabel: cat.label, title: `${cat.label} — détail` };
	});

	/** ISO bounds of the displayed month (Transactions filter). */
	function monthBounds(m: string): { from: string; to: string } {
		const [y, mm] = m.split('-').map(Number);
		const last = new Date(y!, mm!, 0).getDate();
		return { from: `${m}-01`, to: `${m}-${String(last).padStart(2, '0')}` };
	}

	/**
	 * Opens the Transactions page filtered on the category (+ subcategory) and the displayed month.
	 */
	function goToTransactions(categoryId: CategoryId, subId?: string | null) {
		uiState.txFilter = { categoryId, ...(subId !== undefined ? { subId } : {}), ...monthBounds(currentMonth) };
		navigate('/transactions');
	}

	/** At the root: click = detail (when drillable). In detail: click = filtered Transactions. */
	const isDonutSliceClickable = (slice: DonutSlice): boolean => (drilled ? true : drillable.has(slice.id as CategoryId));

	function onDonutSliceClick(slice: DonutSlice) {
		if (drilled) {
			goToTransactions(drilled, slice.id === 'autres' ? null : slice.id);
			return;
		}
		if (isDonutSliceClickable(slice)) drilled = slice.id as CategoryId;
	}

	/** Budget health: share of the overall budget consumed this month. */
	const health = $derived.by(() => {
		const totalBudget = Object.values(budgetState.budgets).reduce((sum, v) => sum + (v ?? 0), 0);
		const ratio = totalBudget > 0 ? donutTotal / totalBudget : 0;
		return { totalBudget, ratio, over: ratio > 1 };
	});

	/**
	 * Insight: largest expense of the month (a transfer to the savings account is not 'the largest
	 * expense').
	 */
	const biggest = $derived.by(() => {
		let worst: (typeof txOfMonth)[number] | null = null;
		let catId: CategoryId = 'autre';
		for (const tx of txOfMonth) {
			if (signedAmount(tx) >= 0) continue;
			if (worst && signedAmount(tx) >= signedAmount(worst)) continue;
			const cat = catOf(tx);
			if (flowKind(cat) !== 'expense') continue;
			worst = tx;
			catId = cat;
		}
		if (!worst) return null;
		return { tx: worst, amount: -signedAmount(worst), category: getCategory(catId), categoryId: catId };
	});

	/**
	 * Automatic chart annotations: salary (teal, largest credit of the current month) + largest
	 * expense of the month (amber), with a short, bounded merchant label (the chart adds the signed
	 * amount, same shape as 'Salaire'; a chart annotation is not a statement line).
	 */
	const chartAnnotations = $derived.by((): ChartAnnotation[] => {
		const out: ChartAnnotation[] = [];
		let salary: Transaction | null = null;
		for (const tx of txOfMonth) {
			if (signedAmount(tx) <= 0 || isWealthMovement(tx)) continue;
			if (categorize(tx, budgetState.overrides, undefined, getMerchantCategoryMap()) !== 'revenus') continue;
			if (!salary || signedAmount(tx) > signedAmount(salary)) salary = tx;
		}
		if (salary) {
			out.push({ iso: salary.booking_date, kind: 'salary', label: 'Salaire', amount: signedAmount(salary) });
		}
		if (biggest) {
			const label = truncateLabel(merchantLabel(biggest.tx.remittance_information) || biggest.category.label, 22);
			out.push({ iso: biggest.tx.booking_date, kind: 'expense', label, amount: biggest.amount });
		}
		return out;
	});

	/** Range of the balance curve, for the card header ('du 1 avr. au 31 juil.'). */
	const chartRange = $derived.by((): string => {
		const first = chartPoints[0];
		const last = chartPoints[chartPoints.length - 1];
		if (!first || !last) return '';
		const fmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });
		return `du ${fmt.format(first.date)} au ${fmt.format(last.date)}`;
	});

	/** Detected accounts (register ∪ imports); bento card hidden when demo only. */
	// ---- Kraken card cashback (CSV ledger, v14 §E.3) ----
	const cashback = $derived.by(() => {
		const entries = Object.entries(krakenLedgerState.ledger.cashbackTotal).filter(([, qty]) => qty > 0);
		if (entries.length === 0) return null;
		const [symbol, qty] = entries.sort((a, b) => b[1] - a[1])[0]!;
		const quote = krakenState.prices[symbol];
		return { symbol, qty, eur: quote ? qty * quote.price : undefined };
	});
	const cashbackCount = $derived(krakenLedgerState.ledger.cashbackCount);

	/** EUR valuation of the cashback with Kraken public prices (cached, non-fatal). */
	onMount(() => {
		if (cashback) void refreshPrices();
	});

	const accountsTotal = $derived(Math.round(accountsView.reduce((sum, a) => sum + a.balance, 0) * 100) / 100);

	/** Compact split by type: '1 courant · 1 livret · 1 crédit'. */
	const accountsBreakdown = $derived.by((): string => {
		const LABELS: [AccountKind, string, string][] = [
			['courant', 'courant', 'courants'],
			['livret', 'livret', 'livrets'],
			['pret', 'crédit', 'crédits'],
			['crypto', 'crypto', 'cryptos'],
			['autre', 'autre', 'autres']
		];
		return LABELS.map(([kind, one, many]) => {
			const n = accountsView.filter((a) => a.kind === kind).length;
			return n > 0 ? `${n} ${n > 1 ? many : one}` : '';
		})
			.filter((s) => s !== '')
			.join(' · ');
	});

	/**
	 * End-of-month projection: daily extension from the last real point up to the last day of the
	 * current data month, using the average daily net flow of the CURRENT ACCOUNTS over the last 90
	 * days (same scope as the curve: a monthly transfer to Kraken or the savings account really leaves
	 * the account).
	 */
	const projection = $derived.by((): BalancePoint[] => {
		const pts = chartPoints;
		if (pts.length < 2 || !currentMonth) return [];
		const last = pts[pts.length - 1]!;
		const [y, m] = currentMonth.split('-').map(Number);
		const endOfMonth = new Date(y!, m!, 0);
		const lastDate = new Date(`${last.iso}T12:00:00`);
		const remaining = Math.round((endOfMonth.getTime() - lastDate.getTime()) / 86_400_000);
		if (remaining < 1 || remaining > 45) return [];
		const avgNet = avgDailyNet(liquidConfirmed, last.iso);
		const out: BalancePoint[] = [];
		for (let d = 1; d <= remaining; d++) {
			const date = new Date(lastDate);
			date.setDate(date.getDate() + d);
			out.push({ date, iso: dayKey(date), balance: Math.round((last.balance + avgNet * d) * 100) / 100 });
		}
		return out;
	});

	/** End of the projection ('solde projeté' insight: same source as the curve). */
	const projectionEnd = $derived(projection.length > 0 ? { balance: projection[projection.length - 1]!.balance, endIso: projection[projection.length - 1]!.iso } : null);

	/** Customisable Dashboard blocks (default order). */
	const DASH_BLOCKS = ['kpi-solde', 'kpi-entrees', 'kpi-sorties', 'kpi-budget', 'balance', 'donut', 'savings', 'recent', 'insights', 'upcoming', 'comptes', 'notes'] as const;

	/** Height left to the balance chart under its header when its tile has a set height. */
	let balanceArea = $state(0);
	/** Height of the « Points clés » title (the mini chart under it fills the rest of a set tile height). */
	let insightsHead = $state(0);

	/** Ring diameter that fills a donut tile: beside the legend when wide enough, else above it. */
	function donutDiameter(box: { w: number; h: number }, legend: boolean): number {
		const across = legend && box.w >= 440 ? box.w - 240 : box.w - 24;
		return Math.round(Math.max(72, Math.min(320, box.h - 64, across)));
	}

	/** Optional elements of each Dashboard block (user can hide them). */
	const STAT_ELEMENTS: BlockElement[] = [
		{ id: 'variation', label: 'Variation' },
		{ id: 'courbe', label: 'Mini-courbe' }
	];
	const BUDGET_KPI_ELEMENTS: BlockElement[] = [
		{ id: 'montants', label: 'Dépensé / budget' },
		{ id: 'anneau', label: 'Anneau' }
	];
	const BALANCE_ELEMENTS: BlockElement[] = [
		{ id: 'periodes', label: 'Choix de la période' },
		{ id: 'legende', label: 'Légende' },
		{ id: 'projection', label: 'Projection fin de mois' },
		{ id: 'reperes', label: 'Repères des grosses opérations' }
	];
	const DONUT_ELEMENTS: BlockElement[] = [
		{ id: 'legende', label: 'Liste des catégories' },
		{ id: 'total', label: 'Total au centre' }
	];
	const SAVINGS_ELEMENTS: BlockElement[] = [
		{ id: 'jauge', label: "Jauge de l'objectif" },
		{ id: 'rythme', label: 'Projection fin de mois' }
	];
	const RECENT_ELEMENTS: BlockElement[] = [
		{ id: 'date', label: 'Date' },
		{ id: 'categorie', label: 'Catégorie' },
		{ id: 'plus', label: '12 opérations au lieu de 6', default: false },
		{ id: 'lien', label: 'Lien « Tout voir »' }
	];
	const INSIGHTS_ELEMENTS: BlockElement[] = [
		{ id: 'phrases', label: "Phrases d'analyse" },
		{ id: 'courbe', label: 'Courbe du mois vs mois précédent' },
		{ id: 'rapport', label: 'Bouton « Rapport du mois »' }
	];
	const UPCOMING_ELEMENTS: BlockElement[] = [
		{ id: 'total', label: 'Total à 30 jours' },
		{ id: 'liste', label: 'Prochaines échéances' },
		{ id: 'fiabilite', label: 'Indice de fiabilité' }
	];
	const ACCOUNTS_ELEMENTS: BlockElement[] = [
		{ id: 'cashback', label: 'Cashback carte Kraken' },
		{ id: 'comptes', label: 'Résumé des comptes' }
	];
	const NOTES_ELEMENTS: BlockElement[] = [
		{ id: 'statut', label: "Heure d'enregistrement" },
		{ id: 'compteur', label: 'Nombre de mots' }
	];

	/**
	 * One-time hand-over of the former notepad collapse (`notes` section, collapsed by default): the
	 * Bloc-notes block starts stored (out of the tiles, in the « blocs rangés » chip); the section is
	 * then marked expanded.
	 */
	onMount(() => {
		if (!isSectionCollapsed('notes')) return;
		storeByDefault('dashboard', 'notes');
		toggleSectionCollapse('notes');
	});
</script>

{#if txState.loadError}
	<div class="card p-6 text-sm" style="color: var(--amber);">
		{txState.loadError} — vérifiez que <code>/data/transactions.json</code> est accessible.
	</div>
{:else if !txState.loaded}
	<!-- First load: shimmer skeletons instead of data -->
	<header class="mb-6">
		<Skeleton h={28} w={220} class="mb-2" />
		<Skeleton h={14} w={140} />
	</header>
	<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-12">
		{#each [0, 1, 2, 3] as i (i)}
			<div class="lg:col-span-3"><Skeleton h={108} rounded={8} /></div>
		{/each}
		<div class="sm:col-span-2 lg:col-span-8"><Skeleton h={310} rounded={8} /></div>
		<div class="sm:col-span-2 lg:col-span-4"><Skeleton h={310} rounded={8} /></div>
		<div class="sm:col-span-2 lg:col-span-8"><Skeleton h={310} rounded={8} /></div>
		<div class="sm:col-span-2 lg:col-span-4"><Skeleton h={310} rounded={8} /></div>
	</div>
{:else}
	<!-- Header: the month IS the title; the computed summary sentence (SPEC v12 §4) follows it directly -->
	<header class="mb-4 flex flex-wrap items-start justify-between gap-3">
		<div>
		<PageTitle title={currentMonth ? formatMonth(currentMonth) : 'Accueil'} />
		{#if currentMonth && summary}
			<p class="sommaire-phrase mt-1" aria-live="off">
				{#if summary.sober}
					Mois en cours — {summary.count} opération{summary.count > 1 ? 's' : ''}.
				{:else}
					<!-- Current month: comparison at the same day of the previous month (before: '−94 %' on the 3rd) -->
					{formatEURCompact(summary.expenses)} dépensés {summary.cutoffDay ? `au ${summary.cutoffDay}` : 'ce mois'}{#if summary.variation}{' — '}<span
							class="sommaire-var"
							style="color: {summary.variation.down ? 'var(--accent)' : 'var(--debit)'};"
							>{summary.variation.pct} % de {summary.variation.down ? 'moins' : 'plus'} {summary.cutoffDay
								? `qu'au ${summary.cutoffDay} ${summary.variation.prevMonthName}`
								: `qu'en ${summary.variation.prevMonthName}`}</span
						>{/if}{#if summary.savings !== null}{' ; '}épargne de {formatEURCompact(summary.savings)}{/if}.
				{/if}
			</p>
		{/if}
		</div>
		<div class="flex flex-wrap items-center gap-2">
			{#if months.length > 1}
				<!-- ‹ month › navigation: same selection as the Budget page -->
				<MonthNavigator {months} />
			{/if}
		</div>
	</header>

	{#if confirmed.length === 0}
		<!-- No data: a single welcome card, not an empty bento -->
		<div class="card p-6">
			<EmptyState
				icon="import"
				title="Aucune transaction pour l’instant"
				text="Importez un relevé Crédit Mutuel (CSV ou XLSX) ou Natixis (CSV) : le tableau de bord, le budget et le patrimoine se remplissent automatiquement."
				ctaLabel="Importer un relevé"
				onCta={() => (uiState.importPanelOpen = true)}
			/>
			<p class="meta-xs mt-3 text-center">
				Crypto : page <a href="/crypto" class="font-medium hover:underline" style="color: var(--accent);">Crypto</a> (clés Kraken, relevé Kraken CSV) ·
				épargne salariale : page <a href="/patrimoine" class="font-medium hover:underline" style="color: var(--accent);">Patrimoine</a> (avis Natixis PDF).
			</p>
		</div>
	{:else}
	<!-- Bento: asymmetric 12-column grid (vertical stack on mobile); every block is customisable -->
	<TileCanvas page="dashboard" defaults={DASH_BLOCKS}>
		{#each orderedIds('dashboard', DASH_BLOCKS) as id (id)}
			{#if id === 'kpi-solde'}
				<!-- Current accounts only: savings and loans are on Patrimoine -->
				<Block page="dashboard" {id} defaults={DASH_BLOCKS} title={isLatestMonth ? 'Solde actuel' : 'Solde fin de mois'} size="XS" elements={STAT_ELEMENTS} bare>
					{#snippet children(show, _size, box)}
						<div style={box ? `height: ${box.h}px;` : ''}>
							<StatCard
								fill={!!box}
								label={isLatestMonth ? 'Solde actuel' : 'Solde fin de mois'}
								value={monthStats?.balanceEnd ?? balance}
								variation={show('variation') ? monthStats?.balanceVar : undefined}
								variationLabel="sur le mois"
								hint={liquidIds ? `compte${liquidIds.size > 1 ? 's' : ''} courant${liquidIds.size > 1 ? 's' : ''}` : 'cumul des opérations'}
								sparkline={show('courbe') ? monthStats?.balanceSeries : undefined}
								stagger={0}
							/>
						</div>
					{/snippet}
				</Block>
			{:else if id === 'kpi-entrees'}
				<Block page="dashboard" {id} defaults={DASH_BLOCKS} title={cutoffDay ? `Entrées au ${cutoffDay}` : 'Entrées du mois'} size="XS" elements={STAT_ELEMENTS} bare>
					{#snippet children(show, _size, box)}
						<div style={box ? `height: ${box.h}px;` : ''}>
							<StatCard
								fill={!!box}
								label={cutoffDay ? `Entrées au ${cutoffDay}` : 'Entrées du mois'}
								value={monthStats?.income ?? 0}
								variation={show('variation') ? monthStats?.incomeVar : undefined}
								variationLabel={monthStats?.prevLabel}
								sparkline={show('courbe') ? monthStats?.incomeSeries : undefined}
								stagger={60}
							/>
						</div>
					{/snippet}
				</Block>
			{:else if id === 'kpi-sorties'}
				<Block page="dashboard" {id} defaults={DASH_BLOCKS} title={cutoffDay ? `Sorties au ${cutoffDay}` : 'Sorties du mois'} size="XS" elements={STAT_ELEMENTS} bare>
					{#snippet children(show, _size, box)}
						<div style={box ? `height: ${box.h}px;` : ''}>
							<StatCard
								fill={!!box}
								label={cutoffDay ? `Sorties au ${cutoffDay}` : 'Sorties du mois'}
								value={monthStats?.expenses ?? 0}
								variation={show('variation') ? monthStats?.expensesVar : undefined}
								variationLabel={monthStats?.prevLabel}
								favorableUp={false}
								sparkline={show('courbe') ? monthStats?.expensesSeries : undefined}
								stagger={120}
							/>
						</div>
					{/snippet}
				</Block>
			{:else if id === 'kpi-budget'}
				<!-- Budget health: % of the overall budget consumed this month -->
				<Block page="dashboard" {id} defaults={DASH_BLOCKS} title="Budget consommé" size="XS" elements={BUDGET_KPI_ELEMENTS} bare>
					{#snippet children(show, _size, box)}
						<div class="card card-lift hero-in-1 p-4" style={box ? `height: ${box.h}px;` : ''}>
							<div class="flex items-start justify-between gap-3">
								<div class="min-w-0">
									<p class="label-xs">Budget consommé</p>
									<p class="stat-amount mt-1">
										<AnimatedAmount value={health.ratio * 100} format={(v) => `${Math.round(v)} %`} />
									</p>
									{#if show('montants')}
										<p class="meta-xs mt-1">
											{formatEUR(donutTotal)} / {formatEUR(health.totalBudget)} ce mois
										</p>
									{/if}
								</div>
								{#if show('anneau')}
									<BudgetRing
										ratio={health.ratio}
										color={health.over ? 'var(--accent-2)' : 'var(--accent)'}
										size={56}
										stroke={6}
										delay={180}
										over={health.over}
									>
										{`${Math.round(health.ratio * 100)} %`}
									</BudgetRing>
								{/if}
							</div>
						</div>
					{/snippet}
				</Block>
			{:else if id === 'balance'}
				<Block page="dashboard" {id} defaults={DASH_BLOCKS} title="Évolution du solde" size="L" sizes={['M', 'L', 'XL']} elements={BALANCE_ELEMENTS} class="fade-slide" style="--stagger: 240ms;">
					{#snippet children(show, _size, box)}
						<div class="flex flex-col" style={box ? `height: ${box.h}px;` : ''}>
						<div class="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
							<h2 class="label-xs">Évolution du solde</h2>
							{#if show('periodes')}
								<div class="flex flex-wrap items-center gap-1" role="group" aria-label="Période de la courbe" use:segmented>
									{#each RANGES as r (r.key)}
										<button type="button" class="chip cursor-pointer {chartRangeKey === r.key ? 'chip-accent' : 'chip-muted'}" aria-pressed={chartRangeKey === r.key} onclick={() => setRange(r.key)}>{r.label}</button>
									{/each}
								</div>
							{/if}
							{#if show('legende')}
								<p class="meta-xs flex flex-wrap items-center gap-x-3 gap-y-0.5">
									{#if chartRange}<span>{chartRange}</span>{/if}
									{#if projection.length > 0 && show('projection')}
										<span class="flex items-center gap-1.5">
											<svg width="18" height="4" aria-hidden="true">
												<line x1="0" y1="2" x2="18" y2="2" stroke="var(--accent)" stroke-width="1.6" stroke-linecap="round" stroke-dasharray="1 5" opacity="0.65" />
											</svg>
											projection fin de mois
										</span>
									{/if}
								</p>
							{/if}
						</div>
						<div class="min-h-0 flex-1" bind:clientHeight={balanceArea}>
							<BalanceChart points={chartPoints} annotations={show('reperes') ? chartAnnotations : []} projection={show('projection') ? projection : []} height={box ? Math.max(120, balanceArea - 4) : isFullscreen('dashboard', 'balance') ? 520 : 360} />
						</div>
						</div>
					{/snippet}
				</Block>
			{:else if id === 'donut'}
				<Block page="dashboard" {id} defaults={DASH_BLOCKS} title="Dépenses du mois" size="S" sizes={['S', 'M', 'L']} elements={DONUT_ELEMENTS} class="fade-slide" style="--stagger: 300ms;">
					{#snippet children(show, _size, box)}
						<h2 class="label-xs mb-3">{donutView.title}</h2>
						{#if drilled}
							<!-- Outlined back pill (drill-down) -->
							<button
								type="button"
								class="press mb-4 inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors hover:bg-[var(--surface-hover)]"
								style="border-color: var(--border); color: var(--accent);"
								onclick={() => (drilled = null)}
							>
								← Toutes catégories
							</button>
						{/if}
						<CategoryDonut
							slices={donutView.slices}
							total={donutView.total}
							centerLabel={donutView.centerLabel}
							isSliceClickable={isDonutSliceClickable}
							onSliceClick={onDonutSliceClick}
							onCenterClick={drilled ? () => (drilled = null) : undefined}
							showLegend={show('legende')}
							showCenter={show('total')}
							diameter={box ? donutDiameter(box, show('legende')) : 180}
						/>
					{/snippet}
				</Block>
			{:else if id === 'savings'}
				<Block page="dashboard" {id} defaults={DASH_BLOCKS} title="Objectif d'épargne" size="S" sizes={['S', 'M']} elements={SAVINGS_ELEMENTS} class="hero-in-3">
					{#snippet children(show)}
						<SavingsGoalCard transactions={txOfMonth} monthKey={currentMonth} showRing={show('jauge')} showPace={show('rythme')} />
					{/snippet}
				</Block>
			{:else if id === 'recent'}
				<Block page="dashboard" {id} defaults={DASH_BLOCKS} title="Transactions récentes" size="L" sizes={['M', 'L', 'XL']} elements={RECENT_ELEMENTS} class="hero-in-3">
					{#snippet children(show)}
						<div class="mb-3 flex items-center justify-between gap-3">
							<h2 class="label-xs">Transactions récentes</h2>
							{#if show('lien')}
								<a href="/transactions" class="text-xs font-medium transition-colors hover:underline" style="color: var(--accent);">
									Tout voir
								</a>
							{/if}
						</div>
						<div class="divide-y divide-[var(--border-subtle)]">
							{#each recent.slice(0, show('plus') ? 12 : 6) as tx (txKey(tx))}
								<TransactionRow {tx} compact showDate={show('date')} showCategory={show('categorie')} />
							{/each}
						</div>
					{/snippet}
				</Block>
			{:else if id === 'insights'}
				<Block page="dashboard" {id} defaults={DASH_BLOCKS} title="Points clés du mois" size="S" sizes={['S', 'M', 'L']} elements={INSIGHTS_ELEMENTS} class="hero-in-3">
					{#snippet children(show, _size, box)}
						<h2 class="label-xs mb-3" bind:clientHeight={insightsHead}>Points clés du mois</h2>
						<InsightsCard
							transactions={confirmedBudget}
							overrides={budgetState.overrides}
							budgets={budgetState.budgets}
							monthKey={currentMonth}
							{cutoffDay}
							projection={projectionEnd}
							showList={show('phrases')}
							showChart={show('courbe')}
							showReportLink={show('rapport')}
							fill={box ? box.h - insightsHead - 12 : null}
						/>
					{/snippet}
				</Block>
			{:else if id === 'upcoming'}
				<Block page="dashboard" {id} defaults={DASH_BLOCKS} title="Échéances à venir" size="L" sizes={['M', 'L', 'XL']} elements={UPCOMING_ELEMENTS} class="hero-in-3">
					{#snippet children(show)}
						<div class="@container">
							{#await upcomingCard}
								<Skeleton h={120} rounded={8} />
							{:then { default: UpcomingCard }}
								<UpcomingCard showTotal={show('total')} showList={show('liste')} showConfidence={show('fiabilite')} />
							{/await}
						</div>
					{/snippet}
				</Block>
			{:else if id === 'comptes' && (cashback || accountsView.length > 0)}
				<Block page="dashboard" {id} defaults={DASH_BLOCKS} title="Comptes" size="S" sizes={['S', 'M']} elements={ACCOUNTS_ELEMENTS}>
					{#snippet children(show)}
						{@const withCashback = !!cashback && show('cashback')}
						{@const withAccounts = accountsView.length > 0 && show('comptes')}
						<!-- A framed tile like the others: Kraken card cashback (money earned, accent), then the accounts summary -->
						<div class="flex min-w-0 flex-col gap-3">
							{#if cashback && withCashback}
								<div class="min-w-0">
									<div class="flex items-baseline justify-between gap-2">
										<p class="label-xs truncate">Cashback carte Kraken</p>
										<a href="/patrimoine" class="shrink-0 text-xs font-medium hover:underline" style="color: var(--accent);" title="Cashback cumulé de votre carte Kraken — détail sur la page Patrimoine">Détail</a>
									</div>
									<p class="amount-md mt-1.5 truncate" style="color: var(--accent);">
										{new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 8 }).format(cashback.qty)}
										{cashback.symbol}
									</p>
									<p class="meta-xs mt-1">
										{#if cashback.eur !== undefined}
											≈ {formatEUR(cashback.eur)} au prix du jour ·
										{/if}
										{cashbackCount} dépense{cashbackCount > 1 ? 's' : ''} récompensée{cashbackCount > 1 ? 's' : ''}
									</p>
								</div>
							{/if}
							{#if withAccounts}
								<div class="min-w-0 {withCashback ? 'border-t pt-3' : ''}" style="border-color: var(--border-subtle);">
									<div class="flex items-baseline justify-between gap-2">
										<p class="label-xs">Comptes</p>
										<a href="/patrimoine" class="shrink-0 text-xs font-medium hover:underline" style="color: var(--accent);" title="Voir le détail de vos comptes">Détail</a>
									</div>
									<p class="amount-md mt-1.5">
										{accountsView.length} compte{accountsView.length > 1 ? 's' : ''}
									</p>
									<p class="meta-xs mt-1">{accountsBreakdown}</p>
									<p class="meta-xs mt-1">
										Total net : <span class="tabular" style="color: var(--text);">{formatEUR(accountsTotal)}</span>
									</p>
								</div>
							{/if}
							{#if !withCashback && !withAccounts}
								<p class="meta-xs">Rien d'affiché : clic droit sur le bloc › Éléments affichés.</p>
							{/if}
						</div>
					{/snippet}
				</Block>
			{:else if id === 'notes'}
				<Block page="dashboard" {id} defaults={DASH_BLOCKS} title="Bloc-notes" size="XL" sizes={['M', 'L', 'XL']} elements={NOTES_ELEMENTS} class="hero-in-3">
					{#snippet children(show, _size, box)}
						<!-- With a set tile height the text area fills the tile -->
						<div style={box ? `height: ${box.h}px;` : ''}>
							<NotesCard tall={isFullscreen('dashboard', 'notes')} collapsible={false} showStatus={show('statut')} showCount={show('compteur')} />
						</div>
					{/snippet}
				</Block>
			{/if}
		{/each}

	</TileCanvas>
	{/if}
{/if}

<style>
</style>
