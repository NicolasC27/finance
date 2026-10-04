<script lang="ts">
	import { showToast } from '$lib/ui.svelte';
	import { moduleMeta, type ModuleId } from '$lib/modules';
	import { setModuleActive } from '$lib/modules.svelte';

	/** Page of a switched-off module (link or URL that still leads to it): one line and « Activer ». */
	let { module }: { module: ModuleId } = $props();

	const meta = $derived(moduleMeta(module));

	function enable() {
		const message = setModuleActive(module, true);
		showToast(message, 'Annuler', () => setModuleActive(module, false));
	}
</script>

<div class="card mx-auto mt-8 max-w-md p-4 text-[13px]" role="status">
	<p class="font-medium">Module « {meta.label} » désactivé</p>
	<p class="meta-xs mt-1">{meta.description}</p>
	<p class="meta-xs mt-1">Tes données sont conservées : l'activer le fait revenir tel qu'il était.</p>
	<button type="button" class="btn btn-accent btn-sm mt-3" onclick={enable}>Activer</button>
</div>
