<script lang="ts">
	import { budgetState } from '$lib/budget.svelte';
	import { getMerchantCategoryMap } from '$lib/store.svelte';
	import { getBudgetTransactions } from '$lib/transfers.svelte';
	import { isPending, sortByDate } from '$lib/data';
	import { detectRecurring, forecastTotals, forecastByCategory, forecastRefIso, confidenceStyle, confidenceLabel } from '$lib/forecast';
	import { formatDate, formatEUR } from '$lib/format';
	import { getCategory } from '$lib/categories';
	import { flowKind } from '$lib/flow';

	/**
	 * 'Prévisions' card (Budget page block): detected upcoming payments + 30/60/90-day totals. The
	 * totals, payment table, confidence column and next-month-per-category ranges follow the block's
	 * « Éléments affichés ».
	 */
	let {
		showTotals = true,
		showPayments = true,
		showConfidence = true,
		showCategories = true
	}: { showTotals?: boolean; showPayments?: boolean; showConfidence?: boolean; showCategories?: boolean } = $props();

	// Budget scope (v13): internal transfers excluded from forecasts
	const confirmed = $derived(getBudgetTransactions().filter((tx) => !isPending(tx)));
	// Reference = max(last booking_date of the dataset, today): never an upcoming payment shown in the
	// real past, totals recomputed from today.
	const fromIso = $derived(forecastRefIso(sortByDate(confirmed)[confirmed.length - 1]?.booking_date ?? ''));
	// Upcoming payments = LIVE FIXED charges (subscriptions, direct debits, rent): not Saturday
	// groceries, not a stopped direct debit, not savings
	const recurring = $derived(
		detectRecurring(confirmed, budgetState.overrides, fromIso, getMerchantCategoryMap()).filter((r) => r.kind === 'debit' && r.active && r.fixed && flowKind(r.categoryId) === 'expense')
	);
	const byCategory = $derived(forecastByCategory(confirmed, budgetState.overrides, getMerchantCategoryMap()));
	const totals = $derived(
		fromIso ? ([30, 60, 90] as const).map((d) => forecastTotals(confirmed, budgetState.overrides, fromIso, d, getMerchantCategoryMap())) : []
	);

	/** Visible upcoming payments: 5 by default, all on request (density). */
	const PREVIEW = 5;
	let showAll = $state(false);
	const visible = $derived(showAll ? recurring : recurring.slice(0, PREVIEW));
</script>

{#if fromIso && (recurring.length > 0 || totals.length > 0)}
	<!-- Card with its header (collapsing is done by the block) -->
	<section class="card card-lift fade-slide p-4" style="--stagger: 180ms;">
		<div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
			<h2 class="label-xs">Prévisions de dépenses</h2>
			{#if showTotals}
				<!-- Expected 30/60/90-day totals in a row (recurring items + average of the rest) -->
				<div class="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-[13px]">
					{#each totals as t (t.days)}
						<span class="whitespace-nowrap" title="{formatEUR(t.low)} – {formatEUR(t.high)}">
							<span class="meta-xs">{t.days} j</span>
							<span class="tabular ml-1 font-semibold">{formatEUR(t.expected)}</span>
						</span>
					{/each}
				</div>
			{/if}
		</div>

		<!-- Detected recurring payments -->
		{#if showPayments && recurring.length > 0}
			<div class="mt-3 overflow-x-auto">
				<table class="w-full {showConfidence ? 'min-w-[560px]' : 'min-w-[460px]'} border-collapse text-[13px]">
					<thead>
						<tr class="text-left">
							<th class="label-xs pb-2 font-medium">Libellé</th>
							<th class="label-xs pb-2 font-medium">Cadence</th>
							<th class="label-xs pb-2 font-medium">Prochaine</th>
							<th class="label-xs pb-2 text-right font-medium">Montant prévu</th>
							{#if showConfidence}<th class="label-xs pb-2 text-right font-medium">Confiance</th>{/if}
						</tr>
					</thead>
					<tbody>
						{#each visible as item (item.key)}
							{@const cat = getCategory(item.categoryId)}
							<tr class="border-t" style="border-color: var(--border-subtle);">
								<td class="py-1.5 pr-3">
									<span class="flex items-center gap-2">
										<span class="h-2 w-2 shrink-0 rounded-full" style="background-color: {cat.color};" aria-hidden="true"></span>
										<span class="truncate font-medium">{item.label}</span>
									</span>
								</td>
								<td class="py-1.5 pr-3 text-secondary capitalize">{item.cadence}</td>
								<td class="tabular py-1.5 pr-3 text-secondary">{formatDate(item.nextDate)}</td>
								<td class="tabular py-1.5 pr-3 text-right font-semibold whitespace-nowrap">
									{formatEUR(item.amount)}
									{#if item.amountSigma > 0}
										<span class="meta-xs font-normal">± {formatEUR(item.amountSigma)}</span>
									{/if}
									{#if item.trendPerPeriod !== 0}
										<span class="meta-xs font-normal" style="color: var(--amber);" title="Tendance par période">
											{item.trendPerPeriod > 0 ? '▲' : '▼'} {formatEUR(Math.abs(item.trendPerPeriod))}
										</span>
									{/if}
								</td>
								{#if showConfidence}
									<td class="py-1.5 text-right">
										<span class="chip" style={confidenceStyle(item.confidence)}>
											{confidenceLabel(item.confidence)}
										</span>
									</td>
								{/if}
							</tr>
						{/each}
					</tbody>
				</table>
				{#if recurring.length > PREVIEW}
					<button type="button" class="press mt-2 cursor-pointer text-xs font-medium transition-colors hover:underline" style="color: var(--accent);" onclick={() => (showAll = !showAll)}>
						{showAll ? 'Voir moins' : `Voir les ${recurring.length} échéances`}
					</button>
				{/if}
			</div>
		{/if}

		<!-- Forecast per category (rolling average + bounded trend, ±1σ range) -->
		{#if showCategories && byCategory.length > 0}
			<h3 class="label-xs mt-4 mb-2">Mois prochain par catégorie (plage ±1σ)</h3>
			<ul class="flex flex-wrap gap-1.5">
				{#each byCategory as c (c.categoryId)}
					{@const cat = getCategory(c.categoryId)}
					<li
						class="chip chip-outline tabular"
						style="font-size: 12px;"
						title="Attendu {formatEUR(c.expected)} · tendance {c.trendPct >= 0 ? '+' : ''}{Math.round(c.trendPct * 100)} %"
					>
						<span class="font-medium" style="color: {cat.color};">{cat.label}</span>
						<span class="text-secondary"> {formatEUR(c.low)} – {formatEUR(c.high)}</span>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
{/if}
