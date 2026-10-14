<script lang="ts">
	import { untrack } from 'svelte';
	import MapTile from './MapTile.svelte';
	import { dayColor, type DayView } from '$lib/itinerary';
	import { fitView, isLocated, MAX_ZOOM, MIN_ZOOM, pathKm, project, unproject, visibleTiles, type LonLat, type MapView } from '$lib/geo';

	/**
	 * Map beside the day plan: basemap tiles (Esri's gray canvas, light or dark, the names in a
	 * second layer) through the local server, one numbered pin per located place in its day's
	 * colour, the places of a day joined by a dashed line. Pans with the pointer or the arrow
	 * keys, zooms with the wheel, the
	 * buttons or a double click; fits the places of the trip (or of the focused day) until the
	 * user moves it, ⌖ fits again. Hover and selection are shared with the list through bindable
	 * props. Without any located place it shows the destination, else a corner of Europe.
	 */
	let {
		days,
		focusDay = null,
		hovered = $bindable(null),
		selected = $bindable(null),
		fallback = null,
		fallbackName = '',
		onfocusday
	}: {
		days: DayView[];
		focusDay?: number | null;
		hovered?: string | null;
		selected?: string | null;
		fallback?: LonLat | null;
		fallbackName?: string;
		onfocusday?: (index: number | null) => void;
	} = $props();

	interface Pin {
		id: string;
		day: number;
		n: number;
		name: string;
		lon: number;
		lat: number;
	}

	const HOME: MapView = { center: { lon: 10, lat: 48 }, zoom: MIN_ZOOM };
	const PAN_PX = 80;
	const WHEEL_GAP_MS = 160;

	const pins = $derived<Pin[]>(days.flatMap((d) => (d.day?.places ?? []).flatMap((p, i) => (isLocated(p) ? [{ id: p.id, day: d.index, n: i + 1, name: p.name, lon: p.lon, lat: p.lat }] : []))));
	const scope = $derived(focusDay === null ? pins : pins.filter((p) => p.day === focusDay));
	const focusKm = $derived(focusDay === null ? 0 : pathKm(scope));

	let el = $state<HTMLDivElement | null>(null);
	let width = $state(0);
	let height = $state(0);
	let view = $state<MapView>(HOME);
	let moved = $state(false);
	let dragging = $state(false);
	let dark = $state(typeof document !== 'undefined' && !document.documentElement.classList.contains('light'));
	const style = $derived(dark ? 'dark' : 'light');

	const zoom = $derived(view.zoom);
	const origin = $derived.by(() => {
		const c = project(view.center, zoom);
		return { x: c.x - width / 2, y: c.y - height / 2 };
	});
	const tiles = $derived(visibleTiles(view, width, height));
	const placed = $derived(
		pins.map((p) => {
			const q = project(p, zoom);
			return { ...p, x: q.x - origin.x, y: q.y - origin.y };
		})
	);
	const lines = $derived.by(() => {
		const byDay = new Map<number, string[]>();
		for (const p of placed) byDay.set(p.day, [...(byDay.get(p.day) ?? []), `${p.x.toFixed(1)},${p.y.toFixed(1)}`]);
		return [...byDay].filter(([, pts]) => pts.length > 1).map(([day, pts]) => ({ day, points: pts.join(' ') }));
	});

	/** The view fits the places in scope again when they change (or on the first size), not after the user moved it. */
	const fitKey = $derived(`${focusDay ?? ''}|${scope.map((p) => `${p.lon},${p.lat}`).join(';')}|${fallback ? `${fallback.lon},${fallback.lat}` : ''}`);
	let fittedKey = '';
	function fit() {
		view = fitView(scope, width, height) ?? (fallback ? { center: { lon: fallback.lon, lat: fallback.lat }, zoom: 12 } : HOME);
		moved = false;
	}
	$effect(() => {
		const key = fitKey;
		if (width <= 0 || height <= 0) return;
		const changed = key !== fittedKey;
		fittedKey = key;
		if (changed || !untrack(() => moved)) untrack(fit);
	});

	/** A place selected from the list comes into view (close enough to be read). */
	$effect(() => {
		const id = selected;
		if (!id) return;
		untrack(() => {
			const pin = placed.find((p) => p.id === id);
			if (!pin) return;
			const inside = pin.x >= 24 && pin.x <= width - 24 && pin.y >= 40 && pin.y <= height - 24;
			if (inside && zoom >= 12) return;
			view = { center: { lon: pin.lon, lat: pin.lat }, zoom: Math.max(zoom, 14) };
			moved = true;
		});
	});

	$effect(() => {
		const root = document.documentElement;
		const observer = new MutationObserver(() => (dark = !root.classList.contains('light')));
		observer.observe(root, { attributes: true, attributeFilter: ['class'] });
		return () => observer.disconnect();
	});

	/** Zooms by one level, keeping the point under the pointer (or the centre) in place. */
	function zoomBy(delta: number, px = width / 2, py = height / 2) {
		const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom + delta));
		if (next === zoom) return;
		const c = project(view.center, zoom);
		const under = { x: c.x - width / 2 + px, y: c.y - height / 2 + py };
		const k = 2 ** (next - zoom);
		view = { center: unproject({ x: under.x * k - px + width / 2, y: under.y * k - py + height / 2 }, next), zoom: next };
		moved = true;
	}

	let wheelAt = 0;
	$effect(() => {
		const node = el;
		if (!node) return;
		const onWheel = (e: WheelEvent) => {
			e.preventDefault();
			const now = performance.now();
			if (now - wheelAt < WHEEL_GAP_MS) return;
			wheelAt = now;
			const r = node.getBoundingClientRect();
			zoomBy(e.deltaY < 0 ? 1 : -1, e.clientX - r.left, e.clientY - r.top);
		};
		node.addEventListener('wheel', onWheel, { passive: false });
		return () => node.removeEventListener('wheel', onWheel);
	});

	let drag: { x: number; y: number; cx: number; cy: number; far: boolean } | null = null;
	function onPointerDown(e: PointerEvent) {
		if (e.button !== 0 || (e.target as Element).closest('button, a')) return;
		const c = project(view.center, zoom);
		drag = { x: e.clientX, y: e.clientY, cx: c.x, cy: c.y, far: false };
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}
	function onPointerMove(e: PointerEvent) {
		if (!drag) return;
		const dx = e.clientX - drag.x;
		const dy = e.clientY - drag.y;
		if (!drag.far && Math.hypot(dx, dy) < 3) return;
		drag.far = true;
		dragging = true;
		view = { center: unproject({ x: drag.cx - dx, y: drag.cy - dy }, zoom), zoom };
		moved = true;
	}
	function onPointerUp() {
		if (drag && !drag.far) selected = null;
		drag = null;
		dragging = false;
	}
	function onDblClick(e: MouseEvent) {
		if ((e.target as Element).closest('button, a')) return;
		const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
		zoomBy(1, e.clientX - r.left, e.clientY - r.top);
	}
	function onKeyDown(e: KeyboardEvent) {
		if (e.target !== e.currentTarget) return;
		const pan: Record<string, [number, number]> = { ArrowLeft: [-PAN_PX, 0], ArrowRight: [PAN_PX, 0], ArrowUp: [0, -PAN_PX], ArrowDown: [0, PAN_PX] };
		const step = pan[e.key];
		if (!step) return;
		e.preventDefault();
		const c = project(view.center, zoom);
		view = { center: unproject({ x: c.x + step[0], y: c.y + step[1] }, zoom), zoom };
		moved = true;
	}
