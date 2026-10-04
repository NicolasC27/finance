<script lang="ts">
	import { uiState } from '$lib/ui.svelte';
	import { krakenState, saveKeysAndTest, clearKrakenKeys, refreshBalances, testKeysOnly } from '$lib/wealth.svelte';
	import { modal } from '$lib/actions/modal';

	/**
	 * Kraken API key settings modal: visible security warning, 'Tester la connexion', 'Supprimer les
	 * clés'. 'Enregistrer et tester' tests first, so rejected keys are never saved. Keyboard: focus on
	 * open, Escape closes (use:modal action). Keys go once to the local server, which stores them in
	 * the system keyring and signs the calls itself (never in the page).
	 */

	let apiKey = $state('');
	let apiSecret = $state('');
	let testing = $state(false);
	let testResult = $state<{ ok: boolean; message: string } | null>(null);

	// On open: reset the fields and the result (the existing key is not prefilled)
	$effect(() => {
		if (uiState.krakenModalOpen) {
			apiKey = '';
			apiSecret = '';
			testing = false;
			testResult = null;
		}
	});

	function close() {
		uiState.krakenModalOpen = false;
	}

	/** Tests the connection (private Balance) then saves the keys if they are accepted. */
	async function saveAndTest() {
		if (!apiKey.trim() || !apiSecret.trim()) {
			testResult = { ok: false, message: 'Renseignez les deux clés.' };
			return;
		}
		testing = true;
		testResult = null;
		const res = await saveKeysAndTest(apiKey, apiSecret);
		testing = false;
		if (res.ok) {
			const count = Object.keys(krakenState.balances ?? {}).length;
			testResult = { ok: true, message: `Connexion réussie — ${count} actif${count > 1 ? 's' : ''} détecté${count > 1 ? 's' : ''}.` };
		} else {
			testResult = {
				ok: false,
				message: `Échec de connexion : ${res.error ?? 'erreur inconnue'}. Clés non enregistrées : vérifiez-les ou utilisez la saisie manuelle.`
			};
		}
	}

	/**
	 * 'Tester la connexion': tests the values currently typed in the fields WITHOUT saving them; empty
	 * fields → the keys already saved.
	 */
	async function testConnection() {
		const key = apiKey.trim();
		const secret = apiSecret.trim();
		testing = true;
		testResult = null;
		if (key || secret) {
			if (!key || !secret) {
				testing = false;
				testResult = {
					ok: false,
					message: 'Renseignez les deux clés (ou videz les champs pour tester les clés enregistrées).'
				};
				return;
			}
			const res = await testKeysOnly(key, secret);
			testing = false;
			if (res.ok) {
				const count = res.count ?? 0;
				testResult = {
					ok: true,
					message: `Connexion réussie — ${count} actif${count > 1 ? 's' : ''} détecté${count > 1 ? 's' : ''} (clés non enregistrées).`
				};
			} else {
				testResult = {
					ok: false,
					message: `Échec de connexion : ${res.error ?? 'erreur inconnue'}. Vérifiez les clés saisies.`
				};
			}
			return;
		}
		const res = await refreshBalances();
		testing = false;
		testResult = res.ok
			? { ok: true, message: 'Connexion réussie.' }
			: { ok: false, message: `Échec de connexion : ${res.error ?? 'erreur inconnue'}.` };
	}

	/** The status becomes stale as soon as a field changes, so it is reset. */
	function onFieldChange() {
		testResult = null;
	}

	async function removeKeys() {
		const res = await clearKrakenKeys();
		testResult = res.ok
			? { ok: true, message: 'Clés supprimées — retour à la saisie manuelle.' }
			: { ok: false, message: `Suppression impossible : ${res.error ?? 'erreur inconnue'}.` };
	}

</script>

