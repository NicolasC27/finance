<script lang="ts">
	import { syncRefundCategories } from '$lib/refunds.svelte';
	import QuickEntryDialog from '$lib/components/QuickEntryDialog.svelte';
	import { onMount } from 'svelte';
	import Sidebar from '$lib/components/Sidebar.svelte';
	import CommandPalette from '$lib/components/CommandPalette.svelte';
	import ShortcutsDialog from '$lib/components/ShortcutsDialog.svelte';
	import AutoBackupDialog from '$lib/components/AutoBackupDialog.svelte';
	import SettingsPanel from '$lib/components/SettingsPanel.svelte';
	import AiOrganizeDialog from '$lib/components/AiOrganizeDialog.svelte';
	import { wireAiOrganize } from '$lib/aiOrganize.svelte';
	import ImportPanel from '$lib/components/ImportPanel.svelte';
	import ModuleOptionsPanel from '$lib/components/ModuleOptionsPanel.svelte';
	import ModulesMenu from '$lib/components/ModulesMenu.svelte';
	import ModuleDisabled from '$lib/components/ModuleDisabled.svelte';
	import { moduleOfRoute } from '$lib/modules';
	import { isRouteEnabled } from '$lib/modules.svelte';
	import { initAutoBackup, autoBackupState } from '$lib/autoBackup.svelte';
	import KrakenConfig from '$lib/components/KrakenConfig.svelte';
	import Dashboard from './pages/Dashboard.svelte';
	import Budget from './pages/Budget.svelte';
	import Transactions from './pages/Transactions.svelte';
	import { layoutState, applyDensity } from '$lib/layout.svelte';
	applyDensity();
	import RulePrompt from '$lib/components/RulePrompt.svelte';
	import TransferReviewDialog from '$lib/components/TransferReviewDialog.svelte';
	import { transferState, reviewTransfers } from '$lib/transfers.svelte';
	import { syncLoans } from '$lib/loans.svelte';
	import type { Component } from 'svelte';
	import { route, navigate, initRouter, type RoutePath } from '$lib/router.svelte';
	import { initTheme, applyTheme, type Theme } from '$lib/theme';
	import { initTransactions, settleDueInstalments, txState } from '$lib/store.svelte';
	import { todayIso } from '$lib/forecast';
	import '$lib/vacations.svelte'; // hooks the 'Vacances' reclassification into categorize()
	import '$lib/amazon.svelte'; // hooks the subcategory derived from Amazon orders
	import '$lib/incomeTax.svelte'; // hooks the year's tax estimate into the portage alert and provision
	import { initKraken } from '$lib/wealth.svelte';
	import { uiState, showToast, togglePrivacy } from '$lib/ui.svelte';
	import { PREF_KEYS } from '$lib/prefs';
	import { initWeather } from '$lib/weather.svelte';
	import Toast from '$lib/components/Toast.svelte';

	/** Root: sidebar layout + custom router outlet, Cmd+K palette, Kraken modal. */

	let theme = $state<Theme>('porcelaine');

	/**
	 * Secondary pages in separate chunks (main bundle: home, budget, transactions): imported on first
	 * visit, then kept in memory.
	 */
	const lazyPages: Partial<Record<RoutePath, () => Promise<{ default: Component }>>> = {
		'/rapport': () => import('./pages/Report.svelte'),
		'/ia': () => import('./pages/AiAnalysis.svelte'),
		'/portage': () => import('./pages/Portage.svelte'),
		'/voiture': () => import('./pages/Car.svelte'),
		'/historique': () => import('./pages/History.svelte'),
		'/simulateur': () => import('./pages/Simulator.svelte'),
		'/echeancier': () => import('./pages/Schedule.svelte'),
		'/impot': () => import('./pages/IncomeTax.svelte'),
		'/patrimoine': () => import('./pages/Wealth.svelte'),
		'/crypto': () => import('./pages/Crypto.svelte'),
		'/analyse': () => import('./pages/Analysis.svelte'),
		'/trier': () => import('./pages/Triage.svelte')
	};
	let loadedPages = $state<Partial<Record<RoutePath, Component>>>({});
	$effect(() => {
		const path = route.path;
		const loader = lazyPages[path];
		if (loader && !loadedPages[path]) void loader().then((m) => (loadedPages = { ...loadedPages, [path]: m.default }));
	});
	const LazyPage = $derived(loadedPages[route.path] ?? null);

	/** 'G' then D/B/T/P sequence (go to…), ignored in editable fields and for switched-off modules. */
	let pendingG = 0;

	/**
	 * Global shortcuts: Cmd/Ctrl+K toggles the palette (even inside an input); Cmd/Ctrl+, toggles
	 * Settings but never on top of another dialog (only the palette gives way); '?' toggles the
	 * shortcuts cheat sheet and Escape closes it; '+' opens the quick expense entry.
	 */
	function onGlobalKeydown(e: KeyboardEvent) {
		if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
			e.preventDefault();
			uiState.paletteOpen = !uiState.paletteOpen;
			return;
		}
		if ((e.metaKey || e.ctrlKey) && e.key === ',') {
			e.preventDefault();
			if (uiState.settingsOpen) uiState.settingsOpen = false;
			else if (uiState.paletteOpen) {
				uiState.paletteOpen = false;
				uiState.settingsOpen = true;
			} else if (!uiState.krakenModalOpen && uiState.dialogDepth === 0) uiState.settingsOpen = true;
			return;
		}
		if (uiState.paletteOpen || uiState.krakenModalOpen || uiState.dialogDepth > 0) return;
		const target = e.target as HTMLElement | null;
		if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;

		const fullscreenBlock = document.querySelector('.block-fullscreen') !== null;
		if (e.key === '+' && !fullscreenBlock) {
			e.preventDefault();
			uiState.quickEntryOpen = true;
			return;
		}
		if (/^[0-9]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey && route.path !== '/trier' && !fullscreenBlock) {
			e.preventDefault();
			uiState.quickEntryText = e.key;
			uiState.quickEntryOpen = true;
			return;
		}
		if (e.key === 'h' || e.key === 'H') {
			e.preventDefault();
			togglePrivacy();
			return;
		}
		if (e.key === '?') {
			e.preventDefault();
			uiState.shortcutsOpen = !uiState.shortcutsOpen;
			return;
		}
		if (uiState.shortcutsOpen) {
			if (e.key === 'Escape') uiState.shortcutsOpen = false;
			return;
		}

		const now = Date.now();
		if (e.key === 'g') {
			pendingG = now;
			return;
		}
		if (now - pendingG > 900) {
			if (e.metaKey || e.ctrlKey || e.altKey) return;
			if (e.key === '/') {
				e.preventDefault();
				uiState.paletteOpen = true;
			} else if (e.key === 'i' || e.key === 'I') {
				e.preventDefault();
				uiState.importPanelOpen = true;
			} else if ((e.key === 's' || e.key === 'S') && route.path !== '/trier') {
				e.preventDefault();
				uiState.settingsOpen = !uiState.settingsOpen;
			}
			return;
		}
		const goTo: Record<string, RoutePath> = { d: '/', b: '/budget', a: '/analyse', i: '/trier', t: '/transactions', p: '/patrimoine', c: '/crypto', r: '/rapport', j: '/ia', o: '/portage', v: '/voiture', y: '/historique', w: '/simulateur', e: '/echeancier', f: '/impot' };
		const to = goTo[e.key];
		if (to && isRouteEnabled(to)) {
			pendingG = 0;
			navigate(to);
		}
	}

	/** Refund credits are moved into their expense's category once they are matched (net expense in the budget). */
	$effect(() => {
		if (txState.loaded) syncRefundCategories();
	});

	/** Instalments of a payment in several times whose date is reached: paired with the bank debit, or counted. */
	$effect(() => {
		if (txState.loaded) settleDueInstalments(todayIso());
	});

	/** Display preferences: a change in another tab never threatens data. */

	/**
	 * Another tab open on the app: each tab rewrites its full in-memory copy and the last writer wins,
	 * so warn as soon as another tab changes the data, with a one-click reload.
	 */
	function onStorage(e: StorageEvent) {
		if (e.storageArea !== localStorage) return;
		if (e.key !== null && (!e.key.startsWith('budget:') || PREF_KEYS.has(e.key))) return;
		showToast('Vos données ont été modifiées dans un autre onglet : rechargez avant de continuer ici.', 'Recharger', () => location.reload());
	}

	// Auto-backup failure: toast (once per distinct error), on top of the amber dot
	let lastBackupError = '';
	$effect(() => {
		const err = autoBackupState.error;
		if (!err || err === lastBackupError || !autoBackupState.enabled) return;
		lastBackupError = err;
		showToast(`Sauvegarde automatique en échec : ${err}`, 'Voir', () => (uiState.backupDialogOpen = true));
	});

	/**
	 * On mount: apply the stored theme without persisting it (no preference = Porcelaine); load
	 * transactions, then sync tracked loans, review internal transfers (dialog once per detection
	 * batch) and refresh vehicle valuations older than 30 days in the background (IA relay); resume
	 * the encrypted auto-backup when configured.
	 */
	onMount(() => {
		theme = initTheme();
		applyTheme(theme, false);
		void initTransactions().then(() => {
			syncLoans();
			reviewTransfers();
		});
		initKraken();
		initWeather();
		wireAiOrganize();
		void initAutoBackup();
		window.addEventListener('keydown', onGlobalKeydown);
		window.addEventListener('storage', onStorage);
		const cleanupRouter = initRouter();
		return () => {
			window.removeEventListener('keydown', onGlobalKeydown);
			window.removeEventListener('storage', onStorage);
			cleanupRouter();
		};
	});

	function selectTheme(t: Theme) {
		theme = t;
		applyTheme(t);
	}

	const titles: Record<string, string> = {
		'/': 'Budget — Accueil',
		'/budget': 'Budget — Suivi par catégorie',
		'/analyse': 'Budget — Analyse',
		'/trier': 'Budget — Opérations à trier',
		'/transactions': 'Budget — Transactions',
		'/patrimoine': 'Budget — Patrimoine',
		'/crypto': 'Budget — Crypto',
		'/rapport': 'Budget — Rapport mensuel',
		'/ia': 'Budget — Analyse IA',
		'/portage': 'Budget — Portage',
		'/voiture': 'Budget — Voiture',
		'/historique': 'Budget — Historique des données',
		'/simulateur': 'Budget — Simulateur',
		'/echeancier': 'Budget — Échéancier',
		'/impot': 'Budget — Impôt sur le revenu'
	};

	// Tab title synced with the route
	$effect(() => {
		document.title = titles[route.path] ?? titles['/']!;
	});
