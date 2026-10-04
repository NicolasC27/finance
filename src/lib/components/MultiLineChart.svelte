<script lang="ts">
	import { onMount } from 'svelte';
	import { smoothPath } from '$lib/data';
	import { formatEUR, formatEURCompact, formatMonth } from '$lib/format';

	export interface LineSeries {
		id: string;
		label: string;
		color: string;
		values: number[];
		/** Dashed drawing (e.g. moving average). */
		dashed?: boolean;
	}

	/**
	 * Overlaid monthly curves (Analyse page): one point per month, several series, hover = vertical
	 * guide + values of every series, click on a month = `onPick(monthIndex)`. Average of each series
	 * as a light dashed line.
	 */
	let {
		months,
		series,
		height = 240,
		showMean = true,
		onPick
	}: { months: string[]; series: LineSeries[]; height?: number; showMean?: boolean; onPick?: (monthIndex: number) => void } = $props();

	const PAD = { top: 10, right: 14, bottom: 24, left: 56 };
	let container = $state<HTMLDivElement | null>(null);
	let width = $state(0);
	let hover = $state<number | null>(null);

	onMount(() => {
		const el = container;
		if (!el) return;
		const ro = new ResizeObserver((entries) => (width = Math.round(entries[0]?.contentRect.width ?? 0)));
		ro.observe(el);
		return () => ro.disconnect();
	});

	/**
	 * Grid: 4 lines on round values; X labels: every month up to 12, otherwise one in two or three.
	 */
	const geom = $derived.by(() => {
		if (width < 80 || months.length < 2 || series.length === 0) return null;
		const all = series.flatMap((s) => s.values);
		const min = Math.min(0, ...all);
		const max = Math.max(0, ...all);
		const span = max - min || 1;
		const innerW = width - PAD.left - PAD.right;
		const innerH = height - PAD.top - PAD.bottom;
		const xOf = (i: number) => PAD.left + (i / (months.length - 1)) * innerW;
		const yOf = (v: number) => PAD.top + (1 - (v - min) / span) * innerH * 0.94 + innerH * 0.03;
		const lines = series.map((s) => {
			const pts = s.values.map((v, i) => [xOf(i), yOf(v)] as const);
			const mean = s.values.reduce((a, b) => a + b, 0) / s.values.length;
			return { s, path: smoothPath(pts, 0.18), pts, meanY: yOf(mean), mean };
		});
		const step = niceStep(span / 4);
		const gridY: { y: number; value: number }[] = [];
		for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) gridY.push({ y: yOf(v), value: Math.round(v * 100) / 100 });
		const every = months.length <= 12 ? 1 : months.length <= 24 ? 2 : 3;
		const labels = months.map((m, i) => ({ x: xOf(i), text: i % every === 0 ? shortMonth(m, months.length > 12) : '' }));
		return { lines, gridY, labels, xOf, zeroY: min < 0 ? yOf(0) : null };
	});

	function niceStep(raw: number): number {
		const p = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1))));
		const n = raw / p;
		return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
	}

	function shortMonth(key: string, withYear: boolean): string {
		const [y, m] = key.split('-');
		const name = new Intl.DateTimeFormat('fr-FR', { month: 'short' }).format(new Date(Number(y), Number(m) - 1, 1)).replace('.', '');
		return withYear && (m === '01' || key === months[0]) ? `${name} ${y!.slice(2)}` : name;
	}

	function onMove(e: MouseEvent) {
		if (!geom) return;
		const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
		const x = e.clientX - rect.left;
		let best = 0;
		let bd = Infinity;
		for (let i = 0; i < months.length; i++) {
			const d = Math.abs(geom.xOf(i) - x);
			if (d < bd) {
				bd = d;
				best = i;
			}
		}
		hover = best;
	}

	const tooltipLeft = $derived.by(() => {
		if (!geom || hover === null) return 0;
		const x = geom.xOf(hover);
		return Math.min(Math.max(x, 90), width - 90);
	});
