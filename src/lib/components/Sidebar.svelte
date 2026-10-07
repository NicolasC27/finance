<script lang="ts">
	import type { RoutePath } from '$lib/router.svelte';
	import { route } from '$lib/router.svelte';
	import { uiState, toggleSidebar, togglePrivacy } from '$lib/ui.svelte';
	import { autoBackupState } from '$lib/autoBackup.svelte';
	import { getNetWorth, getNetWorthSparkline } from '$lib/wealth.svelte';
	import Sparkline from './Sparkline.svelte';
	import AnimatedAmount from './AnimatedAmount.svelte';
	import { getSortQueue } from '$lib/sortQueue.svelte';
	import { getTaxAlerts } from '$lib/portage.svelte';
	import { moduleOfRoute } from '$lib/modules';
	import { isModuleActive, isRouteEnabled } from '$lib/modules.svelte';

	/**
	 * Sidebar layout: fixed 196 px on desktop (collapsible to 60 px, persisted): logo with the search
	 * and privacy icons, a thin navigation, net worth mini card + sparkline at the bottom, 'Réglages'
	 * gear (theme, density, backups… in SettingsPanel). No action button: an expense is typed in the
	 * first row of the lists (QuickEntryRow) or after a digit typed anywhere; files are dropped
	 * anywhere or imported from the Transactions page. Mobile < 1024 px: fixed bottom tab bar (4 icons + short labels) +
	 * 'Plus' in 5th position: secondary pages, Imports and Settings in a popover.
	 */

	/** 'Plus' popover of the mobile tab bar. */
	let plusMenuOpen = $state(false);

	/** Time of the last modules menu opened from the keyboard: the contextmenu event that follows is ignored. */
	let keyboardMenuAt = 0;
	/** Long press on « Plus » (mobile) in progress, and whether it already opened the modules menu. */
	let plusPressTimer: ReturnType<typeof setTimeout> | null = null;
	let plusPressOpened = false;

	let aside = $state<HTMLElement | null>(null);

	/** Right-click and Menu key on the desktop sidebar open the modules menu (listeners on the element itself). */
	$effect(() => {
		const el = aside;
		if (!el) return;
		el.addEventListener('contextmenu', onSidebarContextMenu);
		el.addEventListener('keydown', onSidebarMenuKey);
		return () => {
			el.removeEventListener('contextmenu', onSidebarContextMenu);
			el.removeEventListener('keydown', onSidebarMenuKey);
		};
	});

	/**
	 * Opens the modules menu at a point (its top-left corner, or its bottom-left one with `above`, for
	 * the buttons at the bottom of the screen); `target` is the module whose link was right-clicked.
	 */
	function openModulesMenu(x: number, y: number, above: boolean, target: ReturnType<typeof moduleOfRoute> = null) {
		plusMenuOpen = false;
		uiState.modulesMenu = { x, y, above, target };
	}

	/** Module of the sidebar link under an element (null outside a module link). */
	function moduleUnder(el: EventTarget | null) {
		const a = (el as Element | null)?.closest?.('a[href]');
		return a instanceof HTMLAnchorElement ? moduleOfRoute(new URL(a.href).pathname) : null;
	}

	/** Right-click anywhere on the sidebar: the modules menu at the pointer (Shift keeps the browser's own menu). */
	function onSidebarContextMenu(e: MouseEvent) {
		if (e.shiftKey || Date.now() - keyboardMenuAt < 600) {
			if (!e.shiftKey) e.preventDefault();
			return;
		}
		e.preventDefault();
		openModulesMenu(e.clientX, e.clientY, false, moduleUnder(e.target));
	}

	/** Menu key or Shift+F10 on a sidebar link or button: the modules menu under it. */
	function onSidebarMenuKey(e: KeyboardEvent) {
		if (e.key !== 'ContextMenu' && !(e.shiftKey && e.key === 'F10')) return;
		e.preventDefault();
		keyboardMenuAt = Date.now();
		const r = (e.target as Element).getBoundingClientRect();
		openModulesMenu(r.left + 12, r.bottom + 4, false, moduleUnder(e.target));
	}

	/** « + Modules »: the same menu, opened above the button. */
	function onModulesButton(e: MouseEvent) {
		const r = (e.currentTarget as Element).getBoundingClientRect();
		openModulesMenu(r.left, r.top - 6, true);
	}

	/** Long press on « Plus » (≈ 500 ms) opens the modules menu instead of the pages popover. */
	function startPlusPress(e: PointerEvent) {
		plusPressOpened = false;
		const r = (e.currentTarget as Element).getBoundingClientRect();
		plusPressTimer = setTimeout(() => {
			plusPressOpened = true;
			openModulesMenu(r.left, r.top - 8, true);
		}, 500);
	}

	function endPlusPress() {
		if (plusPressTimer) clearTimeout(plusPressTimer);
		plusPressTimer = null;
	}

	function openSettings() {
		plusMenuOpen = false;
		uiState.settingsOpen = true;
	}

	function openImports() {
		plusMenuOpen = false;
		uiState.importPanelOpen = true;
	}

	// Popover closing: outside click + Escape (listeners only while open)
	$effect(() => {
		if (!plusMenuOpen) return;
		const onDocClick = (e: MouseEvent) => {
			if (!(e.target as HTMLElement | null)?.closest('[data-plus-menu]')) plusMenuOpen = false;
		};
		const onEsc = (e: KeyboardEvent) => {
			if (e.key === 'Escape') plusMenuOpen = false;
		};
		document.addEventListener('click', onDocClick);
		document.addEventListener('keydown', onEsc);
		return () => {
			document.removeEventListener('click', onDocClick);
			document.removeEventListener('keydown', onEsc);
		};
	});

	interface Link {
		href: RoutePath;
		label: string;
		short: string;
		key: string; // G + key shortcut
	}

	const links: Link[] = [
		{ href: '/', label: 'Accueil', short: 'Accueil', key: 'D' },
		{ href: '/budget', label: 'Budget', short: 'Budget', key: 'B' },
		{ href: '/echeancier', label: 'Échéancier', short: 'Échéances', key: 'E' },
		{ href: '/analyse', label: 'Analyse', short: 'Analyse', key: 'A' },
		{ href: '/transactions', label: 'Transactions', short: 'Transac.', key: 'T' },
		{ href: '/trier', label: 'À trier', short: 'Trier', key: 'I' },
		{ href: '/patrimoine', label: 'Patrimoine', short: 'Patrimoine', key: 'P' },
		{ href: '/crypto', label: 'Crypto', short: 'Crypto', key: 'C' },
		{ href: '/voiture', label: 'Voiture', short: 'Voiture', key: 'V' },
		{ href: '/portage', label: 'Portage', short: 'Portage', key: 'O' },
		{ href: '/ia', label: 'Analyse IA', short: 'IA', key: 'J' }
	];

	/** Mobile tab bar: 4 main pages + 'Plus' (8 entries overflowed onto 2 rows). */
	const MOBILE_PRIMARY: ReadonlySet<string> = new Set(['/', '/budget', '/transactions', '/trier']);

	/** Links of the pages that can be shown: essential pages and active modules. */
	const visibleLinks = $derived(links.filter((l) => isRouteEnabled(l.href)));

	const collapsed = $derived(uiState.sidebarCollapsed);
	/** Badge of the 'À trier' link: same queue as the page (sortQueue.svelte.ts). */
	const toSort = $derived(getSortQueue().length);
	/** Withholding tax alert (Portage tab). */
	const portageAlert = $derived(getTaxAlerts().some((a) => a.niveau === 'alerte'));
	const sparkValues = $derived(getNetWorthSparkline());
	/** Auto-backup failing or paused: amber dot on the Settings gear. */
	const backupAlert = $derived(autoBackupState.enabled && (!!autoBackupState.error || autoBackupState.permission !== 'granted'));
	// Carrier of the 'net-worth' view-transition-name outside the Patrimoine page (on /patrimoine the
	// large Valeur totale card carries it)
	const carriesNetWorth = $derived(route.path !== '/patrimoine');
