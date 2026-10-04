<script lang="ts">
	import { onMount } from 'svelte';
	import { formatEUR, formatEURCompact, formatMonth } from '$lib/format';

	/**
	 * Signed monthly bars (savings: green above zero, amber below) with an optional second series as a
	 * thin bar (invested savings) and a dashed average line.
	 */
	let {
		months,
		values,
		secondary = [],
		secondaryLabel = '',
		height = 180,
		onPick
	}: { months: string[]; values: number[]; secondary?: number[]; secondaryLabel?: string; height?: number; onPick?: (monthIndex: number) => void } = $props();

	const PAD = { top: 8, right: 10, bottom: 24, left: 56 };
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

	const geom = $derived.by(() => {
		if (width < 80 || months.length === 0) return null;
		const all = [...values, ...secondary];
		const min = Math.min(0, ...all);
		const max = Math.max(0, ...all);
		const span = max - min || 1;
		const innerW = width - PAD.left - PAD.right;
		const innerH = height - PAD.top - PAD.bottom;
		const slot = innerW / months.length;
		const barW = Math.max(3, Math.min(26, slot * 0.55));
		const yOf = (v: number) => PAD.top + (1 - (v - min) / span) * innerH;
		const zeroY = yOf(0);
		const mean = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
		const bars = months.map((m, i) => {
			const v = values[i] ?? 0;
			const sv = secondary[i] ?? 0;
			const x = PAD.left + slot * i + slot / 2;
			return { i, m, x, v, sv, y: Math.min(zeroY, yOf(v)), h: Math.abs(zeroY - yOf(v)), sy: yOf(sv), sh: Math.abs(zeroY - yOf(sv)) };
		});
		const every = months.length <= 12 ? 1 : months.length <= 24 ? 2 : 3;
		return { bars, barW, slot, zeroY, meanY: yOf(mean), mean, every, labelY: height - 7 };
	});

	function shortMonth(key: string): string {
		const [y, m] = key.split('-');
		const name = new Intl.DateTimeFormat('fr-FR', { month: 'short' }).format(new Date(Number(y), Number(m) - 1, 1)).replace('.', '');
		return months.length > 12 && (m === '01' || key === months[0]) ? `${name} ${y!.slice(2)}` : name;
	}
</script>

<div bind:this={container} class="relative w-full" style="height: {height}px;">
	{#if geom}
		<svg {width} {height} class="block {onPick ? 'cursor-pointer' : ''}" role="img" aria-label="Épargne par mois" onmouseleave={() => (hover = null)}>
			<line x1={PAD.left} x2={width - PAD.right} y1={geom.zeroY} y2={geom.zeroY} stroke="var(--text-secondary)" opacity="0.4" />
			<text x={PAD.left - 8} y={geom.zeroY + 3.5} text-anchor="end" font-size="10" fill="var(--text-secondary)">0 €</text>
			{#if Math.abs(geom.meanY - geom.zeroY) > 6}
				<line x1={PAD.left} x2={width - PAD.right} y1={geom.meanY} y2={geom.meanY} stroke="var(--accent)" stroke-width="1" stroke-dasharray="3 5" opacity="0.6" />
				<text x={PAD.left - 8} y={geom.meanY + 3.5} text-anchor="end" font-size="10" fill="var(--accent)">{formatEURCompact(geom.mean)}</text>
			{/if}
			{#each geom.bars as b (b.m)}
				<!-- hover area: the whole month slot -->
				<rect
					x={b.x - geom.slot / 2}
					y={PAD.top}
					width={geom.slot}
					height={height - PAD.top - PAD.bottom}
					fill={hover === b.i ? 'var(--text)' : 'transparent'}
					opacity={hover === b.i ? 0.04 : 0}
					role="presentation"
					onmouseenter={() => (hover = b.i)}
					onclick={() => onPick?.(b.i)}
				/>
				<rect x={b.x - geom.barW / 2} y={b.y} width={geom.barW} height={Math.max(b.h, b.v === 0 ? 0 : 1.5)} rx="2" fill={b.v >= 0 ? 'var(--accent)' : 'var(--amber)'} opacity={hover === null || hover === b.i ? 0.9 : 0.55} class="pointer-events-none" />
				{#if b.sv > 0}
					<rect x={b.x + geom.barW / 2 + 1} y={b.sy} width={Math.max(2, geom.barW * 0.3)} height={b.sh} rx="1" fill="var(--text-secondary)" opacity="0.6" class="pointer-events-none" />
				{/if}
				{#if b.i % geom.every === 0}
					<text x={b.x} y={geom.labelY} text-anchor="middle" font-size="10" fill="var(--text-secondary)">{shortMonth(b.m)}</text>
				{/if}
			{/each}
		</svg>
		{#if hover !== null}
			{@const b = geom.bars[hover]!}
			<div class="pointer-events-none absolute top-1 z-10 -translate-x-1/2 rounded-lg border px-3 py-2 text-xs" style="left: {Math.min(Math.max(b.x, 90), width - 90)}px; border-color: var(--border); background-color: var(--surface);">
				<p class="mb-0.5 font-medium whitespace-nowrap text-secondary capitalize">{formatMonth(b.m)}</p>
				<p class="tabular whitespace-nowrap font-medium" style="color: {b.v >= 0 ? 'var(--accent)' : 'var(--amber)'};">{b.v >= 0 ? '+' : '−'}{formatEUR(Math.abs(b.v))}</p>
				{#if secondaryLabel && b.sv > 0}<p class="tabular whitespace-nowrap text-secondary">{secondaryLabel} {formatEUR(b.sv)}</p>{/if}
			</div>
		{/if}
	{:else}
		<div class="flex h-full items-center justify-center text-sm text-secondary">Aucun mois à afficher.</div>
	{/if}
</div>
