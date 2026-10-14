<script lang="ts">
	import { untrack } from 'svelte';
	import SidePanel from './SidePanel.svelte';
	import DateField from './DateField.svelte';
	import { goalsState } from '$lib/goals.svelte';
	import { showSuccess, showToast } from '$lib/ui.svelte';
	import { formatEUR } from '$lib/sensitiveFormat';
	import { addTrip, attachTravelPayments, setGoal, stayHistory, updateTrip } from '$lib/trips.svelte';
	import { describeEstimate, estimateFor, estimatedEnvelopes } from '$lib/tripEstimates';
	import { tripDays, TRIP_STATUSES, validateTrip, type Trip, type TripInput, type TripStatus } from '$lib/trips';

	/**
	 * Side panel creating a trip, or editing the one given: name, destination and country, dates,
	 * travellers, status, savings goal, notes and the place to illustrate it. The fields are
	 * filled again each time the panel opens. A new dated trip gets its envelopes from the
	 * closest past stay; saving also attaches the bookings already paid.
	 */
	let { open, trip = null, onclose, oncreated }: { open: boolean; trip?: Trip | null; onclose: () => void; oncreated?: (trip: Trip) => void } = $props();

	const today = new Date().toISOString().slice(0, 10);

	let fName = $state('');
	let fDestination = $state('');
	let fCountry = $state('');
	let fStart = $state('');
	let fEnd = $state('');
	let fTravellers = $state('2');
	let fStatus = $state<TripStatus>('idee');
	let fGoal = $state('');
	let fNotes = $state('');
	let fPhoto = $state('');
	let fPrefill = $state(true);
	let fError = $state('');

	const days = $derived(tripDays({ start: fStart, end: fEnd }));
	/** Estimate for a new dated trip, from the past stays (none while editing). */
	const estimate = $derived(!trip && open && days > 0 ? estimateFor({ destination: fDestination, country: fCountry, start: fStart }, stayHistory(today)) : null);

	$effect(() => {
		if (!open) return;
		const t = trip;
		untrack(() => {
			fName = t?.name ?? '';
			fDestination = t?.destination ?? '';
			fCountry = t?.country ?? '';
			fStart = t?.start ?? '';
			fEnd = t?.end ?? '';
			fTravellers = String(t?.travellers ?? 2);
			fStatus = t?.status ?? 'idee';
			fGoal = t?.goalId ?? '';
			fNotes = t?.notes ?? '';
			fPhoto = t?.photo ?? '';
			fError = '';
		});
	});

	function save(e: SubmitEvent) {
		e.preventDefault();
		const input: TripInput = { name: fName, destination: fDestination, country: fCountry, start: fStart, end: fEnd, travellers: Number(fTravellers), status: fStatus, notes: fNotes, photo: fPhoto };
		const v = validateTrip(input);
		if (!v.ok) {
			fError = v.error;
			return;
		}
		if (trip) {
			updateTrip(trip.id, v.value);
			if ((trip.goalId ?? '') !== fGoal) setGoal(trip.id, fGoal || null);
			showToast('Voyage modifié');
		} else {
			const prefilled = fPrefill && estimate ? estimatedEnvelopes(estimate, days) : {};
			const t = addTrip(v.value, prefilled);
			if (fGoal) setGoal(t.id, fGoal);
			showSuccess(`Voyage « ${t.name} » créé${t.periodId ? ' : ses dates forment une période de vacances' : ''}${Object.keys(prefilled).length ? ', enveloppes préremplies d’après tes séjours' : ''}`);
			oncreated?.(t);
		}
		const attached = attachTravelPayments();
		if (attached.count) showToast(`${attached.count} opération${attached.count > 1 ? 's' : ''} rattachée${attached.count > 1 ? 's' : ''} au voyage ${attached.names.join(', ')}`);
		onclose();
	}
</script>

