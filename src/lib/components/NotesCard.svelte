<script lang="ts">
	import { formatDate } from '$lib/format';
	import { isSectionCollapsed, toggleSectionCollapse } from '$lib/ui.svelte';

	/**
	 * Free notepad, saved automatically (`budget:notes`): ideas, things to check, reminders. Plain
	 * text, no formatting. Covered by backups (budget: prefix). `tall` = fullscreen version.
	 * Standalone it folds on its own (collapsed by default, ~215 px of empty space on the home page,
	 * choice remembered); inside a Block (`collapsible={false}`) the block's collapse is the only one.
	 */
	let {
		tall = false,
		collapsible = true,
		showStatus = true,
		showCount = true
	}: {
		tall?: boolean;
		/** Own fold (▸ / ▾); off inside a Block, which brings its own collapse. */
		collapsible?: boolean;
		/** « enregistré · date heure » status (block element). */
		showStatus?: boolean;
		/** Words and lines count under the text (block element). */
		showCount?: boolean;
	} = $props();

	const KEY = 'budget:notes';
	interface Saved {
		text: string;
		updatedAt: string;
	}
	function load(): Saved {
		try {
			const raw = localStorage.getItem(KEY);
			if (raw) {
				const p = JSON.parse(raw) as Partial<Saved>;
				return { text: typeof p.text === 'string' ? p.text : '', updatedAt: typeof p.updatedAt === 'string' ? p.updatedAt : '' };
			}
		} catch {
		}
		return { text: '', updatedAt: '' };
	}
	const initial = load();
	let text = $state(initial.text);
	let updatedAt = $state(initial.updatedAt);
	let saved = $state(true);
	let timer: number | null = null;

	function schedule() {
		saved = false;
		if (timer !== null) window.clearTimeout(timer);
		timer = window.setTimeout(save, 400);
	}
	function save() {
		timer = null;
		updatedAt = new Date().toISOString();
		try {
			localStorage.setItem(KEY, JSON.stringify({ text, updatedAt }));
			saved = true;
		} catch {
			saved = false;
		}
	}

	const collapsed = $derived(collapsible && !tall && isSectionCollapsed('notes'));
	const lines = $derived(text.split('\n').length);
	const words = $derived(text.trim() ? text.trim().split(/\s+/).length : 0);
</script>

<div class="flex h-full flex-col">
	<div class="mb-2 flex items-center justify-between gap-3">
		{#if collapsible}
			<button type="button" class="label-xs press flex cursor-pointer items-center gap-1.5" aria-expanded={!collapsed} onclick={() => toggleSectionCollapse('notes')}>
				<span aria-hidden="true">{collapsed ? '▸' : '▾'}</span> Bloc-notes{#if collapsed && words > 0}&nbsp;<span class="meta-xs normal-case">· {words} mot{words > 1 ? 's' : ''}</span>{/if}
			</button>
		{:else}
			<p class="label-xs">Bloc-notes</p>
		{/if}
		{#if showStatus}
		<p class="meta-xs">
			{#if !saved}
				enregistrement…
			{:else if updatedAt}
				enregistré · {formatDate(updatedAt.slice(0, 10))} {new Date(updatedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
			{:else}
				vide
			{/if}
		</p>
		{/if}
	</div>
	{#if !collapsed}
	<textarea
		class="input-surface notes-area w-full flex-1 resize-y font-[inherit] text-[13px] leading-relaxed"
		style="min-height: {tall ? '60vh' : '140px'};"
		placeholder="Idées, choses à vérifier, rappels… (sauvegardé automatiquement)"
		spellcheck="true"
		bind:value={text}
		oninput={schedule}
		onblur={() => {
			if (!saved) save();
		}}
	></textarea>
	{#if showCount}
		<p class="meta-xs mt-1.5">{words} mot{words > 1 ? 's' : ''} · {lines} ligne{lines > 1 ? 's' : ''}</p>
	{/if}
	{/if}
</div>

<style>
	.notes-area {
		padding: 10px 12px;
	}
</style>
