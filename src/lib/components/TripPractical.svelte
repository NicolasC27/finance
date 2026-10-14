<script lang="ts">
	import { destinationKey, destinationState } from '$lib/destination.svelte';
	import { ADVICE_HOME_URL, countryByCode, countryOf, EMBASSIES_URL, travelAdviceUrl } from '$lib/countries';
	import { photoQueries, type Trip } from '$lib/trips';

	/**
	 * Practical facts of the destination country, from the trip's country field or from the
	 * country of the place the geocoder found: emergency numbers first, then plugs, currency,
	 * languages, dialling code, driving side, tipping; the official links underneath.
	 */
	let { trip }: { trip: Trip } = $props();

	const geocoded = $derived(destinationState.info[destinationKey(photoQueries({ ...trip, photo: '' }))]?.place?.countryCode);
	const country = $derived(countryOf(trip.country) ?? countryByCode(geocoded));
	const facts = $derived(
		country
			? [
					['Urgences', country.emergency],
					['Prises', `${country.plugs} · ${country.voltage}`],
					['Monnaie', country.currency],
					['Langues', country.languages],
					['Indicatif', country.dialling],
					['Conduite', `à ${country.drive}`],
					['Pourboire', country.tipping]
				]
			: []
	);
</script>

<h2 class="label-xs">Pratique</h2>
{#if country}
	<dl class="trip-facts mt-2">
		{#each facts as [label, value], i (label)}
			<div class="trip-fact {i === 0 ? 'is-first' : ''}">
				<dt class="meta-xs">{label}</dt>
				<dd class="tabular">{value}</dd>
			</div>
		{/each}
	</dl>
	<p class="meta-xs mt-2 flex flex-wrap gap-x-3">
		<a href={travelAdviceUrl(country)} target="_blank" rel="noopener noreferrer" class="hover:underline" style="color: var(--accent);">Conseils aux voyageurs ↗</a>
		<a href={EMBASSIES_URL} target="_blank" rel="noopener noreferrer" class="hover:underline" style="color: var(--accent);">Ambassades et consulats ↗</a>
		<span>Vérifié 2026-10 ; en cas de doute, le 112 fonctionne dans toute l’UE.</span>
	</p>
{:else}
	<p class="meta-xs mt-2">{trip.country.trim() ? `« ${trip.country.trim()} » n’est pas dans la fiche pratique (≈ 65 pays).` : 'Donne un pays au voyage pour ses numéros d’urgence, prises, monnaie et usages.'}</p>
	<p class="meta-xs mt-2 flex flex-wrap gap-x-3">
		<a href={ADVICE_HOME_URL} target="_blank" rel="noopener noreferrer" class="hover:underline" style="color: var(--accent);">Conseils aux voyageurs ↗</a>
		<a href={EMBASSIES_URL} target="_blank" rel="noopener noreferrer" class="hover:underline" style="color: var(--accent);">Ambassades et consulats ↗</a>
	</p>
{/if}

<style>
	.trip-facts {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.45rem 1rem;
		font-size: 12.5px;
	}
	.trip-fact dd {
		margin-top: 1px;
		overflow-wrap: anywhere;
	}
	.trip-fact.is-first {
		grid-column: 1 / -1;
	}
	.trip-fact.is-first dd {
		font-size: 15px;
		font-weight: 600;
		letter-spacing: -0.01em;
	}
</style>
