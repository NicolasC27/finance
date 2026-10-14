<script lang="ts">
	import PageTitle from '$lib/components/PageTitle.svelte';
	import Block from '$lib/components/Block.svelte';
	import TileCanvas from '$lib/components/TileCanvas.svelte';
	import TripPhoto from '$lib/components/TripPhoto.svelte';
	import TripAtlas from '$lib/components/TripAtlas.svelte';
	import TripWishes from '$lib/components/TripWishes.svelte';
	import TripForm from '$lib/components/TripForm.svelte';
	import Trip from './Trip.svelte';
	import type { BlockElement } from '$lib/layoutModel';
	import { orderedIds } from '$lib/layout.svelte';
	import { formatEUR } from '$lib/sensitiveFormat';
	import { hrefOf, navigate, route } from '$lib/router.svelte';
	import { tripActuals, tripsState } from '$lib/trips.svelte';
	import { formatTripDates, phaseLabel, photoQueries, plannedTotal, sortTrips, TRIP_STATUSES, tripPhase, type Trip as TripRecord } from '$lib/trips';

	/**
	 * Holidays: the trips as cards (photo, countdown, budget), each opening its planner page
	 * (Trip.svelte at /vacances/<id>), and the atlas of the countries visited. Computations:
	 * src/lib/trips.ts through trips.svelte.ts.
	 */

	const today = new Date().toISOString().slice(0, 10);
	const trips = $derived(sortTrips(tripsState.trips, today));
	/** Photo queries per trip, computed once per change of the list (the photo layer watches them). */
	const cardQueries = $derived(new Map(trips.map((t) => [t.id, photoQueries(t)])));

	const BLOCKS = ['voyages', 'envies', 'atlas'] as const;
	const ATLAS_ELEMENTS: BlockElement[] = [
		{ id: 'chiffres', label: 'Chiffres (pays, nuits, coûts)' },
		{ id: 'saisies', label: 'Voyages d’avant l’app' }
	];
	const WISH_ELEMENTS: BlockElement[] = [{ id: 'ajout', label: 'Ajouter une envie' }];

	let formOpen = $state(false);

	const spentOf = (t: TripRecord) => Math.round(Object.values(tripActuals(t)).reduce((s, v) => s + v, 0) * 100) / 100;
	const statusOf = (t: TripRecord) => TRIP_STATUSES.find((s) => s.id === t.status)?.label ?? '';
	const whereOf = (t: TripRecord) => [t.destination.trim().toLowerCase() !== t.name.trim().toLowerCase() ? t.destination.trim() : '', t.country.trim()].filter(Boolean).join(', ');
</script>

