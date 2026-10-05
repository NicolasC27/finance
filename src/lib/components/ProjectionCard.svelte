<script module lang="ts">
	import type { BlockElement, BlockShow } from '$lib/layoutModel';

	/** Optional parts of the card, hideable from its Patrimoine block. */
	export const PROJECTION_ELEMENTS: BlockElement[] = [
		{ id: 'horizon', label: "Choix de l'horizon (5, 10, 20 ans)" },
		{ id: 'hypotheses', label: 'Hypothèses (épargne, rendement)' },
		{ id: 'courbe', label: 'Courbe' },
		{ id: 'resultat', label: 'Montant projeté' },
		{ id: 'objectifs', label: 'Objectif et objectifs d’épargne' }
	];
</script>

<script lang="ts">
	import { segmented } from '$lib/actions/segmented';
	import { getNetWorth, getCryptoTotal } from '$lib/wealth.svelte';
	import { getLoanViews, loanState } from '$lib/loans.svelte';
	import { goalsState } from '$lib/goals.svelte';
	import { categorize } from '$lib/categories';
	import { budgetState } from '$lib/budget.svelte';
	import { getMerchantCategoryMap } from '$lib/store.svelte';
	import { getBudgetTransactions } from '$lib/transfers.svelte';
	import { monthTotals } from '$lib/totals';
	import { formatEURCompact } from '$lib/sensitiveFormat';
	const formatEUR = formatEURCompact;
	import { LONG_TERM_INFLATION } from '$lib/inflation';
	import { averageSavings, monthsToReach, projectNetWorth, realReturn } from '$lib/realReturn';
	import { getInvestments } from '$lib/investments.svelte';
	import { monthsBefore } from '$lib/priceItems.svelte';
	import { chartHeight } from '$lib/tileGrid';
	import { financeSettings, setProjectionSetting } from '$lib/financeSettings.svelte';

	/**
	 * Net wealth projection at 5, 10 or 20 years, in today's euros: average monthly savings over the
	 * last 12 months (+ loan principal repaid each month), real return of the current mix (2 %
	 * long-term inflation), ± 2 points range. Date of a target, and of the savings goals of the Budget
	 * page. Assumptions are editable and remembered.
	 */

	/**
	 * `show` comes from the block: parts the user unticked are not rendered. `fill` is the content
	 * height of the tile when the user set it: the chart then takes what the other parts leave.
	 */
	let { show = () => true, fill = null }: { show?: BlockShow; fill?: number | null } = $props();

	const SHORT_MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
	const now = new Date();
	const currentMonth = now.toISOString().slice(0, 7);
	const SPREAD = 2;

	/**
	 * Average balance (income − spending) over the last 12 complete months. Loan account rows are left
	 * out: their principal part is added separately (loanPrincipal), only once.
	 */
	const budgetSavings = $derived.by(() => {
		const txs = getBudgetTransactions().filter((t) => !(t.account && t.account in loanState.loans));
		const mm = getMerchantCategoryMap();
		const catOf = (tx: Parameters<typeof categorize>[0]) => categorize(tx, budgetState.overrides, undefined, mm);
		const monthsWithData = new Set(txs.map((t) => t.booking_date.slice(0, 7)));
		return averageSavings(monthsBefore(currentMonth, 12).filter((m) => monthsWithData.has(m)).map((m) => monthTotals(txs, m, catOf).net));
	});
	/** Loan principal repaid each month: debt goes down, wealth goes up. */
	const loanPrincipal = $derived(Math.round([...getLoanViews().values()].filter((l) => l.monthsRemaining > 0).reduce((s, l) => s + l.effectivePayment, 0)));
	const autoSavings = $derived(budgetSavings + loanPrincipal);

	/** Nominal return of the mix (crypto and current accounts at 0 %), then real at 2 % inflation. */
	const autoRealRate = $derived.by(() => {
		const investments = getInvestments();
		const assetsTotal = investments.reduce((s, p) => s + p.montant, 0) + getCryptoTotal();
		const rate = assetsTotal > 0 ? investments.reduce((s, p) => s + p.montant * p.taux, 0) / assetsTotal : 0;
		return Math.round(realReturn(rate, LONG_TERM_INFLATION) * 10) / 10;
	});

	const start = $derived(getNetWorth());
	const savings = $derived(financeSettings.projection.epargne ?? autoSavings);
	const realRate = $derived(financeSettings.projection.reel ?? autoRealRate);
	const years = $derived(financeSettings.projection.annees ?? 10);
	const target = $derived(financeSettings.projection.cible ?? null);

	const central = $derived(projectNetWorth({ depart: start, epargneMois: savings, reel: realRate }, years * 12));
	const low = $derived(projectNetWorth({ depart: start, epargneMois: savings, reel: realRate - SPREAD }, years * 12));
	const high = $derived(projectNetWorth({ depart: start, epargneMois: savings, reel: realRate + SPREAD }, years * 12));

	/** 'mars 2029' for a number of months from today. */
	function dateIn(months: number): string {
		const d = new Date(now.getFullYear(), now.getMonth() + months, 15);
		return `${SHORT_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
	}
	function durationLabel(months: number): string {
		const a = Math.floor(months / 12);
		const m = months % 12;
		return [a ? `${a} an${a > 1 ? 's' : ''}` : '', m ? `${m} mois` : ''].filter(Boolean).join(' ') || 'ce mois-ci';
	}

	const targetReach = $derived.by(() => {
		if (target === null || target <= 0) return null;
		const h = { depart: start, epargneMois: savings };
		return { central: monthsToReach({ ...h, reel: realRate }, target), tot: monthsToReach({ ...h, reel: realRate + SPREAD }, target), tard: monthsToReach({ ...h, reel: realRate - SPREAD }, target) };
	});

	/** Savings goals (Budget page): date reached by putting all of the month's savings into it. */
	const budgetGoals = $derived(
		goalsState.goals
			.filter((g) => g.targetAmount > g.currentAmount)
			.map((g) => {
				const months = monthsToReach({ depart: g.currentAmount, epargneMois: savings, reel: realRate }, g.targetAmount);
				const reachMonth = months === null ? null : (() => { const d = new Date(now.getFullYear(), now.getMonth() + months, 15); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; })();
				return { g, mois: months, avance: g.targetDate && reachMonth ? reachMonth <= g.targetDate.slice(0, 7) : null };
			})
			.slice(0, 3)
	);

	// ---------- Chart ----------
	let width = $state(0);
	let above = $state(0);
	let below = $state(0);
	const H = $derived(chartHeight(fill === null ? null : { h: fill }, above + 8, below, 170, 110));
	const PAD = { top: 10, right: 12, bottom: 20, left: 62 };
	let hover = $state<number | null>(null);

	const geo = $derived.by(() => {
		if (width < 120) return null;
		const n = central.length - 1;
		const values = [...low, ...high, ...(target ? [target] : [])];
		const min = Math.min(0, ...values);
		const max = Math.max(...values, 1);
		const iw = width - PAD.left - PAD.right;
		const ih = H - PAD.top - PAD.bottom;
		const x = (i: number) => PAD.left + (i / n) * iw;
		const y = (v: number) => PAD.top + (1 - (v - min) / (max - min || 1)) * ih;
		const linePath = (s: number[]) => s.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
		const band = `${linePath(high)}${low.map((v, i) => `L${x(n - i).toFixed(1)},${y(low[n - i]!).toFixed(1)}`).join('')}Z`;
		const step = (() => {
			const raw = (max - min) / 4;
			const p = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1))));
			const r = raw / p;
			return (r <= 1 ? 1 : r <= 2 ? 2 : r <= 5 ? 5 : 10) * p;
		})();
		const grid: number[] = [];
		for (let v = Math.ceil(min / step) * step; v <= max; v += step) grid.push(v);
		const ticks = Array.from({ length: years + 1 }, (_, a) => a).filter((a) => years <= 10 || a % 5 === 0);
		return { x, y, central: linePath(central), bande: band, grille: grid, ticks, n };
	});

	function onMove(e: MouseEvent) {
		if (!geo) return;
		const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
		const i = Math.round(((e.clientX - r.left - PAD.left) / (width - PAD.left - PAD.right)) * geo.n);
		hover = Math.max(0, Math.min(geo.n, i));
	}

	const toNumber = (v: string) => Number(v.replace(/[\s  €%]/g, '').replace(',', '.'));
	function setSavings(v: string) {
		setProjectionSetting({ epargne: v.trim() === '' || !Number.isFinite(toNumber(v)) ? undefined : Math.round(toNumber(v)) });
	}
	function setRealRate(v: string) {
		setProjectionSetting({ reel: v.trim() === '' || !Number.isFinite(toNumber(v)) ? undefined : Math.round(toNumber(v) * 10) / 10 });
	}
	function setTarget(v: string) {
		setProjectionSetting({ cible: v.trim() === '' || !(toNumber(v) > 0) ? undefined : Math.round(toNumber(v)) });
	}
	const pct = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toLocaleString('fr-FR', { maximumFractionDigits: 1 })}`;
</script>

<div class="flow-root" bind:clientHeight={above}>
	<div class="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
		<h2 class="label-xs">Projection du patrimoine</h2>
		{#if show('horizon')}
		<div class="flex gap-1" role="group" aria-label="Horizon" use:segmented>
			{#each [5, 10, 20] as a (a)}
				<button type="button" class="chip cursor-pointer {years === a ? 'chip-accent' : 'chip-muted'}" aria-pressed={years === a} onclick={() => setProjectionSetting({ annees: a as 5 | 10 | 20 })}>{a} ans</button>
			{/each}
		</div>
		{/if}
	</div>

	{#if show('hypotheses')}
	<div class="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px]">
		<span class="meta-xs">En euros d'aujourd'hui · départ {formatEUR(start)}</span>
		<label class="flex items-center gap-1">
			épargne
			<input type="text" inputmode="decimal" class="input-surface tabular w-16 !px-1.5 !py-0.5 text-right text-xs" value={String(savings)} aria-label="Épargne par mois (€)" title="Moyenne des 12 derniers mois ({formatEUR(budgetSavings)}){loanPrincipal ? ` + capital des crédits remboursé (${formatEUR(loanPrincipal)})` : ''} — modifiable, vide = calcul automatique" onchange={(e) => setSavings((e.target as HTMLInputElement).value)} />
			€/mois
		</label>
		<label class="flex items-center gap-1">
			rendement réel
			<input type="text" inputmode="decimal" class="input-surface tabular w-12 !px-1.5 !py-0.5 text-right text-xs" value={String(realRate).replace('.', ',')} aria-label="Rendement réel supposé (% par an)" title="Rendement de tes placements actuels (crypto et comptes courants à 0 %) moins {LONG_TERM_INFLATION} % d'inflation de long terme — modifiable, vide = calcul automatique" onchange={(e) => setRealRate((e.target as HTMLInputElement).value)} />
			%/an
		</label>
		{#if financeSettings.projection.epargne !== undefined || financeSettings.projection.reel !== undefined}
			<button type="button" class="meta-xs cursor-pointer hover:underline" onclick={() => setProjectionSetting({ epargne: undefined, reel: undefined })}>↺ calcul auto</button>
		{/if}
	</div>
	{/if}
</div>

{#if show('courbe')}
<div class="relative mt-2" bind:clientWidth={width} style="height: {H}px;">
	{#if geo}
		<svg width={width} height={H} class="block" role="img" aria-label="Patrimoine projeté sur {years} ans : {formatEUR(central[central.length - 1]!)} (fourchette {formatEUR(low[low.length - 1]!)} à {formatEUR(high[high.length - 1]!)})" onmousemove={onMove} onmouseleave={() => (hover = null)}>
			{#each geo.grille as v (v)}
				<line x1={PAD.left} x2={width - PAD.right} y1={geo.y(v)} y2={geo.y(v)} stroke="var(--text)" opacity="0.06" />
				<text x={PAD.left - 6} y={geo.y(v) + 3.5} text-anchor="end" font-size="10" fill="var(--text-secondary)">{formatEURCompact(v)}</text>
			{/each}
			{#each geo.ticks as a (a)}
				<text x={geo.x(a * 12)} y={H - 6} text-anchor="middle" font-size="10" fill="var(--text-secondary)">{now.getFullYear() + a}</text>
			{/each}
			<path d={geo.bande} fill="var(--accent)" opacity="0.12" class="proj-band" />
			{#if target}
				<line x1={PAD.left} x2={width - PAD.right} y1={geo.y(target)} y2={geo.y(target)} stroke="var(--text-secondary)" stroke-dasharray="4 4" opacity="0.7" />
				<text x={width - PAD.right} y={geo.y(target) - 4} text-anchor="end" font-size="10" fill="var(--text-secondary)">objectif {formatEURCompact(target)}</text>
			{/if}
			{#key years}<path d={geo.central} fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" pathLength={1} class="proj-line" />{/key}
			{#if targetReach?.central !== null && targetReach?.central !== undefined && targetReach.central <= geo.n && target}
				<circle cx={geo.x(targetReach.central)} cy={geo.y(target)} r="4" fill="var(--accent)" stroke="var(--surface)" stroke-width="2" />
			{/if}
			{#if hover !== null}
				<line x1={geo.x(hover)} x2={geo.x(hover)} y1={PAD.top} y2={H - PAD.bottom} stroke="var(--text-secondary)" stroke-dasharray="3 3" opacity="0.6" />
				<circle cx={geo.x(hover)} cy={geo.y(central[hover]!)} r="4" fill="var(--accent)" stroke="var(--surface)" stroke-width="2" />
			{/if}
		</svg>
		{#if hover !== null}
			<div class="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-lg border px-2.5 py-1.5 text-xs" style="left: {Math.min(Math.max(geo.x(hover), 80), width - 80)}px; border-color: var(--border); background-color: var(--surface);">
				<p class="text-secondary">{dateIn(hover)}</p>
				<p class="tabular font-medium">{formatEUR(central[hover]!)}</p>
				<p class="meta-xs tabular">{formatEURCompact(low[hover]!)} – {formatEURCompact(high[hover]!)}</p>
			</div>
		{/if}
	{/if}
</div>

{/if}

<div class="flow-root" bind:clientHeight={below}>
	{#if show('resultat')}
	<p class="text-[13px]">
		Dans {years} ans : <b class="tabular">{formatEUR(central[central.length - 1]!)}</b>
		<span class="meta-xs">(entre {formatEUR(low[low.length - 1]!)} et {formatEUR(high[high.length - 1]!)} selon le rendement, {pct(realRate - SPREAD)} à {pct(realRate + SPREAD)} %/an)</span>
	</p>
	{/if}
	{#if show('objectifs')}
	<div class="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
		<label class="flex items-center gap-1">
			Objectif
			<input type="text" inputmode="decimal" class="input-surface tabular w-24 !px-1.5 !py-0.5 text-right text-xs" placeholder="ex. 150 000" value={target ? String(target) : ''} aria-label="Objectif de patrimoine (€)" onchange={(e) => setTarget((e.target as HTMLInputElement).value)} />
			€
		</label>
		{#if targetReach}
			{#if targetReach.central === 0}
				<span style="color: var(--accent);">déjà atteint</span>
			{:else if targetReach.central !== null}
				<span>→ <b>{dateIn(targetReach.central)}</b> <span class="meta-xs">(dans {durationLabel(targetReach.central)}{targetReach.tot !== null && targetReach.tard !== null && targetReach.tard !== targetReach.tot ? ` ; entre ${dateIn(targetReach.tot)} et ${dateIn(targetReach.tard)}` : ''})</span></span>
			{:else}
				<span class="meta-xs" style="color: var(--amber);">pas atteint en 50 ans à ce rythme</span>
			{/if}
		{/if}
	</div>
	{#if budgetGoals.length}
		<ul class="meta-xs mt-1.5 space-y-0.5">
			{#each budgetGoals as o (o.g.id)}
				<li>
					<span style="color: var(--text);">{o.g.name}</span> ({formatEUR(o.g.targetAmount)}) :
					{#if o.mois === null}pas atteint à ce rythme{:else}{dateIn(o.mois)} en y mettant toute ton épargne{#if o.avance !== null}, <span style="color: {o.avance ? 'var(--accent)' : 'var(--amber)'};">{o.avance ? 'avant' : 'après'} ta date cible</span>{/if}{/if}
				</li>
			{/each}
		</ul>
	{/if}
	{/if}
</div>

<style>
	.proj-line {
		stroke-dasharray: 1;
		animation: trace-line 800ms var(--ease-out) backwards;
	}
	.proj-band {
		animation: fade-in 600ms ease-out 300ms backwards;
	}
</style>
