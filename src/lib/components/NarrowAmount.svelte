<script lang="ts">
	import { formatEURNarrowParts } from '$lib/format';

	/**
	 * Static narrow amount: the 'k€' suffix sits in a span with neutral kerning (see
	 * `.amount-suffix`), never glued to the number under tracking.
	 */
	let { value }: { value: number } = $props();
	const parts = $derived(formatEURNarrowParts(value));
</script>

<span class="tabular"
	>{parts.main}{#if parts.suffix}<span class="amount-suffix">{parts.suffix}</span>{/if}</span
>
