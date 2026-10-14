<script lang="ts">
	import TripHero from '$lib/components/TripHero.svelte';
	import TripDays from '$lib/components/TripDays.svelte';
	import TripMap from '$lib/components/TripMap.svelte';
	import TripBudget from '$lib/components/TripBudget.svelte';
	import TripBookings from '$lib/components/TripBookings.svelte';
	import TripPacking from '$lib/components/TripPacking.svelte';
	import TripPractical from '$lib/components/TripPractical.svelte';
	import TripForm from '$lib/components/TripForm.svelte';
	import { formatEUR } from '$lib/sensitiveFormat';
	import { showToast } from '$lib/ui.svelte';
	import { navigate } from '$lib/router.svelte';
	import { destinationKey, destinationState } from '$lib/destination.svelte';
	import { removeTrip, tripActuals, tripsState, updateTrip } from '$lib/trips.svelte';
	import { dayList } from '$lib/itinerary';
	import { packingProgress } from '$lib/packing';
	import { photoQueries, plannedTotal, type EnvelopeId, type Trip } from '$lib/trips';

	/**
	 * One trip, as a travel planner: its header (photo, countdown, weather and clock on the spot),
	 * then tabs. « Jours » puts the day-by-day plan beside the map of its places; the others hold
	 * the budget and quotes, the bookings and links, the packing list and the practical sheet of
	 * the country. Reached from the list at /vacances/<id>.
	 */
	let { id }: { id: string } = $props();

	const today = new Date().toISOString().slice(0, 10);
	const trip = $derived(tripsState.trips.find((t) => t.id === id));

	const TABS = [
		{ id: 'jours', label: 'Jours' },
		{ id: 'budget', label: 'Budget' },
		{ id: 'reservations', label: 'Réservations' },
		{ id: 'valise', label: 'Valise' },
		{ id: 'pratique', label: 'Pratique' }
	] as const;
	type TabId = (typeof TABS)[number]['id'];
	let tab = $state<TabId>('jours');

	const always = () => true;
	let hovered = $state<string | null>(null);
	let selected = $state<string | null>(null);
	let focusDay = $state<number | null>(null);
	let editing = $state(false);

	/** Clean slate when another trip is shown. */
	$effect(() => {
		id;
		hovered = selected = focusDay = null;
	});

	const actuals = $derived<Partial<Record<EnvelopeId, number>>>(trip ? tripActuals(trip) : {});
	const actualTotal = $derived(Math.round(Object.values(actuals).reduce((s, v) => s + (v ?? 0), 0) * 100) / 100);
	const days = $derived(trip ? dayList(trip) : []);
	const placeQueries = $derived(trip ? photoQueries({ ...trip, photo: '' }) : []);
	const info = $derived(destinationState.info[destinationKey(placeQueries)]);
	const fallback = $derived(info?.place ? { lon: info.place.lon, lat: info.place.lat } : null);

	const counts = $derived.by((): Partial<Record<TabId, string>> => {
		if (!trip) return {};
		const places = trip.days.reduce((s, d) => s + d.places.length, 0);
		const open = trip.checklist.filter((c) => !c.done).length;
		const packing = packingProgress(trip.packing);
		const planned = plannedTotal(trip);
		return {
			jours: places ? String(places) : undefined,
			budget: planned ? formatEUR(planned) : undefined,
			reservations: open ? String(open) : undefined,
			valise: packing.total ? `${packing.done}/${packing.total}` : undefined
		};
	});

	function onTabKey(e: KeyboardEvent) {
		const at = TABS.findIndex((t) => t.id === tab);
		const next = e.key === 'ArrowRight' ? at + 1 : e.key === 'ArrowLeft' ? at - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : -1;
		if (next < 0 || next >= TABS.length) return;
		e.preventDefault();
		tab = TABS[next]!.id;
		document.getElementById(`trip-tab-${tab}`)?.focus();
	}

	function remove(t: Trip) {
		removeTrip(t.id);
		showToast(`Voyage « ${t.name} » supprimé (sa période de vacances reste)`);
		navigate('/vacances');
	}
</script>

