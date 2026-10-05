<script lang="ts">
	import { categorize } from '$lib/categories';
	import { budgetState } from '$lib/budget.svelte';
	import { getMerchantCategoryMap } from '$lib/store.svelte';
	import { getBudgetTransactions } from '$lib/transfers.svelte';
	import { isBudgetFlow, lastFlowDate } from '$lib/totals';
	import { flowKind } from '$lib/flow';
	import { signedAmount } from '$lib/data';
	import { merchantLabel } from '$lib/merchant';
	import { cleanLabel, formatEUR, formatEURCompact } from '$lib/format';
	import { uiState } from '$lib/ui.svelte';
	import { navigate } from '$lib/router.svelte';
	import { buildCalendar, type DayTotal } from '$lib/spendCharts';

	/**
	 * Spending calendar (Analyse): one cell per day over up to a year, champagne intensity by quantile
	 * of the spending days, as many weeks as the tile width allows. Hover or arrow keys show the day
	 * total and its top merchants; click or Enter opens that day's operations.
	 */
	let { showSummary = true, showLegend = true }: { showSummary?: boolean; showLegend?: boolean } = $props();

	const DAYS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
	const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
	const LABEL_W = 28;
	const TOP = 16;
	const GAP = 2;
	const LEVELS = ['var(--surface-2)', 'color-mix(in srgb, var(--accent) 28%, var(--surface-2))', 'color-mix(in srgb, var(--accent) 52%, var(--surface-2))', 'color-mix(in srgb, var(--accent) 76%, var(--surface-2))', 'var(--accent)'];

	let width = $state(0);
	let hover = $state<number | null>(null);
	let focusIdx = $state<number | null>(null);

	const days = $derived.by(() => {
		const mm = getMerchantCategoryMap();
		const out = new Map<string, DayTotal>();
		for (const tx of getBudgetTransactions()) {
			if (!isBudgetFlow(tx)) continue;
			const cat = categorize(tx, budgetState.overrides, undefined, mm);
			if (flowKind(cat) !== 'expense') continue;
			const amount = -signedAmount(tx);
			const d = out.get(tx.booking_date) ?? { amount: 0, merchants: new Map<string, number>() };
			d.amount += amount;
			const label = merchantLabel(tx.remittance_information) || cleanLabel(tx.remittance_information);
			d.merchants.set(label, (d.merchants.get(label) ?? 0) + amount);
			out.set(tx.booking_date, d);
		}
		return out;
	});

	const end = $derived(lastFlowDate(getBudgetTransactions()) || new Date().toISOString().slice(0, 10));
	const weeks = $derived(width > 0 ? Math.max(12, Math.min(53, Math.floor((width - LABEL_W) / (9 + GAP)))) : 53);
	const cal = $derived(buildCalendar(days, end, weeks));
	const cell = $derived(width > 0 ? Math.max(8, Math.min(16, Math.floor((width - LABEL_W) / weeks) - GAP)) : 12);
	const svgW = $derived(LABEL_W + weeks * (cell + GAP));
	const svgH = $derived(TOP + 7 * (cell + GAP));

	const active = $derived(hover ?? focusIdx);
	const activeCell = $derived(active !== null ? (cal.cells[active] ?? null) : null);
	const busiest = $derived.by(() => {
		const max = Math.max(...cal.byWeekday);
		return max > 0 ? { day: DAYS[cal.byWeekday.indexOf(max)]!, amount: max } : null;
	});
	const monthTotals = $derived.by(() => {
		const m = new Map<string, number>();
		for (const c of cal.cells) m.set(c.date.slice(0, 7), (m.get(c.date.slice(0, 7)) ?? 0) + c.amount);
		return [...m.entries()];
	});

	const xOf = (col: number) => LABEL_W + col * (cell + GAP);
	const yOf = (row: number) => TOP + row * (cell + GAP);
	const longDate = (d: string) => new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${d}T12:00:00`));

	function openDay(date: string) {
		uiState.txFilter = { from: date, to: date };
		navigate('/transactions');
	}

	function onKey(e: KeyboardEvent) {
		const n = cal.cells.length;
		const i = focusIdx ?? n - 1;
		const moves: Record<string, number> = { ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1, Home: -i, End: n - 1 - i };
		if (e.key in moves) {
			e.preventDefault();
			focusIdx = Math.max(0, Math.min(n - 1, i + moves[e.key]!));
		} else if ((e.key === 'Enter' || e.key === ' ') && focusIdx !== null) {
			e.preventDefault();
			openDay(cal.cells[focusIdx]!.date);
		}
	}
</script>

<div bind:clientWidth={width} class="relative w-full">
	{#if showSummary}
		<p class="meta-xs mb-2">
			{formatEUR(cal.total)} en {weeks} semaines{#if busiest}&nbsp;· jour le plus dépensier : <span style="color: var(--text);">{busiest.day}</span> (≈ {formatEURCompact(busiest.amount)} en moyenne){/if}&nbsp;· {cal.emptyDays} jour{cal.emptyDays > 1 ? 's' : ''} sans dépense
		</p>
	{/if}
	<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
	<svg
		width={svgW}
		height={svgH}
		class="block cursor-pointer"
		role="application"
		tabindex="0"
		aria-label="Calendrier des dépenses : {formatEUR(cal.total)} sur {weeks} semaines. Flèches pour parcourir les jours, Entrée pour voir les opérations."
		onkeydown={onKey}
		onfocus={() => (focusIdx ??= cal.cells.length - 1)}
		onblur={() => (focusIdx = null)}
		onpointerleave={() => (hover = null)}
	>
		{#each cal.months as m (m.key)}
			<text x={xOf(m.col)} y={10} font-size="10" fill="var(--text-secondary)">{MONTHS[Number(m.key.slice(5, 7)) - 1]}</text>
		{/each}
		{#each [0, 2, 4] as r (r)}
			<text x={0} y={yOf(r) + cell - 2} font-size="9" fill="var(--text-secondary)">{DAYS[r]!.slice(0, 3)}</text>
		{/each}
		{#each cal.cells as c, i (c.date)}
			<rect
				x={xOf(c.col)}
				y={yOf(c.row)}
				width={cell}
				height={cell}
				rx={Math.min(3, cell / 4)}
				fill={LEVELS[c.level]}
				class="cal-cell"
				class:cal-active={active === i}
				style="--d: {Math.min(c.col * 8, 420)}ms;"
				role="presentation"
				onpointerenter={() => (hover = i)}
				onclick={() => openDay(c.date)}
			/>
		{/each}
	</svg>

	{#if activeCell}
		{@const left = Math.min(Math.max(xOf(activeCell.col) + cell / 2, 110), Math.max(110, width - 110))}
		<div class="pointer-events-none absolute z-10 -translate-x-1/2 rounded-lg border px-3 py-2 text-xs" style="left: {left}px; top: {(showSummary ? 22 : 0) + yOf(activeCell.row) + cell + 6}px; border-color: var(--border); background-color: var(--surface); min-width: 180px;">
			<p class="font-medium whitespace-nowrap text-secondary first-letter:uppercase">{longDate(activeCell.date)}</p>
			<p class="tabular mt-0.5 text-[13px] font-medium" style="color: {activeCell.amount > 0 ? 'var(--accent)' : 'var(--text-secondary)'};">{activeCell.amount > 0 ? formatEUR(activeCell.amount) : 'Aucune dépense'}</p>
			{#each activeCell.top as t (t.label)}
				<p class="tabular flex justify-between gap-3 whitespace-nowrap"><span class="truncate text-secondary">{t.label}</span><span>{formatEUR(t.amount)}</span></p>
			{/each}
			{#if activeCell.amount > 0}<p class="meta-xs mt-1">clic : voir les opérations</p>{/if}
		</div>
	{/if}

	{#if showLegend}
		<div class="meta-xs mt-2 flex items-center gap-1.5" aria-hidden="true">
			<span>moins</span>
			{#each LEVELS as color, l (l)}
				<span class="inline-block h-2.5 w-2.5 rounded-[3px]" style="background: {color};" title={l === 0 ? 'aucune dépense' : l < 4 ? `jusqu'à ${formatEURCompact(cal.thresholds[l - 1]!)}` : `plus de ${formatEURCompact(cal.thresholds[2])}`}></span>
			{/each}
			<span>plus</span>
		</div>
	{/if}

	<table class="sr-only">
		<caption>Dépenses par mois</caption>
		<tbody>
			{#each monthTotals as [m, total] (m)}
				<tr><th scope="row">{MONTHS[Number(m.slice(5, 7)) - 1]} {m.slice(0, 4)}</th><td>{formatEUR(total)}</td></tr>
			{/each}
		</tbody>
	</table>
</div>

<style>
	.cal-cell {
		animation: cal-in 360ms var(--ease-out) backwards;
		animation-delay: var(--d);
		transition:
			stroke-width var(--motion-fast) ease,
			opacity var(--motion-fast) ease;
		stroke: var(--text);
		stroke-width: 0;
	}
	.cal-active {
		stroke-width: 1.5;
	}
	@keyframes cal-in {
		from {
			opacity: 0;
		}
	}
</style>
