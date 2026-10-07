<script lang="ts">
	import type { SkyIcon } from '$lib/weather';

	/** Weather icon per sky (hand-made, bare 1.5 stroke, colour from currentColor). */
	let { icon, size = 15 }: { icon: SkyIcon; size?: number } = $props();
</script>

<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
	{#if icon === 'sun'}
		<circle cx="12" cy="12" r="4" />
		<path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" />
	{:else if icon === 'cloud-sun'}
		<path d="M9 5.5V4M4.2 7.2l-1-1M5 12H3.5" />
		<path d="M6.5 9.8A3.5 3.5 0 0 1 12 8.2" />
		<path d="M9 19.5h8.5a3 3 0 0 0 .4-6 5 5 0 0 0-9.6-1.4A3.7 3.7 0 0 0 9 19.5z" />
	{:else if icon === 'cloud'}
		<path d="M7.5 18.5h9.5a3.5 3.5 0 0 0 .5-7 5.5 5.5 0 0 0-10.6-1.5A4.3 4.3 0 0 0 7.5 18.5z" />
	{:else if icon === 'fog'}
		<path d="M7.5 13.5h9.5a3.5 3.5 0 0 0 .5-7 5.5 5.5 0 0 0-10.6-1.5A4.3 4.3 0 0 0 7.5 13.5z" />
		<path d="M5 17h14M7 20.5h10" />
	{:else if icon === 'drizzle'}
		<path d="M7.5 14.5h9.5a3.5 3.5 0 0 0 .5-7 5.5 5.5 0 0 0-10.6-1.5A4.3 4.3 0 0 0 7.5 14.5z" />
		<path d="M9 18.5v1.5M13 18.5v1.5M17 18.5v1.5" />
	{:else if icon === 'rain'}
		<path d="M7.5 14h9.5a3.5 3.5 0 0 0 .5-7 5.5 5.5 0 0 0-10.6-1.5A4.3 4.3 0 0 0 7.5 14z" />
		<path d="m9.5 17-1 3.5M13.5 17l-1 3.5M17.5 17l-1 3.5" />
	{:else if icon === 'snow'}
		<path d="M7.5 14h9.5a3.5 3.5 0 0 0 .5-7 5.5 5.5 0 0 0-10.6-1.5A4.3 4.3 0 0 0 7.5 14z" />
		<path d="M9 18h.01M13 20h.01M17 18h.01M11 21h.01M15 17h.01" stroke-width="2.2" />
	{:else if icon === 'showers'}
		<path d="M9 5V3.5M4.2 6.7l-1-1" />
		<path d="M7.5 15h9.5a3.5 3.5 0 0 0 .5-7 5.5 5.5 0 0 0-10.6-1.5A4.3 4.3 0 0 0 7.5 15z" />
		<path d="m10 18-1 3M14.5 18l-1 3" />
	{:else}
		<path d="M7.5 14h9.5a3.5 3.5 0 0 0 .5-7 5.5 5.5 0 0 0-10.6-1.5A4.3 4.3 0 0 0 7.5 14z" />
		<path d="m13 14-2.5 4h3L11 22" />
	{/if}
</svg>
