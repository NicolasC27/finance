<script lang="ts">
	import { onMount } from 'svelte';
	import type { BalancePoint } from '$lib/data';
	import { smoothPath } from '$lib/data';
	import { formatEUR, formatEURCompact, formatDate } from '$lib/format';
	import { changePct } from '$lib/chartGeometry';

	/** Automatic marker on the curve (salary in teal, largest expense in amber). */
	export interface ChartAnnotation {
		iso: string; // date of the point to mark
		kind: 'salary' | 'expense';
		label: string;
		amount: number;
		/** Text shown as is (otherwise 'label ±amount'). */
		text?: string;
	}

	/**
	 * Cumulative daily balance curve, 100 % hand-made SVG: Catmull-Rom→Bézier smoothed path, teal
	 * gradient area (defined INSIDE this svg), 3-line grid, 5 X-axis labels, crosshair tooltip on
	 * hover, 900 ms progressive drawing (normalised pathLength) + area fade-in. v4 extensions:
	 * annotations (salary/expense) and a dashed end-of-month projection with a light uncertainty zone.
	 * A new dataset (other month, other asset) redraws the curve; the tooltip shows the change vs the
	 * previous point.
	 */
	let {
		points,
		annotations = [],
		projection = [],
		/** Plot height in px (220 by default, compact mode). */
		height = 220,
		/**
		 * Value format (Y axis and tooltip): compact euros by default; crypto prices = adaptive decimals.
		 */
		formatValue = undefined,
		/** Horizontal dashed reference line (e.g. cost basis) with a label. */
		reference = undefined
	}: { points: BalancePoint[]; annotations?: ChartAnnotation[]; projection?: BalancePoint[]; height?: number; formatValue?: (v: number) => string; reference?: { value: number; label: string } } = $props();

	const uid = $props.id();
	/** Dataset identity: a change replays the drawing (keyed block below). */
	const datasetKey = $derived(points.length ? `${points[0]!.iso}|${points[points.length - 1]!.iso}|${points.length}` : '');
	let firstKey = '';
	$effect(() => {
		if (!firstKey) firstKey = datasetKey;
		else if (datasetKey !== firstKey) {
			firstKey = datasetKey;
			traceDone = false;
		}
	});
	const fmtAxis = $derived(formatValue ?? formatEURCompact);
	const fmtTip = $derived(formatValue ?? formatEUR);

	const HEIGHT = $derived(height);
	const PAD = { top: 12, right: 14, bottom: 26, left: 60 }; // left: Y-axis labels ('0,4343 €' fits)

	const dayFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });
	/** Long range (> 300 days): show the year on the axis, otherwise every date looks alike. */
	const longFmt = new Intl.DateTimeFormat('fr-FR', { month: 'short', year: 'numeric' });

	let container = $state<HTMLDivElement | null>(null);
	let width = $state(0);
	let hover = $state<number | null>(null); // index of the closest point
	/**
	 * The drawing animation plays ONLY on first mount: once finished it is removed from the style so
	 * it never replays (e.g. when the theme changes).
	 */
	let traceDone = $state(false);

	/** Fallback timer in case animationend never fires (hidden tab, animations disabled). */
	onMount(() => {
		const id = window.setTimeout(() => (traceDone = true), 1800);
		const el = container;
		if (!el) return () => window.clearTimeout(id);
		const ro = new ResizeObserver((entries) => {
			const w = entries[0]?.contentRect.width ?? 0;
			width = Math.round(w);
		});
		ro.observe(el);
		return () => {
			window.clearTimeout(id);
			ro.disconnect();
		};
	});

	interface ChartPoint {
		x: number;
		y: number;
		i: number;
	}

	/**
	 * Plotted points: beyond 400 points, one point out of n (the last one is always kept); beyond 120
	 * days, straight segments (Catmull-Rom smoothing creates artificial spikes on a step-like
	 * balance).
	 */
	const drawn = $derived.by((): BalancePoint[] => {
		if (points.length <= 400) return points;
		const step = Math.ceil(points.length / 400);
		const out = points.filter((_, i) => i % step === 0);
		if (out[out.length - 1] !== points[points.length - 1]) out.push(points[points.length - 1]!);
		return out;
	});
	const spanDays = $derived(points.length >= 2 ? (points[points.length - 1]!.date.getTime() - points[0]!.date.getTime()) / 86_400_000 : 0);
	const smooth = $derived(spanDays <= 120);

	/** 'Round' grid step (1, 2, 5 × 10^n). */
	function niceStep(raw: number): number {
		const p = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1e-9))));
		const n = raw / p;
		return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
	}

	/**
	 * Chart geometry: the X axis extends to the end of the projection and the reference line stays in
	 * frame; an 8 % vertical margin keeps the curve off the edges; when the curve crosses zero, the
	 * area is anchored on the zero line (a negative balance is not filled like a positive mass); the
	 * projection is a straight dashed line from the last real point with an uncertainty band growing
	 * from 0 to its maximum at the horizon; each annotation sits on the plotted point closest to its
	 * date (sampled points may miss the exact date), above the local peak (±40 px), shifted when two
	 * labels overlap; the 5 X-axis labels are spread in time rather than by index because points are
	 * not equidistant; the horizontal grid uses round 1-2-5 steps (3 to 5 lines) with the same
	 * projection as the points.
	 */
	const geom = $derived.by(() => {
		if (width < 80 || points.length < 2) return null;
		const t0 = points[0]!.date.getTime();
		const t1 = (projection.length > 0 ? projection[projection.length - 1]!.date : points[points.length - 1]!.date).getTime();
		const tSpan = t1 - t0 || 1;
		const allBalances = [...points, ...projection].map((p) => p.balance);
		if (reference) allBalances.push(reference.value);
		const min = Math.min(...allBalances);
		const max = Math.max(...allBalances);
		const span = max - min || 1;
		const innerW = width - PAD.left - PAD.right;
		const innerH = HEIGHT - PAD.top - PAD.bottom;

		const toXY = (p: BalancePoint, i: number): ChartPoint => {
			const x = PAD.left + ((p.date.getTime() - t0) / tSpan) * innerW;
			const y = PAD.top + (1 - (p.balance - min) / span) * innerH * 0.92 + innerH * 0.04;
			return { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100, i };
		};

		const pts: ChartPoint[] = drawn.map(toXY);

		const line = smooth ? smoothPath(pts.map((p) => [p.x, p.y] as const)) : `M${pts.map((p) => `${p.x},${p.y}`).join(' L')}`;
		const zeroY = min < 0 && max > 0 ? PAD.top + (1 - (0 - min) / span) * innerH * 0.92 + innerH * 0.04 : null;
		const base = zeroY ?? HEIGHT - PAD.bottom;
		const area = `${line} L${pts[pts.length - 1]!.x},${base} L${pts[0]!.x},${base} Z`;

		let projLine = '';
		let projBand = '';
		if (projection.length > 0) {
			const projPts = projection.map(toXY);
			const start = pts[pts.length - 1]!;
			const seq = [start, ...projPts];
			projLine = `M${seq.map((p) => `${p.x},${p.y}`).join(' L')}`;
			const horizon = Math.abs(projection[projection.length - 1]!.balance - points[points.length - 1]!.balance);
			const maxDev = Math.max(40, horizon * 0.45);
			const upper: string[] = [];
			const lower: string[] = [];
			seq.forEach((p, k) => {
				const dev = (k / Math.max(1, seq.length - 1)) * maxDev;
				const dy = (dev / span) * innerH * 0.92;
				upper.push(`${p.x},${Math.round((p.y - dy) * 100) / 100}`);
				lower.unshift(`${p.x},${Math.round((p.y + dy) * 100) / 100}`);
			});
			projBand = `M${[...upper, ...lower].join(' L')} Z`;
		}

		const markers = annotations
			.map((a) => {
				const t = new Date(`${a.iso}T00:00:00`).getTime();
				if (t < t0 - 86_400_000 || t > points[points.length - 1]!.date.getTime() + 86_400_000) return null;
				let best = -1;
				let bd = Infinity;
				drawn.forEach((p, i) => {
					const d = Math.abs(p.date.getTime() - t);
					if (d < bd) {
						bd = d;
						best = i;
					}
				});
				if (best < 0) return null;
				const pt = pts[best]!;
				let top = pt.y;
				for (const q of pts) if (Math.abs(q.x - pt.x) <= 40 && q.y < top) top = q.y;
				return { ...a, pt, top, dy: 0 };
			})
			.filter((m): m is NonNullable<typeof m> => m !== null)
			.sort((a, b) => a.pt.x - b.pt.x);
		for (let i = 1; i < markers.length; i++) {
			const prev = markers[i - 1]!;
			const cur = markers[i]!;
			if (Math.abs(cur.pt.x - prev.pt.x) < 140 && Math.abs(cur.pt.y - prev.pt.y) < 20) cur.dy = prev.dy + 16;
		}

		const allDates = [...points, ...projection].map((p) => p.date);
		const longSpan = tSpan > 300 * 86_400_000;
		const xLabels = Array.from({ length: 5 }, (_, k) => {
			const time = t0 + (k / 4) * tSpan;
			const x = PAD.left + (k / 4) * innerW;
			return { x, text: (longSpan ? longFmt : dayFmt).format(new Date(time)) };
		});

		const step = niceStep(span / 4);
		const gridY: { y: number; value: number }[] = [];
		for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) {
			const y = PAD.top + (1 - (v - min) / span) * innerH * 0.92 + innerH * 0.04;
			gridY.push({ y, value: Math.round(v * 100) / 100 + 0 });
		}

		const refY = reference ? PAD.top + (1 - (reference.value - min) / span) * innerH * 0.92 + innerH * 0.04 : null;

		return { pts, line, area, zeroY, projLine, projBand, markers, xLabels, gridY, min, max, refY };
	});

	/** Hover: point closest to the cursor (nearest point). */
	function onPointerMove(e: PointerEvent) {
		if (!geom) return;
		const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
		const x = e.clientX - rect.left;
		let best = 0;
		let bestDist = Infinity;
		for (const p of geom.pts) {
			const d = Math.abs(p.x - x);
			if (d < bestDist) {
				bestDist = d;
				best = p.i;
			}
		}
		hover = best;
	}

	const hoverPt = $derived(hover !== null && geom ? geom.pts[hover]! : null);
	// Tooltip position clamped inside the card
	const tooltipLeft = $derived(hoverPt && geom ? Math.min(Math.max(hoverPt.x, 76), width - 76) : 0);
	/** Optional annotation on the hovered point (richer tooltip). */
	const hoverAnnotation = $derived(
		hover !== null && geom ? (geom.markers.find((m) => m.pt.i === hover) ?? null) : null
	);
