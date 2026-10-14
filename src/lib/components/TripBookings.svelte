<script lang="ts">
	import DateField from './DateField.svelte';
	import { addChecklistItem, removeChecklistItem, setChecklistDate, toggleChecklist } from '$lib/trips.svelte';
	import { LINK_GROUPS, tripLinks, type Trip } from '$lib/trips';

	/**
	 * Bookings of a trip: the checklist of what to book or prepare, each point with its deadline
	 * (a dated point appears in the Échéancier until it is ticked), and the links to the sites,
	 * pre-filled with the dates and the destination when the site accepts them.
	 */
	let { trip }: { trip: Trip } = $props();

	const links = $derived(tripLinks(trip));
	const open = $derived(trip.checklist.filter((c) => !c.done));
	const done = $derived(trip.checklist.filter((c) => c.done));
	let showDone = $state(false);

	let newItem = $state('');
	let newItemDate = $state('');
	function submitItem(e: SubmitEvent) {
		e.preventDefault();
		if (!newItem.trim()) return;
		addChecklistItem(trip.id, newItem, newItemDate);
		newItem = '';
		newItemDate = '';
	}
</script>

<div class="trip-bookings">
	<section class="card p-4" aria-label="Réservations à faire">
		<div class="flex flex-wrap items-baseline justify-between gap-2">
			<h2 class="label-xs">Réservations à faire</h2>
			{#if done.length}
				<button type="button" class="press meta-xs cursor-pointer hover:underline" onclick={() => (showDone = !showDone)}>{showDone ? 'masquer' : 'voir'} les {done.length} fait{done.length > 1 ? 's' : ''}</button>
			{/if}
		</div>
		{#if trip.checklist.length === 0}
			<p class="meta-xs mt-2">Rien à préparer pour l’instant : ajoute un point ci-dessous.</p>
		{:else if open.length === 0 && !showDone}
			<p class="meta-xs mt-2">Tout est fait.</p>
		{/if}
		<ul class="mt-2 divide-y divide-[var(--border-subtle)] text-[13px]">
			{#each showDone ? trip.checklist : open as c (c.id)}
				<li class="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5">
					<label class="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
						<input type="checkbox" class="accent-[var(--accent)]" checked={c.done} onchange={() => toggleChecklist(trip.id, c.id)} />
						<span class="min-w-0 truncate {c.done ? 'text-secondary line-through' : ''}">{c.label}</span>
					</label>
					<DateField bind:value={() => c.date, (v) => setChecklistDate(trip.id, c.id, v)} label="Échéance · {c.label}" class="w-36" placeholder="Échéance" clearable />
					<button type="button" class="press cursor-pointer text-xs text-secondary hover:underline" onclick={() => removeChecklistItem(trip.id, c.id)} aria-label="Retirer « {c.label} »">Retirer</button>
				</li>
			{/each}
		</ul>
		<form class="mt-2 flex flex-wrap items-center gap-2" onsubmit={submitItem}>
			<input type="text" class="input-surface min-w-0 flex-[1_1_10rem] py-1 text-[13px]" placeholder="Autre point à ne pas oublier" maxlength="80" bind:value={newItem} aria-label="Nouveau point" />
			<DateField bind:value={newItemDate} label="Échéance du nouveau point" class="w-36" placeholder="Échéance" />
			<button type="submit" class="btn btn-secondary btn-sm" disabled={!newItem.trim()}>Ajouter</button>
		</form>
		<p class="meta-xs mt-2">Un point daté apparaît dans l’Échéancier jusqu’à ce qu’il soit coché.</p>
	</section>

	<section class="card p-4" aria-label="Comparer sur les sites">
		<h2 class="label-xs">Comparer sur les sites</h2>
		<p class="meta-xs mt-1">{links.some((l) => l.prefilled) ? 'Dates et destination préremplies quand le site l’accepte (●). ' : 'Donne des dates et une destination pour préremplir les recherches. '}L’app n’envoie rien : c’est toi qui cliques.</p>
		<div class="mt-2 grid gap-x-4 gap-y-2 text-[13px] sm:grid-cols-2">
			{#each LINK_GROUPS as g (g.id)}
				<div>
					<p class="meta-xs">{g.label}</p>
					<p class="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
						{#each links.filter((l) => l.group === g.id) as l (l.label)}
							<a href={l.url} target="_blank" rel="noopener noreferrer" class="hover:underline" style="color: var(--accent);" title={l.prefilled ? 'Dates et destination préremplies' : undefined}>{l.label}{#if l.prefilled}<span aria-hidden="true"> ●</span>{/if}</a>
						{/each}
					</p>
				</div>
			{/each}
		</div>
	</section>
</div>

<style>
	.trip-bookings {
		display: grid;
		gap: 12px;
		grid-template-columns: minmax(0, 1fr);
		align-items: start;
	}
	@media (min-width: 1024px) {
		.trip-bookings {
			grid-template-columns: minmax(0, 7fr) minmax(0, 5fr);
		}
	}
</style>
