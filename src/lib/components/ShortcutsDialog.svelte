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
				{ keys: ['G', 'Y'], label: 'Historique des données' },
				{ keys: ['G', 'W'], label: 'Simulateur' },
				{ keys: ['+'], label: 'Saisir une dépense' },
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
				{ keys: ['X'], label: 'Cocher la ligne (modification en lot ; Échap pour sortir)' },
				{ keys: ['←', '→'], label: 'Mois précédent / suivant (vue Calendrier)' }
			]
		},
		{
			title: 'À trier',
			items: [
				{ keys: ['1', '…', '0'], label: 'Choisir la catégorie' },
				{ keys: ['Entrée'], label: 'Passer' },
				{ keys: ['R'], label: 'Règle « toujours » on/off' },
				{ keys: ['S'], label: 'Sous-catégorie' },
				{ keys: ['Z'], label: 'Annuler le dernier tri' }
			]
		},
		{
			title: 'Général',
			items: [
				{ keys: [`${mod} K`, '/'], sep: 'ou', label: 'Palette de commandes (pages, actions, transactions, thèmes)' },
				{ keys: [`${mod} ,`, 'S'], sep: 'ou', label: 'Réglages (thème, densité, sauvegardes, Kraken) · S hors page « À trier »' },
				{ keys: ['I'], label: 'Importer des fichiers' },
				{ keys: ['[', ']'], sep: 'ou', label: 'Mois précédent / suivant (tableau de bord, budget, rapport)' },
				{ keys: ['?'], label: 'Afficher cet aide-mémoire' },
				{ keys: ['Échap'], label: 'Fermer la palette, un dialogue ou le détail ouvert' }
			]
		},
		{
			title: 'Blocs (pages en tuiles, à la souris)',
			items: [
				{ keys: ['Maintenir', 'glisser'], label: 'Déplacer : sur un bord du bloc visé, il se coupe en deux ; au centre, les deux s’échangent ; au bord de la page, tout un côté' },
				{ keys: ['Clic droit', 'glisser'], label: 'Redimensionner au pixel (les voisins s’ajustent)' },
				{ keys: ['Gouttière'], label: 'Glisser l’espace entre deux blocs, ou le bas de la page pour sa hauteur' },
				{ keys: ['Clic droit'], label: 'Menu du bloc : éléments, plein écran, ranger, égaliser (Maj + clic droit : menu du navigateur)' },
				{ keys: ['Alt ←→↑↓'], label: 'Échanger le bloc sélectionné avec son voisin' },
				{ keys: ['Alt ⇧ ←→↑↓'], label: 'Redimensionner le bloc sélectionné de 24 px' },
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
		},
		{
			title: 'Transactions',
			items: [
				{ keys: ['↵'], label: 'Ouvrir ou refermer le détail de la ligne sélectionnée' },
				{ keys: ['Glisser-déposer'], label: 'Importer : déposez vos fichiers n’importe où dans l’app (panneau Imports, format reconnu tout seul)' }
			]
		}
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
		class="palette-backdrop fixed inset-0 z-50 flex items-start justify-center px-4 pt-[10vh]"
		role="presentation"
		onclick={(e) => {
			if (e.target === e.currentTarget) close();
		}}
		onkeydown={onKeydown}
	>
		<div
			class="palette-panel w-full max-w-2xl overflow-hidden rounded-2xl border"
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

			<div class="grid gap-x-8 gap-y-4 px-5 py-4 sm:grid-cols-2">
				{#each groups as group (group.title)}
					<section>
						<h3 class="label-plain mb-1.5">{group.title}</h3>
						<ul class="divide-y divide-[var(--border-subtle)]">
							{#each group.items as item (item.label)}
								<li class="flex items-center justify-between gap-4 py-1.5 text-[13px]">
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

			<div class="flex items-center justify-between gap-3 border-t px-5 py-2.5 text-[11px] text-secondary" style="border-color: var(--border-subtle);">
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
