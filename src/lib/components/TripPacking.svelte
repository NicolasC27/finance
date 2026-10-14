<script lang="ts">
	import { showToast } from '$lib/ui.svelte';
	import { destinationKey, destinationState } from '$lib/destination.svelte';
	import { addPackItems, applyPackTemplates, copyPackingFrom, removePackItem, resetPacking, setPacking, togglePackForgot, togglePackItem, tripsState } from '$lib/trips.svelte';
	import { cleanPackItem, groupPacking, PACK_CATEGORIES, PACK_TEMPLATES, packingProgress, weatherProfile, weatherSuggestions, type PackCategory, type PackTemplateId, type WeatherProfile } from '$lib/packing';
	import { newId, photoQueries, tripPhase, type Trip } from '$lib/trips';

	/**
	 * Packing list of a trip: items by category with a checkbox, quantity and « commun » mark;
	 * templates to start from, a past trip's list to copy, suggestions from the weather (the
	 * forecast when the departure is close, or three toggles); after the trip, what was missing
	 * is ticked « oublié » and comes first when the list is copied next time.
	 */
	let { trip, show, today }: { trip: Trip; show: (id: string) => boolean; today: string } = $props();

	const progress = $derived(packingProgress(trip.packing));
	const groups = $derived(groupPacking(show('faits') ? trip.packing : trip.packing.filter((i) => !i.done)));
	const after = $derived(tripPhase(trip, today).kind === 'after');
	const others = $derived(tripsState.trips.filter((t) => t.id !== trip.id && t.packing.length > 0));

	const info = $derived(destinationState.info[destinationKey(photoQueries({ ...trip, photo: '' }))]);
	const forecast = $derived(info?.daily?.length ? weatherProfile(info.daily) : null);
	let manual = $state<WeatherProfile>({ hot: false, cold: false, rain: false });
	const profile = $derived(forecast ?? manual);
	const suggestions = $derived(show('suggestions') ? weatherSuggestions(profile, trip.packing, trip.travellers, () => '') : []);

	let label = $state('');
	let category = $state<PackCategory>('divers');
	let qty = $state('1');
	let shared = $state(false);

	function submit(e: SubmitEvent) {
		e.preventDefault();
		const item = cleanPackItem({ label, category, qty, shared }, () => newId('pk'));
		if (!item) return;
		addPackItems(trip.id, [item]);
		label = '';
		qty = '1';
		shared = false;
	}

	function applyTemplate(e: Event & { currentTarget: HTMLSelectElement }) {
		const id = e.currentTarget.value as PackTemplateId | '';
		e.currentTarget.value = '';
		if (!id) return;
		const n = applyPackTemplates(trip.id, [id]);
		showToast(n ? `${n} article${n > 1 ? 's' : ''} ajouté${n > 1 ? 's' : ''} depuis le modèle` : 'Tout y était déjà');
	}

	function copyFrom(e: Event & { currentTarget: HTMLSelectElement }) {
		const id = e.currentTarget.value;
		e.currentTarget.value = '';
		if (!id) return;
		const n = copyPackingFrom(trip.id, id);
		showToast(`${n} article${n > 1 ? 's' : ''} repris`);
	}

	function remove(itemId: string, name: string) {
		const before = trip.packing;
		const id = trip.id;
		removePackItem(id, itemId);
		showToast(`« ${name} » retiré`, 'Annuler', () => setPacking(id, before));
	}

	const accept = (s: (typeof suggestions)[number]) => addPackItems(trip.id, [{ ...s, id: newId('pk') }]);
	const PROFILE_LABELS: Record<keyof WeatherProfile, string> = { hot: 'Chaud', cold: 'Froid', rain: 'Pluie' };
</script>