{#if uiState.krakenModalOpen}
	<div
		class="palette-backdrop fixed inset-0 z-50 flex items-center justify-center p-4"
		role="presentation"
		onclick={(e) => {
			if (e.target === e.currentTarget) close();
		}}
	>
		<div
			class="palette-panel card w-full max-w-md p-6"
			role="dialog"
			aria-modal="true"
			aria-label="Configuration des clés Kraken"
			use:modal={{ onEscape: close }}
		>
			<div class="mb-4 flex items-start justify-between gap-3">
				<div>
					<h2 class="text-lg font-semibold tracking-tight">Clés API Kraken</h2>
					<p class="meta-xs mt-1">Lecture des soldes en direct (endpoint Balance).</p>
				</div>
				<button
					type="button"
					class="cursor-pointer text-secondary transition-colors hover:text-[var(--text)]"
					aria-label="Fermer"
					onclick={close}
				>
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true">
						<path d="M6 6l12 12M18 6L6 18" />
					</svg>
				</button>
			</div>

			<!-- Security warning: always visible -->
			<div class="mb-4 rounded-xl border p-3.5 text-[13px] leading-relaxed" style="border-color: var(--amber); background-color: var(--amber-soft); color: var(--amber);">
				<p class="font-medium">Sécurité</p>
				<p class="mt-1 opacity-90">
					Clés rangées dans le trousseau de ton système, jamais dans le navigateur : le serveur local
					signe lui-même les appels (soldes et registre uniquement). Utilisez des clés en
					<strong>lecture seule</strong>, sans droits de retrait ni de trading.
				</p>
			</div>

			{#if krakenState.hasKeys}
				<p class="mb-4 text-sm">
					Statut :
					{#if krakenState.balanceStatus === 'ok'}
						<span class="font-medium" style="color: var(--accent);">connecté</span>
					{:else if krakenState.balanceStatus === 'loading'}
						<span class="text-secondary">vérification…</span>
					{:else if krakenState.balanceStatus === 'error'}
						<span class="font-medium" style="color: var(--amber);">erreur — {krakenState.balanceError}</span>
					{:else}
						<span class="text-secondary">clés enregistrées</span>
					{/if}
				</p>
			{/if}

			<form
				class="space-y-3"
				onsubmit={(e) => {
					e.preventDefault();
					void saveAndTest();
				}}
			>
				<label class="block">
					<span class="meta-xs">API Key</span>
					<input
						type="text"
						class="input-surface mt-1 w-full !px-3 !py-2"
						placeholder={krakenState.hasKeys ? '•••••••••••• (clé enregistrée)' : 'Votre clé publique Kraken'}
						bind:value={apiKey}
						oninput={onFieldChange}
						autocomplete="off"
						data-autofocus
						spellcheck="false"
					/>
				</label>
				<label class="block">
					<span class="meta-xs">API Secret</span>
					<input
						type="password"
						class="input-surface mt-1 w-full !px-3 !py-2"
						placeholder={krakenState.hasKeys ? '•••••••••••• (secret enregistré)' : 'Votre clé privée Kraken'}
						bind:value={apiSecret}
						oninput={onFieldChange}
						autocomplete="off"
					/>
				</label>

				{#if testResult}
					<p
						class="toast-in rounded-lg border px-3 py-2 text-[13px]"
						style="border-color: {testResult.ok ? 'var(--accent)' : 'var(--accent-2)'}; color: {testResult.ok
							? 'var(--accent)'
							: 'var(--accent-2)'};"
						role="status"
					>
						{testResult.message}
					</p>
				{/if}

				<div class="flex flex-wrap items-center gap-2.5 pt-1">
					<button
						type="submit"
						class="btn btn-primary"
						disabled={testing}
					>
						{testing ? 'Test en cours…' : 'Enregistrer et tester'}
					</button>
					{#if krakenState.hasKeys}
						<button
							type="button"
							class="btn btn-secondary"
							disabled={testing}
							onclick={() => void testConnection()}
						>
							Tester la connexion
						</button>
						<button
							type="button"
							class="btn btn-secondary"
							style="border-color: var(--accent-2); color: var(--accent-2);"
							onclick={removeKeys}
						>
							Supprimer les clés
						</button>
					{/if}
				</div>
			</form>

			<p class="meta-xs mt-4">
				Sans clés (ou si l'API est inaccessible), la saisie manuelle des quantités prend le relais sur la page
				Patrimoine.
			</p>
		</div>
	</div>
{/if}

<style>
	/* 150 ms animations, same as the palette */
	.palette-backdrop {
		background-color: color-mix(in srgb, var(--bg) 60%, transparent);
		backdrop-filter: blur(6px);
		animation: palette-fade 150ms ease-out backwards;
	}

	.palette-panel {
		animation: palette-pop 150ms ease-out backwards;
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
