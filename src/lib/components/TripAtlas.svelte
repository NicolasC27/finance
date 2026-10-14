<script lang="ts">
	import { formatEUR } from '$lib/sensitiveFormat';
	import { showToast } from '$lib/ui.svelte';
	import { tripActuals, tripsState } from '$lib/trips.svelte';
	import { addVisit, atlasState, removeVisit } from '$lib/atlas.svelte';
	import { wishesState } from '$lib/wishes.svelte';
	import { atlasCode, atlasEntries, atlasStats } from '$lib/atlas';
	import { WORLD, WORLD_VIEWBOX } from '$lib/worldMap';

	/**
	 * Atlas of all the trips: a bundled world map (Natural Earth, no request leaves) with the
	 * countries visited filled and the ones of the coming trips and wishes hatched, the figures
	 * underneath, and the visits from before the app entered by hand.
	 */
	let { show, today }: { show: (id: string) => boolean; today: string } = $props();

	const entries = $derived(atlasEntries(tripsState.trips, atlasState.visits, today, wishesState.wishes));
	const spentOf = (trip: (typeof tripsState.trips)[number]) => Math.round(Object.values(tripActuals(trip)).reduce((s, v) => s + v, 0) * 100) / 100;
	const stats = $derived(atlasStats(tripsState.trips, atlasState.visits, today, spentOf));
	const wishes = $derived([...entries.values()].filter((e) => e.status === 'wish').length);

	const names = WORLD.map((c) => c.name).sort((a, b) => a.localeCompare(b, 'fr'));
	let country = $state('');
	let year = $state(String(new Date().getFullYear() - 1));
	let error = $state('');

	function submit(e: SubmitEvent) {
		e.preventDefault();
		const visit = addVisit(country, Number(year));
		if (!visit) {
			error = atlasCode(country) ? 'Année entre 1900 et 2100.' : 'Pays inconnu de la carte : choisis-le dans la liste.';
			return;
		}
		error = '';
		country = '';
		showToast(`${visit.country} ${visit.year} ajouté à l’atlas`);
	}

	const tooltip = (code: string, name: string) => {
		const e = entries.get(code);
		if (!e) return name;
		return `${name} · ${e.status === 'visited' ? 'visité' : 'envie'}${e.years.length ? ` ${e.years.join(', ')}` : ''}${e.trips.length ? ` · ${e.trips.join(', ')}` : ''}`;
	};
</script>

<div class="flex flex-wrap items-baseline justify-between gap-2">
	<h2 class="label-xs">Atlas</h2>
	<p class="meta-xs flex items-center gap-3">
		<span class="flex items-center gap-1"><i class="atlas-key atlas-key-visited"></i>visité</span>
		<span class="flex items-center gap-1"><i class="atlas-key atlas-key-wish"></i>envie ({wishes})</span>
	</p>
</div>

