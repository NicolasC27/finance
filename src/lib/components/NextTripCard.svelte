<script lang="ts">
	import TripPhoto from './TripPhoto.svelte';
	import { formatDate, formatEUR } from '$lib/sensitiveFormat';
	import { hrefOf } from '$lib/router.svelte';
	import { goalsState } from '$lib/goals.svelte';
	import { tripActuals } from '$lib/trips.svelte';
	import { savingsPlan } from '$lib/tripEstimates';
	import { nextDeadline, phaseLabel, photoQueries, plannedTotal, tripPhase, type Trip } from '$lib/trips';

	/**
	 * Home tile of the next trip: its photo, countdown, budget (spent against planned, or the
	 * monthly amount to put aside) and the next booking to do; opens the trip's page.
	 */
	let { trip, today, showBudget = true, showBooking = true }: { trip: Trip; today: string; showBudget?: boolean; showBooking?: boolean } = $props();

	const label = $derived(phaseLabel(tripPhase(trip, today)));
	const planned = $derived(plannedTotal(trip));
	const spent = $derived(Math.round(Object.values(tripActuals(trip)).reduce((s, v) => s + v, 0) * 100) / 100);
	const goal = $derived(trip.goalId ? goalsState.goals.find((g) => g.id === trip.goalId) : undefined);
	const plan = $derived(savingsPlan(trip, goal?.currentAmount ?? 0, spent, today));
	const next = $derived(nextDeadline(trip.checklist));
	const where = $derived([trip.destination.trim().toLowerCase() !== trip.name.trim().toLowerCase() ? trip.destination.trim() : '', trip.country.trim()].filter(Boolean).join(', '));
</script>

<a href={hrefOf('/vacances', trip.id)} class="next-trip" aria-label="Ouvrir le voyage {trip.name}">
	<span class="next-trip-photo"><TripPhoto queries={photoQueries(trip)} width={480} seed={trip.name} /></span>
	<span class="min-w-0 flex-1">
		<span class="flex items-baseline justify-between gap-2">
			<span class="truncate text-[14px] font-medium">{trip.name}</span>
			<span class="serif tabular flex-none text-[22px] leading-none">{label.big}</span>
		</span>
		<span class="meta-xs block truncate">{where ? `${where} · ` : ''}{label.small}</span>
		{#if showBudget && planned > 0}
			<span class="next-trip-gauge mt-2" aria-hidden="true"><i style="width: {Math.min(100, (spent / planned) * 100)}%; {spent > planned ? 'background: var(--amber);' : ''}"></i></span>
			<span class="meta-xs tabular mt-1 block">
				{spent ? `${formatEUR(spent)} dépensés sur ${formatEUR(planned)}` : `${formatEUR(planned)} prévus`}{#if plan && plan.remaining > 0}{' · '}<span style="color: var(--text);">{formatEUR(plan.monthly)}/mois</span> à mettre de côté{/if}
			</span>
		{/if}
		{#if showBooking && next}
			<span class="meta-xs mt-1 block truncate">À réserver : {next.label} · {formatDate(next.date)}</span>
		{/if}
	</span>
</a>

<style>
	.next-trip {
		display: flex;
		gap: 12px;
		align-items: flex-start;
		color: inherit;
		text-decoration: none;
	}
	.next-trip:hover .next-trip-photo {
		box-shadow: 0 0 0 2px var(--accent);
	}
	.next-trip-photo {
		position: relative;
		flex: none;
		width: 84px;
		height: 84px;
		border-radius: 8px;
		overflow: hidden;
		background: var(--surface-2);
		transition: box-shadow var(--motion-fast) ease;
	}
	.next-trip-gauge {
		display: block;
		height: 3px;
		border-radius: 9999px;
		background: var(--border-subtle);
		overflow: hidden;
	}
	.next-trip-gauge i {
		display: block;
		height: 100%;
		border-radius: inherit;
		background: var(--accent);
	}
</style>
