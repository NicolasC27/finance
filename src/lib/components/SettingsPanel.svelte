<script lang="ts">
	import { uiState, showToast, showSuccess, toggleAccountBadges, toggleBrandLogos, toggleCompactRows } from '$lib/ui.svelte';
	import { navigate, route } from '$lib/router.svelte';
	import { THEMES, type Theme } from '$lib/theme';
	import { layoutState, toggleWide, resetLayout, resetPage, setDensity, DENSITY_LABELS, type Density } from '$lib/layout.svelte';
	import { downloadBackup, pickAndRestore } from '$lib/backup';
	import { autoBackupState, pickAndRestoreEncrypted } from '$lib/autoBackup.svelte';
	import { tick, untrack } from 'svelte';
	import SidePanel from './SidePanel.svelte';
	import Switch from './Switch.svelte';
	import { ESSENTIAL_PAGES, MODULES, type ModuleId } from '$lib/modules';
	import { modulesState, setModuleActive } from '$lib/modules.svelte';

	/**
	 * Settings panel (« Réglages »), opened from the sidebar gear, the mobile 'Plus' menu, Ctrl+, or the palette, in the
	 * right-hand panel like a module's « ⚙ »: the page stays visible, so every choice (theme, density,
	 * width) shows at once, with no 'Validate' button. Groups appearance, modules, backups, the Kraken
	 * connection and help.
	 */
	let { theme, onSelectTheme }: { theme: Theme; onSelectTheme: (t: Theme) => void } = $props();

	const DENSITIES: Density[] = ['compact', 'normal', 'confort'];

	const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
	const mod = isMac ? '⌘' : 'Ctrl';

	function close() {
		uiState.settingsOpen = false;
		uiState.settingsSection = null;
	}

	/** Switches a module from Settings › Modules, with an undo toast; leaves the page of a module just removed. */
	function switchModule(id: ModuleId, on: boolean) {
		const message = setModuleActive(id, on);
		if (!on && route.path === MODULES.find((m) => m.id === id)?.route) navigate('/');
		showToast(message, 'Annuler', () => setModuleActive(id, !on));
	}

	let modulesSection = $state<HTMLElement | null>(null);

	/** Changing page closes the settings, like a module's « ⚙ » panel. */
	$effect(() => {
		void route.path;
		untrack(() => {
			if (uiState.settingsOpen) close();
		});
	});

	/** A module's « ⚙ » panel opening on the same right edge closes the settings. */
	$effect(() => {
		if (!uiState.moduleOptions) return;
		untrack(() => {
			if (uiState.settingsOpen) close();
		});
	});

	/** Opened from « Tous les réglages des modules… »: scrolls to the Modules section. */
	$effect(() => {
		if (!uiState.settingsOpen || uiState.settingsSection !== 'modules') return;
		void tick().then(() => modulesSection?.scrollIntoView({ block: 'start' }));
	});

	/** Opens a dialog instead of the settings (never two stacked backdrops on a narrow screen). */
	function openInstead(open: () => void) {
		close();
		open();
	}

	function exportJson() {
		const r = downloadBackup();
		showSuccess(`Sauvegarde ${r.fileName} : ${r.keys} enregistrement${r.keys > 1 ? 's' : ''}, ${Math.round(r.bytes / 1024)} Ko (sans les clés API)`);
	}

	/** Auto-backup status in one line, with the colour of its dot. */
	const autoStatus = $derived.by((): { text: string; color: string } => {
		if (!autoBackupState.supported) return { text: 'Indisponible dans ce navigateur', color: 'var(--text-3)' };
		if (!autoBackupState.enabled) return { text: 'Désactivée', color: 'var(--text-3)' };
		if (autoBackupState.error) return { text: `En erreur : ${autoBackupState.error}`, color: 'var(--amber)' };
		if (autoBackupState.permission !== 'granted') return { text: 'En pause : « Configurer » pour la reprendre', color: 'var(--amber)' };
		const last = autoBackupState.lastAt
			? ` · dernière copie ${new Date(autoBackupState.lastAt).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`
			: '';
		return { text: `Active · dossier « ${autoBackupState.folderName} »${last}`, color: 'var(--accent)' };
	});
</script>

