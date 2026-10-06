<script lang="ts">
	import { readableInk } from '$lib/color';
	import { glyphOf, loadGlyphs, type MerchantLogo } from '$lib/merchantLogos';

	/**
	 * Mark of a known brand: its glyph on its brand colour, in white or black, whichever reads
	 * better (`.mark-brand` in app.css). The glyphs load once, on the first mark shown; the tile
	 * paints its colour at once and the glyph as soon as they are in. `color` is the colour of the
	 * row's category or group: the dot the mark becomes in compact rows.
	 */
	let { logo, color, size = 24, title = false }: { logo: MerchantLogo; color: string; size?: number; /** Brand name as a tooltip, when the row does not write it. */ title?: boolean } = $props();

	const glyph = $derived(Math.round(size * 0.7));
	let path = $state<string | null>(null);
	$effect(() => {
		const name = logo.name;
		const known = glyphOf(name);
		if (known !== null) {
			path = known;
			return;
		}
		void loadGlyphs().then(() => (path = glyphOf(name)));
	});
</script>

<span class="mark mark-brand" style="--mark-color: {color}; --mark-size: {size}px; --brand: {logo.color}; --brand-ink: {readableInk(logo.color)};" title={title ? logo.name : undefined} aria-hidden={title ? undefined : 'true'}>
	{#if path}
		<svg width={glyph} height={glyph} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d={path} /></svg>
	{/if}
</span>