<div class="flex flex-wrap items-center justify-between gap-2">
	<h2 class="label-xs">Valise</h2>
	{#if progress.total}
		<p class="meta-xs flex items-center gap-2 tabular">
			<span>{progress.done}/{progress.total}</span>
			<span class="pack-progress" role="img" aria-label="{Math.round((progress.done / progress.total) * 100)} % prêt"><i style="width: {(progress.done / progress.total) * 100}%"></i></span>
			{#if progress.done}<button type="button" class="press cursor-pointer hover:underline" onclick={() => resetPacking(trip.id)}>tout décocher</button>{/if}
		</p>
	{/if}
</div>

<div class="mt-2 flex flex-wrap items-center gap-2 text-[12px]">
	<select class="input-surface cursor-pointer py-0.5 text-[12px]" aria-label="Partir d’un modèle" value="" onchange={applyTemplate}>
		<option value="">{trip.packing.length ? 'Ajouter un modèle…' : 'Partir d’un modèle…'}</option>
		{#each PACK_TEMPLATES.filter((t) => t.id !== 'base') as t (t.id)}<option value={t.id}>{t.label}</option>{/each}
	</select>
	{#if others.length}
		<select class="input-surface cursor-pointer py-0.5 text-[12px]" aria-label="Reprendre la valise d’un autre voyage" value="" onchange={copyFrom}>
			<option value="">Reprendre la valise de…</option>
			{#each others as t (t.id)}<option value={t.id}>{t.name}</option>{/each}
		</select>
	{/if}
	{#if show('suggestions')}
		<span class="meta-xs ml-auto flex items-center gap-1">
			{forecast ? 'Prévisions :' : 'Météo prévue :'}
			{#each ['hot', 'cold', 'rain'] as const as key (key)}
				<button type="button" class="press chip {profile[key] ? 'chip-accent' : 'chip-outline'} cursor-pointer" aria-pressed={profile[key]} disabled={forecast !== null} onclick={() => (manual = { ...manual, [key]: !manual[key] })}>{PROFILE_LABELS[key]}</button>
			{/each}
		</span>
	{/if}
</div>

{#if suggestions.length}
	<p class="mt-2 flex flex-wrap items-center gap-1.5 text-[12px]">
		<span class="meta-xs">À prévoir :</span>
		{#each suggestions as s (s.label)}
			<button type="button" class="press chip chip-outline cursor-pointer hover:bg-[var(--surface-hover)]" onclick={() => accept(s)}>+ {s.label}</button>
		{/each}
	</p>
{/if}

{#if trip.packing.length === 0}
	<p class="meta-xs mt-3">Rien dans la valise. Pars d’un modèle (l’essentiel vient avec), ou ajoute tes articles un à un.</p>
{:else}
	<div class="pack-groups mt-3">
		{#each groups as g (g.category.id)}
			<section class="pack-group">
				<h3 class="meta-xs">{g.category.label}</h3>
				<ul class="mt-1">
					{#each g.items as i (i.id)}
						<li class="pack-item">
							<label class="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
								<input type="checkbox" class="accent-[var(--accent)]" checked={i.done} onchange={() => togglePackItem(trip.id, i.id)} />
								<span class="min-w-0 truncate {i.done ? 'text-secondary line-through' : ''}">{i.label}</span>
								{#if i.qty > 1}<span class="meta-xs tabular">×{i.qty}</span>{/if}
								{#if i.shared}<span class="chip chip-outline">commun</span>{/if}
								{#if i.forgot}<span class="chip chip-amber">oublié</span>{/if}
							</label>
							<span class="pack-tools">
								{#if after}<button type="button" class="press" aria-pressed={i.forgot} title="Manquait sur place" onclick={() => togglePackForgot(trip.id, i.id)}>oublié</button>{/if}
								<button type="button" class="press" aria-label="Retirer « {i.label} »" onclick={() => remove(i.id, i.label)}>×</button>
							</span>
						</li>
					{/each}
				</ul>
			</section>
		{/each}
	</div>
	{#if !show('faits') && progress.done}<p class="meta-xs mt-2">{progress.done} article{progress.done > 1 ? 's' : ''} coché{progress.done > 1 ? 's' : ''} masqué{progress.done > 1 ? 's' : ''} (menu du bloc pour les voir).</p>{/if}
{/if}

{#if show('ajout')}
	<form class="mt-3 flex flex-wrap items-center gap-2 text-[12px]" onsubmit={submit}>
		<input type="text" class="input-surface min-w-0 flex-[2_1_10rem] py-1" placeholder="Article à emporter" maxlength="80" bind:value={label} aria-label="Nouvel article" />
		<select class="input-surface cursor-pointer py-1" bind:value={category} aria-label="Catégorie">
			{#each PACK_CATEGORIES as c (c.id)}<option value={c.id}>{c.label}</option>{/each}
		</select>
		<input type="number" min="1" max="99" class="input-surface tabular w-16 py-1" bind:value={qty} aria-label="Quantité" />
		<label class="flex items-center gap-1 text-[12px]"><input type="checkbox" class="accent-[var(--accent)]" bind:checked={shared} /> commun</label>
		<button type="submit" class="btn btn-secondary btn-sm" disabled={!label.trim()}>Ajouter</button>
	</form>
{/if}

<style>
	.pack-progress {
		display: inline-block;
		width: 5rem;
		height: 3px;
		border-radius: 9999px;
		background: var(--border-subtle);
		overflow: hidden;
	}
	.pack-progress i {
		display: block;
		height: 100%;
		border-radius: inherit;
		background: var(--accent);
		transition: width var(--motion-base) var(--ease-out);
	}
	.pack-groups {
		columns: 1;
		column-gap: 1.5rem;
		font-size: 13px;
	}
	@media (min-width: 640px) {
		.pack-groups {
			columns: 2;
		}
	}
	.pack-group {
		break-inside: avoid;
		margin-bottom: 0.75rem;
	}
	.pack-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 2px 4px;
		border-radius: 5px;
	}
	.pack-item:hover {
		background: var(--surface-2);
	}
	.pack-tools {
		display: inline-flex;
		align-items: center;
		gap: 2px;
		opacity: 0;
		transition: opacity var(--motion-fast) ease;
	}
	.pack-item:hover .pack-tools,
	.pack-item:focus-within .pack-tools {
		opacity: 1;
	}
	@media (hover: none) {
		.pack-tools {
			opacity: 0.7;
		}
	}
	.pack-tools button {
		min-width: 1.4rem;
		height: 1.4rem;
		padding: 0 4px;
		border-radius: 4px;
		color: var(--text-2);
		font-size: 11px;
		line-height: 1;
		cursor: pointer;
	}
	.pack-tools button:hover {
		background: var(--surface-hover);
		color: var(--text);
	}
	.pack-tools button[aria-pressed='true'] {
		color: var(--amber);
	}
</style>