{#if !trip}
	<div class="card p-6">
		<p class="text-[15px] font-medium">Ce voyage n’existe plus.</p>
		<a href="/vacances" class="btn btn-secondary btn-sm mt-3 inline-flex">← Tous les voyages</a>
	</div>
{:else}
	<div class="mb-3 flex flex-wrap items-center justify-between gap-2">
		<nav class="flex min-w-0 items-center gap-2 text-[13px]" aria-label="Fil d’Ariane">
			<a href="/vacances" class="trip-back">← Vacances</a>
			<span class="text-secondary" aria-hidden="true">/</span>
			<span class="truncate font-medium">{trip.name}</span>
		</nav>
		<div class="flex items-center gap-2">
			<button type="button" class="btn btn-secondary btn-sm" onclick={() => (editing = true)} aria-haspopup="dialog">Modifier</button>
			<button type="button" class="btn btn-secondary btn-sm" style="color: var(--amber);" onclick={() => remove(trip)}>Supprimer</button>
		</div>
	</div>

	<TripHero {trip} {actualTotal} {today} />

	<div class="trip-tabs mt-3" role="tablist" aria-label="Sections du voyage">
		{#each TABS as t (t.id)}
			<button type="button" role="tab" id="trip-tab-{t.id}" class="trip-tab {tab === t.id ? 'is-active' : ''}" aria-selected={tab === t.id} aria-controls="trip-panel-{t.id}" tabindex={tab === t.id ? 0 : -1} onclick={() => (tab = t.id)} onkeydown={onTabKey}>
				{t.label}{#if counts[t.id]}<span class="trip-tab-count tabular">{counts[t.id]}</span>{/if}
			</button>
		{/each}
	</div>

	<div id="trip-panel-{tab}" role="tabpanel" aria-labelledby="trip-tab-{tab}" class="mt-3">
		{#if tab === 'jours'}
			<div class="trip-plan">
				<div class="card trip-plan-list p-4">
					<textarea class="trip-notes" rows="1" placeholder="Notes du voyage" maxlength="2000" value={trip.notes} aria-label="Notes du voyage" onchange={(e) => updateTrip(trip.id, { notes: e.currentTarget.value.trim() })}></textarea>
					<TripDays {trip} show={always} {today} bind:hovered bind:selected {focusDay} onfocusday={(i) => (focusDay = i)} countryCode={info?.place?.countryCode ?? ''} />
				</div>
				<div class="card trip-plan-map">
					<TripMap {days} {focusDay} bind:hovered bind:selected {fallback} fallbackName={info?.place?.name ?? ''} onfocusday={(i) => (focusDay = i)} />
				</div>
			</div>
		{:else if tab === 'budget'}
			<TripBudget {trip} {actuals} {actualTotal} {today} />
		{:else if tab === 'reservations'}
			<TripBookings {trip} />
		{:else if tab === 'valise'}
			<div class="card p-4"><TripPacking {trip} show={always} {today} /></div>
		{:else}
			<div class="card p-4"><TripPractical {trip} /></div>
		{/if}
	</div>

	<TripForm open={editing} {trip} onclose={() => (editing = false)} />
{/if}

<style>
	.trip-back {
		flex: none;
		color: var(--text-2);
	}
	.trip-back:hover {
		color: var(--accent);
		text-decoration: underline;
	}
	.trip-tabs {
		display: flex;
		gap: 2px;
		border-bottom: 1px solid var(--hairline);
		overflow-x: auto;
		scrollbar-width: none;
	}
	.trip-tab {
		position: relative;
		flex: none;
		padding: 7px 12px 9px;
		color: var(--text-2);
		font-size: 13px;
		white-space: nowrap;
		cursor: pointer;
		transition: color var(--motion-fast) ease;
	}
	.trip-tab:hover {
		color: var(--text);
	}
	.trip-tab.is-active {
		color: var(--text);
		font-weight: 500;
	}
	.trip-tab.is-active::after {
		content: '';
		position: absolute;
		left: 10px;
		right: 10px;
		bottom: -1px;
		height: 2px;
		border-radius: 2px;
		background: var(--accent);
	}
	.trip-tab:focus-visible {
		outline: none;
		box-shadow: inset 0 0 0 2px var(--accent);
		border-radius: 6px;
	}
	.trip-tab-count {
		margin-left: 6px;
		color: var(--text-3);
		font-size: 11px;
		font-weight: 400;
	}
	/* The plan beside its map: the map stays in view while the days scroll */
	.trip-plan {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 12px;
		align-items: start;
	}
	.trip-plan-map {
		height: 300px;
		overflow: hidden;
		order: -1;
	}
	@media (min-width: 960px) {
		.trip-plan {
			grid-template-columns: minmax(0, 1fr) minmax(320px, 42%);
		}
		.trip-plan-map {
			position: sticky;
			top: 12px;
			order: 0;
			height: min(calc(100dvh - 24px), 680px);
		}
	}
	.trip-notes {
		display: block;
		width: 100%;
		margin-bottom: 8px;
		padding: 2px 4px;
		border: 1px solid transparent;
		border-radius: 5px;
		background: transparent;
		color: var(--text-2);
		font: inherit;
		font-size: 12.5px;
		line-height: 1.45;
		resize: none;
		field-sizing: content;
	}
	.trip-notes:hover,
	.trip-notes:focus {
		border-color: var(--hairline);
		background: var(--surface-2);
		color: var(--text);
		outline: none;
	}
</style>
