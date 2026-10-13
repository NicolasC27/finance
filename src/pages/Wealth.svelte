<script lang="ts">
	import { onMount } from 'svelte';
	import { KIND_COLORS, registerAccounts } from '$lib/accounts.svelte';
	import Block from '$lib/components/Block.svelte';
	import { chartHeight } from '$lib/tileGrid';
	import TileCanvas from '$lib/components/TileCanvas.svelte';
	import { orderedIds, isFullscreen } from '$lib/layout.svelte';
	import type { BlockElement } from '$lib/layoutModel';
	import { getTransactions, txState } from '$lib/store.svelte';
	import { isPlannedInstalment } from '$lib/data';
	import { formatEUR, formatMonth, formatDate, formatPct } from '$lib/sensitiveFormat';
	import { getLoanViews, setMonthlyOverride, clearMonthlyOverride } from '$lib/loans.svelte';
	import { navigate } from '$lib/router.svelte';
	import { uiState, showToast } from '$lib/ui.svelte';
	import {
		krakenState,
		getAssets,
		getCryptoTotal,
		getBankBalances,
		getAccountsView,
		getNetWorth,
		getNetWorthVar30,
		getAllocation,
		getWealthHistory,
		hasNatixis,
		refreshPrices,
		refreshBalances,
		loadOhlc,
		setManualQty,
		removeManual,
		getCryptoHistory,
		getEmployeeSavingsTotal,
		getEmployeeSavingsEstimate,
		getNatixisCashCounted,
		getKrakenPerformance,
		getTaxProvision,
		syncLedgerFromApi,
		type AccountView
	} from '$lib/wealth.svelte';
	import { krakenLedgerState } from '$lib/krakenLedger.svelte';
	import { natixisState } from '$lib/natixisHoldings.svelte';
	import type { AccountKind } from '$lib/accounts.svelte';
	import { trendFromOhlc, type TrendReading } from '$lib/trends';
	import AccountIcon from '$lib/components/AccountIcon.svelte';
	import Mark from '$lib/components/Mark.svelte';
	import AnimatedAmount from '$lib/components/AnimatedAmount.svelte';
	import OdometerAmount from '$lib/components/OdometerAmount.svelte';
	import BalanceChart from '$lib/components/BalanceChart.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import Sparkline from '$lib/components/Sparkline.svelte';
	import PageTitle from '$lib/components/PageTitle.svelte';
	import ModuleOptionsButton from '$lib/components/ModuleOptionsButton.svelte';
	import NatixisSavings, { EMPLOYEE_SAVINGS_ELEMENTS } from '$lib/components/NatixisSavings.svelte';
	import TaxCard, { TAX_ELEMENTS } from '$lib/components/TaxCard.svelte';
	import CryptoNews from '$lib/components/CryptoNews.svelte';
	import AssetsCard, { ASSETS_ELEMENTS } from '$lib/components/AssetsCard.svelte';
	import RealReturnCard, { REAL_RETURN_ELEMENTS } from '$lib/components/RealReturnCard.svelte';
	import ProjectionCard, { PROJECTION_ELEMENTS } from '$lib/components/ProjectionCard.svelte';
	import LoanCostCard, { CREDIT_ELEMENTS } from '$lib/components/LoanCostCard.svelte';
	import { amortizedEndMonth } from '$lib/loanCosts.svelte';
	import { getAssetTotals } from '$lib/assets.svelte';
	import { getPendingMoney } from '$lib/portage.svelte';

	/**
	 * Patrimoine page (/patrimoine): global-view bento: total value (banks + live crypto, count-up),
	 * allocation donut, evolution chart (bank + crypto snapshots/OHLC), account cards. Prices refresh
	 * every 60 s while the page is active.
	 */

	let now = $state(Date.now());
	/** Ledger API sync in progress (progress shown). */
	let syncing = $state<string | null>(null);

	async function syncHistory() {
		if (syncing) return;
		syncing = 'Connexion…';
		try {
			const r = await syncLedgerFromApi(undefined, (n, total) => (syncing = `${n} / ${total} lignes…`));
			showToast(`Historique Kraken : ${r.entries} ligne${r.entries > 1 ? 's' : ''} lue${r.entries > 1 ? 's' : ''}, ${r.fresh} nouvelle${r.fresh > 1 ? 's' : ''}, ${r.transactions} opération${r.transactions > 1 ? 's' : ''} EUR ajoutée${r.transactions > 1 ? 's' : ''} au budget`);
		} catch (e) {
			const msg = e instanceof Error ? e.message : 'Erreur';
			showToast(/permission/i.test(msg) ? 'Kraken refuse : ajoutez la permission « Consulter le registre » à votre clé API' : `Synchronisation Kraken impossible : ${msg}`);
		} finally {
			syncing = null;
		}
	}
	let manualSymbol = $state('');
	let manualQty = $state('');

	const assets = $derived(getAssets());

	/** Trends per asset (SMA20/SMA50 + 30-day momentum), graceful without OHLC. */
	const trends = $derived.by((): Record<string, TrendReading> => {
		const out: Record<string, TrendReading> = {};
		for (const a of assets) {
			const series = krakenState.ohlc[a.symbol];
			if (!series) continue;
			const t = trendFromOhlc(series);
			if (t) out[a.symbol] = t;
		}
		return out;
	});
	const banks = $derived(getBankBalances());
	const allocation = $derived(getAllocation());
	const allocationTotal = $derived(allocation.reduce((sum, s) => sum + s.value, 0));
	const history = $derived(getWealthHistory());
	/** Height of the title and summary above the wealth chart: with a set tile height, the chart takes the rest. */
	let historyTop = $state(0);
	const var30 = $derived(getNetWorthVar30());

	// ---- v14: Kraken ledger (cashback, CSV balances) + employee savings ----
	const ledger = $derived(krakenLedgerState.ledger);
	/** Cumulative cashback per asset, valued in EUR at the current price when known. */
	const cashbackEntries = $derived(
		Object.entries(ledger.cashbackTotal)
			.filter(([, qty]) => qty > 0)
			.map(([symbol, qty]) => ({ symbol, qty, eur: krakenState.prices[symbol] ? qty * krakenState.prices[symbol]!.price : undefined }))
	);
	const cryptoHist = $derived(getCryptoHistory());
	const employeeSavingsTotal = $derived(getEmployeeSavingsTotal());
	/** Today's estimate (annual performance extended): shown separately, never added to the net. */
	const employeeSavingsEstimate = $derived(getEmployeeSavingsEstimate());
	/** Natixis CSV flows actually counted (0 when a PDF notice already values the savings). */
	const natixisCash = $derived(getNatixisCashCounted());
	/** Top held asset (largest EUR value): feeds the news card. */
	const topAsset = $derived(assets[0]?.symbol ?? '');

	/** Crypto quantity: '0,00030112' (2 to 8 significant decimals). */
	function formatQty(qty: number): string {
		return new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 8 }).format(qty);
	}

	/** Full crypto format: '0,00030112 BTC'. */
	function formatCryptoQty(qty: number, symbol: string): string {
		return `${formatQty(qty)} ${symbol}`.trim();
	}

	const cmAccounts = $derived(getAccountsView());
	/** Tracked loans (v13 §D): projections per account (estimated current balance). */
	const loanViews = $derived(getLoanViews());
	const natixisTxCount = $derived(getTransactions().filter((tx) => tx.account === 'natixis').length);

	/** Total of the detected accounts (declared balances take priority over computed ones). */
	const accountsTotal = $derived(Math.round(cmAccounts.reduce((sum, a) => sum + a.balance, 0) * 100) / 100);
	/**
	 * Debts = negative balances (loans): already deducted from the net, shown separately for
	 * readability.
	 */
	const debts = $derived(Math.round(cmAccounts.filter((a) => a.balance < 0).reduce((sum, a) => sum + a.balance, 0) * 100) / 100);
	/** Assets = net + debts + tax provision (the net subtracted them). */
	const grossAssets = $derived(Math.round((getNetWorth() - debts + getTaxProvision()) * 100) / 100);

	interface AccountGroup {
		kind: AccountKind;
		label: string;
		accounts: AccountView[];
		total: number;
	}

	/** Display order of the account groups. */
	const GROUP_ORDER: [AccountKind, string][] = [
		['courant', 'Comptes courants'],
		['livret', 'Livrets & épargne'],
		['pret', 'Crédits'],
		['crypto', 'Crypto'],
		['autre', 'Autres']
	];

	/**
	 * Reconciliation: the real balance typed in becomes the account's declared balance (same mechanism
	 * as the XLSX summary sheet); the gap with the computed balance and pending operations are
	 * flagged. Dates remembered (`budget:reconcile`).
	 */
	const RECONCILE_KEY = 'budget:reconcile';
	function loadReconciled(): Record<string, string> {
		try {
			const p = JSON.parse(localStorage.getItem(RECONCILE_KEY) ?? '{}') as Record<string, string>;
			return p && typeof p === 'object' ? p : {};
		} catch {
			return {};
		}
	}
	let reconciled = $state<Record<string, string>>(loadReconciled());
	let reconcileId = $state<string | null>(null);
	let reconcileDraft = $state('');
	function commitReconcile(acc: AccountView) {
		const v = Number(reconcileDraft.replace(/\s/g, '').replace(',', '.'));
		if (!Number.isFinite(v)) return;
		const gap = Math.round((v - acc.computed) * 100) / 100;
		const pending = getTransactions().filter((tx) => (tx.account ?? 'cm') === acc.id && !tx.value_date && !isPlannedInstalment(tx)).length;
		registerAccounts([{ id: acc.id, label: acc.label, last4: acc.last4, kind: acc.kind, balance: v, currency: 'EUR' }]);
		reconciled = { ...reconciled, [acc.id]: new Date().toISOString() };
		try {
			localStorage.setItem(RECONCILE_KEY, JSON.stringify(reconciled));
		} catch {
		}
		reconcileId = null;
		showToast(
			Math.abs(gap) < 0.005
				? 'Solde pointé : aucun écart avec le calcul'
				: `Solde pointé : écart de ${gap > 0 ? '+' : '−'}${formatEUR(Math.abs(gap))} vs le calcul${pending > 0 ? ` (${pending} opération${pending > 1 ? 's' : ''} en attente)` : ' : une opération manque sans doute à l’import'}`
		);
	}

	/** Groups by type (empty groups hidden), total per group. */
	const accountGroups = $derived.by((): AccountGroup[] => {
		const out: AccountGroup[] = [];
		for (const [kind, label] of GROUP_ORDER) {
			const list = cmAccounts.filter((a) => a.kind === kind);
			if (list.length === 0) continue;
			out.push({ kind, label, accounts: list, total: Math.round(list.reduce((s, a) => s + a.balance, 0) * 100) / 100 });
		}
		return out;
	});

	/** Price age in seconds ('il y a Xs' badge). */
	const priceAge = $derived(krakenState.pricesAt > 0 ? Math.max(0, Math.round((now - krakenState.pricesAt) / 1000)) : null);

	/**
	 * On mount: first valuation + private balances when keys exist + OHLC backfill (all non-fatal),
	 * then a 60 s price refresh and a 1 s tick of the 'il y a Xs' badge.
	 */
	onMount(() => {
		void refreshPrices();
		if (krakenState.hasKeys) void refreshBalances();
		const ohlcTimer = window.setTimeout(() => {
			for (const a of getAssets().slice(0, 4)) void loadOhlc(a.symbol);
		}, 400);
		const priceTimer = window.setInterval(() => void refreshPrices(), 60_000);
		const tickTimer = window.setInterval(() => (now = Date.now()), 1_000);
		return () => {
			window.clearTimeout(ohlcTimer);
			window.clearInterval(priceTimer);
			window.clearInterval(tickTimer);
		};
	});

	/** Adds an asset by manual entry (fallback without keys / offline). */
	function addManual() {
		const qty = Number(manualQty.replace(',', '.'));
		if (!manualSymbol.trim() || !Number.isFinite(qty) || qty <= 0) return;
		setManualQty(manualSymbol, qty);
		manualSymbol = '';
		manualQty = '';
	}

	// Imports: right-hand panel (format recognised automatically, Natixis included)
	function importNatixis() {
		uiState.importPanelOpen = true;
	}

	function importCm() {
		uiState.importPanelOpen = true;
	}

	/**
	 * Manual correction of a loan's monthly payment (persisted, SPEC §D.1): French number ('160,50');
	 * empty/invalid → back to the detected payment.
	 */
	function commitPayment(accountId: string, raw: string) {
		const value = Number(raw.replace(',', '.').replace(/[^\d.]/g, ''));
		if (Number.isFinite(value) && value > 0) setMonthlyOverride(accountId, value);
		else clearMonthlyOverride(accountId);
	}

	/** Customisable blocks of the page (default order). */
	const WEALTH_BLOCKS = ['networth', 'allocation', 'history', 'rendement', 'projection', 'accounts', 'credit', 'natixis', 'crypto', 'biens', 'epargne', 'impots'] as const;

	/** Optional elements of the inline blocks (component cards export their own list). */
	const NETWORTH_ELEMENTS: BlockElement[] = [
		{ id: 'variation', label: 'Variation sur 30 jours' },
		{ id: 'detail', label: 'Actifs, dettes et provision d’impôt' },
		{ id: 'sources', label: 'Banques, crypto et épargne salariale' },
		{ id: 'portage', label: 'À recevoir du portage' },
		{ id: 'biens', label: 'Biens, hors total' }
	];
	const ALLOCATION_ELEMENTS: BlockElement[] = [
		{ id: 'barre', label: 'Barre de répartition' },
		{ id: 'legende', label: 'Légende' },
		{ id: 'pourcentages', label: 'Pourcentages' },
		{ id: 'montants', label: 'Montants' }
	];
	const HISTORY_ELEMENTS: BlockElement[] = [
		{ id: 'resume', label: 'Variation sur la période', default: false },
		{ id: 'grande', label: 'Courbe plus haute', default: false }
	];
	const ACCOUNTS_ELEMENTS: BlockElement[] = [
		{ id: 'total', label: 'Total net' },
		{ id: 'groupes', label: 'Total par groupe' },
		{ id: 'variation', label: 'Variation du mois' },
		{ id: 'operations', label: "Nombre d'opérations" },
		{ id: 'credits', label: 'Suivi des crédits' }
	];
	const NATIXIS_ELEMENTS: BlockElement[] = [
		{ id: 'compteur', label: 'Opérations importées' },
		{ id: 'reimport', label: 'Bouton « Ré-importer un CSV »' }
	];
	const CRYPTO_ELEMENTS: BlockElement[] = [
		{ id: 'gain', label: 'Gain net, apports et sorties' },
		{ id: 'positions', label: '3 premières positions' },
		{ id: 'parts', label: 'Part de chaque position' },
		{ id: 'lien', label: 'Lien vers la page Crypto' }
	];

	/** First and last points of the wealth history, for the optional « Variation sur la période » line. */
	const historyChange = $derived(
		history.length > 1
			? { from: history[0]!.iso, to: history[history.length - 1]!.iso, first: history[0]!.balance, last: history[history.length - 1]!.balance, delta: history[history.length - 1]!.balance - history[0]!.balance }
			: null
	);
	/** Loans still running: the 'Coût réel des crédits' card only appears with them. */
	const hasOpenLoans = $derived([...loanViews.values()].some((l) => l.currentBalance < 0));
	/** Possessions (car, instruments, hi-fi…): separate, never in net wealth. */
	const assetTotals = $derived(getAssetTotals());
	/** Portage: money waiting for you (outside net wealth, like possessions). */
	const portagePending = $derived.by(() => {
		const a = getPendingMoney();
		return { reserve: a.reserve ?? 0, frais: a.frais.reduce((s, f) => s + f.montant, 0), salaires: a.salaires.reduce((s, x) => s + x.montant, 0) };
	});

	/**
	 * Sources without data: ONE compact 'Sources à connecter' card instead of large empty states
	 * (density: one page = one screen). Natixis is not listed when a PDF notice is imported (the
	 * Épargne salariale card covers it).
	 */
	type SourceId = 'accounts' | 'natixis' | 'crypto';
	const emptySources = $derived.by(() => {
		const out: { id: SourceId; title: string; text: string; cta: string; action: () => void }[] = [];
		if (cmAccounts.length === 0) out.push({ id: 'accounts', title: 'Comptes bancaires', text: 'relevé Crédit Mutuel (CSV ou XLSX) : comptes, types et soldes détectés', cta: 'Importer un relevé', action: importCm });
		if (!hasNatixis() && !natixisState.holdings) out.push({ id: 'natixis', title: 'Natixis', text: 'relevé CSV Natixis', cta: 'Importer un CSV', action: importNatixis });
		if (assets.length === 0 && !getKrakenPerformance()) out.push({ id: 'crypto', title: 'Crypto · Kraken', text: 'clés API en lecture seule, relevé CSV ou saisie manuelle', cta: 'Ouvrir la page Crypto', action: () => navigate('/crypto') });
		return out;
	});
	const emptyIds = $derived(new Set<string>(emptySources.map((src) => src.id)));
	/** The grouped card takes the place of the first empty block, in the page's chosen order. */
	const firstEmptyBlock = $derived(orderedIds('patrimoine', WEALTH_BLOCKS).find((id) => emptyIds.has(id)));
