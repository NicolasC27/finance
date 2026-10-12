<script lang="ts">
	import type { Transaction } from '$lib/types';
	import { isPlannedInstalment } from '$lib/data';

	/** « 2/3 » of a payment in several times, « · à venir » while the instalment waits for its date. */
	let { tx, class: cls = '' }: { tx: Transaction; class?: string } = $props();
	const planned = $derived(isPlannedInstalment(tx));
</script>

{#if tx.instalment}
	<span class="chip chip-muted {cls}" title="Paiement en {tx.instalment.of} fois : échéance {tx.instalment.n} sur {tx.instalment.of}{planned ? ', comptée à sa date ou quand la banque la prélève' : ''}">{tx.instalment.n}/{tx.instalment.of}{planned ? ' · à venir' : ''}</span>
{/if}
