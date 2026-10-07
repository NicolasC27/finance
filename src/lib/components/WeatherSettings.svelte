<script lang="ts">
	import { cleanQuery, placeLabel, QUERY_RULE, type Place } from '$lib/weather';
	import { findPlaces, setPlace, weatherState } from '$lib/weather.svelte';
	import { describeFailure } from '$lib/localApi';

	/**
	 * Réglages › Météo: the town whose weather the home page shows. A name typed here is looked up
	 * through the local server (Open-Meteo geocoding), one of the places found is chosen,
	 * « Retirer » forgets it and stops every call. Answers to an older search are ignored.
	 */
	let query = $state('');
	let places = $state<Place[]>([]);
	let searching = $state(false);
	let failure = $state('');
	let input = $state<HTMLInputElement | null>(null);
	let timer: ReturnType<typeof setTimeout> | null = null;
	let seq = 0;

	function cancelSearch() {
		if (timer) clearTimeout(timer);
		timer = null;
		seq++;
		searching = false;
	}

	function onInput() {
		cancelSearch();
		failure = '';
		places = [];
		const q = query.trim();
		if (q.length < 2) return;
		if (!cleanQuery(q)) {
			failure = QUERY_RULE;
			return;
		}
		timer = setTimeout(() => void search(q), 350);
	}

	async function search(q: string) {
		const id = ++seq;
		searching = true;
		try {
			const found = await findPlaces(q);
			if (id !== seq) return;
			places = found;
			if (!found.length) failure = 'Aucune ville trouvée.';
		} catch (e) {
			if (id !== seq) return;
			places = [];
			failure = describeFailure(e);
		} finally {
			if (id === seq) searching = false;
		}
	}

	function choose(place: Place) {
		cancelSearch();
		setPlace(place);
		query = '';
		places = [];
		failure = '';
		input?.focus();
	}

	$effect(() => () => cancelSearch());
</script>

<section class="mt-3 border-t pt-3" style="border-color: var(--border-subtle);" aria-labelledby="settings-weather">
	<h3 id="settings-weather" class="label-plain mb-1">Météo</h3>
	{#if weatherState.place}
		<div class="flex items-center justify-between gap-3">
			<span class="min-w-0 truncate">{placeLabel(weatherState.place)} <span class="meta-xs">· sur l'accueil, toutes les 30 min</span></span>
			<button type="button" class="btn btn-secondary btn-sm shrink-0" onclick={() => setPlace(null)}>Retirer</button>
		</div>
		{#if weatherState.error}<p class="meta-xs mt-1" style="color: var(--amber);">Météo indisponible : {weatherState.error}{weatherState.weather ? ' — dernière lecture gardée' : ''}</p>{/if}
	{:else}
		<p class="meta-xs mb-1.5">Choisis ta ville pour voir sa météo en haut de l'accueil. Le nom tapé part au géocodeur d'Open-Meteo, puis seules les coordonnées de la ville choisie (sans compte), toujours depuis le serveur local.</p>
	{/if}
	<input
		type="search"
		class="input-surface mt-2 w-full"
		placeholder={weatherState.place ? 'Changer de ville…' : 'Nom de la ville…'}
		aria-label="Ville de la météo"
		bind:this={input}
		bind:value={query}
		oninput={onInput}
		autocomplete="off"
	/>
	{#if searching}
		<p class="meta-xs mt-1">Recherche…</p>
	{:else if failure}
		<p class="meta-xs mt-1" style="color: var(--amber);">{failure}</p>
	{:else if places.length}
		<ul class="mt-1.5 flex flex-col gap-1" aria-label="Villes trouvées">
			{#each places as place, i (i)}
				<li>
					<button type="button" class="press w-full cursor-pointer rounded-md px-2 py-1 text-left text-[13px] transition-colors hover:bg-[var(--surface-hover)]" onclick={() => choose(place)}>{placeLabel(place)}</button>
				</li>
			{/each}
		</ul>
	{/if}
</section>
