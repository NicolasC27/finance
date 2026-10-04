<script lang="ts" module>
	/** Donut slice. */
	export interface DonutSlice {
		id: string;
		label: string;
		value: number;
		color: string;
	}
</script>

<script lang="ts">
	import { formatEUR } from '$lib/format';
	import NarrowAmount from './NarrowAmount.svelte';

	/**
	 * Expense donut by category (hand-made SVG arcs), total in the centre. v11 drill-down:
	 * `isSliceClickable` + `onSliceClick` make segments interactive (click, Enter/Space, focusable
	 * role=button); `onCenterClick` turns the centre into a back button.
	 */
	let {
		slices,
		total,
		centerLabel = 'Dépensé',
		isSliceClickable,
		onSliceClick,
		onCenterClick,
		showLegend = true,
		showCenter = true,
		diameter = 180
	}: {
		slices: DonutSlice[];
		total: number;
		centerLabel?: string;
		/** Predicate: a clickable segment triggers onSliceClick (otherwise normal cursor). */
		isSliceClickable?: (slice: DonutSlice) => boolean;
		onSliceClick?: (slice: DonutSlice) => void;
		/** Click on the centre (back to 'Toutes catégories' in drill mode). */
		onCenterClick?: () => void;
		/** Category list next to the ring (block element). */
		showLegend?: boolean;
		/** Total in the centre of the ring (block element). */
		showCenter?: boolean;
		/** Ring diameter in px (scaled drawing; a tile can make it fill its height). */
		diameter?: number;
	} = $props();

	const SIZE = 180;
	const CENTER = SIZE / 2;
	const RADIUS = 64; // median radius of the ring
	const THICKNESS = 20;
	const GAP_DEG = 1.4; // gap between segments
	const EXTRUDE = 5; // radial translation on hover (px)
	const HYSTERESIS_DEG = 0.6; // dead angle at boundaries (anti-flicker)

	/** Geometric segment computed from a slice. */
	interface DonutSegment {
		slice: DonutSlice;
		path: string;
		length: number;
		dx: number;
		dy: number;
		/** Angular territory of the segment (0° = top, clockwise), contiguous bounds. */
		a0: number;
		a1: number;
	}

	function polar(angleDeg: number): [number, number] {
		const rad = ((angleDeg - 90) * Math.PI) / 180;
		return [CENTER + RADIUS * Math.cos(rad), CENTER + RADIUS * Math.sin(rad)];
	}

	const segments = $derived.by((): DonutSegment[] => {
		if (total <= 0) return [];
		let angle = 0;
		return slices.map((slice) => {
			const span = Math.max((slice.value / total) * 360 - GAP_DEG, 0.5);
			const start = angle + GAP_DEG / 2;
			const end = start + span;
			const a0 = angle;
			angle += (slice.value / total) * 360;
			const a1 = angle;
			const [x1, y1] = polar(start);
			const [x2, y2] = polar(end);
			const largeArc = end - start > 180 ? 1 : 0;
			const mid = ((start + end) / 2 - 90) * (Math.PI / 180);
			return {
				slice,
				path: `M${x1.toFixed(2)},${y1.toFixed(2)} A${RADIUS},${RADIUS} 0 ${largeArc} 1 ${x2.toFixed(2)},${y2.toFixed(2)}`,
				length: (RADIUS * ((end - start) * Math.PI)) / 180,
				dx: Math.cos(mid) * EXTRUDE,
				dy: Math.sin(mid) * EXTRUDE,
				a0,
				a1
			};
		});
	});

	/** Clickable segment (drill-down)? Default: no. */
	function clickable(slice: DonutSlice): boolean {
		return onSliceClick !== undefined && (isSliceClickable?.(slice) ?? false);
	}

	/** Keyboard on a segment: Enter/Space triggers the drill-down. */
	function onSegmentKeydown(slice: DonutSlice, e: KeyboardEvent) {
		if (!clickable(slice)) return;
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			onSliceClick?.(slice);
		}
	}

	/** Hovered segment (arc or legend): extrusion + cross highlighting. */
	let hoveredId = $state<string | null>(null);
	let svgEl = $state<SVGSVGElement | null>(null);

	/**
	 * Arc hover by angle (not by pointerenter on the paths): the extrusion translates the path and
	 * would cause enter/leave loops at the edges, while the angle does not change when the segment
	 * moves. A tolerant radial band (± EXTRUDE) absorbs the hover translation. Hysteresis: the current
	 * segment is kept while the angle stays within its territory widened by HYSTERESIS_DEG, and in the
	 * gap between segments (dead zone, anti-flicker).
	 */
	function onDonutMove(e: PointerEvent) {
		if (!svgEl) return;
		const rect = svgEl.getBoundingClientRect();
		if (rect.width === 0 || rect.height === 0) return;
		const x = ((e.clientX - rect.left) / rect.width) * SIZE - CENTER;
		const y = ((e.clientY - rect.top) / rect.height) * SIZE - CENTER;
		const r = Math.hypot(x, y);
		if (r < RADIUS - THICKNESS / 2 - EXTRUDE || r > RADIUS + THICKNESS / 2 + EXTRUDE) {
			hoveredId = null;
			return;
		}
		let deg = (Math.atan2(y, x) * 180) / Math.PI + 90;
		if (deg < 0) deg += 360;
		const current = segments.find((s) => s.slice.id === hoveredId);
		if (current && deg >= current.a0 - HYSTERESIS_DEG && deg <= current.a1 + HYSTERESIS_DEG) return;
		const hit = segments.find((s) => deg >= s.a0 && deg <= s.a1);
		if (hit) hoveredId = hit.slice.id;
		else if (!current) hoveredId = null;
	}

	function onDonutLeave() {
		hoveredId = null;
	}
