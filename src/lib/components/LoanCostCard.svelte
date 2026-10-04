<script module lang="ts">
	import type { BlockElement, BlockShow } from '$lib/layoutModel';

	/** Optional parts of the card, hideable from its Patrimoine block. */
	export const CREDIT_ELEMENTS: BlockElement[] = [
		{ id: 'reglages', label: 'Reste dû, échéance et taux' },
		{ id: 'synthese', label: 'Reste à payer et intérêts' },
		{ id: 'barre', label: 'Barre capital / intérêts' },
		{ id: 'historique', label: 'Échéances déjà payées' },
		{ id: 'simulation', label: 'Simulation de remboursement anticipé' }
	];
</script>

<script lang="ts">
	import { formatEURCompact as formatEUR } from '$lib/format';
	import { livretARate } from '$lib/inflation';
	import { simulateEarlyRepayment } from '$lib/loanCost';
	import { getLoanCosts, installmentMonth } from '$lib/loanCosts.svelte';
	import { setLoanSetting } from '$lib/financeSettings.svelte';

	/**
	 * Real cost of loans: payment made (current account), principal part (loan account), hence
	 * interest and rate, found in the statements and correctable. Remaining interest, end date, what
	 * has already been paid, and an early-repayment simulation (statutory penalty included).
	 */

	/** `show` comes from the block: parts the user unticked are not rendered. */
	let { show = () => true }: { show?: BlockShow } = $props();

	const SHORT_MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
	const loans = $derived(getLoanCosts());

	/** Simulated amount per loan (empty = the whole principal). */
	let amounts = $state<Record<string, string>>({});
	const toNumber = (v: string) => Number(v.replace(/[\s  €%]/g, '').replace(',', '.'));
	const monthLabel = (iso: string) => `${SHORT_MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
	const pct = (n: number) => `${n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %`;
	const livretRate = livretARate(new Date().toISOString().slice(0, 10)).taux;

	function saveField(id: string, field: 'taux' | 'echeance' | 'capital', raw: string) {
		const v = toNumber(raw);
		setLoanSetting(id, { [field]: raw.trim() === '' || !(v > 0) ? undefined : v });
	}
</script>

<div class="mb-2 flex items-baseline justify-between gap-3">
	<h2 class="label-xs">Coût réel des crédits</h2>
	<span class="meta-xs">intérêts trouvés dans tes relevés</span>
</div>

{#each loans as c (c.v.accountId)}
	{@const sim = c.p ? simulateEarlyRepayment(c.p, amounts[c.v.accountId]?.trim() ? toNumber(amounts[c.v.accountId]!) : c.capital) : null}
	<div class="border-t pt-2 first-of-type:border-t-0 first-of-type:pt-0" style="border-color: var(--border-subtle);">
		<p class="text-[13px] font-medium">{c.v.label.replace(/\s+(M|MME|MLLE|MR)\s+.*$/i, '').trim() || 'Crédit'}</p>
		{#if show('reglages')}
		<div class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
			<label class="flex items-center gap-1">
				reste dû
				<input type="text" inputmode="decimal" class="input-surface tabular w-20 !px-1.5 !py-0.5 text-right text-xs" value={String(Math.round(c.capital * 100) / 100).replace('.', ',')} aria-label="Capital restant dû (€)" title="Solde du compte de crédit, estimé à aujourd'hui — corrigeable (vide = relevés)" onchange={(e) => saveField(c.v.accountId, 'capital', (e.target as HTMLInputElement).value)} />
				€
			</label>
			<label class="flex items-center gap-1">
				échéance
				<input type="text" inputmode="decimal" class="input-surface tabular w-16 !px-1.5 !py-0.5 text-right text-xs" value={String(c.mensualite).replace('.', ',')} aria-label="Échéance mensuelle (€)" title={c.echeanceReleve !== null ? `Prélevée sur ton compte courant (${c.echeances.length} échéances vues) — corrigeable` : 'Échéance introuvable dans les relevés : saisis celle de ton contrat'} onchange={(e) => saveField(c.v.accountId, 'echeance', (e.target as HTMLInputElement).value)} />
				€/mois
			</label>
			<label class="flex items-center gap-1">
				taux
				<input type="text" inputmode="decimal" class="input-surface tabular w-14 !px-1.5 !py-0.5 text-right text-xs" value={c.taux !== null ? String(c.taux).replace('.', ',') : ''} placeholder="?" aria-label="Taux annuel du crédit (%)" title={c.tauxReleve !== null ? 'Déduit des relevés : intérêts = échéance − capital remboursé, rapportés au capital dû (assurance comprise si prélevée avec l’échéance)' : 'Saisis le taux de ton contrat'} onchange={(e) => saveField(c.v.accountId, 'taux', (e.target as HTMLInputElement).value)} />
				%
			</label>
			{#if Object.keys(c.reglage).length}
				<button type="button" class="meta-xs cursor-pointer hover:underline" onclick={() => setLoanSetting(c.v.accountId, { taux: undefined, echeance: undefined, capital: undefined })}>↺ relevés</button>
			{/if}
		</div>
		{/if}

		{#if !c.p}
			<p class="meta-xs mt-1.5" style="color: var(--amber);">Taux introuvable dans les relevés : saisis celui de ton contrat pour voir le coût du crédit.</p>
		{:else if !c.cout}
			<p class="meta-xs mt-1.5" style="color: var(--amber);">Avec ces chiffres, l'échéance ne couvre pas les intérêts : vérifie le taux et l'échéance.</p>
		{:else}
			{@const part = c.capital / c.cout.total}
			{#if show('synthese')}
			<p class="mt-2 text-[13px]">
				Encore <b class="tabular">{formatEUR(c.cout.total)}</b> à payer d'ici {monthLabel(installmentMonth(c, c.cout.echeances))} ({c.cout.echeances} échéances), dont
				<b class="tabular" style="color: var(--amber);">{formatEUR(c.cout.interets)}</b> d'intérêts.
			</p>
			{/if}
			{#if show('barre')}
			<div class="mt-1.5 flex h-1.5 overflow-hidden rounded-full" role="img" aria-label="Capital {Math.round(part * 100)} %, intérêts {100 - Math.round(part * 100)} %">
				<div style="width: {part * 100}%; background-color: var(--accent);"></div>
				<div class="ml-0.5 flex-1" style="background-color: var(--amber);"></div>
			</div>
			<p class="meta-xs mt-1 flex gap-3">
				<span><span class="mr-1 inline-block h-2 w-2 rounded-full align-middle" style="background-color: var(--accent);"></span>capital {formatEUR(c.capital)}</span>
				<span><span class="mr-1 inline-block h-2 w-2 rounded-full align-middle" style="background-color: var(--amber);"></span>intérêts {formatEUR(c.cout.interets)}</span>
			</p>
			{/if}
			{#if show('historique') && c.origine !== null && c.interetsPayes !== null && c.payees.length}
				<p class="meta-xs mt-1.5">
					Depuis {monthLabel(c.payees[0]!.date)} : {c.payees.length} échéances, {formatEUR(c.paye)} payés dont ≈ {formatEUR(c.interetsPayes)} d'intérêts (crédit d'origine ≈ {formatEUR(Math.round(c.origine / 10) * 10)}).
				</p>
			{/if}

			{#if show('simulation')}
			<div class="mt-2 rounded-lg border p-2.5 text-[12px]" style="border-color: var(--border-subtle);">
				<label class="flex flex-wrap items-center gap-1">
					Rembourser maintenant
					<input type="text" inputmode="decimal" class="input-surface tabular w-20 !px-1.5 !py-0.5 text-right text-xs" placeholder={String(Math.round(c.capital))} value={amounts[c.v.accountId] ?? ''} aria-label="Montant du remboursement anticipé (€)" oninput={(e) => (amounts = { ...amounts, [c.v.accountId]: (e.target as HTMLInputElement).value })} />
					€ <span class="meta-xs">(vide = tout)</span>
				</label>
				{#if sim}
					<p class="mt-1.5">
						→ <b class="tabular" style="color: var(--accent);">{formatEUR(sim.gain)}</b> d'intérêts économisés{#if sim.echeancesApres === 0}, crédit soldé{:else}, {sim.echeancesEnMoins} échéance{sim.echeancesEnMoins > 1 ? 's' : ''} en moins (fin en {monthLabel(installmentMonth(c, sim.echeancesApres))}){/if}.
						<span class="meta-xs">{sim.indemnite > 0 ? `Indemnité de remboursement anticipé : ${formatEUR(sim.indemnite)} (déduite).` : 'Aucune indemnité : moins de 10 000 € remboursés sur 12 mois (crédit à la consommation).'}</span>
					</p>
					<p class="meta-xs mt-1">Pour comparer : ce crédit coûte {pct(c.taux!)} par an, le Livret A rapporte {pct(livretRate)}. Un calcul sur tes chiffres, pas un conseil : vérifie les conditions de ton contrat.</p>
				{/if}
			</div>
			{/if}
		{/if}
	</div>
{/each}
