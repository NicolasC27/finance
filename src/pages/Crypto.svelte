<script lang="ts">
	import { onMount } from 'svelte';
	import { uiState, showToast } from '$lib/ui.svelte';
	import { formatEUR, formatDate, formatMonth, formatPct } from '$lib/format';
	import { isPriceable } from '$lib/kraken';
	import { getKrakSummary } from '$lib/krakCard.svelte';
	import { navigate } from '$lib/router.svelte';
	import {
		krakenState,
		getAssets,
		getCryptoTotal,
		getKrakenPerformance,
		getCryptoHistory,
		refreshPrices,
		refreshBalances,
		loadOhlc,
		setManualQty,
		removeManual,
		syncLedgerFromApi,
		getCryptoFlowAssets,
		loadOhlcWeekly,
		priceAtDate
	} from '$lib/wealth.svelte';
	import { krakenLedgerState, getAssetTrades, getLedgerEntries } from '$lib/krakenLedger.svelte';
	import { computeTaxReport, EXEMPTION_THRESHOLD } from '$lib/cryptoTax';
	import type { ChartAnnotation } from '$lib/components/BalanceChart.svelte';
	import { trendFromOhlc, type TrendReading } from '$lib/trends';
	import AnimatedAmount from '$lib/components/AnimatedAmount.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Sparkline from '$lib/components/Sparkline.svelte';
	import PageTitle from '$lib/components/PageTitle.svelte';
	import ModuleOptionsButton from '$lib/components/ModuleOptionsButton.svelte';
	import Block from '$lib/components/Block.svelte';
	import TileCanvas from '$lib/components/TileCanvas.svelte';
	import { orderedIds } from '$lib/layout.svelte';
	import type { BlockElement } from '$lib/layoutModel';
	import { othersRowSpans, positionColumns, taxColumns } from '$lib/cryptoTables';

	/** Customisable blocks of the page (default order). */
	const BLOCKS = ['summary', 'rewards', 'positions', 'tax'] as const;

	/** Frame of the portfolio history curve once the tile height is fixed (drawn at its pixel size). */
	let curveW = $state(0);
	let curveH = $state(0);

	/** Optional elements of each block (the user can hide them). */
	const SUMMARY_ELEMENTS: BlockElement[] = [
		{ id: 'attente', label: 'Montants en attente' },
		{ id: 'bilan', label: 'Apports, sorties et gain net' },
		{ id: 'periode', label: 'Période et avertissements' },
		{ id: 'courbe', label: 'Courbe de la valeur' }
	];
	const REWARDS_ELEMENTS: BlockElement[] = [
		{ id: 'recompenses', label: 'Cashback et earn' },
		{ id: 'krak', label: 'Carte Krak · cashback' },
		{ id: 'mois', label: 'Détail des 6 derniers mois' },
		{ id: 'actions', label: 'Clés API et synchronisation' }
	];
	const POSITIONS_ELEMENTS: BlockElement[] = [
		{ id: 'quantite', label: 'Quantité' },
		{ id: 'cours', label: 'Prix et variation du jour' },
		{ id: 'part', label: 'Part du portefeuille' },
		{ id: 'revient', label: 'Prix de revient et gain' },
		{ id: 'tendance', label: 'Tendance (haussier, baissier)' }
	];
	const TAX_ELEMENTS: BlockElement[] = [
		{ id: 'regles', label: 'Règles fiscales' },
		{ id: 'declare', label: 'Colonne « Déclaré »' },
		{ id: 'export', label: 'Boutons « CSV 2086 »' },
		{ id: 'alertes', label: 'Avertissements' },
		{ id: 'note', label: 'Note et export du ledger' }
	];

	import CryptoNews from '$lib/components/CryptoNews.svelte';
	import BalanceChart from '$lib/components/BalanceChart.svelte';
	import type { BalancePoint } from '$lib/data';

	/**
	 * Crypto page (/crypto): one-screen summary of the Kraken account: value, net gain,
	 * contributions/withdrawals, curve; compact table of positions (small ones grouped),
	 * cashback/earn, manual entry.
	 */

	let now = $state(Date.now());
	let manualSymbol = $state('');
	let manualQty = $state('');
	let showSmall = $state(false);
	/** Asset whose price chart is expanded (click on the row). */
	let openSymbol = $state<string | null>(null);
	type Period = '1M' | '3M' | '6M' | '1A' | '2A';
	let period = $state<Period>('1A');
	const PERIOD_DAYS: Record<Period, number> = { '1M': 30, '3M': 91, '6M': 182, '1A': 365, '2A': 730 };

	function toggleChart(symbol: string) {
		openSymbol = openSymbol === symbol ? null : symbol;
		if (openSymbol) void loadOhlc(openSymbol);
	}

	/** Daily prices (Kraken OHLC closes, up to 2 years) of the open asset, over the chosen period. */
	const chartPoints = $derived.by((): BalancePoint[] => {
		if (!openSymbol) return [];
		const series = krakenState.ohlc[openSymbol] ?? [];
		const from = Date.now() - PERIOD_DAYS[period] * 86_400_000;
		return series
			.filter((p) => p.t >= from)
			.map((p) => {
				const d = new Date(p.t);
				return { date: d, iso: d.toISOString().slice(0, 10), balance: p.close };
			});
	});
	/** Buys/sells of the open asset, placed on the curve (displayed period). */
	const chartTrades = $derived.by((): ChartAnnotation[] => {
		if (!openSymbol || chartPoints.length === 0) return [];
		const first = chartPoints[0]!.iso;
		const have = new Set(chartPoints.map((p) => p.iso));
		return getAssetTrades(openSymbol)
			.filter((t) => t.date >= first && have.has(t.date))
			.map((t) => ({ iso: t.date, kind: t.side === 'buy' ? 'salary' : 'expense', label: t.side === 'buy' ? 'Achat' : 'Vente', amount: t.eur, text: `${t.side === 'buy' ? 'Achat' : 'Vente'} ${formatEUR(t.eur)} à ${formatPrice(t.price)}` }));
	});
	/** Total number of operations of the open asset (all periods). */
	const tradeCount = $derived(openSymbol ? getAssetTrades(openSymbol).length : 0);

	// ---- Price target: a statistical scenario (not a forecast) ----
	let targetInput = $state('');
	/**
	 * Analysis of the target set on the open asset: distance, volatility and probability of touching
	 * it (random walk). Annualised volatility of daily log returns over at most one year; probability
	 * of TOUCHING the target by t (barrier, driftless random walk): 2·(1 − Φ(|ln(G/S)| / (σ√t))); last
	 * time the price reached the target (within the 2 years of data); largest rise over a rolling 90
	 * days (order of magnitude of what the asset already did).
	 */
	const target = $derived.by(() => {
		if (!openSymbol) return null;
		const series = krakenState.ohlc[openSymbol] ?? [];
		const price = krakenState.prices[openSymbol]?.price ?? series[series.length - 1]?.close;
		const goal = Number(targetInput.replace(',', '.'));
		if (!price || !Number.isFinite(goal) || goal <= 0 || series.length < 30) return null;
		const closes = series.slice(-365).map((p) => p.close);
		const rets: number[] = [];
		for (let i = 1; i < closes.length; i++) rets.push(Math.log(closes[i]! / closes[i - 1]!));
		const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
		const variance = rets.reduce((a, r) => a + (r - mean) ** 2, 0) / Math.max(1, rets.length - 1);
		const dailyVol = Math.sqrt(variance);
		const annualVol = dailyVol * Math.sqrt(365);
		const distance = goal / price - 1;
		const phi = (x: number) => 0.5 * (1 + erf(x / Math.SQRT2));
		const hit = (days: number) => 2 * (1 - phi(Math.abs(Math.log(goal / price)) / (dailyVol * Math.sqrt(days))));
		let lastAbove: string | null = null;
		for (let i = series.length - 1; i >= 0; i--) {
			if ((goal >= price && series[i]!.close >= goal) || (goal < price && series[i]!.close <= goal)) {
				lastAbove = new Date(series[i]!.t).toISOString().slice(0, 10);
				break;
			}
		}
		let bestRun = 0;
		for (let i = 0; i + 90 < closes.length; i++) {
			let mx = 0;
			for (let j = i + 1; j <= i + 90; j++) mx = Math.max(mx, closes[j]! / closes[i]! - 1);
			bestRun = Math.max(bestRun, mx);
		}
		return { price, goal, distance, annualVol, p3: hit(91), p6: hit(182), p12: hit(365), lastAbove, bestRun };
	});

	// ---- Taxes (art. 150 VH bis): computed from the ledger rows + price at the date ----
	const ledgerEntries = $derived(getLedgerEntries());
	const taxReport = $derived(ledgerEntries.length > 0 ? computeTaxReport(ledgerEntries, priceAtDate) : null);
	let taxOpenYear = $state<number | null>(null);
	/** Amounts declared (tax notices) per year, for comparison: persisted. */
	const DECLARED_KEY = 'budget:crypto-tax-declared';
	let declared = $state<Record<string, string>>(loadDeclared());
	function loadDeclared(): Record<string, string> {
		try {
			return JSON.parse(localStorage.getItem(DECLARED_KEY) ?? '{}') as Record<string, string>;
		} catch {
			return {};
		}
	}
	function setDeclared(year: number, raw: string) {
		declared = { ...declared, [year]: raw };
		try {
			localStorage.setItem(DECLARED_KEY, JSON.stringify(declared));
		} catch {
		}
	}
	function declaredValue(year: number): number | null {
		const n = Number((declared[year] ?? '').replace(/\s/g, '').replace(',', '.'));
		return declared[year] && Number.isFinite(n) ? n : null;
	}
	/** Export of the stored ledger (Kraken CSV format): diagnosis, backup, re-import. */
	function exportLedger() {
		const rows = [['txid', 'refid', 'time', 'type', 'subtype', 'aclass', 'wallet', 'asset', 'wallet2', 'amount', 'fee', 'balance'],
			...ledgerEntries.map((e) => [e.txid, e.refid, e.at, e.type, e.subtype, 'currency', 'spot', e.asset, '', String(e.amount), String(e.fee), String(e.balance)])];
		const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
		const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
		const a = document.createElement('a');
		a.href = URL.createObjectURL(blob);
		a.download = `kraken-ledger-${new Date().toISOString().slice(0, 10)}.csv`;
		a.click();
		URL.revokeObjectURL(a.href);
	}

	/** CSV export of a year's disposals (columns of form 2086). */
	function exportCsv(year: number) {
		const y = taxReport?.years.find((t) => t.year === year);
		if (!y) return;
		const rows = [['Date', 'Actif', 'Quantité', 'Prix de cession (€)', 'Frais (€)', 'Valeur globale du portefeuille (€)', 'Prix total d’acquisition (€)', 'Fraction de capital initial (€)', 'Plus ou moins-value (€)'],
			...y.cessions.map((c) => [c.date, c.asset, String(c.qty), c.proceeds.toFixed(2), c.fees.toFixed(2), c.portfolioValue.toFixed(2), c.acquisitionCost.toFixed(2), c.fractionUsed.toFixed(2), c.gain.toFixed(2)])];
		const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\n');
		const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' });
		const a = document.createElement('a');
		a.href = URL.createObjectURL(blob);
		a.download = `cessions-crypto-${year}.csv`;
		a.click();
		URL.revokeObjectURL(a.href);
	}

	/** Error function (Abramowitz-Stegun 7.1.26 approximation, error < 1.5e-7). */
	function erf(x: number): number {
		const sign = x < 0 ? -1 : 1;
		const ax = Math.abs(x);
		const t = 1 / (1 + 0.3275911 * ax);
		const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-ax * ax);
		return sign * y;
	}

	/** Period markers: first/last price, change, high, low. */
	const chartStats = $derived.by(() => {
		const pts = chartPoints;
		if (pts.length < 2) return null;
		const first = pts[0]!.balance;
		const last = pts[pts.length - 1]!.balance;
		const closes = pts.map((p) => p.balance);
		return { first, last, pct: first > 0 ? ((last - first) / first) * 100 : 0, high: Math.max(...closes), low: Math.min(...closes) };
	});
	let syncing = $state<string | null>(null);
	/** Sync starting point: 'all' (whole history) or a year. */
	let syncYear = $state<string>('all');
	const thisYear = new Date().getFullYear();
	const syncYears = Array.from({ length: thisYear - 2013 + 1 }, (_, i) => String(thisYear - i));

	const assets = $derived(getAssets());
	const total = $derived(getCryptoTotal());
	const perf = $derived(getKrakenPerformance());
	const ledger = $derived(krakenLedgerState.ledger);
	const cryptoHist = $derived(getCryptoHistory());

	/** 'Small position' threshold: < 1 % of the portfolio (or no price). */
	const SMALL_PCT = 1;
	const main = $derived(assets.filter((a) => a.eur !== undefined && total > 0 && (a.eur / total) * 100 >= SMALL_PCT));
	const small = $derived(assets.filter((a) => !main.includes(a)));
	const smallTotal = $derived(Math.round(small.reduce((s, a) => s + (a.eur ?? 0), 0) * 100) / 100);
	const visible = $derived(showSmall ? [...main, ...small] : main);

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

	const cashbackEntries = $derived(
		Object.entries(ledger.cashbackTotal)
			.filter(([, qty]) => qty > 0)
			.map(([symbol, qty]) => ({ symbol, qty, eur: krakenState.prices[symbol] ? qty * krakenState.prices[symbol]!.price : undefined }))
	);
	const earnEntries = $derived(Object.entries(ledger.earnTotal).filter(([, q]) => q > 0));
	const priceAge = $derived(krakenState.pricesAt > 0 ? Math.max(0, Math.round((now - krakenState.pricesAt) / 1000)) : null);

	/** Crypto price: 4 significant digits ('74 777 €', '0,2128 €'), never '0 €'. */
	function formatPrice(v: number): string {
		const abs = Math.abs(v);
		const digits = abs >= 1000 ? 0 : abs >= 1 ? 2 : abs >= 0.01 ? 4 : 6;
		return `${new Intl.NumberFormat('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v)} €`;
	}

	function formatQty(qty: number): string {
		return new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 8 }).format(qty);
	}
	function pct(eur: number | undefined): string {
		return eur !== undefined && total > 0 ? formatPct((eur / total) * 100, 1) : '—';
	}

	function addManual() {
		const qty = Number(manualQty.replace(',', '.'));
		if (!manualSymbol.trim() || !Number.isFinite(qty) || qty <= 0) return;
		setManualQty(manualSymbol, qty);
		manualSymbol = '';
		manualQty = '';
	}

	async function syncHistory() {
		if (syncing) return;
		syncing = 'Connexion…';
		try {
			const since = syncYear === 'all' ? undefined : `${syncYear}-01-01`;
			const r = await syncLedgerFromApi(since, (n, t) => (syncing = `${n} / ${t} lignes…`));
			showToast(`Historique Kraken : ${r.entries} ligne${r.entries > 1 ? 's' : ''} lue${r.entries > 1 ? 's' : ''}, ${r.fresh} nouvelle${r.fresh > 1 ? 's' : ''}, ${r.transactions} opération${r.transactions > 1 ? 's' : ''} EUR ajoutée${r.transactions > 1 ? 's' : ''} au budget`);
		} catch (e) {
			const msg = e instanceof Error ? e.message : 'Erreur';
			showToast(/permission/i.test(msg) ? 'Kraken refuse : ajoutez la permission « Consulter le registre » à votre clé API' : `Synchronisation Kraken impossible : ${msg}`);
		} finally {
			syncing = null;
		}
	}

	/**
	 * Weekly prices of every asset ever held, to value the portfolio at disposal dates (taxes).
	 * Neither fiat nor KFEE: no EUR pair to request.
	 */
	onMount(() => {
		void refreshPrices();
		if (krakenState.hasKeys) void refreshBalances();
		const ohlcTimer = window.setTimeout(() => {
			for (const a of getAssets().slice(0, 6)) void loadOhlc(a.symbol);
			for (const sym of getCryptoFlowAssets()) void loadOhlc(sym);
			for (const sym of new Set(getLedgerEntries().filter((e) => isPriceable(e.asset)).map((e) => e.asset))) void loadOhlcWeekly(sym);
		}, 400);
		const priceTimer = window.setInterval(() => void refreshPrices(), 60_000);
		const tickTimer = window.setInterval(() => (now = Date.now()), 1_000);
		return () => {
			window.clearTimeout(ohlcTimer);
			window.clearInterval(priceTimer);
			window.clearInterval(tickTimer);
		};
	});

	/** Krak card: what the cashback brings in (imported PDF statements). */
	const krak = $derived(getKrakSummary());