</script>

<!-- The map is a widget of its own (pan, zoom, pins): focusable and listening, like a canvas -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
	class="trip-map {dragging ? 'is-dragging' : ''}"
	bind:this={el}
	bind:clientWidth={width}
	bind:clientHeight={height}
	role="application"
	aria-label="Carte du voyage : {pins.length} lieu{pins.length > 1 ? 'x' : ''} placé{pins.length > 1 ? 's' : ''}"
	tabindex="0"
	onpointerdown={onPointerDown}
	onpointermove={onPointerMove}
	onpointerup={onPointerUp}
	onpointercancel={onPointerUp}
	ondblclick={onDblClick}
	onkeydown={onKeyDown}
>
	<div class="trip-map-tiles" aria-hidden="true">
		{#each tiles as t (t.key)}
			<MapTile {style} layer="base" z={t.z} x={t.x} y={t.y} left={t.left} top={t.top} />
		{/each}
	</div>
	<svg class="trip-map-lines" aria-hidden="true" {width} {height}>
		{#each lines as l (l.day)}
			<polyline points={l.points} class={focusDay !== null && focusDay !== l.day ? 'is-dim' : ''} style="stroke: {dayColor(l.day)};" />
		{/each}
	</svg>
	<!-- The names come over the lines of the plan, under the pins -->
	<div class="trip-map-tiles" aria-hidden="true">
		{#each tiles as t (t.key)}
			<MapTile {style} layer="labels" z={t.z} x={t.x} y={t.y} left={t.left} top={t.top} />
		{/each}
	</div>
	{#each placed as p (p.id)}
		<button
			type="button"
			class="trip-map-pin {hovered === p.id || selected === p.id ? 'is-active' : ''} {focusDay !== null && focusDay !== p.day ? 'is-dim' : ''}"
			style="left: {p.x}px; top: {p.y}px; --pin: {dayColor(p.day)};"
			aria-label="{p.name}, jour {p.day + 1}, étape {p.n}"
			aria-pressed={selected === p.id}
			onpointerenter={() => (hovered = p.id)}
			onpointerleave={() => (hovered = null)}
			onfocus={() => (hovered = p.id)}
			onblur={() => (hovered = null)}
			onclick={() => (selected = selected === p.id ? null : p.id)}
		>
			<span class="trip-map-pin-dot tabular">{p.n}</span>
			<span class="trip-map-pin-label">{p.name}</span>
		</button>
	{/each}
	<div class="trip-map-controls">
		<button type="button" class="trip-map-btn" aria-label="Zoomer" title="Zoomer (molette, double clic)" disabled={zoom >= MAX_ZOOM} onclick={() => zoomBy(1)}>+</button>
		<button type="button" class="trip-map-btn" aria-label="Dézoomer" disabled={zoom <= MIN_ZOOM} onclick={() => zoomBy(-1)}>−</button>
		<button type="button" class="trip-map-btn" aria-label="Recadrer sur les lieux" title="Recadrer sur les lieux" disabled={!moved} onclick={fit}>⌖</button>
	</div>
	{#if focusDay !== null}
		<p class="trip-map-focus">
			<i aria-hidden="true" style="background: {dayColor(focusDay)};"></i>
			<span>Jour {focusDay + 1}</span>
			<span class="text-secondary tabular">{scope.length} lieu{scope.length > 1 ? 'x' : ''}{focusKm ? `, ${focusKm.toLocaleString('fr-FR')} km` : ''}</span>
			<button type="button" class="press" onclick={() => onfocusday?.(null)}>tout le voyage</button>
		</p>
	{/if}
	{#if pins.length === 0}
		<p class="trip-map-empty">{fallback && fallbackName ? `${fallbackName}. ` : ''}Les lieux de tes journées se placent ici dès que tu les ajoutes.</p>
	{/if}
	<p class="trip-map-credit">Fond <a href="https://www.esri.com/" target="_blank" rel="noopener noreferrer">Esri</a>, HERE, Garmin, © contributeurs <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a></p>
</div>

<style>
	.trip-map {
		position: relative;
		width: 100%;
		height: 100%;
		min-height: 240px;
		overflow: hidden;
		border-radius: 8px;
		background: var(--surface-2);
		user-select: none;
		touch-action: none;
		cursor: grab;
		outline: none;
	}
	.trip-map:focus-visible {
		box-shadow: inset 0 0 0 2px var(--accent);
	}
	.trip-map.is-dragging {
		cursor: grabbing;
	}
	.trip-map-tiles {
		position: absolute;
		inset: 0;
	}
	.trip-map-lines {
		position: absolute;
		inset: 0;
		pointer-events: none;
	}
	.trip-map-lines polyline {
		fill: none;
		stroke-width: 2;
		stroke-dasharray: 5 4;
		stroke-linejoin: round;
		stroke-linecap: round;
		opacity: 0.85;
	}
	.trip-map-lines polyline.is-dim {
		opacity: 0.2;
	}
	.trip-map-pin {
		position: absolute;
		z-index: 1;
		width: 24px;
		height: 24px;
		padding: 0;
		border: 0;
		background: none;
		transform: translate(-50%, -50%);
		cursor: pointer;
	}
	.trip-map-pin-dot {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		margin: 1px;
		border-radius: 9999px;
		background: var(--pin);
		color: #fff;
		font-size: 11px;
		font-weight: 600;
		line-height: 1;
		box-shadow:
			0 0 0 2px #fff,
			0 1px 4px rgba(0, 0, 0, 0.35);
		transition: transform var(--motion-fast) ease;
	}
	.trip-map-pin.is-active {
		z-index: 2;
	}
	.trip-map-pin.is-active .trip-map-pin-dot {
		transform: scale(1.2);
	}
	.trip-map-pin.is-dim {
		opacity: 0.35;
	}
	.trip-map-pin:focus-visible {
		outline: none;
	}
	.trip-map-pin:focus-visible .trip-map-pin-dot {
		box-shadow:
			0 0 0 2px #fff,
			0 0 0 4px var(--pin);
	}
	.trip-map-pin-label {
		display: none;
		position: absolute;
		left: 50%;
		bottom: calc(100% + 3px);
		transform: translateX(-50%);
		max-width: 220px;
		padding: 2px 7px;
		border-radius: 5px;
		background: var(--surface);
		color: var(--text);
		font-size: 11px;
		font-weight: 500;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		box-shadow: 0 1px 5px rgba(0, 0, 0, 0.25);
		pointer-events: none;
	}
	.trip-map-pin.is-active .trip-map-pin-label {
		display: block;
	}
	.trip-map-controls {
		position: absolute;
		top: 8px;
		right: 8px;
		z-index: 3;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.trip-map-btn {
		width: 28px;
		height: 28px;
		border: 1px solid var(--hairline);
		border-radius: 6px;
		background: var(--surface);
		color: var(--text);
		font-size: 15px;
		line-height: 1;
		cursor: pointer;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
	}
	.trip-map-btn:hover:not(:disabled) {
		background: var(--surface-hover);
	}
	.trip-map-btn:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.trip-map-focus {
		position: absolute;
		top: 8px;
		left: 8px;
		z-index: 3;
		display: flex;
		align-items: center;
		gap: 6px;
		max-width: calc(100% - 56px);
		padding: 3px 9px;
		border: 1px solid var(--hairline);
		border-radius: 9999px;
		background: var(--surface);
		font-size: 11px;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
	}
	.trip-map-focus i {
		flex: none;
		width: 9px;
		height: 9px;
		border-radius: 9999px;
	}
	.trip-map-focus button {
		color: var(--accent);
		cursor: pointer;
	}
	.trip-map-focus button:hover {
		text-decoration: underline;
	}
	.trip-map-empty {
		position: absolute;
		left: 50%;
		top: 50%;
		z-index: 3;
		max-width: 30ch;
		padding: 6px 10px;
		border-radius: 6px;
		background: var(--surface);
		color: var(--text-2);
		font-size: 12px;
		text-align: center;
		transform: translate(-50%, -50%);
		box-shadow: 0 1px 4px rgba(0, 0, 0, 0.15);
		pointer-events: none;
	}
	.trip-map-credit {
		position: absolute;
		right: 6px;
		bottom: 4px;
		z-index: 3;
		padding: 1px 5px;
		border-radius: 4px;
		background: color-mix(in srgb, var(--surface) 82%, transparent);
		color: var(--text-2);
		font-size: 9.5px;
		line-height: 1.4;
	}
	.trip-map-credit a {
		color: inherit;
	}
	.trip-map-credit a:hover {
		text-decoration: underline;
	}
	@media (prefers-reduced-motion: reduce) {
		.trip-map-pin-dot {
			transition: none;
		}
	}
</style>
