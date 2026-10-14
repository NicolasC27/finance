<script lang="ts">
	import { tileBlob } from '$lib/geo.svelte';
	import type { TileLayer, TileStyle } from '$lib/geo';

	/** One basemap tile: fetched as a blob through the local server, shown once there (the map gives its position). */
	let { style, layer, z, x, y, left, top }: { style: TileStyle; layer: TileLayer; z: number; x: number; y: number; left: number; top: number } = $props();

	let src = $state('');
	$effect(() => {
		let alive = true;
		src = '';
		tileBlob(style, layer, z, x, y).then(
			(url) => {
				if (alive) src = url;
			},
			() => {}
		);
		return () => {
			alive = false;
		};
	});
</script>

{#if src}<img class="map-tile" {src} alt="" draggable="false" style="left: {left}px; top: {top}px;" />{/if}

<style>
	.map-tile {
		position: absolute;
		width: 256px;
		height: 256px;
		pointer-events: none;
		animation: tile-in 200ms ease forwards;
	}
	@keyframes tile-in {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.map-tile {
			animation: none;
		}
	}
</style>
