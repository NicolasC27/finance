<script lang="ts">
	import { skyOf, type PhotoWidth } from '$lib/photo';
	import { ensurePhoto, photoFor } from '$lib/photos.svelte';

	/**
	 * Photo layer of a trip (hero or chip thumbnail): the hand-made sky of the trip's name at once,
	 * the destination's banner fading in over it once the local server has it. Fills its positioned
	 * parent; decorative (the text beside it names the trip).
	 */
	let { queries, width, seed }: { queries: readonly string[]; width: PhotoWidth; seed: string } = $props();

	const sky = $derived(skyOf(seed));
	const photo = $derived(photoFor(queries, width));
	/** URL of the image that has finished loading (the fade waits for it). */
	let shown = $state('');

	$effect(() => {
		void ensurePhoto(queries, width);
	});
</script>

<div class="trip-photo" style="--sky-from: {sky.from}; --sky-to: {sky.to}; --sky-glow: {sky.glow};" aria-hidden="true">
	{#if photo}
		<img src={photo.url} alt="" class:loaded={shown === photo.url} decoding="async" onload={() => (shown = photo.url)} />
	{/if}
</div>

<style>
	.trip-photo {
		position: absolute;
		inset: 0;
		overflow: hidden;
		background:
			radial-gradient(ellipse 55% 75% at 74% 12%, color-mix(in srgb, var(--sky-glow) 60%, transparent), transparent 70%),
			linear-gradient(165deg, var(--sky-from), var(--sky-to));
	}
	img {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
		opacity: 0;
		transition: opacity var(--motion-slow) var(--ease-out);
	}
	img.loaded {
		opacity: 1;
	}
	@media (prefers-reduced-motion: reduce) {
		img {
			transition: none;
		}
	}
</style>
