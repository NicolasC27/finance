<script lang="ts">
	import { formatEUR } from '$lib/sensitiveFormat';
	import { showSuccess, showToast } from '$lib/ui.svelte';
	import { hrefOf, navigate } from '$lib/router.svelte';
	import { getBaseline } from '$lib/whatIf.svelte';
	import { addWish, removeWish, wishesState } from '$lib/wishes.svelte';
	import { tripFromWish } from '$lib/trips.svelte';
	import { monthAfter, monthsToAfford, perDayOf, rankWishes, validateWish, type Wish } from '$lib/wishes';
	import { SEASONS, seasonLabel } from '$lib/tripEstimates';

	/**
	 * Destination wishes: name, country, budget, length and season, ranked by cost per day, with
	 * the month each one could be afforded at the current savings pace (income minus spending);
	 * one click turns a wish into a trip (an idea, its budget split into envelopes).
	 */
	let { show, today }: { show: (id: string) => boolean; today: string } = $props();

	const ranked = $derived(rankWishes(wishesState.wishes));
	const savings = $derived.by(() => {
		const b = getBaseline();
		return Math.max(0, Math.round((b.income - b.expenses) * 100) / 100);
	});
	const monthFmt = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' });

	/** When the wish's budget would be there, '' when it cannot be told. */
	function when(w: Wish): string {
		if (!w.budget) return '';
		const months = monthsToAfford(w.budget, savings);
		if (months === null) return 'rien d’épargné chaque mois';
		if (months === 0) return 'possible dès maintenant';
		return `possible en ${monthFmt.format(new Date(`${monthAfter(today, months)}-15T12:00:00`))}`;
	}

	let name = $state('');
	let country = $state('');
	let budget = $state('');
	let days = $state('');
	let season = $state('');
	let notes = $state('');
	let error = $state('');

	function submit(e: SubmitEvent) {
		e.preventDefault();
		const v = validateWish({ name, country, budget, days, season, notes });
		if (!v.ok) {
			error = v.error;
			return;
		}
		addWish(v.value);
		name = country = budget = days = season = notes = error = '';
		showToast('Envie notée');
	}

	function toTrip(w: Wish) {
		const trip = tripFromWish(w);
		showSuccess(`« ${trip.name} » est maintenant un voyage${w.budget ? ', son budget réparti en enveloppes' : ''}`);
		navigate(hrefOf('/vacances', trip.id));
	}
</script>

<div class="flex flex-wrap items-baseline justify-between gap-2">
	<h2 class="label-xs">Envies</h2>
	<p class="meta-xs tabular">{savings > 0 ? `à ton rythme : ${formatEUR(savings)} épargnés par mois` : 'par coût par jour'}</p>
</div>

{#if ranked.length === 0}
	<p class="meta-xs mt-2">Note les destinations qui te tentent avec un budget et une durée : elles se classent par coût par jour, et deviennent un voyage en un clic.</p>
{:else}
	<ul class="mt-2 divide-y divide-[var(--border-subtle)] text-[13px]">
		{#each ranked as w (w.id)}
			{@const perDay = perDayOf(w)}
			<li class="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5">
				<span class="min-w-0 flex-1">
					<span class="font-medium">{w.name}</span>{#if w.country && w.country.toLowerCase() !== w.name.toLowerCase()}<span class="text-secondary"> · {w.country}</span>{/if}
					{#if w.season}<span class="chip chip-outline ml-1.5 px-1.5 py-0 text-[10px]">{seasonLabel(w.season)}</span>{/if}
					{#if w.notes}<span class="meta-xs block truncate">{w.notes}</span>{/if}
				</span>
				<span class="tabular text-right">
					{#if w.budget}{formatEUR(w.budget)}{#if w.days} · {w.days} j{/if}{:else}<span class="text-secondary">budget à estimer</span>{/if}
					<span class="meta-xs block">{perDay !== null ? `${formatEUR(perDay)}/jour` : ''}{perDay !== null && when(w) ? ' · ' : ''}{when(w)}</span>
				</span>
				<button type="button" class="btn btn-secondary btn-sm" onclick={() => toTrip(w)} title="En faire un voyage (une idée, sans dates)">→ Voyage</button>
				<button type="button" class="press cursor-pointer text-xs text-secondary hover:underline" aria-label="Retirer l’envie {w.name}" onclick={() => removeWish(w.id)}>Retirer</button>
			</li>
		{/each}
	</ul>
{/if}

{#if show('ajout')}
	<form class="mt-3 grid grid-cols-2 gap-2 text-[12px] sm:grid-cols-3" onsubmit={submit}>
		<input type="text" class="input-surface py-1" placeholder="Destination" maxlength="60" bind:value={name} aria-label="Destination rêvée" />
		<input type="text" class="input-surface py-1" placeholder="Pays" maxlength="40" bind:value={country} aria-label="Pays" />
		<select class="input-surface cursor-pointer py-1" bind:value={season} aria-label="Meilleure saison">
			<option value="">Saison : peu importe</option>
			{#each SEASONS as s (s.id)}<option value={s.id}>{s.label}</option>{/each}
		</select>
		<input type="text" inputmode="decimal" class="input-surface tabular py-1" placeholder="Budget estimé (€)" bind:value={budget} aria-label="Budget estimé (€)" />
		<input type="number" min="1" max="365" class="input-surface tabular py-1" placeholder="Jours" bind:value={days} aria-label="Durée en jours" />
		<input type="text" class="input-surface py-1" placeholder="Notes (idées, période…)" maxlength="500" bind:value={notes} aria-label="Notes" />
		<div class="col-span-2 flex items-center gap-2 sm:col-span-3">
			<button type="submit" class="btn btn-secondary btn-sm" disabled={!name.trim()}>Ajouter l’envie</button>
			{#if error}<span class="meta-xs" style="color: var(--amber);">{error}</span>{/if}
		</div>
	</form>
{/if}
