<script module lang="ts">
	import type { BlockElement, BlockShow } from '$lib/layoutModel';

	/** Optional parts of the card, hideable from its Patrimoine block. */
	export const TAX_ELEMENTS: BlockElement[] = [
		{ id: 'provision', label: 'Détail de la provision' },
		{ id: 'avis', label: "Tableau des avis d'impôt" },
		{ id: 'details', label: 'Plus-values déclarées et RFR' },
		{ id: 'preleve', label: "Prélevé l'année suivante" },
		{ id: 'notes', label: 'Notes explicatives' }
	];
</script>

<script lang="ts">
	import { formatEUR, formatDate, formatPct } from '$lib/sensitiveFormat';
	import { parseTaxNoticePdf } from '$lib/pdfTax';
	import { getTaxNotices, saveTaxNotice, removeTaxNotice, getDgfipPaidByYear } from '$lib/taxes.svelte';
	import { getTaxProvisionDetail } from '$lib/wealth.svelte';
	import { showToast } from '$lib/ui.svelte';

	/**
	 * Taxes card (Patrimoine page): taxes still to pay (PFU provision on crypto disposals + unpaid
	 * balance of notices not yet due, deducted from net wealth), imported tax notices (IR, PS, RFR),
	 * and income-tax debits seen on statements (local taxes excluded).
	 */

	/** `show` comes from the block: parts the user unticked are not rendered. */
	let { show = () => true }: { show?: BlockShow } = $props();

	let fileInput = $state<HTMLInputElement | null>(null);
	let importing = $state(false);
	let dragActive = $state(false);
	let message = $state('');

	const notices = $derived(getTaxNotices());
	const paid = $derived(getDgfipPaidByYear());
	const provision = $derived(getTaxProvisionDetail());

	async function handleFiles(list: FileList | File[] | null | undefined) {
		const files = [...(list ?? [])].filter((f) => /\.pdf$/i.test(f.name));
		if (files.length === 0) return;
		importing = true;
		const parts: string[] = [];
		try {
			for (const f of files) {
				const r = await parseTaxNoticePdf(await f.arrayBuffer());
				if ('error' in r) {
					parts.push(`${f.name} : ${r.error}`);
					continue;
				}
				const ok = saveTaxNotice(r);
				parts.push(ok ? `revenus ${r.year}${r.supplementary ? ' (avis supplémentaire)' : ''} : ${formatEUR(r.total)}` : `revenus ${r.year} : avis initial ignoré, un avis supplémentaire est déjà enregistré`);
			}
		} finally {
			importing = false;
		}
		message = parts.join(' · ');
		showToast(`${files.length} avis lu${files.length > 1 ? 's' : ''}`);
	}
</script>

<section
	class="card card-lift hero-in-3 p-4 sm:col-span-2 lg:col-span-12"
	aria-label="Impôts"
	class:ring-1={dragActive}
	ondragover={(e) => {
		if ([...(e.dataTransfer?.types ?? [])].includes('Files')) {
			e.preventDefault();
			dragActive = true;
		}
	}}
	ondragleave={() => (dragActive = false)}
	ondrop={(e) => {
		e.preventDefault();
		dragActive = false;
		void handleFiles(e.dataTransfer?.files);
	}}