<SidePanel {open} title={trip ? 'Modifier le voyage' : 'Nouveau voyage'} onClose={onclose}>
	<form class="space-y-3" onsubmit={save}>
		<label class="block">
			<span class="meta-xs">Nom</span>
			<input type="text" class="input-surface mt-1 w-full" placeholder="Lisbonne en avril" maxlength="60" bind:value={fName} aria-label="Nom du voyage" />
		</label>
		<div class="grid grid-cols-2 gap-3">
			<label class="block">
				<span class="meta-xs">Destination</span>
				<input type="text" class="input-surface mt-1 w-full" placeholder="Lisbonne" maxlength="60" bind:value={fDestination} aria-label="Destination" />
			</label>
			<label class="block">
				<span class="meta-xs">Pays</span>
				<input type="text" class="input-surface mt-1 w-full" placeholder="Portugal" maxlength="40" bind:value={fCountry} aria-label="Pays" />
			</label>
			<label class="block">
				<span class="meta-xs">Départ</span>
				<DateField bind:value={fStart} label="Date de départ" class="mt-1 w-full" />
			</label>
			<label class="block">
				<span class="meta-xs">Retour</span>
				<DateField bind:value={fEnd} label="Date de retour" class="mt-1 w-full" min={fStart} />
			</label>
			<label class="block">
				<span class="meta-xs">Voyageurs</span>
				<input type="number" min="1" max="20" class="input-surface tabular mt-1 w-full" bind:value={fTravellers} aria-label="Nombre de voyageurs" />
			</label>
			<label class="block">
				<span class="meta-xs">Statut</span>
				<select class="input-surface mt-1 w-full cursor-pointer" bind:value={fStatus} aria-label="Statut">
					{#each TRIP_STATUSES as s (s.id)}<option value={s.id}>{s.label}</option>{/each}
				</select>
			</label>
		</div>
		{#if estimate}
			<label class="flex items-start gap-2 text-[12px]">
				<input type="checkbox" class="mt-0.5 accent-[var(--accent)]" bind:checked={fPrefill} />
				<span>Préremplir les enveloppes : {describeEstimate(estimate, formatEUR)}, soit <span class="tabular font-medium">{formatEUR(estimate.perDay * days)}</span> pour {days} jour{days > 1 ? 's' : ''}.</span>
			</label>
		{/if}
		<label class="block">
			<span class="meta-xs">Objectif d’épargne lié</span>
			<select class="input-surface mt-1 w-full cursor-pointer" bind:value={fGoal} aria-label="Objectif d’épargne lié">
				<option value="">aucun</option>
				{#each goalsState.goals as g (g.id)}<option value={g.id}>{g.name}</option>{/each}
			</select>
		</label>
		<label class="block">
			<span class="meta-xs">Notes</span>
			<textarea class="input-surface mt-1 w-full" rows="3" maxlength="2000" bind:value={fNotes} aria-label="Notes"></textarea>
		</label>
		<label class="block">
			<span class="meta-xs">Photo : lieu à illustrer</span>
			<input type="text" class="input-surface mt-1 w-full" placeholder={fDestination.trim() || fCountry.trim() || 'la destination'} maxlength="60" bind:value={fPhoto} aria-label="Lieu dont la photo illustre le voyage" />
			<span class="meta-xs mt-1 block">Vide : la photo de la destination, sinon du pays (banderole Wikivoyage, via le serveur local).</span>
		</label>
		<p class="meta-xs">Avec des dates, le voyage crée (ou redate) sa période de vacances : les dépenses variables de ces jours passent en « Vacances » et remplissent les enveloppes. Hors UE, la liste ajoute passeport et visa.</p>
		{#if fError}<p class="meta-xs" style="color: var(--amber);">{fError}</p>{/if}
		<div class="flex items-center gap-2">
			<button type="submit" class="btn btn-primary btn-sm">{trip ? 'Enregistrer' : 'Créer le voyage'}</button>
			<button type="button" class="btn btn-secondary btn-sm" onclick={onclose}>Annuler</button>
		</div>
	</form>
</SidePanel>
