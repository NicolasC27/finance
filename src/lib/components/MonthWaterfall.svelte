<script lang="ts">
	import type { CategoryId } from '$lib/types';
	import { categorize, getCategory } from '$lib/categories';
	import { budgetState } from '$lib/budget.svelte';
	import { getMerchantCategoryMap } from '$lib/store.svelte';
	import { getBudgetTransactions } from '$lib/transfers.svelte';
	import { monthTotals } from '$lib/totals';
	import { formatEUR, formatEURCompact, formatMonth } from '$lib/format';
	import { barPath } from '$lib/chartGeometry';
	import { growArray } from '$lib/motion.svelte';
	import { waterfallSteps } from '$lib/spendCharts';

	/**
	 * Month waterfall (Budget): income, then each expense category (largest first, the tail folded into
	 * « Autres »), then what is left. Floating bars with dashed connectors, amounts on top, hover =
	 * share of income. Bars grow on first render and morph when the month changes.
	 */
	let { month, height = 220, showAmounts = true }: { month: string; height?: number; showAmounts?: boolean } = $props();

	const PAD = { top: 18, right: 8, bottom: 30, left: 52 };
	let width = $state(0);
	let hover = $state<number | null>(null);

	const steps = $derived.by(() => {
		const mm = getMerchantCategoryMap();
		const t = monthTotals(getBudgetTransactions(), month, (tx): CategoryId => categorize(tx, budgetState.overrides, undefined, mm));
		const items = [...t.byCategory.entries()].map(([id, amount]) => ({ id, label: getCategory(id).label, amount, color: getCategory(id).color }));
		return { income: t.income, list: waterfallSteps(t.income, items, Math.max(3, Math.min(8, Math.floor((width - PAD.left) / 70) - 2))) };
	});

	const animated = growArray(() => steps.list.flatMap((s) => [s.from, s.to]));

	const geo = $derived.by(() => {
		const list = steps.list;
		if (width < 160 || list.length < 2) return null;
		const vals = list.flatMap((s) => [s.from, s.to]);
		const min = Math.min(0, ...vals);
		const max = Math.max(1, ...vals);
		const innerW = width - PAD.left - PAD.right;
		const innerH = height - PAD.top - PAD.bottom;
		const slot = innerW / list.length;
		const barW = Math.max(10, Math.min(46, slot * 0.62));
		const yOf = (v: number) => PAD.top + (1 - (v - min) / (max - min || 1)) * innerH;
		const a = animated.current.length === vals.length ? animated.current : vals;
		const bars = list.map((s, i) => {
			const from = a[i * 2]!;
			const to = a[i * 2 + 1]!;
			const x = PAD.left + slot * i + (slot - barW) / 2;
			const path = s.kind === 'expense' ? barPath(x, barW, yOf(Math.max(from, to)), yOf(Math.min(from, to)), 3) : barPath(x, barW, yOf(from), yOf(to), 4);
			return { s, x, cx: x + barW / 2, path, top: Math.min(yOf(from), yOf(to)) };
		});
		const step = (() => {
			const raw = (max - min) / 4;
			const p = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1))));
			const n = raw / p;
			return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
		})();
		const grid: number[] = [];
		for (let v = Math.ceil(min / step) * step; v <= max; v += step) grid.push(v);
		return { bars, barW, slot, yOf, grid, zeroY: yOf(0) };
	});

	const colorOf = (kind: string, color: string | undefined, to: number) => (kind === 'income' ? 'var(--accent)' : kind === 'result' ? (to >= 0 ? 'var(--accent)' : 'var(--amber)') : (color ?? 'var(--debit)'));
	const share = (amount: number) => (steps.income > 0 ? `${Math.round((Math.abs(amount) / steps.income) * 100)} % des revenus` : '');
</script>

<div bind:clientWidth={width} class="relative w-full" style="height: {height}px;">
	{#if geo}
		<svg {width} {height} class="block" role="img" aria-label="Cascade de {formatMonth(month)} : {steps.list.map((s) => `${s.label} ${formatEUR(s.kind === 'expense' ? -s.amount : s.amount)}`).join(', ')}" onpointerleave={() => (hover = null)}>
			{#each geo.grid as v (v)}
				<line x1={PAD.left} x2={width - PAD.right} y1={geo.yOf(v)} y2={geo.yOf(v)} stroke="var(--text)" opacity={v === 0 ? 0.3 : 0.06} />
				<text x={PAD.left - 6} y={geo.yOf(v) + 3.5} text-anchor="end" font-size="10" fill="var(--text-secondary)">{formatEURCompact(v)}</text>
			{/each}
			{#each geo.bars as b, i (b.s.id)}
				{#if i < geo.bars.length - 1}
					{@const next = geo.bars[i + 1]!}
					<line x1={b.x + geo.barW} x2={next.x} y1={geo.yOf(b.s.to)} y2={geo.yOf(b.s.to)} stroke="var(--text-secondary)" stroke-dasharray="2 3" opacity="0.5" />
				{/if}
				<rect x={b.x - (geo.slot - geo.barW) / 2} y={0} width={geo.slot} height={height - 4} fill="transparent" role="presentation" onpointerenter={() => (hover = i)} />
				{#if b.path}
					<path d={b.path} fill={colorOf(b.s.kind, b.s.color, b.s.to)} class="wf-bar pointer-events-none" style="opacity: {hover === null || hover === i ? 0.95 : 0.4};" />
				{/if}
				{#if showAmounts}
					<text x={b.cx} y={b.top - 5} text-anchor="middle" font-size="10" fill="var(--text)" class="tabular pointer-events-none">{b.s.kind === 'expense' ? '−' : b.s.to < 0 ? '−' : ''}{formatEURCompact(Math.abs(b.s.kind === 'expense' ? b.s.amount : b.s.to))}</text>
				{/if}
				<text x={b.cx} y={height - 12} text-anchor="middle" font-size="10" fill={b.s.kind === 'expense' ? 'var(--text-secondary)' : 'var(--text)'} class="pointer-events-none">{b.s.label.length > 11 ? `${b.s.label.slice(0, 10)}…` : b.s.label}</text>
			{/each}
		</svg>
		{#if hover !== null}
			{@const b = geo.bars[hover]!}
			<div class="pointer-events-none absolute z-10 -translate-x-1/2 rounded-lg border px-3 py-2 text-xs" style="left: {Math.min(Math.max(b.cx, 90), width - 90)}px; top: {Math.max(0, b.top - 64)}px; border-color: var(--border); background-color: var(--surface);">
				<p class="font-medium whitespace-nowrap">{b.s.label}</p>
				<p class="tabular whitespace-nowrap" style="color: {colorOf(b.s.kind, b.s.color, b.s.to)};">{b.s.kind === 'expense' ? '−' : ''}{formatEUR(Math.abs(b.s.kind === 'result' ? b.s.to : b.s.amount))}</p>
				{#if b.s.kind !== 'income' && share(b.s.kind === 'result' ? b.s.to : b.s.amount)}<p class="meta-xs whitespace-nowrap">{share(b.s.kind === 'result' ? b.s.to : b.s.amount)}</p>{/if}
				{#if b.s.kind === 'expense'}<p class="meta-xs tabular whitespace-nowrap">reste {formatEUR(b.s.to)}</p>{/if}
			</div>
		{/if}
	{:else}
		<div class="flex h-full items-center justify-center text-sm text-secondary">{width < 160 ? '' : 'Pas de mouvement ce mois-ci.'}</div>
	{/if}
</div>

<style>
	.wf-bar {
		transition: opacity var(--motion-base) ease;
	}
</style>
