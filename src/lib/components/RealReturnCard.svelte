<script module lang="ts">
	import type { BlockElement, BlockShow } from '$lib/layoutModel';

	/** Optional parts of the card, hideable from its Patrimoine block. */
	export const REAL_RETURN_ELEMENTS: BlockElement[] = [
		{ id: 'phrase', label: 'Phrase de synthèse' },
		{ id: 'tableau', label: 'Tableau des placements' },
		{ id: 'crypto', label: "Crypto corrigée de l'inflation" },
		{ id: 'livret', label: 'Livret A depuis 2020' },
		{ id: 'methode', label: 'Méthode de calcul' }
	];
</script>

<script lang="ts">
	import { getKrakenPerformance } from '$lib/wealth.svelte';
	import { getInvestments } from '$lib/investments.svelte';
	import { getTransactions } from '$lib/store.svelte';
	import { signedAmount } from '$lib/data';
	import { formatEURCompact as formatEUR } from '$lib/sensitiveFormat';
	import { priceFactor, RECENT_INFLATION, LIVRET_A_SOURCE, livretARate } from '$lib/inflation';
	import { returnSummary, cryptoRealReturn } from '$lib/realReturn';
	import { setInvestmentRate } from '$lib/financeSettings.svelte';

	/**
	 * Real return on savings: what each investment earns (or loses) once inflation is deducted, in %
	 * and in euros of purchasing power per year. Rates found automatically (regulated Livret
	 * A/LDDS/Livret bleu, the year's performance of Natixis funds), editable; crypto separately
	 * (historical gain adjusted for inflation).
	 */

	/** `show` comes from the block: parts the user unticked are not rendered. */
	let { show = () => true }: { show?: BlockShow } = $props();

	const today = new Date().toISOString().slice(0, 10);
	const SHORT_MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
	const inflation = RECENT_INFLATION.taux;

	const investments = $derived(getInvestments());

	const summary = $derived(returnSummary(investments, inflation));
	const byId = $derived(new Map(investments.map((p) => [p.id, p])));

	/**
	 * Crypto: gain since the first contributions, adjusted for inflation (contributions revalued at
	 * their average date).
	 */
	const crypto = $derived.by(() => {
		const perf = getKrakenPerformance();
		if (!perf) return null;
		const flows = getTransactions()
			.filter((tx) => tx.account === 'kraken' && /\b(DEPOSIT|WITHDRAWAL|VIREMENT|SPEND)\b/.test(tx.remittance_information.join(' ').toUpperCase()))
			.map((tx) => ({ date: tx.booking_date, montant: signedAmount(tx) }));
		const r = cryptoRealReturn(perf.invested, perf.withdrawn, perf.value, flows, today);
		return r ? { ...r, depuis: perf.since.slice(0, 4) } : null;
	});

	/** 100 € put on a Livret A on 1 January 2020: interest and purchasing power today. */
	const livretSince2020 = $derived.by(() => {
		let f = 1;
		const end = today.slice(0, 7);
		for (let d = new Date(Date.UTC(2020, 0, 15)); d.toISOString().slice(0, 7) < end; d.setUTCMonth(d.getUTCMonth() + 1)) f *= 1 + livretARate(d.toISOString().slice(0, 10)).taux / 1200;
		const prices = priceFactor('2020-01-01', today);
		return { interets: (f - 1) * 100, prix: (prices - 1) * 100, reel: (f / prices - 1) * 100 };
	});

	const pct = (n: number, d = 1) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d })} %`;
	const euros = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${formatEUR(Math.abs(n))}`;
	const recentMonth = `${SHORT_MONTHS[Number(RECENT_INFLATION.mois.slice(5, 7)) - 1]} ${RECENT_INFLATION.mois.slice(0, 4)}`;

	function setRate(id: string, raw: string) {
		const v = Number(raw.replace(/\s|%/g, '').replace(',', '.'));
		setInvestmentRate(id, raw.trim() === '' || !Number.isFinite(v) ? null : v);
	}
</script>

<div class="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
	<h2 class="label-xs">Rendement réel de ton épargne</h2>
	<p class="meta-xs">inflation sur un an : <b class="tabular">{pct(inflation)}</b> ({recentMonth})</p>
</div>

