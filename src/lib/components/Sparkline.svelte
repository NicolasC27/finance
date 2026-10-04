<script lang="ts">
	/** Mini trend curve (hand-made, no axis), ~90×28px. */
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

	const PAD = 2; // margin so the stroke is not clipped

	/** Normalised SVG points (flat line in the middle of the frame when all values are equal). */
	const geometry = $derived.by(() => {
		if (values.length < 2) return { line: '', area: '' };
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
		const line = pts.map(([x, y]) => `${x},${y}`).join(' ');
		const area = `M${pts[0][0]},${height - PAD} L${pts.map(([x, y]) => `${x},${y}`).join(' L')} L${pts[pts.length - 1][0]},${height - PAD} Z`;
		return { line, area };
	});
</script>

{#if values.length > 1}
	<svg {width} {height} viewBox="0 0 {width} {height}" aria-hidden="true" class="shrink-0 {klass}">
		<path d={geometry.area} fill={color} opacity="0.12"></path>
		<polyline
			points={geometry.line}
			fill="none"
			stroke={color}
			stroke-width="1.8"
			stroke-linecap="round"
			stroke-linejoin="round"
		></polyline>
	</svg>
{/if}
