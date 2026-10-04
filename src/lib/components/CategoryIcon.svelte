<script lang="ts">
	import type { CategoryId } from '$lib/types';

	/** SVG icon per category (hand-made, bare 1.5 stroke, colour from currentColor). */
	let { id, size = 15 }: { id: CategoryId; size?: number } = $props();
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
	{#if id === 'alimentation'}
		<!-- Shopping cart -->
		<path d="M3 4h2l2.3 11.1a1.6 1.6 0 0 0 1.6 1.3h7.7a1.6 1.6 0 0 0 1.6-1.3L20 8H6" />
		<circle cx="10" cy="20.2" r="1.1" />
		<circle cx="17" cy="20.2" r="1.1" />
	{:else if id === 'logement'}
		<!-- House -->
		<path d="M4 11.5 12 4l8 7.5" />
		<path d="M6 10.5V20h12v-9.5" />
		<path d="M10.5 20v-5h3v5" />
	{:else if id === 'energie'}
		<!-- Lightning bolt -->
		<path d="M13 2.5 5.5 13.5H11l-1 8 7.5-11H12l1-8z" />
	{:else if id === 'transport'}
		<!-- Train -->
		<rect x="6" y="3.5" width="12" height="13" rx="2.5" />
		<path d="M6 10h12" />
		<path d="M9.5 13.5h.01M14.5 13.5h.01" stroke-width="2.4" />
		<path d="M8.5 16.5 7 20M15.5 16.5 17 20" />
	{:else if id === 'voiture'}
		<!-- Car -->
		<path d="M5 16.5V12l1.8-4.6A2 2 0 0 1 8.7 6h6.6a2 2 0 0 1 1.9 1.4L19 12v4.5" />
		<path d="M3.5 12h17v4.5h-17z" />
		<path d="M7 16.5V19M17 16.5V19" />
		<path d="M7.5 14.2h.01M16.5 14.2h.01" stroke-width="2.4" />
	{:else if id === 'abonnements'}
		<!-- Circular arrows -->
		<path d="M20.5 12a8.5 8.5 0 1 1-2.5-6" />
		<path d="M20.5 3.5v4h-4" />
	{:else if id === 'loisirs'}
		<!-- Star -->
		<path d="m12 3.5 2.5 5.4 5.9.6-4.4 4 1.2 5.8L12 16.4l-5.2 2.9 1.2-5.8-4.4-4 5.9-.6L12 3.5z" />
	{:else if id === 'sante'}
		<!-- Medical cross -->
		<path d="M9.5 4.5h5v5h5v5h-5v5h-5v-5h-5v-5h5v-5z" />
	{:else if id === 'revenus'}
		<!-- Ticket -->
		<rect x="3" y="7" width="18" height="10" rx="2" />
		<circle cx="12" cy="12" r="2.4" />
		<path d="M6.2 10v4M17.8 10v4" />
	{:else if id === 'vacances'}
		<!-- Sun -->
		<circle cx="12" cy="12" r="3.8" />
		<path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" />
	{:else if id === 'impots'}
		<!-- Public building -->
		<path d="M3.5 9 12 4l8.5 5" />
		<path d="M5.5 9.5v8M9.8 9.5v8M14.2 9.5v8M18.5 9.5v8" />
		<path d="M3.5 20h17" />
	{:else if id === 'epargne'}
		<!-- Two-way arrows (transfer between accounts) -->
		<path d="M4 8h14l-3.5-3.5" />
		<path d="M20 16H6l3.5 3.5" />
	{:else}
		<!-- Other: ellipsis -->
		<path d="M6 12h.01M12 12h.01M18 12h.01" stroke-width="3" />
	{/if}
</svg>