{#if summary.lignes.length === 0}
	<p class="meta-xs">Aucun compte ni livret avec un solde : importe un relevé pour voir ce que ton épargne gagne face à l'inflation.</p>
{:else}
	{#if show('phrase')}
	<p class="text-[13px]">
		Au rythme actuel des prix, ton épargne {summary.gainReelAn >= 0 ? 'gagne' : 'perd'}
		<b class="tabular" style="color: {summary.gainReelAn >= 0 ? 'var(--accent)' : 'var(--amber)'};">≈ {formatEUR(Math.abs(summary.gainReelAn))}</b>
		de pouvoir d'achat par an ({pct(summary.reelMoyen)} une fois l'inflation déduite, pour {pct(summary.tauxMoyen, 2).replace('+', '')} de rendement moyen).
	</p>
	{/if}
	{#if show('tableau')}
	<div class="mt-2 overflow-x-auto">
		<table class="w-full min-w-[420px] text-[13px]">
			<thead>
				<tr class="meta-xs text-left">
					<th class="pb-1 font-normal">Placement</th>
					<th class="pb-1 text-right font-normal">Montant</th>
					<th class="pb-1 text-right font-normal" title="Rendement nominal annuel (modifiable)">Rendement</th>
					<th class="pb-1 text-right font-normal" title="Rendement corrigé de l'inflation">Réel</th>
					<th class="pb-1 text-right font-normal" title="Pouvoir d'achat gagné ou perdu par an">Par an</th>
				</tr>
			</thead>
			<tbody class="divide-y divide-[var(--border-subtle)]">
				{#each summary.lignes as l (l.id)}
					{@const p = byId.get(l.id)}
					<tr>
						<td class="py-1">
							<span class="font-medium">{l.label}</span>
							<span class="meta-xs block {p?.aSaisir ? 'text-[var(--amber)]' : ''}">{l.source}</span>
						</td>
						<td class="tabular py-1 text-right">{formatEUR(l.montant)}</td>
						<td class="py-1 text-right whitespace-nowrap">
							<input
								type="text"
								inputmode="decimal"
								class="input-surface tabular w-14 !px-1.5 !py-0.5 text-right text-xs"
								value={String(l.taux).replace('.', ',')}
								aria-label="Rendement annuel de {l.label} (%)"
								title="Corrige le taux si besoin : ta saisie est mémorisée (vide = taux trouvé tout seul)"
								onchange={(e) => setRate(l.id, (e.target as HTMLInputElement).value)}
							/>
							<span class="meta-xs">%</span>
							{#if p?.saisi}<button type="button" class="meta-xs cursor-pointer hover:underline" title="Revenir au taux trouvé tout seul" onclick={() => setInvestmentRate(l.id, null)}>↺</button>{/if}
						</td>
						<td class="tabular py-1 text-right">{pct(l.reel)}</td>
						<td class="tabular py-1 text-right font-medium" style="color: {l.gainReelAn >= 0 ? 'var(--accent)' : 'var(--amber)'};">{euros(l.gainReelAn)}</td>
					</tr>
				{/each}
			</tbody>
			{#if summary.lignes.length > 1}
				<tfoot>
					<tr class="border-t" style="border-color: var(--border);">
						<td class="pt-1.5 font-medium">Total</td>
						<td class="tabular pt-1.5 text-right font-medium">{formatEUR(summary.total)}</td>
						<td class="tabular pt-1.5 text-right">{pct(summary.tauxMoyen, 2).replace('+', '')}</td>
						<td class="tabular pt-1.5 text-right">{pct(summary.reelMoyen)}</td>
						<td class="tabular pt-1.5 text-right font-medium" style="color: {summary.gainReelAn >= 0 ? 'var(--accent)' : 'var(--amber)'};">{euros(summary.gainReelAn)}</td>
					</tr>
				</tfoot>
			{/if}
		</table>
	</div>
	{/if}
{/if}

{#if (crypto && show('crypto')) || show('livret') || show('methode')}
<ul class="meta-xs mt-2.5 space-y-1">
	{#if crypto && show('crypto')}
		<li>
			<span class="font-medium" style="color: var(--text);">Crypto</span> : {pct(crypto.gainPct)} depuis {crypto.depuis} ({euros(crypto.gain)}) ; les prix ont pris {pct(crypto.inflation)} depuis tes apports, soit
			<b class="tabular" style="color: {crypto.gainReel >= 0 ? 'var(--accent)' : 'var(--amber)'};">{pct(crypto.gainReelPct)}</b> en euros d'aujourd'hui ({euros(crypto.gainReel)}).
		</li>
	{/if}
	{#if show('livret')}
	<li>
		Livret A depuis 2020 : {pct(livretSince2020.interets)} d'intérêts, mais les prix ont pris {pct(livretSince2020.prix)} : {pct(livretSince2020.reel)} de pouvoir d'achat.
		<a class="hover:underline" href={LIVRET_A_SOURCE} target="_blank" rel="noopener noreferrer">(historique des taux)</a>
	</li>
	{/if}
	{#if show('methode')}
	<li>Réel = (1 + rendement) ÷ (1 + inflation) − 1, inflation sur un an de l'INSEE. Pas un conseil en placement : un calcul sur tes chiffres.</li>
	{/if}
</ul>
{/if}
