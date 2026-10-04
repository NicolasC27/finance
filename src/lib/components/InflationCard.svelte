<script lang="ts">
	import { categorize } from '$lib/categories';
	import { budgetState } from '$lib/budget.svelte';
	import { getMerchantCategoryMap } from '$lib/store.svelte';
	import { getBudgetTransactions } from '$lib/transfers.svelte';
	import { monthTotals } from '$lib/totals';
	import { formatEUR, formatEURCompact } from '$lib/format';
	import { compareYears, cumulativeInflation, ANNUAL_INFLATION, RECENT_INFLATION, SECTOR_INFLATION, INFLATION_SOURCES } from '$lib/inflation';
	import { comparePriceItems, personalInflation, PRICE_ITEM_LABELS } from '$lib/personalInflation';
	import { getPriceItemSpends, monthsBefore, byPriceItem } from '$lib/priceItems.svelte';

	/**
	 * INSEE inflation year by year, against your spending and income: change over the same months as
	 * the previous year, purchasing power (income adjusted for inflation) and spending 'in volume'.
	 * Your personal inflation: the inflation of each major item weighted by your spending, and item by
	 * item over the last 12 months.
	 * The summary sentence, the per-year table, the per-item table and the notes follow the « Éléments
	 * affichés » of the Analyse block.
	 */
	let {
		showSummary = true,
		showYears = true,
		showItems = true,
		showNotes = true
	}: { showSummary?: boolean; showYears?: boolean; showItems?: boolean; showNotes?: boolean } = $props();

	const SHORT_MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
	const currentMonth = new Date().toISOString().slice(0, 7);

	const rows = $derived.by(() => {
		const txs = getBudgetTransactions();
		const mm = getMerchantCategoryMap();
		const catOf = (tx: Parameters<typeof categorize>[0]) => categorize(tx, budgetState.overrides, undefined, mm);
		const months = [...new Set(txs.map((t) => t.booking_date.slice(0, 7)).filter(Boolean))].sort();
		return compareYears(
			months.map((m) => {
				const t = monthTotals(txs, m, catOf);
				return { mois: m, depenses: t.expenses, revenus: t.income };
			}),
			currentMonth
		);
	});

	/** Your inflation, year by year (complete months; weight = your spending that year). */
	const personalByYear = $derived.by(() => {
		const spends = getPriceItemSpends();
		return new Map(rows.map((l) => [l.annee, personalInflation(byPriceItem(spends, (m) => m < currentMonth && m.startsWith(`${l.annee}-`)), l.annee)]));
	});

	/**
	 * Last 12 complete months against the 12 before, at the prices of the latest known year-on-year
	 * change.
	 */
	const itemsYear = Math.max(...Object.keys(SECTOR_INFLATION).map(Number));
	const recentMonths = monthsBefore(currentMonth, 12);
	const previousMonths = monthsBefore(currentMonth, 12, 12);
	/** Change computed over the months whose same month of the previous year is known. */
	const items = $derived.by(() => {
		const spends = getPriceItemSpends();
		const r = new Set(recentMonths);
		const known = new Set(spends.map((d) => d.mois));
		const idx = recentMonths.map((_, i) => i).filter((i) => known.has(previousMonths[i]!));
		const recentKnown = new Set(idx.map((i) => recentMonths[i]!));
		const previousKnown = new Set(idx.map((i) => previousMonths[i]!));
		return comparePriceItems(byPriceItem(spends, (m) => r.has(m)), idx.length >= 3 ? byPriceItem(spends, (m) => previousKnown.has(m)) : new Map(), itemsYear, byPriceItem(spends, (m) => recentKnown.has(m)));
	});
	const personal12 = $derived(items.length ? Math.round(items.reduce((s, l) => s + l.part * l.inflation, 0) * 10) / 10 : null);

	const lastAnnualYear = Math.max(...Object.keys(ANNUAL_INFLATION).map(Number));
	const cumulative2020 = cumulativeInflation(2020, lastAnnualYear);
	const recentMonth = SHORT_MONTHS[Number(RECENT_INFLATION.mois.slice(5, 7)) - 1];

	const pct = (n: number | null, signed = true) => (n === null ? '—' : `${signed && n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`);
	const periodLabel = (l: (typeof rows)[number]) =>
		l.moisCompares.length === 12 || !l.moisCompares.length ? '' : `${SHORT_MONTHS[l.moisCompares[0]! - 1]}–${SHORT_MONTHS[l.moisCompares[l.moisCompares.length - 1]! - 1]}`;
	const rangeLabel = (ms: string[]) => `${SHORT_MONTHS[Number(ms[0]!.slice(5, 7)) - 1]} ${ms[0]!.slice(2, 4)} – ${SHORT_MONTHS[Number(ms[ms.length - 1]!.slice(5, 7)) - 1]} ${ms[ms.length - 1]!.slice(2, 4)}`;
</script>

<div class="mb-3 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
	<h2 class="label-xs">Inflation et pouvoir d'achat</h2>
	<p class="meta-xs">
		INSEE, prix à la consommation · {RECENT_INFLATION.mois.slice(0, 4)} : <b class="tabular">{pct(RECENT_INFLATION.taux)}</b> sur un an ({recentMonth}{RECENT_INFLATION.provisoire ? ', provisoire' : ''})
	</p>
