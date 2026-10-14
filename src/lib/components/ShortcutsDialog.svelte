<script lang="ts">
	import { uiState } from '$lib/ui.svelte';
	import { modal } from '$lib/actions/modal';

	/**
	 * Keyboard shortcuts cheat sheet: opened with '?', from the sidebar or the palette (Cmd/Ctrl+K →
	 * 'Raccourcis clavier'). Closed with Escape, a backdrop click or the button. Single source of the
	 * documented shortcuts: keep it up to date when App.svelte adds one.
	 */

	interface Shortcut {
		keys: string[]; // keys pressed in sequence ('G' then 'D') or as a combination ('Ctrl K')
		label: string;
		/** Word between keys: 'puis' (sequence, default) or 'ou' (alternatives). */
		sep?: 'puis' | 'ou';
	}

	const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
	const mod = isMac ? '⌘' : 'Ctrl';

	const groups: { title: string; items: Shortcut[] }[] = [
		{
			title: 'Navigation',
			items: [
				{ keys: ['G', 'D'], label: 'Accueil' },
				{ keys: ['G', 'B'], label: 'Budget' },
				{ keys: ['G', 'E'], label: 'Échéancier' },
				{ keys: ['G', 'A'], label: 'Analyse' },
				{ keys: ['G', 'I'], label: 'À trier' },
				{ keys: ['G', 'T'], label: 'Transactions' },
				{ keys: ['G', 'P'], label: 'Patrimoine' },
				{ keys: ['G', 'C'], label: 'Crypto' },
				{ keys: ['G', 'R'], label: 'Rapport du mois' },
				{ keys: ['G', 'J'], label: 'Analyse IA' },
				{ keys: ['G', 'O'], label: 'Portage' },
				{ keys: ['G', 'V'], label: 'Voiture' },
				{ keys: ['G', 'L'], label: 'Vacances' },
				{ keys: ['G', 'Y'], label: 'Historique des données' },
				{ keys: ['G', 'W'], label: 'Simulateur' },
				{ keys: ['G', 'F'], label: 'Impôt sur le revenu' },
				{ keys: ['+'], label: 'Saisir une dépense' },
				{ keys: ['0…9'], label: 'Saisir une dépense par son montant (sauf À trier)' },
				{ keys: ['H'], label: 'Mode discret : masquer / afficher les montants' }
			]
		},
		{
			title: 'Transactions (liste)',
			items: [
				{ keys: ['J', '↓'], label: 'Ligne suivante' },
				{ keys: ['K', '↑'], label: 'Ligne précédente' },
				{ keys: ['Entrée'], label: 'Ouvrir / fermer le détail' },
				{ keys: ['C'], label: 'Changer la catégorie' },
				{ keys: ['V'], label: 'Rattacher aux vacances de la date' },
				{ keys: ['M'], label: 'Masquer / réintégrer au budget' },
				{ keys: ['N'], label: 'Écrire une note' },
				{ keys: ['X'], label: 'Cocher la ligne (lot ; Échap pour sortir)' },
				{ keys: ['←', '→'], sep: 'ou', label: 'Page précédente / suivante' },
				{ keys: ['←', '→'], sep: 'ou', label: 'Mois précédent / suivant (calendrier, par catégorie)' },
				{ keys: ['⇧ ←', '⇧ →'], sep: 'ou', label: 'Page précédente / suivante (par catégorie)' }
			]
		},
		{
			title: 'À trier',
			items: [
				{ keys: ['1', '…', '0'], label: 'Choisir la catégorie' },
				{ keys: ['Entrée'], label: 'Passer' },
				{ keys: ['R'], label: 'Règle « toujours » on/off' },
				{ keys: ['S'], label: 'Sous-catégorie' },
				{ keys: ['I'], label: 'Accepter la proposition de l’IA' },
				{ keys: ['Z'], label: 'Annuler le dernier tri' }
			]
		},
		{
			title: 'Général',
			items: [
				{ keys: [`${mod} K`, '/'], sep: 'ou', label: 'Palette de commandes' },
				{ keys: [`${mod} ,`, 'S'], sep: 'ou', label: 'Réglages (S sauf sur « À trier »)' },
				{ keys: ['I'], label: 'Importer (ou déposer des fichiers n’importe où)' },
				{ keys: ['[', ']'], sep: 'ou', label: 'Mois précédent / suivant (accueil, budget)' },
				{ keys: ['?'], label: 'Cet aide-mémoire' },
				{ keys: ['Échap'], label: 'Fermer la palette, un dialogue, le détail' }
			]
		},
		{
			title: 'Blocs (pages en tuiles)',
			items: [
				{ keys: ['Maintenir', 'glisser'], label: 'Déplacer : bord = moitié, centre = échange, bord de page = côté' },
				{ keys: ['Clic droit', 'glisser'], label: 'Redimensionner au pixel' },
				{ keys: ['Gouttière'], label: 'Glisser l’espace entre deux blocs ou le bas de page' },
				{ keys: ['Clic droit'], label: 'Menu du bloc (Maj : menu du navigateur)' },
				{ keys: ['Alt ←→↑↓'], label: 'Échanger avec le voisin' },
				{ keys: ['Alt ⇧ ←→↑↓'], label: 'Redimensionner de 24 px' },
				{ keys: ['Alt ↵'], label: 'Plein écran' },
				{ keys: ['Menu', '⇧ F10'], sep: 'ou', label: 'Menu du bloc sélectionné' }
			]
		},
		{
			title: 'Dans la palette',
			items: [
				{ keys: ['↑', '↓'], sep: 'ou', label: 'Parcourir les résultats' },
				{ keys: ['↵'], label: 'Exécuter la commande sélectionnée' }
			]
		},
		{
			title: 'Budget',
			items: [
				{ keys: ['←', '→'], sep: 'ou', label: 'Ajuster l’enveloppe sélectionnée de 10 €' },
				{ keys: ['⇧ ←', '⇧ →'], sep: 'ou', label: 'Ajuster de 50 €' }
			]
		}
	];

	/** Three columns of close heights on desktop (the sheet must fit a laptop screen); two on tablets, one on phones. */
	const byTitle = (t: string) => groups.find((g) => g.title === t)!;
	const columns = [
		[byTitle('Navigation'), byTitle('Dans la palette')],
		[byTitle('Transactions (liste)'), byTitle('À trier'), byTitle('Budget')],
		[byTitle('Général'), byTitle('Blocs (pages en tuiles)')]
	];

	function close() {
		uiState.shortcutsOpen = false;
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			close();
		}
	}