<svg class="atlas-map mt-2" viewBox={WORLD_VIEWBOX} role="img" aria-label="Carte du monde : {stats.countries} pays visités, {wishes} en envie">
	<defs>
		<pattern id="atlas-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
			<rect width="6" height="6" fill="var(--accent-soft)" />
			<line x1="0" y1="0" x2="0" y2="6" stroke="var(--accent)" stroke-width="1.6" />
		</pattern>
	</defs>
	{#each WORLD as c (c.code)}
		{@const e = entries.get(c.code)}
		<path d={c.d} class="atlas-country {e ? `is-${e.status}` : ''}"><title>{tooltip(c.code, c.name)}</title></path>
	{/each}
</svg>

{#if show('chiffres')}
	<dl class="atlas-facts mt-2">
		<div>
			<dt class="meta-xs">Pays visités</dt>
			<dd><span class="amount-md">{stats.countries}</span><span class="meta-xs ml-1.5">sur {stats.continents} continent{stats.continents > 1 ? 's' : ''}</span></dd>
		</div>
		<div>
			<dt class="meta-xs">Par an</dt>
			<dd class="tabular">
				{#if stats.perYear.length}
					{#each stats.perYear.slice(0, 3) as y (y.year)}<span class="block">{y.year} · {y.trips} voyage{y.trips > 1 ? 's' : ''}, {y.nights} nuit{y.nights > 1 ? 's' : ''}</span>{/each}
				{:else}<span class="text-secondary">pas encore de voyage terminé</span>{/if}
			</dd>
		</div>
		<div>
			<dt class="meta-xs">Coût moyen</dt>
			<dd class="tabular">{#if stats.perTrip !== null}{formatEUR(stats.perTrip)} par voyage<span class="meta-xs block">{formatEUR(stats.perNight ?? 0)} par nuit</span>{:else}<span class="text-secondary">—</span>{/if}</dd>
		</div>
		<div>
			<dt class="meta-xs">Par nuit</dt>
			<dd class="tabular">
				{#if stats.cheapest}<span class="block truncate">le moins cher : {stats.cheapest.name}, {formatEUR(stats.cheapest.perNight)}</span>{/if}
				{#if stats.dearest}<span class="block truncate">le plus cher : {stats.dearest.name}, {formatEUR(stats.dearest.perNight)}</span>{/if}
				{#if !stats.cheapest}<span class="text-secondary">—</span>{/if}
			</dd>
		</div>
	</dl>
{/if}

{#if show('saisies')}
	<div class="mt-3 flex flex-wrap items-center gap-1.5 text-[12px]">
		<span class="meta-xs">Avant l’app :</span>
		{#each atlasState.visits as v (v.id)}
			<span class="chip chip-outline">{v.country} {v.year}<button type="button" class="press ml-0.5 cursor-pointer" aria-label="Retirer {v.country} {v.year}" onclick={() => removeVisit(v.id)}>×</button></span>
		{/each}
		<form class="flex flex-wrap items-center gap-1.5" onsubmit={submit}>
			<input type="text" list="atlas-countries" class="input-surface w-40 py-0.5 text-[12px]" placeholder="Pays" bind:value={country} aria-label="Pays visité" />
			<datalist id="atlas-countries">{#each names as n (n)}<option value={n}></option>{/each}</datalist>
			<input type="number" min="1900" max="2100" class="input-surface tabular w-20 py-0.5 text-[12px]" bind:value={year} aria-label="Année" />
			<button type="submit" class="btn btn-secondary btn-sm" disabled={!country.trim()}>Ajouter</button>
			{#if error}<span class="meta-xs" style="color: var(--amber);">{error}</span>{/if}
		</form>
	</div>
{/if}

<style>
	.atlas-map {
		display: block;
		width: 100%;
		height: auto;
		max-height: 420px;
	}
	.atlas-country {
		fill: var(--surface-2);
		stroke: var(--surface);
		stroke-width: 0.6;
		transition: fill var(--motion-fast) ease;
	}
	.atlas-country:hover {
		fill: var(--surface-hover);
	}
	.atlas-country.is-visited,
	.atlas-country.is-visited:hover {
		fill: var(--accent);
	}
	.atlas-country.is-wish,
	.atlas-country.is-wish:hover {
		fill: url(#atlas-hatch);
	}
	.atlas-key {
		display: inline-block;
		width: 10px;
		height: 10px;
		border-radius: 2px;
	}
	.atlas-key-visited {
		background: var(--accent);
	}
	.atlas-key-wish {
		background: repeating-linear-gradient(45deg, var(--accent) 0 1.5px, var(--accent-soft) 1.5px 5px);
	}
	.atlas-facts {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.5rem 1.25rem;
		font-size: 12.5px;
	}
	@media (min-width: 640px) {
		.atlas-facts {
			grid-template-columns: repeat(4, minmax(0, 1fr));
		}
	}
	.atlas-facts dd {
		margin-top: 2px;
		min-width: 0;
	}
</style>