</div>
{#if showSummary}
	<p class="text-[13px]">
		Depuis 2020, les prix ont augmenté de <b class="tabular">{pct(cumulative2020)}</b> : 100 € de 2020 valent {formatEUR(100 * (1 + cumulative2020 / 100))} en {lastAnnualYear}.
		{#if personal12 !== null}
			Sur 12 mois, <b>ton inflation perso est de <span class="tabular">{pct(personal12)}</span></b> (INSEE {pct(RECENT_INFLATION.taux)}) : chaque poste pèse ce qu'il pèse dans tes dépenses.
		{/if}
	</p>
{/if}

{#if showYears || (showItems && items.length)}
	<div class="grid gap-x-6 gap-y-4 {showSummary ? 'mt-3' : ''} {showYears && showItems && items.length ? '@4xl:grid-cols-[3fr_2fr]' : ''}">
		{#if showYears}
			<div class="overflow-x-auto">
				<table class="w-full min-w-[540px] text-[13px]">
					<thead>
						<tr class="meta-xs text-left">
							<th class="pb-1.5 font-normal">Année</th>
							<th class="pb-1.5 text-right font-normal">Inflation</th>
							<th class="pb-1.5 text-right font-normal" title="Inflation de chaque grand poste pondérée par tes dépenses de l'année">Ton inflation</th>
							<th class="pb-1.5 text-right font-normal">Tes dépenses</th>
							<th class="pb-1.5 text-right font-normal">Tes revenus</th>
							<th class="pb-1.5 text-right font-normal" title="Hausse de tes revenus corrigée de l'inflation">Pouvoir d'achat</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-[var(--border-subtle)]">
						{#each rows as l (l.annee)}
							{@const personal = personalByYear.get(l.annee)}
							<tr>
								<td class="py-1.5">
									<span class="font-medium">{l.annee}</span>
									{#if periodLabel(l)}<span class="meta-xs"> · {periodLabel(l)}</span>{/if}
								</td>
								<td class="tabular py-1.5 text-right">
									{pct(l.inflation)}{#if l.inflation !== null && !l.inflationDefinitive}<span class="meta-xs" title="Glissement sur un an, pas encore la moyenne annuelle"> *</span>{/if}
								</td>
								<td class="tabular py-1.5 text-right" title={personal ? personal.postes.map((p) => `${PRICE_ITEM_LABELS[p.poste]} ${Math.round(p.part * 100)} % × ${pct(p.inflation)}`).join('\n') : 'Pas de détail par poste cette année-là'}>
									{pct(personal?.taux ?? null)}
								</td>
								<td class="tabular py-1.5 text-right">
									{formatEURCompact(l.depenses)}
									<span class="meta-xs block" title={l.depensesReelles !== null ? `En volume (corrigé de l'inflation) : ${pct(l.depensesReelles)}` : ''}>{pct(l.varDepenses)}</span>
								</td>
								<td class="tabular py-1.5 text-right">
									{formatEURCompact(l.revenus)}
									<span class="meta-xs block">{pct(l.varRevenus)}</span>
								</td>
								<td class="py-1.5 text-right">
									{#if l.pouvoirAchat !== null}
										<span class="chip {l.pouvoirAchat >= 0 ? 'chip-accent' : 'chip-amber'} tabular px-1.5 py-0 text-[11px]">{pct(l.pouvoirAchat)}</span>
									{:else}
										<span class="meta-xs">—</span>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}

		{#if showItems && items.length}
			<div class="overflow-x-auto">
				<table class="w-full min-w-[400px] text-[13px]">
					<thead>
						<tr class="meta-xs text-left">
							<th class="pb-1.5 font-normal">Poste · {rangeLabel(recentMonths)}</th>
							<th class="pb-1.5 text-right font-normal">Part</th>
							<th class="pb-1.5 text-right font-normal" title="Hausse des prix du poste sur un an (INSEE, {recentMonth} {itemsYear})">Prix</th>
							<th class="pb-1.5 text-right font-normal" title="Tes dépenses sur 12 mois, et leur variation contre les mêmes mois un an plus tôt">Tes dépenses</th>
							<th class="pb-1.5 text-right font-normal" title="Variation de tes dépenses corrigée des prix : > 0, tu en achètes plus (ou plus cher que la moyenne)">En volume</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-[var(--border-subtle)]">
						{#each items as p (p.poste)}
							<tr>
								<td class="py-1.5">{PRICE_ITEM_LABELS[p.poste]}</td>
								<td class="tabular py-1.5 text-right">{Math.round(p.part * 100)} %</td>
								<td class="tabular py-1.5 text-right">{pct(p.inflation)}</td>
								<td class="tabular py-1.5 text-right">
									{formatEURCompact(p.montant)}
									<span class="meta-xs block" title={p.avant ? `Mêmes mois un an plus tôt : ${formatEURCompact(p.avant)}` : 'Pas de mois comparables un an plus tôt'}>{pct(p.variation)}</span>
								</td>
								<td class="py-1.5 text-right">
									{#if p.volume !== null}
										<span class="chip {p.volume > 0 ? 'chip-amber' : 'chip-accent'} tabular px-1.5 py-0 text-[11px]">{pct(p.volume)}</span>
									{:else}
										<span class="meta-xs">—</span>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</div>
{/if}
{#if showNotes}
	<p class="meta-xs mt-2">
		Variations sur les mêmes mois que l'année précédente (mois complets, mois en cours exclu). Pouvoir d'achat : hausse de tes revenus corrigée de l'inflation ; au survol des dépenses, leur hausse « en volume ». Ton inflation : grands postes de l'INSEE (alimentation, énergie, produits manufacturés, services, tabac) pondérés par tes dépenses ; crédits, achat de véhicule et impôts exclus. * glissement sur un an, pas encore la moyenne annuelle.
		Sources : <a class="hover:underline" href={INFLATION_SOURCES.annuelle} target="_blank" rel="noopener noreferrer">INSEE (moyennes annuelles)</a>, <a class="hover:underline" href={INFLATION_SOURCES.recente} target="_blank" rel="noopener noreferrer">INSEE ({recentMonth} {RECENT_INFLATION.mois.slice(0, 4)})</a>.
	</p>
{/if}
