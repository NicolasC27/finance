<script lang="ts">
	import { formatDate, formatEUR } from '$lib/format';
	import { getRefundStatuses, getTotalOwed, refundsState, setClaimClosed, setDueDays } from '$lib/refunds.svelte';
	import { uiState } from '$lib/ui.svelte';
	import { navigate } from '$lib/router.svelte';

	/**
	 * « À recevoir » (dashboard): refunds still expected — total owed, overdue ones first, each with
	 * who pays and what already came back; one click closes a claim or opens its operation.
	 */
	let { showSettings = true }: { showSettings?: boolean } = $props();

	const open = $derived(getRefundStatuses().filter((s) => s.state !== 'refunded' && s.state !== 'closed').sort((a, b) => (a.state === 'overdue' ? 0 : 1) - (b.state === 'overdue' ? 0 : 1) || a.claim.date.localeCompare(b.claim.date)));
	const overdue = $derived(open.filter((s) => s.state === 'overdue').length);
	const total = $derived(getTotalOwed());

	function show(date: string) {
		uiState.txFilter = { from: date, to: date };
		navigate('/transactions');
	}
</script>

<div class="flex items-baseline justify-between gap-3">
	<h2 class="label-xs">À recevoir</h2>
	{#if overdue}<span class="chip chip-amber">{overdue} en retard</span>{/if}
</div>
{#if open.length === 0}
	<p class="meta-xs mt-2">Aucun remboursement attendu. Les consultations sont suivies toutes seules ; pour une avance ou un retour : détail de l'opération › « À rembourser ».</p>
{:else}
	<p class="amount-md tabular mt-1.5">{formatEUR(total)}</p>
	<ul class="mt-2 divide-y divide-[var(--border-subtle)] text-[13px]">
		{#each open.slice(0, 6) as s (s.claim.expenseKey)}
			<li class="flex items-center gap-2 py-1.5">
				<button type="button" class="min-w-0 flex-1 cursor-pointer truncate text-left hover:underline" title="Voir l'opération" onclick={() => show(s.claim.date)}>{s.claim.who}</button>
				<span class="meta-xs tabular shrink-0">{formatDate(s.claim.date)}</span>
				<span class="tabular shrink-0" style={s.state === 'overdue' ? 'color: var(--amber);' : ''}>{formatEUR(s.remaining)}</span>
				<button type="button" class="meta-xs shrink-0 cursor-pointer hover:underline" title="Ce qui manque ne viendra pas" onclick={() => setClaimClosed(s.claim.expenseKey, true)}>soldé</button>
			</li>
		{/each}
	</ul>
	{#if open.length > 6}<p class="meta-xs mt-1">et {open.length - 6} autre{open.length - 6 > 1 ? 's' : ''}</p>{/if}
{/if}
{#if showSettings}
	<label class="meta-xs mt-2 flex items-center gap-1.5">
		Alerte après
		<input type="text" inputmode="numeric" class="input-surface tabular w-12 !px-1.5 !py-0.5 text-right text-xs" value={String(refundsState.dueDays)} aria-label="Jours avant l'alerte" onchange={(e) => setDueDays(Number((e.target as HTMLInputElement).value))} />
		jours sans remboursement
	</label>
{/if}
