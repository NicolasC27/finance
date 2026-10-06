<script lang="ts">
	import { tick } from 'svelte';
	import { uiState, showToast, showSuccess, togglePrivacy } from '$lib/ui.svelte';
	import { navigate, type RoutePath } from '$lib/router.svelte';
	import { getTransactions, resetImported, restoreImported } from '$lib/store.svelte';
	import { layoutState, toggleWide, resetLayout, resetPage, setFullscreen, setDensity, DENSITY_LABELS, type Density } from '$lib/layout.svelte';
	import { resetAll, listDataKeys } from '$lib/reset';
	import { downloadBackup, pickAndRestore } from '$lib/backup';
	import { pickAndRestoreEncrypted } from '$lib/autoBackup.svelte';
	import { organizeCurrentPage } from '$lib/aiOrganize.svelte';
	import { cleanLabel, formatEUR, formatDate } from '$lib/format';
	import { signedAmount } from '$lib/data';

	import { THEMES, type Theme } from '$lib/theme';
	import { moduleOfRoute, type ModuleId } from '$lib/modules';
	import { isModuleActive } from '$lib/modules.svelte';
	import { modal } from '$lib/actions/modal';

	/**
	 * Command palette (Cmd/Ctrl+K): centred overlay, grouped search Pages / Actions / Appearance /
	 * Transactions (fuzzy top 8), full keyboard navigation, match highlighting, 150 ms animations.
	 */
	let { onSelectTheme }: { onSelectTheme: (t: Theme) => void } = $props();

	type Group = 'Pages' | 'Actions' | 'Apparence' | 'Transactions';

	interface PaletteItem {
		id: string;
		group: Group;
		label: string;
		hint?: string;
		matches?: number[]; // highlighted positions (in the label)
		run: () => void;
		/** Page or command of a module: hidden while the module is switched off. */
		module?: ModuleId;
	}

	let query = $state('');
	let activeIndex = $state(0);
	let inputEl = $state<HTMLInputElement | null>(null);

	/** Fuzzy subsequence score: null when there is no match, lower is better. */
	function fuzzy(text: string, q: string): { score: number; matches: number[] } | null {
		const t = text.toLowerCase();
		let ti = 0;
		const matches: number[] = [];
		for (const ch of q) {
			const idx = t.indexOf(ch, ti);
			if (idx === -1) return null;
			matches.push(idx);
			ti = idx + 1;
		}
		const span = matches[matches.length - 1]! - matches[0]!;
		return { score: matches[0]! * 2 + span + text.length * 0.01, matches };
	}

	const pages: { href: RoutePath; label: string; hint: string }[] = [
		{ href: '/', label: 'Accueil', hint: 'Tableau de bord du mois' },
		{ href: '/budget', label: 'Budget', hint: 'Suivi par catégorie' },
		{ href: '/analyse', label: 'Analyse', hint: 'Épargne par mois, courbes par catégorie' },
		{ href: '/trier', label: 'À trier', hint: 'Catégoriser les opérations en « Autre », au clavier' },
		{ href: '/transactions', label: 'Transactions', hint: 'Liste complète et imports' },
		{ href: '/patrimoine', label: 'Patrimoine', hint: 'Vue globale banques + épargne + crypto' },
		{ href: '/crypto', label: 'Crypto', hint: 'Portefeuille Kraken, gains, positions' },
		{ href: '/rapport', label: 'Rapport mensuel', hint: 'Synthèse du mois, imprimable' },
		{ href: '/ia', label: 'Analyse IA', hint: 'Questions, modifications et rapports par Claude (relais local)' },
		{ href: '/portage', label: 'Portage', hint: 'Activité, salaire, notes de frais, tickets resto, chèques culture' },
		{ href: '/voiture', label: 'Voiture', hint: 'Fiche véhicule : compteur, coût par mois, contrôle technique' },
		{ href: '/historique', label: 'Historique des données', hint: 'Points de restauration : différences, revenir en arrière' },
		{ href: '/simulateur', label: 'Simulateur', hint: 'Et si… : crédit, déménagement, revenu en baisse, nouvel abonnement' }
	];

	/** Static items (Pages, Actions and one Appearance command per theme), built once. */
	function staticItems(): PaletteItem[] {
		return [
			...pages.map(
				(p): PaletteItem => ({
					id: `page-${p.href}`,
					group: 'Pages',
					label: p.label,
					hint: p.hint,
					run: () => navigate(p.href),
					module: moduleOfRoute(p.href) ?? undefined
				})
			),
			{
				id: 'action-quick-entry',
				group: 'Actions',
				label: 'Saisir une dépense',
				hint: 'En une phrase, comptée tout de suite (touche +)',
				run: () => {
					uiState.quickEntryOpen = true;
				}
			},
			{
				id: 'action-privacy',
				group: 'Actions',
				label: uiState.privacy ? 'Afficher les montants' : 'Mode discret : masquer les montants',
				hint: 'Partage d’écran, lieu public (touche H)',
				run: () => togglePrivacy()
			},
			{
				id: 'action-modules',
				group: 'Actions',
				label: 'Modules : activer ou retirer',
				hint: 'Voiture, Portage, Crypto, Analyse IA… (ou clic droit sur la barre latérale)',
				run: () => {
					uiState.settingsSection = 'modules';
					uiState.settingsOpen = true;
				}
			},
			{
				id: 'action-import-cm',
				group: 'Actions',
				label: 'Importer un CSV/XLSX Crédit Mutuel',
				hint: 'Page Transactions',
				run: () => {
					uiState.importRequest = 'cm';
					navigate('/transactions');
				}
			},
			{
				id: 'action-import-natixis',
				group: 'Actions',
				label: 'Importer un CSV Natixis',
				hint: 'Page Transactions',
				run: () => {
					uiState.importRequest = 'natixis';
					navigate('/transactions');
				}
			},
			{
				id: 'action-kraken',
				group: 'Actions',
				label: 'Configurer les clés Kraken',
				hint: 'API lecture seule',
				run: () => {
					uiState.krakenModalOpen = true;
					if (isModuleActive('patrimoine')) navigate('/patrimoine');
				}
			},
			{
				id: 'action-imports',
				group: 'Actions',
				label: 'Importer des fichiers',
				hint: 'Panneau Imports : relevés, exports, PDF, format reconnu tout seul (ou glissez un fichier n’importe où)',
				run: () => {
					uiState.importPanelOpen = true;
				}
			},
			{
				id: 'action-settings',
				group: 'Actions',
				label: 'Réglages',
				hint: 'Thème, densité, sauvegardes, clés Kraken (Ctrl+,)',
				run: () => {
					uiState.settingsOpen = true;
				}
			},
			{
				id: 'action-shortcuts',
				group: 'Actions',
				label: 'Raccourcis clavier',
				hint: 'Touche ? n’importe où',
				run: () => {
					uiState.shortcutsOpen = true;
				}
			},
			{
				id: 'action-backup',
				group: 'Actions',
				label: 'Exporter une sauvegarde',
				hint: 'Un fichier JSON avec toutes vos données (transactions, règles, Kraken, Natixis, impôts)',
				run: () => {
					const r = downloadBackup();
					showSuccess(`Sauvegarde ${r.fileName} : ${r.keys} enregistrement${r.keys > 1 ? 's' : ''}, ${Math.round(r.bytes / 1024)} Ko (sans les clés API)`);
				}
			},
			{
				id: 'action-restore',
				group: 'Actions',
				label: 'Restaurer une sauvegarde',
				hint: 'Remplace toutes les données par celles du fichier',
				run: () => pickAndRestore()
			},
			{
				id: 'action-autobackup',
				group: 'Actions',
				label: 'Sauvegarde automatique chiffrée',
				hint: 'Copie chiffrée réécrite dans un dossier de votre choix à chaque changement',
				run: () => {
					uiState.backupDialogOpen = true;
				}
			},
			{
				id: 'action-restore-enc',
				group: 'Actions',
				label: 'Restaurer une sauvegarde chiffrée',
				hint: 'Fichier budget-sauvegarde.enc.json + phrase secrète',
				run: () => void pickAndRestoreEncrypted()
			},
			{
				id: 'action-reset',
				group: 'Actions',
				label: 'Réinitialiser les transactions importées',
				hint: 'Budgets, comptes et Kraken conservés',
				run: () => {
					if (!window.confirm('Supprimer toutes les transactions importées ?')) return;
					const removed = resetImported();
					showToast(`${removed.length} opération${removed.length > 1 ? 's' : ''} supprimée${removed.length > 1 ? 's' : ''}`, 'Annuler', () => restoreImported(removed));
				}
			},
			{
				id: 'action-reset-all',
				group: 'Actions',
				label: 'Tout réinitialiser',
				hint: 'Transactions, budgets, objectifs, comptes, Kraken, Natixis — repart de zéro',
				run: () => {
					const n = listDataKeys().length;
					if (window.confirm(`Effacer toutes les données de l’application (${n} enregistrement${n > 1 ? 's' : ''}) ? Le thème est conservé.`)) {
						resetAll({ keepPrefs: true });
					}
				}
			},
			{
				id: 'layout-wide',
				group: 'Apparence',
				label: layoutState.wide ? 'Mode normal (marges, largeur limitée)' : 'Mode large (sans marges, pleine largeur)',
				hint: 'Les graphes prennent toute la fenêtre',
				run: () => toggleWide()
			},
			...(layoutState.currentPage
				? [
						{
							id: 'layout-reset-page',
							group: 'Apparence' as const,
							label: 'Réinitialiser la disposition de la page',
							hint: 'Tuiles, blocs rangés et éléments de cette page par défaut (annulable)',
							run: () => {
								if (layoutState.currentPage) resetPage(layoutState.currentPage);
							}
						},
						{
							id: 'layout-organiser-ia',
							group: 'Apparence' as const,
							label: "Organiser la page par l'IA",
							hint: 'Claude propose une disposition des tuiles (titres et tailles seulement, annulable)',
							run: () => organizeCurrentPage()
						}
					]
				: []),
			{
				id: 'layout-reset',
				group: 'Apparence',
				label: 'Réinitialiser la disposition des blocs',
				hint: 'Ordre, tailles, blocs masqués et éléments par défaut sur toutes les pages, mode normal',
				run: () => resetLayout()
			},
			{
				id: 'report-pdf',
				group: 'Actions',
				module: 'rapport',
				label: 'Rapport du mois en PDF',
				hint: 'Ouvre le rapport et lance l’impression (choisir « Enregistrer en PDF »)',
				run: () => {
					navigate('/rapport');
					window.setTimeout(() => window.print(), 700);
				}
			},
			{
				id: 'notes',
				group: 'Actions',
				label: 'Bloc-notes',
				hint: 'Sur l’accueil (déplaçable, plein écran)',
				run: () => {
					navigate('/');
					setFullscreen('dashboard', 'notes', true);
				}
			},
			...(['compact', 'normal', 'confort'] as Density[]).map(
				(d): PaletteItem => ({
					id: `density-${d}`,
					group: 'Apparence',
					label: `Densité : ${DENSITY_LABELS[d].toLowerCase()}${layoutState.density === d ? ' (actuelle)' : ''}`,
					hint: d === 'compact' ? 'Texte et marges réduits (≈ zoom 80 %)' : d === 'confort' ? 'Plus d’air' : 'Réglage par défaut',
					run: () => setDensity(d)
				})
			),
			...THEMES.map(
				(meta): PaletteItem => ({
					id: `theme-${meta.id}`,
					group: 'Apparence',
					label: `Thème : ${meta.label}`,
					hint: meta.mode === 'dark' ? 'Sombre' : 'Clair',
					run: () => onSelectTheme(meta.id)
				})
			)
		];
	}

	/**
	 * Structured query: 'amazon mars', '> 200', '< 50 juin 2025', '2025', 'morgan'. Amounts, months
	 * (with or without a year) and year are extracted; the rest is the searched text. When at least
	 * one structured criterion is present, an 'Ouvrir Transactions filtrées' command comes first.
	 */
	const MONTHS: [RegExp, number][] = [
		[/^janv?(ier)?\.?$/, 1], [/^f[ée]vr?(ier)?\.?$/, 2], [/^mars$/, 3], [/^avr(il)?\.?$/, 4], [/^mai$/, 5], [/^juin$/, 6],
		[/^juil(let)?\.?$/, 7], [/^ao[uû]t$/, 8], [/^sept?(embre)?\.?$/, 9], [/^oct(obre)?\.?$/, 10], [/^nov(embre)?\.?$/, 11], [/^d[ée]c(embre)?\.?$/, 12]
	];
	function parseQuery(raw: string): { text: string; min?: number; max?: number; from?: string; to?: string; label: string } | null {
		const tokens = raw.trim().toLowerCase().split(/\s+/).filter(Boolean);
		const text: string[] = [];
		let min: number | undefined;
		let max: number | undefined;
		let month: number | undefined;
		let year: number | undefined;
		for (let i = 0; i < tokens.length; i++) {
			const t = tokens[i]!;
			let m = /^([<>])=?(\d+(?:[.,]\d+)?)(?:€|e)?$/.exec(t);
			if (!m && /^[<>]=?$/.test(t) && tokens[i + 1] && /^\d+(?:[.,]\d+)?(?:€|e)?$/.test(tokens[i + 1]!)) {
				m = [t, t[0]!, tokens[i + 1]!] as unknown as RegExpExecArray;
				i++;
			}
			if (m) {
				const v = Number(m[2]!.replace(',', '.').replace(/[€e]$/, ''));
				if (m[1] === '>') min = v;
				else max = v;
				continue;
			}
			if (/^(19|20)\d{2}$/.test(t)) {
				year = Number(t);
				continue;
			}
			const mo = MONTHS.find(([re]) => re.test(t));
			if (mo) {
				month = mo[1];
				continue;
			}
			text.push(t);
		}
		if (min === undefined && max === undefined && month === undefined && year === undefined) return null;
		let from: string | undefined;
		let to: string | undefined;
		const parts: string[] = [];
		if (month !== undefined) {
			const y = year ?? new Date().getFullYear();
			const last = new Date(y, month, 0).getDate();
			from = `${y}-${String(month).padStart(2, '0')}-01`;
			to = `${y}-${String(month).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
			parts.push(new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' }).format(new Date(y, month - 1, 1)));
		} else if (year !== undefined) {
			from = `${year}-01-01`;
			to = `${year}-12-31`;
			parts.push(String(year));
		}
		if (min !== undefined) parts.push(`> ${min} €`);
		if (max !== undefined) parts.push(`< ${max} €`);
		const textJoined = text.join(' ');
		if (textJoined) parts.unshift(`« ${textJoined} »`);
		return { text: textJoined, min, max, from, to, label: parts.join(' · ') };
	}

	/**
	 * Results grouped and scored for the query: Pages and Actions by fuzzy match on the label, sorted
	 * by score; Transactions by fuzzy match on label + note, top 8.
	 */
	const results = $derived.by((): PaletteItem[] => {
		const q = query.trim().toLowerCase();
		const items = staticItems().filter((i) => !i.module || isModuleActive(i.module));
		if (!q) return items;
		const structured = parseQuery(query);
		const structuredItems: PaletteItem[] = structured
			? [
					{
						id: 'tx-filter',
						group: 'Transactions',
						label: `Ouvrir Transactions : ${structured.label}`,
						hint: 'Filtre par texte, montant et période',
						run: () => {
							uiState.txFilter = { from: structured.from, to: structured.to, minAmount: structured.min, maxAmount: structured.max, search: structured.text };
							navigate('/transactions');
						}
					}
				]
			: [];

		const withScore = items
			.map((item) => ({ item, m: fuzzy(item.label, q) }))
			.filter((x): x is { item: PaletteItem; m: { score: number; matches: number[] } } => x.m !== null)
			.sort((a, b) => a.m.score - b.m.score)
			.map(({ item, m }) => ({ ...item, matches: m.matches }));

		const q2 = query.trim();
		const txItems = getTransactions()
			.map((tx) => {
				const label = cleanLabel(tx.remittance_information);
				const m = fuzzy(`${label} ${tx.note ?? ''}`, q);
				return m ? { tx, label, m } : null;
			})
			.filter((x): x is NonNullable<typeof x> => x !== null)
			.sort((a, b) => a.m.score - b.m.score)
			.slice(0, 8)
			.map(({ tx, label, m }): PaletteItem => {
				const amount = signedAmount(tx);
				return {
					id: `tx-${label}-${tx.booking_date}-${tx.transaction_amount.amount}`,
					group: 'Transactions',
					label,
					matches: m.matches.filter((i) => i < label.length),
					hint: `${tx.booking_date ? formatDate(tx.booking_date) : 'En cours'} · ${amount >= 0 ? '+' : '−'}${formatEUR(Math.abs(amount))}`,
					run: () => {
						uiState.txSearch = q2;
						navigate('/transactions');
					}
				};
			});

		return [...structuredItems, ...withScore, ...txItems];
	});

	/** Grouped for display (fixed group order). */
	const grouped = $derived.by((): { group: Group; items: { item: PaletteItem; flatIndex: number }[] }[] => {
		const order: Group[] = ['Pages', 'Actions', 'Apparence', 'Transactions'];
		const out: { group: Group; items: { item: PaletteItem; flatIndex: number }[] }[] = [];
		results.forEach((item, flatIndex) => {
			let g = out.find((x) => x.group === item.group);
			if (!g) {
				g = { group: item.group, items: [] };
				out.push(g);
			}
			g.items.push({ item, flatIndex });
		});
		return out.sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group));
	});

	// On open: reset + focus; when results change: back to the top
	$effect(() => {
		if (uiState.paletteOpen) {
			query = '';
			activeIndex = 0;
			void tick().then(() => inputEl?.focus());
		}
	});

	$effect(() => {
		results.length;
		activeIndex = 0;
	});

	function close() {
		uiState.paletteOpen = false;
	}

	function runItem(item: PaletteItem) {
		close();
		item.run();
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			activeIndex = results.length > 0 ? (activeIndex + 1) % results.length : 0;
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			activeIndex = results.length > 0 ? (activeIndex - 1 + results.length) % results.length : 0;
		} else if (e.key === 'Enter') {
			e.preventDefault();
			const item = results[activeIndex];
			if (item) runItem(item);
		}
	}

	/** Splits the label into highlighted segments. */
	function parts(label: string, matches: number[] | undefined): { text: string; hit: boolean }[] {
		if (!matches || matches.length === 0) return [{ text: label, hit: false }];
		const hitSet = new Set(matches);
		const out: { text: string; hit: boolean }[] = [];
		for (let i = 0; i < label.length; i++) {
			const hit = hitSet.has(i);
			const last = out[out.length - 1];
			if (last && last.hit === hit) last.text += label[i];
			else out.push({ text: label[i]!, hit });
		}
		return out;
	}
</script>

{#if uiState.paletteOpen}
	<!-- Backdrop: light blur, click = close -->
	<div
		class="palette-backdrop fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh]"
		role="presentation"
		onclick={(e) => {
			if (e.target === e.currentTarget) close();
		}}
		onkeydown={onKeydown}
	>
		<div
			class="palette-panel w-full max-w-xl overflow-hidden rounded-2xl border shadow-2xl"
			style="border-color: var(--border); background-color: var(--surface);"
			role="dialog"
			aria-modal="true"
			aria-label="Palette de commandes"
			use:modal={{ onEscape: close }}
		>
			<!-- Search field -->
			<div class="flex items-center gap-3 border-b px-4" style="border-color: var(--border-subtle);">
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" stroke-width="2.2" stroke-linecap="round" aria-hidden="true" class="shrink-0">
					<circle cx="11" cy="11" r="7" />
					<path d="m20 20-3.5-3.5" />
				</svg>
				<input
					bind:this={inputEl}
					bind:value={query}
					type="text"
					placeholder="Pages, actions, transactions…"
					class="h-12 w-full bg-transparent text-sm outline-none placeholder:text-[var(--text-secondary)]"
					aria-label="Rechercher une commande"
				/>
				<kbd class="shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] text-secondary" style="border-color: var(--border);">
					Esc
				</kbd>
			</div>

			<!-- Grouped results -->
			<div class="max-h-[46vh] overflow-y-auto p-2">
				{#each grouped as g (g.group)}
					<p class="label-plain px-3 pt-2.5 pb-1.5">{g.group}</p>
					{#each g.items as { item, flatIndex } (item.id)}
						{@const active = flatIndex === activeIndex}
						<button
							type="button"
							class="press flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors duration-100 {active
								? ''
								: 'text-secondary'}"
							style={active ? 'background-color: var(--accent-soft); color: var(--text);' : ''}
							onmouseenter={() => (activeIndex = flatIndex)}
							onclick={() => runItem(item)}
						>
							<span class="min-w-0 flex-1 truncate">
								{#each parts(item.label, item.matches) as part, i (i)}
									{#if part.hit}<span class="font-semibold" style="color: var(--accent);">{part.text}</span>{:else}{part.text}{/if}
								{/each}
							</span>
							{#if item.hint}
								<span class="meta-xs shrink-0">{item.hint}</span>
							{/if}
						</button>
					{/each}
				{:else}
					<p class="px-3 py-8 text-center text-sm text-secondary">Aucun résultat pour « {query} ».</p>
				{/each}
			</div>

			<!-- Keyboard help -->
			<div class="meta-xs flex items-center gap-4 border-t px-4 py-2" style="border-color: var(--border-subtle);">
				<span>↑↓ naviguer</span>
				<span>↵ exécuter</span>
				<span>Esc fermer</span>
			</div>
		</div>
	</div>
{/if}

<style>
	/* Animated open/close: backdrop fade + panel scale (150 ms) */
	.palette-backdrop {
		background-color: color-mix(in srgb, var(--bg) 60%, transparent);
		backdrop-filter: blur(6px);
		animation: palette-fade 150ms ease-out backwards;
	}

	.palette-panel {
		animation: palette-pop 150ms ease-out backwards;
		box-shadow: var(--shadow-soft, 0 1px 2px rgba(0, 0, 0, 0.25));
	}

	@keyframes palette-fade {
		from {
			opacity: 0;
		}
	}

	@keyframes palette-pop {
		from {
			opacity: 0;
			transform: scale(0.97) translateY(-6px);
		}
	}
</style>