<SidePanel open={uiState.settingsOpen} title="Réglages" onClose={close} width={460}>
	<!-- Appearance: theme, density, width -->
	<section aria-labelledby="settings-apparence">
		<h3 id="settings-apparence" class="label-plain mb-2">Apparence</h3>
		<div class="grid grid-cols-4 gap-2" role="radiogroup" aria-label="Thème">
			{#each THEMES as meta (meta.id)}
				{@const active = theme === meta.id}
				<button
					type="button"
					role="radio"
					aria-checked={active}
					class="press flex cursor-pointer flex-col items-center gap-1.5 rounded-lg p-0.5"
					title="{meta.label} ({meta.mode === 'dark' ? 'sombre' : 'clair'})"
					onclick={() => onSelectTheme(meta.id)}
				>
					<!-- Preview: theme background, accent stroke, text line -->
					<span
						class="flex h-10 w-full flex-col justify-center gap-1 rounded-md px-2"
						style="background-color: {meta.bg}; border: 1px solid {active ? 'var(--accent)' : 'var(--hairline)'}; box-shadow: {active ? '0 0 0 2px var(--accent-soft)' : 'none'};"
						aria-hidden="true"
					>
						<span class="h-1 w-5 rounded-full" style="background-color: {meta.accent};"></span>
						<span class="h-1 w-8 rounded-full" style="background-color: {meta.mode === 'dark' ? 'rgb(255 255 255 / 0.28)' : 'rgb(0 0 0 / 0.2)'};"></span>
					</span>
					<span class="serif text-[12px] leading-none" style="color: {active ? 'var(--text)' : 'var(--text-2)'};">{meta.label}</span>
				</button>
			{/each}
		</div>

		<div class="mt-3 flex items-center justify-between gap-3">
			<span id="settings-densite" class="text-secondary">Densité</span>
			<div class="flex rounded-full border p-0.5" style="border-color: var(--hairline);" role="radiogroup" aria-labelledby="settings-densite">
				{#each DENSITIES as d (d)}
					{@const active = layoutState.density === d}
					<button
						type="button"
						role="radio"
						aria-checked={active}
						class="press cursor-pointer rounded-full px-2.5 py-0.5 text-[12px] transition-colors duration-150"
						style={active ? 'background-color: var(--surface-2); color: var(--text);' : 'color: var(--text-2);'}
						onclick={() => setDensity(d)}
					>
						{DENSITY_LABELS[d]}
					</button>
				{/each}
			</div>
		</div>

		<div class="mt-2 flex items-center justify-between gap-3">
			<span id="settings-large" class="text-secondary">Pleine largeur <span class="meta-xs">· sans marges, graphes plus larges</span></span>
			<button type="button" role="switch" aria-checked={layoutState.wide} aria-labelledby="settings-large" class="switch shrink-0 cursor-pointer" onclick={() => toggleWide()}>
				<span class="switch-knob" aria-hidden="true"></span>
			</button>
		</div>

		<div class="mt-2 flex items-center justify-between gap-3">
			<span id="settings-lignes" class="text-secondary">Lignes compactes <span class="meta-xs">· longues listes sur une ligne, point de couleur, fond alterné</span></span>
			<Switch checked={uiState.compactRows} labelledby="settings-lignes" onchange={toggleCompactRows} />
		</div>

		<div class="mt-2 flex items-center justify-between gap-3">
			<span id="settings-logos" class="text-secondary">Logos des marques <span class="meta-xs">· le logo quand la marque est connue, sinon l'icône de catégorie</span></span>
			<Switch checked={uiState.brandLogos} labelledby="settings-logos" onchange={toggleBrandLogos} />
		</div>

		<div class="mt-2 flex items-center justify-between gap-3">
			<span id="settings-compte" class="text-secondary">Compte sur chaque ligne <span class="meta-xs">· le badge du compte dans Transactions</span></span>
			<Switch checked={uiState.accountBadges} labelledby="settings-compte" onchange={toggleAccountBadges} />
		</div>

		<button
			type="button"
			class="mt-2 cursor-pointer text-[12px] text-secondary underline-offset-2 transition-colors hover:text-[var(--accent)] hover:underline"
			onclick={() => {
				resetLayout();
				showToast('Disposition des blocs réinitialisée');
			}}
		>
			Réinitialiser la disposition des blocs
		</button>
		{#if layoutState.currentPage}
			{@const page = layoutState.currentPage}
			<button
				type="button"
				class="ml-3 mt-2 cursor-pointer text-[12px] text-secondary underline-offset-2 transition-colors hover:text-[var(--accent)] hover:underline"
				onclick={() => openInstead(() => resetPage(page))}
			>
				Réinitialiser cette page
			</button>
		{/if}
	</section>

	<!-- Modules: optional pages, switched on and off at once (data kept) -->
	<section bind:this={modulesSection} class="mt-3 border-t pt-3" style="border-color: var(--border-subtle);" aria-labelledby="settings-modules">
		<h3 id="settings-modules" class="label-plain mb-1">Modules</h3>
		<p class="meta-xs mb-2">Toujours affichés : {ESSENTIAL_PAGES.map((p) => p.label).join(', ')}. Un module retiré disparaît du menu, ses données restent. Raccourci : clic droit sur la barre latérale.</p>
		<ul class="space-y-2">
			{#each MODULES as m (m.id)}
				<li class="flex items-center justify-between gap-3">
					<div class="min-w-0">
						<p id="module-{m.id}">{m.label}</p>
						<p class="meta-xs mt-0.5">{m.description}</p>
					</div>
					<Switch checked={modulesState.active.includes(m.id)} labelledby="module-{m.id}" onchange={(on) => switchModule(m.id, on)} />
				</li>
			{/each}
		</ul>
	</section>

	<!-- Backups -->
	<section class="mt-3 border-t pt-3" style="border-color: var(--border-subtle);" aria-labelledby="settings-sauvegardes">
		<h3 id="settings-sauvegardes" class="label-plain mb-2">Sauvegardes</h3>
		<div class="flex items-center justify-between gap-3">
			<div class="min-w-0">
				<p>Sauvegarde automatique chiffrée</p>
				<p class="meta-xs mt-0.5 flex items-center gap-1.5">
					<span class="inline-block h-1.5 w-1.5 shrink-0 rounded-full" style="background-color: {autoStatus.color};" aria-hidden="true"></span>
					<span class="truncate" title={autoStatus.text}>{autoStatus.text}</span>
				</p>
			</div>
			<button type="button" class="btn btn-secondary btn-sm shrink-0" onclick={() => openInstead(() => (uiState.backupDialogOpen = true))}>Configurer…</button>
		</div>
		<div class="mt-2 flex items-center justify-between gap-3">
			<div class="min-w-0">
				<p>Export JSON</p>
				<p class="meta-xs mt-0.5">Fichier non chiffré, sans les clés API : à garder en lieu sûr</p>
			</div>
			<button type="button" class="btn btn-secondary btn-sm shrink-0" onclick={exportJson}>Télécharger</button>
		</div>
		<div class="mt-2 flex items-center justify-between gap-3">
			<div class="min-w-0">
				<p>Restaurer</p>
				<p class="meta-xs mt-0.5">Remplace toutes les données par celles du fichier</p>
			</div>
			<div class="flex shrink-0 gap-1.5">
				<button type="button" class="btn btn-secondary btn-sm" onclick={() => openInstead(pickAndRestore)}>JSON…</button>
				<button type="button" class="btn btn-secondary btn-sm" onclick={() => openInstead(() => void pickAndRestoreEncrypted())}>Chiffré…</button>
			</div>
		</div>
		<div class="mt-2 flex items-center justify-between gap-3">
			<div class="min-w-0">
				<p>Historique</p>
				<p class="meta-xs mt-0.5">Points de restauration : revenir à un état précédent</p>
			</div>
			<button type="button" class="btn btn-secondary btn-sm shrink-0" title="Historique des données (G puis Y)" onclick={() => navigate('/historique')}>Ouvrir</button>
		</div>
	</section>

	<!-- Connections -->
	<section class="mt-3 border-t pt-3" style="border-color: var(--border-subtle);" aria-labelledby="settings-connexions">
		<h3 id="settings-connexions" class="label-plain mb-2">Connexions</h3>
		<div class="flex items-center justify-between gap-3">
			<div class="min-w-0">
				<p>Clés API Kraken</p>
				<p class="meta-xs mt-0.5">Lecture seule, rangées dans le trousseau du système</p>
			</div>
			<button
				type="button"
				class="btn btn-secondary btn-sm shrink-0"
				onclick={() =>
					openInstead(() => {
						uiState.krakenModalOpen = true;
						if (modulesState.active.includes('patrimoine')) navigate('/patrimoine');
					})}
			>
				Configurer…
			</button>
		</div>
	</section>

	<!-- Help -->
	<section class="mt-3 border-t pt-3" style="border-color: var(--border-subtle);" aria-labelledby="settings-aide">
		<h3 id="settings-aide" class="label-plain mb-2">Aide</h3>
		<div class="flex items-center justify-between gap-3">
			<p class="meta-xs">
				Palette <kbd class="kbd">{mod} K</kbd> · Réglages <kbd class="kbd">{mod} ,</kbd>
			</p>
			<button type="button" class="btn btn-secondary btn-sm shrink-0" onclick={() => openInstead(() => (uiState.shortcutsOpen = true))}>
				Raccourcis clavier <kbd class="kbd">?</kbd>
			</button>
		</div>
	</section>
</SidePanel>

<style>
	/* 'Pleine largeur' switch: 30 × 18 px, accent when on */
	.switch {
		position: relative;
		width: 30px;
		height: 18px;
		border-radius: 999px;
		border: 1px solid var(--hairline);
		background-color: var(--surface-2);
		transition: background-color 150ms ease, border-color 150ms ease;
	}

	.switch[aria-checked='true'] {
		background-color: var(--accent);
		border-color: var(--accent);
	}

	.switch-knob {
		position: absolute;
		top: 2px;
		left: 2px;
		width: 12px;
		height: 12px;
		border-radius: 999px;
		background-color: var(--text-2);
		transition: transform 150ms ease, background-color 150ms ease;
	}

	.switch[aria-checked='true'] .switch-knob {
		transform: translateX(12px);
		background-color: var(--bg);
	}
</style>
