<script lang="ts">
	import { onMount } from 'svelte';
	import { fetchCryptoNews, relativeAge, isSafeHttpUrl, type CryptoNewsItem } from '$lib/cryptoNews';

	/**
	 * Discreet news card for the top held asset (SPEC v14 §G). Offline or endpoint error: the card
	 * simply stays hidden (fetchCryptoNews never throws). External http(s) links only, rel=noopener
	 * noreferrer.
	 */

	let { symbol }: { symbol: string } = $props();

	let rawItems = $state<CryptoNewsItem[]>([]);
	// Defence in depth: no non-http(s) link reaches the DOM
	const items = $derived(rawItems.filter((n) => isSafeHttpUrl(n.url)));
	let now = $state(Date.now());

	onMount(() => {
		let cancelled = false;
		void fetchCryptoNews(symbol).then((news) => {
			if (!cancelled) rawItems = news;
		});
		const tick = window.setInterval(() => (now = Date.now()), 60_000);
		return () => {
			cancelled = true;
			window.clearInterval(tick);
		};
	});
</script>

{#if items.length > 0}
	<div class="mt-4 border-t pt-4" style="border-color: var(--border-subtle);">
		<p class="meta-xs mb-2 uppercase" style="letter-spacing: 0.14em;">Actualités {symbol}</p>
		<ul class="divide-y divide-[var(--border-subtle)]">
			{#each items as item (item.id)}
				<li>
					<a
						href={item.url}
						target="_blank"
						rel="noopener noreferrer"
						class="group block py-2.5 transition-colors"
					>
						<p
							class="serif text-[15px] leading-snug transition-colors group-hover:text-[var(--accent)]"
						>
							{item.title}
						</p>
						<p class="meta-xs mt-1">{item.source} · {relativeAge(item.publishedAt, now)}</p>
					</a>
				</li>
			{/each}
		</ul>
	</div>
{/if}
