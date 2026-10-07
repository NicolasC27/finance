<script lang="ts">
	import { readsOnWhite } from '$lib/color';
	import { glyphOf, loadGlyphs, type MerchantLogo } from '$lib/merchantLogos';
	import type { Glyph } from '$lib/merchantGlyphs';

	/**
	 * Mark of a known brand: its logo on a white tile (`.mark-brand` in app.css), the way a bank app
	 * shows merchants. A 'brand' glyph is drawn in the brand colour (ink when that colour is too
	 * pale), a 'color' glyph in its own colours, a 'line' glyph in ink. The glyphs load once, on the
	 * first mark shown; the tile paints at once and the logo as soon as they are in. `color` is the
	 * colour of the row's category or group: the dot the mark becomes in compact rows.
	 */
	let { logo, color, size = 24, title = false }: { logo: MerchantLogo; color: string; size?: number; /** Brand name as a tooltip, when the row does not write it. */ title?: boolean } = $props();

	let glyph = $state<Glyph | null>(null);
	$effect(() => {
		const name = logo.name;
		const known = glyphOf(name);
		if (known !== null) {
			glyph = known;
			return;
		}
		void loadGlyphs().then(() => (glyph = glyphOf(name)));
	});
	const px = $derived(Math.round(size * (glyph?.k === 'brand' ? 0.66 : glyph?.k === 'line' ? 0.96 : 0.8)));
	const ink = $derived(glyph?.k === 'brand' && readsOnWhite(logo.color) ? logo.color : '#12161e');
</script>

<span class="mark mark-brand" style="--mark-color: {color}; --mark-size: {size}px; --brand-ink: {ink};" title={title ? logo.name : undefined} aria-hidden={title ? undefined : 'true'}>
	{#if glyph}
		<!-- Trusted markup: bundled glyphs generated from open icon collections (see merchantGlyphs.ts) -->
		<svg width={px} height={px} viewBox={glyph.v} fill="currentColor" aria-hidden="true">{@html glyph.b}</svg>
	{/if}
</span>