</script>

<div class="min-h-screen" style="--sidebar-w: {uiState.sidebarCollapsed ? 60 : 196}px;">
	<Sidebar />
	<!-- Content area: offset by the sidebar on desktop, bottom padding for the mobile tab bar -->
	<main class="app-main min-w-0 pb-24 lg:pb-0">
		<div class={layoutState.wide ? 'px-3 py-3 sm:px-4 lg:px-5 lg:py-4' : 'mx-auto max-w-[1280px] px-4 py-4 sm:px-6 lg:px-14 lg:py-7 xl:px-20'}>
			<!-- A render error (unexpected data) no longer takes the whole app down: message + retry -->
			<svelte:boundary onerror={(e) => console.error(e)}>
			{#if !isRouteEnabled(route.path)}
				<ModuleDisabled module={moduleOfRoute(route.path)!} />
			{:else if route.path === '/budget'}
				<Budget />
			{:else if route.path === '/transactions'}
				<Transactions />
			{:else if lazyPages[route.path]}
				{#if LazyPage}
					<LazyPage />
				{/if}
			{:else}
				<Dashboard />
			{/if}
			{#snippet failed(error, reset)}
				<div class="card p-4 text-sm" role="alert">
					<p class="font-medium" style="color: var(--amber);">Cette page n’a pas pu s’afficher.</p>
					<p class="meta-xs mt-1">{error instanceof Error ? error.message : String(error)}</p>
					<button type="button" class="btn btn-secondary btn-sm mt-3" onclick={reset}>Réessayer</button>
				</div>
			{/snippet}
			</svelte:boundary>
		</div>
	</main>
	<CommandPalette onSelectTheme={selectTheme} />
	<ShortcutsDialog />
	<QuickEntryDialog />
	<AutoBackupDialog />
	<SettingsPanel {theme} onSelectTheme={selectTheme} />
	<AiOrganizeDialog />
	<ImportPanel />
	<ModuleOptionsPanel />
	<ModulesMenu />
	<KrakenConfig />
	<RulePrompt />
	{#if transferState.reviewOpen}
		<TransferReviewDialog />
	{/if}
	<Toast />
	<!-- Global grain texture (SVG feTurbulence, non-interactive) -->
	<div class="grain" aria-hidden="true"></div>
</div>
