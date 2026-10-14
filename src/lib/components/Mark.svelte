<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { EnvelopeGauge } from '$lib/envelopes';

	/**
	 * Mark of a list row: an icon in a given colour on a tint of that colour, the one way a category,
	 * a schedule group or an account type is shown next to a row (`.mark` in app.css; a dot of the
	 * same colour in compact rows). With a `gauge` the tint fills up from the bottom with the spent
	 * share of the category's envelope, and an alert ring marks an envelope past its budget.
	 */
	let { color, size = 24, title, gauge = null, children }: { color: string; size?: number; title?: string; gauge?: EnvelopeGauge | null; children: Snippet } = $props();
</script>

<span
	class="mark"
	class:mark-gauge={gauge}
	class:mark-over={gauge?.over}
	style="--mark-color: {color}; --mark-size: {size}px;{gauge ? ` --gauge: ${Math.round(gauge.fill * 100)}%;` : ''}"
	{title}
	aria-hidden={title ? undefined : 'true'}
>
	{@render children()}
</span>
