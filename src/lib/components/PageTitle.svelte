<script lang="ts">
	/**
	 * Editorial page title: italic serif kicker ('vue d'ensemble') above a DM Serif Display title,
	 * revealed as split text where each word rises inside an overflow:hidden container (40 ms stagger,
	 * 300 ms). The component is remounted on every route change (custom if/else router), so the
	 * animation replays on every page without dedicated logic.
	 */
	let {
		title,
		/** Kept for compatibility: no longer rendered (density). */
		kicker = '',
		/** Word to set in emphasis italics (first exact occurrence). */
		em = ''
	}: { title: string; kicker?: string; em?: string } = $props();

	const words = $derived(title.split(' '));
</script>

<div>
	<h1 class="page-title" aria-label={title}>
		{#each words as word, i (i)}
			<span class="split-wrap" aria-hidden="true"
				><span class="split-word" class:italic={em !== '' && word === em} style="--i: {i * 40}ms">{word}</span></span
			>{#if i < words.length - 1}{' '}{/if}
		{/each}
	</h1>
</div>