</script>

{#if !txState.loaded && !txState.loadError}
	<!-- First load: shimmer skeletons -->
	<header class="mb-6">
		<Skeleton h={28} w={180} class="mb-2" />
		<Skeleton h={14} w={260} />
	</header>
	<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-12">
		<div class="sm:col-span-2 lg:col-span-7"><Skeleton h={220} rounded={8} /></div>
		<div class="sm:col-span-2 lg:col-span-5"><Skeleton h={220} rounded={8} /></div>
		<div class="sm:col-span-2 lg:col-span-12"><Skeleton h={300} rounded={8} /></div>
		<div class="sm:col-span-2 lg:col-span-12"><Skeleton h={220} rounded={8} /></div>
		<div class="lg:col-span-6"><Skeleton h={200} rounded={8} /></div>
		<div class="lg:col-span-6"><Skeleton h={200} rounded={8} /></div>
	</div>
{:else}
<header class="mb-4 flex flex-wrap items-end justify-between gap-3">
	<div>
		<PageTitle title="Patrimoine" />
	</div>
	<!-- Customise button + Kraken price status badge -->
	<div class="flex items-center gap-2 text-xs">
		{#if krakenState.priceStatus === 'loading'}
			<span class="meta-xs">Actualisation des prix…</span>
		{:else if krakenState.priceStatus === 'ok' && priceAge !== null}
			<span
				class="flex items-center gap-1.5 rounded-full px-2.5 py-1"
				style="background-color: var(--accent-soft); color: var(--accent);"
			>
				<span class="inline-block h-1.5 w-1.5 rounded-full" style="background-color: var(--accent);"></span>
				mis à jour il y a {priceAge < 5 ? "quelques secondes" : `${priceAge} s`}
			</span>
		{:else if krakenState.priceStatus === 'offline' || !krakenState.online}
			<span
				class="flex items-center gap-1.5 rounded-full px-2.5 py-1"
				style="background-color: var(--amber-soft); color: var(--amber);"
				title={krakenState.priceError}
			>
				hors ligne{krakenState.pricesAt > 0 ? ' — dernières valeurs en cache' : ''}
			</span>
		{:else if krakenState.priceStatus === 'error'}
			<span
				class="flex items-center gap-1.5 rounded-full px-2.5 py-1"
				style="background-color: var(--amber-soft); color: var(--amber);"
				title={krakenState.priceError}
			>
				prix indisponibles{krakenState.pricesAt > 0 ? ' — cache affiché' : ''}
			</span>
		{/if}
		<ModuleOptionsButton module="patrimoine" />
	</div>
</header>

<TileCanvas page="patrimoine" defaults={WEALTH_BLOCKS}>
	<!-- Customisable blocks: drag, sizes, hidden parts (see Block.svelte) -->
	{#each orderedIds('patrimoine', WEALTH_BLOCKS) as id (id)}
		{#if emptyIds.has(id)}
			{#if id === firstEmptyBlock}
				<!-- Sources without data grouped (one row each) -->
				<Block page="patrimoine" {id} defaults={WEALTH_BLOCKS} title="Sources à connecter" size="XL" class="hero-in-3">
					{#snippet children()}
						<p class="label-xs mb-2">Sources à connecter</p>
						<ul class="divide-y divide-[var(--border-subtle)] text-[13px]">
							{#each emptySources as src (src.id)}
								<li class="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5">
									<span class="font-medium">{src.title}</span>
									<span class="meta-xs min-w-0 flex-1">{src.text}</span>
									<button type="button" class="btn btn-secondary btn-sm" onclick={src.action}>{src.cta}</button>
								</li>
							{/each}
						</ul>
					{/snippet}
				</Block>
			{/if}
		{:else if id === 'natixis' && natixisState.holdings && !hasNatixis()}
			<!-- PDF notice imported without CSV: the Épargne salariale card covers Natixis -->
		{:else if id === 'rendement'}
			{#if cmAccounts.length > 0}
				<Block page="patrimoine" {id} defaults={WEALTH_BLOCKS} title="Rendement réel" size="M" sizes={['M', 'L', 'XL']} elements={REAL_RETURN_ELEMENTS} class="hero-in-3 lg:self-start">
					{#snippet children(show)}
						<RealReturnCard {show} />
					{/snippet}
				</Block>
			{/if}
		{:else if id === 'projection'}
			{#if cmAccounts.length > 0}
				<Block page="patrimoine" {id} defaults={WEALTH_BLOCKS} title="Projection du patrimoine" size="M" sizes={['M', 'L', 'XL']} elements={PROJECTION_ELEMENTS} class="hero-in-3 lg:self-start">
					{#snippet children(show, _size, box)}
						<ProjectionCard {show} fill={box?.h ?? null} />
					{/snippet}
				</Block>
			{/if}
		{:else if id === 'credit'}
			{#if hasOpenLoans}
				<Block page="patrimoine" {id} defaults={WEALTH_BLOCKS} title="Coût réel des crédits" size="M" sizes={['S', 'M', 'L', 'XL']} elements={CREDIT_ELEMENTS} class="hero-in-3 lg:self-start">
					{#snippet children(show)}
						<LoanCostCard {show} />
					{/snippet}
				</Block>
			{/if}
		{:else if id === 'networth'}
			<Block page="patrimoine" {id} defaults={WEALTH_BLOCKS} title="Valeur totale du patrimoine" size="L" sizes={['M', 'L', 'XL']} elements={NETWORTH_ELEMENTS} class="networth-glow hero-in-1 flex flex-col">
				{#snippet children(show)}
					<p class="label-xs">Valeur totale du patrimoine</p>
					<p class="display-amount mt-1">
						<!-- 80 px net amount: rolling-digit odometer (SPEC v12 §1) -->
						<OdometerAmount sensitive value={getNetWorth()} compact />
					</p>
					{#if var30 !== undefined && show('variation')}
						<p class="tabular mt-2 text-sm font-medium" style="color: {var30 >= 0 ? 'var(--accent)' : 'var(--amber)'};">
							{formatPct(var30, 1, true)} vs il y a 30 jours
						</p>
					{/if}
					{#if (debts < 0 || getTaxProvision() > 0) && show('detail')}
						<!-- Net = assets − debts − tax provision breakdown: already deducted from the large amount -->
						<p class="tabular mt-2 text-[13px] text-secondary">
							Actifs <span class="font-medium" style="color: var(--text);">{formatEUR(grossAssets)}</span>
							{#if debts < 0}· Dettes <span class="font-medium" style="color: var(--text);">−{formatEUR(-debts)}</span>{/if}
							{#if getTaxProvision() > 0}· Provision impôt <span class="font-medium" style="color: var(--amber);">−{formatEUR(getTaxProvision())}</span>{/if}
							· Net <span class="font-medium" style="color: var(--text);">{formatEUR(getNetWorth())}</span>
						</p>
					{/if}
					{#if show('sources')}
						<div class="mt-3 flex flex-wrap gap-x-5 gap-y-1 border-t pt-3 text-[13px]" style="border-color: var(--border-subtle);">
							<p class="text-secondary">
								Banques{debts < 0 ? ' (crédits déduits)' : ''} : <span class="tabular font-medium" style="color: var(--text);">{formatEUR(banks.cm + natixisCash)}</span>
							</p>
							<p class="text-secondary">
								Crypto : <span class="tabular font-medium" style="color: var(--text);">{formatEUR(getCryptoTotal())}</span>
							</p>
							{#if employeeSavingsTotal > 0}
								<p class="text-secondary" title="Valeur de l'avis Natixis{natixisState.holdings ? ` au ${formatDate(natixisState.holdings.valuedAt)}` : ''} : c'est elle qui entre au patrimoine net">
									Épargne salariale : <span class="tabular font-medium" style="color: var(--text);">{formatEUR(employeeSavingsTotal)}</span>
									{#if employeeSavingsEstimate}<span class="meta-xs"> (≈ {formatEUR(employeeSavingsEstimate.total)} estimé, non compté)</span>{/if}
								</p>
							{/if}
						</div>
					{/if}
					{#if portagePending.reserve + portagePending.frais + portagePending.salaires > 0 && show('portage')}
						<!-- Portage: amounts owed (reserve, expenses, salary paid but not received), outside net wealth -->
						<p class="meta-xs mt-2">
							À recevoir du portage, hors total :
							{#if portagePending.salaires}salaire <span class="tabular">{formatEUR(portagePending.salaires)}</span> · {/if}{#if portagePending.frais}frais <span class="tabular">{formatEUR(portagePending.frais)}</span> · {/if}réserve <span class="tabular">{formatEUR(portagePending.reserve)}</span>
							· <a href="/portage" class="hover:underline" style="color: var(--accent);">détail</a>
						</p>
					{/if}
					{#if assetTotals.estime > 0 && show('biens')}
						<!-- Possessions: outside financial wealth, total including possessions shown separately -->
						<p class="meta-xs mt-2">
							Biens (voiture, instruments…) <span class="tabular">{formatEUR(assetTotals.estime)}</span>, hors total ·
							patrimoine total, biens compris : <span class="tabular font-medium" style="color: var(--text);">{formatEUR(getNetWorth() + assetTotals.estime)}</span>
						</p>
					{/if}
				{/snippet}
			</Block>
		{:else if id === 'allocation'}
			<Block page="patrimoine" {id} defaults={WEALTH_BLOCKS} title="Allocation" size="S" sizes={['S', 'M', 'L']} elements={ALLOCATION_ELEMENTS} class="hero-in-2">
				{#snippet children(show)}
					<h2 class="label-xs mb-3">Allocation</h2>
					{#if allocationTotal > 0}
						{#if allocation.length === 1}
							<!-- A single source: a full donut says nothing, a sentence is enough -->
							<p class="flex items-center gap-2 text-[13px]">
								<span class="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style="background-color: {allocation[0]!.color};" aria-hidden="true"></span>
								<span class="font-medium">100 % · {allocation[0]!.label}</span>
								{#if show('montants')}<span class="tabular text-secondary">{formatEUR(allocation[0]!.value)}</span>{/if}
							</p>
						{:else}
							{#if show('barre')}
								<!-- 8 px stacked bar + legend (replaces the donut: readable at 60 px) -->
								<div class="flex h-2 w-full gap-px overflow-hidden rounded-full" role="img" aria-label="Répartition du patrimoine">
									{#each allocation as slice (slice.id)}
										<div style="width: {(slice.value / allocationTotal) * 100}%; background-color: {slice.color};" title="{slice.label} · {Math.round((slice.value / allocationTotal) * 100)} %"></div>
									{/each}
								</div>
							{/if}
							{#if show('legende')}
								<ul class="{show('barre') ? 'mt-3' : ''} space-y-1 text-[13px]">
									{#each allocation as slice (slice.id)}
										<li class="flex items-center gap-2">
											<span class="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style="background-color: {slice.color};" aria-hidden="true"></span>
											<span class="min-w-0 flex-1 truncate">{slice.label}</span>
											{#if show('pourcentages')}<span class="meta-xs tabular w-10 text-right">{Math.round((slice.value / allocationTotal) * 100)} %</span>{/if}
											{#if show('montants')}<span class="tabular">{formatEUR(slice.value)}</span>{/if}
										</li>
									{/each}
								</ul>
							{/if}
						{/if}
					{:else}
						<p class="text-sm text-secondary">Aucune donnée à répartir pour le moment.</p>
					{/if}
				{/snippet}
			</Block>
		{:else if id === 'history'}
			<Block page="patrimoine" {id} defaults={WEALTH_BLOCKS} title="Évolution du patrimoine" size="XL" sizes={['M', 'L', 'XL']} elements={HISTORY_ELEMENTS} class="hero-in-3">
				{#snippet children(show, _size, box)}
					<div class="flow-root" bind:clientHeight={historyTop}>
						<h2 class="label-xs mb-3">Évolution du patrimoine</h2>
						{#if history.length > 1 && historyChange && show('resume')}
							<p class="meta-xs -mt-1.5 mb-2">
								du {formatDate(historyChange.from)} au {formatDate(historyChange.to)} :
								<span class="tabular">{formatEUR(historyChange.first)}</span> →
								<span class="tabular font-medium" style="color: var(--text);">{formatEUR(historyChange.last)}</span>
								· <span class="tabular font-medium" style="color: {historyChange.delta >= 0 ? 'var(--accent)' : 'var(--amber)'};">{historyChange.delta >= 0 ? '+' : '−'}{formatEUR(Math.abs(historyChange.delta))}</span>
							</p>
						{/if}
					</div>
					{#if history.length > 1}
						<BalanceChart sensitive points={history} height={isFullscreen('patrimoine', 'history') ? 520 : chartHeight(box, historyTop, 0, show('grande') ? 360 : 240, 140)} />
					{:else}
						<p class="text-sm text-secondary">Historique insuffisant pour tracer la courbe.</p>
					{/if}
				{/snippet}
			</Block>
		{:else if id === 'accounts'}
			<Block page="patrimoine" {id} defaults={WEALTH_BLOCKS} title="Comptes détectés" size="XL" sizes={['M', 'L', 'XL']} elements={ACCOUNTS_ELEMENTS} class="hero-in-3">
				{#snippet children(show)}
					<header class="mb-3 flex flex-wrap items-end justify-between gap-3">
						<div>
							<p class="label-xs">Comptes détectés</p>
							{#if cmAccounts.length > 0}
								<h2 class="stat-amount mt-1">{cmAccounts.length} compte{cmAccounts.length > 1 ? 's' : ''}</h2>
							{/if}
						</div>
						{#if cmAccounts.length > 0 && show('total')}
							<p class="text-sm text-secondary">
								Total net <span class="tabular serif text-base" style="color: var(--text);">{formatEUR(accountsTotal)}</span>
							</p>
						{/if}
					</header>
					{#if cmAccounts.length === 0}
						<!-- Empty state: no real import (the implicit demo does not count) -->
						<div class="rounded-lg border border-dashed" style="border-color: var(--border);">
							<EmptyState
								inline
								icon="import"
								title="Aucun compte détecté"
								text="Importez un relevé Crédit Mutuel (CSV ou XLSX) : comptes, types et soldes sont détectés automatiquement."
								ctaLabel="Importer un relevé"
								onCta={importCm}
							/>
						</div>
					{:else}
						<!-- Groups side by side once the tile is wide enough, whatever the window width -->
						<div class="@container">
							<div class="grid grid-cols-1 gap-x-8 gap-y-4 @3xl:grid-cols-2">
								{#each accountGroups as group (group.kind)}
									<div>
										<!-- Group label (wide tracking) + group total on the right -->
										<div class="flex items-baseline justify-between gap-3 border-b pb-2" style="border-color: var(--border-subtle);">
											<p class="meta-xs uppercase" style="letter-spacing: 0.14em;">{group.label}</p>
											{#if show('groupes')}<p class="tabular serif text-sm">{formatEUR(group.total)}</p>{/if}
										</div>
										<ul>
											{#each group.accounts as acc (acc.id)}
												{@const gap = acc.declared !== undefined && acc.txCount > 0 ? acc.declared - acc.computed : 0}
												{@const loan = loanViews.get(acc.id)}
												{@const variation = acc.monthVar !== 0 && show('variation')}
												<li class="border-b py-2" style="border-color: var(--border-subtle);">
													<div class="flex flex-wrap items-center gap-x-3 gap-y-1">
														<Mark color={KIND_COLORS[acc.kind]} size={28}>
															<AccountIcon kind={acc.kind} size={17} />
														</Mark>
														<div class="min-w-0 flex-[1_1_9rem]">
															<!-- Only the label is truncated; the ••XXXX mask is NEVER truncated (shrink-0) nor doubled when the label already contains it -->
															<p class="flex items-baseline gap-1.5 text-sm font-medium" title={acc.label}>
																<span class="min-w-0 truncate">{acc.label}</span>
																{#if acc.last4 !== '••••' && !acc.label.includes(acc.last4)}<span class="shrink-0 font-normal text-secondary">••{acc.last4}</span>{/if}
															</p>
															{#if variation || show('operations')}
																<p class="meta-xs mt-0.5">
																	{#if variation}
																		<!-- Month change: accent when positive, neutral --debit when negative (never red) -->
																		<span class="tabular" style="color: {acc.monthVar >= 0 ? 'var(--accent)' : 'var(--debit)'};">{acc.monthVar >= 0 ? '+' : '−'}{formatEUR(Math.abs(acc.monthVar))} ce mois</span>
																		{#if show('operations')}·{/if}
																	{/if}
																	{#if show('operations')}{acc.txCount} opération{acc.txCount > 1 ? 's' : ''}{/if}
																</p>
															{/if}
														</div>
														<div class="ml-auto max-w-full min-w-0 text-right">
															<!-- Negative balance (loan) shown as is, in --text, no alert colour; tracked loan: CURRENT estimated balance (projection v13 §D.3) -->
															{#if reconcileId === acc.id}
																<form class="flex items-center gap-1.5" onsubmit={(e) => { e.preventDefault(); commitReconcile(acc); }}>
																	<input type="text" inputmode="decimal" class="input-surface tabular w-28 text-right" placeholder={String(acc.balance)} bind:value={reconcileDraft} aria-label="Solde réel affiché par la banque" />
																	<button type="submit" class="btn btn-primary btn-sm">OK</button>
																	<button type="button" class="btn btn-secondary btn-sm" onclick={() => (reconcileId = null)}>Annuler</button>
																</form>
															{:else}
																<p class="tabular serif text-base" style="color: var(--text);">{formatEUR(acc.balance)}</p>
															{/if}
															<p class="meta-xs">
																{#if loan}
																	estimé au {formatDate(loan.estimatedAt)}
																{:else}
																	{acc.declared !== undefined ? 'solde déclaré' : acc.computedFrom === 'balance' ? 'solde du relevé' : 'solde estimé'}{#if reconciled[acc.id]} · pointé le {formatDate(reconciled[acc.id]!.slice(0, 10))}{/if}
																	{#if acc.kind !== 'pret' && reconcileId !== acc.id}
																		· <button type="button" class="cursor-pointer hover:underline" title="Saisir le solde affiché par la banque : l'écart avec le calcul est signalé" onclick={() => { reconcileId = acc.id; reconcileDraft = ''; }}>pointer</button>
																	{/if}
																{/if}
															</p>
															{#if !loan && Math.abs(gap) > 1}
																{#if acc.computedFrom === 'flow'}
																	<!-- Without a Balance column, the cumulative imported flows do not cover the history: the gap is simply the balance before the export (neutral, not an error) -->
																	<p class="meta-xs" title="Les opérations importées cumulent {formatEUR(acc.computed)} ; le reste est antérieur à la période exportée.">
																		dont {formatEUR(gap)} avant les opérations importées
																	</p>
																{:else}
																	<!-- Real gap between the declared balance and the statement's last balance: to check -->
																	<p class="meta-xs" style="color: var(--accent-2);" title="Solde déclaré par la banque ({formatEUR(acc.declared ?? 0)}) vs dernier solde du relevé ({formatEUR(acc.computed)})">
																		écart avec le relevé : {formatEUR(gap)}
																	</p>
																{/if}
															{/if}
														</div>
													</div>
													{#if loan && show('credits')}
														<!-- Loan tracking (v13 §D.3): thin track, estimated end, editable monthly payment -->
														<div class="mt-2.5 pl-11">
															<div
																class="h-1 overflow-hidden rounded-full"
																style="background-color: var(--surface-hover);"
																role="progressbar"
																aria-valuenow={Math.round(loan.progress * 100)}
																aria-valuemin={0}
																aria-valuemax={100}
																aria-label="Progression du remboursement"
																title="Remboursé estimé : {Math.round(loan.progress * 100)} % (base temps : le capital initial est inconnu)"
															>
																<div class="h-full rounded-full" style="width: {Math.round(loan.progress * 100)}%; background-color: var(--accent);"></div>
															</div>
															<div class="meta-xs mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
																{#if loan.monthsRemaining > 0}
																	{@const endMonth = amortizedEndMonth(acc.id)}
																	<span title={endMonth ? 'Amortissement réel : échéance et taux trouvés dans les relevés (voir « Coût réel des crédits »)' : 'Solde ÷ part de capital mensuelle'}>fin estimée : {formatMonth(endMonth ?? loan.endMonth).toLowerCase()}</span>
																{:else}
																	<span style="color: var(--accent);">crédit remboursé (estimation)</span>
																{/if}
																<span aria-hidden="true">·</span>
																<span class="flex items-center gap-1">
																	≈
																	<input
																		type="text"
																		inputmode="decimal"
																		class="input-surface tabular w-16 !px-1.5 !py-0.5 text-xs"
																		value={String(loan.effectivePayment).replace('.', ',')}
																		aria-label="Mensualité du crédit (€ par mois)"
																		title="Corrigez la mensualité si besoin — votre saisie est mémorisée"
																		onchange={(e) => commitPayment(acc.id, (e.target as HTMLInputElement).value)}
																	/>
																	€/mois
																</span>
																{#if loan.isOverride}
																	<button
																		type="button"
																		class="press cursor-pointer font-medium transition-colors hover:underline"
																		style="color: var(--accent);"
																		title="Revenir à la mensualité détectée des relevés"
																		onclick={() => clearMonthlyOverride(acc.id)}
																	>
																		↺ détectée
																	</button>
																{/if}
															</div>
														</div>
													{/if}
												</li>
											{/each}
										</ul>
									</div>
								{/each}
							</div>
						</div>
					{/if}
				{/snippet}
			</Block>
		{:else if id === 'natixis'}
			<Block page="patrimoine" {id} defaults={WEALTH_BLOCKS} title="Natixis" size="M" sizes={['S', 'M', 'L']} elements={NATIXIS_ELEMENTS} class="hero-in-3 lg:self-start">
				{#snippet children(show)}
					<div class="flex items-center justify-between gap-2">
						<h2 class="label-xs">Natixis</h2>
						<span class="inline-block h-2.5 w-2.5 rounded-full" style="background-color: var(--debit);" aria-hidden="true"></span>
					</div>
					{#if hasNatixis()}
						<p class="amount-md mt-2.5">
							<AnimatedAmount sensitive value={banks.natixis} format={formatEUR} />
						</p>
						{#if show('compteur')}
							<p class="meta-xs mt-1.5">
								{natixisTxCount} transaction{natixisTxCount > 1 ? 's' : ''} importée{natixisTxCount > 1 ? 's' : ''}
								{#if natixisState.holdings}· non compté au patrimoine : l'avis PDF valorise déjà l'épargne salariale{/if}
							</p>
						{/if}
						{#if show('reimport')}
							<button
								type="button"
								class="press mt-3 cursor-pointer text-left text-xs font-medium transition-colors hover:underline"
								style="color: var(--accent);"
								onclick={importNatixis}
							>
								Ré-importer un CSV
							</button>
						{/if}
					{:else}
						<!-- Illustrated empty state: prompt to import -->
						<div class="mt-3 rounded-lg border border-dashed" style="border-color: var(--border);">
							<EmptyState
								inline
								icon="import"
								title="Aucune donnée Natixis"
								text="Importez un relevé CSV Natixis pour suivre ce compte dans votre patrimoine."
								ctaLabel="Importer un CSV Natixis"
								onCta={importNatixis}
							/>
						</div>
					{/if}
				{/snippet}
			</Block>
		{:else if id === 'crypto'}
			<Block page="patrimoine" {id} defaults={WEALTH_BLOCKS} title="Crypto · Kraken" size="M" sizes={['S', 'M', 'L']} elements={CRYPTO_ELEMENTS} class="hero-in-3 lg:self-start">
				{#snippet children(show)}
					<div class="flex items-center justify-between gap-2">
						<h2 class="label-xs">Crypto · Kraken</h2>
						{#if show('lien')}<a href="/crypto" class="text-xs font-medium transition-colors hover:underline" style="color: var(--accent);">Voir la page Crypto</a>{/if}
					</div>
					<p class="amount-md mt-2.5"><AnimatedAmount sensitive value={getCryptoTotal()} format={formatEUR} /></p>
					{#if getKrakenPerformance() && show('gain')}
						{@const perf = getKrakenPerformance()!}
						<p class="meta-xs mt-1">
							Gain net <span class="tabular font-medium" style="color: {perf.gain >= 0 ? 'var(--accent)' : 'var(--amber)'};">{perf.gain >= 0 ? '+' : '−'}{formatEUR(Math.abs(perf.gain))}</span>
							{#if perf.gainPct !== undefined}({formatPct(perf.gainPct, 1, true)}){/if}
							· apports {formatEUR(perf.invested)} · sorties {formatEUR(perf.withdrawn)}
						</p>
					{/if}
					{#if assets.length > 0}
						{#if show('positions')}
							<!-- Top 3 positions + the rest -->
							<ul class="mt-3 divide-y divide-[var(--border-subtle)] text-[13px]">
								{#each assets.slice(0, 3) as asset (asset.symbol)}
									<li class="flex items-center gap-3 py-1.5">
										<span class="min-w-0 flex-1 truncate font-medium">{asset.symbol}</span>
										{#if show('parts')}<span class="tabular text-secondary">{asset.eur !== undefined && getCryptoTotal() > 0 ? formatPct((asset.eur / getCryptoTotal()) * 100, 0) : ''}</span>{/if}
										<span class="tabular w-24 text-right font-medium">{asset.eur !== undefined ? formatEUR(asset.eur) : '—'}</span>
									</li>
								{/each}
								{#if assets.length > 3}
									<li class="flex items-center gap-3 py-1.5 text-secondary">
										<span class="min-w-0 flex-1 truncate">Autres · {assets.length - 3} actif{assets.length - 3 > 1 ? 's' : ''}</span>
										<span class="tabular w-24 text-right">{formatEUR(assets.slice(3).reduce((sum, a) => sum + (a.eur ?? 0), 0))}</span>
									</li>
								{/if}
							</ul>
						{/if}
					{:else}
						<div class="mt-3 rounded-lg border border-dashed" style="border-color: var(--border);">
							<EmptyState inline icon="key" title={krakenState.hasKeys ? 'Aucun actif crypto' : 'Kraken non configuré'} text="Clés API en lecture seule, relevé CSV ou saisie manuelle sur la page Crypto." ctaLabel="Ouvrir la page Crypto" onCta={() => navigate('/crypto')} />
						</div>
					{/if}
				{/snippet}
			</Block>
		{:else if id === 'biens'}
			<Block page="patrimoine" {id} defaults={WEALTH_BLOCKS} title="Biens" size="M" sizes={['S', 'M', 'L']} elements={ASSETS_ELEMENTS} class="hero-in-3 lg:self-start">
				{#snippet children(show)}
					<div class="@container">
						<AssetsCard {show} />
					</div>
				{/snippet}
			</Block>
		{:else if id === 'epargne'}
			<Block page="patrimoine" {id} defaults={WEALTH_BLOCKS} title="Épargne salariale Natixis" size="XL" sizes={['L', 'XL']} elements={EMPLOYEE_SAVINGS_ELEMENTS} bare>
				{#snippet children(show, _size, box)}
					<!-- The card stretches to the bottom of a tile whose height is set -->
					<div class="*:min-h-[var(--tile-fill)]" style={box ? `--tile-fill: ${box.h}px;` : ''}>
						<NatixisSavings {show} />
					</div>
				{/snippet}
			</Block>
		{:else if id === 'impots'}
			<Block page="patrimoine" {id} defaults={WEALTH_BLOCKS} title="Impôts" size="XL" sizes={['L', 'XL']} elements={TAX_ELEMENTS} bare>
				{#snippet children(show, _size, box)}
					<div class="*:min-h-[var(--tile-fill)]" style={box ? `--tile-fill: ${box.h}px;` : ''}>
						<TaxCard {show} />
					</div>
				{/snippet}
			</Block>
		{/if}
	{/each}
</TileCanvas>
{/if}

<style>
</style>
