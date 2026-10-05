<script lang="ts">
	import { smoothPath } from '$lib/data';

	/**
	 * Mini trend curve (hand-made, no axis), ~90×28px: smoothed line drawn in on first render, soft
	 * gradient fill and a ringed dot on the last value.
	 */
	let {
		values,
		color = 'var(--accent)',
		width = 90,
		height = 28,
		class: klass = ''
	}: {
		values: number[];
		color?: string;
		width?: number;
		height?: number;
		class?: string;
	} = $props();

	const uid = $props.id();
	const PAD = 3;

	/** Normalised SVG points (flat line in the middle of the frame when all values are equal). */
	const geometry = $derived.by(() => {
		if (values.length < 2) return null;
		const min = Math.min(...values);
		const max = Math.max(...values);
		const span = max - min || 1;
		const w = width - PAD * 2;
		const h = height - PAD * 2;
		const pts = values.map((v, i) => {
			const x = PAD + (i / (values.length - 1)) * w;
			const y = max === min ? height / 2 : PAD + (1 - (v - min) / span) * h;
			return [Math.round(x * 100) / 100, Math.round(y * 100) / 100] as const;
		});
		const line = smoothPath(pts, 0.16);
		const last = pts[pts.length - 1]!;
		const area = `${line} L${last[0]},${height} L${pts[0]![0]},${height} Z`;
		return { line, area, last };
	});
</script>

{#if geometry}
	<svg {width} {height} viewBox="0 0 {width} {height}" aria-hidden="true" class="shrink-0 overflow-visible {klass}">
		<defs>
			<linearGradient id="{uid}-spark" x1="0" y1="0" x2="0" y2="1">
				<stop offset="0%" stop-color={color} stop-opacity="0.28" />
				<stop offset="100%" stop-color={color} stop-opacity="0" />
			</linearGradient>
		</defs>
		<path d={geometry.area} fill="url(#{uid}-spark)" class="spark-area"></path>
		<path d={geometry.line} fill="none" stroke={color} stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" pathLength={1} class="spark-line"></path>
		<circle cx={geometry.last[0]} cy={geometry.last[1]} r="4.5" fill={color} opacity="0.18" class="spark-dot"></circle>
		<circle cx={geometry.last[0]} cy={geometry.last[1]} r="2.2" fill={color} class="spark-dot"></circle>
	</svg>
{/if}

<style>
	.spark-line {
		stroke-dasharray: 1;
		animation: trace-line 700ms var(--ease-out) backwards;
	}
	.spark-area {
		animation: fade-in 500ms ease-out 300ms backwards;
	}
	.spark-dot {
		animation: fade-in var(--motion-base) ease-out 600ms backwards;
	}
</style>