</script>

<!-- ============ Desktop: fixed left sidebar (≥1024px) ============ -->
<aside
	class="sidebar fixed inset-y-0 left-0 z-30 hidden flex-col border-r lg:flex"
	style="width: {collapsed ? 60 : 196}px; border-color: var(--hairline); background-color: var(--bg);"
	bind:this={aside}
>
	<!-- Logo, then the search (command palette) and privacy icons -->
	<div class="flex shrink-0 items-center border-b {collapsed ? 'h-auto flex-col gap-1 px-0 py-3' : 'h-14 gap-1 px-3'}" style="border-color: var(--hairline);">
		<a href="/" class="flex min-w-0 items-center gap-2.5 {collapsed ? 'justify-center' : 'mr-auto pl-1'}" aria-label="Budget — accueil">
			<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="shrink-0">
				<path d="M3 17l5-6 4 4 6-8" />
				<path d="M15 7h6v6" />
			</svg>
			{#if !collapsed}<span class="serif truncate text-lg">Budget</span>{/if}
		</a>
		<button
			type="button"
			class="press flex h-7 w-7 cursor-pointer items-center justify-center rounded-full text-secondary transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
			onclick={() => (uiState.paletteOpen = true)}
			title="Rechercher, palette de commandes (/ ou Cmd/Ctrl+K)"
			aria-label="Rechercher : ouvrir la palette de commandes"
		>
			<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
				<circle cx="11" cy="11" r="7" />
				<path d="m20 20-3.5-3.5" />
			</svg>
		</button>
		<!-- Privacy mode: every amount masked (H key) -->
		<button
			type="button"
			class="privacy-toggle press flex h-7 w-7 cursor-pointer items-center justify-center rounded-full text-secondary transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
			class:privacy-on={uiState.privacy}
			onclick={togglePrivacy}
			aria-pressed={uiState.privacy}
			title={uiState.privacy ? 'Afficher les montants (H)' : 'Mode discret : masquer les montants (H)'}
			aria-label={uiState.privacy ? 'Afficher les montants' : 'Masquer les montants'}
		>
			<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{#if uiState.privacy}<path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.1A9.8 9.8 0 0 1 12 5c5 0 9 4.5 10 7a13 13 0 0 1-3.1 4.2M6.3 6.3C4.1 7.7 2.6 9.8 2 12c1 2.5 5 7 10 7a9.6 9.6 0 0 0 4.2-1" />{:else}<path d="M2 12c1-2.5 5-7 10-7s9 4.5 10 7c-1 2.5-5 7-10 7S3 14.5 2 12z" /><circle cx="12" cy="12" r="3" />{/if}</svg>
		</button>
	</div>

	<!-- Navigation links -->
	<nav class="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pt-2" aria-label="Navigation principale">
		{#each visibleLinks as link (link.href)}
			{@const active = route.path === link.href}
			<a
				href={link.href}
				class="side-link press group relative flex items-center rounded-md py-1.5 text-[13px] transition-colors duration-200 {collapsed
					? 'justify-center px-0'
					: 'gap-2.5 px-2'} {active ? 'font-medium' : 'text-secondary hover:bg-[var(--surface-hover)] hover:text-[var(--text)]'}"
				style={active ? 'color: var(--text); background-color: var(--accent-soft);' : ''}
				title={collapsed ? `${link.label} (G puis ${link.key})` : undefined}
				aria-current={active ? 'page' : undefined}
			>
				<!-- Active indicator: accent ● dot (expanded) or vertical bar on the left edge (collapsed, the icon stays centred) -->
				{#if collapsed}
					<span
						class="side-indicator absolute top-1/2 left-0 h-4 w-0.5 -translate-y-1/2 rounded-full"
						style="background-color: var(--accent); transform: translateY(-50%) scaleY({active ? 1 : 0});"
						aria-hidden="true"
					></span>
				{:else}
					<span
						class="side-indicator h-1.5 w-1.5 shrink-0 rounded-full"
						style="background-color: var(--accent); transform: scale({active ? 1 : 0});"
						aria-hidden="true"
					></span>
				{/if}
				<span class="flex h-5 w-5 shrink-0 items-center justify-center" aria-hidden="true">
					{#if link.href === '/'}
						<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<rect x="3" y="3" width="8" height="8" rx="1.5" />
							<rect x="13" y="3" width="8" height="5" rx="1.5" />
							<rect x="13" y="10" width="8" height="11" rx="1.5" />
							<rect x="3" y="13" width="8" height="8" rx="1.5" />
						</svg>
					{:else if link.href === '/budget'}
						<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<circle cx="12" cy="12" r="9" />
							<path d="M12 3a9 9 0 0 1 9 9" stroke-width="3.5" />
						</svg>
					{:else if link.href === '/echeancier'}
						<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<rect x="3.5" y="5" width="17" height="15" rx="2" />
							<path d="M3.5 10h17M8 3v4M16 3v4M8 14h2M14 14h2M8 17h2" />
						</svg>
					{:else if link.href === '/trier'}
						<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<path d="M4 7h16M4 12h10M4 17h6" />
							<path d="m15 16 2 2 4-4" />
						</svg>
					{:else if link.href === '/analyse'}
						<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<path d="M3 20h18" />
							<path d="M4 16l5-6 4 3 7-8" />
						</svg>
					{:else if link.href === '/crypto'}
						<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<circle cx="12" cy="12" r="9" />
							<path d="M9.5 8h4a2 2 0 0 1 0 4h-4m0 0h4.5a2 2 0 0 1 0 4h-4.5M9.5 8v8M11 6.5V8m0 8v1.5M13.5 6.5V8m0 8v1.5" />
						</svg>
					{:else if link.href === '/voiture'}
						<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<path d="M5 16.5V12l1.8-4.6A2 2 0 0 1 8.7 6h6.6a2 2 0 0 1 1.9 1.4L19 12v4.5" />
							<path d="M3.5 12h17v4.5h-17zM7 16.5V19M17 16.5V19" />
						</svg>
					{:else if link.href === '/portage'}
						<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<path d="M4 8h16v11H4z" />
							<path d="M9 8V5h6v3M4 13h16" />
						</svg>
					{:else if link.href === '/ia'}
						<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z" />
							<path d="M19 15l.8 2.2 2.2.8-2.2.8L19 21l-.8-2.2-2.2-.8 2.2-.8z" />
						</svg>
					{:else if link.href === '/transactions'}
						<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<path d="M8 6h13M8 12h13M8 18h13" />
							<path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01" stroke-width="3" />
						</svg>
					{:else}
						<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<path d="M12 3 3 8l9 5 9-5-9-5z" />
							<path d="m3 13 9 5 9-5" />
						</svg>
					{/if}
				</span>
				{#if !collapsed}
					<span class="min-w-0 flex-1 truncate">{link.label}</span>
					{#if link.href === '/portage' && portageAlert}
						<span class="chip chip-amber tabular px-1.5 py-0 text-[10px] group-hover:hidden" title="Alerte sur ton prélèvement à la source : voir l'onglet Portage">!</span>
					{/if}
					{#if link.href === '/trier' && toSort > 0}
						<span class="chip chip-amber tabular px-1.5 py-0 text-[10px] group-hover:hidden" title="{toSort} opération{toSort > 1 ? 's' : ''} en « Autre »">{toSort}</span>
					{/if}
					<kbd class="kbd hidden group-hover:inline-block">G {link.key}</kbd>
				{/if}
			</a>
		{/each}

	</nav>

	<!-- Bottom: net worth mini card + actions -->
	<div class="flex shrink-0 flex-col gap-2 border-t p-4" style="border-color: var(--hairline);">
		{#if !collapsed && isModuleActive('patrimoine')}
			<a
				href="/patrimoine"
				class="press block {carriesNetWorth ? 'vt-net-worth' : ''}"
				title="Voir le patrimoine"
			>
				<p class="label-xs">Patrimoine net</p>
				<div class="mt-2 flex items-end justify-between gap-2">
					<p class="serif text-xl leading-none">
						<AnimatedAmount value={getNetWorth()} narrow sensitive />
					</p>
					{#if sparkValues.length > 1}
						<Sparkline values={sparkValues} width={72} height={24} />
					{/if}
				</div>
				<p class="meta-xs mt-1.5">30 derniers jours</p>
			</a>
		{/if}
		{#if !collapsed}
			<!-- Small links: monthly report and data history (no extra nav entry) and the modules menu -->
			<div class="-mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px]">
				{#if isModuleActive('rapport')}
					<a
						href="/rapport"
						class="press whitespace-nowrap text-secondary transition-colors hover:text-[var(--accent)] hover:underline"
						class:!text-[var(--accent)]={route.path === '/rapport'}
						aria-current={route.path === '/rapport' ? 'page' : undefined}
					>
						Rapport du mois
					</a>
				{/if}
				<a
					href="/historique"
					class="press whitespace-nowrap text-secondary transition-colors hover:text-[var(--accent)] hover:underline"
					class:!text-[var(--accent)]={route.path === '/historique'}
					aria-current={route.path === '/historique' ? 'page' : undefined}
					title="Historique des données : points de restauration (G puis Y)"
				>
					Historique
				</a>
				<a
					href="/simulateur"
					class="press whitespace-nowrap text-secondary transition-colors hover:text-[var(--accent)] hover:underline"
					class:!text-[var(--accent)]={route.path === '/simulateur'}
					aria-current={route.path === '/simulateur' ? 'page' : undefined}
					title="Simulateur : effet d'un crédit, d'un déménagement, d'un changement de revenu (G puis W)"
				>
					Simulateur
				</a>
				<a
					href="/impot"
					class="press whitespace-nowrap text-secondary transition-colors hover:text-[var(--accent)] hover:underline"
					class:!text-[var(--accent)]={route.path === '/impot'}
					aria-current={route.path === '/impot' ? 'page' : undefined}
					title="Impôt sur le revenu : estimation de l'année et régularisation de septembre (G puis F)"
				>
					Impôt
				</a>
				<button
					type="button"
					class="press cursor-pointer whitespace-nowrap text-secondary transition-colors hover:text-[var(--accent)] hover:underline"
					title="Activer ou retirer des modules (ou clic droit sur la barre latérale)"
					aria-haspopup="menu"
					onclick={onModulesButton}
				>
					+ Modules
				</button>
			</div>
		{/if}

		<div class="flex items-center {collapsed ? 'flex-col' : ''} gap-1.5">
			<!-- Settings: theme, density, backups, Kraken, shortcuts (amber dot = auto-backup to resume) -->
			<button
				type="button"
				class="press relative flex h-9 shrink-0 cursor-pointer items-center gap-2 rounded-full border text-[13px] text-secondary transition-colors duration-200 hover:bg-[var(--surface-hover)] hover:text-[var(--text)] {collapsed ? 'w-9 justify-center' : 'px-3'}"
				style="border-color: var(--hairline);"
				aria-label={backupAlert ? 'Réglages (sauvegarde automatique à reprendre)' : 'Réglages'}
				title={backupAlert ? 'Réglages · la sauvegarde automatique est en pause ou en erreur' : 'Réglages (S ou Ctrl+,)'}
				onclick={openSettings}
			>
				{@render gearIcon(15)}
				{#if !collapsed}<span>Réglages</span>{/if}
				{#if backupAlert}
					<span class="absolute top-1 right-1 h-1.5 w-1.5 rounded-full" style="background-color: var(--amber);" aria-hidden="true"></span>
				{/if}
			</button>
			<button
				type="button"
				onclick={toggleSidebar}
				class="press flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full border transition-colors duration-200 hover:bg-[var(--surface-hover)] {!collapsed
					? 'ml-auto'
					: ''}"
				style="border-color: var(--hairline);"
				aria-label={collapsed ? 'Déplier la sidebar' : 'Replier la sidebar'}
				title={collapsed ? 'Déplier' : 'Replier'}
			>
				<svg
					width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
					style="transform: rotate({collapsed ? 0 : 180}deg); transition: transform 250ms ease;"
				>
					<path d="m9 6 6 6-6 6" />
				</svg>
			</button>
		</div>
	</div>
</aside>

<!-- ============ Mobile: fixed bottom tab bar (<1024px) ============ -->
<nav
	class="tabbar fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t lg:hidden"
	style="border-color: var(--hairline); background-color: color-mix(in srgb, var(--bg) 92%, transparent); backdrop-filter: blur(10px);"
	aria-label="Navigation principale"
>
	{#each links.filter((l) => MOBILE_PRIMARY.has(l.href)) as link (link.href)}
		{@const active = route.path === link.href}
		<a
			href={link.href}
			class="press relative flex min-w-0 flex-col items-center gap-1 py-2.5 text-[11px] transition-colors duration-200 {active
				? 'font-medium'
				: 'text-secondary'}"
			style={active ? 'color: var(--accent);' : ''}
			aria-current={active ? 'page' : undefined}
		>
			<span
				class="tab-indicator absolute top-0 h-0.5 w-8 rounded-full"
				style="background-color: var(--accent); transform: scaleX({active ? 1 : 0});"
				aria-hidden="true"
			></span>
			{@render navIcon(link.href, 19)}
			<span class="max-w-full truncate">{link.short}{#if link.href === '/trier' && toSort > 0}&nbsp;<span class="tabular" style="color: var(--amber);">{toSort}</span>{/if}</span>
		</a>
	{/each}
	<!-- 'Plus': secondary pages, Rapport and Settings (5 entries max so the bar fits on one row) -->
	<button
		type="button"
		onclick={() => {
			if (plusPressOpened) plusPressOpened = false;
			else plusMenuOpen = !plusMenuOpen;
		}}
		onpointerdown={startPlusPress}
		onpointerup={endPlusPress}
		onpointerleave={endPlusPress}
		onpointercancel={endPlusPress}
		oncontextmenu={(e) => e.preventDefault()}
		class="press relative flex min-w-0 flex-col items-center gap-1 py-2.5 text-[11px] transition-colors duration-200 {MOBILE_PRIMARY.has(route.path) ? 'text-secondary' : 'font-medium'}"
		style={MOBILE_PRIMARY.has(route.path) ? '' : 'color: var(--accent);'}
		aria-label="Plus de pages et réglages"
		aria-expanded={plusMenuOpen}
		data-plus-menu
	>
		<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
			<path d="M5 12h.01M12 12h.01M19 12h.01" stroke-width="3" />
		</svg>
		<span class="max-w-full truncate">Plus</span>
		{#if backupAlert}
			<span class="absolute top-2 right-[calc(50%-14px)] h-1.5 w-1.5 rounded-full" style="background-color: var(--amber);" aria-hidden="true"></span>
		{/if}
	</button>
</nav>

<!-- 'Plus' popover (mobile, above the tab bar): secondary pages + Settings -->
{#if plusMenuOpen}
	<div class="plus-popover fixed right-3 bottom-16 z-40 lg:hidden" role="menu" aria-label="Plus de pages et réglages" data-plus-menu>
		<div
			class="flex flex-col gap-0.5 rounded-lg border p-1.5"
			style="border-color: var(--hairline); background-color: var(--surface); box-shadow: var(--shadow-soft);"
		>
			{#each [...visibleLinks.filter((l) => !MOBILE_PRIMARY.has(l.href)), ...(isModuleActive('rapport') ? [{ href: '/rapport' as RoutePath, label: 'Rapport mensuel', short: 'Rapport', key: 'R' }] : [])] as link (link.href)}
				<a
					href={link.href}
					role="menuitem"
					class="press flex items-center gap-2.5 rounded-md px-2 py-2 text-[13px] {route.path === link.href ? 'font-medium' : 'text-secondary'}"
					style={route.path === link.href ? 'color: var(--accent);' : ''}
					onclick={() => (plusMenuOpen = false)}
				>
					{@render navIcon(link.href, 16)}
					{link.label}
				</a>
			{/each}
			<div class="my-1 border-t" style="border-color: var(--border-subtle);" aria-hidden="true"></div>
			<button
				type="button"
				role="menuitem"
				class="press flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-2 text-left text-[13px] text-secondary"
				onclick={(e) => {
					const r = (e.currentTarget as Element).getBoundingClientRect();
					openModulesMenu(r.left, r.top - 8, true);
				}}
			>
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
				Modules…
			</button>
			<button type="button" role="menuitem" class="press flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-2 text-left text-[13px] text-secondary" onclick={() => { plusMenuOpen = false; uiState.quickEntryOpen = true; }}>
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
				Saisir une dépense
			</button>
			<button type="button" role="menuitem" class="press flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-2 text-left text-[13px] text-secondary" onclick={openImports}>
				{@render importIcon(16)}
				Importer des fichiers
			</button>
			<button type="button" role="menuitem" class="press flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-2 text-left text-[13px] text-secondary" onclick={openSettings}>
				{@render gearIcon(16)}
				Réglages
				{#if backupAlert}<span class="h-1.5 w-1.5 rounded-full" style="background-color: var(--amber);" title="Sauvegarde automatique à reprendre"></span>{/if}
			</button>
		</div>
	</div>
{/if}

<!-- Page icon (tab bar and 'Plus' menu): a distinct icon per page -->
{#snippet navIcon(href: string, size: number)}
	<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
		{#if href === '/'}
			<rect x="3" y="3" width="8" height="8" rx="1.5" />
			<rect x="13" y="3" width="8" height="5" rx="1.5" />
			<rect x="13" y="10" width="8" height="11" rx="1.5" />
			<rect x="3" y="13" width="8" height="8" rx="1.5" />
		{:else if href === '/budget'}
			<circle cx="12" cy="12" r="9" />
			<path d="M12 3a9 9 0 0 1 9 9" stroke-width="3.5" />
		{:else if href === '/transactions'}
			<path d="M8 6h13M8 12h13M8 18h13" />
			<path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01" stroke-width="3" />
		{:else if href === '/echeancier'}
			<rect x="3.5" y="5" width="17" height="15" rx="2" />
			<path d="M3.5 10h17M8 3v4M16 3v4M8 14h2M14 14h2M8 17h2" />
		{:else if href === '/trier'}
			<path d="M4 7h16M4 12h10M4 17h6" />
			<path d="m15 16 2 2 4-4" />
		{:else if href === '/analyse'}
			<path d="M3 20h18" />
			<path d="M4 16l5-6 4 3 7-8" />
		{:else if href === '/crypto'}
			<circle cx="12" cy="12" r="9" />
			<path d="M9.5 8h4a2 2 0 0 1 0 4h-4m0 0h4.5a2 2 0 0 1 0 4h-4.5M9.5 8v8M11 6.5V8m0 8v1.5M13.5 6.5V8m0 8v1.5" />
		{:else if href === '/voiture'}
			<path d="M5 16.5V12l1.8-4.6A2 2 0 0 1 8.7 6h6.6a2 2 0 0 1 1.9 1.4L19 12v4.5" />
			<path d="M3.5 12h17v4.5h-17zM7 16.5V19M17 16.5V19" />
		{:else if href === '/portage'}
			<path d="M4 8h16v11H4z" />
			<path d="M9 8V5h6v3M4 13h16" />
		{:else if href === '/ia'}
			<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z" />
			<path d="M19 15l.8 2.2 2.2.8-2.2.8L19 21l-.8-2.2-2.2-.8 2.2-.8z" />
		{:else if href === '/rapport'}
			<path d="M7 3h7l5 5v13H7z" />
			<path d="M14 3v5h5M10 13h6M10 17h6" />
		{:else}
			<path d="M12 3 3 8l9 5 9-5-9-5z" />
			<path d="m3 13 9 5 9-5" />
		{/if}
	</svg>
{/snippet}

<!-- Import: upward arrow in a tray -->
{#snippet importIcon(size: number)}
	<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="shrink-0">
		<path d="M12 15V4m0 0 4 4m-4-4-4 4" />
		<path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" />
	</svg>
{/snippet}

<!-- Gear (Settings) -->
{#snippet gearIcon(size: number)}
	<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="shrink-0">
		<circle cx="12" cy="12" r="3" />
		<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
	</svg>
{/snippet}

<style>
	/* Width animated when collapsing (210 ↔ 64 px) */
	.privacy-on {
		color: var(--accent);
		background-color: var(--accent-soft);
	}
	.sidebar {
		transition: width 250ms ease;
	}

	/* Active indicators: signature editorial easing */
	.side-indicator {
		transition: transform 300ms var(--ease-signature, cubic-bezier(1, 0, 0.3, 0.93));
	}

	.tab-indicator {
		transition: transform 300ms var(--ease-signature, cubic-bezier(1, 0, 0.3, 0.93));
		transform-origin: center;
	}

	/* iOS safe area under the tab bar */
	.tabbar {
		padding-bottom: env(safe-area-inset-bottom, 0px);
	}

	/* Discreet kbd (shortcuts) */

	/* 'Plus' popover: 150 ms entrance (fade + slight rise) */
	.plus-popover {
		animation: plus-pop-in 150ms cubic-bezier(0.2, 0.6, 0.2, 1) backwards;
	}

	@keyframes plus-pop-in {
		from {
			opacity: 0;
			transform: translateY(4px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
</style>