</script>

{#if uiState.shortcutsOpen}
	<div
		class="palette-backdrop fixed inset-0 z-50 flex items-start justify-center px-4 pt-[4vh]"
		role="presentation"
		onclick={(e) => {
			if (e.target === e.currentTarget) close();
		}}
		onkeydown={onKeydown}
	>
		<div
			class="palette-panel flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border"
			style="border-color: var(--border); background-color: var(--surface);"
			role="dialog"
			aria-modal="true"
			aria-label="Raccourcis clavier"
			tabindex="-1"
			use:modal={{ onEscape: close }}
		>
			<div class="flex items-center justify-between gap-3 border-b px-5 py-3" style="border-color: var(--border-subtle);">
				<h2 class="label-xs">Raccourcis clavier</h2>
				<button
					type="button"
					class="cursor-pointer text-secondary transition-colors hover:text-[var(--text)]"
					aria-label="Fermer"
					onclick={close}
				>
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true">
						<path d="M6 6l12 12M18 6L6 18" />
					</svg>
				</button>
			</div>

			<!-- The body scrolls only when the window is shorter than the sheet -->
			<div class="grid min-h-0 gap-x-8 overflow-y-auto px-5 py-3 sm:grid-cols-2 lg:grid-cols-3">
				{#each columns as column, c (c)}
					<div>
						{#each column as group (group.title)}
							<section class="mb-3">
								<h3 class="label-plain mb-0.5">{group.title}</h3>
								<ul class="divide-y divide-[var(--border-subtle)]">
									{#each group.items as item (item.label)}
										<li class="flex items-center justify-between gap-3 py-[3px] text-[12.5px] leading-snug">
											<span class="min-w-0 flex-1 text-secondary">{item.label}</span>
											<span class="flex shrink-0 items-center gap-1">
												{#each item.keys as key, i (key)}
													{#if i > 0}<span class="meta-xs">{item.sep ?? 'puis'}</span>{/if}
													<kbd class="kbd">{key}</kbd>
												{/each}
											</span>
										</li>
									{/each}
								</ul>
							</section>
						{/each}
					</div>
				{/each}
			</div>

			<div class="flex shrink-0 items-center justify-between gap-3 border-t px-5 py-2 text-[11px] text-secondary" style="border-color: var(--border-subtle);">
				<span>Les raccourcis sont ignorés quand un champ de saisie a le focus.</span>
				<span><kbd class="kbd">Esc</kbd> fermer</span>
			</div>
		</div>
	</div>
{/if}

<style>
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
