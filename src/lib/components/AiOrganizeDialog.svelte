<script lang="ts">
	import { modal } from '$lib/actions/modal';
	import { navigate } from '$lib/router.svelte';
	import { MAX_INSTRUCTION } from '$lib/aiLayout';
	import { closeOrganize, organizePage, organizeState } from '$lib/aiOrganize.svelte';

	/**
	 * « ✨ Organiser la page par l'IA » dialog: an optional instruction, then Claude (through the local
	 * relay) proposes tiles for the page; the result is applied with « Annuler » in a toast. Only the
	 * block titles and sizes are sent, never an amount.
	 */

	const PAGE_NAMES: Record<string, string> = {
		dashboard: 'Accueil (chiffres)',
		'dashboard-main': 'Accueil',
		'dashboard-detail': 'Accueil (vue détaillée)',
		budget: 'Budget',
		analyse: 'Analyse',
		patrimoine: 'Patrimoine',
		crypto: 'Crypto',
		voiture: 'Voiture',
		portage: 'Portage'
	};

	const pageName = $derived(organizeState.page ? (PAGE_NAMES[organizeState.page] ?? organizeState.page) : '');

	/** Enter sends, Shift + Enter adds a line. */
	function onKeydown(e: KeyboardEvent): void {
		if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
		e.preventDefault();
		void organizePage();
	}

	/** Opens the « Analyse IA » page to set up the relay. */
	function goToAiPage(): void {
		closeOrganize();
		navigate('/ia');
	}
</script>

{#if organizeState.page}
	<div
		class="organiser-backdrop fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh]"
		role="presentation"
		onclick={(e) => {
			if (e.target === e.currentTarget && !organizeState.busy) closeOrganize();
		}}
	>
		<div
			class="organiser-panel w-full max-w-md overflow-hidden rounded-2xl border"
			style="border-color: var(--border); background-color: var(--surface);"
			role="dialog"
			aria-modal="true"
			aria-labelledby="organiser-title"
			aria-busy={organizeState.busy}
			tabindex="-1"
			use:modal={{ onEscape: closeOrganize }}
		>
			<div class="flex items-center justify-between gap-3 border-b px-4 py-3" style="border-color: var(--border-subtle);">
				<h2 id="organiser-title" class="label-xs">✨ Organiser par l'IA · {pageName}</h2>
				<button type="button" class="cursor-pointer text-secondary transition-colors hover:text-[var(--text)]" aria-label="Fermer" onclick={closeOrganize}>
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true">
						<path d="M6 6l12 12M18 6L6 18" />
					</svg>
				</button>
			</div>

			<div class="flex flex-col gap-2 px-4 py-3 text-[13px]">
				<label for="organiser-consigne" class="text-secondary">Consigne <span class="meta-xs">(facultatif)</span></label>
				<textarea
					id="organiser-consigne"
					class="input-surface min-h-16 w-full resize-y"
					rows="2"
					maxlength={MAX_INSTRUCTION}
					placeholder="ex. mets mes dépenses en avant, graphiques en grand"
					disabled={organizeState.busy}
					bind:value={organizeState.consigne}
					onkeydown={onKeydown}
					data-autofocus
				></textarea>
				<p class="meta-xs">Claude ne reçoit que les titres et les tailles des blocs, aucun montant. Tu pourras annuler d'un clic.</p>
				{#if organizeState.erreur}
					<p class="organiser-erreur meta-xs" role="alert">
						{organizeState.erreur}
						{#if organizeState.versIa}
							<button type="button" class="organiser-lien" onclick={goToAiPage}>Ouvrir la page Analyse IA</button>
						{/if}
					</p>
				{/if}
			</div>

			<div class="flex items-center justify-end gap-2 border-t px-4 py-2.5" style="border-color: var(--border-subtle);">
				<button type="button" class="btn btn-secondary btn-sm" onclick={closeOrganize}>Annuler</button>
				<button type="button" class="btn btn-accent btn-sm" disabled={organizeState.busy} onclick={() => void organizePage()}>
					{#if organizeState.busy}
						<span class="organiser-spin" aria-hidden="true"></span> Claude réfléchit…
					{:else}
						Organiser
					{/if}
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.organiser-backdrop {
		background-color: color-mix(in srgb, var(--bg) 60%, transparent);
		backdrop-filter: blur(6px);
	}

	.organiser-panel {
		box-shadow: var(--shadow-soft, 0 1px 2px rgba(0, 0, 0, 0.25));
	}

	.organiser-erreur {
		color: var(--amber);
	}

	.organiser-lien {
		margin-left: 4px;
		color: var(--accent);
		text-decoration: underline;
		text-underline-offset: 2px;
		cursor: pointer;
	}

	/* Small spinner while Claude answers (static under reduced motion) */
	.organiser-spin {
		display: inline-block;
		width: 10px;
		height: 10px;
		margin-right: 4px;
		border: 2px solid currentColor;
		border-right-color: transparent;
		border-radius: 999px;
		vertical-align: -1px;
		animation: organiser-tourne 800ms linear infinite;
	}

	@keyframes organiser-tourne {
		to {
			transform: rotate(360deg);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.organiser-spin {
			animation: none;
		}
	}
</style>
