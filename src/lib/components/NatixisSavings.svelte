<script module lang="ts">
	import type { BlockElement, BlockShow } from '$lib/layoutModel';

	/** Optional parts of the card, hideable from its Patrimoine block. */
	export const EMPLOYEE_SAVINGS_ELEMENTS: BlockElement[] = [
		{ id: 'disponibilite', label: 'Disponibilité par année' },
		{ id: 'fonds', label: 'Tableau des fonds' },
		{ id: 'projection', label: 'Projection sans versements' },
		{ id: 'versements', label: 'Versements connus' },
		{ id: 'saisie', label: 'Saisie manuelle et situation du jour' }
	];
</script>

<script lang="ts">
	import DateField from '$lib/components/DateField.svelte';
	import { onMount } from 'svelte';
	import { formatEUR, formatDate, formatPct } from '$lib/sensitiveFormat';
	import { lighten } from '$lib/color';
	import { parseNatixisPdf, KNOWN_FUNDS } from '$lib/pdfNatixis';
	import { natixisState, saveNatixisNotice, saveNatixisPerfs, addManualHolding, getNatixisPayments, getNatixisPaymentsTotal, rememberNatixisPayment, getNatixisEstimate, saveNatixisSnapshot, getNatixisProjection } from '$lib/natixisHoldings.svelte';

	/**
	 * 'Épargne salariale' section of the Patrimoine page (SPEC v14 §F.3): serif total on the valuation
	 * date (unlisted FCPE funds: NEVER a live value), horizontal availability timeline, fund table
	 * with annual performance badge, PDF import area (button + drag & drop, pdfjs in a lazy chunk) and
	 * manual fallback entry when parsing is too uncertain (< 50 % of lines recognised).
	 */

	/** `show` comes from the block: parts the user unticked are not rendered. */
	let { show = () => true }: { show?: BlockShow } = $props();

	let fileInput = $state<HTMLInputElement | null>(null);
	let importing = $state(false);
	let message = $state('');
	let importError = $state('');
	let manualOpen = $state(false);
	/** 'Situation read on the Natixis website' form (today's total + cumulative payments). */
	let snapOpen = $state(false);
	let snapDate = $state(new Date().toISOString().slice(0, 10));
	let snapTotal = $state('');
	let snapInvested = $state('');

	function commitSnapshot() {
		const total = Number(snapTotal.replace(/\s/g, '').replace(',', '.'));
		const invested = Number(snapInvested.replace(/\s/g, '').replace(',', '.'));
		if (!snapDate || !Number.isFinite(total) || total <= 0 || !Number.isFinite(invested) || invested < 0) return;
		saveNatixisSnapshot({ date: snapDate, total: Math.round(total * 100) / 100, invested: Math.round(invested * 100) / 100 });
		snapOpen = false;
		message = `Situation du ${formatDate(snapDate)} enregistrée : ${formatEUR(total)} pour ${formatEUR(invested)} versés.`;
	}
	let dragActive = $state(false);

	// Fields of the manual fallback entry
	let manualFund = $state('');
	let manualAmount = $state('');
	let manualAvailability = $state('retraite');

	const stored = $derived(natixisState.holdings);
	const segments = $derived(stored?.availability ?? []);
	const segmentsTotal = $derived(segments.reduce((s, seg) => s + seg.amount, 0));
	const perfYear = $derived(natixisState.perfs?.year ?? 0);

	/** Timeline tints: lighten() of --accent, read as a computed colour. */
	let accentHex = $state('#c9a86c');
	onMount(() => {
		const raw = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
		if (/^#[0-9a-f]{6}$/i.test(raw)) accentHex = raw;
	});

	/** From solid champagne to lighter and lighter tints. */
	function segmentColor(i: number, total: number): string {
		return lighten(accentHex, total <= 1 ? 0 : (i / (total - 1)) * 0.55);
	}

	/** Shared import: file picker AND drag & drop (both PDF types). */
	/**
	 * Several PDFs at once: notices sorted by name (duplicates have no effect), read one after the
	 * other.
	 */
	async function handleFiles(list: FileList | File[] | null | undefined) {
		const files = [...(list ?? [])].filter((f) => /\.pdf$/i.test(f.name)).sort((a, b) => a.name.localeCompare(b.name));
		const messages: string[] = [];
		for (const f of files) {
			await handlePdf(f);
			if (message) messages.push(`${f.name} : ${message}`);
			if (importError) messages.push(`${f.name} : ${importError}`);
		}
		if (files.length > 1) {
			message = messages.join(' · ');
			importError = '';
		}
	}

	/**
	 * A notice older than the current snapshot keeps the snapshot and only records the payment; when
	 * parsing fails, fall back to manual entry.
	 */
	async function handlePdf(file: File | undefined) {
		if (!file) return;
		importing = true;
		message = '';
		importError = '';
		try {
			if (!/\.pdf$/i.test(file.name)) {
				importError = 'Le fichier attendu est un PDF Natixis (avis d’opération ou tableau des performances).';
				return;
			}
			const result = await parseNatixisPdf(await file.arrayBuffer());
			if (result.kind === 'avis') {
				const current = natixisState.holdings;
				if (current && current.valuedAt > result.avis.valuedAt) {
					if (result.avis.lastPayment) rememberNatixisPayment(result.avis.lastPayment);
					message = `Avis du ${formatDate(result.avis.valuedAt)} plus ancien que celui en place (${formatDate(current.valuedAt)}) : avoirs conservés, versement ajouté à l'historique.`;
				} else {
					saveNatixisNotice(result.avis);
					message = `${result.avis.availability.length > 0 ? 'Avis' : 'Relevé « Mon épargne »'} importé : ${result.avis.holdings.length} avoirs · ${formatEUR(result.avis.total)} au ${formatDate(result.avis.valuedAt)}.`;
				}
			} else if (result.kind === 'scheme') {
				saveNatixisPerfs(result.scheme.perfs, result.scheme.year);
				message = `Performances ${result.scheme.year} importées pour ${Object.keys(result.scheme.perfs).length} fonds.`;
			} else {
				importError = result.message;
				if (result.reason === 'low-match') manualOpen = true;
			}
		} catch {
			importError = 'Lecture du PDF impossible (fichier illisible ou protégé).';
		} finally {
			importing = false;
		}
	}

	/** Adds a holding entered by hand (fallback when parsing fails). */
	function commitManual() {
		const amount = Number(manualAmount.replace(/\s/g, '').replace(',', '.'));
		if (!manualFund.trim() || !Number.isFinite(amount) || amount <= 0) return;
		addManualHolding({
			fund: manualFund,
			amount,
			availableAt: manualAvailability === 'retraite' ? 'retraite' : `${manualAvailability}-06-01`
		});
		manualFund = '';
		manualAmount = '';
		manualAvailability = 'retraite';
		manualOpen = false;
		importError = '';
		message = 'Avoir ajouté manuellement.';
	}

	/** Readable availability label ('juin 2029' / 'Retraite'). */
	function availabilityLabel(availableAt: string): string {
		if (availableAt === 'retraite') return 'Retraite';
		if (availableAt === 'inconnue') return '—';
		return formatDate(availableAt);
	}

	/** Years offered by the manual entry select. */
	const availabilityYears = $derived.by(() => {
		const years = new Set<string>();
		for (const seg of segments) if (seg.key !== 9999) years.add(seg.label);
		const base = new Date().getFullYear() + 3;
		for (let y = base; y <= base + 3; y++) years.add(String(y));
		return [...years].sort();
	});
</script>

<section
	class="card card-lift hero-in-3 p-4 sm:col-span-2 lg:col-span-12"
	aria-label="Épargne salariale Natixis"
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
			<p class="label-xs">Épargne salariale</p>
			{#if stored}
				{@const estimate = getNatixisEstimate()}
				<h2 class="stat-amount mt-1">{formatEUR(stored.total)}</h2>
				<!-- Unlisted FCPE funds: value on the valuation date, stated honestly; estimate extended by the annual performance -->
				<p class="meta-xs mt-1">
					au {formatDate(stored.valuedAt)} · avant frais et prélèvements sociaux
					{#if estimate && estimate.estimated && estimate.daysSince > 0}
						· <span title="{estimate.base === 'snapshot' ? 'Situation saisie' : 'Valeur de l’avis'} prolongée au prorata des jours avec la performance annuelle des fonds (tableau des performances importé). Estimation, pas une valorisation.">≈ <span class="tabular font-medium" style="color: var(--text);">{formatEUR(estimate.total)}</span> estimé aujourd'hui</span>
					{:else if estimate && estimate.base === 'snapshot'}
						· situation du {formatDate(estimate.baseDate)} : <span class="tabular font-medium" style="color: var(--text);">{formatEUR(estimate.total)}</span>
					{/if}
				</p>
				{#if estimate && estimate.gain !== undefined && estimate.invested !== undefined}
					<!-- Gain vs cumulative payments (entered from the Natixis website, 'Source of my total savings') -->
					<p class="mt-1 text-[13px]">
						<span class="text-secondary">Versé</span> <span class="tabular font-medium">{formatEUR(estimate.invested)}</span>
						<span class="text-secondary"> · gain</span>
						<span class="tabular font-medium" style="color: {estimate.gain >= 0 ? 'var(--accent)' : 'var(--amber)'};">{estimate.gain >= 0 ? '+' : '−'}{formatEUR(Math.abs(estimate.gain))}{#if estimate.gainPct !== undefined} ({formatPct(estimate.gainPct, 1, true)}){/if}</span>
						{#if estimate.estimated}<span class="meta-xs"> estimé</span>{/if}
					</p>
				{/if}
				{#if estimate && estimate.daysSince > 90}
					<!-- Old notice: reminder to check the Natixis website -->
					<p class="mt-1.5">
						<a href="https://www.interepargne.natixis.com" target="_blank" rel="noopener" class="chip chip-amber" title="Téléchargez le dernier avis d'opération ou relevé de situation sur votre espace Natixis Interépargne, puis glissez-le ici">
							Avis d'il y a {Math.round(estimate.daysSince / 30)} mois · mettre à jour
						</a>
					</p>
				{/if}
			{:else}
				<h2 class="mt-1 text-sm font-medium">PEI &amp; PERCOL</h2>
			{/if}
		</div>
		<div class="flex items-center gap-2">
			<button
				type="button"
				class="btn btn-accent"
				disabled={importing}
				onclick={() => fileInput?.click()}
			>
				{importing ? 'Lecture des PDF…' : stored ? 'Importer des avis (PDF)' : 'Importer vos avis Natixis (PDF)'}
			</button>
			<input
				bind:this={fileInput}
				type="file"
				accept=".pdf,application/pdf"
				multiple
				class="hidden"
				aria-label="Importer un ou plusieurs PDF Natixis"
				onchange={(e) => {
					void handleFiles((e.target as HTMLInputElement).files);
					(e.target as HTMLInputElement).value = '';
				}}
			/>
		</div>
	</header>

	{#if message}
		<p class="mb-4 text-sm" style="color: var(--accent);">{message}</p>
	{/if}
	{#if importError}
		<!-- Never red: the import error is amber -->
		<p class="mb-4 text-sm" style="color: var(--accent-2);">{importError}</p>
	{/if}

	{#if stored}
		<!-- Availability timeline: segmented bar, lighten() tints of --accent -->
		{#if segments.length > 0 && segmentsTotal > 0 && show('disponibilite')}
			<div class="mb-6">
				<p class="meta-xs mb-2 uppercase" style="letter-spacing: 0.14em;">Disponibilité</p>
				<div class="flex h-3 overflow-hidden rounded-full" role="img" aria-label="Répartition de l'épargne par année de disponibilité">
					{#each segments as seg, i (seg.label)}
						<div
							class="h-full"
							style="width: {(seg.amount / segmentsTotal) * 100}%; background-color: {segmentColor(i, segments.length)};"
							title="{seg.label} : {formatEUR(seg.amount)}"
						></div>
					{/each}
				</div>
				<div class="mt-2 flex flex-wrap gap-x-6 gap-y-1">
					{#each segments as seg (seg.label)}
						<p class="text-xs text-secondary">
							{seg.label} : <span class="tabular font-medium" style="color: var(--text);">{formatEUR(seg.amount)}</span>
						</p>
					{/each}
				</div>
			</div>
		{/if}

		<!-- Fund table -->
		{#if show('fonds')}
		<div class="overflow-x-auto">
			<table class="w-full min-w-[540px] text-sm">
				<thead>
					<tr class="meta-xs border-b text-left" style="border-color: var(--border-subtle);">
						<th class="py-2 pr-4 font-medium">Fonds</th>
						<th class="py-2 pr-4 font-medium">Plan</th>
						<th class="py-2 pr-4 text-right font-medium">Parts</th>
						<th class="py-2 pr-4 text-right font-medium">VL</th>
						<th class="py-2 pr-4 text-right font-medium">Montant</th>
						<th class="py-2 pr-4 text-right font-medium">Disponible</th>
						{#if perfYear > 0}<th class="py-2 text-right font-medium">Perf. {perfYear}</th>{/if}
					</tr>
				</thead>
				<tbody>
					{#each stored.holdings as h (h.fund + h.availableAt + h.plan)}
						<tr class="border-b" style="border-color: var(--border-subtle);">
							<td class="py-2.5 pr-4 font-medium">{h.fund}</td>
							<td class="py-2.5 pr-4 text-secondary">{h.plan}</td>
							<td class="tabular py-2.5 pr-4 text-right text-secondary">{h.shares > 0 ? h.shares : '—'}</td>
							<td class="tabular py-2.5 pr-4 text-right text-secondary">{h.shareValue > 0 ? formatEUR(h.shareValue) : '—'}</td>
							<td class="tabular py-2.5 pr-4 text-right font-medium">{formatEUR(h.amount)}</td>
							<td class="py-2.5 pr-4 text-right text-secondary">{availabilityLabel(h.availableAt)}</td>
							{#if perfYear > 0}
								<td class="py-2.5 text-right">
									{#if h.perfY !== undefined}
										<!-- Accent when positive, --debit when negative (never red) -->
										<span
											class="inline-block rounded-full px-2 py-0.5 text-[11px] font-medium tabular"
											style={h.perfY >= 0
												? 'background-color: var(--accent-soft); color: var(--accent);'
												: 'background-color: var(--surface-hover); color: var(--debit);'}
										>
											{formatPct(h.perfY, 2, true)}
										</span>
									{:else}
										<span class="text-secondary">—</span>
									{/if}
								</td>
							{/if}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		{/if}

		{#if getNatixisProjection() && show('projection')}
			{@const proj = getNatixisProjection()!}
			<!-- Projection without new payments: 3 scenarios, never a promise -->
			<div class="mt-4 border-t pt-3" style="border-color: var(--border-subtle);">
				<p class="label-plain mb-1.5">Projection sans nouveaux versements</p>
				<table class="w-full text-[12px]">
					<thead>
						<tr class="text-left">
							<th class="meta-xs pb-1 font-normal">Horizon</th>
							<th class="meta-xs pb-1 text-right font-normal" title="Monétaire 2 %, obligataire 2,5 %, mixte 4 %, actions 6 % par an">Prudent</th>
							<th class="meta-xs pb-1 text-right font-normal" title="Performance 2025 de chaque fonds reconduite chaque année">Au rythme 2025</th>
						</tr>
					</thead>
					<tbody>
						{#each proj as p (p.years)}
							<tr class="border-t" style="border-color: var(--border-subtle);">
								<td class="py-1">Dans {p.years} an{p.years > 1 ? 's' : ''}</td>
								<td class="tabular py-1 text-right">{formatEUR(p.prudent)}</td>
								<td class="tabular py-1 text-right font-medium">{p.lastYear !== null ? formatEUR(p.lastYear) : '—'}</td>
							</tr>
						{/each}
					</tbody>
				</table>
				<p class="meta-xs mt-1">Deux hypothèses de rendement, pas une prévision : les fonds ne sont pas garantis. Les versements futurs ne sont pas comptés.</p>
			</div>
		{/if}

		{#if getNatixisPayments().length > 0 && show('versements')}
			{@const paymentsTotal = getNatixisPaymentsTotal()}
			<!-- Known payments (sum of imported notices): one per row, type + fund + amount -->
			<div class="mt-4 border-t pt-3" style="border-color: var(--border-subtle);">
				<p class="label-plain mb-1.5">Versements connus · {paymentsTotal.count} · {formatEUR(paymentsTotal.net)} net{#if paymentsTotal.employer > 0} dont {formatEUR(paymentsTotal.employer)} de l'entreprise{/if}</p>
				<ul class="divide-y divide-[var(--border-subtle)] text-[13px]">
					{#each getNatixisPayments() as p (p.kind + p.fund + p.valuedAt + p.amount)}
						<li class="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-1">
							<span class="tabular text-secondary">{formatDate(p.valuedAt)}</span>
							<span class="min-w-0 flex-1 truncate">{p.kind} · {p.fund}</span>
							<span class="tabular font-medium">{formatEUR(p.netAmount ?? p.amount)}</span>
							{#if p.socialLevy}<span class="meta-xs">({formatEUR(p.amount)} − {formatEUR(p.socialLevy)} PS)</span>{/if}
						</li>
					{/each}
				</ul>
				<p class="meta-xs mt-1.5">Seuls les versements figurant sur un avis importé sont connus : importez vos anciens avis pour compléter.</p>
			</div>
		{/if}
		<p class="meta-xs mt-3">Glissez un autre PDF Natixis ici : le dernier avis remplace le précédent.</p>
	{:else}
		<!-- Empty state: prompt to import (drag & drop accepted anywhere here) -->
		<div class="rounded-xl border border-dashed p-4" style="border-color: var(--border);">
			<p class="text-sm text-secondary">
				Importez votre <strong>avis d’opération</strong> Natixis Interépargne (PDF) — ou glissez-le ici — pour
				suivre vos avoirs PEI/PERCOL au jour de leur valorisation. Le tableau des performances annuelles est
				aussi accepté.
			</p>
		</div>
	{/if}

	<!-- Manual fallback entry (parsing < 50 % or occasional addition) -->
	{#if show('saisie')}
	{#if manualOpen}
		<form
			class="mt-4 flex flex-wrap items-end gap-2 rounded-xl border p-4"
			style="border-color: var(--border-subtle);"
			onsubmit={(e) => {
				e.preventDefault();
				commitManual();
			}}
		>
			<label class="min-w-48 flex-1">
				<span class="meta-xs">Fonds</span>
				<input
					type="text"
					class="input-surface mt-1 w-full"
					list="natixis-funds"
					placeholder="CAP ISR RENDEMENT R"
					bind:value={manualFund}
					aria-label="Nom du fonds"
				/>
				<datalist id="natixis-funds">
					{#each KNOWN_FUNDS as f (f)}<option value={f}></option>{/each}
				</datalist>
			</label>
			<label class="w-32">
				<span class="meta-xs">Montant (€)</span>
				<input
					type="text"
					inputmode="decimal"
					class="input-surface mt-1 w-full"
					placeholder="1 250,00"
					bind:value={manualAmount}
					aria-label="Montant en euros"
				/>
			</label>
			<label class="w-32">
				<span class="meta-xs">Disponibilité</span>
				<select class="input-surface mt-1 w-full" bind:value={manualAvailability} aria-label="Année de disponibilité">
					<option value="retraite">Retraite</option>
					{#each availabilityYears as y (y)}<option value={y}>{y}</option>{/each}
				</select>
			</label>
			<button type="submit" class="btn btn-accent">
				Ajouter
			</button>
		</form>
	{:else}
		<button
			type="button"
			class="press mt-3 cursor-pointer text-xs font-medium transition-colors hover:underline"
			style="color: var(--accent);"
			onclick={() => (manualOpen = true)}
		>
			Saisie manuelle
		</button>
	{/if}

	<!-- Situation read on the Natixis website (today's total + cumulative payments): gives the gain without waiting for a notice -->
	{#if snapOpen}
		<form
			class="mt-3 flex flex-wrap items-end gap-2 rounded-xl border p-4"
			style="border-color: var(--border-subtle);"
			onsubmit={(e) => {
				e.preventDefault();
				commitSnapshot();
			}}
		>
			<label class="w-40">
				<span class="meta-xs">Situation au</span>
				<DateField bind:value={snapDate} label="Date de la situation" class="mt-1 w-full" />
			</label>
			<label class="w-40">
				<span class="meta-xs">Total (« My savings »)</span>
				<input type="text" inputmode="decimal" class="input-surface tabular mt-1 w-full" placeholder="12 500,00" bind:value={snapTotal} aria-label="Total de l'épargne" />
			</label>
			<label class="w-48">
				<span class="meta-xs">Versements cumulés (« Source »)</span>
				<input type="text" inputmode="decimal" class="input-surface tabular mt-1 w-full" placeholder="11 800,00" bind:value={snapInvested} aria-label="Versements cumulés" />
			</label>
			<div class="flex gap-2">
				<button type="submit" class="btn btn-primary btn-sm">Enregistrer</button>
				<button type="button" class="btn btn-secondary btn-sm" onclick={() => (snapOpen = false)}>Annuler</button>
			</div>
			<p class="meta-xs w-full">Sur interepargne.natixis.com : « My savings » = total ; « Source of my total savings » = somme Employee savings + Voluntary investments.</p>
		</form>
	{:else}
		<button
			type="button"
			class="press mt-3 ml-4 cursor-pointer text-xs font-medium transition-colors hover:underline"
			style="color: var(--accent);"
			onclick={() => (snapOpen = true)}
		>
			Saisir la situation du jour (espace Natixis)
		</button>
	{/if}
	{/if}
</section>
