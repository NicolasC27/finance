<script lang="ts">
	import { Tween } from 'svelte/motion';
	import { cubicOut } from 'svelte/easing';
	import { formatEURNarrowParts, sensitiveEURNarrowParts } from '$lib/format';

	/**
	 * Amount animated as a count-up with Svelte 5 Tween. With `flash` (crypto tickers): teal (up) /
	 * amber (down) overlay for 400 ms on each update, skipped on first render. With `narrow`: 'k€'
	 * format whose suffix sits in a span with neutral kerning (fixes the €/k collision under display
	 * tracking).
	 */
	let {
		value,
		format = (v: number) => v.toFixed(0),
		flash = false,
		narrow = false,
		sensitive = false
	}: { value: number; format?: (v: number) => string; flash?: boolean; narrow?: boolean; sensitive?: boolean } = $props();

	// Reduced motion (system preference): value shown directly
	const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
	const displayed = new Tween(0, { duration: reduced ? 0 : 900, easing: cubicOut });

	let flashDir = $state<'up' | 'down' | null>(null);
	let mounted = false;

	// Restarts the animation on every value change
	$effect(() => {
		const next = value;
		const prev = displayed.target;
		displayed.target = next;
		if (!flash) return;
		if (!mounted) {
			mounted = true;
			return;
		}
		if (next === prev) return;
		flashDir = next > prev ? 'up' : 'down';
		const timer = window.setTimeout(() => (flashDir = null), 420);
		return () => window.clearTimeout(timer);
	});
</script>

<span class="{flash ? 'price-ticker' : ''} {flashDir === 'up' ? 'flash-up' : flashDir === 'down' ? 'flash-down' : ''}">
	<span class="tabular"
		>{#if narrow}{@const parts = (sensitive ? sensitiveEURNarrowParts : formatEURNarrowParts)(displayed.current)}{parts.main}{#if parts.suffix}<span class="amount-suffix">{parts.suffix}</span>{/if}{:else}{format(displayed.current)}{/if}</span
	>
</span>
