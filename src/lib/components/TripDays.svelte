<script lang="ts">
	import SkyIcon from './SkyIcon.svelte';
	import { formatEUR } from '$lib/sensitiveFormat';
	import { showToast } from '$lib/ui.svelte';
	import { destinationKey, destinationState, ensureDaily } from '$lib/destination.svelte';
	import { geoState, locatePlace } from '$lib/geo.svelte';
	import { describeSky, formatDegrees } from '$lib/weather';
	import { addDayIdea, addPlace, movePlaceTo, removeDay, removePlace, reorderPlaceIn, setDay, setDays } from '$lib/trips.svelte';
	import { cleanPlace, dayColor, dayCost, dayKm, dayList, itineraryTotal, perDayBudget } from '$lib/itinerary';
	import { isLocated } from '$lib/geo';
	import { daysUntil, ENVELOPES, photoQueries, plannedTotal, type EnvelopeId, type Trip, type TripPlace } from '$lib/trips';

	/**
	 * Day-by-day plan of a trip: one row per day (its colour on the map, date, forecast when the
	 * departure is within 16 days, distance between its places, cost against the per-day budget),
	 * its title and notes, its numbered places with their cost, moved up, down or to another day.
	 * A place added is located on the map through the local server; one the geocoder missed gets
	 * a hollow number and a search of its own. Hover and selection are shared with the map through
	 * bindable props. An undated trip lists day ideas instead.
	 */
	let {
		trip,
		show = () => true,
		today,
		hovered = $bindable(null),
		selected = $bindable(null),
		focusDay = null,
		onfocusday,
		countryCode = ''
	}: {
		trip: Trip;
		show?: (id: string) => boolean;
		today: string;
		hovered?: string | null;
		selected?: string | null;
		focusDay?: number | null;
		onfocusday?: (index: number | null) => void;
		/** ISO code of the destination's country as the geocoder found it, when the trip names no known country. */
		countryCode?: string;
	} = $props();

	const days = $derived(dayList(trip));
	const dated = $derived(days.some((d) => d.date));
	const budget = $derived(perDayBudget(trip));
	const total = $derived(itineraryTotal(trip));
	const planned = $derived(plannedTotal(trip));
	const summary = $derived([total ? `plan ${formatEUR(total)}${planned ? ` sur ${formatEUR(planned)} prévus` : ''}` : planned ? `${formatEUR(planned)} prévus` : '', budget ? `${formatEUR(budget)} / jour` : ''].filter(Boolean).join(' · '));

	const placeQueries = $derived(photoQueries({ ...trip, photo: '' }));
	const info = $derived(destinationState.info[destinationKey(placeQueries)]);
	const soon = $derived.by(() => {
		const until = daysUntil(trip, today);
		return until !== null && until <= 16 && until >= -16;
	});
	$effect(() => {
		if (soon && show('meteo')) void ensureDaily(placeQueries, trip.country);
	});
	const forecast = $derived(new Map((info?.daily ?? []).map((d) => [d.date, d])));

	const weekdayFmt = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
	const dayLabel = (iso: string) => weekdayFmt.format(new Date(`${iso}T12:00:00`));
	const km = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });

	/** Places the geocoder has not placed yet (those it could not find this session stay out). */
	const missing = $derived(trip.days.flatMap((d, index) => d.places.filter((p) => !isLocated(p) && geoState.locating[p.id] !== 'none').map((p) => ({ index, id: p.id, name: p.name }))));
	const locatingAny = $derived(Object.values(geoState.locating).includes('pending'));

	async function locateMissing() {
		for (const m of missing) await locatePlace(trip, m.index, m.id, m.name, countryCode);
	}

	/** A selection made on the map brings the row into view. */
	$effect(() => {
		const id = selected;
		if (!id) return;
		document.getElementById(`place-${id}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
	});

	let addingFor = $state<number | null>(null);
	let pName = $state('');
	let pCost = $state('');
	let pUrl = $state('');
	let pEnvelope = $state<EnvelopeId>('activites');
	let pError = $state('');

	function openAdd(index: number) {
		addingFor = addingFor === index ? null : index;
		pName = pCost = pUrl = pError = '';
	}

	function submitPlace(e: SubmitEvent, index: number) {
		e.preventDefault();
		const place = cleanPlace({ name: pName, url: pUrl, cost: pCost, envelope: pEnvelope });
		if (!place) {
			pError = 'Un nom ; un lien en http(s) et un coût positif, s’il y en a.';
			return;
		}
		const placeId = addPlace(trip.id, index, place);
		pName = pCost = pUrl = pError = '';
		void locatePlace(trip, index, placeId, place.name, countryCode);
	}

	/** The search box of a place the geocoder missed, or to move one. */
	let locating = $state<{ index: number; place: TripPlace; query: string } | null>(null);
	const openLocate = (index: number, place: TripPlace) => (locating = { index, place, query: place.name });
	async function submitLocate(e: SubmitEvent) {
		e.preventDefault();
		if (!locating) return;
		const { index, place, query } = locating;
		if (await locatePlace(trip, index, place.id, query, countryCode)) locating = null;
	}

	/** Moves and removals can be undone from the toast. */
	function undoable(message: string, act: () => void) {
		const before = trip.days;
		const id = trip.id;
		act();
		showToast(message, 'Annuler', () => setDays(id, before));
	}

	const envelopeLabel = (id: EnvelopeId) => ENVELOPES.find((e) => e.id === id)?.label ?? id;
	const hostOf = (url: string) => {
		try {
			return new URL(url).hostname.replace(/^www\./, '');
		} catch {
			return 'lien';
		}
	};
</script>

<div class="flex flex-wrap items-baseline justify-between gap-2">
	<h2 class="label-xs">Jours</h2>
	<p class="meta-xs flex flex-wrap items-center gap-x-3 gap-y-1">
		{#if missing.length && !locatingAny}
			<button type="button" class="press cursor-pointer font-medium hover:underline" style="color: var(--accent);" onclick={locateMissing}>Placer {missing.length} lieu{missing.length > 1 ? 'x' : ''} sur la carte</button>
		{:else if locatingAny}
			<span>recherche des lieux…</span>
		{/if}
		{#if show('couts') && summary}<span class="tabular">{summary}</span>{/if}
	</p>
</div>

{#if days.length === 0}
	<p class="meta-xs mt-2">Sans dates, le plan se construit par journées : ajoute-les ici, elles prendront leurs dates avec le voyage.</p>
{/if}

<ol class="trip-days mt-2">
	{#each days as d (d.day?.id ?? `empty-${d.index}`)}
		{@const cost = dayCost(d.day)}
		{@const over = budget !== null && cost > budget}
		{@const weather = d.date ? forecast.get(d.date) : undefined}
		{@const distance = dayKm(d.day)}
		<li class="trip-day {d.beyond ? 'is-beyond' : ''} {focusDay !== null && focusDay !== d.index ? 'is-dim' : ''}" style="--day: {dayColor(d.index)};">
			<div class="trip-day-head">
				<button type="button" class="trip-day-badge serif tabular {focusDay === d.index ? 'is-focus' : ''}" aria-pressed={focusDay === d.index} aria-label="Jour {d.index + 1} : {focusDay === d.index ? 'toute la carte' : 'voir ses lieux sur la carte'}" onclick={() => onfocusday?.(focusDay === d.index ? null : d.index)}>{d.index + 1}</button>
				<span class="trip-day-when tabular">
					<span class="sr-only">Jour {d.index + 1}, </span>{d.date ? dayLabel(d.date) : 'Journée'}{#if d.beyond}<span class="chip chip-amber ml-1.5">hors séjour</span>{/if}
				</span>
				<input type="text" class="trip-day-title" placeholder="Titre de la journée" maxlength="80" value={d.day?.title ?? ''} aria-label="Titre du jour {d.index + 1}" onchange={(e) => setDay(trip.id, d.index, { title: e.currentTarget.value.trim() })} />
				{#if show('meteo') && weather}
					{@const sky = describeSky(weather.code)}
					<span class="trip-day-sky meta-xs flex items-center gap-1" title="{sky.label} · pluie {weather.precipitation} mm · Open-Meteo">
						<SkyIcon icon={sky.icon} size={13} />
						<span class="tabular">{formatDegrees(weather.max)} / {formatDegrees(weather.min)}</span>
					</span>
				{/if}
				{#if distance}
					<span class="meta-xs tabular flex-none" title="À vol d’oiseau, d’un lieu au suivant">{km.format(distance)} km</span>
				{/if}
				{#if show('couts')}
					<span class="trip-day-cost tabular {over ? 'font-medium' : ''}" style={over ? 'color: var(--amber);' : ''} title={budget !== null ? `Budget du jour : ${formatEUR(budget)}` : undefined}>
						{cost ? formatEUR(cost) : '—'}
						{#if budget}<span class="trip-gauge" aria-hidden="true"><i style="width: {Math.min(100, (cost / budget) * 100)}%; {over ? 'background: var(--amber);' : ''}"></i></span>{/if}
					</span>
				{/if}
				{#if !d.date || d.beyond}
					<button type="button" class="press cursor-pointer text-xs text-secondary hover:underline" onclick={() => undoable(`Jour ${d.index + 1} retiré`, () => removeDay(trip.id, d.index))}>Retirer</button>
				{/if}
			</div>
			{#if show('notes')}
				<textarea class="trip-day-notes" rows="1" placeholder="Notes" maxlength="1000" value={d.day?.notes ?? ''} aria-label="Notes du jour {d.index + 1}" onchange={(e) => setDay(trip.id, d.index, { notes: e.currentTarget.value.trim() })}></textarea>
			{/if}
			{#if d.day?.places.length}
				<ul class="trip-places">
					{#each d.day.places as p, i (p.id)}
						{@const located = isLocated(p)}
						{@const state = geoState.locating[p.id]}
						<li class="trip-place {hovered === p.id || selected === p.id ? 'is-active' : ''}" id="place-{p.id}" onpointerenter={() => (hovered = p.id)} onpointerleave={() => (hovered = null)}>
							<button
								type="button"
								class="trip-place-n tabular {located ? '' : 'is-off'} {state === 'pending' ? 'is-locating' : ''}"
								aria-label={located ? `Voir « ${p.name} » sur la carte` : `Placer « ${p.name} » sur la carte`}
								title={located ? 'Sur la carte' : state === 'pending' ? 'Recherche en cours…' : 'Pas encore sur la carte : cliquer pour le chercher'}
								aria-pressed={located && selected === p.id}
								onclick={() => (located ? (selected = selected === p.id ? null : p.id) : openLocate(d.index, p))}>{i + 1}</button
							>
							<span class="min-w-0 flex-1 truncate">
								{#if p.url}<a href={p.url} target="_blank" rel="noopener noreferrer" class="hover:underline" title={hostOf(p.url)}>{p.name} ↗</a>{:else}{p.name}{/if}
								<span class="meta-xs ml-1">{envelopeLabel(p.envelope)}</span>
							</span>
							<span class="tabular w-16 text-right">{p.cost === null ? '' : formatEUR(p.cost)}</span>
							<span class="trip-place-tools">
								<button type="button" class="press" aria-label="Chercher « {p.name} » sur la carte" title="Chercher sur la carte" onclick={() => openLocate(d.index, p)}>⌖</button>
								<button type="button" class="press" aria-label="Monter « {p.name} »" disabled={i === 0} onclick={() => reorderPlaceIn(trip.id, d.index, p.id, -1)}>↑</button>
								<button type="button" class="press" aria-label="Descendre « {p.name} »" disabled={i === d.day.places.length - 1} onclick={() => reorderPlaceIn(trip.id, d.index, p.id, 1)}>↓</button>
								{#if days.length > 1}
									<select class="input-surface cursor-pointer py-0 text-[11px]" aria-label="Déplacer « {p.name} » vers un autre jour" value="" onchange={(e) => { const to = Number(e.currentTarget.value); e.currentTarget.value = ''; undoable(`« ${p.name} » déplacé au jour ${to + 1}`, () => movePlaceTo(trip.id, d.index, p.id, to)); }}>
										<option value="" disabled>→ J…</option>
										{#each days as other (other.index)}{#if other.index !== d.index}<option value={other.index}>J{other.index + 1}</option>{/if}{/each}
									</select>
								{/if}
								<button type="button" class="press" aria-label="Retirer « {p.name} »" onclick={() => undoable(`« ${p.name} » retiré`, () => removePlace(trip.id, d.index, p.id))}>×</button>
							</span>
						</li>
						{#if locating?.place.id === p.id}
							<li class="trip-locate">
								<form class="flex flex-wrap items-center gap-1.5" onsubmit={submitLocate}>
									<input type="text" class="input-surface min-w-0 flex-[1_1_12rem] py-0.5 text-[12px]" placeholder="Nom du lieu, ville" maxlength="120" bind:value={locating.query} aria-label="Lieu à chercher sur la carte" />
									<button type="submit" class="btn btn-secondary btn-sm" disabled={!locating.query.trim() || state === 'pending'}>{state === 'pending' ? 'Recherche…' : 'Chercher'}</button>
									<button type="button" class="press cursor-pointer text-xs text-secondary hover:underline" onclick={() => (locating = null)}>Annuler</button>
									{#if state === 'none'}<span class="meta-xs basis-full" style="color: var(--amber);">Introuvable : précise la ville, ou le nom tel qu’il est sur les cartes.</span>{/if}
								</form>
							</li>
						{/if}
					{/each}
				</ul>
			{/if}
			{#if addingFor === d.index}
				<form class="trip-place-form" onsubmit={(e) => submitPlace(e, d.index)}>
					<input type="text" class="input-surface min-w-0 flex-[2_1_10rem] py-0.5" placeholder="Lieu, visite, restaurant…" maxlength="80" bind:value={pName} aria-label="Nom du lieu" />
					<input type="text" inputmode="decimal" class="input-surface tabular w-20 py-0.5 text-right" placeholder="€" bind:value={pCost} aria-label="Coût prévu (€)" />
					<select class="input-surface cursor-pointer py-0.5" bind:value={pEnvelope} aria-label="Enveloppe du lieu">
						{#each ENVELOPES as e (e.id)}<option value={e.id}>{e.label}</option>{/each}
					</select>
					<input type="url" class="input-surface min-w-0 flex-[1_1_8rem] py-0.5" placeholder="Lien (optionnel)" bind:value={pUrl} aria-label="Lien du lieu" />
					<button type="submit" class="btn btn-secondary btn-sm" disabled={!pName.trim()}>Ajouter</button>
					{#if pError}<span class="meta-xs basis-full" style="color: var(--amber);">{pError}</span>{/if}
				</form>
			{:else}
				<button type="button" class="press trip-day-add" onclick={() => openAdd(d.index)}>+ lieu</button>
			{/if}
		</li>
	{/each}
</ol>

{#if !dated}
	<button type="button" class="btn btn-secondary btn-sm mt-2" onclick={() => addDayIdea(trip.id)}>+ Journée</button>
{/if}

<style>
	.trip-days {
		display: flex;
		flex-direction: column;
	}
	.trip-day {
		position: relative;
		padding: 6px 0 8px 2.1rem;
		border-top: 1px solid var(--border-subtle);
		transition: opacity var(--motion-fast) ease;
	}
	.trip-day:first-child {
		border-top: 0;
	}
	.trip-day::before {
		content: '';
		position: absolute;
		left: 0.78rem;
		top: 2.1rem;
		bottom: -0.3rem;
		width: 1px;
		background: var(--border-subtle);
	}
	.trip-day:last-child::before {
		display: none;
	}
	.trip-day.is-beyond {
		opacity: 0.7;
	}
	.trip-day.is-dim {
		opacity: 0.45;
	}
	.trip-day.is-dim:hover {
		opacity: 1;
	}
	.trip-day-head {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		min-height: 1.75rem;
		font-size: 13px;
	}
	/* The day's number wears its colour on the map; pressed, the map shows that day alone */
	.trip-day-badge {
		position: absolute;
		left: 0;
		top: 0.45rem;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.6rem;
		height: 1.6rem;
		border-radius: 9999px;
		background: var(--day);
		color: #fff;
		font-size: 13px;
		line-height: 1;
		cursor: pointer;
		transition: box-shadow var(--motion-fast) ease;
	}
	.trip-day-badge:hover,
	.trip-day-badge.is-focus {
		box-shadow:
			0 0 0 2px var(--surface),
			0 0 0 4px var(--day);
	}
	.trip-day-when {
		flex: none;
		min-width: 6.2rem;
		color: var(--text-2);
		font-size: 12px;
	}
	.trip-day-title {
		flex: 1 1 8rem;
		min-width: 0;
		padding: 2px 4px;
		border: 1px solid transparent;
		border-radius: 5px;
		background: transparent;
		color: inherit;
		font: inherit;
		font-weight: 500;
	}
	.trip-day-title:hover,
	.trip-day-title:focus {
		border-color: var(--hairline);
		background: var(--surface-2);
		outline: none;
	}
	.trip-day-sky {
		flex: none;
	}
	.trip-day-cost {
		flex: none;
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		min-width: 4.5rem;
		font-size: 12.5px;
	}
	.trip-gauge {
		display: block;
		width: 100%;
		height: 2px;
		margin-top: 3px;
		border-radius: 9999px;
		background: var(--border-subtle);
		overflow: hidden;
	}
	.trip-gauge i {
		display: block;
		height: 100%;
		border-radius: inherit;
		background: var(--accent);
	}
	.trip-day-notes {
		display: block;
		width: 100%;
		margin-top: 2px;
		padding: 2px 4px;
		border: 1px solid transparent;
		border-radius: 5px;
		background: transparent;
		color: var(--text-2);
		font: inherit;
		font-size: 12px;
		line-height: 1.45;
		resize: none;
		field-sizing: content;
	}
	.trip-day-notes:hover,
	.trip-day-notes:focus {
		border-color: var(--hairline);
		background: var(--surface-2);
		color: var(--text);
		outline: none;
	}
	.trip-day-notes::placeholder {
		color: transparent;
	}
	.trip-day:hover .trip-day-notes::placeholder,
	.trip-day-notes:focus::placeholder {
		color: var(--text-3);
	}
	.trip-places {
		margin-top: 2px;
		font-size: 12.5px;
	}
	.trip-place {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 2px 4px;
		border-radius: 5px;
	}
	.trip-place:hover,
	.trip-place.is-active {
		background: var(--surface-2);
	}
	/* Step number in the day's colour, like its pin; hollow while the place is not on the map */
	.trip-place-n {
		flex: none;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 17px;
		height: 17px;
		border-radius: 9999px;
		background: var(--day);
		color: #fff;
		font-size: 10px;
		font-weight: 600;
		line-height: 1;
		cursor: pointer;
		transition: transform var(--motion-fast) ease;
	}
	.trip-place.is-active .trip-place-n {
		transform: scale(1.15);
	}
	.trip-place-n.is-off {
		border: 1.5px dashed var(--day);
		background: transparent;
		color: var(--day);
	}
	.trip-place-n.is-locating {
		animation: locating 1s ease-in-out infinite;
	}
	@keyframes locating {
		50% {
			opacity: 0.3;
		}
	}
	.trip-place-tools {
		display: inline-flex;
		align-items: center;
		gap: 2px;
		opacity: 0;
		transition: opacity var(--motion-fast) ease;
	}
	.trip-place:hover .trip-place-tools,
	.trip-place:focus-within .trip-place-tools {
		opacity: 1;
	}
	@media (hover: none) {
		.trip-place-tools {
			opacity: 0.7;
		}
	}
	.trip-place-tools button {
		width: 1.4rem;
		height: 1.4rem;
		border-radius: 4px;
		color: var(--text-2);
		font-size: 12px;
		line-height: 1;
		cursor: pointer;
	}
	.trip-place-tools button:hover:not(:disabled) {
		background: var(--surface-hover);
		color: var(--text);
	}
	.trip-place-tools button:disabled {
		opacity: 0.35;
		cursor: default;
	}
	.trip-locate {
		padding: 2px 4px 4px 1.6rem;
		font-size: 12px;
	}
	.trip-place-form {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem;
		margin-top: 4px;
		font-size: 12px;
	}
	.trip-day-add {
		margin-top: 2px;
		padding: 0 4px;
		color: var(--text-2);
		font-size: 11px;
		cursor: pointer;
	}
	.trip-day-add:hover {
		color: var(--accent);
	}
	@media (prefers-reduced-motion: reduce) {
		.trip-place-n.is-locating {
			animation: none;
			opacity: 0.5;
		}
	}
</style>
