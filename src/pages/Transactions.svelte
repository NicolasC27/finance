<script lang="ts">
	import { listLabel, merchantSearchQuery, transactionSearchText } from '$lib/merchantSearch';
	import { refundOf, refundedBy } from '$lib/refunds.svelte';
	import { shareRange } from '$lib/refunds';
	import RefundControl from '$lib/components/RefundControl.svelte';
	import { restorePoint } from '$lib/history.svelte';
	import { quickEntryStale } from '$lib/quickEntry.svelte';
	import { segmented } from '$lib/actions/segmented';
	import { flushSync, onMount, tick } from 'svelte';
	import type { CategoryId, Transaction } from '$lib/types';
	import { CATEGORIES, categorize, getCategory, isWealthMovement, txKey, VACATION_ELIGIBLE } from '$lib/categories';
	import { getSubcategory, subcategorize, subcategoriesFor } from '$lib/subcategories';
	import { budgetState, patchOverrides, setSubOverride } from '$lib/budget.svelte';
	import { ruleImpact, rulesState, setOverrideAndPrompt, withdrawPrompt } from '$lib/rules.svelte';
	import RulesCard from '$lib/components/RulesCard.svelte';
	import { getTransactions, getMerchantCategoryMap, txState, addImported, resetImported, restoreImported, deleteTransactions, restoreTransactions, deletedCount, resetDeletedTombstones, updateImported, updateImportedMany, undoQuickMatches } from '$lib/store.svelte';
	import { isComputedEntry, isPending, isPlannedInstalment, signedAmount } from '$lib/data';
	import { isBudgetFlow } from '$lib/totals';
	import { flowKind } from '$lib/flow';
	import { cleanLabel, formatDate, formatDateShort, formatEUR, formatEURCompact, formatMonth, formatPct, monthKeyOf, maskAmounts, sensitiveEUR } from '$lib/format';
	import { categoryLayout, headPage, monthBounds, monthsWithRows, pageHeads, rangeMonth, spendingShare, stepMonth, type CategoryGroup, type CategoryHead } from '$lib/categoryGroups';
	import { addTags, hasTag, removeTags, sameTags, splitTagInput, suggestTags, tagInventory, tagKey } from '$lib/tags';
	import { calendarMonth, purchaseDate, purchaseMonthRange, rangePurchases, weekdayAverages, WEEKDAY_LABELS, WEEKDAY_NAMES } from '$lib/spendingCalendar';
	import { fly } from 'svelte/transition';
	import { shiftMonthKey } from '$lib/insights';
	import { todayIso } from '$lib/forecast';
	import { accountOf } from '$lib/scope';
	import { merchantKey, merchantLabel } from '$lib/merchant';
	import {
		isExcluded,
		isInternal,
		internalCount,
		excludeKeys,
		includeKeys,
		reviewTransfers,
		countExcludedAmong,
		getListedTransactions
	} from '$lib/transfers.svelte';
	import { syncLoans } from '$lib/loans.svelte';
	import { parseCreditMutuelText, accountFromFileName } from '$lib/csvCreditMutuel';
	import { parseNatixisText, detectCsvFormat } from '$lib/csvNatixis';
	import { parseKrakenLedgerText, matchesKrakenLedgerHeader, isInternalKrakenMovement, entryToTransaction } from '$lib/csvKraken';
	import { mergeKrakenLedger } from '$lib/krakenLedger.svelte';
	import { decodeCsv, detectDelimiter, tokenize } from '$lib/csvCore';
	import { guessMapping, savePreset, type CsvImportResult, type ImportPreset } from '$lib/importMapper';
	import { parseCreditMutuelXlsx } from '$lib/xlsxCreditMutuel';
	import { parseStatement, skipKnownMovements, STATEMENT_LABELS, type StatementResult } from '$lib/statements';
	import { parseKrakStatementPdf, KRAK_ACCOUNT_ID } from '$lib/pdfKrak';
	import { saveKrakMonth } from '$lib/krakCard.svelte';
	import { parseNatixisPdf } from '$lib/pdfNatixis';
	import { applyNatixisPdfResult } from '$lib/natixisHoldings.svelte';
	import { parseTaxNoticePdf } from '$lib/pdfTax';
	import { saveTaxNotice } from '$lib/taxes.svelte';
	import { importsState, recordImport, getImportReminders, SOURCE_LABELS, type ImportSource } from '$lib/importsLog.svelte';
	import { parseXlsx } from '$lib/xlsxCore';
	import { registerAccounts, registerCsvAccount, accountLabel, accountKind, KIND_LABELS } from '$lib/accounts.svelte';
	import { uiState, showToast, showSuccess } from '$lib/ui.svelte';
	import { assetsState, assetOfTx, attachTx, detachTx, addAsset } from '$lib/assets.svelte';
	import { noteOfTx } from '$lib/portage.svelte';
	import { cashItemOf, isWalletWithdrawal, removeCashItem, setCashSpendCategory } from '$lib/wallet.svelte';
	import { WRITE_OFF_LABEL } from '$lib/wallet';
	import { navigate, pageSnapshot } from '$lib/router.svelte';
	import ImportMapperModal, { type MapperSource } from '$lib/components/ImportMapperModal.svelte';
	import MerchantMark from '$lib/components/MerchantMark.svelte';
	import CategoryMark from '$lib/components/CategoryMark.svelte';
	import InstalmentChip from '$lib/components/InstalmentChip.svelte';
	import MerchantHistory from '$lib/components/MerchantHistory.svelte';
	import { datesSentence, dayDate, fileTarget, merchantHistory, type DateState } from '$lib/operationDetail';
	import { edgeScrollStep, LONG_PRESS, paintRange, TOUCH_SLOP } from '$lib/dragSelect';
	import RowsToggle from '$lib/components/RowsToggle.svelte';
	import QuickEntryRow from '$lib/components/QuickEntryRow.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import PageTitle from '$lib/components/PageTitle.svelte';
	import DateRangePicker from '$lib/components/DateRangePicker.svelte';
	import { matchesAmazonHeader } from '$lib/amazonOrders';
	import { applyAmazonImport, applyAmazonOrders, amazonMatchFor, type AmazonApplySummary } from '$lib/amazon.svelte';
	import { isZip } from '$lib/unzip';
	import { isAmazonArchive, readAmazonArchive } from '$lib/amazonArchive';
	import { vacationState, assignedVacation, assignVacation, isDetached, vacationOf, vacationFor, addVacation, removeVacation, type VacationPeriod } from '$lib/vacations.svelte';
	import { orderRange, rangeLabel, suggestVacationLabel } from '$lib/rangeCalendar';
	import { closeContextMenu, contextActions, SEPARATOR, type MenuAction, type MenuInput } from '$lib/contextMenu.svelte';
	import { isMenuKey } from '$lib/contextMenuModel';

	/**
	 * Transactions page: full table, multi-account CSV/XLSX import, combinable filters. Right click
	 * (or a long press of a finger, or the Menu key on a focused row) on a row, a category header or
	 * the list opens their actions (rowActions, headActions, listActions).
	 */

	const PAGE_SIZE = 50;

	// ---- Filters ----
	let searchInput = $state('');
	let search = $state(''); // debounced version (150 ms)
	let categoryFilter = $state<'' | CategoryId>('');
	let typeFilter = $state<'all' | 'CRDT' | 'DBIT'>('all');
	/** Date range (inclusive ISO bounds, '' = open): replaces the old per-month filter. */
	let dateFrom = $state('');
	let dateTo = $state('');
	/** Amount bounds (absolute value), from the palette ('> 200'). */
	let minAmount = $state<number | null>(null);
	let maxAmount = $state<number | null>(null);
	/**
	 * Holiday period opened from Budget: operations of the period + 5 days of bank latency; those
	 * outside Vacances are flagged 'à vérifier'.
	 */
	let vacationFilter = $state<VacationPeriod | null>(null);
	/**
	 * Status of a row in holiday mode: within the period (reclassified), or booked afterwards and to
	 * check. A small INSTANT transfer (or Wero) from an individual during the period is a likely
	 * refund from a friend, so it is offered as Vacances (before, any 'VIR' income was offered, the
	 * salary included). 'À vérifier' only applies to variable spending that holidays can absorb (not
	 * rent, energy or subscriptions, not a wealth movement).
	 */
	function vacationStatus(tx: Transaction): 'in' | 'check' | 'refund' | null {
		const p = vacationFilter;
		if (!p) return null;
		const cat = categorize(tx, budgetState.overrides, undefined, getMerchantCategoryMap());
		if (cat === 'vacances') return vacationOf(tx)?.id === p.id ? 'in' : null;
		const label = tx.remittance_information.join(' ');
		if (signedAmount(tx) > 0) return cat === 'revenus' && /\b(VIR INST|WERO)\b/i.test(label) && signedAmount(tx) <= 500 ? 'refund' : null;
		if (!VACATION_ELIGIBLE.has(cat) || isWealthMovement(tx)) return null;
		return 'check';
	}
	/** Subcategory: undefined = no filter, null = 'no subcategory' (Autres bucket). */
	let subFilter = $state<string | null | undefined>(undefined);
	/** 'Virements internes' filter (SPEC v13 §C.3): shows only those. */
	let internalOnly = $state(false);
	/** Tag filter (selector or click on a chip): null = none. */
	let tagFilter = $state<string | null>(null);
	/** Account filter ('' = all). */
	let accountFilter = $state('');
	/** PURCHASE day chosen in the calendar ('' = none): takes precedence over the period. */
	let dayFilter = $state('');
	/** Last purchase day of a range slid on the calendar ('' = the single day `dayFilter`). */
	let dayTo = $state('');
	/** Page view: operation list or spending calendar. */
	let view = $state<'liste' | 'calendrier'>('liste');
	const VIEWS = [
		{ id: 'liste', label: 'Liste', title: 'Toutes les opérations' },
		{ id: 'calendrier', label: 'Calendrier', title: 'Dépenses jour par jour, à la date d’achat' }
	] as const;
	/** List grouping switch: the date sort or the category mode (setGrouping); the short label keeps it on one line with the views on a phone. */
	const GROUPINGS = [
		{ id: 'date', label: 'Par date', short: 'Date', title: 'Opérations de la plus récente à la plus ancienne' },
		{ id: 'category', label: 'Par catégorie', short: 'Catégorie', title: 'Une ligne par catégorie sur un mois, la plus grosse dépense d’abord : cliquer une catégorie la déplie' }
	] as const;
	/** Selection mode (bulk edit) and checked txKey keys (reassigned: reactivity). */
	let selectMode = $state(false);
	let selected = $state<Set<string>>(new Set());
	/** Last checked row (index in the page): Shift+click checks the range. */
	let lastToggled = -1;

	// Full-text search debounce (150 ms)
	$effect(() => {
		const value = searchInput;
		const id = window.setTimeout(() => (search = value), 150);
		return () => window.clearTimeout(id);
	});

	// ---- Sorting ----
	type SortKey = 'date' | 'debit' | 'credit' | 'category';
	let sortKey = $state<SortKey>('date');
	let sortDir = $state<'asc' | 'desc'>('desc');
	/** Categories folded in the « Catégorie » sort: only their header shows (reassigned: reactivity). */
	let foldedCats = $state<Set<CategoryId>>(new Set());
	/** Every category: folding them all also folds those a later month or filter brings in. */
	const ALL_CATS: readonly CategoryId[] = CATEGORIES.map((c) => c.id);

	/** Column header: the same key flips the direction, another one starts descending (the category mode opens folded). */
	function toggleSort(key: SortKey) {
		if (sortKey === key) {
			sortDir = sortDir === 'desc' ? 'asc' : 'desc';
		} else if (key === 'category') {
			setGrouping('category');
		} else {
			sortKey = key;
			sortDir = 'desc';
		}
	}

	/**
	 * « Par date » or « Par catégorie » (toolbar switch, column header, row menu). The category mode
	 * opens as a summary, every category folded, on the latest month with operations under the other
	 * filters when no period is chosen; back to the date sort, the period stays. A restored page never
	 * comes through here, so its folds are kept.
	 */
	function setGrouping(mode: 'date' | 'category') {
		if (mode === 'date') {
			sortKey = 'date';
			sortDir = 'desc';
			return;
		}
		if (sortKey === 'category') return;
		sortKey = 'category';
		sortDir = 'desc';
		foldedCats = new Set(ALL_CATS);
		cursor = -1;
		lastToggled = -1;
		if (dateFrom || dateTo || dayFilter || vacationFilter) return;
		const latest = periodMonths.at(-1);
		if (latest) setMonth(latest);
	}

	// ---- Pagination ----
	let page = $state(1);

	// ---- Expanded detail ----
	let expandedKey = $state<string | null>(null);

	/** Months present in the data (period picker shortcuts). */
	/** Bank operations + computed portage and cash wallet entries: same totals as the budget. */
	const allTxs = $derived(getListedTransactions());

	const months = $derived(
		[...new Set(allTxs.filter((tx) => !isPending(tx)).map((tx) => monthKeyOf(tx.booking_date)))].sort()
	);

	/** Account of an operation (scope.ts); '' for a computed entry, outside any account. */
	function accountIdOf(tx: Transaction): string {
		return isComputedEntry(tx) ? '' : accountOf(tx);
	}

	/** Accounts present in the data (selector shown from 2 on). */
	const accountOptions = $derived.by(() => {
		const ids = new Set<string>();
		for (const tx of allTxs) {
			const id = accountIdOf(tx);
			if (id) ids.add(id);
		}
		return [...ids].map((id) => ({ id, label: accountLabel(id) })).sort((a, b) => a.label.localeCompare(b.label, 'fr'));
	});

	/** Existing tags, most frequent first (selector, autocompletion). */
	const tagCounts = $derived(tagInventory(allTxs));

	/**
	 * Active filters (combinable). `forCalendar`: the calendar moves month by month, so the chosen
	 * period and day do not apply to it (except in holiday mode, defined by its period). In holiday
	 * mode an operation attached to this period shows whatever its date, and one attached to another
	 * period is excluded; a period view never shows Kraken/Natixis rows, transfers to one's own
	 * accounts or hidden operations. A purchase day chosen in the calendar overrides the period (a
	 * purchase on 30/09 booked on 02/10 would fall outside a 'September' filter).
	 */
	function matchesFilters(tx: Transaction, q: string, forCalendar = false): boolean {
		if (internalOnly && !isInternal(txKey(tx))) return false;
		if (typeFilter !== 'all' && tx.credit_debit_indicator !== typeFilter) return false;
		if (accountFilter && accountIdOf(tx) !== accountFilter) return false;
		if (tagFilter !== null && !hasTag(tx.tags, tagFilter)) return false;
		if (categoryFilter && categorize(tx, budgetState.overrides, undefined, getMerchantCategoryMap()) !== categoryFilter) return false;
		if (subFilter !== undefined && subcategorize(tx, budgetState.overrides, undefined, getMerchantCategoryMap()) !== subFilter) return false;
		const assigned = vacationFilter ? assignedVacation(tx) : null;
		if (vacationFilter && assigned && assigned.id !== vacationFilter.id) return false;
		if (vacationFilter && !assigned && (isWealthMovement(tx) || isExcluded(txKey(tx)))) return false;
		if (dayFilter && !forCalendar) {
			const bought = purchaseDate(tx);
			if (dayTo ? bought < dayFilter || bought > dayTo : bought !== dayFilter) return false;
		} else if (!assigned && (!forCalendar || vacationFilter)) {
			if (dateFrom && tx.booking_date < dateFrom) return false;
			if (dateTo && tx.booking_date > dateTo) return false;
		}
		if (minAmount !== null && Math.abs(signedAmount(tx)) < minAmount) return false;
		if (maxAmount !== null && Math.abs(signedAmount(tx)) > maxAmount) return false;
		if (q && !transactionSearchText(tx).includes(q)) return false;
		return true;
	}

	/** Filtered results (reactive, combinable filters). */
	const filtered = $derived.by(() => {
		const q = search.trim().toLowerCase();
		return allTxs.filter((tx) => matchesFilters(tx, q));
	});

	// ---- Spending calendar, at the purchase date ----
	const catOfTx = (tx: Transaction): CategoryId => categorize(tx, budgetState.overrides, undefined, getMerchantCategoryMap());

	/**
	 * Calendar operations: active filters except period and day, without the operations hidden from
	 * the budget.
	 */
	const calendarTxs = $derived.by(() => {
		if (view !== 'calendrier') return [];
		const q = search.trim().toLowerCase();
		return allTxs.filter((tx) => !isExcluded(txKey(tx)) && matchesFilters(tx, q, true));
	});
	/** Category of each calendar operation: computed once per change, not once per derived view. */
	const calendarCats = $derived.by(() => {
		const overrides = budgetState.overrides;
		const mm = getMerchantCategoryMap();
		return new Map(calendarTxs.map((tx) => [tx, categorize(tx, overrides, undefined, mm)] as const));
	});
	const catOfCal = (tx: Transaction): CategoryId => calendarCats.get(tx) ?? catOfTx(tx);
	const calendarRange = $derived(purchaseMonthRange(calendarTxs, catOfCal));
	let calMonth = $state('');
	// Displayed month: the one of the chosen day or period, otherwise the latest month with purchases
	// (once the operations are loaded: a month restored by a reload is checked against all of them)
	$effect(() => {
		const r = calendarRange;
		if (!r || !txState.loaded || (calMonth && calMonth >= r.first && calMonth <= r.last)) return;
		const wanted = (dayFilter || dateTo || dateFrom).slice(0, 7);
		calMonth = wanted && wanted >= r.first && wanted <= r.last ? wanted : r.last;
	});
	const calendar = $derived(calMonth && calendarRange ? calendarMonth(calendarTxs, calMonth, catOfCal) : null);

	/** Data bounds (purchase dates): the weekday average does not count future days at 0 €. */
	const dataBounds = $derived.by(() => {
		if (view !== 'calendrier') return { first: '', last: '' };
		let first = '';
		let last = '';
		for (const tx of allTxs) {
			const d = purchaseDate(tx);
			if (!d || isPlannedInstalment(tx)) continue;
			if (!first || d < first) first = d;
			if (d > last) last = d;
		}
		return { first, last };
	});
	/** Period of the weekday average: the filtered period, limited to the data. */
	const weekdayRange = $derived({
		from: dateFrom && dateFrom > dataBounds.first ? dateFrom : dataBounds.first,
		to: dateTo && dateTo < dataBounds.last ? dateTo : dataBounds.last
	});
	const weekdays = $derived(view === 'calendrier' ? weekdayAverages(calendarTxs, catOfCal, weekdayRange.from, weekdayRange.to) : []);
	const weekdayMax = $derived(Math.max(0, ...weekdays.map((w) => w.average)));
	const weekdayPeriod = $derived(weekdayRange.from && weekdayRange.to ? `du ${formatDate(weekdayRange.from)} au ${formatDate(weekdayRange.to)}` : '');
	const today = todayIso();
	/** Highest-spending weekday (null without spending). */
	const bestWeekday = $derived(weekdayMax > 0 ? (weekdays.find((w) => w.average === weekdayMax) ?? null) : null);
	/** Largest day of the displayed month. */
	const peakDay = $derived(calendar && calendar.max > 0 ? (calendar.days.find((d) => d.spend === calendar.max) ?? null) : null);

	/**
	 * Intensity of a cell: square root of the share of the maximum (one big day does not crush the
	 * others).
	 */
	function dayFill(spend: number, max: number): number {
		if (spend <= 0 || max <= 0) return 0;
		return Math.round(8 + 42 * Math.sqrt(spend / max));
	}

	/** Previous / next calendar month, limited to months with purchases. */
	function shiftCalMonth(delta: number) {
		const r = calendarRange;
		if (!r || !calMonth) return;
		const next = shiftMonthKey(calMonth, delta);
		if (next >= r.first && next <= r.last) calMonth = next;
	}

	/** Purchase days listed in the calendar's side panel (null: the month statistics). */
	let calPanel = $state<{ from: string; to: string } | null>(null);
	/** Operation unfolded in the side panel (txKey), null when none. */
	let calOpenKey = $state<string | null>(null);
	let calPanelEl = $state<HTMLElement | null>(null);
	const calPanelData = $derived(calPanel && view === 'calendrier' ? rangePurchases(calendarTxs, calPanel.from, calPanel.to, catOfCal) : null);
	const calPanelLabel = $derived(calPanel ? (calPanel.from === calPanel.to ? formatDate(calPanel.from) : rangeLabel(calPanel.from, calPanel.to)) : '');
	/** Visitor asked for reduced motion: the side panel appears without sliding. */
	const reduceMotion = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

	/**
	 * Purchase days (one day or a slid range) in the side panel next to the calendar, which stays
	 * usable: another day or slide updates the panel, changing month keeps it. Under `lg` the panel
	 * sits below the grid, so it is scrolled into view.
	 */
	function showDays(from: string, to: string) {
		const [start, end] = orderRange(from, to);
		calPanel = { from: start, to: end };
		calOpenKey = null;
		if (typeof window !== 'undefined' && !window.matchMedia('(min-width: 1024px)').matches) {
			requestAnimationFrame(() => calPanelEl?.scrollIntoView({ block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' }));
		}
	}

	/** Back to the month statistics; from the × button, focus returns to the first chosen day. */
	function closeDays(refocus = false) {
		const first = calPanel?.from ?? '';
		calPanel = null;
		calOpenKey = null;
		if (refocus && first) requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-cal-date="${first}"]`)?.focus());
	}

	/** The list, filtered on the panel's purchase days (its chip removes the filter). */
	function listDays() {
		if (!calPanel) return;
		dayFilter = calPanel.from;
		dayTo = calPanel.to === calPanel.from ? '' : calPanel.to;
		view = 'liste';
	}

	/** One operation of the panel in the list, unfolded there with its full detail and edits (its category unfolded in the category mode). */
	function openInList(tx: Transaction) {
		dayFilter = purchaseDate(tx);
		dayTo = '';
		view = 'liste';
		expandedKey = txKey(tx);
		unfold(catOfTx(tx));
	}

	/** Range being slid on the spending calendar (first day pressed, day under the pointer). */
	let calAnchor = $state<string | null>(null);
	let calHover = $state<string | null>(null);
	let calMoved = false;
	let calSkipClick = false;
	let calNavTimer: ReturnType<typeof setTimeout> | null = null;
	let calNavDir = 0;
	const calSlide = $derived(calAnchor ? orderRange(calAnchor, calHover ?? calAnchor) : null);

	/** Day cell under a viewport point, '' when none. */
	function calDayAt(x: number, y: number): string {
		return document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-cal-date]')?.dataset.calDate ?? '';
	}

	/** While a slide rests on a month arrow, the calendar turns a month every ~500 ms. */
	function calArmNav(dir: number) {
		if (dir === calNavDir) return;
		if (calNavTimer) clearTimeout(calNavTimer);
		calNavTimer = null;
		calNavDir = dir;
		if (!dir) return;
		const turn = () => {
			shiftCalMonth(dir);
			calNavTimer = setTimeout(turn, 500);
		};
		calNavTimer = setTimeout(turn, 500);
	}

	/**
	 * Press on a day of the calendar: starts a slide followed on the window (release anywhere). It
	 * also clears a click skip left by a slide that ended on another day (no click followed it).
	 */
	function calPointerDown(e: PointerEvent, date: string) {
		if (e.button !== 0) return;
		calSkipClick = false;
		calAnchor = date;
		calHover = date;
		calMoved = false;
		window.addEventListener('pointermove', calPointerMove);
		window.addEventListener('pointerup', calPointerUp);
		window.addEventListener('pointercancel', calPointerEnd);
	}

	function calPointerMove(e: PointerEvent) {
		const nav = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLButtonElement>('[data-cal-nav]');
		calArmNav(nav && !nav.disabled ? Number(nav.dataset.calNav) : 0);
		const date = calDayAt(e.clientX, e.clientY);
		if (date && date !== calHover) {
			calHover = date;
			calMoved = true;
		}
	}

	function calPointerEnd() {
		calArmNav(0);
		window.removeEventListener('pointermove', calPointerMove);
		window.removeEventListener('pointerup', calPointerUp);
		window.removeEventListener('pointercancel', calPointerEnd);
		calAnchor = null;
		calHover = null;
	}

	/** Release after sliding over several days: the side panel lists that range of purchase days. */
	function calPointerUp() {
		const range = calMoved ? calSlide : null;
		calPointerEnd();
		if (!range) return;
		calSkipClick = true;
		showDays(range[0], range[1]);
	}

	/** A click ends a slide (ignored) or shows that day in the side panel, even without purchase. */
	function calClick(date: string) {
		if (calSkipClick) {
			calSkipClick = false;
			return;
		}
		showDays(date, date);
	}

	/** Vacation period over purchase days (one day or a range), undoable from the toast. */
	function vacationFrom(from: string, to: string) {
		const p = addVacation(suggestVacationLabel(from), from, to || from);
		showToast(`Période « ${p.label} » créée (${rangeLabel(p.start, p.end)}) : ses dépenses passent en Vacances`, 'Annuler', () => removeVacation(p.id));
	}

	/** Vacation period over the purchase days filtered in the list. */
	function vacationFromDays() {
		if (dayFilter) vacationFrom(dayFilter, dayTo || dayFilter);
	}

	function showView(next: 'liste' | 'calendrier') {
		view = next;
		if (next === 'calendrier') exitSelect();
	}

	/**
	 * Sort value of a Débit/Crédit column: |amount| when the row has a value in this column, null
	 * otherwise (the row is 'empty' for this column and must always go last, whatever the direction).
	 */
	function columnSortValue(tx: Transaction, key: 'debit' | 'credit'): number | null {
		const want = key === 'debit' ? 'DBIT' : 'CRDT';
		return tx.credit_debit_indicator === want ? Math.abs(signedAmount(tx)) : null;
	}

	/**
	 * « Catégorie » sort (categoryGroups.ts): rows grouped under the category they display, counted
	 * like the page totals, folded categories left out; null under the other sorts.
	 */
	const categoryView = $derived.by(() => (sortKey === 'category' ? categoryLayout(filtered, catOfTx, countedFlow, sortDir, foldedCats) : null));

	/**
	 * Category mode: months with a dated operation under every filter but the period and the purchase
	 * day, oldest first; none in holiday mode, whose period is the holiday's (the stepper is hidden).
	 */
	const periodMonths = $derived.by(() => {
		if (sortKey !== 'category' || vacationFilter) return [];
		const q = search.trim().toLowerCase();
		return monthsWithRows(allTxs.filter((tx) => matchesFilters(tx, q, true)));
	});
	/** Month the period picker covers exactly ('' for the whole period or any other range); a purchase day overrides it. */
	const periodMonth = $derived(dayFilter ? '' : rangeMonth(dateFrom, dateTo));
	/** Month the stepper shows: the chosen one, else the month the range ends in, else the latest with operations. */
	const stepperMonth = $derived(periodMonth || monthKeyOf(dayFilter || dateTo || dateFrom) || (periodMonths.at(-1) ?? ''));
	const prevMonth = $derived(stepMonth(periodMonths, stepperMonth, -1));
	const nextMonth = $derived(stepMonth(periodMonths, stepperMonth, 1));
	/** No date bound and no purchase day: « Toute la période ». */
	const wholePeriod = $derived(!dateFrom && !dateTo && !dayFilter);

	/** Period of one whole month, written in the period picker (a purchase-day filter gives way). */
	function setMonth(key: string) {
		[dateFrom, dateTo] = monthBounds(key);
		dayFilter = '';
		dayTo = '';
	}

	/** Previous or next month with operations under the other filters; false past either end. */
	function stepPeriod(delta: number): boolean {
		const next = delta < 0 ? prevMonth : nextMonth;
		if (!next) return false;
		setMonth(next);
		return true;
	}

	/** « Toute la période »: no date bound, no purchase day. */
	function clearPeriod() {
		dateFrom = '';
		dateTo = '';
		dayFilter = '';
		dayTo = '';
	}

	/**
	 * Sorting: date (desc by default), debit/credit (absolute value) or category (grouped, see
	 * categoryView); pending rows and empty cells last, except the expected instalments of a payment
	 * in several times, sorted by their date.
	 */
	const sorted = $derived.by(() => {
		if (categoryView) return categoryView.rows;
		const dir = sortDir === 'asc' ? 1 : -1;
		const last = (tx: Transaction) => isPending(tx) && !isPlannedInstalment(tx);
		return [...filtered].sort((a, b) => {
			if (last(a) !== last(b)) return last(a) ? 1 : -1;
			if (sortKey !== 'debit' && sortKey !== 'credit') return a.booking_date.localeCompare(b.booking_date) * dir;
			const va = columnSortValue(a, sortKey);
			const vb = columnSortValue(b, sortKey);
			if (va === null || vb === null) return va === null ? (vb === null ? 0 : 1) : -1;
			return (va - vb) * dir;
		});
	});

	const pageCount = $derived(Math.max(1, Math.ceil(sorted.length / PAGE_SIZE)));
	const paginated = $derived(sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE));
	/**
	 * Category headers of the page, outside `paginated`: row indexes (cursor, slide, Shift+click)
	 * only count operations, and a header is never selectable.
	 */
	const catHeads = $derived(categoryView ? pageHeads(categoryView, (page - 1) * PAGE_SIZE, (page - 1) * PAGE_SIZE + paginated.length) : null);

	/**
	 * Merchant history of the operation whose detail is open (on the page shown), computed once for
	 * its table row and its phone card. `fileable` when its hint may file it like the others: a bank
	 * operation whose category can change, most of its merchant's operations filed elsewhere and a
	 * merchant key naming one merchant (the scan of every operation this takes runs only then).
	 */
	const openHistory = $derived.by(() => {
		const tx = expandedKey === null ? undefined : paginated.find((t) => txKey(t) === expandedKey);
		if (!tx || tx.source === 'portage') return null;
		const history = merchantHistory(tx, allTxs, catOfTx);
		const fileable = !!history && fileTarget(history) !== null && !isComputedEntry(tx) && categorySetter(tx) !== null && !ruleImpact(tx)?.generic;
		return { key: txKey(tx), history, fileable };
	});

	// Optional columns: shown only when at least one row of the page fills them (otherwise 3 columns
	// of '—'; the row detail keeps all the information)
	const hasTags = $derived(paginated.some((tx) => (tx.tags?.length ?? 0) > 0));
	const hasChecked = $derived(paginated.some((tx) => tx.checked));
	const hasBalance = $derived(paginated.some((tx) => tx.balance_after !== undefined));
	const colCount = $derived(7 + (hasTags ? 1 : 0) + (hasChecked ? 1 : 0) + (hasBalance ? 1 : 0) + (selectMode ? 1 : 0));

	// Back to page 1 when the FILTERS or the sort change, no longer when the row count moves (a
	// deletion or recategorisation on page 4 sent you back to page 1); a page restored by Back,
	// Forward or a reload survives the first run. The keyboard cursor, an index in the old list, is
	// dropped (a right click then « Filtrer sur cette catégorie » left M or X on another operation)
	let keepRestoredPage = false;
	$effect(() => {
		[search, categoryFilter, typeFilter, dateFrom, dateTo, minAmount, maxAmount, subFilter, vacationFilter, internalOnly, tagFilter, accountFilter, dayFilter, dayTo, sortKey, sortDir];
		cursor = -1;
		if (keepRestoredPage) keepRestoredPage = false;
		else page = 1;
	});
	// Fewer pages (deletions): stay on a page that exists, once the operations are loaded (a reload
	// keeps the restored page instead of page 1 of a list still empty)
	$effect(() => {
		if (txState.loaded && page > pageCount) page = pageCount;
	});

	/** True when a restored value is one of `options` (the snapshot may come from an older version of the page). */
	function isOneOf<T extends string>(value: unknown, options: readonly T[]): value is T {
		return options.includes(value as T);
	}

	/**
	 * Back, Forward and a reload give the list back as it was left: search, filters, view, sort, folded
	 * categories, page, open row, calendar month and chosen days. Selection, drafts and imports start
	 * over; a filter asked by another page (uiState.txFilter) is applied after the restore and wins.
	 */
	pageSnapshot(
		'transactions',
		() => ({
			search: searchInput,
			categoryFilter,
			typeFilter,
			dateFrom,
			dateTo,
			minAmount,
			maxAmount,
			vacationId: vacationFilter?.id ?? null,
			subFilter,
			internalOnly,
			tagFilter,
			accountFilter,
			dayFilter,
			dayTo,
			view,
			sortKey,
			sortDir,
			foldedCats: [...foldedCats],
			page,
			expandedKey,
			calMonth,
			calFrom: calPanel?.from ?? '',
			calTo: calPanel?.to ?? '',
			calOpenKey
		}),
		(saved: Record<string, unknown>) => {
			if (typeof saved.search === 'string') searchInput = search = saved.search;
			if (saved.categoryFilter === '' || isOneOf(saved.categoryFilter, CATEGORIES.map((c) => c.id))) categoryFilter = saved.categoryFilter;
			if (isOneOf(saved.typeFilter, ['all', 'CRDT', 'DBIT'])) typeFilter = saved.typeFilter;
			if (typeof saved.dateFrom === 'string') dateFrom = saved.dateFrom;
			if (typeof saved.dateTo === 'string') dateTo = saved.dateTo;
			if (saved.minAmount === null || typeof saved.minAmount === 'number') minAmount = saved.minAmount;
			if (saved.maxAmount === null || typeof saved.maxAmount === 'number') maxAmount = saved.maxAmount;
			if (typeof saved.vacationId === 'string') vacationFilter = vacationState.periods.find((p) => p.id === saved.vacationId) ?? null;
			if (saved.subFilter === null || typeof saved.subFilter === 'string') subFilter = saved.subFilter;
			if (typeof saved.internalOnly === 'boolean') internalOnly = saved.internalOnly;
			if (saved.tagFilter === null || typeof saved.tagFilter === 'string') tagFilter = saved.tagFilter;
			if (typeof saved.accountFilter === 'string') accountFilter = saved.accountFilter;
			if (typeof saved.dayFilter === 'string') dayFilter = saved.dayFilter;
			if (typeof saved.dayTo === 'string') dayTo = saved.dayTo;
			if (isOneOf(saved.view, VIEWS.map((v) => v.id))) view = saved.view;
			if (isOneOf(saved.sortKey, ['date', 'debit', 'credit', 'category'])) sortKey = saved.sortKey;
			if (isOneOf(saved.sortDir, ['asc', 'desc'])) sortDir = saved.sortDir;
			if (Array.isArray(saved.foldedCats)) foldedCats = new Set(saved.foldedCats.filter((id): id is CategoryId => isOneOf(id, CATEGORIES.map((c) => c.id))));
			if (typeof saved.page === 'number' && Number.isInteger(saved.page) && saved.page >= 1) {
				page = saved.page;
				keepRestoredPage = true;
			}
			if (saved.expandedKey === null || typeof saved.expandedKey === 'string') expandedKey = saved.expandedKey;
			if (typeof saved.calMonth === 'string') calMonth = saved.calMonth;
			if (typeof saved.calFrom === 'string' && typeof saved.calTo === 'string' && saved.calFrom) calPanel = { from: saved.calFrom, to: saved.calTo || saved.calFrom };
			if (saved.calOpenKey === null || typeof saved.calOpenKey === 'string') calOpenKey = saved.calOpenKey;
		}
	);

	/**
	 * Selection totals, same convention as the budget (totals.ts): income and spending per category,
	 * excluding hidden transfers, wealth rows, savings and pending operations. Before, raw flows were
	 * summed (inflated 'entrées', a cheque deposited twice included).
	 */
	const totals = $derived.by(() => {
		let credit = 0;
		let debit = 0;
		for (const tx of filtered) {
			if (!isBudgetFlow(tx) || isExcluded(txKey(tx))) continue;
			const kind = flowKind(categorize(tx, budgetState.overrides, undefined, getMerchantCategoryMap()));
			if (kind === 'income') credit += signedAmount(tx);
			else if (kind === 'expense') debit -= signedAmount(tx);
		}
		return { credit: Math.round(credit * 100) / 100, debit: Math.round(debit * 100) / 100 };
	});

	const filtersActive = $derived(
		searchInput.trim() !== '' || categoryFilter !== '' || typeFilter !== 'all' || dateFrom !== '' || dateTo !== '' || minAmount !== null || maxAmount !== null || subFilter !== undefined || vacationFilter !== null || internalOnly || tagFilter !== null || accountFilter !== '' || dayFilter !== ''
	);

	/** Direct category change ('à vérifier' chip). */
	function onCategoryChangeDirect(tx: Transaction, categoryId: CategoryId) {
		setOverrideAndPrompt(tx, categoryId);
	}

	function resetFilters() {
		searchInput = '';
		categoryFilter = '';
		typeFilter = 'all';
		dateFrom = '';
		dateTo = '';
		minAmount = null;
		maxAmount = null;
		subFilter = undefined;
		vacationFilter = null;
		internalOnly = false;
		tagFilter = null;
		accountFilter = '';
		dayFilter = '';
		dayTo = '';
		calPanel = null;
		calOpenKey = null;
	}

	/**
	 * Click on a tag chip: every operation with this tag (and their total at the top of the page).
	 * Uses the inventory spelling, so clicking 'Travaux' still matches 'travaux' in the selector.
	 */
	function filterByTag(tag: string) {
		tagFilter = tagCounts.find((t) => tagKey(t.tag) === tagKey(tag))?.tag ?? tag;
		view = 'liste';
	}

	// ---- Bulk edit ----

	/** Computed entries (portage, cash wallet): edited at their source, never in bulk. */
	function selectable(tx: Transaction): boolean {
		return !isComputedEntry(tx);
	}

	function exitSelect() {
		endDrag();
		selectMode = false;
		selected = new Set();
		lastToggled = -1;
	}

	/** Checks/unchecks a row of the page; Shift+click: the whole range from the previous one. */
	function toggleSelected(tx: Transaction, index: number, range = false) {
		if (!selectable(tx)) return;
		enterSelect(visibleRow(index));
		const next = new Set(selected);
		const key = txKey(tx);
		const on = !next.has(key);
		const rangeRows = range && lastToggled >= 0 && lastToggled !== index ? paginated.slice(Math.min(lastToggled, index), Math.max(lastToggled, index) + 1) : [tx];
		for (const t of rangeRows) {
			if (!selectable(t)) continue;
			if (on) next.add(txKey(t));
			else next.delete(txKey(t));
		}
		selected = next;
		lastToggled = index;
	}

	// ---- Press and slide (mouse: a few pixels onto another row; touch and pen: held still, then moved; held on, the row menu opens and the slide closes it) ----

	interface Drag {
		pointerId: number;
		start: number;
		/** Row pressed: kept under the pointer when the selection bar appears above the list. */
		el: HTMLElement;
		/** Page rows at the press: a page turn, a sort or a filter ends the slide. */
		keys: string;
		on: boolean;
		/** Selection and selection mode before the slide: Escape gives them back. */
		base: Set<string>;
		wasSelecting: boolean;
		active: boolean;
		touch: boolean;
		/** Finger or pen held still for LONG_PRESS: moving now selects instead of scrolling. */
		armed: boolean;
		last: number;
		x0: number;
		y0: number;
		x: number;
		y: number;
		timer: number;
	}
	let drag: Drag | null = null;
	let swallowClick = false;
	let scrollFrame = 0;

	const pageKeys = $derived(paginated.map((tx) => (selectable(tx) ? txKey(tx) : null)));
	const pageSignature = () => pageKeys.join('|');

	/** Row under a point (clamped inside the window), through what floats above the list (phone tab bar, sticky selection bar). */
	function rowIndexAt(x: number, y: number): number | null {
		const cx = Math.min(Math.max(x, 0), window.innerWidth - 1);
		const cy = Math.min(Math.max(y, 0), window.innerHeight - 1);
		for (const node of document.elementsFromPoint(cx, cy)) {
			const el = node.closest<HTMLElement>('[data-row-index]');
			if (el) return Number(el.dataset.rowIndex);
		}
		return null;
	}

	/** Visible element of a page row: the table row on a wide screen, the card on a phone. */
	function visibleRow(index: number): HTMLElement | null {
		return [...document.querySelectorAll<HTMLElement>(`[data-row-index="${index}"]`)].find((el) => el.offsetParent !== null) ?? null;
	}

	/**
	 * Selection mode on without moving the list under the pointer or the keyboard cursor: the bar and
	 * the checkboxes appear at once and the page scrolls by the height they add above `anchor`.
	 */
	function enterSelect(anchor: HTMLElement | null) {
		if (selectMode) return;
		const top = anchor?.getBoundingClientRect().top ?? 0;
		flushSync(() => (selectMode = true));
		const shift = anchor ? anchor.getBoundingClientRect().top - top : 0;
		if (shift) window.scrollBy(0, shift);
	}

	/** First row reached: the slide paints the opposite of the start row's state over the rows passed. */
	function startPaint(index: number) {
		if (!drag) return;
		if (drag.keys !== pageSignature()) {
			endDrag('held');
			return;
		}
		const key = pageKeys[drag.start];
		drag.on = !(key && selected.has(key));
		drag.base = new Set(selected);
		drag.wasSelecting = selectMode;
		drag.active = true;
		enterSelect(drag.el);
		paintTo(index);
	}

	function paintTo(index: number) {
		if (!drag?.active || index === drag.last) return;
		if (drag.keys !== pageSignature()) {
			endDrag('held');
			return;
		}
		selected = paintRange(drag.base, pageKeys, drag.start, index, drag.on);
		drag.last = index;
		lastToggled = index;
	}

	/** Escape during a slide: the selection and the selection mode go back to what they were before it. */
	function cancelSlide(): boolean {
		if (!drag?.active) return false;
		selected = drag.base;
		selectMode = drag.wasSelecting;
		endDrag('held');
		return true;
	}

	function onRowPointerDown(e: PointerEvent, index: number) {
		swallowClick = false;
		window.removeEventListener('pointerup', armSwallow);
		if (!e.isPrimary || e.button !== 0 || (e.target as HTMLElement).closest('input, select, button, a, textarea, label, [contenteditable], [data-no-slide]')) return;
		endDrag();
		const touch = e.pointerType !== 'mouse';
		drag = { pointerId: e.pointerId, start: index, el: e.currentTarget as HTMLElement, keys: pageSignature(), on: true, base: selected, wasSelecting: selectMode, active: false, touch, armed: false, last: -1, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, timer: 0 };
		if (touch) {
			drag.timer = window.setTimeout(() => {
				if (!drag || drag.active) return;
				drag.armed = true;
				navigator.vibrate?.(10);
			}, LONG_PRESS);
		}
		window.addEventListener('pointermove', onDragMove);
		window.addEventListener('pointerup', onDragEnd);
		window.addEventListener('pointercancel', onDragEnd);
		window.addEventListener('blur', onDragBlur);
	}

	function onDragMove(e: PointerEvent) {
		if (!drag || e.pointerId !== drag.pointerId) return;
		if (!drag.touch && !(e.buttons & 1)) {
			endDrag();
			return;
		}
		drag.x = e.clientX;
		drag.y = e.clientY;
		const far = Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > TOUCH_SLOP;
		if (!drag.active) {
			if (drag.touch && !drag.armed) {
				if (far) endDrag();
				return;
			}
			if (!far) return;
			const index = rowIndexAt(e.clientX, e.clientY);
			if (drag.touch) {
				closeContextMenu();
				startPaint(index ?? drag.start);
			} else if (index !== null && index !== drag.start) startPaint(index);
			return;
		}
		const index = rowIndexAt(e.clientX, e.clientY);
		if (index !== null) paintTo(index);
		if (!scrollFrame) scrollFrame = requestAnimationFrame(autoScroll);
	}

	/** Near the top or bottom of the window the page scrolls by itself and the selection follows, until it cannot scroll further. */
	function autoScroll() {
		scrollFrame = 0;
		if (!drag?.active) return;
		const step = edgeScrollStep(drag.y, window.innerHeight);
		if (!step) return;
		const before = window.scrollY;
		window.scrollBy(0, step);
		if (window.scrollY === before) return;
		const index = rowIndexAt(drag.x, drag.y);
		if (index !== null) paintTo(index);
		scrollFrame = requestAnimationFrame(autoScroll);
	}

	function onDragEnd(e: PointerEvent) {
		if (drag && e.pointerId !== drag.pointerId) return;
		endDrag(e.type === 'pointerup' ? 'up' : 'cancel');
	}

	function onDragBlur() {
		endDrag();
	}

	/** The click of the release that ends a slide does nothing. */
	function armSwallow() {
		swallowClick = true;
		window.setTimeout(() => (swallowClick = false), 400);
	}

	/**
	 * Ends the gesture. `up`: released, the click that follows is swallowed; `held`: stopped while the
	 * button is still down (Escape, page turn), the click of its release is swallowed; `cancel`: no click
	 * will follow (pointer cancelled, window left, button released unseen).
	 */
	function endDrag(how: 'up' | 'held' | 'cancel' = 'cancel') {
		if (drag) {
			window.clearTimeout(drag.timer);
			if (drag.active && how === 'up') armSwallow();
			else if (drag.active && how === 'held') window.addEventListener('pointerup', armSwallow, { once: true });
		}
		drag = null;
		cancelAnimationFrame(scrollFrame);
		scrollFrame = 0;
		window.removeEventListener('pointermove', onDragMove);
		window.removeEventListener('pointerup', onDragEnd);
		window.removeEventListener('pointercancel', onDragEnd);
		window.removeEventListener('blur', onDragBlur);
	}

	/**
	 * List surface: once the long press fired, sliding selects instead of scrolling (touch listener set
	 * before the gesture, not passive), and a logo dragged from a row never starts a native drag (fields
	 * keep theirs).
	 */
	function slideSurface(node: HTMLElement) {
		const block = (e: TouchEvent) => {
			if (drag?.active || drag?.armed) e.preventDefault();
		};
		const noDrag = (e: DragEvent) => {
			const t = e.target instanceof Element ? e.target : null;
			if (t?.closest('[data-row-index]') && !t.closest('input, textarea, [contenteditable], [data-no-slide]')) e.preventDefault();
		};
		node.addEventListener('touchmove', block, { passive: false });
		node.addEventListener('dragstart', noDrag);
		return {
			destroy: () => {
				node.removeEventListener('touchmove', block);
				node.removeEventListener('dragstart', noDrag);
			}
		};
	}

	/**
	 * Right click (or the system long press) on a row: no menu while a slide selects (the shared menu
	 * skips a prevented event); otherwise the row becomes the keyboard cursor, so the keys shown in its
	 * menu (M, X, Entrée) act on it afterwards too.
	 */
	function onRowContextMenu(e: MouseEvent, index: number) {
		if (drag?.active) e.preventDefault();
		else cursor = index;
	}

	onMount(() => () => {
		endDrag();
		window.removeEventListener('pointerup', armSwallow);
	});

	/** Rows « tout sélectionner » takes: the listed ones on every page, never those of a folded category. */
	const selectableListed = $derived(sorted.filter(selectable));
	const pageSelectable = $derived(paginated.filter(selectable));
	const pageSelectedCount = $derived(pageSelectable.filter((tx) => selected.has(txKey(tx))).length);

	/** Header checkbox: checks the whole page, or unchecks it when already checked. */
	function togglePage() {
		const next = new Set(selected);
		const all = pageSelectedCount === pageSelectable.length;
		for (const tx of pageSelectable) {
			if (all) next.delete(txKey(tx));
			else next.add(txKey(tx));
		}
		selected = next;
	}

	function selectAllFiltered() {
		selected = new Set(selectableListed.map(txKey));
	}

	// Filters changed or a category folded: the selection is limited to the rows still listed (never
	// act on an operation you can no longer see)
	$effect(() => {
		if (selected.size === 0) return;
		const visible = new Set(sorted.map(txKey));
		const kept = [...selected].filter((k) => visible.has(k));
		if (kept.length !== selected.size) selected = new Set(kept);
	});

	const selectedTxs = $derived(selected.size > 0 ? allTxs.filter((tx) => selected.has(txKey(tx))) : []);
	/** Counted like the page totals: no pending row, no hidden or internal transfer. */
	const countedFlow = (tx: Transaction) => isBudgetFlow(tx) && !isExcluded(txKey(tx));

	/** Net of the selection, shown in the bar and updated while sliding. */
	const selectedTotal = $derived(Math.round(selectedTxs.filter(countedFlow).reduce((sum, tx) => sum + signedAmount(tx), 0) * 100) / 100);

	/** Sorted by date: rows listed under each day, and their net counted like the page totals (a day with 2+ rows: date tooltip on a wide screen, day header on a phone). */
	const dayTotals = $derived.by(() => {
		if (sortKey !== 'date') return null;
		const m = new Map<string, { net: number; count: number }>();
		for (const tx of filtered) {
			const day = dayOf(tx);
			if (!day) continue;
			const d = m.get(day) ?? { net: 0, count: 0 };
			d.count++;
			if (countedFlow(tx)) d.net = Math.round((d.net + signedAmount(tx)) * 100) / 100;
			m.set(day, d);
		}
		return m;
	});
	const signedCompact = (n: number) => `${n > 0 ? '+' : ''}${Math.abs(n) < 0.5 ? formatEUR(n) : formatEURCompact(n)}`;

	/** Day a row belongs to in the date sort: its booking date, or one group for the « en cours » rows. */
	function dayOf(tx: Transaction): string {
		return isPending(tx) && !isPlannedInstalment(tx) ? '' : tx.booking_date;
	}

	/** Sorted by date, the rows that open a day on the page (the first row of a page always does). */
	const dayStarts = $derived(paginated.map((tx, i) => sortKey === 'date' && (i === 0 || dayOf(paginated[i - 1]!) !== dayOf(tx))));
	const dayNetTitle = (d: { net: number; count: number }) => `${d.count} opérations ce jour, net sans les opérations en cours ni les virements masqués : ${formatEUR(d.net)}`;
	/** Share of the filtered spending written in a category header (never a misleading « 0 % »). */
	const shareLabel = (share: number) => (share < 0.005 ? '< 1 %' : formatPct(share * 100, 0));
	const catNetTitle = (g: CategoryGroup) =>
		`Net de la catégorie, compté comme les totaux de la page (remboursements déduits, sans les opérations en cours ni les virements masqués)${g.kind === 'transfer' ? ' ; épargne et transferts restent hors revenus et dépenses' : ''}`;

	/**
	 * New folded categories of the « Catégorie » sort: their rows leave the list or come back. With a
	 * `focus` category, the list turns to the page that now holds its header and that header keeps the
	 * focus; otherwise it goes back to its first page.
	 */
	async function applyFolds(next: Set<CategoryId>, focus?: CategoryId) {
		foldedCats = next;
		cursor = -1;
		lastToggled = -1;
		const before = page;
		page = focus && categoryView ? headPage(categoryView, focus, PAGE_SIZE) : 1;
		if (!focus) return;
		await tick();
		const head = [...document.querySelectorAll<HTMLElement>(`[data-cat-head="${focus}"]`)].find((el) => el.offsetParent !== null);
		head?.focus({ preventScroll: page === before });
		if (page !== before) head?.scrollIntoView({ block: 'nearest' });
	}

	/** Click on a category header: folds or unfolds that category alone. */
	function toggleFold(id: CategoryId) {
		const next = new Set(foldedCats);
		if (!next.delete(id)) next.add(id);
		void applyFolds(next, id);
	}

	/** Every category unfolded: the category mode lists all its rows. */
	function unfoldAll() {
		void applyFolds(new Set());
	}

	/** Every category folded, those a later month or filter brings in included: the list is a one-page summary. */
	function foldAll() {
		void applyFolds(new Set(ALL_CATS));
	}

	/** One category unfolded, every other one folded (row menu « Déplier seulement … »). */
	function unfoldOnly(id: CategoryId) {
		setGrouping('category');
		void applyFolds(new Set(ALL_CATS.filter((c) => c !== id)), id);
	}

	/** Only the operations of one category (category filter, its subcategory filter dropped), unfolded in the category mode. */
	function filterCategory(id: CategoryId) {
		categoryFilter = id;
		subFilter = undefined;
		view = 'liste';
		unfold(id);
	}

	/** One category unfolded, the other folds kept: its rows come back in the category mode. */
	function unfold(id: CategoryId) {
		if (!foldedCats.has(id)) return;
		const next = new Set(foldedCats);
		next.delete(id);
		foldedCats = next;
	}

	/** Categories listed in the category mode all folded: the toolbar offers « Tout déplier », otherwise « Tout replier ». */
	const allFolded = $derived(categoryView !== null && categoryView.groups.every((g) => foldedCats.has(g.id)));
	/** Tags present in the selection ('− Tag'), most frequent first. */
	const selectedTagCounts = $derived(tagInventory(selectedTxs));

	const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`;

	/** Bulk category: overrides set at once; 'Annuler' restores the previous ones. */
	function bulkCategory(categoryId: CategoryId) {
		void restorePoint(`avant modification groupée : catégorie de ${selected.size} opération${selected.size > 1 ? 's' : ''}`);
		const keys = selectedTxs.map(txKey);
		if (keys.length === 0) return;
		const before = Object.fromEntries(keys.map((k) => [k, budgetState.overrides[k] ?? null]));
		patchOverrides(Object.fromEntries(keys.map((k) => [k, categoryId])));
		showToast(`${plural(keys.length, 'opération')} → ${getCategory(categoryId).label}`, 'Annuler', () => patchOverrides(before));
	}

	/**
	 * Adds or removes tags on the selection (imported operations); 'Annuler' restores the previous
	 * tags.
	 */
	function bulkTags(mode: 'add' | 'remove', tags: string[]) {
		void restorePoint(`avant modification groupée : étiquettes de ${selected.size} opération${selected.size > 1 ? 's' : ''}`);
		if (tags.length === 0 || selectedTxs.length === 0) return;
		const imported = new Set(txState.imported.map(txKey));
		const next = new Map<string, Pick<Transaction, 'tags'>>();
		const before = new Map<string, Pick<Transaction, 'tags'>>();
		let demo = 0;
		for (const tx of selectedTxs) {
			const key = txKey(tx);
			if (!imported.has(key)) {
				demo++;
				continue;
			}
			const updated = mode === 'add' ? addTags(tx.tags, tags) : removeTags(tx.tags, tags);
			if (sameTags(updated, tx.tags)) continue;
			before.set(key, { tags: tx.tags?.length ? [...tx.tags] : undefined });
			next.set(key, { tags: updated.length ? updated : undefined });
		}
		const n = updateImportedMany(next);
		const label = tags.map((t) => `« ${t} »`).join(', ');
		const skipped = demo > 0 ? ` · ${plural(demo, 'opération')} de démonstration ignorée${demo > 1 ? 's' : ''}` : '';
		if (n === 0) {
			showToast(`${mode === 'add' ? 'Déjà taguées' : 'Aucune ne porte'} ${label}${skipped}`);
			return;
		}
		showToast(
			`${mode === 'add' ? 'Tag ajouté' : 'Tag retiré'} ${label} : ${plural(n, 'opération')}${skipped}`,
			'Annuler',
			() => void updateImportedMany(before)
		);
	}

	/** Bulk hide from / restore to the budget (same mechanism as the detail panel); withdrawals into the cash wallet stay out. */
	function bulkExclude(hide: boolean) {
		void restorePoint(`avant modification groupée : ${selected.size} opération${selected.size > 1 ? 's' : ''} ${hide ? 'masquées' : 'réintégrées'}`);
		const changed = selectedTxs.map(txKey).filter((k) => !isWalletWithdrawal(k) && isExcluded(k) !== hide);
		if (changed.length === 0) {
			showToast(hide ? 'Déjà masquées du budget' : 'Déjà comptées dans le budget');
			return;
		}
		if (hide) excludeKeys(changed);
		else includeKeys(changed);
		showToast(
			`${plural(changed.length, 'opération')} ${hide ? 'masquée' : 'réintégrée'}${changed.length > 1 ? 's' : ''} ${hide ? 'du' : 'au'} budget`,
			'Annuler',
			() => (hide ? includeKeys(changed) : excludeKeys(changed))
		);
	}

	let bulkTagDraft = $state('');
	function onBulkTagKeydown(e: KeyboardEvent) {
		e.stopPropagation();
		if (e.key === 'Enter') {
			e.preventDefault();
			bulkTags('add', splitTagInput(bulkTagDraft));
			bulkTagDraft = '';
		} else if (e.key === 'Escape') {
			bulkTagDraft = '';
			(e.target as HTMLInputElement).blur();
		}
	}

	// ---- Tags of an operation (detail panel) ----
	let tagDraft = $state('');
	$effect(() => {
		void expandedKey;
		tagDraft = '';
	});

	/** Replaces the tags of an imported operation; false (with a message) for a demo row. */
	function setTxTags(tx: Transaction, tags: string[]): boolean {
		if (sameTags(tags, tx.tags)) return true;
		if (updateImported(txKey(tx), { tags: tags.length ? tags : undefined })) return true;
		showToast('Tags impossibles sur une opération de démonstration');
		return false;
	}

	function addTagsTo(tx: Transaction, tags: string[]) {
		if (tags.length === 0) return;
		if (setTxTags(tx, addTags(tx.tags, tags))) tagDraft = '';
	}

	function removeTagFrom(tx: Transaction, tag: string) {
		const before = tx.tags ?? [];
		if (setTxTags(tx, removeTags(before, [tag]))) showToast(`Tag « ${tag} » retiré`, 'Annuler', () => void updateImported(txKey(tx), { tags: [...before] }));
	}

	/** Tab completes with the first suggestion. */
	function onTagKeydown(tx: Transaction, e: KeyboardEvent, first: string | undefined) {
		e.stopPropagation();
		if (e.key === 'Enter') {
			e.preventDefault();
			addTagsTo(tx, splitTagInput(tagDraft));
		} else if (e.key === 'Tab' && !e.shiftKey && tagDraft.trim() && first && first !== tagDraft) {
			e.preventDefault();
			tagDraft = first;
		} else if (e.key === 'Escape') {
			tagDraft = '';
			(e.target as HTMLInputElement).blur();
		}
	}

	/** 'Indeterminate' checkbox (page partly checked): a DOM property, not an attribute. */
	function indeterminate(node: HTMLInputElement, value: boolean) {
		node.indeterminate = value;
		return {
			update(v: boolean) {
				node.indeterminate = v;
			}
		};
	}

	/** List label: short merchantLabel (SPEC v13 §A), cleanLabel fallback when empty; computed entries (portage, cash wallet) keep their written label. */
	function displayLabel(tx: Transaction): string {
		return listLabel(tx);
	}

	/** Full raw label (title tooltip of the list). */
	function rawLabel(tx: Transaction): string {
		return tx.remittance_information.join(' ').replace(/\s+/g, ' ').trim();
	}

	/** Linking an operation to a possession (Patrimoine › Biens): selector open for this key. */
	let attachOpenKey = $state<string | null>(null);
	let assetChoice = $state('');

	function openAttach(tx: Transaction) {
		attachOpenKey = txKey(tx);
		assetChoice = assetsState.biens[0]?.id ?? '__nouveau';
	}

	/**
	 * Links the operation to the chosen possession, or creates a possession prefilled from it (a
	 * Voiture operation, e.g. the vehicle purchase, creates a vehicle).
	 */
	function attachToAsset(tx: Transaction) {
		const key = txKey(tx);
		if (assetChoice === '__nouveau') {
			const isCar = categorize(tx, budgetState.overrides, undefined, getMerchantCategoryMap()) === 'voiture';
			const b = addAsset({
				name: displayLabel(tx).slice(0, 80) || 'Bien',
				type: isCar ? 'vehicule' : 'autre',
				...(isCar ? { vehicle: { kmLog: [] } } : {}),
				purchaseDate: tx.booking_date || tx.value_date || new Date().toISOString().slice(0, 10),
				purchasePrice: Math.max(0, Math.round(-signedAmount(tx) * 100) / 100),
				linkedTxKeys: [key]
			});
			showToast(`Bien « ${b.name} » créé : complète-le dans ${isCar ? 'Voiture' : 'Patrimoine'}`, 'Voir', () => navigate(isCar ? '/voiture' : '/patrimoine'));
		} else {
			attachTx(assetChoice, key);
			showToast(`Opération rattachée à « ${assetsState.biens.find((b) => b.id === assetChoice)?.name ?? 'bien'} »`);
		}
		attachOpenKey = null;
	}

	/** Budget exclusion toggle from the detail panel (SPEC v13 §C.3); never on a computed entry nor a withdrawal into the cash wallet. */
	function toggleInternal(tx: Transaction) {
		const key = txKey(tx);
		if (isComputedEntry(tx)) return;
		if (isWalletWithdrawal(key)) {
			showToast('Retrait vers le porte-monnaie : hors budget, compté dans les soldes');
			return;
		}
		if (isExcluded(key)) {
			includeKeys([key]);
			showToast('Opération réintégrée au budget');
		} else {
			excludeKeys([key]);
			showToast('Opération masquée des totaux du budget', 'Annuler', () => includeKeys([key]));
		}
	}

	/** Page numbers shown (with ellipses). */
	const pageNumbers = $derived.by((): (number | '…')[] => {
		const n = pageCount;
		if (n <= 7) return Array.from({ length: n }, (_, i) => i + 1);
		const around = new Set([1, 2, page - 1, page, page + 1, n - 1, n].filter((p) => p >= 1 && p <= n));
		const list = [...around].sort((a, b) => a - b);
		const out: (number | '…')[] = [];
		let prev = 0;
		for (const p of list) {
			if (prev && p - prev > 1) out.push('…');
			out.push(p);
			prev = p;
		}
		return out;
	});

	// ---- Import (CM/Natixis CSV, CM XLSX; auto-detection by headers) ----
	let fileInput = $state<HTMLInputElement | null>(null);
	let importing = $state(false);
	/** Format requested explicitly via a button/the palette (null = auto-detection). */
	let pendingFormat = $state<'cm' | 'natixis' | null>(null);

	// ---- Remapper: last file kept + modal state ----
	let lastFile = $state<File | null>(null);
	let remapNextPick = $state(false);
	let mapper = $state<{ fileName: string; sourceData: MapperSource; account: string; txSource: Transaction['source'] } | null>(null);

	/** Opens the remapping modal for a CSV buffer. */
	function openMapperCsv(fileName: string, buffer: ArrayBuffer, account: string, txSource: Transaction['source'] = 'cm-csv') {
		mapper = { fileName, sourceData: { kind: 'csv', buffer }, account, txSource };
	}

	/**
	 * Opens the remapping modal for a CSV file: the format is detected to offer a consistent default
	 * target account (Natixis → 'natixis', otherwise the account derived from the file name).
	 */
	async function openMapperCsvAuto(file: File) {
		const buffer = await file.arrayBuffer();
		if (detectCsvFormat(decodeCsv(buffer)) === 'natixis') openMapperCsv(file.name, buffer, 'natixis', 'natixis-csv');
		else openMapperCsv(file.name, buffer, accountFromFileName(file.name));
	}

	/** Opens the modal on the first usable sheet of an XLSX workbook. */
	async function openMapperXlsx(file: File) {
		const sheets = await parseXlsx(await file.arrayBuffer());
		const sheet = sheets.find((s) => s.rows.length >= 2) ?? sheets[0];
		if (!sheet) throw new Error('XLSX illisible');
		mapper = {
			fileName: `${file.name} — ${sheet.name}`,
			sourceData: { kind: 'rows', rows: sheet.rows },
			account: accountFromFileName(file.name),
			txSource: 'cm-xlsx'
		};
	}

	/**
	 * 'Remapper…' button: reopens the last file in the modal (without a recent file, the next chosen
	 * file goes to the modal).
	 */
	async function openRemapper() {
		if (!lastFile) {
			remapNextPick = true;
			pendingFormat = null;
			fileInput?.click();
			return;
		}
		importing = true;
		try {
			if (/\.xlsx$/i.test(lastFile.name)) await openMapperXlsx(lastFile);
			else await openMapperCsvAuto(lastFile);
		} catch (e) {
			txState.feedback = {
				added: 0,
				duplicates: 0,
				enriched: 0,
				ignored: 0,
				resurrectedBlocked: 0,
				errors: [e instanceof Error ? e.message : 'Échec de lecture du fichier'],
				fileName: lastFile.name,
				accounts: [],
				at: Date.now()
			};
		} finally {
			importing = false;
		}
	}

	/**
	 * 'Réinitialiser les données': confirmation (like the palette), then an 'Annuler' toast that
	 * reinjects the removed list. Before, one click erased 100 % of the imported operations with no
	 * way back.
	 */
	function onResetImported() {
		const n = txState.imported.length;
		if (!window.confirm(`Supprimer les ${n} opérations importées ? (Annulable juste après, puis définitif.)`)) return;
		const removed = resetImported();
		showToast(`${n} opération${n > 1 ? 's' : ''} supprimée${n > 1 ? 's' : ''}`, 'Annuler', () => restoreImported(removed));
	}

	/**
	 * After each import: counts the internal transfers already hidden in the batch ('N virement(s)
	 * interne(s) masqué(s)' feedback), saves the batch, records it in the import log ('Derniers
	 * imports' line + reminders), THEN starts the review of new detections (dialog once per batch) and
	 * the sync of tracked loans (SPEC v13 §C/§D). The order matters: detection reads the store's
	 * transactions.
	 */
	function postImport(
		txs: Transaction[],
		meta: { ignored: number; errors: string[]; fileName: string; accounts?: string[]; knownElsewhere?: number }
	) {
		const maskedTransfers = countExcludedAmong(txs);
		void restorePoint(`avant import ${meta.fileName} : ${txs.length} opération${txs.length > 1 ? 's' : ''}`);
		addImported(txs, { ...meta, maskedTransfers });
		syncLoans();
		reviewTransfers();
		const src = txs[0]?.source;
		const last = txs.reduce((m, t) => (t.booking_date > m ? t.booking_date : m), '');
		if (src === 'cm-xlsx' || src === 'cm-csv') recordImport('cm', meta.fileName, last || undefined);
		else if (src === 'natixis-csv') recordImport('natixis', meta.fileName, last || undefined);
		else if (src === 'krak-pdf') recordImport('krak', meta.fileName, last ? last.slice(0, 7) : undefined);
		else if (src === 'kraken-csv') recordImport('kraken-csv', meta.fileName, last || undefined);
	}

	/**
	 * Universal import: several files of any format at once. XLSX/CSV → Crédit Mutuel, Natixis or
	 * Amazon (existing detection); PDF → Krak statement, otherwise Natixis notice, otherwise tax
	 * notice.
	 */
	async function importAny(list: FileList | File[] | null | undefined) {
		const files = [...(list ?? [])];
		if (files.length === 0) return;
		const pdfs = files.filter((f) => /\.pdf$/i.test(f.name));
		const others = files.filter((f) => !/\.pdf$/i.test(f.name));
		const notes: string[] = [];
		const krakFiles: File[] = [];
		importing = true;
		try {
			for (const f of pdfs) {
				const buf = await f.arrayBuffer();
				const krak = await parseKrakStatementPdf(buf);
				if (!('error' in krak)) {
					krakFiles.push(f);
					continue;
				}
				try {
					const nat = await parseNatixisPdf(buf);
					if (nat.kind !== 'error') {
						const r = applyNatixisPdfResult(nat);
						notes.push(`${f.name} : ${r.ok ? r.message : r.error}`);
						if (r.ok) recordImport('natixis', f.name);
						continue;
					}
				} catch {
				}
				const tax = await parseTaxNoticePdf(buf);
				if (!('error' in tax)) {
					const ok = saveTaxNotice(tax);
					notes.push(`${f.name} : avis d'impôt revenus ${tax.year}${ok ? '' : ' (déjà enregistré)'}`);
					recordImport('impots', f.name, String(tax.year));
					continue;
				}
				notes.push(`${f.name} : PDF non reconnu (ni relevé Krak, ni Natixis, ni avis d'impôt)`);
			}
		} finally {
			importing = false;
		}
		if (krakFiles.length > 0) await importKrakFiles(krakFiles);
		for (const f of others.sort((a, b) => a.name.localeCompare(b.name))) await handleFile(f);
		if (notes.length > 0) showToast(notes.join(' · '));
	}

	const reminders = $derived(getImportReminders());
	const importsLine = $derived(
		(Object.entries(importsState.log) as [ImportSource, { at: string; fileName: string; period?: string }][])
			.sort((a, b) => b[1].at.localeCompare(a[1].at))
			.map(([src, e]) => `${SOURCE_LABELS[src]} ${formatDate(e.at.slice(0, 10))}${e.period ? ` (${e.period.length === 7 ? formatMonth(e.period) : e.period.length === 4 ? e.period : 'jusqu’au ' + formatDate(e.period)})` : ''}`)
	);

	/**
	 * Date of an account's declared balance (XLSX export): the last operation of that account in the
	 * file. Wealth then adds later operations, and an older export no longer overwrites a more recent
	 * balance.
	 */
	function datedAccounts<A extends { id: string; balance?: number; balanceAt?: string }>(accounts: A[], txs: Transaction[]): A[] {
		return accounts.map((a) => {
			if (a.balance === undefined || a.balanceAt) return a;
			const last = txs.reduce((m, t) => (t.account === a.id && t.booking_date > m ? t.booking_date : m), '');
			return last ? { ...a, balanceAt: last } : a;
		});
	}

	/**
	 * Import validated from the remapping modal (preset remembered); an optional 'Compte' column
	 * registers the discovered accounts.
	 */
	function onMapperImport(result: CsvImportResult, preset: ImportPreset, signature: string) {
		const current = mapper;
		mapper = null;
		if (!current) return;
		savePreset(signature, preset);
		if (current.txSource === 'cm-csv') registerCsvAccount(current.account);
		registerAccounts(result.accounts);
		const accountIds = [...new Set(result.transactions.map((t) => t.account ?? current.account))];
		postImport(result.transactions, {
			ignored: result.ignored,
			errors: result.errors,
			fileName: current.fileName,
			accounts: accountIds.map((id) => accountLabel(id))
		});
	}

	/** Toast of an Amazon import (CSV or ZIP export): lines matched, lines and orders left alone. */
	function showAmazonResult(r: AmazonApplySummary, fileName: string) {
		const parts = [
			`${r.matched} ligne${r.matched > 1 ? 's' : ''} Amazon rapprochée${r.matched > 1 ? 's' : ''} (${r.items} article${r.items > 1 ? 's' : ''})`,
			r.unmatchedTx > 0 ? `${r.unmatchedTx} ligne${r.unmatchedTx > 1 ? 's' : ''} Amazon sans commande trouvée` : '',
			r.unmatchedOrders > 0 ? `${r.unmatchedOrders} commande${r.unmatchedOrders > 1 ? 's' : ''} de l’export absente${r.unmatchedOrders > 1 ? 's' : ''} de ce relevé (autre payeur ?)` : ''
		].filter(Boolean);
		showToast(parts.join(' · '));
		if (r.errors.length > 0) txState.feedback = { added: 0, duplicates: 0, enriched: 0, ignored: r.errors.length, resurrectedBlocked: 0, errors: r.errors, fileName, accounts: [], at: Date.now() };
	}

	/** Read error feedback (unreadable file, parser failure). */
	function failFeedback(fileName: string, message: string) {
		txState.feedback = {
			added: 0,
			duplicates: 0,
			enriched: 0,
			ignored: 0,
			resurrectedBlocked: 0,
			errors: [message],
			fileName,
			accounts: [],
			at: Date.now()
		};
	}

	/**
	 * OFX/QFX, QIF or CAMT statement: dated declared balances (LEDGERBAL / CLBD) go to the register,
	 * then the anti-duplicate guard: a movement already imported by CSV/XLSX (same account, booking
	 * date and amount, another label) is not added twice. An account already imported from Crédit
	 * Mutuel gets its 'last operation' reminder refreshed by the statement.
	 */
	function importStatement(result: StatementResult, fileName: string) {
		registerAccounts(result.accounts);
		const { kept, skipped } = skipKnownMovements(getTransactions(), result.transactions);
		const accountIds = [...new Set(result.transactions.map((t) => t.account ?? 'cm'))];
		const fromCm = accountIds.some((id) => getTransactions().some((t) => t.account === id && (t.source === 'cm-csv' || t.source === 'cm-xlsx')));
		postImport(kept, {
			ignored: result.ignored,
			errors: result.errors,
			fileName,
			accounts: accountIds.map((id) => accountLabel(id)),
			knownElsewhere: skipped
		});
		const last = result.transactions.reduce((m, t) => (t.booking_date > m ? t.booking_date : m), '');
		if (result.transactions.length > 0) recordImport(fromCm ? 'cm' : 'releves', fileName, last || undefined);
		if (skipped > 0) {
			const s = skipped > 1 ? 's' : '';
			showToast(`${STATEMENT_LABELS[result.format]} : ${skipped} opération${s} déjà présente${s} via un autre export (même compte, date et montant), non ajoutée${s}`);
		}
	}

	/**
	 * Shared import: file picker AND drag & drop, CSV (CM/Natixis), CM XLSX or OFX/QIF/CAMT statement
	 * (recognised by content, whatever the button). Routing: a fixed format needs no remapping; a
	 * statement extension with unknown content is never remapped as CSV; an Amazon orders export (GDPR
	 * 'Demander mes données') is not transactions but a match against AMAZON rows already imported; a
	 * Kraken ledger sends EUR rows to the budget (account 'kraken') and crypto rows to the ledger
	 * store (balances, cashback, curve), while deposits, withdrawals, transfers and EUR↔crypto trades
	 * stay out of the budget (counted in balances). Without an explicit format, headers are
	 * auto-detected; 'Remapper…' is an explicit choice that wins over auto-detection WHATEVER the
	 * detected format, with a default target account consistent with the format; an unrecognised
	 * header opens manual remapping; an optional 'Compte' column (enriched CSV) registers the
	 * discovered accounts; last resort: the CM parser, otherwise the remapping modal.
	 */
	async function handleFile(file: File | undefined, requested?: 'cm' | 'natixis') {
		if (!file) return;
		importing = true;
		const format = requested ?? pendingFormat;
		pendingFormat = null;
		const remap = remapNextPick;
		remapNextPick = false;
		try {
			if (/\.xlsx$/i.test(file.name)) {
				lastFile = file;
				if (remap) {
					await openMapperXlsx(file);
					return;
				}
				const result = await parseCreditMutuelXlsx(file);
				registerAccounts(datedAccounts(result.accounts, result.transactions));
				if (result.sheetsSkipped > 0)
					result.errors.push(`${result.sheetsSkipped} feuille${result.sheetsSkipped > 1 ? 's' : ''} sans en-tête reconnu, ignorée${result.sheetsSkipped > 1 ? 's' : ''}`);
				const accountIds = [...new Set(result.transactions.map((t) => t.account ?? 'cm'))];
				postImport(result.transactions, {
					ignored: result.ignored,
					errors: result.errors,
					fileName: file.name,
					accounts: accountIds.map((id) => accountLabel(id))
				});
				return;
			}

			const buffer = await file.arrayBuffer();
			if (!format && isZip(buffer) && isAmazonArchive(buffer)) {
				lastFile = file;
				showAmazonResult(applyAmazonOrders(await readAmazonArchive(buffer), file.name), file.name);
				return;
			}
			const statement = parseStatement(buffer, file.name);
			if (statement) {
				lastFile = null;
				importStatement(statement, file.name);
				return;
			}
			if (/\.(ofx|qfx|qif|xml)$/i.test(file.name)) {
				failFeedback(file.name, 'Relevé non reconnu : ni OFX/QFX, ni QIF, ni CAMT.053/052');
				return;
			}
			const text = decodeCsv(buffer);
			const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
			const headerFields = tokenize(firstLine, detectDelimiter(firstLine))[0] ?? [];

			if (!format && matchesAmazonHeader(headerFields)) {
				lastFile = file;
				showAmazonResult(applyAmazonImport(text, file.name), file.name);
				return;
			}

			if (!format && matchesKrakenLedgerHeader(headerFields)) {
				lastFile = file;
				const result = parseKrakenLedgerText(text);
				const fresh = mergeKrakenLedger(result.entries);
				const internalKeys = result.entries.filter(isInternalKrakenMovement).map(entryToTransaction).filter((t): t is Transaction => t !== null).map(txKey);
				if (internalKeys.length > 0) excludeKeys(internalKeys);
				postImport(result.transactions, {
					ignored: result.ignored,
					errors: result.errors,
					fileName: file.name,
					accounts: result.transactions.length > 0 ? ['Kraken'] : []
				});
				if (fresh > 0)
					showToast(
						`Ledger Kraken : ${fresh} ligne${fresh > 1 ? 's' : ''} intégrée${fresh > 1 ? 's' : ''} (soldes et cashback sur la page Patrimoine)`
					);
				return;
			}

			const detected = format ?? detectCsvFormat(text) ?? 'cm';
			if (remap) {
				lastFile = file;
				if (detected === 'natixis') openMapperCsv(file.name, buffer, 'natixis', 'natixis-csv');
				else openMapperCsv(file.name, buffer, accountFromFileName(file.name));
				return;
			}
			if (detected === 'cm') {
				const account = accountFromFileName(file.name);
				if (!guessMapping(headerFields)) {
					lastFile = file;
					openMapperCsv(file.name, buffer, account);
					return;
				}
				lastFile = file;
				registerCsvAccount(account);
				const result = parseCreditMutuelText(text, account);
				registerAccounts(result.accounts);
				postImport(result.transactions, {
					ignored: result.ignored,
					errors: result.errors,
					fileName: file.name,
					accounts: [...new Set(result.transactions.map((t) => t.account ?? account))].map((id) => accountLabel(id))
				});
				return;
			}

			lastFile = file;
			const result = parseNatixisText(text);
			if (result.transactions.length === 0 && format === null) {
				const account = accountFromFileName(file.name);
				const alt = parseCreditMutuelText(text, account);
				if (alt.transactions.length > 0) {
					registerCsvAccount(account);
					registerAccounts(alt.accounts);
					postImport(alt.transactions, {
						ignored: alt.ignored,
						errors: alt.errors,
						fileName: file.name,
						accounts: [accountLabel(account)]
					});
				} else {
					openMapperCsv(file.name, buffer, account);
				}
				return;
			}
			postImport(result.transactions, {
				ignored: result.ignored,
				errors: result.errors,
				fileName: file.name,
				accounts: result.transactions.length > 0 ? [accountLabel('natixis')] : []
			});
		} catch (e) {
			failFeedback(file.name, e instanceof Error ? e.message : 'Échec de lecture du fichier');
		} finally {
			importing = false;
		}
	}

	/** Opens the file picker with an explicit format. */
	/**
	 * Kraken monthly statements (PDF, several at once): Krak card payments with the merchant name →
	 * 'Carte Krak' account, categorised like the rest. The statement's other movements (cashback,
	 * conversions, Earn) are ignored: the ledger already covers them.
	 */
	async function importKrakFiles(list: FileList | File[] | null | undefined) {
		const files = [...(list ?? [])].filter((f) => /\.pdf$/i.test(f.name)).sort((a, b) => a.name.localeCompare(b.name));
		if (files.length === 0) return;
		importing = true;
		try {
			const txs: Transaction[] = [];
			const errors: string[] = [];
			let ignored = 0;
			let statements = 0;
			for (const f of files) {
				const r = await parseKrakStatementPdf(await f.arrayBuffer());
				if ('error' in r) {
					errors.push(`${f.name} : ${r.error}`);
					continue;
				}
				statements++;
				if (r.month) saveKrakMonth(r.month, { ...r.totals, payments: r.stats.payments });
				txs.push(...r.transactions);
				ignored += r.stats.cashback + r.stats.other;
				errors.push(...r.errors.map((e) => `${f.name} : ${e}`));
			}
			if (statements > 0) registerAccounts([{ id: KRAK_ACCOUNT_ID, label: 'Carte Krak', last4: 'KRAK', kind: 'crypto' }]);
			postImport(txs, {
				ignored,
				errors,
				fileName: files.length === 1 ? files[0]!.name : `${statements} relevé${statements > 1 ? 's' : ''} Kraken`,
				accounts: statements > 0 ? ['Carte Krak'] : []
			});
		} finally {
			importing = false;
		}
	}

	// Imports panel: files recognised for this page are imported here (usual import feedback)
	$effect(() => {
		const pendingFiles = uiState.importsEnAttente;
		if (!pendingFiles) return;
		uiState.importsEnAttente = null;
		void importAny(pendingFiles);
	});

	// 'Corriger les colonnes d'un CSV…' requested from the Imports panel
	$effect(() => {
		if (!uiState.remapRequest) return;
		uiState.remapRequest = false;
		void openRemapper();
	});

	// The Cmd+K palette / the Patrimoine page can ask to open the file picker
	$effect(() => {
		if (uiState.importRequest !== null) {
			pendingFormat = uiState.importRequest;
			uiState.importRequest = null;
			fileInput?.click();
		}
	});

	// Filter requested by another page (Dashboard donut, Budget card): applied, then consumed
	$effect(() => {
		const f = uiState.txFilter;
		if (!f) return;
		uiState.txFilter = null;
		vacationFilter = f.vacationId ? (vacationState.periods.find((p) => p.id === f.vacationId) ?? null) : null;
		categoryFilter = f.categoryId ?? '';
		subFilter = f.subId;
		dateFrom = f.from ?? '';
		dateTo = f.to ?? '';
		minAmount = f.minAmount ?? null;
		maxAmount = f.maxAmount ?? null;
		typeFilter = 'all';
		searchInput = f.search ?? '';
		tagFilter = null;
		accountFilter = '';
		dayFilter = '';
		dayTo = '';
		view = 'liste';
	});

	// Search prefilled from the palette (Transactions results)
	$effect(() => {
		if (uiState.txSearch !== null) {
			searchInput = uiState.txSearch;
			uiState.txSearch = null;
		}
	});

	/** Attaches (or detaches) an operation to a specific holiday period. */
	function onAssignVacation(tx: Transaction, periodId: string | null) {
		assignVacation(tx, periodId);
		const p = periodId ? vacationState.periods.find((x) => x.id === periodId) : null;
		showToast(p ? `Rattachée aux vacances « ${p.label} »` : 'Détachée des vacances');
	}

	/** Manual subcategory: for the whole merchant by default (box checked). */
	let subForMerchant = $state(true);
	function onSubChange(tx: Transaction, event: Event) {
		const v = (event.target as HTMLSelectElement).value;
		const mk = merchantKey(tx.remittance_information);
		setSubOverride(tx, v === '' ? null : v, subForMerchant && mk ? 'merchant' : 'tx');
		showToast(v === '' ? 'Sous-catégorie retirée' : `Sous-catégorie « ${getSubcategory(v)?.label ?? v} »${subForMerchant && mk ? ` pour ${merchantLabel(tx.remittance_information)}` : ''}`);
	}

	/** Sets the override and discreetly offers a learned rule (once per keyword). */
	function onCategoryChange(tx: Transaction, event: Event) {
		setOverrideAndPrompt(tx, (event.target as HTMLSelectElement).value as CategoryId);
	}

	/** Displayed origin of an operation (detail panel): one entry per source. */
	const TX_SOURCE_LABELS: Record<NonNullable<Transaction['source']>, string> = {
		demo: 'Démo',
		'cm-csv': 'CSV Crédit Mutuel',
		'cm-xlsx': 'XLSX Crédit Mutuel',
		'natixis-csv': 'CSV Natixis',
		kraken: 'Kraken',
		'kraken-csv': 'Ledger Kraken (CSV)',
		'krak-pdf': 'Relevé Kraken (carte Krak)',
		portage: 'Portage',
		ofx: 'Relevé OFX',
		qif: 'Relevé QIF',
		camt: 'Relevé CAMT',
		manual: 'Saisie rapide (en attente du relevé)',
		cash: 'Liquide (porte-monnaie)'
	};

	/**
	 * Discreet badge of the source account (imported transactions only, nothing for the demo):
	 * register label + account type in title/aria.
	 */
	function accountBadge(tx: Transaction): { label: string; title: string } | null {
		if (tx.source === 'portage') return { label: 'Portage', title: 'Écriture calculée depuis tes documents de portage : comptée dans le budget, jamais dans les soldes (onglet Portage)' };
		if (tx.source === 'cash') return { label: 'Liquide', title: `${tx.credit_debit_indicator === 'CRDT' ? 'Reçu en liquide, ajouté au porte-monnaie' : tx.remittance_information[0] === WRITE_OFF_LABEL ? 'Reste du porte-monnaie jamais détaillé' : 'Payé en liquide, sorti du porte-monnaie'} : compté dans le budget, jamais dans les soldes` };
		const account =
			tx.account ??
			(tx.source === 'cm-csv' || tx.source === 'cm-xlsx'
				? 'cm'
				: tx.source === 'natixis-csv'
					? 'natixis'
					: tx.source === 'kraken'
						? 'kraken'
						: tx.source === 'krak-pdf'
							? 'krak-card'
							: undefined);
		if (!account) return null;
		const label = accountLabel(account);
		return { label, title: `${KIND_LABELS[accountKind(account)]} : ${label}` };
	}

	/** Source of an operation and its account as the one chip of its detail (« CSV Crédit Mutuel · Compte courant »), whole in its tooltip; a computed entry has no account. */
	function sourceChip(tx: Transaction): { label: string; title: string } {
		const source = TX_SOURCE_LABELS[tx.source ?? 'demo'];
		const account = tx.account && !isComputedEntry(tx) ? accountLabel(tx.account) : '';
		const badge = accountBadge(tx);
		return { label: account ? `${source} · ${account}` : source, title: badge ? `${source} · ${badge.title}` : source };
	}

	/**
	 * Dates sentence of an operation's detail (operationDetail.ts) with what the list knows of it: a
	 * planned instalment, a quick entry (paid or received that day), a pending operation, a cash
	 * withdrawal. A computed entry, whose note already says what it is, gets its day alone; a cash
	 * write-off is the day of the wallet check.
	 */
	function entryDates(tx: Transaction): string {
		if (isComputedEntry(tx)) return `${tx.source === 'cash' && tx.remittance_information[0] === WRITE_OFF_LABEL ? 'Constaté le' : 'Le'} ${dayDate(tx.booking_date, new Date().getFullYear())}`;
		const state: DateState = isPlannedInstalment(tx) ? 'planned' : tx.source === 'manual' ? 'typed' : isPending(tx) ? 'pending' : 'booked';
		return datesSentence({
			purchase: purchaseDate(tx),
			booking: tx.booking_date,
			credit: tx.credit_debit_indicator === 'CRDT',
			withdrawal: /\bRETRAITS?\b/i.test(tx.remittance_information.join(' ')),
			state
		});
	}

	/** Amount of an operation kept in another currency than the euro (« −12,00 $US »), '' in euros. */
	function foreignAmount(tx: Transaction): string {
		const currency = tx.transaction_amount.currency;
		if (!currency || currency === 'EUR') return '';
		const value = signedAmount(tx);
		try {
			return new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(value).replace('-', '−');
		} catch {
			return `${value.toFixed(2).replace('.', ',')} ${currency}`;
		}
	}

	/**
	 * Where the refund section (RefundControl) goes in an operation's detail: its « À rembourser… »
	 * button among the actions while nothing is expected, the claim, or the expenses an income pays
	 * back, on the « Lié à » line; null for an income that pays nothing back.
	 */
	function refundPlace(tx: Transaction): 'action' | 'linked' | null {
		const key = txKey(tx);
		if (signedAmount(tx) < 0) return refundOf(key) ? 'linked' : 'action';
		return refundedBy(key).length > 0 ? 'linked' : null;
	}

	/**
	 * Files a bank operation in the category most of its merchant's other operations are in (history
	 * line of its detail), through the row select's setter and its learned-rule offer. « Annuler » in
	 * the toast puts the override back and withdraws the offer this filing raised, so it can no longer
	 * apply the undone category to the whole merchant, and shows again the offer it had replaced.
	 */
	function fileLikeOthers(tx: Transaction, id: CategoryId) {
		const setCategory = categorySetter(tx);
		if (!setCategory) return;
		const key = txKey(tx);
		const before = budgetState.overrides[key] ?? null;
		const shown = rulesState.prompt;
		setCategory(id);
		const raised = rulesState.prompt === shown ? null : rulesState.prompt;
		showToast(`Classée en ${getCategory(id).label}, comme les autres`, 'Annuler', () => {
			patchOverrides({ [key]: before });
			withdrawPrompt(raised, shown);
		});
	}

	/**
	 * Deleting an operation: persistent tombstone + toast with undo ('Annuler' reinjects the saved
	 * copy and removes the tombstone).
	 */
	function onDeleteTx(tx: Transaction) {
		const key = txKey(tx);
		const { backup } = deleteTransactions([key]);
		if (expandedKey === key) expandedKey = null;
		showToast('Opération supprimée', 'Annuler', () => restoreTransactions(backup, [key]));
	}

	/** Deleting a cash wallet entry: the spend, cash received or write-off leaves the wallet, undoable from the toast. */
	function onDeleteCash(tx: Transaction) {
		const key = txKey(tx);
		const id = cashItemOf(key);
		if (!id) return;
		const undo = removeCashItem(id);
		if (expandedKey === key) expandedKey = null;
		const what = tx.credit_debit_indicator === 'CRDT' ? 'Liquide reçu supprimé' : tx.remittance_information[0] === WRITE_OFF_LABEL ? 'Liquide non détaillé supprimé' : 'Dépense en liquide supprimée';
		showToast(what, 'Annuler', undo);
	}

	/** Cash spend or cash received whose category can change in the wallet (a write-off has none typed: always « Autre », even during a holiday). */
	function cashCategoryEditable(tx: Transaction): boolean {
		return tx.remittance_information[0] !== WRITE_OFF_LABEL && cashItemOf(txKey(tx)) !== undefined;
	}

	/**
	 * Category of a cash spend or cash received picked on its row. « Vacances » is an override, like on
	 * a bank operation (the typed category stays its default); another one becomes the typed category
	 * in the wallet (its subcategory is reset when the category changes, kept when the typed one is
	 * picked back out of a holiday) and lifts what would hide it, an override or the holiday of its
	 * date (detached from the period), so the row shows what was picked.
	 */
	function setCashCategory(tx: Transaction, categoryId: CategoryId) {
		const key = txKey(tx);
		const id = cashItemOf(key);
		if (!id) return;
		if (categoryId === 'vacances') {
			patchOverrides({ [key]: 'vacances' });
			return;
		}
		if (categoryId !== tx.virtual_category) setCashSpendCategory(id, categoryId, null);
		if (vacationOf(tx)) assignVacation(tx, null);
		if (key in budgetState.overrides) patchOverrides({ [key]: null });
	}

	/** Category select of a cash row. */
	function onCashCategoryChange(tx: Transaction, event: Event) {
		setCashCategory(tx, (event.target as HTMLSelectElement).value as CategoryId);
	}

	/** Badge of an operation left out of the budget: withdrawal into the cash wallet, internal transfer or hidden by the user. */
	function excludedBadge(key: string): { label: string; title: string } {
		if (isWalletWithdrawal(key)) return { label: 'Porte-monnaie', title: 'Retrait vers le porte-monnaie : hors budget (les dépenses en liquide comptent à sa place), compté dans les soldes' };
		return isInternal(key)
			? { label: 'Virement interne', title: 'Virement entre vos comptes — exclu des totaux du budget, compté dans les soldes' }
			: { label: 'Hors budget', title: 'Opération exceptionnelle masquée du budget — comptée dans les soldes' };
	}

	/** Makes deleted operations importable again (clears the tombstones). */
	function onRestoreDeleted() {
		const n = resetDeletedTombstones();
		showToast(
			n > 1
				? `${n} opérations supprimées sont de nouveau importables`
				: 'Les opérations supprimées sont de nouveau importables'
		);
	}

	function toggleDetail(tx: Transaction) {
		const key = txKey(tx);
		expandedKey = expandedKey === key ? null : key;
	}

	/**
	 * Keyboard navigation in the list (outside input fields):
	 * J / ↓ and K / ↑: next / previous row; Enter: open / close the detail
	 * C: category; V: holidays (period of the date); M: hide / restore; N: note
	 */
	let cursor = $state(-1);
	let noteDraft = $state('');
	/** A Shift+click range or a slide never spans two pages. */
	$effect(() => {
		void page;
		cursor = -1;
		lastToggled = -1;
		endDrag('held');
	});
	function rowEl(i: number): HTMLElement | null {
		return document.querySelector(`[data-row-index="${i}"]`);
	}
	function moveCursor(delta: number) {
		if (paginated.length === 0) return;
		cursor = Math.min(paginated.length - 1, Math.max(0, cursor < 0 ? (delta > 0 ? 0 : paginated.length - 1) : cursor + delta));
		rowEl(cursor)?.scrollIntoView({ block: 'nearest' });
	}
	let listTop = $state<HTMLElement | null>(null);
	/** Previous or next page from the keyboard: false on the first or last page; the cursor is cleared and the list shows its top. */
	function turnPage(delta: number): boolean {
		const next = Math.min(pageCount, Math.max(1, page + delta));
		if (next === page) return false;
		page = next;
		cursor = -1;
		listTop?.scrollIntoView({ block: 'start', behavior: 'smooth' });
		return true;
	}
	/**
	 * Note field of the open detail that is on screen: the detail renders under the table row and in
	 * the phone card, one of them hidden by the layout.
	 */
	function visibleNoteField(): HTMLInputElement | undefined {
		return [...document.querySelectorAll<HTMLInputElement>('input[data-note-input]')].find((el) => el.getClientRects().length > 0);
	}
	function openNote(tx: Transaction) {
		expandedKey = txKey(tx);
		noteDraft = tx.note ?? '';
		window.setTimeout(() => visibleNoteField()?.focus(), 30);
	}
	function saveNote(tx: Transaction) {
		if ((tx.note ?? '') === noteDraft) return;
		if (updateImported(txKey(tx), { note: noteDraft })) showSuccess('Note enregistrée');
	}
	/** In the category mode outside a holiday filter, ← / → step the month and Maj+arrows turn the pages. */
	const monthKeys = $derived(sortKey === 'category' && !vacationFilter);

	/**
	 * List keyboard: ignored while a dialog is in front (transfers, Kraken, backup…); Escape leaves
	 * the selection, even from a checked box (text fields intercept it); Enter on a focused button or
	 * link keeps its action (the j/k cursor used to steal it), and on a focused row that is also the
	 * cursor (a right click or the Menu key makes it so) the row's own Enter opens it once; in the
	 * calendar, ← / → change month; in the category mode ← / → step the period to the previous or next
	 * month with operations and Maj+← / Maj+→ turn the pages (plain arrows turn them under a holiday
	 * filter, which has no month stepper).
	 * An arrow a widget already used (the days of the period picker, Maj stretching its range) is left
	 * to it.
	 */
	function onListKeydown(e: KeyboardEvent) {
		if (uiState.paletteOpen || uiState.shortcutsOpen || uiState.backupDialogOpen || uiState.dialogDepth > 0 || mapper) return;
		const t = e.target as HTMLElement;
		if (e.key === 'Escape' && cancelSlide()) return;
		if (e.key === 'Escape' && selectMode) {
			exitSelect();
			return;
		}
		if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable) return;
		if (e.key === 'Enter' && (t.closest('button, a') || (e.defaultPrevented && t.dataset.rowIndex === String(cursor)))) return;
		if (e.metaKey || e.ctrlKey || e.altKey) return;
		if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && e.defaultPrevented) return;
		if (view === 'calendrier') {
			if (e.key === 'Escape' && calPanel) {
				e.preventDefault();
				closeDays();
				return;
			}
			if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
				e.preventDefault();
				shiftCalMonth(e.key === 'ArrowLeft' ? -1 : 1);
			}
			return;
		}
		if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && monthKeys && !e.shiftKey) {
			if (stepPeriod(e.key === 'ArrowLeft' ? -1 : 1)) e.preventDefault();
			return;
		}
		if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
			if (turnPage(e.key === 'ArrowLeft' ? -1 : 1)) e.preventDefault();
			return;
		}
		const k = e.key.toLowerCase();
		if (k === 'j' || e.key === 'ArrowDown') {
			e.preventDefault();
			moveCursor(1);
			return;
		}
		if (k === 'k' || e.key === 'ArrowUp') {
			e.preventDefault();
			moveCursor(-1);
			return;
		}
		const tx = cursor >= 0 ? paginated[cursor] : undefined;
		if (!tx) return;
		if (e.key === 'Enter') {
			e.preventDefault();
			toggleDetail(tx);
		} else if (k === 'c') {
			e.preventDefault();
			(rowEl(cursor)?.querySelector('select[aria-label="Catégorie"]') as HTMLSelectElement | null)?.focus();
		} else if (k === 'v') {
			const p = vacationFor(tx);
			if (p) onAssignVacation(tx, p.id);
			else showToast('Aucune période de vacances à cette date : créez-la dans Budget');
		} else if (k === 'm') toggleInternal(tx);
		else if (k === 'n') {
			e.preventDefault();
			openNote(tx);
		} else if (k === 'x') {
			e.preventDefault();
			toggleSelected(tx, cursor, e.shiftKey);
		}
	}
	onMount(() => {
		window.addEventListener('keydown', onListKeydown);
		return () => window.removeEventListener('keydown', onListKeydown);
	});

	/**
	 * Row keyboard: interactive selects keep their keys; in selection mode Space checks the row and
	 * Enter keeps the detail; the Menu key (or Maj+F10) makes the row the cursor before its menu opens.
	 */
	function onRowKeydown(tx: Transaction, e: KeyboardEvent, index: number) {
		if (isMenuKey(e)) cursor = index;
		if (e.key === 'Enter' || e.key === ' ') {
			if ((e.target as HTMLElement).tagName === 'SELECT') return;
			e.preventDefault();
			if (selectMode && selectable(tx) && e.key === ' ') toggleSelected(tx, index, e.shiftKey);
			else toggleDetail(tx);
		}
	}

	/** Click on a row: checks it in selection mode, otherwise opens the detail; the click ending a slide does nothing. */
	function onRowClick(tx: Transaction, e: MouseEvent, index: number) {
		if (swallowClick) {
			swallowClick = false;
			return;
		}
		if (selectMode && selectable(tx)) toggleSelected(tx, index, e.shiftKey);
		else toggleDetail(tx);
	}

	// ---- Right-click menus (contextMenu.svelte.ts): a row, then a category header, then the whole list ----

	/** Only the operations of a row's merchant (search box, no debounce), its category unfolded in the category mode. */
	function filterMerchant(tx: Transaction) {
		searchInput = search = merchantSearchQuery(tx);
		unfold(catOfTx(tx));
	}

	/** Entry filtering the list on a category, or lifting that filter when it is the one applied (like « Toutes catégories »). */
	function categoryFilterEntry(id: CategoryId): MenuAction {
		return categoryFilter === id
			? { label: 'Retirer le filtre catégorie', onSelect: () => (categoryFilter = '') }
			: { label: 'Filtrer sur cette catégorie', onSelect: () => filterCategory(id) };
	}

	/**
	 * Category change of a row through the setter its select uses, null when the category is fixed: an
	 * override with the learned-rule offer for a bank operation, the wallet for a cash entry; a portage
	 * entry and the wallet write-off keep theirs.
	 */
	function categorySetter(tx: Transaction): ((id: CategoryId) => void) | null {
		if (tx.source === 'portage') return null;
		if (tx.source !== 'cash') return (id) => setOverrideAndPrompt(tx, id);
		return cashCategoryEditable(tx) ? (id) => setCashCategory(tx, id) : null;
	}

	/**
	 * Right-click entries of a row (table row or phone card), with the same setters, toasts and undo as
	 * its select, its bin and its detail panel. On a checked row of a selection of several, the category
	 * and the budget entries act on the whole selection, like the bar above the list.
	 */
	function rowActions(tx: Transaction, index: number): MenuInput[] {
		const key = txKey(tx);
		const catId = catOfTx(tx);
		const many = selectMode && selected.has(key) && selected.size > 1;
		const setCategory = categorySetter(tx);
		const merchant = merchantSearchQuery(tx);
		const hidden = many ? selectedTxs.filter((t) => isExcluded(txKey(t))) : [];
		return [
			{ label: expandedKey === key ? 'Fermer le détail' : 'Ouvrir le détail', hint: 'Entrée', onSelect: () => toggleDetail(tx) },
			many
				? { label: `Catégorie des ${selected.size} sélectionnées`, items: CATEGORIES.map((c) => ({ label: c.label, category: c.id, onSelect: () => bulkCategory(c.id) })) }
				: setCategory && { label: 'Catégorie', items: CATEGORIES.map((c) => ({ label: c.label, category: c.id, disabled: c.id === catId, onSelect: () => setCategory(c.id) })) },
			merchant !== '' &&
				(searchInput.trim().toLowerCase() === merchant.toLowerCase()
					? { label: 'Retirer le filtre marchand', onSelect: () => (searchInput = search = '') }
					: { label: 'Filtrer sur ce marchand', onSelect: () => filterMerchant(tx) }),
			categoryFilterEntry(catId),
			selectable(tx) && { label: selected.has(key) ? 'Désélectionner' : 'Sélectionner', hint: 'X', onSelect: () => toggleSelected(tx, index) },
			many && selected.size > hidden.length && { label: 'Masquer la sélection du budget', onSelect: () => bulkExclude(true) },
			many && hidden.some((t) => !isWalletWithdrawal(txKey(t))) && { label: 'Réintégrer la sélection au budget', onSelect: () => bulkExclude(false) },
			!many && !isComputedEntry(tx) && !isWalletWithdrawal(key) && { label: isExcluded(key) ? 'Réintégrer au budget' : 'Masquer du budget', hint: 'M', onSelect: () => toggleInternal(tx) },
			SEPARATOR,
			!many && tx.source !== 'portage' && { label: 'Supprimer', danger: true, onSelect: () => (tx.source === 'cash' ? onDeleteCash(tx) : onDeleteTx(tx)) }
		];
	}

	/** Right-click entries of a category header (category mode); the list adds the grouping, « Tout déplier / replier » and the months. */
	function headActions(id: CategoryId): MenuInput[] {
		const othersOpen = (categoryView?.groups ?? []).some((g) => g.id !== id && !foldedCats.has(g.id));
		return [
			{ label: foldedCats.has(id) ? 'Déplier' : 'Replier', onSelect: () => toggleFold(id) },
			othersOpen && { label: 'Ne déplier que celle-ci', onSelect: () => unfoldOnly(id) },
			categoryFilterEntry(id)
		];
	}

	/**
	 * Right-click entries of the whole list, after those of a row or a header: the grouping and, in the
	 * category mode, the folds that would change something and the month stepper (← / →).
	 */
	function listActions(): MenuInput[] {
		const groups = categoryView?.groups ?? [];
		const byCategory = sortKey === 'category';
		return [
			sortKey !== 'category' && { label: 'Grouper par catégorie', onSelect: () => setGrouping('category') },
			sortKey !== 'date' && { label: 'Grouper par date', onSelect: () => setGrouping('date') },
			byCategory && groups.some((g) => foldedCats.has(g.id)) && { label: 'Tout déplier', onSelect: unfoldAll },
			byCategory && groups.some((g) => !foldedCats.has(g.id)) && { label: 'Tout replier', onSelect: foldAll },
			byCategory && !vacationFilter && { label: 'Mois précédent', hint: '←', disabled: !prevMonth, onSelect: () => stepPeriod(-1) },
			byCategory && !vacationFilter && { label: 'Mois suivant', hint: '→', disabled: !nextMonth, onSelect: () => stepPeriod(1) }
		];
	}

	/** Sort arrow for the active header. */
	function sortArrow(key: SortKey): string {
		if (sortKey !== key) return '';
		return sortDir === 'desc' ? ' ▼' : ' ▲';
	}
