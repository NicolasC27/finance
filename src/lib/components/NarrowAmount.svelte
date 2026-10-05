<script lang="ts">
	import { formatEURNarrowParts, sensitiveEURNarrowParts } from '$lib/format';

	/**
	 * Static narrow amount: the 'k€' suffix sits in a span with neutral kerning (see
	 * `.amount-suffix`), never glued to the number under tracking.
	 */
	let { value, sensitive = false }: { value: number; sensitive?: boolean } = $props();
	const parts = $derived((sensitive ? sensitiveEURNarrowParts : formatEURNarrowParts)(value));
</script>

<span class="tabular"
	>{parts.main}{#if parts.suffix}<span class="amount-suffix">{parts.suffix}</span>{/if}</span
>
