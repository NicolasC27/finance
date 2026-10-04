<script lang="ts">
	import { untrack } from 'svelte';
	import SidePanel from './SidePanel.svelte';
	import Switch from './Switch.svelte';
	import { uiState, showToast } from '$lib/ui.svelte';
	import { navigate, route } from '$lib/router.svelte';
	import { moduleMeta, type ModuleId } from '$lib/modules';
	import { modulesState, setCarOptions, setModuleActive } from '$lib/modules.svelte';
	import { aiState, saveConfig } from '$lib/ai.svelte';
	import { moduleActions } from '$lib/sidePanel.svelte';

	/**
	 * « Options · <module> » (right drawer, opened by the gear of a module page): the settings that
	 * belong to the module, and « Désactiver ce module » (data kept, undo toast). Voiture: loss of
	 * value in the cost and value confirmation (both off by default), theoretical depreciation,
	 * revalidation reminder. Crypto: Kraken API keys. Analyse IA: relay address and token. The other modules only offer the switch-off.
	 */

	const id = $derived(uiState.moduleOptions);
	const meta = $derived(id ? moduleMeta(id) : null);
	/** Actions handed over by the module page (import, edit…), shown above the options. */
	const actions = $derived(moduleActions(id));
	const fullView = $derived(!!actions?.fullView?.());
	const car = $derived(modulesState.car);

	let relayUrl = $state('');
	let relayToken = $state('');

	/** Relay fields refilled from the saved config each time the Analyse IA options open. */
	$effect(() => {
		if (id !== 'ia') return;
		relayUrl = aiState.url;
		relayToken = aiState.token;
	});

	function close() {
		actions?.onClose?.();
		uiState.moduleOptions = null;
	}

	/** The settings panel opening on the same right edge closes this one. */
	$effect(() => {
		if (!uiState.settingsOpen) return;
		untrack(() => {
			if (uiState.moduleOptions) close();
		});
	});

	/** Changing page closes the panel: its actions and options belong to the page that opened it. */
	$effect(() => {
		void route.path;
		untrack(() => {
			if (uiState.moduleOptions) close();
		});
	});

	function disable(module: ModuleId) {
		close();
		const message = setModuleActive(module, false);
		if (route.path === moduleMeta(module).route) navigate('/');
		showToast(message, 'Annuler', () => setModuleActive(module, true));
	}

	/** Percentage typed in the field (« 15 », « 12,5 ») as a rate; null when not a number. */
	function parsePercent(v: string): number | null {
		const n = Number(v.replace(',', '.').replace(/[\s%]/g, ''));
		return Number.isFinite(n) && v.trim() !== '' ? n / 100 : null;
	}

	/** Rate shown in the field: « 15 », « 12,5 ». */
	const percentText = (rate: number) => String(Math.round(rate * 1000) / 10).replace('.', ',');

	function saveRelay(e: SubmitEvent) {
		e.preventDefault();
		saveConfig({ url: relayUrl, token: relayToken });
		showToast('Relais IA enregistré');
	}
</script>

