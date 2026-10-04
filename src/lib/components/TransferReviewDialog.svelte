<script lang="ts">
	import type { Transaction } from '$lib/types';
	import { txKey } from '$lib/categories';
	import { getTransactions } from '$lib/store.svelte';
	import { accountLabel } from '$lib/accounts.svelte';
	import { merchantLabel } from '$lib/merchant';
	import { formatEUR } from '$lib/format';
	import { modal } from '$lib/actions/modal';
	import { getUndecidedPairs, getUndecidedNotes, resolveReviewSelection, closeReview } from '$lib/transfers.svelte';
	import { pairKeys, transferTarget, type TransferPair } from '$lib/transfers';

	/**
	 * 'Virements internes détectés' dialog (SPEC v13 §C.2): opened ONCE per detection batch
	 * (load/import) when undecided pairs exist. Decision ROW BY ROW: checked = hidden from totals
	 * (budget/donut/forecast/report/insights), unchecked = kept (remembered, never offered again).
	 * 'Plus tard' and Escape close without deciding. Shared dialog keyboard handling: use:modal action
	 * (focus, Tab loop).
	 */

	/** Transactions indexed by key (pair resolution). */
	const byKey = $derived.by(() => {
		const map = new Map<string, Transaction>();
		for (const tx of getTransactions()) map.set(txKey(tx), tx);
		return map;
	});

	const pairs = $derived(getUndecidedPairs());
	const notes = $derived(getUndecidedNotes());

	/** Stable identifier of a pair (joined keys). */
	const pairId = (pair: TransferPair): string => pairKeys(pair).join('|');

	/** UNCHECKED pairs (kept in the budget); everything is checked by default. */
	let kept = $state<Record<string, boolean>>({});
	const checkedCount = $derived(pairs.filter((p) => !kept[pairId(p)]).length);

	/** Short day + month ('6 juil.') for the list. */
	const dayMonthFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });
	function shortDate(iso: string): string {
		return iso ? dayMonthFmt.format(new Date(`${iso}T12:00:00`)) : '';
	}

	/** 'Representative' side of a pair: debit first, credit otherwise. */
	function sideTx(pair: TransferPair): Transaction | undefined {
		return byKey.get(pair.debitKey) ?? byKey.get(pair.creditKey);
	}

	/** Opposite side (target account of the transfer). */
	function otherTx(pair: TransferPair): Transaction | undefined {
		return byKey.get(pair.creditKey) ?? byKey.get(pair.debitKey);
	}

	/** Readable target: 'Kraken' when named, otherwise the label of the other account. */
	function targetLabel(pair: TransferPair): string {
		const tx = sideTx(pair);
		const other = otherTx(pair);
		if (tx && transferTarget(tx) === 'Kraken') return 'Kraken';
		if (other && other !== tx && other.account) return accountLabel(other.account);
		return 'un autre compte';
	}

	/** Short label of a pair: merchantLabel, otherwise the raw label ('Vir' alone says nothing). */
	function pairLabel(pair: TransferPair): string {
		const tx = sideTx(pair);
		if (!tx) return 'Virement';
		const short = merchantLabel(tx.remittance_information);
		return short.length >= 4 ? short : tx.remittance_information.join(' ');
	}

	/** Checks / unchecks every row. */
	function setAll(checked: boolean) {
		kept = checked ? {} : Object.fromEntries(pairs.map((p) => [pairId(p), true]));
	}

	/** Applies the selection: checked → hidden, unchecked → kept. */
	function apply() {
		const hide: string[] = [];
		const keep: string[] = [];
		for (const pair of pairs) (kept[pairId(pair)] ? keep : hide).push(...pairKeys(pair));
		resolveReviewSelection(hide, keep);
	}
</script>