</script>

<header class="mb-4 flex flex-wrap items-end justify-between gap-3">
	<PageTitle title="Crypto" />
	<div class="flex flex-wrap items-center gap-2 text-xs">
		{#if krakenState.balanceStatus === 'ok'}
			<span class="chip chip-accent">clés API</span>
		{:else if assets.some((a) => a.source === 'ledger')}
			<span class="chip chip-accent">relevé</span>
		{:else if krakenState.balanceStatus === 'error'}
			<span class="chip chip-amber" title={krakenState.balanceError}>API en erreur</span>
		{:else if assets.some((a) => a.source === 'manual')}
			<span class="chip chip-muted">manuel</span>
		{/if}
		{#if priceAge !== null}
			<span class="meta-xs">prix il y a {priceAge < 5 ? 'quelques secondes' : `${priceAge} s`}</span>
		{:else if krakenState.priceStatus === 'error' || krakenState.priceStatus === 'offline'}
			<span class="chip chip-amber" title={krakenState.priceError}>prix indisponibles</span>
		{/if}
		<ModuleOptionsButton module="crypto" />
	</div>
</header>

<TileCanvas page="crypto" defaults={BLOCKS}>
	{#each orderedIds('crypto', BLOCKS) as id (id)}
		{#if id === 'summary'}
			<Block page="crypto" {id} defaults={BLOCKS} title="Portefeuille" size="M" sizes={['M', 'L', 'XL']} elements={SUMMARY_ELEMENTS} class="hero-in-1">
				{#snippet children(show, _size, box)}
		<div class="tuile-col @container" class:tuile-pleine={!!box} style:min-height={box ? `${box.h}px` : null}>
		<p class="label-xs">Valeur du portefeuille</p>
		<p class="stat-amount mt-1"><AnimatedAmount value={total} format={formatEUR} /></p>
		{#if Object.keys(krakenState.hold).length > 0 && show('attente')}
			<p class="meta-xs mt-1" title="Dépôts ou retraits pas encore crédités par Kraken : non comptés dans la valeur">
				En attente (non compté) : {Object.entries(krakenState.hold).map(([sym, q]) => `${formatQty(q)} ${sym}`).join(' · ')}
			</p>
		{/if}
		{#if perf}
			{#if show('bilan')}
			<div class="mt-3 grid grid-cols-1 gap-x-4 gap-y-2 border-t pt-3 text-[13px] @min-[14rem]:grid-cols-2 @min-[30rem]:grid-cols-4" style="border-color: var(--border-subtle);">
				<div>
					<p class="meta-xs" title="Dépôts en euros + cryptos reçues de l'extérieur (valorisées au prix du jour de réception)">Apports</p>
					<p class="tabular font-medium">{formatEUR(perf.invested)}</p>
				</div>
				<div>
					<p class="meta-xs" title="Retraits vers la banque (nets des retraits annulés, frais exclus) + virements vers la carte Krak + dépenses carte + cryptos envoyées vers un autre portefeuille (valorisées au prix du jour)">Sorties</p>
					<p class="tabular font-medium">{formatEUR(perf.withdrawn)}</p>
				</div>
				<div>
					<p class="meta-xs">Valeur actuelle</p>
					<p class="tabular font-medium">{formatEUR(perf.value)}</p>
				</div>
				<div>
					<p class="meta-xs" title="Valeur actuelle + sorties − apports">Gain net</p>
					<p class="tabular font-medium" style="color: {perf.gain >= 0 ? 'var(--accent)' : 'var(--amber)'};">
						{perf.gain >= 0 ? '+' : '−'}{formatEUR(Math.abs(perf.gain))}{#if perf.gainPct !== undefined} ({formatPct(perf.gainPct, 1, true)}){/if}
					</p>
				</div>
			</div>
			{/if}
			{#if show('periode')}
			<p class="meta-xs mt-2">
				Depuis le {formatDate(perf.since)}, relevé jusqu'au {formatDate(perf.until)}.
				{#if perf.unpricedFlows > 0}
					<span style="color: var(--amber);">{perf.unpricedFlows} mouvement{perf.unpricedFlows > 1 ? 's' : ''} crypto entrant/sortant sans prix connu (non compté{perf.unpricedFlows > 1 ? 's' : ''} dans apports/sorties).</span>
				{/if}
				{#if perf.unpricedAssets > 0}
					<span style="color: var(--amber);">{perf.unpricedAssets} actif{perf.unpricedAssets > 1 ? 's' : ''} sans cours, valorisé{perf.unpricedAssets > 1 ? 's' : ''} à 0 €.</span>
				{/if}
			</p>
			{/if}
		{:else}
			<p class="meta-xs mt-2">Synchronisez l'historique (clés API) ou importez un relevé CSV pour voir apports, sorties et gain net.</p>
		{/if}
		{#if cryptoHist.points.length > 1 && show('courbe')}
			<div class="courbe-bloc mt-3 flex flex-col border-t pt-3" style="border-color: var(--border-subtle);">
				<p class="meta-xs mb-1.5">{cryptoHist.priced ? 'Valeur du portefeuille dans le temps (prix Kraken)' : `Solde ${cryptoHist.fallbackAsset ?? ''} — prix indisponibles`}</p>
				{#if box}
					<div class="courbe-cadre" bind:clientWidth={curveW} bind:clientHeight={curveH}>
						{#if curveW > 0 && curveH > 0}<Sparkline values={cryptoHist.points.map((p) => p.balance)} width={curveW} height={curveH} />{/if}
					</div>
				{:else}
					<Sparkline values={cryptoHist.points.map((p) => p.balance)} width={700} height={56} class="h-auto w-full" />
				{/if}
			</div>
		{/if}
		</div>
				{/snippet}
			</Block>
		{:else if id === 'rewards'}
			<Block page="crypto" {id} defaults={BLOCKS} title="Récompenses" size="M" sizes={['S', 'M', 'L']} elements={REWARDS_ELEMENTS} class="hero-in-2">
				{#snippet children(show, _size, box)}
		<div class="tuile-col @container" style:min-height={box ? `${box.h}px` : null}>
		<p class="label-xs">Récompenses</p>
		{#if show('recompenses')}
		{#if cashbackEntries.length > 0 || earnEntries.length > 0}
			<ul class="mt-2 space-y-1 text-[13px]">
				{#each cashbackEntries as c (c.symbol)}
					<li class="flex items-baseline justify-between gap-3">
						<span class="text-secondary">Cashback carte · {ledger.cashbackCount} dépense{ledger.cashbackCount > 1 ? 's' : ''}</span>
						<span class="tabular font-medium" style="color: var(--accent);">{formatQty(c.qty)} {c.symbol}{#if c.eur !== undefined} <span class="meta-xs">≈ {formatEUR(c.eur)}</span>{/if}</span>
					</li>
				{/each}
				{#each earnEntries as [symbol, qty] (symbol)}
					<li class="flex items-baseline justify-between gap-3">
						<span class="text-secondary" title="Staking, earn et bonus reçus, nets de la commission Kraken">Récompenses</span>
						<span class="tabular font-medium">{formatQty(qty)} {symbol}</span>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="meta-xs mt-2">Aucune récompense connue (cashback carte, earn) : elles arrivent avec l'historique.</p>
		{/if}
		{/if}
		<!-- Krak card: real savings thanks to the cashback, from the monthly statements -->
		{#if show('krak')}
		<div class="mt-3 border-t pt-3" style="border-color: var(--border-subtle);">
			<div class="flex items-baseline justify-between gap-3">
				<p class="label-xs">Carte Krak · cashback</p>
				{#if krak.months.length > 0}<span class="meta-xs">{krak.months.length} relevé{krak.months.length > 1 ? 's' : ''}</span>{/if}
			</div>
			{#if krak.months.length > 0}
				<div class="mt-2 grid grid-cols-1 gap-3 @min-[15rem]:grid-cols-2 @min-[24rem]:grid-cols-3">
					<div>
						<p class="meta-xs">Cashback reçu</p>
						<p class="amount-md tabular" style="color: var(--accent);">+{formatEUR(krak.cashbackEur)}</p>
					</div>
					<div>
						<p class="meta-xs">Dépensé avec la carte</p>
						<p class="amount-md tabular">{formatEUR(krak.spendEur)}</p>
					</div>
					<div>
						<p class="meta-xs">Taux · moyenne / mois</p>
						<p class="amount-md tabular">{krak.rate === null ? '—' : formatPct(krak.rate, 1)} <span class="meta-xs">· {formatEUR(krak.avgPerMonth)}</span></p>
					</div>
				</div>
				{#if show('mois')}
				<table class="mt-2 w-full text-xs">
					<tbody>
						{#each krak.months.slice(-6).reverse() as m (m.month)}
							<tr class="border-t" style="border-color: var(--border-subtle);">
								<td class="py-1 capitalize text-secondary">{formatMonth(m.month)}</td>
								<td class="tabular py-1 text-right">{formatEUR(m.data.spendEur)}</td>
								<td class="tabular py-1 text-right" style="color: var(--accent);">+{formatEUR(m.data.cashbackEur)}</td>
								<td class="tabular py-1 text-right text-secondary">{m.rate === null ? '—' : formatPct(m.rate, 1)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
				{/if}
				<p class="meta-xs mt-1">cashback valorisé en euros au cours du jour de versement (BTC ou EUR selon le mois)</p>
			{:else}
				<p class="meta-xs mt-1">
					Importez vos relevés mensuels Kraken (PDF) depuis
					<button type="button" class="cursor-pointer underline" onclick={() => navigate('/transactions')}>Transactions › Relevés Krak</button>
					: dépenses carte avec le nom du commerçant, et cashback reçu.
				</p>
			{/if}
		</div>
		{/if}
		{#if show('actions')}
		<div class="mt-auto flex flex-wrap items-center gap-2 pt-4">
			<button type="button" class="btn btn-secondary btn-sm" onclick={() => (uiState.krakenModalOpen = true)}>
				{krakenState.hasKeys ? 'Gérer les clés API' : 'Configurer les clés API'}
			</button>
			{#if krakenState.hasKeys}
				<!-- Since when: the whole history, or from 1 January of a year -->
				<select class="input-surface cursor-pointer" bind:value={syncYear} disabled={syncing !== null} aria-label="Synchroniser depuis">
					<option value="all">Tout l'historique</option>
					{#each syncYears as y (y)}
						<option value={y}>Depuis {y}</option>
					{/each}
				</select>
				<button
					type="button"
					class="btn btn-accent btn-sm"
					disabled={syncing !== null}
					title="Lit le ledger Kraken (permission « Consulter le registre ») depuis la date choisie ; les lignes déjà connues sont ignorées, les apports/sorties et prix de revient sont recalculés"
					onclick={() => void syncHistory()}
				>
					{syncing ?? 'Synchroniser'}
				</button>
			{/if}
		</div>
		{/if}
		</div>
				{/snippet}
			</Block>
		{:else if id === 'positions'}
			<Block page="crypto" {id} defaults={BLOCKS} title="Positions" size="XL" sizes={['L', 'XL']} elements={POSITIONS_ELEMENTS} class="hero-in-3">
				{#snippet children(show, _size, box)}
		<div class="mb-2 flex flex-wrap items-center justify-between gap-2">
			<h2 class="label-xs">Positions · {assets.length}</h2>
			{#if small.length > 0}
				<button type="button" class="press cursor-pointer text-xs font-medium transition-colors hover:underline" style="color: var(--accent);" onclick={() => (showSmall = !showSmall)}>
					{showSmall ? 'Masquer les petites positions' : `${small.length} petite${small.length > 1 ? 's' : ''} position${small.length > 1 ? 's' : ''} (< ${SMALL_PCT} %) · ${formatEUR(smallTotal)}`}
				</button>
			{/if}
		</div>
		{#if assets.length > 0}
			<div class="overflow-x-auto">
				<table class="w-full min-w-[640px] border-collapse text-[12px]">
					<thead>
						<tr class="text-left">
							<th class="label-plain py-2 pr-3">Actif</th>
							{#if show('quantite')}<th class="label-plain py-2 pr-3 text-right">Quantité</th>{/if}
							{#if show('cours')}<th class="label-plain py-2 pr-3 text-right">Prix</th>{/if}
							<th class="label-plain py-2 pr-3 text-right">Valeur</th>
							{#if show('part')}<th class="label-plain py-2 pr-3 text-right">Part</th>{/if}
							{#if show('revient')}
								<th class="label-plain py-2 pr-3 text-right" title="Prix de revient unitaire (coût moyen de vos achats)">PRU</th>
								<th class="label-plain py-2 pr-3 text-right" title="Plus-value latente par rapport au prix de revient">Gain</th>
							{/if}
							{#if show('cours')}<th class="label-plain py-2 text-right" title="Variation du cours depuis l'ouverture du jour (0 h UTC), cours Kraken">Jour</th>{/if}
						</tr>
					</thead>
					<tbody>
						{#each visible as asset (asset.symbol)}
							{@const t = trends[asset.symbol]}
							<tr
								class="row-hover press cursor-pointer border-t"
								style="border-color: var(--border-subtle);"
								title="Voir le graphique du cours"
								aria-expanded={openSymbol === asset.symbol}
								onclick={() => toggleChart(asset.symbol)}
							>
								<td class="py-1 pr-3">
									<span class="flex items-center gap-2 font-medium">
										<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="shrink-0 text-secondary transition-transform" style="transform: rotate({openSymbol === asset.symbol ? 90 : 0}deg);"><path d="m9 6 6 6-6 6" /></svg>
										<span class="serif flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px]" style="border-color: var(--hairline); color: var(--accent);" aria-hidden="true">{asset.symbol.charAt(0)}</span>
										{asset.symbol}
										{#if t && show('tendance')}
											<span class="chip {t.badge === 'haussier' ? 'chip-accent' : t.badge === 'baissier' ? 'chip-amber' : 'chip-muted'}" title="SMA20 {t.sma20} · SMA50 {t.sma50} · momentum 30 j {t.momentum30 > 0 ? '+' : ''}{t.momentum30} %">
												{t.badge === 'haussier' ? 'Haussier' : t.badge === 'baissier' ? 'Baissier' : 'Neutre'}
											</span>
										{/if}
										{#if asset.source === 'manual' && krakenState.balanceStatus !== 'ok'}
											<button type="button" class="meta-xs cursor-pointer hover:underline" title="Retirer cet actif" aria-label="Retirer {asset.symbol}" onclick={(e) => { e.stopPropagation(); removeManual(asset.symbol); }}>✕</button>
										{/if}
									</span>
								</td>
								{#if show('quantite')}<td class="tabular py-1 pr-3 text-right">{formatQty(asset.qty)}</td>{/if}
								{#if show('cours')}<td class="tabular py-1 pr-3 text-right text-secondary">{asset.price !== undefined ? formatPrice(asset.price) : '—'}</td>{/if}
								<td class="tabular py-1 pr-3 text-right font-medium">{asset.eur !== undefined ? formatEUR(asset.eur) : '—'}</td>
								{#if show('part')}<td class="tabular py-1 pr-3 text-right text-secondary">{pct(asset.eur)}</td>{/if}
								{#if show('revient')}
								<td class="tabular py-1 pr-3 text-right text-secondary">{asset.avgCost !== undefined ? formatPrice(asset.avgCost) : '—'}</td>
								<td class="tabular py-1 pr-3 text-right font-medium" style={asset.pnlEur !== undefined ? `color: ${asset.pnlEur >= 0 ? 'var(--accent)' : 'var(--amber)'};` : ''} title={asset.basisQty !== undefined ? `Coût connu : ${formatQty(asset.basisQty)} ${asset.symbol} pour ${formatEUR(asset.basisCost ?? 0)} · couvre ${formatPct((asset.pnlCoverage ?? 1) * 100, 0)} de la position` : ''}>
									{#if asset.pnlEur !== undefined && asset.pnlPct !== undefined}
										{asset.pnlEur >= 0 ? '+' : '−'}{formatEUR(Math.abs(asset.pnlEur))} <span class="meta-xs">({formatPct(asset.pnlPct, 1, true)})</span>
										{#if (asset.pnlCoverage ?? 1) < 0.95}<span class="chip chip-amber ml-1" title="Une partie de la position a été acquise avant le début de l'historique importé : plus-value calculée sur la part connue seulement">partiel {formatPct((asset.pnlCoverage ?? 1) * 100, 0)}</span>{/if}
									{:else}
										—
									{/if}
								</td>
								{/if}
								{#if show('cours')}
								<td class="tabular py-1 text-right" style={asset.change24h !== undefined ? `color: ${asset.change24h >= 0 ? 'var(--accent)' : 'var(--amber)'};` : ''}>
									{asset.change24h !== undefined ? formatPct(asset.change24h, 2, true) : '—'}
								</td>
								{/if}
							</tr>
							{#if openSymbol === asset.symbol}
								<!-- Price chart (Kraken daily closes, drawn locally) -->
								<tr style="background-color: var(--bg);">
									<td colspan={positionColumns(show)} class="px-3 py-3">
										<div class="mb-2 flex flex-wrap items-center justify-between gap-2">
											<div class="flex items-center gap-1">
												{#each Object.keys(PERIOD_DAYS) as p (p)}
													<button
														type="button"
														class="press cursor-pointer rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors {period === p ? 'font-semibold' : 'text-secondary hover:bg-[var(--surface-hover)]'}"
														style={period === p ? 'background-color: var(--accent-soft); color: var(--accent);' : ''}
														onclick={(e) => {
															e.stopPropagation();
															period = p as Period;
														}}
													>
														{p}
													</button>
												{/each}
											</div>
											{#if chartStats}
												<p class="meta-xs tabular flex flex-wrap gap-x-3">
													<span>{formatPrice(chartStats.first)} → <span class="font-medium" style="color: var(--text);">{formatPrice(chartStats.last)}</span></span>
													<span class="font-medium" style="color: {chartStats.pct >= 0 ? 'var(--accent)' : 'var(--amber)'};">{formatPct(chartStats.pct, 1, true)}</span>
													<span>haut {formatPrice(chartStats.high)} · bas {formatPrice(chartStats.low)}</span>
													{#if asset.avgCost !== undefined}<span>· votre PRU {formatPrice(asset.avgCost)}</span>{/if}
												</p>
											{/if}
										</div>
										{#if chartPoints.length > 1}
											<BalanceChart points={chartPoints} height={box ? Math.round(Math.min(480, Math.max(160, box.h * 0.45))) : 220} formatValue={formatPrice} annotations={chartTrades} reference={asset.avgCost !== undefined ? { value: asset.avgCost, label: 'PRU' } : undefined} />
										{:else if krakenState.ohlc[asset.symbol]}
											<p class="meta-xs">Pas assez de cours sur cette période.</p>
										{:else}
											<p class="meta-xs">Chargement des cours Kraken…</p>
										{/if}
										{#if tradeCount > 0}
											<p class="meta-xs mt-1">{tradeCount} opération{tradeCount > 1 ? 's' : ''} sur cet actif ; les points sur la courbe sont vos achats (champagne) et ventes (ambre) de la période, la ligne pointillée votre prix de revient.</p>
										{/if}

										<!-- Price target: where the asset stands against a target level, with verifiable figures -->
										<div class="mt-3 flex flex-wrap items-end gap-3 border-t pt-3" style="border-color: var(--border-subtle);">
											<label class="w-36">
												<span class="meta-xs">Objectif de prix (€)</span>
												<input type="text" inputmode="decimal" class="input-surface tabular mt-1 w-full" placeholder="0,37" bind:value={targetInput} aria-label="Objectif de prix" onclick={(e) => e.stopPropagation()} />
											</label>
											{#if target}
												<div class="min-w-0 flex-1 text-[12px]">
													<p>
														<span class="text-secondary">Il faut</span> <span class="tabular font-medium" style="color: {target.distance >= 0 ? 'var(--accent)' : 'var(--amber)'};">{formatPct(target.distance * 100, 0, true)}</span>
														<span class="text-secondary">depuis {formatPrice(target.price)}.</span>
														<span class="text-secondary">Volatilité annualisée</span> <span class="tabular font-medium">{formatPct(target.annualVol * 100, 0)}</span>
														<span class="text-secondary">· meilleure hausse sur 90 jours vue en 2 ans</span> <span class="tabular font-medium">{formatPct(target.bestRun * 100, 0, true)}</span>
														{#if target.lastAbove}<span class="text-secondary">· dernier passage à ce niveau le</span> <span class="tabular font-medium">{formatDate(target.lastAbove)}</span>{:else}<span class="text-secondary">· jamais atteint dans les 2 ans de cours disponibles</span>{/if}
													</p>
													<p class="mt-0.5">
														<span class="text-secondary">Chance de toucher ce niveau, si le cours bouge comme ces 12 derniers mois (sans tendance) :</span>
														<span class="tabular font-medium">{formatPct(target.p3 * 100, 0)} sous 3 mois · {formatPct(target.p6 * 100, 0)} sous 6 mois · {formatPct(target.p12 * 100, 0)} sous 1 an</span>
													</p>
													<p class="meta-xs mt-0.5" style="color: var(--amber);">Scénario statistique calculé sur la volatilité passée, pas une prévision : personne ne sait quand un cours remontera.</p>
												</div>
											{/if}
										</div>

										<!-- News about this asset -->
										<div onclick={(e) => e.stopPropagation()} role="presentation">
											<CryptoNews symbol={asset.symbol} />
										</div>
									</td>
								</tr>
							{/if}
						{/each}
						{#if !showSmall && small.length > 0}
							<tr class="border-t" style="border-color: var(--border-subtle);">
								<td class="py-1.5 pr-3 text-secondary" colspan={othersRowSpans(show).lead}>Autres ({small.length}) : {small.map((a) => a.symbol).join(', ')}</td>
								<td class="tabular py-1 pr-3 text-right font-medium">{formatEUR(smallTotal)}</td>
								{#if show('part')}<td class="tabular py-1 pr-3 text-right text-secondary">{pct(smallTotal)}</td>{/if}
								{#if othersRowSpans(show).tail > 0}<td colspan={othersRowSpans(show).tail}></td>{/if}
							</tr>
						{/if}
					</tbody>
				</table>
			</div>
		{:else}
			<div class="rounded-lg border border-dashed" style="border-color: var(--border);">
				{#if !krakenState.hasKeys && krakenState.balanceStatus !== 'ok'}
					<EmptyState inline icon="key" title="Kraken non configuré" text="Connectez vos clés API (lecture seule) ou saisissez vos quantités ci-dessous." ctaLabel="Configurer les clés API" onCta={() => (uiState.krakenModalOpen = true)} />
				{:else}
					<EmptyState inline icon="coins" title="Aucun actif crypto" text="Ajoutez vos quantités ci-dessous pour valoriser votre portefeuille." />
				{/if}
			</div>
		{/if}

		{#if krakenState.balanceStatus !== 'ok'}
			<form
				class="mt-3 flex flex-wrap items-end gap-2 border-t pt-3"
				style="border-color: var(--border-subtle);"
				onsubmit={(e) => {
					e.preventDefault();
					addManual();
				}}
			>
				<label class="w-24 min-w-0">
					<span class="meta-xs">Actif</span>
					<input type="text" class="input-surface mt-1 w-full uppercase" placeholder="BTC" maxlength="8" bind:value={manualSymbol} aria-label="Symbole de l'actif" />
				</label>
				<label class="w-40 min-w-0 shrink">
					<span class="meta-xs">Quantité</span>
					<input type="text" inputmode="decimal" class="input-surface mt-1 w-full" placeholder="0,25" bind:value={manualQty} aria-label="Quantité détenue" />
				</label>
				<button type="submit" class="btn btn-accent btn-sm">Ajouter à la main</button>
			</form>
		{/if}
				{/snippet}
			</Block>
		{:else if id === 'tax'}
			{#if taxReport}
			<Block page="crypto" {id} defaults={BLOCKS} title="Fiscalité" size="XL" sizes={['L', 'XL']} elements={TAX_ELEMENTS} class="hero-in-3">
				{#snippet children(show)}
			<div class="mb-2 flex flex-wrap items-center justify-between gap-2">
				<h2 class="label-xs">Fiscalité · plus-values de cession</h2>
				{#if show('regles')}<p class="meta-xs">PFU 12,8 % IR + prélèvements sociaux (30 % jusqu'aux revenus 2025) · exonéré si cessions ≤ {EXEMPTION_THRESHOLD} €/an · méthode 150 VH bis (prorata du portefeuille)</p>{/if}
			</div>
			{#if taxReport.years.length === 0}
				<p class="meta-xs">Aucune vente crypto → euros dans l'historique : rien à déclarer.</p>
			{:else}
				<div class="overflow-x-auto">
					<table class="w-full min-w-[640px] border-collapse text-[12px]">
						<thead>
							<tr class="text-left">
								<th class="label-plain py-2 pr-3">Année</th>
								<th class="label-plain py-2 pr-3 text-right">Cessions</th>
								<th class="label-plain py-2 pr-3 text-right" title="Somme de toutes les ventes crypto → euros de l’année, même rachetées ensuite. Ce n’est pas votre capital : c’est le volume que le fisc compare au seuil de 305 €.">Ventes cumulées</th>
								<th class="label-plain py-2 pr-3 text-right">Plus-value nette</th>
								<th class="label-plain py-2 pr-3 text-right">Impôt estimé</th>
								{#if show('declare')}<th class="label-plain py-2 pr-3 text-right" title="Montant porté sur votre avis d'impôt (« Revenus au taux forfaitaire »), pour comparer">Déclaré</th>{/if}
								{#if show('export')}<th class="label-plain py-2 text-right"></th>{/if}
							</tr>
						</thead>
						<tbody>
							{#each taxReport.years as y (y.year)}
								{@const dec = declaredValue(y.year)}
								<tr class="row-hover press cursor-pointer border-t" style="border-color: var(--border-subtle);" onclick={() => (taxOpenYear = taxOpenYear === y.year ? null : y.year)}>
									<td class="py-1.5 pr-3 font-medium">{y.year}</td>
									<td class="tabular py-1.5 pr-3 text-right">{y.cessions.length}</td>
									<td class="tabular py-1.5 pr-3 text-right">{formatEUR(y.totalProceeds)}</td>
									<td class="tabular py-1.5 pr-3 text-right font-medium" style="color: {y.netGain >= 0 ? 'var(--text)' : 'var(--amber)'};">{y.netGain >= 0 ? '+' : '−'}{formatEUR(Math.abs(y.netGain))}</td>
									<td class="tabular py-1.5 pr-3 text-right">
										{#if y.exempt}<span class="chip chip-accent">exonéré</span>{:else}{formatEUR(y.taxEstimate)}{/if}
									</td>
									{#if show('declare')}
									<td class="py-1.5 pr-3 text-right" onclick={(e) => e.stopPropagation()}>
										<input type="text" inputmode="decimal" class="input-surface tabular w-28 text-right" placeholder="—" value={declared[y.year] ?? ''} aria-label="Montant déclaré {y.year}" oninput={(e) => setDeclared(y.year, (e.target as HTMLInputElement).value)} />
										{#if dec !== null}
											<p class="meta-xs mt-0.5" style="color: {Math.abs(dec - y.netGain) < 1 ? 'var(--accent)' : 'var(--amber)'};">écart {dec - y.netGain >= 0 ? '+' : '−'}{formatEUR(Math.abs(dec - y.netGain))}</p>
										{/if}
									</td>
									{/if}
									{#if show('export')}
									<td class="py-1.5 text-right">
										<button type="button" class="btn btn-secondary btn-sm" onclick={(e) => { e.stopPropagation(); exportCsv(y.year); }}>CSV 2086</button>
									</td>
									{/if}
								</tr>
								{#if taxOpenYear === y.year}
									<tr style="background-color: var(--bg);">
										<td colspan={taxColumns(show)} class="px-3 py-2">
											<table class="w-full text-[12px]">
												<thead>
													<tr class="text-left">
														<th class="meta-xs pb-1 font-normal">Date</th>
														<th class="meta-xs pb-1 font-normal">Actif</th>
														<th class="meta-xs pb-1 text-right font-normal">Quantité</th>
														<th class="meta-xs pb-1 text-right font-normal">Prix de cession</th>
														<th class="meta-xs pb-1 text-right font-normal">Frais</th>
														<th class="meta-xs pb-1 text-right font-normal" title="Valeur globale du portefeuille au jour de la cession">Portefeuille</th>
														<th class="meta-xs pb-1 text-right font-normal" title="Prix total d'acquisition restant">PTA</th>
														<th class="meta-xs pb-1 text-right font-normal">Plus-value</th>
													</tr>
												</thead>
												<tbody>
													{#each y.cessions as c, ci (`${c.date}|${c.asset}|${ci}`)}
														<tr class="border-t" style="border-color: var(--border-subtle);">
															<td class="tabular py-1">{formatDate(c.date)}</td>
															<td class="py-1">{c.asset}{#if c.currency}<span class="chip chip-muted ml-1" title="Vente en {c.currency}, convertie en euros au taux annuel moyen (approximation)">{c.currency}</span>{/if}{#if c.unpricedAssets.length > 0}<span class="chip chip-amber ml-1" title="Actifs sans cours à cette date : {c.unpricedAssets.join(', ')} — valeur du portefeuille sous-estimée">{c.unpricedAssets.length} sans cours</span>{/if}</td>
															<td class="tabular py-1 text-right">{formatQty(c.qty)}</td>
															<td class="tabular py-1 text-right">{formatEUR(c.proceeds)}</td>
															<td class="tabular py-1 text-right text-secondary">{formatEUR(c.fees)}</td>
															<td class="tabular py-1 text-right text-secondary">{formatEUR(c.portfolioValue)}</td>
															<td class="tabular py-1 text-right text-secondary">{formatEUR(c.acquisitionCost)}</td>
															<td class="tabular py-1 text-right font-medium" style="color: {c.gain >= 0 ? 'var(--text)' : 'var(--amber)'};">{c.gain >= 0 ? '+' : '−'}{formatEUR(Math.abs(c.gain))}</td>
														</tr>
													{/each}
												</tbody>
											</table>
										</td>
									</tr>
								{/if}
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
			{#if taxReport.warnings.length > 0 && show('alertes')}
				<ul class="meta-xs mt-2 space-y-0.5" style="color: var(--amber);">
					{#each taxReport.warnings.slice(0, 6) as w (w)}<li>{w}</li>{/each}
					{#if taxReport.warnings.length > 6}<li>… et {taxReport.warnings.length - 6} autre{taxReport.warnings.length - 6 > 1 ? 's' : ''}</li>{/if}
				</ul>
			{/if}
			{#if show('note')}
			<div class="mt-2 flex flex-wrap items-center justify-between gap-2">
				<p class="meta-xs">Estimation à partir du ledger Kraken et des cours Kraken à la date de chaque vente. Les cessions sur d'autres plateformes ne sont pas comptées. Ce n'est pas un conseil fiscal : vérifiez avec votre déclaration (formulaire 2086).</p>
				<button type="button" class="btn btn-secondary btn-sm" title="Télécharge les {ledgerEntries.length} lignes conservées au format CSV Kraken (diagnostic, sauvegarde)" onclick={exportLedger}>Exporter le ledger ({ledgerEntries.length} lignes)</button>
			</div>
			{/if}
				{/snippet}
			</Block>
			{/if}
		{/if}
	{/each}
</TileCanvas>

<style>
	/* Block content in a column: once the tile height is fixed, the history curve takes the free height */
	.tuile-col {
		display: flex;
		min-width: 0;
		flex-direction: column;
	}
	.tuile-col > :global(*) {
		flex-shrink: 0;
	}
	.tuile-pleine > .courbe-bloc {
		flex: 1 1 auto;
		min-height: 110px;
	}
	.courbe-cadre {
		flex: 1 1 auto;
		min-height: 60px;
		overflow: hidden;
	}
</style>