<SidePanel open={!!meta} title={meta ? meta.label : 'Options'} onClose={close} width={460}>
	{#if meta && actions}
		<section aria-label="Actions" class={fullView ? '' : 'mb-4 border-b pb-4'} style="border-color: var(--border-subtle);">
			{#if !fullView}<h3 class="label-plain mb-2">Actions</h3>{/if}
			{@render actions.render()}
		</section>
	{/if}
	{#if meta && !fullView}
		<h3 class="label-plain mb-1">Options</h3>
		<p class="meta-xs">{meta.description}</p>

		{#if meta.id === 'voiture'}
			<section class="mt-4 space-y-4" aria-label="Réglages du coût et de la valeur des véhicules">
				<div class="flex items-start justify-between gap-3">
					<div class="min-w-0">
						<p id="option-count-loss">Compter la perte de valeur</p>
						<p class="meta-xs mt-0.5">Allumé : le coût par mois ajoute ce que la voiture perd en valeur, et ne garde que les intérêts du crédit. Éteint : il compte l'argent qui sort de ton compte, mensualités entières.</p>
					</div>
					<Switch checked={car.countValueLoss} labelledby="option-count-loss" onchange={(on) => setCarOptions({ countValueLoss: on })} />
				</div>
				<div class="flex items-start justify-between gap-3">
					<div class="min-w-0">
						<p id="option-confirm-value">Demander de confirmer la valeur retenue</p>
						<p class="meta-xs mt-0.5">Allumé : une valeur saisie ou proposée reste « à confirmer » jusqu'à ton clic sur Confirmer. Éteint : la valeur retenue s'affiche telle quelle.</p>
					</div>
					<Switch checked={car.confirmValue} labelledby="option-confirm-value" onchange={(on) => setCarOptions({ confirmValue: on })} />
				</div>
				<label class="flex items-center justify-between gap-3">
					<span class="min-w-0">
						<span class="block">Décote théorique</span>
						<span class="meta-xs mt-0.5 block">Utilisée tant qu'aucune valeur n'est retenue, par an depuis l'achat.</span>
					</span>
					<span class="flex shrink-0 items-center gap-1">
						<input
							type="text"
							inputmode="decimal"
							class="input-surface tabular w-16 text-right"
							value={percentText(car.depreciation)}
							aria-label="Décote théorique en pourcentage par an"
							onchange={(e) => {
								const rate = parsePercent(e.currentTarget.value);
								if (rate !== null) setCarOptions({ depreciation: rate });
								e.currentTarget.value = percentText(modulesState.car.depreciation);
							}}
						/>
						<span class="meta-xs">%/an</span>
					</span>
				</label>
				<label class="flex items-center justify-between gap-3">
					<span class="min-w-0">
						<span class="block">Rappel « à revalider »</span>
						<span class="meta-xs mt-0.5 block">Une valeur plus ancienne que ce délai invite à la remettre à jour.</span>
					</span>
					<span class="flex shrink-0 items-center gap-1">
						<input
							type="number"
							min="1"
							max="60"
							step="1"
							class="input-surface tabular w-16 text-right"
							value={car.revalidateMonths}
							aria-label="Délai du rappel à revalider, en mois"
							onchange={(e) => {
								const n = Number(e.currentTarget.value);
								if (Number.isFinite(n)) setCarOptions({ revalidateMonths: n });
								e.currentTarget.value = String(modulesState.car.revalidateMonths);
							}}
						/>
						<span class="meta-xs">mois</span>
					</span>
				</label>
			</section>
		{:else if meta.id === 'crypto'}
			<section class="mt-4 flex items-center justify-between gap-3" aria-label="Connexion Kraken">
				<div class="min-w-0">
					<p>Clés API Kraken</p>
					<p class="meta-xs mt-0.5">Lecture seule, rangées dans le trousseau du système.</p>
				</div>
				<button
					type="button"
					class="btn btn-secondary btn-sm shrink-0"
					onclick={() => {
						close();
						uiState.krakenModalOpen = true;
					}}
				>
					Configurer…
				</button>
			</section>
		{:else if meta.id === 'ia'}
			<form class="mt-4 space-y-3" onsubmit={saveRelay} aria-label="Relais IA">
				<label class="block">
					<span class="meta-xs">Adresse du relais</span>
					<input type="url" class="input-surface mt-1 block w-full" bind:value={relayUrl} placeholder="http://127.0.0.1:8791" />
				</label>
				<label class="block">
					<span class="meta-xs">Jeton (affiché par « npm run ia »)</span>
					<input type="password" class="input-surface mt-1 block w-full" bind:value={relayToken} autocomplete="off" />
				</label>
				<button type="submit" class="btn btn-primary btn-sm">Enregistrer</button>
			</form>
		{:else}
			<p class="meta-xs mt-4">Pas d'autre réglage pour ce module.</p>
		{/if}
	{/if}
	{#snippet footer()}
		{#if meta && !fullView}
			<div class="flex items-center justify-between gap-3">
				<p class="meta-xs">Désactivé, le module disparaît du menu ; ses données restent.</p>
				<button type="button" class="btn btn-secondary btn-sm shrink-0" onclick={() => disable(meta.id)}>Désactiver ce module</button>
			</div>
		{/if}
	{/snippet}
</SidePanel>