>
	<header class="mb-3 flex flex-wrap items-end justify-between gap-3">
		<div>
			<p class="label-xs">Impôts</p>
			{#if provision.total > 0}
				<h2 class="stat-amount mt-1" style="color: var(--amber);">−{formatEUR(provision.total)}</h2>
				<p class="meta-xs mt-1">impôts restant à payer, déduits du patrimoine net</p>
			{:else}
				<h2 class="mt-1 text-sm font-medium">Aucune provision à prévoir</h2>
				<p class="meta-xs mt-1">pas d'impôt crypto ni de reste à payer en attente</p>
			{/if}
		</div>
		<div class="flex items-center gap-2">
			<button type="button" class="btn btn-secondary btn-sm" disabled={importing} onclick={() => fileInput?.click()}>
				{importing ? 'Lecture…' : 'Importer des avis d’impôt (PDF)'}
			</button>
			<input
				bind:this={fileInput}
				type="file"
				accept=".pdf,application/pdf"
				multiple
				class="hidden"
				aria-label="Importer un ou plusieurs avis d'impôt"
				onchange={(e) => {
					void handleFiles((e.target as HTMLInputElement).files);
					(e.target as HTMLInputElement).value = '';
				}}
			/>
		</div>
	</header>

	{#if message}
		<p class="meta-xs mb-3" role="status">{message}</p>
	{/if}

	{#if provision.items.length > 0 && show('provision')}
		<!-- Provision detail: per income year, with its due date -->
		<ul class="mb-3 divide-y divide-[var(--border-subtle)] text-[13px]">
			{#each provision.items as it (`${it.kind}-${it.year}`)}
				<li class="flex flex-wrap items-center gap-x-4 gap-y-0.5 py-1.5">
					{#if it.kind === 'notice'}
						<span class="min-w-0 flex-1">Avis d'impôt sur les revenus {it.year} : reste à payer</span>
					{:else}
						<span class="min-w-0 flex-1">Plus-values crypto {it.year} : <span class="tabular">{formatEUR(it.gain)}</span> × {formatPct(it.rate * 100, 1)}</span>
					{/if}
					<span class="meta-xs">{it.status}</span>
					<span class="tabular w-24 text-right font-medium">{formatEUR(it.tax)}</span>
				</li>
			{/each}
		</ul>
	{/if}

	{#if notices.length > 0}
		{#if show('avis')}
		<div class="overflow-x-auto">
			<table class="w-full min-w-[560px] border-collapse text-[12px]">
				<thead>
					<tr class="text-left">
						<th class="label-plain py-2 pr-3">Revenus</th>
						<th class="label-plain py-2 pr-3 text-right">Impôt sur le revenu</th>
						<th class="label-plain py-2 pr-3 text-right">Prélèvements sociaux</th>
						<th class="label-plain py-2 pr-3 text-right">Total</th>
						{#if show('details')}
							<th class="label-plain py-2 pr-3 text-right" title="Base taxée au taux forfaitaire 12,8 % (plus-values crypto et assimilées)">Plus-values déclarées</th>
							<th class="label-plain py-2 pr-3 text-right" title="Revenu fiscal de référence">RFR</th>
						{/if}
						{#if show('preleve')}
							<th class="label-plain py-2 pr-3 text-right" title="Prélèvements d'impôt sur le revenu (DGFIP, hors taxe foncière et autres impôts locaux) vus sur vos relevés l'année suivant les revenus">Prélevé l'année suivante</th>
						{/if}
						<th class="label-plain py-2"></th>
					</tr>
				</thead>
				<tbody>
					{#each notices as n (n.year)}
						<tr class="border-t" style="border-color: var(--border-subtle);">
							<td class="py-1.5 pr-3 font-medium">{n.year}{#if n.supplementary}<span class="chip chip-muted ml-1" title="Avis supplémentaire ou rectificatif">suppl.</span>{/if}</td>
							<td class="tabular py-1.5 pr-3 text-right">{formatEUR(n.incomeTax)}</td>
							<td class="tabular py-1.5 pr-3 text-right">{formatEUR(n.socialLevies)}</td>
							<td class="tabular py-1.5 pr-3 text-right font-medium">{formatEUR(n.total)}</td>
							{#if show('details')}
								<td class="tabular py-1.5 pr-3 text-right text-secondary">{n.flatTaxBase !== undefined ? formatEUR(n.flatTaxBase) : '—'}</td>
								<td class="tabular py-1.5 pr-3 text-right text-secondary">{n.rfr !== undefined ? formatEUR(n.rfr) : '—'}</td>
							{/if}
							{#if show('preleve')}
								<td class="tabular py-1.5 pr-3 text-right text-secondary">{paid[n.year + 1] !== undefined ? formatEUR(paid[n.year + 1]!) : '—'}</td>
							{/if}
							<td class="py-1.5 text-right">
								<button type="button" class="meta-xs cursor-pointer hover:underline" title="Retirer cet avis" onclick={() => removeTaxNotice(n.year)}>✕</button>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		{/if}
		{#if show('avis') && show('notes')}
			<p class="meta-xs mt-2">Les prélèvements d'impôt sur le revenu (hors impôts locaux) ne couvrent que la période de relevés importée. Un avis supplémentaire remplace l'avis initial de la même année.</p>
		{/if}
	{:else}
		<p class="meta-xs">Glissez vos avis d'impôt (PDF impots.gouv) ici : impôt sur le revenu, prélèvements sociaux, revenu fiscal de référence et plus-values déclarées par année. Ils servent aussi à savoir quel impôt crypto est déjà réglé.</p>
	{/if}
	{#if provision.dueHint && show('notes')}
		<p class="meta-xs mt-2">{provision.dueHint}</p>
	{/if}
</section>
