<script lang="ts">
	import { formatEURCompact as formatEUR, formatMonth, formatPct } from '$lib/sensitiveFormat';
	import { householdText, settlementText, YEAR_TOLERANCE, type PortageYearTax } from '$lib/portage';

	/**
	 * The withholding year at a glance: one bar for the taxable income the estimate counts (salary
	 * before the portage, benefits, portage received and projected until December, partner, other
	 * income), one for the year's tax against what is withheld (so far, still to come at the
	 * current rate, left to pay or refunded), then the rate that clears the months left and what it
	 * changes each month. The bars are drawings; the legends under them carry every figure.
	 */
	let {
		year,
		rate,
		provisioned,
		change
	}: {
		year: PortageYearTax;
		rate: number;
		provisioned: number;
		/** Rate change of the last payslip, when there was one. */
		change: { from: number; to: number; month: string } | null;
	} = $props();

	const income = $derived(
		[
			{ id: 'before', label: 'salaire avant le portage', amount: year.income.before },
			{ id: 'benefits', label: 'chômage', amount: year.income.benefits },
			{ id: 'portage', label: 'portage reçu', amount: year.income.portage },
			{ id: 'projected', label: `portage projeté (${year.projectedMonths} mois)`, amount: year.income.projected },
			{ id: 'partner', label: 'salaire du conjoint', amount: year.income.partner },
			{ id: 'other', label: 'autres revenus', amount: year.income.other }
		].filter((s) => s.amount > 0)
	);
	const total = $derived(income.reduce((s, x) => s + x.amount, 0));
	const withheld = $derived(year.withheldSoFar + year.withheldToCome);
	const toPay = $derived(Math.max(0, year.balance));
	/** The tax bar spans the larger of the tax and what is withheld; past the tax mark, the excess is refunded. */
	const span = $derived(Math.max(year.tax, withheld, 1));
	const taxAt = $derived(Math.min(100, (year.tax / span) * 100));
	const projectedBase = $derived(year.projectedMonths > 0 ? year.income.projected / year.projectedMonths : 0);
	/** What the rate that clears the year changes on each month left (> 0 = more withheld). */
	const monthlyChange = $derived(year.rateToAvoid !== null && projectedBase > 0 ? Math.round(((year.rateToAvoid - rate) / 100) * projectedBase) : 0);
	const changeMonth = $derived(change ? formatMonth(change.month).toLowerCase() : '');
</script>