{#if route.rest}
	<Trip id={route.rest} />
{:else}
	<header class="mb-4 flex flex-wrap items-start justify-between gap-3">
		<PageTitle title="Vacances" />
		<button type="button" class="btn btn-accent btn-sm" onclick={() => (formOpen = true)} aria-haspopup="dialog">+ Nouveau voyage</button>
	</header>

	{#if trips.length === 0}
		<div class="card p-6">
			<p class="text-[15px] font-medium">Organise ton prochain voyage</p>
			<p class="meta-xs mt-1 max-w-[60ch]">Un voyage réunit ses dates (qui deviennent une période de vacances), le plan jour par jour sur une carte, un budget par enveloppe, les réservations à faire avec leurs échéances, la valise et la fiche pratique du pays.</p>
			<button type="button" class="btn btn-accent btn-sm mt-3" onclick={() => (formOpen = true)} aria-haspopup="dialog">+ Nouveau voyage</button>
		</div>
	{:else}
		<TileCanvas page="vacances" defaults={BLOCKS}>
			{#each orderedIds('vacances', BLOCKS) as id (id)}
				{#if id === 'voyages'}
					<Block page="vacances" {id} defaults={BLOCKS} title="Voyages" size="XL" sizes={['L', 'XL']}>
						{#snippet children()}
							<div class="flex flex-wrap items-baseline justify-between gap-2">
								<h2 class="label-xs">Voyages</h2>
								<p class="meta-xs">{trips.length} voyage{trips.length > 1 ? 's' : ''}</p>
							</div>
							<ul class="trip-cards mt-2">
								{#each trips as t (t.id)}
									{@const phase = phaseLabel(tripPhase(t, today))}
									{@const planned = plannedTotal(t)}
									{@const spent = spentOf(t)}
									<li>
										<a href={hrefOf('/vacances', t.id)} class="trip-card" aria-label="Ouvrir le voyage {t.name}">
											<span class="trip-card-photo">
												<TripPhoto queries={cardQueries.get(t.id) ?? []} width={480} seed={t.name} />
												<span class="trip-card-scrim" aria-hidden="true"></span>
												<span class="trip-card-status">{statusOf(t)}</span>
												<span class="trip-card-text">
													<span class="min-w-0">
														<span class="trip-card-name serif">{t.name}</span>
														<span class="trip-card-where truncate">{whereOf(t) || 'Destination à choisir'}</span>
													</span>
													<span class="trip-card-phase">
														<span class="trip-card-big serif tabular">{phase.big}</span>
														<span class="trip-card-small">{phase.small}</span>
													</span>
												</span>
											</span>
											<span class="trip-card-foot">
												<span class="tabular">{formatTripDates(t.start, t.end) || 'Dates à fixer'}</span>
												{#if planned > 0}
													<span class="tabular text-secondary">{spent ? `${formatEUR(spent)} sur ` : ''}{formatEUR(planned)}</span>
													<span class="trip-card-gauge" aria-hidden="true"><i style="width: {Math.min(100, (spent / planned) * 100)}%; {spent > planned ? 'background: var(--amber);' : ''}"></i></span>
												{/if}
											</span>
										</a>
									</li>
								{/each}
								<li>
									<button type="button" class="trip-card trip-card-new" onclick={() => (formOpen = true)} aria-haspopup="dialog">+ Nouveau voyage</button>
								</li>
							</ul>
						{/snippet}
					</Block>
				{:else if id === 'envies'}
					<Block page="vacances" {id} defaults={BLOCKS} title="Envies" size="M" sizes={['M', 'L', 'XL']} elements={WISH_ELEMENTS}>
						{#snippet children(show)}
							<TripWishes {show} {today} />
						{/snippet}
					</Block>
				{:else if id === 'atlas'}
					<Block page="vacances" {id} defaults={BLOCKS} title="Atlas" size="L" sizes={['M', 'L', 'XL']} elements={ATLAS_ELEMENTS}>
						{#snippet children(show)}
							<TripAtlas {show} {today} />
						{/snippet}
					</Block>
				{/if}
			{/each}
		</TileCanvas>
	{/if}

	<TripForm open={formOpen} onclose={() => (formOpen = false)} oncreated={(t) => navigate(hrefOf('/vacances', t.id))} />
{/if}

<style>
	.trip-cards {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
		gap: 12px;
	}
	.trip-card {
		display: flex;
		flex-direction: column;
		width: 100%;
		height: 100%;
		border: 1px solid var(--hairline);
		border-radius: 8px;
		background: var(--surface);
		color: inherit;
		overflow: hidden;
		text-decoration: none;
		transition:
			border-color var(--motion-fast) ease,
			transform var(--motion-fast) ease;
	}
	.trip-card:hover,
	.trip-card:focus-visible {
		border-color: var(--accent);
		transform: translateY(-1px);
		outline: none;
	}
	.trip-card-photo {
		position: relative;
		display: block;
		aspect-ratio: 16 / 10;
		background: var(--surface-2);
	}
	.trip-card-scrim {
		position: absolute;
		inset: 0;
		background: linear-gradient(to top, rgba(0, 0, 0, 0.66), rgba(0, 0, 0, 0.1) 55%, rgba(0, 0, 0, 0));
	}
	.trip-card-status {
		position: absolute;
		top: 8px;
		left: 10px;
		padding: 1px 7px;
		border-radius: 9999px;
		background: rgba(255, 255, 255, 0.18);
		backdrop-filter: blur(6px);
		color: #fff;
		font-size: 10px;
		font-weight: 500;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}
	.trip-card-text {
		position: absolute;
		left: 10px;
		right: 10px;
		bottom: 8px;
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 8px;
		color: #fff;
		text-shadow: 0 1px 2px rgba(0, 0, 0, 0.45);
	}
	.trip-card-name {
		display: block;
		font-size: 22px;
		line-height: 1;
		letter-spacing: -0.01em;
	}
	.trip-card-where {
		display: block;
		margin-top: 4px;
		font-size: 11px;
		opacity: 0.88;
	}
	.trip-card-phase {
		flex: none;
		text-align: right;
	}
	.trip-card-big {
		display: block;
		font-size: 19px;
		line-height: 1;
	}
	.trip-card-small {
		display: block;
		margin-top: 3px;
		font-size: 10px;
		opacity: 0.88;
	}
	.trip-card-foot {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 4px 8px;
		padding: 7px 10px 8px;
		font-size: 12px;
	}
	.trip-card-gauge {
		display: block;
		flex-basis: 100%;
		height: 2px;
		border-radius: 9999px;
		background: var(--border-subtle);
		overflow: hidden;
	}
	.trip-card-gauge i {
		display: block;
		height: 100%;
		border-radius: inherit;
		background: var(--accent);
	}
	.trip-card-new {
		align-items: center;
		justify-content: center;
		height: auto;
		min-height: 100%;
		border-style: dashed;
		color: var(--text-2);
		font-size: 13px;
		cursor: pointer;
	}
	.trip-card-new:hover {
		color: var(--accent);
	}
	@media (prefers-reduced-motion: reduce) {
		.trip-card {
			transition: none;
		}
		.trip-card:hover {
			transform: none;
		}
	}
</style>
