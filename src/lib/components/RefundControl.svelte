<script lang="ts">
	import type { Transaction } from '$lib/types';
	import { signedAmount } from '$lib/data';
	import { formatDate, formatEUR } from '$lib/format';
	import { txKey } from '$lib/categories';
	import { addClaim, refundedBy, refundOf, removeClaim, setClaimClosed } from '$lib/refunds.svelte';
	import { shareRange, type RefundSource } from '$lib/refunds';

	/**
	 * Refund section of an operation's detail: for an expense, the expected refund (automatic for a
	 * health visit) with what already came back, or a short form to mark it « à rembourser »; for an
	 * incoming credit, the expenses it pays back.
	 */
	let { tx }: { tx: Transaction } = $props();

	const amount = $derived(signedAmount(tx));
	const key = $derived(txKey(tx));
	const status = $derived(amount < 0 ? refundOf(key) : undefined);
	const pays = $derived(amount > 0 ? refundedBy(key) : []);
	let editing = $state(false);
	let source = $state<RefundSource>('personne');
	let who = $state('');
	let expected = $state('');
	let shared = $state(false);

	const STATES = { pending: 'attendu', partial: 'en partie remboursé', refunded: 'remboursé', overdue: 'en retard', closed: 'soldé à la main' } as const;
	const SOURCES: { id: RefundSource; label: string }[] = [
		{ id: 'sante', label: 'Sécu + mutuelle' },
		{ id: 'personne', label: 'Une personne' },
		{ id: 'magasin', label: 'Le magasin' }
	];

	function open() {
		source = status?.claim.source ?? 'personne';
		who = status?.claim.source === 'sante' ? '' : (status?.claim.who ?? '');
		expected = String(status?.claim.expected ?? Math.abs(amount)).replace('.', ',');
		shared = status ? !!status.claim.shared : tx.source === 'portage';
		editing = true;
	}
	function save() {
		const v = Number(expected.replace(/\s/g, '').replace(',', '.'));
		if (!(v > 0) || (tx.source === 'portage' && source !== 'sante' && !who.trim())) return;
		addClaim(tx, { source, who, expected: v, shared });
		editing = false;
	}
</script>

{#if amount < 0 || pays.length}
	<div class="mt-3 border-t pt-3 text-sm" style="border-color: var(--border-subtle);" role="group" aria-label="Remboursement">
		{#if pays.length}
			<p class="meta-xs">Remboursement de :</p>
			<ul class="mt-1 space-y-0.5">
				{#each pays as s (s.claim.expenseKey)}
					{@const part = s.payments.find((p) => p.key === key)}
					<li class="flex items-center gap-2"><span class="chip chip-accent">remboursement</span> dépense du {formatDate(s.claim.date)} ({s.claim.who}) · {formatEUR(part?.amount ?? 0)}</li>
				{/each}
			</ul>
		{:else if editing}
			<div class="flex flex-wrap items-center gap-2" onclick={(e) => e.stopPropagation()} role="presentation">
				<span class="meta-xs">À rembourser</span>
				<input type="text" inputmode="decimal" class="input-surface tabular w-20 text-right" bind:value={expected} aria-label="Montant attendu (€)" />
				<span class="meta-xs">€ par</span>
				<select class="input-surface" bind:value={source} aria-label="Qui rembourse">
					{#each SOURCES as s (s.id)}<option value={s.id}>{s.label}</option>{/each}
				</select>
				{#if source !== 'sante'}<input type="text" class="input-surface w-36" placeholder={source === 'personne' ? 'Nom de la personne' : 'Magasin'} bind:value={who} aria-label="Nom" />{/if}
				{#if source === 'personne'}<label class="meta-xs flex cursor-pointer items-center gap-1" title="Elle te rend sa part : un virement de 40 % à 110 % de la dépense la solde"><input type="checkbox" bind:checked={shared} /> partagée</label>{/if}
				<button type="button" class="btn btn-primary btn-sm" onclick={save}>Enregistrer</button>
				<button type="button" class="btn btn-secondary btn-sm" onclick={() => (editing = false)}>Annuler</button>
			</div>
		{:else if status}
			<div class="flex flex-wrap items-center gap-2">
				<span class="chip {status.state === 'refunded' ? 'chip-accent' : status.state === 'overdue' ? 'chip-amber' : 'chip-outline'}">{STATES[status.state]}</span>
				{#if status.claim.shared}
					{@const range = shareRange(status.claim.expected)}
					<span>{status.state === 'refunded' ? `${formatEUR(status.refunded)} reçus de ${status.claim.who}` : `part attendue de ${status.claim.who} : ${formatEUR(range.min)} à ${formatEUR(range.max)}`} · dépense partagée</span>
				{:else}
					<span>{formatEUR(status.refunded)} reçus sur {formatEUR(status.claim.expected)} attendus de {status.claim.who}{status.claim.auto ? ' (automatique)' : ''}</span>
				{/if}
				{#each status.payments as p (p.key)}<span class="meta-xs">· {formatDate(p.date)} {formatEUR(p.amount)}</span>{/each}
				<span class="flex-1"></span>
				<button type="button" class="meta-xs cursor-pointer hover:underline" onclick={(e) => { e.stopPropagation(); open(); }}>modifier</button>
				{#if status.state !== 'refunded'}<button type="button" class="meta-xs cursor-pointer hover:underline" onclick={(e) => { e.stopPropagation(); setClaimClosed(key, status.state !== 'closed'); }}>{status.state === 'closed' ? 'rouvrir' : 'soldé'}</button>{/if}
				<button type="button" class="meta-xs cursor-pointer hover:underline" onclick={(e) => { e.stopPropagation(); removeClaim(key); }}>rien à attendre</button>
			</div>
		{:else}
			<button type="button" class="btn btn-secondary btn-sm" onclick={(e) => { e.stopPropagation(); open(); }}>À rembourser…</button>
			<span class="meta-xs ml-2">Sécu, mutuelle, une avance à quelqu'un, un retour en magasin</span>
		{/if}
	</div>
{/if}