</script>

<div bind:this={container} class="relative w-full" style="height: {HEIGHT}px;">
	{#if geom}
		<svg
			{width}
			height={HEIGHT}
			viewBox="0 0 {width} {HEIGHT}"
			class="block"
			role="img"
			aria-label="Évolution"
			onpointermove={onPointerMove}
			onpointerleave={() => (hover = null)}
		>
			<defs>
				<!-- Gradient INSIDE the same SVG: an external url(#id) is not resolved reliably -->
				<linearGradient id="{uid}-area" x1="0" y1="0" x2="0" y2="1">
					<stop offset="0%" stop-color="var(--accent)" stop-opacity="0.32" />
					<stop offset="100%" stop-color="var(--accent)" stop-opacity="0" />
				</linearGradient>
			</defs>

			<!-- Horizontal grid (opacity 0.06) + value on the left -->
			{#each geom.gridY as g (g.y)}
				<line x1={PAD.left} x2={width - PAD.right} y1={g.y} y2={g.y} stroke="var(--text)" opacity="0.06" />
				<text x={PAD.left - 8} y={g.y + 3.5} text-anchor="end" font-size="10" fill="var(--text-secondary)">{fmtAxis(g.value)}</text>
			{/each}

			<!-- Zero line (negative balance possible): stronger than the grid -->
			{#if geom.zeroY !== null}
				<line x1={PAD.left} x2={width - PAD.right} y1={geom.zeroY} y2={geom.zeroY} stroke="var(--text-secondary)" stroke-width="1" opacity="0.45" />
			{/if}

			<!-- Area under the curve: fades in after the drawing (replayed for a new dataset, see traceDone) -->
			{#key datasetKey}
				<path
					class="balance-area"
					d={geom.area}
					fill="url(#{uid}-area)"
					style={traceDone ? 'animation: none;' : ''}
					onanimationend={(e) => {
						if (e.animationName === 'fade-in') traceDone = true;
					}}
				/>
			{/key}

			<!-- End-of-month projection: light uncertainty band + dashes -->
			{#if geom.projLine}
				<path class="proj-band" d={geom.projBand} fill="var(--accent)" opacity="0.07" />
				<path
					class="proj-band"
					d={geom.projLine}
					fill="none"
					stroke="var(--accent)"
					stroke-width="1.6"
					stroke-linecap="round"
					stroke-dasharray="1 6"
					opacity="0.65"
				/>
			{/if}

			<!-- 2px stroke, teal glow, progressive drawing via normalised pathLength -->
			{#key datasetKey}
			<path
				class="balance-line"
				d={geom.line}
				fill="none"
				stroke="var(--accent)"
				stroke-width={smooth ? 2 : 1.5}
				stroke-linecap="round"
				stroke-linejoin="round"
				pathLength={1}
				stroke-dasharray={1}
				style="animation: {traceDone ? 'none' : 'trace-line 900ms var(--ease-out) backwards'};"
			/>
			{/key}

			<!-- X axis -->
			{#each geom.xLabels as l, i (`${l.text}-${i}`)}
				<text x={l.x} y={HEIGHT - 8} text-anchor="middle" font-size="11" fill="var(--text-secondary)">
					{l.text}
				</text>
			{/each}

			<!-- Reference line (cost basis…) -->
			{#if geom.refY !== null && reference}
				<g class="pointer-events-none">
					<line x1={PAD.left} x2={width - PAD.right} y1={geom.refY} y2={geom.refY} stroke="var(--text-secondary)" stroke-width="1" stroke-dasharray="4 4" opacity="0.8" />
					<text x={width - PAD.right} y={geom.refY - 4} text-anchor="end" font-size="10" fill="var(--text-secondary)">{reference.label} {fmtAxis(reference.value)}</text>
				</g>
			{/if}

			<!-- Annotations: salary (teal) / largest expense (amber) -->
			{#each geom.markers as m (m.kind + m.iso)}
				{@const color = m.kind === 'salary' ? 'var(--accent)' : 'var(--amber)'}
				<!-- Near the edges: label shifted left/right so it does not overlap the min/max bounds -->
				{@const edge = m.pt.x > width * 0.72 ? 'end' : m.pt.x < width * 0.28 ? 'start' : 'middle'}
				{@const labelX = edge === 'end' ? m.pt.x - 10 : edge === 'start' ? m.pt.x + 10 : Math.min(Math.max(m.pt.x, 44), width - 52)}
				<!-- Above the local peak of the curve; below it when close to the top of the frame -->
				{@const labelY = (m.top < 56 ? m.pt.y + 24 : m.top - 12) + (m.top < 56 ? m.dy : -m.dy)}
				<g class="pointer-events-none">
					<circle cx={m.pt.x} cy={m.pt.y} r="7" fill={color} opacity="0.18" />
					<circle cx={m.pt.x} cy={m.pt.y} r="3.5" fill={color} stroke="var(--bg)" stroke-width="2" />
					<!-- Label + signed amount, same shape for every annotation -->
					<!-- Halo in the card colour: the curve no longer crosses the text ('−890 €' read as '+890 €') -->
					<text x={labelX} y={labelY} text-anchor={edge} font-size="11" font-weight="600" fill={color} paint-order="stroke" stroke="var(--surface)" stroke-width="4" stroke-linejoin="round">
						{m.text ?? `${m.label} ${m.kind === 'salary' ? '+' : '−'}${formatEURCompact(m.amount)}`}
					</text>
				</g>
			{/each}

			<!-- Crosshair + point following the cursor -->
			{#if hoverPt}
				<g class="pointer-events-none">
					<line
						x1={hoverPt.x}
						x2={hoverPt.x}
						y1={PAD.top}
						y2={HEIGHT - PAD.bottom}
						stroke="var(--text-secondary)"
						stroke-opacity="0.35"
						stroke-dasharray="3 4"
					/>
					<circle cx={hoverPt.x} cy={hoverPt.y} r="10" fill="var(--accent)" opacity="0.16" />
					<circle cx={hoverPt.x} cy={hoverPt.y} r="4.5" fill="var(--accent)" stroke="var(--surface)" stroke-width="2.5" />
				</g>
			{/if}
		</svg>

		<!-- Tooltip: French date + EUR balance (+ optional annotation) -->
		{#if hoverPt && hover !== null}
			<div
				class="pointer-events-none absolute z-10 -translate-x-1/2 rounded-lg border px-3 py-2 text-xs"
				style="left: {tooltipLeft}px; top: {Math.max(hoverPt.y - (hoverAnnotation ? 98 : 76), 0)}px; border-color: var(--border); background-color: var(--surface);"
			>
				<p class="mb-0.5 font-medium whitespace-nowrap text-secondary capitalize">
					{formatDate(drawn[hover]!.iso)}
				</p>
				<p class="serif text-base whitespace-nowrap" style="color: var(--accent);">
					{fmtTip(drawn[hover]!.balance)}
				</p>
				{#if hover > 0}
					{@const prev = drawn[hover - 1]!.balance}
					{@const cur = drawn[hover]!.balance}
					{@const pct = changePct(prev, cur)}
					{#if cur !== prev}
						<p class="tabular whitespace-nowrap text-[11px]" style="color: {cur > prev ? 'var(--accent)' : 'var(--amber)'};">
							{cur > prev ? '+' : '−'}{fmtTip(Math.abs(cur - prev))}{pct !== null && Math.abs(pct) >= 0.1 ? ` · ${cur > prev ? '+' : '−'}${Math.abs(pct).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %` : ''}
						</p>
					{/if}
				{/if}
				{#if hoverAnnotation}
					<p
						class="tabular mt-1 whitespace-nowrap"
						style="color: {hoverAnnotation.kind === 'salary' ? 'var(--accent)' : 'var(--amber)'};"
					>
						{hoverAnnotation.text ?? `${hoverAnnotation.label} · ${hoverAnnotation.kind === 'salary' ? '+' : '−'}${formatEUR(hoverAnnotation.amount)}`}
					</p>
				{/if}
			</div>
		{/if}

		<!-- Projection legend and min/max bounds removed from the plot (the legend lives in the card header, the Y axis carries the levels) -->
	{:else}
		<div class="flex h-full items-center justify-center text-sm text-secondary">
			{width < 80 ? '' : 'Pas assez de données pour tracer la courbe.'}
		</div>
	{/if}
</div>

<style>
	/* Projection band and dashes: simple fade, once */
	.proj-band {
		animation: fade-in 900ms ease-out 500ms backwards;
	}
</style>
