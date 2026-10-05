<script lang="ts">
	import { uiState, showToast, showSuccess } from '$lib/ui.svelte';
	import { autoBackupState, enableAutoBackup, disableAutoBackup, resumeAutoBackup, restorePendingEncrypted } from '$lib/autoBackup.svelte';
	import { formatDate } from '$lib/format';
	import { modal } from '$lib/actions/modal';

	/** Encrypted auto-backup settings (opened from the palette or the menu). */
	let passphrase = $state('');
	let confirm = $state('');
	let busy = $state(false);
	let error = $state('');

	function close() {
		uiState.backupDialogOpen = false;
		autoBackupState.pendingRestore = null;
		restorePass = '';
		restoreError = '';
	}

	// Restoring an encrypted file: passphrase typed here (masked field)
	let restorePass = $state('');
	let restoreError = $state('');
	async function restore() {
		restoreError = '';
		busy = true;
		const r = await restorePendingEncrypted(restorePass);
		busy = false;
		if (r.error) restoreError = r.error;
	}

	async function enable() {
		error = '';
		if (passphrase !== confirm) {
			error = 'Les deux phrases ne correspondent pas.';
			return;
		}
		busy = true;
		const r = await enableAutoBackup(passphrase);
		busy = false;
		if (!r.ok) {
			error = r.error ?? 'Échec';
			return;
		}
		passphrase = '';
		confirm = '';
		showSuccess(`Sauvegarde automatique activée dans « ${autoBackupState.folderName} »`);
		close();
	}

</script>

{#if uiState.backupDialogOpen}
	<div
		class="palette-backdrop fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh]"
		role="presentation"
		onclick={(e) => {
			if (e.target === e.currentTarget) close();
		}}
	>
		<div class="palette-panel w-full max-w-lg overflow-hidden rounded-2xl border" style="border-color: var(--border); background-color: var(--surface);" role="dialog" aria-modal="true" aria-label="Sauvegarde automatique" tabindex="-1" use:modal={{ onEscape: close }}>
			<div class="flex items-center justify-between gap-3 border-b px-5 py-3" style="border-color: var(--border-subtle);">
				<h2 class="label-xs">Sauvegarde automatique chiffrée</h2>
				<button type="button" class="cursor-pointer text-secondary transition-colors hover:text-[var(--text)]" aria-label="Fermer" onclick={close}>
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
				</button>
			</div>

			<div class="space-y-3 px-5 py-4 text-[13px]">
				{#if autoBackupState.pendingRestore}
					<!-- Restoring an encrypted file: the passphrase is never shown in clear -->
					<form
						class="space-y-2"
						onsubmit={(e) => {
							e.preventDefault();
							void restore();
						}}
					>
						<p>
							Restaurer la sauvegarde chiffrée du
							<span class="font-medium">{autoBackupState.pendingRestore.exportedAt ? new Date(autoBackupState.pendingRestore.exportedAt).toLocaleString('fr-FR') : 'date inconnue'}</span>.
							Une copie de l'état actuel est téléchargée avant.
						</p>
						<label class="block">
							<span class="meta-xs">Phrase secrète de la sauvegarde</span>
							<input type="password" class="input-surface mt-1 w-full" bind:value={restorePass} autocomplete="current-password" required data-autofocus />
						</label>
						{#if restoreError}<p style="color: var(--amber);">{restoreError}</p>{/if}
						<div class="flex items-center justify-end gap-2 pt-1">
							<button type="button" class="btn btn-secondary btn-sm" onclick={close}>Annuler</button>
							<button type="submit" class="btn btn-primary btn-sm" disabled={busy || !restorePass}>{busy ? 'Déchiffrement…' : 'Restaurer'}</button>
						</div>
					</form>
				{:else if !autoBackupState.supported}
					<p style="color: var(--amber);">Votre navigateur ne permet pas d'écrire dans un dossier (il faut Chrome, Edge ou Opera). Utilisez « Exporter une sauvegarde » à la main.</p>
				{:else if autoBackupState.enabled}
					<p>
						Active, dans le dossier <span class="font-medium">{autoBackupState.folderName}</span> (fichier <code>budget-sauvegarde.enc.json</code>).
						{#if autoBackupState.lastAt}<span class="text-secondary">Dernière écriture : {new Date(autoBackupState.lastAt).toLocaleTimeString('fr-FR')} le {formatDate(new Date(autoBackupState.lastAt).toISOString().slice(0, 10))}.</span>{/if}
					</p>
					{#if autoBackupState.permission !== 'granted'}
						<p style="color: var(--amber);">Le navigateur demande une confirmation après chaque redémarrage pour écrire dans le dossier.</p>
						<button type="button" class="btn btn-accent btn-sm" onclick={() => void resumeAutoBackup()}>Reprendre la sauvegarde</button>
					{/if}
					{#if autoBackupState.error}<p style="color: var(--amber);">Erreur : {autoBackupState.error}</p>{/if}
					<p class="meta-xs">Le fichier est réécrit dès qu'une donnée change (vérification toutes les 30 s et quand vous quittez l'onglet), avec une copie par jour : les 7 dernières sont conservées. Un état vide n'écrase jamais une sauvegarde qui contient des opérations. Chiffrement AES-256 avec votre phrase secrète : sans elle, le fichier est illisible, y compris pour un service de synchronisation.</p>
					<button type="button" class="btn btn-secondary btn-sm" onclick={() => void disableAutoBackup().then(() => showToast('Sauvegarde automatique désactivée'))}>Désactiver</button>
				{:else}
					<p class="text-secondary">Choisissez un dossier (idéalement synchronisé : Drive, Dropbox, OneDrive…) et une phrase secrète. L'app y réécrira une copie chiffrée de toutes vos données à chaque changement.</p>
					<form
						class="space-y-2"
						onsubmit={(e) => {
							e.preventDefault();
							void enable();
						}}
					>
						<label class="block">
							<span class="meta-xs">Phrase secrète (8 caractères minimum, à retenir : elle n'est stockée nulle part)</span>
							<input type="password" class="input-surface mt-1 w-full" bind:value={passphrase} autocomplete="new-password" minlength="8" required />
						</label>
						<label class="block">
							<span class="meta-xs">Confirmation</span>
							<input type="password" class="input-surface mt-1 w-full" bind:value={confirm} autocomplete="new-password" minlength="8" required />
						</label>
						{#if error}<p style="color: var(--amber);">{error}</p>{/if}
						<div class="flex items-center justify-end gap-2 pt-1">
							<button type="button" class="btn btn-secondary btn-sm" onclick={close}>Annuler</button>
							<button type="submit" class="btn btn-primary btn-sm" disabled={busy}>{busy ? 'Activation…' : 'Choisir le dossier et activer'}</button>
						</div>
					</form>
				{/if}
			</div>
		</div>
	</div>
{/if}

<style>
	.palette-backdrop {
		background-color: color-mix(in srgb, var(--bg) 60%, transparent);
		backdrop-filter: blur(6px);
	}
</style>