</script>

{#if segments.length > 0}
	<div class="flex flex-wrap items-center justify-center gap-4 sm:gap-5">
		<div class="relative shrink-0" style="width: {diameter}px; height: {diameter}px;">
			<svg
				bind:this={svgEl}
				width={diameter}
				height={diameter}
				viewBox="0 0 {SIZE} {SIZE}"
				role="img"
				aria-label="Répartition des dépenses par catégorie"
				onpointermove={onDonutMove}
				onpointerleave={onDonutLeave}
			>
				{#each segments as seg, i (seg.slice.id)}
					{@const hovered = hoveredId === seg.slice.id}
					{@const isClickable = clickable(seg.slice)}
					{@const segStyle = `--trace-len: ${seg.length}px; animation-delay: ${i * 80}ms; transform: ${
						hovered ? `translate(${seg.dx.toFixed(2)}px, ${seg.dy.toFixed(2)}px)` : 'translate(0, 0)'
					};`}
					{#if isClickable}
						<!-- Clickable segment (drill-down): focusable button, Enter/Space -->
						<path
							d={seg.path}
							fill="none"
							stroke={seg.slice.color}
							stroke-width={THICKNESS}
							stroke-linecap="butt"
							stroke-dasharray={seg.length}
							class="donut-segment donut-segment-clickable"
							style={segStyle}
							role="button"
							tabindex="0"
							aria-label="Voir le détail de {seg.slice.label} : {formatEUR(seg.slice.value)}"
							onclick={() => onSliceClick?.(seg.slice)}
							onkeydown={(e) => onSegmentKeydown(seg.slice, e)}
						>
							<title>{seg.slice.label} — {formatEUR(seg.slice.value)}</title>
						</path>
					{:else}
						<path
							d={seg.path}
							fill="none"
							stroke={seg.slice.color}
							stroke-width={THICKNESS}
							stroke-linecap="butt"
							stroke-dasharray={seg.length}
							class="donut-segment"
							style={segStyle}
							role="img"
							aria-label="{seg.slice.label} : {formatEUR(seg.slice.value)}"
						>
							<title>{seg.slice.label} — {formatEUR(seg.slice.value)}</title>
						</path>
					{/if}
				{/each}
			</svg>
			<!-- Total in the centre of the donut (back button in drill-down mode) -->
			{#if !showCenter}
				{#if onCenterClick}
					<button type="button" class="absolute inset-0 cursor-pointer rounded-full" aria-label="Revenir à toutes les catégories" title="Revenir à toutes les catégories" onclick={onCenterClick}></button>
				{/if}
			{:else if onCenterClick}
				<button
					type="button"
					class="absolute inset-0 flex cursor-pointer flex-col items-center justify-center rounded-full transition-colors hover:bg-[var(--surface-hover)]"
					aria-label="Revenir à toutes les catégories"
					title="Revenir à toutes les catégories"
					onclick={onCenterClick}
				>
					<span class="label-plain pointer-events-none !text-[10px]">{centerLabel}</span>
					<span class="pointer-events-none mt-0.5 text-[14px] font-semibold"><NarrowAmount value={total} /></span>
				</button>
			{:else}
				<div class="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
					<span class="label-plain !text-[10px]">{centerLabel}</span>
					<span class="mt-0.5 text-[14px] font-semibold"><NarrowAmount value={total} /></span>
				</div>
			{/if}
		</div>

		<!-- Legend synced with the arc hover (wraps under the donut when the card is narrow) -->
		{#if showLegend}
		<ul class="min-w-0 flex-1 basis-52 space-y-0">
			{#each segments as seg (seg.slice.id)}
				{@const hovered = hoveredId === seg.slice.id}
				{@const isClickable = clickable(seg.slice)}
				<li
					class="rounded-lg px-2 py-0.5 text-[13px] transition-colors duration-150"
					style="background-color: {hovered ? 'var(--surface-hover)' : 'transparent'};"
					onpointerenter={() => (hoveredId = seg.slice.id)}
					onpointerleave={() => (hoveredId = null)}
				>
					{#if isClickable}
						<button
							type="button"
							class="flex w-full cursor-pointer items-center gap-2.5 text-left"
							onclick={() => onSliceClick?.(seg.slice)}
						>
							<span class="h-2.5 w-2.5 shrink-0 rounded-full" style="background-color: {seg.slice.color};"></span>
							<span class="min-w-0 flex-1 truncate">{seg.slice.label}</span>
							<span class={hovered ? '' : 'text-secondary'}><NarrowAmount value={seg.slice.value} /></span>
						</button>
					{:else}
						<div class="flex items-center gap-2.5">
							<span class="h-2.5 w-2.5 shrink-0 rounded-full" style="background-color: {seg.slice.color};"></span>
							<span class="min-w-0 flex-1 truncate">{seg.slice.label}</span>
							<span class={hovered ? '' : 'text-secondary'}><NarrowAmount value={seg.slice.value} /></span>
						</div>
					{/if}
				</li>
			{/each}
		</ul>
		{/if}
	</div>
{:else}
	<div class="flex h-[180px] items-center justify-center text-sm text-secondary">
		Aucune dépense sur ce mois.
	</div>
{/if}

<style>
	/* Progressive drawing on load + smooth extrusion on hover */
	.donut-segment {
		animation: donut-trace 700ms ease-out both;
		transition: transform 200ms ease;
	}
	/* Clickable segments (drill-down): cursor + visible keyboard focus */
	.donut-segment-clickable {
		cursor: pointer;
	}
	.donut-segment-clickable:focus-visible {
		outline: none;
		filter: brightness(1.12);
	}
</style>
