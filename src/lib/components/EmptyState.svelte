<script lang="ts">
	/**
	 * Illustrated empty state: small hand-made line-art SVG scene (2-3 composed elements: folder +
	 * arrow, key + cloud, magnifier + dots…), teal stroke for the main element, discreet neutral for
	 * the scenery.
	 */
	let {
		icon,
		title,
		text = '',
		ctaLabel = '',
		onCta = undefined,
		/** Single row (20 px icon, title, text, button on the right): for dense cards. */
		inline = false
	}: {
		icon: 'import' | 'key' | 'search' | 'coins';
		title: string;
		text?: string;
		ctaLabel?: string;
		onCta?: (() => void) | undefined;
		inline?: boolean;
	} = $props();
	const size = $derived(inline ? 22 : 44); // 44 px mini scene (centred) or 22 px (inline)
</script>

<div class={inline ? 'flex flex-wrap items-center gap-3 px-3 py-2 text-left' : 'flex flex-1 flex-col items-center justify-center gap-1.5 py-2 text-center'}>
	<span
		class="flex shrink-0 items-center justify-center rounded-full border {inline ? 'p-1.5' : 'p-2.5'}"
		style="border-color: var(--hairline); color: var(--accent);"
		aria-hidden="true"
	>
		<svg
			width={size}
			height={size}
			viewBox="0 0 64 64"
			fill="none"
			stroke="currentColor"
			stroke-width="1.8"
			stroke-linecap="round"
			stroke-linejoin="round"
		>
			{#if icon === 'import'}
				<!-- Import scene: folder (neutral) + join + import arrow (teal) -->
				<g stroke="var(--text-secondary)" opacity="0.55">
					<path d="M10 52a4 4 0 0 1-4-4V20a4 4 0 0 1 4-4h12l5 6h25a4 4 0 0 1 4 4v22a4 4 0 0 1-4 4H10z" />
					<path d="M6 26h50" />
				</g>
				<path d="M32 27v13" />
				<path d="m25.5 33.5 6.5 6.5 6.5-6.5" />
			{:else if icon === 'key'}
				<!-- Kraken scene: cloud (neutral) + API key (teal) -->
				<g stroke="var(--text-secondary)" opacity="0.55" transform="translate(16 5) scale(1.55)" stroke-width="1.15">
					<path d="M18 10h-1.7A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
				</g>
				<circle cx="19" cy="46" r="6.5" />
				<path d="M24.6 41.4 40 26" />
				<path d="m33 32 4.5 4.5M37.5 27.5 42 32" />
			{:else if icon === 'search'}
				<!-- No-result scene: dotted lines (neutral) + magnifier (teal) -->
				<g stroke="var(--text-secondary)" opacity="0.55" stroke-width="2.6" stroke-dasharray="0.1 7">
					<path d="M9 15h28" />
					<path d="M9 25h38" />
					<path d="M9 35h22" />
				</g>
				<circle cx="39" cy="41" r="10.5" />
				<path d="m46.5 48.5 8 8" />
			{:else}
				<!-- Crypto scene: stack of coins (teal) + trend (neutral) -->
				<ellipse cx="23" cy="24" rx="12" ry="5.5" />
				<path d="M11 24v9c0 3 5.4 5.5 12 5.5s12-2.5 12-5.5v-9" />
				<path d="M11 33v9c0 3 5.4 5.5 12 5.5s12-2.5 12-5.5v-9" />
				<g stroke="var(--text-secondary)" opacity="0.55">
					<path d="m38 38 6-7 4.5 3.5L57 25" />
					<path d="M51 25h6v6" />
				</g>
			{/if}
		</svg>
	</span>
	<p class="text-[13px] font-medium {inline ? 'shrink-0' : ''}">{title}</p>
	{#if text}
		<p class="meta-xs {inline ? 'min-w-0 flex-1' : 'max-w-64 text-balance'}">{text}</p>
	{/if}
	{#if ctaLabel && onCta}
		<button
			type="button"
			class={inline ? 'btn btn-secondary btn-sm shrink-0' : 'btn btn-primary mt-1'}
			onclick={onCta}
		>
			{ctaLabel}
		</button>
	{/if}
</div>