<div class="tax-year">
	<div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
		<p class="text-[12px]"><span class="font-medium">Ton année {year.year}</span> <a href="/impot" class="meta-xs hover:underline" title="Foyer réglé sur la page Impôt">· foyer {householdText(year.household)}</a></p>
		<p class="meta-xs tabular">revenu imposable {formatEUR(total)} · impôt {year.household.couple ? 'du foyer' : ''} estimé ≈ {formatEUR(year.tax)}</p>
	</div>

	<div class="tax-bar mt-1.5" aria-hidden="true">
		{#each income as s (s.id)}<i class="tax-seg is-{s.id}" style="flex-grow: {s.amount};" title="{s.label} · {formatEUR(s.amount)}"></i>{/each}
	</div>
	<ul class="tax-key" aria-label="Revenu imposable de l’année {year.year}">
		{#each income as s (s.id)}<li><i class="tax-swatch is-{s.id}" aria-hidden="true"></i>{s.label} <span class="tabular text-[var(--text)]">{formatEUR(s.amount)}</span></li>{/each}
	</ul>

	<div class="tax-bar mt-2" aria-hidden="true">
		{#if year.withheldSoFar > 0}<i class="tax-seg is-withheld" style="flex-grow: {year.withheldSoFar};" title="déjà prélevé · {formatEUR(year.withheldSoFar)}"></i>{/if}
		{#if year.withheldToCome > 0}<i class="tax-seg is-tocome" style="flex-grow: {year.withheldToCome};" title="à venir d’ici décembre à {formatPct(rate, 1)} · {formatEUR(year.withheldToCome)}"></i>{/if}
		{#if toPay > 0}<i class="tax-seg is-topay" style="flex-grow: {toPay};" title="reste à payer · {formatEUR(toPay)}"></i>{/if}
		{#if year.balance < 0}<b class="tax-mark" style="left: {taxAt}%;" title="impôt estimé · {formatEUR(year.tax)}"></b>{/if}
	</div>
	<ul class="tax-key" aria-label="Impôt de l’année {year.year} et prélèvements">
		<li><i class="tax-swatch is-withheld" aria-hidden="true"></i>déjà prélevé <span class="tabular text-[var(--text)]">{formatEUR(year.withheldSoFar)}</span></li>
		{#if year.withheldToCome > 0}
			<li><i class="tax-swatch is-tocome" aria-hidden="true"></i>à venir à {formatPct(rate, 1)}{#if change} ({formatPct(change.from, 1)} avant {changeMonth}){/if} <span class="tabular text-[var(--text)]">{formatEUR(year.withheldToCome)}</span></li>
		{/if}
		{#if toPay > 0}
			<li><i class="tax-swatch is-topay" aria-hidden="true"></i>reste à payer {settlementText(year)} <span class="tabular font-medium" style="color: var(--amber);">≈ {formatEUR(toPay)}</span></li>
		{:else if year.balance < 0}
			<li><b class="tax-swatch is-mark" aria-hidden="true"></b>remboursé {settlementText(year)} <span class="tabular text-[var(--text)]">≈ {formatEUR(-year.balance)}</span></li>
		{/if}
		{#if provisioned > 0}<li>mis de côté dans ton budget <span class="tabular text-[var(--text)]">{formatEUR(provisioned)}</span></li>{/if}
	</ul>

	{#if year.projectedMonths > 0 && year.rateToAvoid !== null && Math.abs(year.balance) > YEAR_TOLERANCE}
		<p class="mt-2 text-[12px]">
			{#if year.rateToAvoid === 0}
				Pour solder l’année : plus aucun prélèvement nécessaire d’ici décembre.
			{:else}
				Pour solder l’année : taux de <b class="tabular">{formatPct(year.rateToAvoid, 1)}</b> sur les {year.projectedMonths} mois restants au lieu de {formatPct(rate, 1)}{#if monthlyChange !== 0}<span class="text-secondary">, soit {monthlyChange > 0 ? '+' : '−'}{formatEUR(Math.abs(monthlyChange))} prélevés par mois</span>{/if}
			{/if}
			· <a href="https://www.impots.gouv.fr/accueil" target="_blank" rel="noopener noreferrer" class="underline">impots.gouv.fr ↗</a>
		</p>
	{/if}
	{#if year.stoppedAt || year.otherTax > 0 || !year.exactRules}
		<p class="meta-xs mt-1.5">
			{[
				year.stoppedAt ? `Pas de fiche de paie après ${formatMonth(year.stoppedAt).toLowerCase()} : l’estimation s’arrête là (importe les suivantes si ton contrat continue).` : '',
				year.otherTax > 0 ? `Dont ≈ ${formatEUR(year.otherTax)} d’impôt sur tes autres revenus, hors provision du portage.` : '',
				year.exactRules ? '' : `Barème ${year.year} pas encore dans l’app : estimation sur le plus proche.`
			]
				.filter(Boolean)
				.join(' ')}
		</p>
	{/if}
</div>

<style>
	.tax-year {
		margin-top: 0.75rem;
		padding-top: 0.625rem;
		border-top: 1px solid var(--border-subtle);
	}
	.tax-bar {
		position: relative;
		display: flex;
		gap: 2px;
		height: 10px;
		border-radius: 3px;
	}
	.tax-seg {
		display: block;
		flex-basis: 0;
		min-width: 2px;
		border-radius: 2px;
	}
	.tax-key {
		display: flex;
		flex-wrap: wrap;
		gap: 0.2rem 0.875rem;
		margin-top: 0.35rem;
		color: var(--text-2);
		font-size: 11.5px;
	}
	.tax-key li {
		display: inline-flex;
		align-items: center;
		gap: 5px;
	}
	.tax-swatch {
		display: inline-block;
		width: 9px;
		height: 9px;
		border-radius: 2px;
	}
	.tax-mark {
		position: absolute;
		top: -3px;
		bottom: -3px;
		width: 2px;
		margin-left: -1px;
		background: var(--text);
	}
	.tax-swatch.is-mark {
		width: 2px;
		height: 11px;
		border-radius: 0;
		background: var(--text);
	}
	/* Income: greys outside the portage, the accent for the portage, hatched while projected */
	.is-before {
		background: color-mix(in srgb, var(--text) 32%, transparent);
	}
	.is-benefits {
		background: color-mix(in srgb, var(--text) 18%, transparent);
	}
	.is-partner {
		background: color-mix(in srgb, var(--text) 24%, transparent);
	}
	.is-other {
		background: color-mix(in srgb, var(--text) 10%, transparent);
	}
	.is-portage,
	.is-withheld {
		background: var(--accent);
	}
	.is-projected,
	.is-tocome {
		background: repeating-linear-gradient(45deg, var(--accent) 0 2px, var(--accent-soft) 2px 6px);
	}
	.is-topay {
		background: var(--amber);
	}
</style>
