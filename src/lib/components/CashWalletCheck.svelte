<script lang="ts">
	import { tick } from 'svelte';
	import { confirmWalletBalance, shownCashBalance, walletNeedsCheck, writeOffCash } from '$lib/wallet.svelte';
	import { sensitiveEUR } from '$lib/format';
	import { showSuccess } from '$lib/ui.svelte';

	/**
	 * Honesty check of the cash wallet, one discreet line (home page header): shown only while cash is
	 * left in the wallet and no cash entry for 30 days. « Oui » confirms the balance; « J'ai… » takes
	 * the amount really in hand (the gap becomes « Liquide non détaillé », more came from elsewhere);
	 * « En Autre » writes the whole balance off, so forgotten spends never vanish from the totals.
	 */
	let counting = $state(false);
	let counted = $state('');
	let field = $state<HTMLInputElement | null>(null);

	const due = $derived(walletNeedsCheck());
	const balance = $derived(shownCashBalance());

	function confirm() {
		const undo = confirmWalletBalance();
		showSuccess(`Porte-monnaie vérifié : ${sensitiveEUR(balance)} en liquide`, 'Annuler', undo);
	}

	function startCounting() {
		counting = true;
		counted = '';
		void tick().then(() => field?.focus());
	}

	function saveCount() {
		const text = counted.replace(/\s/g, '').replace(',', '.');
		const v = Number(text);
		if (!text || !(v >= 0) || v >= 1_000_000) return;
		const gap = Math.round((balance - v) * 100) / 100;
		const undo = confirmWalletBalance(undefined, v);
		counting = false;
		showSuccess(gap > 0 ? `${sensitiveEUR(gap)} comptés en « Liquide non détaillé », ${sensitiveEUR(v)} en liquide` : `Porte-monnaie mis à jour : ${sensitiveEUR(v)} en liquide`, 'Annuler', undo);
	}

	function writeOff() {
		const r = writeOffCash();
		if (r) showSuccess(`${sensitiveEUR(r.amount)} comptés en « Liquide non détaillé » (Autre)`, 'Annuler', r.undo);
	}

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			saveCount();
		} else if (e.key === 'Escape') {
			counting = false;
		}
	}
</script>

{#if due}
	<div class="meta-xs flex flex-wrap items-center gap-1.5" role="group" aria-label="Vérifier le porte-monnaie">
		<span title="Aucune saisie en liquide depuis 30 jours : des dépenses oubliées ?">Encore <span class="tabular">{sensitiveEUR(balance)}</span> en liquide ?</span>
		{#if counting}
			<input bind:this={field} type="text" inputmode="decimal" class="input-surface tabular w-16 text-right" placeholder="0" aria-label="Liquide en main (€)" bind:value={counted} onkeydown={onKey} />
			<span>€</span>
			<button type="button" class="chip chip-accent cursor-pointer" onclick={saveCount}>OK</button>
		{:else}
			<button type="button" class="chip chip-muted cursor-pointer" onclick={confirm}>Oui</button>
			<button type="button" class="chip chip-muted cursor-pointer" onclick={startCounting} title="Indique ce que tu as vraiment : l'écart compte en « Liquide non détaillé »">J'ai…</button>
			<button type="button" class="chip chip-muted cursor-pointer" onclick={writeOff} title="Tout passer en « Liquide non détaillé » (Autre) : rien ne disparaît des totaux">En Autre</button>
		{/if}
	</div>
{/if}
