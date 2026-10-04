<script lang="ts">
	import type { AccountKind } from '$lib/csvCore';

	/** SVG icon per account type (hand-made, bare 1.5 stroke, colour from currentColor). */
	let { kind, size = 15 }: { kind: AccountKind; size?: number } = $props();
</script>

<svg
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width="1.5"
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
>
	{#if kind === 'courant'}
		<!-- Bank building: pediment, columns, base -->
		<path d="M4 9.5 12 4l8 5.5" />
		<path d="M6 9.5v7M10 9.5v7M14 9.5v7M18 9.5v7" />
		<path d="M4 19.5h16" />
	{:else if kind === 'livret'}
		<!-- Open book -->
		<path d="M12 6.5C10 5 7.5 4.6 4.5 5v13c3-.4 5.5 0 7.5 1.5 2-1.5 4.5-1.9 7.5-1.5V5c-3-.4-5.5 0-7.5 1.5z" />
		<path d="M12 6.5v13" />
	{:else if kind === 'pret'}
		<!-- Return arrow (schedule to repay) -->
		<path d="M4 10h11a4.5 4.5 0 0 1 0 9H8" />
		<path d="m7.5 6.5-3.5 3.5 3.5 3.5" />
	{:else if kind === 'crypto'}
		<!-- Plain diamond (stripped-down ₿) -->
		<path d="M12 3.5 20 12l-8 8.5L4 12l8-8.5z" />
		<path d="M12 8.5v7" />
	{:else}
		<!-- Other: dotted circle -->
		<circle cx="12" cy="12" r="7.5" />
		<path d="M12 12h.01" stroke-width="2.4" />
	{/if}
</svg>