</script>

{#if txState.loadError}
	<div class="card p-6 text-sm" style="color: var(--amber);">
		{txState.loadError} — vérifiez que <code>/data/transactions.json</code> est accessible.
	</div>
{:else if !txState.loaded}
	<!-- First load: shimmer skeletons -->
	<header class="mb-5">
		<Skeleton h={28} w={200} class="mb-2" />
		<Skeleton h={14} w={160} />
	</header>
	<Skeleton h={56} rounded={8} class="mb-4" />
	<Skeleton h={52} rounded={8} class="mb-4" />
	<div class="card overflow-hidden p-4">
		{#each [95, 88, 92, 85, 90] as w, i (i)}
			<Skeleton h={20} class="mb-3.5" w="{w}%" />
		{/each}
	</div>
{:else}
	<!-- Header: title, counter, filtered totals -->
	<header class="mb-3 flex flex-wrap items-end justify-between gap-4">
		<div>
			<PageTitle title="Transactions" />
			<p class="meta-xs mt-1">
				<span class="tabular">{filtered.length}</span> affichée{filtered.length > 1 ? 's' : ''} / {allTxs.length}
				au total · revenus <span class="tabular" style="color: var(--accent);">{formatEUR(totals.credit)}</span>
				· dépenses <span class="tabular">{formatEUR(totals.debit)}</span>{#if filtersActive}&nbsp;(sélection){/if}
				<span class="text-secondary" title="Même calcul que le Budget : remboursements déduits ; virements masqués, épargne, Kraken/Natixis et opérations en cours exclus">ⓘ</span>
			</p>
		</div>
		{#if deletedCount() > 0 || txState.imported.length > 0}
			<div class="flex flex-wrap items-center gap-x-4 gap-y-1">
				{#if deletedCount() > 0}
					<button
						type="button"
						class="cursor-pointer text-xs font-medium transition-colors hover:underline"
						style="color: var(--accent);"
						title="Les opérations que vous avez supprimées redeviennent importables"
						onclick={onRestoreDeleted}
					>
						Restaurer les opérations supprimées ({deletedCount()})
					</button>
				{/if}
				{#if txState.imported.length > 0}
					<button
						type="button"
						class="cursor-pointer text-xs font-medium transition-colors hover:underline"
						style="color: var(--amber);"
						title="Supprime les {txState.imported.length} transactions importées"
						onclick={onResetImported}
					>
						Réinitialiser les données ({txState.imported.length} importée{txState.imported.length > 1 ? 's' : ''})
					</button>
				{/if}
			</div>
		{/if}
	</header>

	<!-- Hidden file input (CSV/XLSX import, formats detected automatically) -->
	<input
		bind:this={fileInput}
		type="file"
		accept=".csv,.xlsx,.ofx,.qfx,.qif,.xml,.zip,text/csv,application/zip"
		class="hidden"
		onchange={(e) => {
			void handleFile((e.target as HTMLInputElement).files?.[0]);
			(e.target as HTMLInputElement).value = ''; // réimport du même fichier possible
		}}
	/>

	<!-- Learned categorisation rules (collapsible panel) -->
	<RulesCard />

	<!-- Import feedback -->
	{#if importsLine.length > 0 || reminders.length > 0}
		<p class="meta-xs mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
			{#if importsLine.length > 0}<span>Derniers imports : {importsLine.join(' · ')}</span>{/if}
			{#each reminders as r (r.source)}
				<span class="chip chip-amber">{r.text}</span>
			{/each}
		</p>
	{/if}
	{#if txState.feedback}
		{@const fb = txState.feedback}
		<div
			class="toast-in card mb-4 p-4 text-sm"
			style={fb.errors.length > 0 ? 'border-color: var(--amber);' : 'border-color: var(--accent);'}
			role="status"
		>
			<div class="flex items-start justify-between gap-3">
				<div>
					<p class="font-medium">
						{fb.added} opération{fb.added > 1 ? 's' : ''} ajoutée{fb.added > 1 ? 's' : ''}
						· {fb.duplicates} doublon{fb.duplicates > 1 ? 's' : ''} ignoré{fb.duplicates > 1 ? 's' : ''}
						{#if fb.enriched > 0}· {fb.enriched} enrichie{fb.enriched > 1 ? 's' : ''} des catégories banque{/if}
						{#if fb.ignored > 0}· {fb.ignored} ligne{fb.ignored > 1 ? 's' : ''} illisible{fb.ignored > 1 ? 's' : ''}{/if}
						<span class="meta-xs">— {fb.fileName}</span>
					</p>
					{#if fb.accounts.length > 0}
						<p class="meta-xs mt-1">{fb.accounts.join(' · ')}</p>
					{/if}
					{#if fb.resurrectedBlocked > 0}
						<p class="meta-xs mt-1" style="color: var(--amber);">
							{fb.resurrectedBlocked} ligne{fb.resurrectedBlocked > 1 ? 's' : ''} déjà supprimée{fb.resurrectedBlocked > 1 ? 's' : ''} par vos soins, non réimportée{fb.resurrectedBlocked > 1 ? 's' : ''}
						</p>
					{/if}
					{#if fb.maskedTransfers}
						<!-- Internal transfers already hidden from the budget in this batch (v13) -->
						<p class="meta-xs mt-1" style="color: var(--text-2);">
							{fb.maskedTransfers} virement{fb.maskedTransfers > 1 ? 's' : ''} interne{fb.maskedTransfers > 1 ? 's' : ''} masqué{fb.maskedTransfers > 1 ? 's' : ''} du budget
						</p>
					{/if}
					{#if fb.quickMatched}
						<p class="meta-xs mt-1" style="color: var(--text-2);">
							{fb.quickMatched} saisie{fb.quickMatched > 1 ? 's' : ''} rapide{fb.quickMatched > 1 ? 's' : ''} remplacée{fb.quickMatched > 1 ? 's' : ''} par l'opération de la banque ·
							<button type="button" class="cursor-pointer hover:underline" style="color: var(--accent);" onclick={() => { const n = undoQuickMatches(); if (txState.feedback) txState.feedback = { ...txState.feedback, quickMatched: 0 }; showToast(`${n} saisie${n > 1 ? 's' : ''} rapide${n > 1 ? 's' : ''} rétablie${n > 1 ? 's' : ''}, plus jamais rapprochée${n > 1 ? 's' : ''} automatiquement`); }}>ce n'est pas la même opération</button>
						</p>
					{/if}
					{#if fb.knownElsewhere}
						<!-- OFX/QIF/CAMT statement: movements already imported through another export (anti-duplicate guard) -->
						<p class="meta-xs mt-1" style="color: var(--text-2);">
							{fb.knownElsewhere} opération{fb.knownElsewhere > 1 ? 's' : ''} déjà présente{fb.knownElsewhere > 1 ? 's' : ''} via un autre export (même compte, date et montant), non ajoutée{fb.knownElsewhere > 1 ? 's' : ''}
						</p>
					{/if}
					{#if fb.errors.length > 0}
						<ul class="mt-1.5 space-y-0.5 text-xs" style="color: var(--amber);">
							{#each fb.errors.slice(0, 6) as err (err)}
								<li>{err}</li>
							{/each}
							{#if fb.errors.length > 6}
								<li>… et {fb.errors.length - 6} autre{fb.errors.length - 6 > 1 ? 's' : ''}</li>
							{/if}
						</ul>
					{/if}
					{#if fb.ignored > 0 && lastFile}
						<button
							type="button"
							class="press mt-2 cursor-pointer text-xs font-medium transition-colors hover:underline"
							style="color: var(--accent);"
							onclick={() => void openRemapper()}
						>
							Corriger les colonnes du fichier
						</button>
					{/if}
				</div>
				<button
					type="button"
					class="cursor-pointer text-secondary transition-colors hover:text-[var(--text)]"
					aria-label="Fermer le feedback"
					onclick={() => (txState.feedback = null)}
				>
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true">
						<path d="M6 6l12 12M18 6L6 18" />
					</svg>
				</button>
			</div>
		</div>
	{/if}

	<!-- Single bar: search + filters on the left, imports on the right -->
	<section class="card hero-in-2 mb-3 flex flex-wrap items-center gap-2 p-3">
		<div class="relative min-w-44 flex-1">
			<svg
				class="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-secondary"
				width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"
			>
				<circle cx="11" cy="11" r="7" />
				<path d="m20 20-3.5-3.5" />
			</svg>
			<input
				type="search"
				placeholder="Rechercher (libellé, note, tags)…"
				class="input-surface w-full !pl-8"
				bind:value={searchInput}
			/>
		</div>
		<select class="input-surface cursor-pointer" bind:value={categoryFilter} aria-label="Filtrer par catégorie">
			<option value="">Toutes catégories</option>
			{#each CATEGORIES as cat (cat.id)}
				<option value={cat.id}>{cat.label}</option>
			{/each}
		</select>
		<select class="input-surface cursor-pointer" bind:value={typeFilter} aria-label="Filtrer par type">
			<option value="all">Tous types</option>
			<option value="CRDT">Crédits</option>
			<option value="DBIT">Débits</option>
		</select>
		<DateRangePicker bind:from={dateFrom} bind:to={dateTo} {months} />
		{#if accountOptions.length > 1}
			<select class="input-surface max-w-44 cursor-pointer" bind:value={accountFilter} aria-label="Filtrer par compte">
				<option value="">Tous comptes</option>
				{#each accountOptions as a (a.id)}
					<option value={a.id}>{a.label}</option>
				{/each}
			</select>
		{/if}
		{#if tagCounts.length > 0 || tagFilter !== null}
			<select
				class="input-surface max-w-48 cursor-pointer"
				value={tagFilter ?? ''}
				onchange={(e) => (tagFilter = (e.target as HTMLSelectElement).value || null)}
				aria-label="Filtrer par tag"
				title="Opérations d'un tag : leur total s'affiche en tête de page"
			>
				<option value="">Tous tags</option>
				{#each tagCounts as t (t.tag)}
					<option value={t.tag}>{t.tag} ({t.count})</option>
				{/each}
				{#if tagFilter !== null && !tagCounts.some((t) => t.tag === tagFilter)}
					<option value={tagFilter}>{tagFilter} (0)</option>
				{/if}
			</select>
		{/if}
		{#if internalCount() > 0}
			<!-- 'Virements internes' chip (SPEC v13 §C.3): review the excluded ones -->
			<button
				type="button"
				class="press cursor-pointer rounded-full border px-3 py-1.5 text-xs font-medium transition-colors"
				style={internalOnly
					? 'border-color: var(--accent); background-color: var(--accent-soft); color: var(--accent);'
					: 'border-color: var(--hairline); color: var(--text-2);'}
				aria-pressed={internalOnly}
				title="Virements entre vos comptes — masqués des totaux du budget, comptés dans les soldes"
				onclick={() => (internalOnly = !internalOnly)}
			>
				Virements internes · <span class="tabular">{internalCount()}</span>
			</button>
		{/if}
		{#if subFilter !== undefined}
			<!-- Subcategory filter (from the donut): accent chip with a cross -->
			<button
				type="button"
				class="chip chip-accent press cursor-pointer"
				title="Retirer le filtre de sous-catégorie"
				onclick={() => (subFilter = undefined)}
			>
				{subFilter === null ? 'Sans sous-catégorie' : (getSubcategory(subFilter)?.label ?? subFilter)}
				<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
			</button>
		{/if}
		{#if filtersActive}
			<button
				type="button"
				class="press cursor-pointer rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-[var(--surface-hover)]"
				style="color: var(--accent);"
				onclick={resetFilters}
			>
				Réinitialiser
			</button>
		{/if}
		<div class="ml-auto flex items-center">
			<button
				type="button"
				class="btn btn-primary btn-sm"
				disabled={importing}
				title="Panneau Imports : relevés de toute banque, exports, PDF (Krak, Natixis, impôts, InfoPortage, véhicule), format reconnu tout seul ; ou glissez les fichiers n'importe où"
				onclick={() => (uiState.importPanelOpen = true)}
			>
				{importing ? 'Import en cours…' : 'Importer'}
			</button>
		</div>
	</section>

	<!-- Active tag / purchase-day filters on the left (the day filter only applies to the list); bulk selection and view (Liste | Calendrier) on the right -->
	<div class="mb-2 flex flex-wrap items-center gap-2">
		{#if tagFilter !== null}
			<button type="button" class="chip chip-accent press cursor-pointer" title="Retirer le filtre de tag" onclick={() => (tagFilter = null)}>
				tag « {tagFilter} »
				<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
			</button>
		{/if}
		{#if dayFilter && view === 'liste'}
			<button
				type="button"
				class="chip chip-accent press cursor-pointer"
				title="Achats faits ce jour-là (date lue dans le libellé carte) ; la colonne Date montre la date comptable. Cliquer pour retirer."
				onclick={() => {
					dayFilter = '';
					dayTo = '';
				}}
			>
				{dayTo ? `achats ${rangeLabel(dayFilter, dayTo)}` : `achats du ${formatDate(dayFilter)}`}
				<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
			</button>
			<button type="button" class="btn btn-secondary btn-sm" title="Ces jours d'achat deviennent une période de vacances (renommable dans Budget › Périodes de vacances)" onclick={vacationFromDays}>
				Créer une période de vacances
			</button>
		{/if}
		{#if view === 'liste' && sortKey === 'category'}
			<!-- Category mode period: whole months stepped with ‹ › (months without operations skipped), written in the period picker, which stays the source of truth; none in holiday mode, where the holiday sets the period -->
			{#if !vacationFilter}
				<div class="period-step flex items-center overflow-hidden rounded-full border" style="border-color: var(--hairline);" role="group" aria-label="Période de la vue par catégorie" use:segmented>
					<button
						type="button"
						class="press cursor-pointer py-1 pr-1 pl-2.5 text-xs font-medium transition-colors duration-150 disabled:cursor-default disabled:opacity-30"
						style="color: var(--text-2);"
						disabled={!prevMonth}
						aria-label="Mois précédent"
						title={prevMonth ? `${formatMonth(prevMonth)} (←)` : 'Aucun mois plus ancien avec des opérations'}
						onclick={() => stepPeriod(-1)}
					>
						‹
					</button>
					<button
						type="button"
						class="press tabular min-w-[7.5rem] cursor-pointer px-1.5 py-1 text-center text-xs font-medium transition-colors duration-150"
						style={periodMonth ? 'color: var(--accent);' : 'color: var(--text-2);'}
						aria-pressed={periodMonth !== ''}
						disabled={!stepperMonth}
						title={periodMonth ? 'Mois affiché : les flèches passent au mois précédent ou suivant qui a des opérations (← / →)' : 'Afficher ce mois seulement'}
						onclick={() => setMonth(stepperMonth)}
					>
						{stepperMonth ? formatMonth(stepperMonth) : 'Aucun mois'}
					</button>
					<button
						type="button"
						class="press cursor-pointer py-1 pr-2.5 pl-1 text-xs font-medium transition-colors duration-150 disabled:cursor-default disabled:opacity-30"
						style="color: var(--text-2);"
						disabled={!nextMonth}
						aria-label="Mois suivant"
						title={nextMonth ? `${formatMonth(nextMonth)} (→)` : 'Aucun mois plus récent avec des opérations'}
						onclick={() => stepPeriod(1)}
					>
						›
					</button>
					<button
						type="button"
						class="press cursor-pointer border-l px-3 py-1 text-xs font-medium transition-colors duration-150"
						style="border-color: var(--hairline); {wholePeriod ? 'color: var(--accent);' : 'color: var(--text-2);'}"
						aria-pressed={wholePeriod}
						title="Toutes les dates : le sélecteur de période se vide"
						onclick={clearPeriod}
					>
						Toute la période
					</button>
				</div>
			{/if}
			{#if categoryView && categoryView.groups.length > 0}
				<button type="button" class="meta-xs cursor-pointer hover:underline" onclick={() => (allFolded ? unfoldAll() : foldAll())}>
					{allFolded ? 'Tout déplier' : 'Tout replier'}
				</button>
			{/if}
		{/if}
		<div class="ml-auto flex flex-wrap items-center justify-end gap-2">
			{#if view === 'liste'}
				<span class="hidden md:inline-flex"><RowsToggle /></span>
				<button
					type="button"
					class="btn btn-sm {selectMode ? 'btn-accent' : 'btn-secondary'}"
					aria-pressed={selectMode}
					title="Cocher plusieurs opérations pour changer leur catégorie ou leurs tags d'un coup (touche X sur la ligne courante, Maj+clic pour un intervalle)"
					onclick={() => (selectMode ? exitSelect() : (selectMode = true))}
				>
					{selectMode ? 'Terminer la sélection' : 'Sélectionner'}
				</button>
				<!-- Date or category grouping (the column headers keep sorting; a Débit/Crédit sort leaves both off) -->
				<div class="flex overflow-hidden rounded-full border" style="border-color: var(--hairline);" role="group" aria-label="Regroupement de la liste" use:segmented>
					{#each GROUPINGS as opt (opt.id)}
						<button
							type="button"
							class="press cursor-pointer px-3 py-1 text-xs font-medium transition-colors duration-150"
							style={opt.id === sortKey ? 'background-color: var(--accent-soft); color: var(--accent);' : 'color: var(--text-2);'}
							aria-pressed={opt.id === sortKey}
							aria-label={opt.label}
							title={opt.title}
							onclick={() => setGrouping(opt.id)}
						>
							<span class="hidden sm:inline">{opt.label}</span><span class="sm:hidden">{opt.short}</span>
						</button>
					{/each}
				</div>
			{/if}
			<div class="flex overflow-hidden rounded-full border" style="border-color: var(--hairline);" role="group" aria-label="Vue de la page" use:segmented>
				{#each VIEWS as opt (opt.id)}
					<button
						type="button"
						class="press cursor-pointer px-3 py-1 text-xs font-medium transition-colors duration-150"
						style={opt.id === view ? 'background-color: var(--accent-soft); color: var(--accent);' : 'color: var(--text-2);'}
						aria-pressed={opt.id === view}
						title={opt.title}
						onclick={() => showView(opt.id)}
					>
						{opt.label}
					</button>
				{/each}
			</div>
		</div>
	</div>

	{#if minAmount !== null || maxAmount !== null}
		<p class="meta-xs mb-2 flex items-center gap-2">
			<span class="chip chip-accent">montant {minAmount !== null ? `≥ ${formatEUR(minAmount)}` : ''}{minAmount !== null && maxAmount !== null ? ' et ' : ''}{maxAmount !== null ? `≤ ${formatEUR(maxAmount)}` : ''}</span>
			<button type="button" class="cursor-pointer hover:underline" onclick={() => { minAmount = null; maxAmount = null; }}>retirer</button>
		</p>
	{/if}
	{#if vacationFilter}
		{@const checks = filtered.filter((t) => vacationStatus(t) === 'check' || vacationStatus(t) === 'refund').length}
		<!-- Holiday mode: reminder of the period, and count of the rows to check -->
		<div class="card mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-[13px]" style="border-color: var(--accent);">
			<span class="font-medium">Vacances « {vacationFilter.label} »</span>
			<span class="text-secondary">du {formatDate(vacationFilter.start)} au {formatDate(vacationFilter.end)}, plus 5 jours de comptabilisation</span>
			{#if checks > 0}
				<span class="chip chip-amber">{checks} à vérifier</span>
				<span class="meta-xs">dépenses comptabilisées après la période sans date d'achat lisible : si c'était pendant les vacances, choisissez « Vacances » dans le select</span>
			{:else}
				<span class="chip chip-accent">rien à vérifier</span>
			{/if}
		</div>
	{/if}

	{#if view === 'liste'}
	{#if selectMode}
		{@const excludedCount = selectedTxs.filter((t) => isExcluded(txKey(t))).length}
		{@const restorableCount = selectedTxs.filter((t) => isExcluded(txKey(t)) && !isWalletWithdrawal(txKey(t))).length}
		<!-- Selection actions: bar stuck to the top of the screen while scrolling (the 'Annuler' toast stays visible at the bottom) -->
		<div class="bulk-bar card mb-3 flex flex-wrap items-center gap-2 px-3 py-2 text-[12px]" role="toolbar" aria-label="Actions sur la sélection">
			<span class="font-medium"><span class="tabular">{selected.size}</span> sélectionnée{selected.size > 1 ? 's' : ''}</span>
			{#if selected.size > 0}
				<span class="tabular {selectedTotal > 0 ? 'text-accent' : 'text-secondary'}" title="Net des opérations sélectionnées, comptées comme les totaux de la page : sans les opérations en cours ni les virements masqués">{selectedTotal > 0 ? '+' : selectedTotal < 0 ? '−' : ''}{formatEUR(Math.abs(selectedTotal))}</span>
			{/if}
			{#if selected.size < selectableListed.length}
				<button type="button" class="meta-xs cursor-pointer hover:underline" onclick={selectAllFiltered}>tout sélectionner ({selectableListed.length})</button>
			{/if}
			{#if selected.size > 0}
				<button type="button" class="meta-xs cursor-pointer hover:underline" onclick={() => (selected = new Set())}>aucune</button>
			{/if}
			<span class="mx-1 hidden h-4 w-px sm:block" style="background-color: var(--hairline);" aria-hidden="true"></span>
			<select
				class="input-surface cursor-pointer"
				disabled={selected.size === 0}
				aria-label="Catégorie de la sélection"
				value=""
				onchange={(e) => {
					const el = e.target as HTMLSelectElement;
					const v = el.value;
					el.value = '';
					if (v) bulkCategory(v as CategoryId);
				}}
			>
				<option value="">Catégorie…</option>
				{#each CATEGORIES as cat (cat.id)}
					<option value={cat.id}>{cat.label}</option>
				{/each}
			</select>
			<input
				type="text"
				class="input-surface w-36"
				list="tx-tags-list"
				placeholder="+ tag (Entrée)"
				aria-label="Ajouter un tag à la sélection"
				disabled={selected.size === 0}
				bind:value={bulkTagDraft}
				onkeydown={onBulkTagKeydown}
			/>
			<datalist id="tx-tags-list">
				{#each tagCounts as t (t.tag)}
					<option value={t.tag}></option>
				{/each}
			</datalist>
			{#if selectedTagCounts.length > 0}
				<select
					class="input-surface cursor-pointer"
					aria-label="Retirer un tag de la sélection"
					value=""
					onchange={(e) => {
						const el = e.target as HTMLSelectElement;
						const v = el.value;
						el.value = '';
						if (v) bulkTags('remove', [v]);
					}}
				>
					<option value="">− tag…</option>
					{#each selectedTagCounts as t (t.tag)}
						<option value={t.tag}>{t.tag} ({t.count})</option>
					{/each}
				</select>
			{/if}
			{#if selected.size > excludedCount}
				<button type="button" class="btn btn-secondary btn-sm" title="Retirer des entrées/sorties et du budget ; elles restent comptées dans les soldes" onclick={() => bulkExclude(true)}>Masquer du budget</button>
			{/if}
			{#if restorableCount > 0}
				<button type="button" class="btn btn-secondary btn-sm" onclick={() => bulkExclude(false)}>Réintégrer au budget</button>
			{/if}
			<button type="button" class="btn btn-secondary btn-sm ml-auto" onclick={exitSelect}>Terminer <kbd class="kbd">Échap</kbd></button>
		</div>
	{/if}

	<!-- Desktop table (≥ md); the anchor above it is where ← → paging scrolls back to -->
	<div bind:this={listTop} class="scroll-mt-3" aria-hidden="true"></div>
	<section class="card hero-in-3 no-callout mb-3 hidden overflow-hidden md:block" use:slideSurface use:contextActions={listActions}>
		<div class="overflow-x-auto">
			<table class="w-full min-w-[760px] border-collapse text-[12px]">
				<thead>
					<tr class="text-left">
						{#if selectMode}
							<th class="sticky-th w-8 py-2 pr-0 pl-4">
								<input
									type="checkbox"
									class="cursor-pointer align-middle"
									checked={pageSelectable.length > 0 && pageSelectedCount === pageSelectable.length}
									use:indeterminate={pageSelectedCount > 0 && pageSelectedCount < pageSelectable.length}
									disabled={pageSelectable.length === 0}
									aria-label="Cocher toute la page"
									onclick={togglePage}
								/>
							</th>
						{/if}
						<th class="sticky-th px-4 py-2">
							<button type="button" class="label-plain cursor-pointer transition-colors hover:text-[var(--text)]" onclick={() => toggleSort('date')}>
								Date{sortArrow('date')}
							</button>
						</th>
						<th class="sticky-th label-plain px-4 py-2" colspan="2">Libellé</th>
						<th class="sticky-th px-4 py-2">
							<button type="button" class="label-plain cursor-pointer transition-colors hover:text-[var(--text)]" onclick={() => toggleSort('category')}>
								Catégorie{sortArrow('category')}
							</button>
						</th>
						{#if hasTags}<th class="sticky-th label-plain px-4 py-2">Tags</th>{/if}
						{#if hasChecked}<th class="sticky-th label-plain px-2 py-2 text-center">Pointée</th>{/if}
						<th class="sticky-th px-4 py-2 text-right">
							<button type="button" class="label-plain cursor-pointer transition-colors hover:text-[var(--text)]" onclick={() => toggleSort('debit')}>
								Débit{sortArrow('debit')}
							</button>
						</th>
						<th class="sticky-th px-4 py-2 text-right">
							<button type="button" class="label-plain cursor-pointer transition-colors hover:text-[var(--text)]" onclick={() => toggleSort('credit')}>
								Crédit{sortArrow('credit')}
							</button>
						</th>
						{#if hasBalance}<th class="sticky-th label-plain px-4 py-2 text-right">Solde</th>{/if}
						<th class="sticky-th w-10 px-2 py-2" aria-label="Actions"></th>
					</tr>
				</thead>
				<tbody class="rows">
					<!-- Empty first row: a sentence typed there becomes an operation (QuickEntryRow) -->
					<tr class="border-b" style="border-color: var(--border-subtle); background-color: color-mix(in srgb, var(--accent) 5%, transparent);">
						<td colspan={colCount} class="p-0"><QuickEntryRow /></td>
					</tr>
					{#each paginated as tx, rowIndex (txKey(tx))}
						{@const amount = signedAmount(tx)}
						{@const catId = categorize(tx, budgetState.overrides, undefined, getMerchantCategoryMap())}
						{@const sub = getSubcategory(subcategorize(tx, budgetState.overrides, undefined, getMerchantCategoryMap()) ?? '')}
						{@const expanded = expandedKey === txKey(tx)}
						{@const isSelected = selected.has(txKey(tx))}
						{@const newDay = dayStarts[rowIndex] ?? false}
						{@const showDate = sortKey !== 'date' || newDay || !dayOf(tx)}
						{@const day = dayOf(tx) ? dayTotals?.get(dayOf(tx)) : undefined}
						{#each catHeads?.before[rowIndex] ?? [] as head (head.group.id)}
							{@render categoryHeadRow(head)}
						{/each}
						<!-- Sorted by date, the date alone is written once per day (and on the first row of a page) under a full rule; the day's net is in the date cell's tooltip on every row of the day -->
						<tr
							class="row row-hover press group cursor-pointer border-t transition-colors select-none"
							class:row-cursor={cursor === rowIndex}
							class:row-selected={isSelected}
							class:quick-pending={tx.source === 'manual'}
							style="border-color: var({newDay && rowIndex > 0 ? '--hairline' : '--border-subtle'});"
							data-row-index={rowIndex}
							tabindex="0"
							aria-expanded={expanded}
							aria-selected={selectMode ? isSelected : undefined}
							onclick={(e) => onRowClick(tx, e, rowIndex)}
							onkeydown={(e) => onRowKeydown(tx, e, rowIndex)}
							onpointerdown={(e) => onRowPointerDown(e, rowIndex)}
							oncontextmenu={(e) => onRowContextMenu(e, rowIndex)}
							use:contextActions={() => rowActions(tx, rowIndex)}
						>
							{#if selectMode}
								<td class="w-8 py-1 pr-0 pl-4">
									{#if selectable(tx)}
										<input
											type="checkbox"
											class="cursor-pointer align-middle"
											checked={isSelected}
											aria-label="Sélectionner {displayLabel(tx)}"
											onclick={(e) => {
												e.stopPropagation();
												toggleSelected(tx, rowIndex, e.shiftKey);
											}}
										/>
									{/if}
								</td>
							{/if}
							<td class="tabular px-4 py-1 whitespace-nowrap {newDay && dayOf(tx) ? 'font-medium' : 'text-secondary'}" title={day && day.count > 1 ? dayNetTitle(day) : undefined}>
								{#if showDate}
									{tx.booking_date ? formatDateShort(tx.booking_date) : '—'}
									{#if newDay && day && day.count > 1}<span class="sr-only"> net du jour : {formatEUR(day.net)}</span>{/if}
								{:else}
									<span class="sr-only">{tx.booking_date ? formatDate(tx.booking_date) : 'en cours'}</span>
								{/if}
							</td>
							<td class="w-px py-1 pr-0 pl-4">
								<MerchantMark label={displayLabel(tx)} id={catId} size={22} title />
							</td>
							<td class="w-full max-w-0 min-w-48 py-1 pr-4 pl-2.5">
								<p class="truncate leading-[1.4] font-medium" title={rawLabel(tx)}>
									{displayLabel(tx)}
									{#if isExcluded(txKey(tx))}
										{@const excluded = excludedBadge(txKey(tx))}
										<!-- Internal transfer hidden from the budget (neutral badge, never red) -->
										<span class="chip chip-outline ml-2" title={excluded.title}>{excluded.label}</span>
									{/if}
									{#if (uiState.accountBadges || isComputedEntry(tx)) && accountBadge(tx)}
										{@const badge = accountBadge(tx)!}
										<span class="chip chip-muted ml-2" title={badge.title} aria-label={badge.title}>{badge.label}</span>
									{/if}
									{#if isPending(tx) && !isPlannedInstalment(tx)}
										<span class="chip chip-amber ml-2">En cours</span>
									{/if}
									<InstalmentChip {tx} class="ml-2" />
									{#if refundOf(txKey(tx))}
										{@const r = refundOf(txKey(tx))!}
										<span class="chip {r.state === 'refunded' ? 'chip-accent' : r.state === 'overdue' ? 'chip-amber' : 'chip-outline'} ml-2" title={r.claim.shared ? `Dépense partagée avec ${r.claim.who} : ${r.state === 'refunded' ? `${formatEUR(r.refunded)} reçus` : `part attendue de ${formatEUR(shareRange(r.claim.expected).min)} à ${formatEUR(shareRange(r.claim.expected).max)}`}` : `Remboursement attendu de ${r.claim.who} : ${formatEUR(r.refunded)} reçus sur ${formatEUR(r.claim.expected)}`}>{r.state === 'refunded' ? 'remboursé' : r.state === 'overdue' ? 'remboursement en retard' : r.state === 'closed' ? 'soldé' : 'à rembourser'}</span>
									{:else if refundedBy(txKey(tx)).length}
										<span class="chip chip-accent ml-2" title="Rembourse une dépense : compté en déduction de sa catégorie">remboursement</span>
									{/if}
									{#if tx.source === 'manual' && !isPlannedInstalment(tx)}
										{#if quickEntryStale(tx)}
											<span class="chip chip-amber ml-2" title="Saisie rapide absente du relevé alors qu'il couvre plus d'une semaine après : montant, compte ou date différents ?">absente du relevé</span>
										{:else}
											<span class="chip chip-outline ml-2" title="Saisie rapide : comptée tout de suite, remplacée par l'opération de la banque à l'import du relevé">à rapprocher</span>
										{/if}
									{/if}
									{#if vacationStatus(tx) === 'check'}
										<button type="button" class="chip chip-amber ml-2 cursor-pointer" title="Comptabilisée après la période : cliquez pour la rattacher à ces vacances" onclick={(e) => { e.stopPropagation(); onAssignVacation(tx, vacationFilter?.id ?? null); }}>à vérifier → Vacances</button>
									{:else if vacationStatus(tx) === 'refund'}
										<button type="button" class="chip chip-amber ml-2 cursor-pointer" title="Virement reçu pendant la période : cliquez pour le déduire de ces vacances (remboursement d'un ami)" onclick={(e) => { e.stopPropagation(); onAssignVacation(tx, vacationFilter?.id ?? null); }}>remboursement ? → Vacances</button>
									{:else if vacationStatus(tx) === 'in'}
										<span class="chip chip-accent ml-2">vacances</span>
									{/if}
								</p>
								{#if tx.note}
									<p class="row-sub meta-xs mt-0.5 truncate">{isComputedEntry(tx) ? maskAmounts(tx.note) : tx.note}</p>
								{/if}
							</td>
							<td class="px-4 py-1" onclick={(e) => e.stopPropagation()}>
								<div class="flex items-center gap-2">
									{#if tx.source === 'portage'}
										<!-- Computed entry: category fixed by the Portage tab -->
										<span class="input-surface w-32 shrink-0 truncate text-secondary" title="Catégorie fixée par l'onglet Portage">{getCategory(catId).label}</span>
									{:else if tx.source === 'cash'}
										<!-- Cash wallet entry: the typed category lives in the wallet; a write-off always counts in « Autre », even during a holiday -->
										{#if cashCategoryEditable(tx)}
											<select class="input-surface w-32 shrink-0 cursor-pointer" value={catId} onchange={(e) => onCashCategoryChange(tx, e)} aria-label="Catégorie">
												{#each CATEGORIES as cat (cat.id)}
													<option value={cat.id}>{cat.label}</option>
												{/each}
											</select>
										{:else}
											<span class="input-surface w-32 shrink-0 truncate text-secondary" title="Reste du porte-monnaie jamais détaillé : en Autre, en Vacances pendant une période de vacances">{getCategory(catId).label}</span>
										{/if}
									{:else}
									<select
										class="input-surface w-32 shrink-0 cursor-pointer"
										value={catId}
										onchange={(e) => onCategoryChange(tx, e)}
										aria-label="Catégorie"
									>
										{#each CATEGORIES as cat (cat.id)}
											<option value={cat.id}>{cat.label}</option>
										{/each}
									</select>
									{/if}
									<!-- Computed subcategory (v11), inline right of the select (compact mode) -->
									{#if sub}
										<span class="meta-xs truncate" title={sub.label}>{sub.label}</span>
									{/if}
								</div>
							</td>
							{#if hasTags}
								<td class="max-w-40 px-4 py-1">
									{#if tx.tags && tx.tags.length > 0}
										<div class="flex flex-wrap gap-1">
											{#each tx.tags as tag (tag)}
												<button
													type="button"
													class="chip chip-muted cursor-pointer hover:text-[var(--text)]"
													title="Toutes les opérations « {tag} »"
													onclick={(e) => {
														e.stopPropagation();
														filterByTag(tag);
													}}>{tag}</button
												>
											{/each}
										</div>
									{:else}
										<span class="text-secondary">—</span>
									{/if}
								</td>
							{/if}
							{#if hasChecked}
								<td class="px-2 py-1 text-center">
									{#if tx.checked}
										<span class="inline-block" style="color: var(--accent);" title="Opération pointée">✓</span>
									{/if}
								</td>
							{/if}
							<td class="tabular px-4 py-1 text-right whitespace-nowrap text-debit">
								{amount < 0 ? `−${formatEUR(-amount)}` : ''}
							</td>
							<td class="tabular px-4 py-1 text-right whitespace-nowrap text-accent">
								{amount >= 0 ? formatEUR(amount) : ''}
							</td>
							{#if hasBalance}
								<td class="tabular px-4 py-1 text-right whitespace-nowrap text-secondary">
									{tx.balance_after !== undefined ? formatEUR(tx.balance_after) : '—'}
								</td>
							{/if}
							<!-- Deletion: bare bin icon, visible on hover (150 ms); never on a portage entry, a cash entry leaves the wallet -->
							<td class="px-2 py-1 text-center">
								{#if tx.source !== 'portage'}
								<button
									type="button"
									class="cursor-pointer text-secondary opacity-0 transition-all duration-150 group-hover:opacity-100 hover:text-[var(--amber)] focus-visible:opacity-100"
									aria-label="Supprimer cette opération"
									title="Supprimer"
									onclick={(e) => {
										e.stopPropagation();
										if (tx.source === 'cash') onDeleteCash(tx);
										else onDeleteTx(tx);
									}}
								>
									<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
										<path d="M4 7h16" />
										<path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
										<path d="M6.5 7l.8 12a1 1 0 0 0 1 .9h7.4a1 1 0 0 0 1-.9l.8-12" />
										<path d="M10 11v6M14 11v6" />
									</svg>
								</button>
								{/if}
							</td>
						</tr>
						{#if expanded}
							<tr style="background-color: var(--bg);">
								<td colspan={colCount} class="px-5 py-3">
									{@render detailContent(tx)}
								</td>
							</tr>
						{/if}
					{:else}
						{#if !catHeads?.after.length}
							<tr>
								<td colspan={colCount} class="px-4 py-6">
									{#if getTransactions().length === 0}
										<!-- No data at all: point to the import, not to the filters -->
										<EmptyState
											icon="import"
											title="Aucune transaction"
											text="Importez un relevé Crédit Mutuel (CSV ou XLSX), Natixis (CSV) ou de toute banque (OFX, QIF, CAMT), ou glissez-déposez le fichier ici."
											ctaLabel="Importer un relevé"
											onCta={() => (uiState.importPanelOpen = true)}
										/>
									{:else}
										<EmptyState
											icon="search"
											title="Aucun résultat"
											text="Aucune transaction ne correspond aux filtres actifs."
											ctaLabel={filtersActive ? 'Réinitialiser les filtres' : ''}
											onCta={filtersActive ? resetFilters : undefined}
										/>
									{/if}
								</td>
							</tr>
						{/if}
					{/each}
					{#each catHeads?.after ?? [] as head (head.group.id)}
						{@render categoryHeadRow(head)}
					{/each}
				</tbody>
			</table>
		</div>
	</section>

	<!-- Mobile: stacked cards -->
	<section class="no-callout mb-3 space-y-2 md:hidden" use:slideSurface use:contextActions={listActions}>
		<div class="card p-1"><QuickEntryRow compact /></div>
		{#each paginated as tx, i (txKey(tx))}
			{@const amount = signedAmount(tx)}
			{@const catId = categorize(tx, budgetState.overrides, undefined, getMerchantCategoryMap())}
			{@const sub = getSubcategory(subcategorize(tx, budgetState.overrides, undefined, getMerchantCategoryMap()) ?? '')}
			{@const expanded = expandedKey === txKey(tx)}
			{@const isSelected = selected.has(txKey(tx))}
			{@const dayHead = dayStarts[i] ?? false}
			{#each catHeads?.before[i] ?? [] as head (head.group.id)}
				{@render categoryHeadLine(head)}
			{/each}
			{#if dayHead}
				{@const day = dayOf(tx) ? dayTotals?.get(dayOf(tx)) : undefined}
				<p class="meta-xs flex items-baseline justify-between px-1 pt-1">
					<span class="font-medium" style="color: var(--text);">{dayOf(tx) ? formatDate(tx.booking_date) : 'En cours'}</span>
					{#if day && day.count > 1}<span class="tabular" title={dayNetTitle(day)}><span class="sr-only">net du jour : </span>{signedCompact(day.net)}</span>{/if}
				</p>
			{/if}
			<div
				class="card press fade-slide cursor-pointer p-3 select-none"
				class:card-selected={isSelected}
				class:quick-pending={tx.source === 'manual'}
				style="--stagger: {Math.min(i, 10) * 30}ms;"
				tabindex="0"
				role="button"
				aria-expanded={expanded}
				aria-pressed={selectMode ? isSelected : undefined}
				data-row-index={i}
				onclick={(e) => onRowClick(tx, e, i)}
				onkeydown={(e) => onRowKeydown(tx, e, i)}
				onpointerdown={(e) => onRowPointerDown(e, i)}
				oncontextmenu={(e) => onRowContextMenu(e, i)}
				use:contextActions={() => rowActions(tx, i)}
			>
				<div class="flex items-start gap-3">
					{#if selectMode && selectable(tx)}
						<input
							type="checkbox"
							class="mt-2.5 shrink-0 cursor-pointer"
							checked={isSelected}
							aria-label="Sélectionner {displayLabel(tx)}"
							onclick={(e) => {
								e.stopPropagation();
								toggleSelected(tx, i, e.shiftKey);
							}}
						/>
					{/if}
					<MerchantMark label={displayLabel(tx)} id={catId} size={28} />
					<div class="min-w-0 flex-1">
						<p class="truncate text-sm font-medium" title={rawLabel(tx)}>
							{displayLabel(tx)}
							{#if isExcluded(txKey(tx))}
								{@const excluded = excludedBadge(txKey(tx))}
								<!-- Internal transfer hidden from the budget (neutral badge) -->
								<span class="chip chip-outline ml-1.5" title={excluded.title}>{excluded.label}</span>
							{/if}
							{#if (uiState.accountBadges || isComputedEntry(tx)) && accountBadge(tx)}
								{@const badge = accountBadge(tx)!}
								<span class="chip chip-muted ml-1.5" title={badge.title} aria-label={badge.title}>{badge.label}</span>
							{/if}
							{#if isPending(tx) && !isPlannedInstalment(tx)}
								<span class="chip chip-amber ml-1.5">En cours</span>
							{/if}
							<InstalmentChip {tx} class="ml-1.5" />
							{#if tx.source === 'manual' && !isPlannedInstalment(tx)}
								<span class="chip {quickEntryStale(tx) ? 'chip-amber' : 'chip-outline'} ml-1.5">{quickEntryStale(tx) ? 'absente du relevé' : 'à rapprocher'}</span>
							{/if}
						</p>
						<p class="meta-xs mt-0.5">
							{#if sortKey !== 'date' || !dayOf(tx)}{tx.booking_date ? formatDate(tx.booking_date) : 'En attente'} ·{' '}{:else}<span class="sr-only">{tx.booking_date ? formatDate(tx.booking_date) : 'en cours'}, </span>{/if}{getCategory(catId).label}{#if sub}&nbsp;· {sub.label}{/if}
							{#if tx.checked}<span style="color: var(--accent);"> · ✓ pointée</span>{/if}
						</p>
						{#if tx.note}
							<p class="meta-xs mt-0.5 truncate">{isComputedEntry(tx) ? maskAmounts(tx.note) : tx.note}</p>
						{/if}
						{#if tx.tags && tx.tags.length > 0}
							<div class="mt-1.5 flex flex-wrap gap-1">
								{#each tx.tags as tag (tag)}
									<button
										type="button"
										class="chip chip-muted cursor-pointer"
										title="Toutes les opérations « {tag} »"
										onclick={(e) => {
											e.stopPropagation();
											filterByTag(tag);
										}}>{tag}</button
									>
								{/each}
							</div>
						{/if}
					</div>
					<div class="shrink-0 text-right">
						<p class="tabular text-sm font-semibold {amount >= 0 ? 'text-accent' : 'text-debit'}">
							{amount >= 0 ? '+' : '−'}{formatEUR(Math.abs(amount))}
						</p>
						{#if tx.balance_after !== undefined}
							<p class="tabular meta-xs mt-0.5">{formatEUR(tx.balance_after)}</p>
						{/if}
					</div>
				</div>
				{#if expanded}
					<!-- Clicks inside the panel (note, tags, selects): the card does not collapse -->
					<div class="mt-3 border-t pt-3" style="border-color: var(--border-subtle);" role="presentation" data-no-slide onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()}>
						{@render detailContent(tx)}
					</div>
				{/if}
			</div>
		{:else}
			{#if !catHeads?.after.length}
				<div class="card p-4">
					{#if getTransactions().length === 0}
						<EmptyState
							icon="import"
							title="Aucune transaction"
							text="Importez un relevé Crédit Mutuel (CSV ou XLSX) ou Natixis (CSV)."
							ctaLabel="Importer un relevé"
							onCta={() => (uiState.importPanelOpen = true)}
						/>
					{:else}
						<EmptyState
							icon="search"
							title="Aucun résultat"
							text="Aucune transaction ne correspond aux filtres actifs."
							ctaLabel={filtersActive ? 'Réinitialiser les filtres' : ''}
							onCta={filtersActive ? resetFilters : undefined}
						/>
					{/if}
				</div>
			{/if}
		{/each}
		{#each catHeads?.after ?? [] as head (head.group.id)}
			{@render categoryHeadLine(head)}
		{/each}
	</section>

	<!-- Pagination -->
	{#if pageCount > 1}
		<nav class="flex items-center justify-center gap-1" aria-label="Pagination">
			<button
				type="button"
				class="press flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border transition-colors disabled:cursor-default disabled:opacity-30 hover:enabled:bg-[var(--surface-hover)]"
				style="border-color: var(--border);"
				disabled={page <= 1}
				aria-label="Page précédente"
				title={monthKeys ? 'Page précédente (Maj+←)' : 'Page précédente (←)'}
				onclick={() => (page = Math.max(1, page - 1))}
			>
				‹
			</button>
			{#each pageNumbers as p, i (i)}
				{#if p === '…'}
					<span class="px-1 text-secondary">…</span>
				{:else}
					<button
						type="button"
						class="press tabular h-8 min-w-8 cursor-pointer rounded-full border px-2 text-sm transition-colors {p === page
							? 'font-semibold'
							: 'hover:bg-[var(--surface-hover)]'}"
						style="border-color: {p === page ? 'var(--accent)' : 'var(--border)'}; {p === page
							? 'color: var(--accent); background-color: var(--accent-soft);'
							: ''}"
						aria-current={p === page ? 'page' : undefined}
						onclick={() => (page = p)}
					>
						{p}
					</button>
				{/if}
			{/each}
			<button
				type="button"
				class="press flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border transition-colors disabled:cursor-default disabled:opacity-30 hover:enabled:bg-[var(--surface-hover)]"
				style="border-color: var(--border);"
				disabled={page >= pageCount}
				aria-label="Page suivante"
				title={monthKeys ? 'Page suivante (Maj+→)' : 'Page suivante (→)'}
				onclick={() => (page = Math.min(pageCount, page + 1))}
			>
				›
			</button>
		</nav>
	{/if}
	{:else}
	<!-- Spending calendar: one cell per purchase day, tinted by amount -->
	<section class="card hero-in-3 mb-3 p-4" aria-label="Calendrier des dépenses">
		{#if !calendar}
			<EmptyState
				icon="search"
				title="Aucune dépense"
				text="Aucune dépense ne correspond aux filtres actifs."
				ctaLabel={filtersActive ? 'Réinitialiser les filtres' : ''}
				onCta={filtersActive ? resetFilters : undefined}
			/>
		{:else}
			<div class="cal-layout grid gap-4 {calPanel ? 'lg:grid-cols-[minmax(0,1fr)_21rem]' : 'lg:grid-cols-[minmax(0,1fr)_15rem]'}">
				<div class="min-w-0">
					<header class="mb-2 flex items-center gap-1">
						<button
							type="button"
							class="cal-nav press"
							data-cal-nav="-1"
							disabled={!calendarRange || calMonth <= calendarRange.first}
							aria-label="Mois précédent"
							title="Mois précédent (←)"
							onclick={() => shiftCalMonth(-1)}
						>
							<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
						</button>
						<span class="min-w-32 text-center text-sm font-medium">{formatMonth(calMonth)}</span>
						<button
							type="button"
							class="cal-nav press"
							data-cal-nav="1"
							disabled={!calendarRange || calMonth >= calendarRange.last}
							aria-label="Mois suivant"
							title="Mois suivant (→)"
							onclick={() => shiftCalMonth(1)}
						>
							<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
						</button>
					</header>
					<div class="cal-grid grid grid-cols-7 gap-1">
						{#each WEEKDAY_LABELS as label, i (label)}
							<div class="label-plain pb-0.5 text-center" style={i >= 5 ? 'color: var(--text-3);' : ''}>{label}</div>
						{/each}
						{#each Array.from({ length: calendar.leading }, (_, i) => i) as i (i)}
							<div aria-hidden="true"></div>
						{/each}
						{#each calendar.days as d (d.date)}
							{@const fill = dayFill(d.spend, calendar.max)}
							{@const slid = !!calSlide && calSlide[0] <= d.date && d.date <= calSlide[1]}
							<button
								type="button"
								class="cal-day"
								class:cal-weekend={d.weekday >= 5}
								class:cal-today={d.date === today}
								class:cal-selected={!calSlide && !!calPanel && calPanel.from <= d.date && d.date <= calPanel.to}
								class:cal-slid={slid}
								class:cal-future={d.date > today}
								class:cal-filled={fill > 0}
								class:cal-empty={d.count === 0}
								style={fill ? `--fill: ${fill}%;` : ''}
								data-cal-date={d.date}
								aria-pressed={!!calPanel && calPanel.from <= d.date && d.date <= calPanel.to}
								aria-label="{formatDate(d.date)} : {d.count === 0 ? 'aucun achat' : `${d.count} achat${d.count > 1 ? 's' : ''}, ${formatEUR(d.spend)}`}"
								title={d.count === 0 ? `${formatDate(d.date)} · aucun achat — glisser sur plusieurs jours pour voir une période` : `${formatDate(d.date)} : ${d.count} achat${d.count > 1 ? 's' : ''}, ${formatEUR(d.spend)}${d.spend < 0 ? ' (plus de remboursements que d’achats)' : ''} — cliquer pour les voir à côté, ou glisser sur plusieurs jours`}
								onpointerdown={(e) => calPointerDown(e, d.date)}
								onclick={() => calClick(d.date)}
							>
								<span class="cal-num">{d.day}</span>
								{#if d.count > 0}
									<span class="cal-amt tabular" class:cal-refund={d.spend < 0}>{d.spend < 0 ? '+' : ''}{formatEURCompact(Math.abs(d.spend))}</span>
								{/if}
							</button>
						{/each}
					</div>
				</div>
				<!-- Right column: the chosen days' operations (side panel), otherwise the month statistics -->
				<aside bind:this={calPanelEl} class="min-w-0 text-[12px] lg:border-l lg:pl-4 {calPanel ? 'border-t pt-3 lg:border-t-0 lg:pt-0' : ''}" style="border-color: var(--border-subtle);">
					{#if calPanel && calPanelData}
						{@const multiDay = calPanel.from !== calPanel.to}
						<section class="flex flex-col gap-2" aria-label="Opérations {calPanelLabel}" in:fly={{ x: 24, duration: reduceMotion ? 0 : 220 }}>
							<header class="flex items-start justify-between gap-2">
								<div class="min-w-0" aria-live="polite">
									<p class="label-plain">Opérations</p>
									<p class="mt-0.5 text-[13px] font-medium">{calPanelLabel}</p>
									<p class="meta-xs mt-0.5">
										<span class="amount-md tabular" style="color: var(--text);">{formatEUR(calPanelData.total)}</span>
										· {calPanelData.count} achat{calPanelData.count > 1 ? 's' : ''}
									</p>
								</div>
								<button type="button" class="cal-close press" aria-label="Fermer le panneau (Échap)" title="Fermer (Échap)" onclick={() => closeDays(true)}>
									<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
								</button>
							</header>
							{#if calPanelData.count === 0}
								<p class="meta-xs">Aucun achat {multiDay ? 'sur ces jours' : 'ce jour-là'} avec les filtres actifs.</p>
							{:else}
								<ul class="cal-ops -mx-1 max-h-[26rem] overflow-y-auto">
									{#each calPanelData.items as item (txKey(item.tx))}
										{@const key = txKey(item.tx)}
										{@const catId = catOfCal(item.tx)}
										{@const opened = calOpenKey === key}
										<li class="cal-op-item" class:cal-op-open={opened}>
											<button type="button" class="cal-op press" aria-expanded={opened} onclick={() => (calOpenKey = opened ? null : key)}>
												<MerchantMark label={displayLabel(item.tx)} id={catId} size={22} />
												<span class="min-w-0 flex-1 text-left">
													<span class="block truncate text-[12.5px]" style="color: var(--text);">{displayLabel(item.tx)}</span>
													<span class="meta-xs block truncate">{getCategory(catId).label}{multiDay ? ` · ${rangeLabel(item.date, item.date)}` : ''}</span>
												</span>
												<span class="tabular shrink-0 text-[12.5px]" class:cal-refund={item.spend < 0} style={item.spend < 0 ? '' : 'color: var(--text);'}>{item.spend < 0 ? '+' : ''}{formatEUR(Math.abs(item.spend))}</span>
											</button>
											{#if opened}
												{@const sub = getSubcategory(subcategorize(item.tx, budgetState.overrides, undefined, getMerchantCategoryMap()) ?? '')}
												<div class="cal-op-detail">
													<dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-0.5">
														<dt class="text-secondary">Libellé</dt>
														<dd class="break-words">{rawLabel(item.tx)}</dd>
														<dt class="text-secondary">Compte</dt>
														<dd>{isComputedEntry(item.tx) ? (accountBadge(item.tx)?.label ?? '') : accountLabel(accountIdOf(item.tx))}</dd>
														<dt class="text-secondary">Comptabilisé</dt>
														<dd>{formatDate(item.tx.booking_date)}</dd>
														{#if sub}
															<dt class="text-secondary">Sous-cat.</dt>
															<dd>{sub.label}</dd>
														{/if}
														{#if item.tx.note}
															<dt class="text-secondary">Note</dt>
															<dd class="break-words">{isComputedEntry(item.tx) ? maskAmounts(item.tx.note) : item.tx.note}</dd>
														{/if}
													</dl>
													<button type="button" class="btn btn-secondary btn-sm mt-1.5" onclick={() => openInList(item.tx)}>Ouvrir dans la liste</button>
												</div>
											{/if}
										</li>
									{/each}
								</ul>
							{/if}
							<div class="flex flex-wrap gap-1.5 border-t pt-2" style="border-color: var(--border-subtle);">
								<button type="button" class="btn btn-secondary btn-sm" title="Ces jours d'achat deviennent une période de vacances (renommable dans Budget › Périodes de vacances)" onclick={() => calPanel && vacationFrom(calPanel.from, calPanel.to)}>
									Créer une période de vacances
								</button>
								<button type="button" class="btn btn-secondary btn-sm" title="La liste des opérations, filtrée sur ces jours d'achat" onclick={listDays}>Voir dans la liste</button>
							</div>
						</section>
					{:else}
						<div class="flex flex-col gap-3" in:fly={{ x: -12, duration: reduceMotion ? 0 : 160 }}>
						<div>
							<p class="label-plain">Dépenses du mois</p>
							<p class="amount-md tabular mt-0.5">{formatEUR(calendar.total)}</p>
							<p class="meta-xs mt-0.5">
								{calendar.activeDays} jour{calendar.activeDays > 1 ? 's' : ''} d'achats{#if peakDay}&nbsp;· plus grosse journée le {formatDate(peakDay.date)} (<span class="tabular">{formatEURCompact(peakDay.spend)}</span>){/if}
							</p>
						</div>
						<div>
							<p class="label-plain">Moyenne par jour de semaine</p>
							<ul class="mt-1.5 space-y-1">
								{#each weekdays as w (w.weekday)}
									<li class="flex items-center gap-2" title="{WEEKDAY_NAMES[w.weekday]} : {formatEUR(w.average)} en moyenne ({w.days} jours, {formatEUR(w.total)} au total)">
										<span class="w-7 shrink-0 text-secondary">{w.label}</span>
										<span class="cal-track" aria-hidden="true">
											<span class="cal-bar" class:cal-bar-max={bestWeekday?.weekday === w.weekday} style="width: {weekdayMax > 0 ? Math.max(0, Math.round((w.average / weekdayMax) * 100)) : 0}%;"></span>
										</span>
										<span class="tabular w-12 shrink-0 text-right">{formatEURCompact(w.average)}</span>
									</li>
								{/each}
							</ul>
							{#if bestWeekday}
								<p class="meta-xs mt-1.5">
									Jour le plus dépensier : le <span style="color: var(--text);">{WEEKDAY_NAMES[bestWeekday.weekday]}</span>{weekdayPeriod ? `, ${weekdayPeriod}` : ''}.
								</p>
							{/if}
						</div>
						<p class="meta-xs">
							Date d'achat lue dans le libellé carte (« PAIEMENT CB 1809 » = 18/09), sinon date comptable. Remboursements déduits ; revenus, épargne et opérations masquées exclus.
						</p>
						</div>
					{/if}
				</aside>
			</div>
		{/if}
	</section>
	{/if}
{/if}


<!-- « Catégorie » sort, wide screen: header row of a category (fold button, operations, share of the filtered spending, also drawn as a hairline under the row), its net in the Débit or Crédit column -->
{#snippet categoryHeadRow(head: CategoryHead)}
	{@const g = head.group}
	{@const cat = getCategory(g.id)}
	{@const share = spendingShare(g, totals.debit)}
	<tr class="cat-head border-t" style="border-color: var(--hairline); background-color: color-mix(in srgb, {cat.color} 5%, transparent);" use:contextActions={() => headActions(g.id)}>
		<td colspan={colCount - (hasBalance ? 4 : 3)} class="relative px-4 py-1">
			<button
				type="button"
				class="flex w-full cursor-pointer items-center gap-2 text-left"
				data-cat-head={g.id}
				aria-expanded={!head.folded}
				title={head.folded ? 'Déplier la catégorie' : 'Replier la catégorie'}
				onclick={() => void toggleFold(g.id)}
			>
				<span class="meta-xs w-2.5 shrink-0" aria-hidden="true">{head.folded ? '▸' : '▾'}</span>
				<CategoryMark id={g.id} size={18} />
				<span class="font-medium">{cat.label}</span>
				{#if head.continued}<span class="meta-xs">(suite)</span>{/if}
				<span class="meta-xs tabular">{plural(g.count, 'opération')}{#if share > 0}&nbsp;· {shareLabel(share)} des dépenses{/if}</span>
			</button>
			{#if share > 0}<span class="cat-share" style="width: {share * 100}%; background-color: {cat.color};" aria-hidden="true"></span>{/if}
		</td>
		<td class="tabular px-4 py-1 text-right font-medium whitespace-nowrap text-debit" title={g.net < 0 ? catNetTitle(g) : undefined}>{g.net < 0 ? `−${formatEUR(-g.net)}` : ''}</td>
		<td class="tabular px-4 py-1 text-right font-medium whitespace-nowrap text-accent" title={g.net > 0 ? catNetTitle(g) : undefined}>{g.net > 0 ? formatEUR(g.net) : ''}</td>
		{#if hasBalance}<td></td>{/if}
		<td></td>
	</tr>
{/snippet}

<!-- « Catégorie » sort, phone: header line of a category above its cards, like the day headers -->
{#snippet categoryHeadLine(head: CategoryHead)}
	{@const g = head.group}
	{@const cat = getCategory(g.id)}
	{@const share = spendingShare(g, totals.debit)}
	<button
		type="button"
		class="meta-xs relative flex w-full cursor-pointer items-center gap-1.5 px-1 py-1 text-left"
		data-cat-head={g.id}
		aria-expanded={!head.folded}
		onclick={() => void toggleFold(g.id)}
		use:contextActions={() => headActions(g.id)}
	>
		<span class="w-2.5 shrink-0" aria-hidden="true">{head.folded ? '▸' : '▾'}</span>
		<CategoryMark id={g.id} size={16} />
		<span class="truncate font-medium" style="color: var(--text);">{cat.label}</span>
		{#if head.continued}<span class="shrink-0">(suite)</span>{/if}
		<span class="tabular shrink-0">{g.count}&nbsp;op.{#if share > 0}&nbsp;· {shareLabel(share)}{/if}</span>
		{#if g.net !== 0}<span class="tabular ml-auto shrink-0" title={catNetTitle(g)}><span class="sr-only">net : </span>{signedCompact(g.net)}</span>{/if}
		{#if share > 0}<span class="cat-share" style="width: {share * 100}%; background-color: {cat.color};" aria-hidden="true"></span>{/if}
	</button>
{/snippet}

<!-- Detail of an operation, in reading order: what it is (raw label, source, dates), what the user files, its merchant's history, what it is linked to, the actions, then the technical facts on one line -->
{#snippet detailHead(tx: Transaction, top: string, bottom: string, aside: string)}
	<!-- A bank operation: its raw label, quiet, over its dates, with its source and account as one chip; a computed entry (cash, portage), whose row already has its badge: its note over its date and how it counts -->
	{@const bank = !isComputedEntry(tx)}
	{@const source = sourceChip(tx)}
	<div class="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
		<div class="min-w-0 flex-[1_1_16rem]">
			{#if top}<p class="break-words" style={bank ? 'color: var(--text-2);' : ''}>{top}</p>{/if}
			<p class={top ? 'mt-0.5' : ''} style={bank ? '' : 'color: var(--text-2);'}>{bottom}{#if aside}<span style="color: var(--text-2);">{` · ${aside}`}</span>{/if}</p>
		</div>
		{#if bank}<span class="chip chip-outline mt-px max-w-full min-w-0 sm:max-w-[17rem]" title={source.title}><span class="truncate">{source.label}</span></span>{/if}
	</div>
{/snippet}

{#snippet detailContent(tx: Transaction)}
	{@const amount = signedAmount(tx)}
	{@const key = txKey(tx)}
	{@const catId = catOfTx(tx)}
	{@const refund = refundPlace(tx)}
	{@const open = openHistory?.key === key ? openHistory : null}
	{@const history = open?.history ?? null}
	{@const fileLike = open?.fileable ? (id: CategoryId) => fileLikeOthers(tx, id) : undefined}
	<div class="op-detail">
		{#if tx.source === 'portage'}
			{@const refundable = amount < 0 && !!tx.remittance_information[0]?.startsWith('Payé en ')}
			{@render detailHead(tx, maskAmounts(tx.note ?? ''), entryDates(tx), 'écriture calculée depuis tes documents de portage : comptée dans le budget, jamais dans tes soldes')}
			{#if refundable && refund === 'linked'}
				<div class="op-grid">
					<span class="op-label">Lié à</span>
					<div class="op-cell refund-line"><RefundControl {tx} /></div>
				</div>
			{/if}
			<div class="op-actions op-actions-flat">
				<button type="button" class="btn btn-secondary btn-sm" onclick={(e) => { e.stopPropagation(); navigate('/portage'); }}>Ouvrir l'onglet Portage</button>
				<!-- Typed Swile / culture voucher spends can be shared with someone who pays back -->
				{#if refundable && refund === 'action'}
					<span class="refund-slot" title="Sécu, mutuelle, une avance à quelqu'un, un retour en magasin"><RefundControl {tx} /></span>
				{/if}
			</div>
		{:else if tx.source === 'cash'}
			<!-- Cash wallet entry: typed in the quick entry, edited in the wallet, never a bank operation -->
			{@const refundable = amount < 0 && tx.remittance_information[0] !== WRITE_OFF_LABEL}
			{@render detailHead(tx, maskAmounts(tx.note ?? ''), entryDates(tx), 'compté dans le budget, jamais dans tes soldes')}
			<div class="op-grid {history || (refundable && refund === 'linked') ? '' : 'op-phone'}">
				<!-- The phone card has no category select of its own -->
				<span class="op-label op-phone">Catégorie</span>
				<div class="op-cell op-phone">
					{#if cashCategoryEditable(tx)}
						<select class="op-field input-surface cursor-pointer" value={catId} onchange={(e) => onCashCategoryChange(tx, e)} aria-label="Catégorie">
							{#each CATEGORIES as cat (cat.id)}<option value={cat.id}>{cat.label}</option>{/each}
						</select>
					{:else}
						<span title="Reste du porte-monnaie jamais détaillé : en Autre, en Vacances pendant une période de vacances">{getCategory(catId).label}</span>
					{/if}
				</div>
				{#if history}
					<span class="op-label">Historique</span>
					<div class="op-cell"><MerchantHistory {history} color={getCategory(catId).color} onShowAll={() => filterMerchant(tx)} /></div>
				{/if}
				{#if refundable && refund === 'linked'}
					<span class="op-label">Lié à</span>
					<div class="op-cell refund-line"><RefundControl {tx} /></div>
				{/if}
			</div>
			<div class="op-actions op-actions-flat">
				<!-- A cash spend can be shared with someone who pays back -->
				{#if refundable && refund === 'action'}
					<span class="refund-slot" title="Sécu, mutuelle, une avance à quelqu'un, un retour en magasin"><RefundControl {tx} /></span>
				{/if}
				<button type="button" class="op-danger" title="Retirer cette entrée du porte-monnaie (annulable)" onclick={(e) => { e.stopPropagation(); onDeleteCash(tx); }}>Supprimer</button>
			</div>
		{:else}
			{@const amazon = amazonMatchFor(tx)}
			{@const suggestions = suggestTags(tagCounts, tagDraft, tx.tags ?? [], tagDraft.trim() ? 6 : 5)}
			{@const detailSub = getSubcategory(subcategorize(tx, budgetState.overrides, undefined, getMerchantCategoryMap()) ?? '')}
			{@const detailSubs = subcategoriesFor(catId)}
			{@const merchant = merchantLabel(tx.remittance_information)}
			{@const bankCategory = tx.bank_category ? `${tx.bank_category}${tx.bank_subcategory ? ` › ${tx.bank_subcategory}` : ''}` : ''}
			{@const bankHint = tx.bank_subcategory || tx.bank_category || ''}
			{@const withdrawal = isWalletWithdrawal(key)}
			{@const excluded = !withdrawal && isExcluded(key)}
			{@const linkedAsset = assetOfTx(key)}
			{@const expenseNote = noteOfTx(key)}
			{@const foreign = foreignAmount(tx)}
			{@render detailHead(
				tx,
				rawLabel(tx),
				foreign ? `${entryDates(tx)} · ${foreign}` : entryDates(tx),
				withdrawal ? 'retrait vers le porte-monnaie : hors budget, compté dans les soldes' : excluded ? `${isInternal(key) ? 'virement interne : ' : ''}hors entrées/sorties et budget, compté dans les soldes` : ''
			)}
			{#if amazon}
				<!-- Items of the matched Amazon order: one per row, with its price -->
				<div class="mt-2 max-w-xl">
					<p class="meta-xs">Amazon · commande {amazon.orderId}{#if amazon.orderDate} du {formatDate(amazon.orderDate)}{/if}{#if amazon.kind === 'partial'} · expédition partielle{/if}</p>
					<ul class="divide-y divide-[var(--border-subtle)]">
						{#each amazon.items as item, i (i)}
							<li class="flex items-baseline gap-3 py-0.5">
								<span class="min-w-0 flex-1 break-words">{item.name}{#if item.quantity > 1} <span class="meta-xs">× {item.quantity}</span>{/if}</span>
								<span class="tabular shrink-0">{formatEUR(item.amount)}</span>
							</li>
						{/each}
					</ul>
				</div>
			{/if}
			<div class="op-grid">
				<!-- The phone card has no category select of its own -->
				<span class="op-label op-phone">Catégorie</span>
				<div class="op-cell op-phone">
					<select class="op-field input-surface cursor-pointer" value={catId} onchange={(e) => onCategoryChange(tx, e)} aria-label="Catégorie">
						{#each CATEGORIES as cat (cat.id)}<option value={cat.id}>{cat.label}</option>{/each}
					</select>
				</div>
				<!-- Subcategory: computed (v11), editable for the operation or its whole merchant; the bank's own category as a hint -->
				{#if detailSubs.length > 0}
					<span class="op-label">Sous-catégorie</span>
					<div class="op-cell">
						<select class="op-field input-surface cursor-pointer" value={detailSub?.id ?? ''} onchange={(e) => onSubChange(tx, e)} aria-label="Sous-catégorie">
							<option value="">—</option>
							{#each detailSubs as s (s.id)}<option value={s.id}>{s.label}</option>{/each}
						</select>
						{#if merchant}
							<label class="meta-xs flex cursor-pointer items-center gap-1">
								<input type="checkbox" bind:checked={subForMerchant} />
								pour tout « {merchant} »
							</label>
						{/if}
						{#if bankHint}<span class="meta-xs" title="Catégorie donnée par la banque : {bankCategory}">banque : {bankHint}</span>{/if}
					</div>
				{/if}
				{#if vacationState.periods.length > 0}
					<!-- Attachment to a specific holiday period (whatever the date) -->
					<span class="op-label">Vacances</span>
					<div class="op-cell">
						<select class="op-field input-surface cursor-pointer {catId === 'vacances' && vacationOf(tx) ? 'op-field-fit' : ''}" value={catId === 'vacances' ? (vacationOf(tx)?.id ?? '') : ''} onchange={(e) => onAssignVacation(tx, (e.target as HTMLSelectElement).value || null)} aria-label="Période de vacances">
							<option value="">—</option>
							{#each vacationState.periods as p (p.id)}
								<option value={p.id}>{p.label} ({formatDate(p.start)} → {formatDate(p.end)})</option>
							{/each}
						</select>
						{#if assignedVacation(tx)}
							<span class="meta-xs">rattachée à la main</span>
						{:else if isDetached(tx)}
							<span class="meta-xs">détachée à la main</span>
						{/if}
					</div>
				{/if}
				<!-- Tags: group operations from different categories (works, wedding…) -->
				<span class="op-label">Tags</span>
				<div class="op-cell">
					{#each tx.tags ?? [] as tag (tag)}
						<span class="chip chip-accent">
							<button type="button" class="cursor-pointer hover:underline" title="Toutes les opérations « {tag} »" onclick={(e) => { e.stopPropagation(); filterByTag(tag); }}>{tag}</button>
							<button
								type="button"
								class="cursor-pointer opacity-70 hover:opacity-100"
								aria-label="Retirer le tag {tag}"
								title="Retirer"
								onclick={(e) => {
									e.stopPropagation();
									removeTagFrom(tx, tag);
								}}
							>
								<svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
							</button>
						</span>
					{/each}
					{#if !tx.source || tx.source === 'demo'}
						<span class="meta-xs">Opération de démonstration : tags non modifiables</span>
					{:else}
						<input
							type="text"
							class="op-field input-surface"
							placeholder={(tx.tags?.length ?? 0) > 0 ? 'Autre tag (Entrée)' : 'ex. travaux cuisine (Entrée)'}
							aria-label="Ajouter un tag"
							maxlength="60"
							bind:value={tagDraft}
							onclick={(e) => e.stopPropagation()}
							onkeydown={(e) => onTagKeydown(tx, e, suggestions[0])}
						/>
						{#each suggestions as sug (sug)}
							<button
								type="button"
								class="chip chip-outline cursor-pointer hover:text-[var(--text)]"
								title="Ajouter le tag « {sug} »"
								onclick={(e) => {
									e.stopPropagation();
									addTagsTo(tx, [sug]);
								}}>+ {sug}</button
							>
						{/each}
					{/if}
				</div>
				<!-- Note: N from the list focuses it, Enter saves -->
				<label class="contents">
					<span class="op-label">Note <kbd class="kbd ml-0.5 max-md:hidden">N</kbd></span>
					<span class="op-cell">
						<input
							type="text"
							class="input-surface w-full max-w-md"
							data-note-input
							placeholder="ex. cadeau neveu, remboursé par Morgan…"
							value={expandedKey === key && document.activeElement?.hasAttribute('data-note-input') ? noteDraft : (tx.note ?? '')}
							onfocus={() => (noteDraft = tx.note ?? '')}
							oninput={(e) => (noteDraft = (e.target as HTMLInputElement).value)}
							onblur={() => saveNote(tx)}
							onkeydown={(e) => {
								if (e.key === 'Enter') {
									saveNote(tx);
									(e.target as HTMLInputElement).blur();
								}
								e.stopPropagation();
							}}
						/>
					</span>
				</label>
				<!-- Merchant history: its last amounts, a price change, where its other operations are filed -->
				{#if history}
					<span class="op-label">Historique</span>
					<div class="op-cell"><MerchantHistory {history} color={getCategory(catId).color} onShowAll={() => filterMerchant(tx)} onFile={fileLike} /></div>
				{/if}
				{#if expenseNote || linkedAsset || refund === 'linked'}
					<span class="op-label">Lié à</span>
					<div class="op-cell">
						{#if expenseNote}
							<button type="button" class="op-link" title="Avancée pour le portage : neutralisée dans le budget, le remboursement arrive avec le salaire du mois suivant" onclick={(e) => { e.stopPropagation(); navigate('/portage'); }}>Portage · note de frais n° {expenseNote.note.numero}{expenseNote.ligne.commentaire ? ` (${expenseNote.ligne.commentaire})` : ''}</button>
						{/if}
						{#if expenseNote && linkedAsset}<span aria-hidden="true" style="color: var(--text-2);">·</span>{/if}
						{#if linkedAsset}
							<span class="inline-flex items-baseline gap-1.5">
								<button type="button" class="op-link" title="Suivi dans {linkedAsset.type === 'vehicule' ? 'Voiture' : 'Patrimoine › Biens'}" onclick={(e) => { e.stopPropagation(); navigate(linkedAsset.type === 'vehicule' ? '/voiture' : '/patrimoine'); }}>Bien « {linkedAsset.name} »</button>
								<button
									type="button"
									class="op-link meta-xs"
									onclick={(e) => {
										e.stopPropagation();
										detachTx(key);
										showToast('Opération détachée du bien');
									}}>détacher</button
								>
							</span>
						{/if}
						{#if refund === 'linked'}
							<div class="refund-line basis-full"><RefundControl {tx} /></div>
						{/if}
					</div>
				{/if}
			</div>
			<!-- Actions: budget exclusion (v13 §C.3), refund, possession, then deletion apart -->
			<div class="op-actions">
				{#if !withdrawal}
					<button
						type="button"
						class="btn btn-secondary btn-sm"
						title={excluded
							? 'Réintégrer cette opération dans les totaux du budget (M)'
							: 'Opération exceptionnelle (solde de tout compte, virement entre vos comptes, gros achat ponctuel…) : la retirer des entrées/sorties et du budget. Elle reste comptée dans les soldes. (M)'}
						onclick={(e) => {
							e.stopPropagation();
							toggleInternal(tx);
						}}
					>
						{excluded ? 'Réintégrer au budget' : 'Masquer du budget'}
					</button>
				{/if}
				{#if refund === 'action'}
					<span class="refund-slot" title="Sécu, mutuelle, une avance à quelqu'un, un retour en magasin"><RefundControl {tx} /></span>
				{/if}
				{#if !linkedAsset}
					{#if attachOpenKey === key}
						<select class="input-surface cursor-pointer" bind:value={assetChoice} aria-label="Bien à rattacher" onclick={(e) => e.stopPropagation()}>
							{#each assetsState.biens as b (b.id)}
								<option value={b.id}>{b.name}</option>
							{/each}
							<option value="__nouveau">+ Nouveau bien (depuis cette opération)</option>
						</select>
						<button
							type="button"
							class="btn btn-primary btn-sm"
							onclick={(e) => {
								e.stopPropagation();
								attachToAsset(tx);
							}}>Rattacher</button
						>
						<button
							type="button"
							class="btn btn-secondary btn-sm"
							onclick={(e) => {
								e.stopPropagation();
								attachOpenKey = null;
							}}>Annuler</button
						>
					{:else}
						<button
							type="button"
							class="btn btn-secondary btn-sm"
							title="Instrument, hi-fi… : suivi dans Patrimoine › Biens, à part du patrimoine financier"
							onclick={(e) => {
								e.stopPropagation();
								openAttach(tx);
							}}>Rattacher à un bien</button
						>
					{/if}
				{/if}
				<button
					type="button"
					class="op-danger"
					title="Supprimer cette opération (annulable)"
					onclick={(e) => {
						e.stopPropagation();
						onDeleteTx(tx);
					}}>Supprimer</button
				>
			</div>
			<!-- Technical facts: cleared flag, value and analysis dates when they differ, balance, bank category when not shown above, key -->
			<p class="op-tech">
				Pointée : {tx.checked ? 'oui' : 'non'}{#if tx.value_date && tx.value_date !== tx.booking_date}&nbsp;· valeur {formatDateShort(tx.value_date)}{/if}{#if tx.analysis_date && tx.analysis_date !== tx.booking_date}&nbsp;· analyse {formatDateShort(tx.analysis_date)}{/if}{#if tx.balance_after !== undefined}&nbsp;· solde après <span class="tabular">{sensitiveEUR(tx.balance_after)}</span>{/if}{#if bankCategory && detailSubs.length === 0}&nbsp;· catégorie banque : {bankCategory}{/if}&nbsp;· clé <span class="tabular select-all">{key}</span>
			</p>
		{/if}
	</div>
{/snippet}

<!-- Column remapping modal (exotic CSV / XLSX) -->
{#if mapper}
	<ImportMapperModal
		fileName={mapper.fileName}
		sourceData={mapper.sourceData}
		account={mapper.account}
		txSource={mapper.txSource}
		onCancel={() => (mapper = null)}
		onImport={onMapperImport}
	/>
{/if}

<style>
	/* Long press on a row starts a selection: no system callout on it */
	.no-callout {
		-webkit-touch-callout: none;
	}

	/* Checked row / card (bulk edit) */
	.row-selected {
		background-color: var(--accent-soft);
	}
	.card-selected {
		border-color: var(--accent);
		background-color: color-mix(in srgb, var(--accent-soft) 60%, var(--surface));
	}

	/* « Catégorie » sort: the category's share of the filtered spending, a hairline along the bottom of its header */
	.cat-share {
		position: absolute;
		bottom: 0;
		left: 0;
		height: 2px;
		border-radius: 0 9999px 9999px 0;
		opacity: 0.6;
		pointer-events: none;
	}
	/* Category mode period stepper: an arrow with no month left to reach gets no hover background */
	.period-step > button:disabled:hover {
		background-color: transparent !important;
	}
	/* Compact rows: the category headers shrink with the rows they head */
	@media (min-width: 768px) {
		:global(html[data-compact-rows]) .cat-head > td {
			padding-top: 1px;
			padding-bottom: 1px;
		}
	}

	/* ---- Operation detail (detailContent): 12 px, labels in a narrow column on the left, one row each ---- */
	/* 42 rem: the table scrolls sideways under ~1280 px, the detail stays inside what the row shows */
	.op-detail {
		width: min(100%, 42rem);
		font-size: 12px;
		line-height: 1.45;
	}
	.op-grid {
		display: grid;
		grid-template-columns: max-content minmax(0, 1fr);
		column-gap: 14px;
		row-gap: 4px;
		margin-top: 10px;
	}
	.op-label {
		font-size: 11px;
		line-height: 26px;
		color: var(--text-2);
		white-space: nowrap;
	}
	.op-cell {
		display: flex;
		min-width: 0;
		min-height: 26px;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px 8px;
	}
	/* Rows only the phone card needs (it has no category select): the table row has one */
	@media (min-width: 768px) {
		.op-detail .op-phone {
			display: none;
		}
	}
	@media (max-width: 639px) {
		.op-grid {
			column-gap: 10px;
		}
	}
	/* Selects and the tag field share one width, so the column reads as a form; the holidays select grows to show the period it holds */
	.op-field {
		width: 13rem;
		max-width: 100%;
	}
	.op-field-fit {
		width: auto;
		min-width: 13rem;
	}
	.op-link {
		cursor: pointer;
		color: var(--text);
		text-decoration: underline dotted;
		text-decoration-color: var(--hairline);
		text-underline-offset: 3px;
	}
	.op-link:hover {
		text-decoration-color: currentColor;
	}
	.op-actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
		margin-top: 10px;
		padding-top: 10px;
		border-top: 1px solid var(--border-subtle);
	}
	/* A cash or portage entry: two lines of text above, no form to close off */
	.op-actions-flat {
		margin-top: 8px;
		padding-top: 0;
		border-top: 0;
	}
	/* Deletion: a text button apart at the far right, in the UI font (a bare .btn-secondary is the serif pill) */
	.op-danger {
		margin-left: auto;
		border-radius: 6px;
		padding: 2px 4px;
		font-size: 11px;
		font-weight: 500;
		color: var(--accent-2);
		cursor: pointer;
	}
	.op-danger:hover {
		text-decoration: underline;
		text-underline-offset: 3px;
	}
	.op-tech {
		margin-top: 6px;
		font-size: 11px;
		color: var(--text-2);
		overflow-wrap: anywhere;
	}
	/* Refund section (RefundControl) in the detail. Among the actions, its « À rembourser… » button is one
	   more small button: its box goes, its hint moves to the tooltip, its form takes a line of its own. On
	   the « Lié à » line, the claim drops its own rule and spacing. */
	.refund-slot,
	.refund-slot > :global(div) {
		display: contents;
	}
	.refund-slot > :global(div > span) {
		display: none;
	}
	.refund-slot > :global(div > div) {
		order: 1;
		flex-basis: 100%;
	}
	.refund-line {
		padding-top: 3px;
	}
	.refund-line > :global(div) {
		margin: 0;
		border: 0;
		padding: 0;
		font-size: 12px;
	}

	/* Selection actions: stuck to the top while scrolling (the 'Annuler' toast is at the bottom) */
	.bulk-bar {
		position: sticky;
		top: 0.5rem;
		z-index: 20;
		border-color: var(--accent);
		box-shadow: var(--shadow-soft);
	}

	/* ---- Spending calendar ---- */
	.cal-nav {
		display: flex;
		height: 1.75rem;
		width: 1.75rem;
		align-items: center;
		justify-content: center;
		border-radius: 9999px;
		border: 1px solid var(--hairline);
		cursor: pointer;
		transition: background-color 0.2s ease;
	}
	.cal-nav:hover:enabled {
		background-color: var(--surface-hover);
	}
	.cal-nav:disabled {
		cursor: default;
		opacity: 0.3;
	}

	/* Day cell: champagne tint proportional to --fill, never red */
	.cal-day {
		--fill: 0%;
		display: flex;
		min-height: 3.25rem;
		flex-direction: column;
		justify-content: space-between;
		border-radius: 6px;
		border: 1px solid var(--border-subtle);
		padding: 3px 5px;
		text-align: left;
		background-color: color-mix(in srgb, var(--accent) var(--fill), var(--surface));
		cursor: pointer;
		transition: border-color 0.15s ease;
	}
	.cal-day:hover {
		border-color: var(--accent);
	}
	/* Days covered by the slide in progress */
	.cal-slid {
		box-shadow: inset 0 0 0 2px var(--accent);
	}
	/* Sliding across days selects them instead of scrolling the page or the text */
	.cal-grid {
		touch-action: none;
		user-select: none;
		-webkit-user-select: none;
	}
	.cal-weekend {
		background-color: color-mix(in srgb, var(--accent) var(--fill), var(--surface-2));
	}
	.cal-today {
		box-shadow: inset 0 0 0 1.5px var(--accent);
	}
	.cal-selected {
		box-shadow: inset 0 0 0 2px var(--text);
	}
	.cal-future {
		opacity: 0.45;
	}
	.cal-num {
		font-size: 10px;
		line-height: 1;
		color: var(--text-2);
	}
	.cal-weekend .cal-num {
		color: var(--text-3);
	}
	/* Tinted cell: number in muted ink (the weekend grey disappeared on it) */
	.cal-filled .cal-num {
		color: var(--text);
		opacity: 0.6;
	}
	.cal-amt {
		align-self: flex-end;
		font-size: 11px;
		font-weight: 500;
		line-height: 1.1;
		color: var(--text);
	}
	.cal-refund {
		color: var(--accent);
	}
	@media (max-width: 639px) {
		.cal-day {
			min-height: 2.6rem;
			padding: 2px 3px;
		}
		.cal-amt {
			font-size: 9.5px;
		}
	}

	/* Side panel of the calendar: the right column widens and slides in, the grid stays usable */
	@media (prefers-reduced-motion: no-preference) {
		.cal-layout {
			transition: grid-template-columns 220ms cubic-bezier(0.2, 0.6, 0.2, 1);
		}
	}
	.cal-close {
		display: flex;
		height: 1.5rem;
		width: 1.5rem;
		flex-shrink: 0;
		align-items: center;
		justify-content: center;
		border-radius: 9999px;
		border: 1px solid var(--hairline);
		color: var(--text-2);
		cursor: pointer;
	}
	.cal-close:hover {
		color: var(--text);
		background-color: var(--surface-2);
	}
	.cal-op-item {
		border-radius: 6px;
	}
	.cal-op-open {
		background-color: var(--surface-2);
	}
	.cal-op {
		display: flex;
		width: 100%;
		align-items: center;
		gap: 0.5rem;
		border-radius: 6px;
		padding: 0.3rem 0.25rem;
		cursor: pointer;
	}
	.cal-op:hover {
		background-color: var(--surface-2);
	}
	.cal-op-detail {
		padding: 0 0.5rem 0.5rem 2.25rem;
		font-size: 11.5px;
		line-height: 1.45;
	}

	/* Average per weekday: thin horizontal bars */
	.cal-track {
		height: 6px;
		flex: 1;
		overflow: hidden;
		border-radius: 9999px;
		background-color: var(--border-subtle);
	}
	.cal-bar {
		display: block;
		height: 100%;
		border-radius: 9999px;
		background-color: color-mix(in srgb, var(--accent) 45%, transparent);
	}
	.cal-bar-max {
		background-color: var(--accent);
	}
</style>
