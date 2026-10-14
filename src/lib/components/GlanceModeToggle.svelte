<script module lang="ts">
	/** Display modes of the Accueil page: the daily answer at a glance, or every block. */
	export type AccueilMode = 'glance' | 'deep';
</script>

<script lang="ts">
	import { segmented } from '$lib/actions/segmented';

	/**
	 * « Coup d'œil / À fond » switch of the Accueil page (SPEC-DA, Volet A §2): two pill buttons in
	 * the chip style, the active one tinted accent-soft with accent text (the sliding pill of
	 * `use:segmented`). The parent owns and persists the mode ('budget:accueil-mode').
	 */
	let { mode, onchange }: { mode: AccueilMode; onchange: (mode: AccueilMode) => void } = $props();
</script>

<div class="flex items-center gap-1" role="group" aria-label="Mode d'affichage de l'accueil" use:segmented>
	<button
		type="button"
		class="chip cursor-pointer {mode === 'glance' ? 'chip-accent' : 'chip-muted'}"
		aria-pressed={mode === 'glance'}
		onclick={() => onchange('glance')}>Coup d'œil</button
	>
	<button
		type="button"
		class="chip cursor-pointer {mode === 'deep' ? 'chip-accent' : 'chip-muted'}"
		aria-pressed={mode === 'deep'}
		onclick={() => onchange('deep')}>À fond</button
	>
</div>
