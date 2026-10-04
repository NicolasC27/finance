<script lang="ts">
	import { uiState } from '$lib/ui.svelte';
	import { moduleMeta, type ModuleId } from '$lib/modules';

	/**
	 * The one gear of a module page header: opens « <module> » in the right panel (actions of the
	 * page, then its options); a second click closes it.
	 */
	let { module }: { module: ModuleId } = $props();

	const label = $derived(moduleMeta(module).label);
	const isOpen = $derived(uiState.moduleOptions === module);
</script>

<button
	type="button"
	class="press flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full border text-secondary transition-colors duration-200 hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
	style="border-color: var(--hairline);"
	style:background-color={isOpen ? 'var(--surface-2)' : undefined}
	title="{label} : actions et options"
	aria-label="Actions et options du module {label}"
	aria-expanded={isOpen}
	onclick={() => (uiState.moduleOptions = isOpen ? null : module)}
>
	<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
		<circle cx="12" cy="12" r="3" />
		<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
	</svg>
</button>
