<script lang="ts">
	import TripPhoto from './TripPhoto.svelte';
	import SkyIcon from './SkyIcon.svelte';
	import { formatDate, formatEUR } from '$lib/sensitiveFormat';
	import { commonsPageUrl } from '$lib/photo';
	import { photoFor } from '$lib/photos.svelte';
	import { destinationKey, destinationState, ensureDestination } from '$lib/destination.svelte';
	import { describeSky, flagEmoji, formatDegrees, formatMillimetres, observationHour, placeLabel } from '$lib/weather';
	import { updateTrip } from '$lib/trips.svelte';
	import { goalsState } from '$lib/goals.svelte';
	import { savingsPlan } from '$lib/tripEstimates';
	import { clockAt, formatTripDates, nextDeadline, phaseLabel, photoQueries, plannedTotal, TRIP_STATUSES, tripDays, tripPhase, zoneOffset, type Trip, type TripStatus } from '$lib/trips';

	/**
	 * Header of a trip: its destination's photo with the name, country, dates and countdown over
	 * it, then four facts under it (weather and clock on the spot, budget against the spending,
	 * next booking to do). Photos, weather and clock come from the local server (photos.svelte.ts,
	 * destination.svelte.ts); the clock ticks every 30 seconds while shown.
	 */
	let { trip, actualTotal, today }: { trip: Trip; actualTotal: number; today: string } = $props();

	const queries = $derived(photoQueries(trip));
	const photo = $derived(photoFor(queries, 1600));
	/** Names tried for the place itself: the destination before any photo choice. */
	const placeQueries = $derived(photoQueries({ ...trip, photo: '' }));
	const info = $derived(destinationState.info[destinationKey(placeQueries)]);
	const sky = $derived(info?.weather ? describeSky(info.weather.code) : null);
	const flag = $derived(flagEmoji(info?.place?.countryCode));

	let now = $state(Date.now());
	$effect(() => {
		void ensureDestination(placeQueries, trip.country);
	});
	$effect(() => {
		const timer = setInterval(() => {
			now = Date.now();
			void ensureDestination(placeQueries, trip.country);
		}, 30_000);
		return () => clearInterval(timer);
	});

	const phase = $derived(tripPhase(trip, today));
	const label = $derived(phaseLabel(phase));
	const planned = $derived(plannedTotal(trip));
	/** For an idea, the figure is the budget imagined rather than a countdown. */
	const big = $derived(phase.kind === 'idea' && planned > 0 ? formatEUR(planned) : label.big);
	const small = $derived(phase.kind === 'idea' && planned > 0 ? 'budget envisagé · dates à fixer' : label.small);
	const statusLabel = $derived(TRIP_STATUSES.find((s) => s.id === trip.status)?.label ?? '');

	const where = $derived.by(() => {
		const parts = [trip.destination.trim().toLowerCase() !== trip.name.trim().toLowerCase() ? trip.destination.trim() : '', trip.country.trim()].filter(Boolean);
		return parts.join(' · ') || 'Destination à choisir';
	});
	const when = $derived.by(() => {
		const days = tripDays(trip);
		return [formatTripDates(trip.start, trip.end) || 'Dates à fixer', days ? `${days} jour${days > 1 ? 's' : ''}` : '', `${trip.travellers} voyageur${trip.travellers > 1 ? 's' : ''}`].filter(Boolean).join(' · ');
	});

	const weatherTitle = $derived.by(() => {
		const w = info?.weather;
		if (!w || !info?.place || !sky) return '';
		const hour = observationHour(w.at);
		return [placeLabel(info.place), sky.label, `min ${formatDegrees(w.min)}`, `max ${formatDegrees(w.max)}`, w.precipitation > 0 ? `pluie ${formatMillimetres(w.precipitation)}` : '', hour ? `relevé à ${hour}` : '', info.error ? 'dernière lecture connue' : '', 'Open-Meteo'].filter(Boolean).join(' · ');
	});
	const clock = $derived(clockAt(info?.place?.timezone, now));
	const offset = $derived(zoneOffset(info?.place?.timezone, now));

	const ratio = $derived(planned > 0 ? Math.min(1, actualTotal / planned) : 0);
	const over = $derived(planned > 0 && actualTotal > planned ? Math.round((actualTotal - planned) * 100) / 100 : 0);
	const next = $derived(nextDeadline(trip.checklist));
	const goal = $derived(trip.goalId ? goalsState.goals.find((g) => g.id === trip.goalId) : undefined);
	/** What to put aside each month until the departure, after the goal's savings and what is paid. */
	const plan = $derived(savingsPlan(trip, goal?.currentAmount ?? 0, actualTotal, today));
	const doneCount = $derived(trip.checklist.filter((c) => c.done).length);
	const openCount = $derived(trip.checklist.length - doneCount);
