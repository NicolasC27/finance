<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * Mark of a list row: an icon in a given colour on a tint of that colour, the one way a category,
	 * a schedule group or an account type is shown next to a row (`.mark` in app.css; a dot of the
	 * same colour in compact rows).
	 */
	let { color, size = 24, title, children }: { color: string; size?: number; title?: string; children: Snippet } = $props();
</script>

<span class="mark" style="--mark-color: {color}; --mark-size: {size}px;" {title} aria-hidden={title ? undefined : 'true'}>
	{@render children()}
</span>