</script>

<div bind:this={container} class="relative w-full" style="height: {height}px;">
	{#if geom}
		<svg
			{width}
			{height}
			class="block {onPick ? 'cursor-pointer' : ''}"
			role="button"
			tabindex="0"
			aria-label="Courbes mensuelles"
			onmousemove={onMove}
			onmouseleave={() => (hover = null)}
			onclick={() => {
				if (hover !== null) onPick?.(hover);
			}}
			onkeydown={(e) => {
				if (e.key === 'Enter' && hover !== null) onPick?.(hover);
			}}
		>
			{#each geom.gridY as g (g.value)}
				<line x1={PAD.left} x2={width - PAD.right} y1={g.y} y2={g.y} stroke="var(--text)" opacity="0.06" />
				<text x={PAD.left - 8} y={g.y + 3.5} text-anchor="end" font-size="10" fill="var(--text-secondary)">{formatEURCompact(g.value)}</text>
			{/each}
			{#if geom.zeroY !== null}
				<line x1={PAD.left} x2={width - PAD.right} y1={geom.zeroY} y2={geom.zeroY} stroke="var(--text-secondary)" opacity="0.35" />
			{/if}
			{#each geom.labels as l (l.x)}
				{#if l.text}
					<text x={l.x} y={height - 7} text-anchor="middle" font-size="10" fill="var(--text-secondary)">{l.text}</text>
				{/if}
			{/each}
			{#each geom.lines as ln (ln.s.id)}
				{#if showMean && !ln.s.dashed}
					<line x1={PAD.left} x2={width - PAD.right} y1={ln.meanY} y2={ln.meanY} stroke={ln.s.color} stroke-width="1" stroke-dasharray="3 5" opacity="0.45" />
				{/if}
				<path d={ln.path} fill="none" stroke={ln.s.color} stroke-width={ln.s.dashed ? 1.4 : 2} stroke-dasharray={ln.s.dashed ? '2 4' : undefined} stroke-linecap="round" stroke-linejoin="round" opacity={ln.s.dashed ? 0.7 : 1} />
			{/each}
			{#if hover !== null}
				<line x1={geom.xOf(hover)} x2={geom.xOf(hover)} y1={PAD.top} y2={height - PAD.bottom} stroke="var(--text-secondary)" stroke-width="1" stroke-dasharray="3 3" opacity="0.6" />
				{#each geom.lines as ln (ln.s.id)}
					{#if !ln.s.dashed}
						<circle cx={ln.pts[hover]![0]} cy={ln.pts[hover]![1]} r="4" fill={ln.s.color} stroke="var(--bg)" stroke-width="2" />
					{/if}
				{/each}
			{/if}
		</svg>
		{#if hover !== null}
			<div class="pointer-events-none absolute top-1 z-10 -translate-x-1/2 rounded-lg border px-3 py-2 text-xs" style="left: {tooltipLeft}px; border-color: var(--border); background-color: var(--surface);">
				<p class="mb-1 font-medium whitespace-nowrap text-secondary capitalize">{formatMonth(months[hover]!)}</p>
				{#each geom.lines as ln (ln.s.id)}
					{#if !ln.s.dashed}
						<p class="tabular flex items-center gap-1.5 whitespace-nowrap">
							<span class="inline-block h-2 w-2 rounded-full" style="background-color: {ln.s.color};"></span>
							<span class="text-secondary">{ln.s.label}</span>
							<span class="ml-auto pl-3 font-medium">{formatEUR(ln.s.values[hover]!)}</span>
						</p>
					{/if}
				{/each}
				{#if onPick}<p class="meta-xs mt-1">clic : voir les opérations</p>{/if}
			</div>
		{/if}
	{:else}
		<div class="flex h-full items-center justify-center text-sm text-secondary">
			{months.length < 2 ? 'Il faut au moins deux mois de données.' : 'Choisissez une série à afficher.'}
		</div>
	{/if}
</div>