</script>

<section class="card trip-hero overflow-hidden" aria-label="Le voyage {trip.name}">
	<div class="trip-hero-photo relative">
		<TripPhoto {queries} width={1600} seed={trip.name} />
		<div class="trip-hero-scrim" aria-hidden="true"></div>
		{#if photo}
			<a class="trip-hero-credit" href={commonsPageUrl(photo.file)} target="_blank" rel="noopener noreferrer" title="Photo : {photo.file} (auteur et licence sur Wikimedia Commons)">Wikimedia Commons ↗</a>
		{/if}
		<div class="trip-hero-text">
			<div class="min-w-0">
				<p class="trip-hero-where">
					{#if flag}<span aria-hidden="true">{flag}</span>{/if}
					<span class="truncate">{where}</span>
					<select class="trip-hero-status" value={trip.status} aria-label="Statut du voyage : {statusLabel}" onchange={(e) => updateTrip(trip.id, { status: e.currentTarget.value as TripStatus })}>
						{#each TRIP_STATUSES as s (s.id)}<option value={s.id}>{s.label}</option>{/each}
					</select>
				</p>
				<h2 class="trip-hero-name serif">{trip.name}</h2>
				<p class="trip-hero-when tabular">{when}</p>
			</div>
			<div class="trip-hero-count">
				<p class="trip-hero-big serif tabular">{big}</p>
				<p class="trip-hero-small">{small}</p>
			</div>
		</div>
	</div>
	<dl class="trip-hero-facts">
		<div>
			<dt class="meta-xs">Sur place</dt>
			<dd>
				{#if info?.weather && sky}
					<span class="flex items-center gap-1.5" title={weatherTitle}>
						<SkyIcon icon={sky.icon} size={15} />
						<span class="tabular">{formatDegrees(info.weather.temperature)}</span>
						<span class="truncate text-secondary">{sky.label}</span>
					</span>
				{:else if !trip.destination.trim() && !trip.country.trim()}
					<span class="text-secondary">—</span>
				{:else if info?.error}
					<span class="text-secondary" title={info.error}>météo indisponible</span>
				{:else}
					<span class="text-secondary">…</span>
				{/if}
			</dd>
		</div>
		<div>
			<dt class="meta-xs">Heure locale</dt>
			<dd>
				{#if clock}
					<span class="tabular">{clock}</span>
					<span class="meta-xs ml-1.5">{offset ? `décalage ${offset}` : 'même heure qu’ici'}</span>
				{:else}
					<span class="text-secondary">—</span>
				{/if}
			</dd>
		</div>
		<div>
			<dt class="meta-xs">Budget</dt>
			<dd>
				{#if planned > 0}
					<span class="amount-md">{formatEUR(planned)}</span>
					<span class="meta-xs ml-1.5">prévus</span>
					<span class="trip-gauge" role="img" aria-label="{Math.round(ratio * 100)} % dépensés"><i style="width: {ratio * 100}%; {over ? 'background: var(--amber);' : ''}"></i></span>
					<span class="meta-xs block" style={over ? 'color: var(--amber);' : ''}>{over ? `dépassé de ${formatEUR(over)}` : actualTotal ? `${formatEUR(actualTotal)} dépensés` : 'rien dépensé encore'}{#if plan && plan.remaining > 0}{' · '}<span class="tabular" style="color: var(--text);">{formatEUR(plan.monthly)}/mois</span> à mettre de côté{:else if plan}{' · financé'}{/if}</span>
				{:else}
					<span class="text-secondary">à prévoir dans les enveloppes</span>
				{/if}
			</dd>
		</div>
		<div class="min-w-0">
			<dt class="meta-xs">Réservations</dt>
			<dd>
				{#if trip.checklist.length === 0}
					<span class="text-secondary">—</span>
				{:else if next}
					<span class="block truncate" title={next.label}>{next.label}</span>
					<span class="meta-xs tabular" style={next.date < today ? 'color: var(--amber);' : ''}>{next.date < today ? 'en retard · ' : ''}{formatDate(next.date)} · {doneCount}/{trip.checklist.length} faits</span>
				{:else if openCount > 0}
					<span class="tabular">{openCount} à faire</span>
					<span class="meta-xs block">échéances une fois les dates fixées</span>
				{:else}
					<span>Tout est fait</span>
					<span class="meta-xs ml-1.5 tabular">{doneCount}/{trip.checklist.length}</span>
				{/if}
			</dd>
		</div>
	</dl>
</section>

<style>
	.trip-hero-photo {
		height: clamp(168px, 21vw, 224px);
	}
	.trip-hero-scrim {
		position: absolute;
		inset: 0;
		background:
			linear-gradient(to top, rgba(10, 11, 14, 0.84) 0%, rgba(10, 11, 14, 0.46) 40%, rgba(10, 11, 14, 0.08) 72%, transparent 100%),
			linear-gradient(to right, rgba(10, 11, 14, 0.3), transparent 55%);
	}
	.trip-hero-text {
		position: absolute;
		inset: auto 0 0 0;
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 1rem;
		padding: 0 1.1rem 0.85rem;
		color: #fff;
		text-shadow: 0 1px 2px rgba(0, 0, 0, 0.35);
	}
	.trip-hero-where {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-width: 0;
		font-size: 12px;
		color: rgba(255, 255, 255, 0.85);
	}
	/* The status is a select dressed as a pill: one click changes it from the header. */
	.trip-hero-status {
		flex: none;
		appearance: none;
		padding: 1px 7px;
		border: 0;
		border-radius: 9999px;
		background: rgba(255, 255, 255, 0.17);
		backdrop-filter: blur(6px);
		color: inherit;
		font: inherit;
		font-size: 10px;
		font-weight: 500;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		text-shadow: none;
		cursor: pointer;
	}
	.trip-hero-status:hover,
	.trip-hero-status:focus-visible {
		background: rgba(255, 255, 255, 0.3);
		outline: none;
	}
	.trip-hero-status option {
		color: var(--text);
		background: var(--surface);
		text-transform: none;
		letter-spacing: normal;
	}
	.trip-hero-name {
		margin-top: 0.3rem;
		font-size: clamp(30px, 3.6vw, 44px);
		line-height: 0.98;
		letter-spacing: -0.015em;
		overflow-wrap: anywhere;
	}
	.trip-hero-when {
		margin-top: 0.45rem;
		font-size: 13px;
		color: rgba(255, 255, 255, 0.88);
	}
	.trip-hero-count {
		flex: none;
		text-align: right;
	}
	.trip-hero-big {
		font-size: clamp(28px, 3.2vw, 40px);
		line-height: 1;
		letter-spacing: -0.01em;
		white-space: nowrap;
	}
	.trip-hero-small {
		margin-top: 0.35rem;
		font-size: 11px;
		color: rgba(255, 255, 255, 0.8);
	}
	.trip-hero-credit {
		position: absolute;
		top: 0.55rem;
		right: 0.85rem;
		font-size: 10px;
		color: rgba(255, 255, 255, 0.72);
		text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
		text-decoration: none;
	}
	.trip-hero-credit:hover {
		color: #fff;
		text-decoration: underline;
	}
	.trip-hero-facts {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.5rem 1.5rem;
		padding: 0.65rem 1.1rem 0.75rem;
		font-size: 13px;
	}
	@media (min-width: 640px) {
		.trip-hero-facts {
			grid-template-columns: repeat(4, minmax(0, 1fr));
		}
	}
	.trip-hero-facts dd {
		margin-top: 3px;
		min-width: 0;
	}
	.trip-gauge {
		display: block;
		height: 3px;
		margin-top: 6px;
		border-radius: 9999px;
		background: var(--border-subtle);
		overflow: hidden;
	}
	.trip-gauge i {
		display: block;
		height: 100%;
		border-radius: inherit;
		background: var(--accent);
		transition: width var(--motion-base) var(--ease-out);
	}
	@media (max-width: 480px) {
		.trip-hero-count {
			display: none;
		}
	}
</style>
