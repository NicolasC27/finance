<script lang="ts">
	import type { Snippet } from 'svelte';
	import { lighten } from '$lib/color';

	/**
	 * SVG progress ring: two-tone gradient (colour → 25 % lighter), round caps, animated drawing on
	 * load then dashoffset transition. The gradient is defined INSIDE the same <svg> (reliable
	 * url(#id)).
	 */
	let {
		ratio,
		color,
		size = 72,
		stroke = 8,
		delay = 0,
		over = false,
		children
	}: {
		/** Consumed fraction (0..1+, clamped to 1 for drawing). */
		ratio: number;
		color: string;
		size?: number;
		stroke?: number;
		/** Entrance animation offset (stagger). */
		delay?: number;
		/** Overrun: centre tinted dark amber. */
		over?: boolean;
		/** Centred content (e.g. percentage). */
		children?: Snippet;
	} = $props();

	const r = $derived((size - stroke) / 2);
	const c = $derived(2 * Math.PI * r);
	const frac = $derived(Math.min(Math.max(ratio, 0), 1));
	const offset = $derived(c * (1 - frac));
	// unique id per colour+size, sanitised (a `var(--amber)` would break url(#…))
	const gradId = $derived(`ring-${color.replace(/[^a-z0-9]/gi, '')}-${size}`);
	const lighter = $derived(lighten(color, 0.25));
	/** Centre text size proportional to the inner diameter: '171 %' fits in a 52 px ring. */
	const fontSize = $derived(Math.max(9, Math.round((size - stroke * 2) * 0.28)));
</script>

<div class="relative shrink-0" style="width: {size}px; height: {size}px;">
	<svg width={size} height={size} viewBox="0 0 {size} {size}" class="-rotate-90" aria-hidden="true">
		<defs>
			<linearGradient id={gradId} x1="0" y1="1" x2="1" y2="0">
				<stop offset="0%" stop-color={color} />
				<stop offset="100%" stop-color={lighter} />
			</linearGradient>
		</defs>
		<circle cx={size / 2} cy={size / 2} {r} fill="none" stroke="var(--surface-hover)" stroke-width={stroke} />
		<circle
			class="ring-progress"
			cx={size / 2}
			cy={size / 2}
			{r}
			fill="none"
			stroke="url(#{gradId})"
			stroke-width={stroke}
			stroke-linecap="round"
			stroke-dasharray={c}
			stroke-dashoffset={offset}
			style="--ring-c: {c}px; animation-delay: {delay}ms;"
		/>
	</svg>
	{#if children}
		<span
			class="tabular absolute inset-0 flex items-center justify-center font-semibold whitespace-nowrap"
			style="font-size: {fontSize}px; letter-spacing: -0.02em; {over ? 'color: var(--accent-2);' : ''}"
		>
			{@render children()}
		</span>
	{/if}
</div>

<style>
	/* Ring: fill animated on load (from 0 %), then transitions */
	.ring-progress {
		animation: ring-in 350ms ease-out backwards;
		transition: stroke-dashoffset 350ms ease-out;
	}

	@keyframes ring-in {
		from {
			stroke-dashoffset: var(--ring-c);
		}
	}
</style>
