<script lang="ts">
	import { toggleCompactRows, uiState } from '$lib/ui.svelte';

	/** Toggle of the compact rows, shown on the pages that hold a long list (same preference everywhere). */
</script>

<button
	type="button"
	class="chip cursor-pointer {uiState.compactRows ? 'chip-accent' : 'chip-outline'}"
	aria-pressed={uiState.compactRows}
	title="Lignes compactes : les longues listes sur une ligne, un point de couleur à la place de l'icône, fond alterné"
	onclick={toggleCompactRows}
>
	<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
		<path d="M4 6h16M4 10h16M4 14h16M4 18h16" />
	</svg>
	Compact
</button>