<!-- Overlay: dimmed background, centred panel, 200 ms entrance (custom modal style) -->
<div class="transfer-overlay fixed inset-0 z-50 flex items-center justify-center p-4" role="presentation">
	<div
		class="transfer-panel flex max-h-[90vh] w-full max-w-[560px] flex-col overflow-hidden rounded-lg border"
		style="border-color: var(--hairline); background-color: var(--surface);"
		role="dialog"
		aria-modal="true"
		aria-labelledby="transfer-review-title"
		use:modal={{ onEscape: closeReview }}
	>
		<header class="shrink-0 border-b px-5 py-3" style="border-color: var(--border-subtle);">
			<h2 id="transfer-review-title" class="serif text-xl">Virements internes détectés</h2>
		</header>

		<div class="min-h-0 flex-1 overflow-y-auto px-5 py-4">
			<p class="text-sm leading-relaxed">
				{pairs.length} virement{pairs.length > 1 ? 's' : ''} entre vos comptes détecté{pairs.length > 1 ? 's' : ''}.
				Cochez ceux à masquer du budget.
			</p>
			{#each notes as note (note.target)}
				<p class="meta-xs mt-1.5" style="color: var(--text-2);">
					dont un virement régulier vers {note.target} (≈ {formatEUR(note.monthly)}/mois)
				</p>
			{/each}
			<p class="meta-xs mt-2">
				Masqués, ils sortent des totaux (dépenses, revenus, prévisions, rapport) mais restent comptés dans
				les soldes de vos comptes. Décochés, ils restent dans le budget (choix mémorisé).
			</p>

			<div class="mt-3 flex items-center justify-between gap-3">
				<span class="label-xs">{checkedCount} / {pairs.length} à masquer</span>
				<button
					type="button"
					class="cursor-pointer text-xs font-medium hover:underline"
					style="color: var(--accent);"
					onclick={() => setAll(checkedCount < pairs.length)}
				>
					{checkedCount < pairs.length ? 'Tout cocher' : 'Tout décocher'}
				</button>
			</div>

			<!-- List of the transfers concerned: one checkbox per row (checked = hidden) -->
			<ul class="mt-1.5 divide-y text-sm" style="border-color: var(--border-subtle);">
				{#each pairs as pair (pairId(pair))}
					{@const tx = sideTx(pair)}
					{@const id = pairId(pair)}
					<li style="border-color: var(--border-subtle);">
						<label class="flex cursor-pointer items-baseline gap-3 py-1.5">
							<input
								type="checkbox"
								class="shrink-0 translate-y-0.5 cursor-pointer"
								style="accent-color: var(--accent);"
								checked={!kept[id]}
								onchange={(e) => (kept = { ...kept, [id]: !e.currentTarget.checked })}
								aria-label="Masquer du budget : {pairLabel(pair)}, {formatEUR(pair.amount)}"
							/>
							<span class="tabular w-14 shrink-0 text-secondary">{tx ? shortDate(tx.booking_date) : '—'}</span>
							<span class="min-w-0 flex-1 truncate" title={tx ? tx.remittance_information.join(' ') : ''}>
								{pairLabel(pair)}
								<span class="meta-xs">{pair.debitKey ? '→' : '←'} {targetLabel(pair)}</span>
							</span>
							<span class="tabular shrink-0 font-medium">{formatEUR(pair.amount)}</span>
						</label>
					</li>
				{/each}
			</ul>
		</div>

		<footer class="flex shrink-0 flex-wrap items-center justify-end gap-3 border-t px-5 py-3" style="border-color: var(--border-subtle);">
			<button type="button" class="btn btn-secondary" onclick={closeReview} title="Fermer sans rien décider (Échap)">Plus tard</button>
			<button type="button" class="btn btn-primary" data-autofocus onclick={apply}>
				{checkedCount === 0 ? 'Tout garder' : `Masquer la sélection (${checkedCount})`}
			</button>
		</footer>
	</div>
</div>

<style>
	.transfer-overlay {
		background-color: rgba(0, 0, 0, 0.5);
		animation: transfer-fade 200ms ease-out backwards;
	}

	.transfer-panel {
		animation: transfer-pop 200ms cubic-bezier(0.2, 0.6, 0.2, 1) backwards;
		box-shadow: var(--shadow-soft);
	}

	@keyframes transfer-fade {
		from {
			opacity: 0;
		}
	}

	@keyframes transfer-pop {
		from {
			opacity: 0;
			transform: translateY(6px);
		}
	}
</style>
