<script lang="ts">
	import { formatDate, formatEUR } from '$lib/sensitiveFormat';
	import { showToast, uiState } from '$lib/ui.svelte';
	import { navigate } from '$lib/router.svelte';
	import { goalsState } from '$lib/goals.svelte';
	import { addQuote, removeQuote, setEnvelope, setGoal, stayHistory, toggleBought } from '$lib/trips.svelte';
	import { describeEstimate, estimateFor, estimatedEnvelopes, savingsPlan } from '$lib/tripEstimates';
	import { compareQuotes, ENVELOPES, perDay, plannedTotal, tripDays, type EnvelopeId, type Trip } from '$lib/trips';

	/**
	 * Budget of a trip: the envelopes (planned, against the spending of its vacation period) with
	 * the figure of the closest past stay as a landmark, the savings goal that finances it and the
	 * monthly amount to put aside until the departure, and the quotes noted on the sites, compared
	 * per envelope (« Acheté » fills the envelope).
	 */
	let { trip, actuals, actualTotal, today }: { trip: Trip; actuals: Partial<Record<EnvelopeId, number>>; actualTotal: number; today: string } = $props();

	const budget = $derived(perDay(trip));
	const goal = $derived(trip.goalId ? goalsState.goals.find((g) => g.id === trip.goalId) : undefined);
	const days = $derived(tripDays(trip));
	const estimate = $derived(estimateFor(trip, stayHistory(today)));
	const plan = $derived(savingsPlan(trip, goal?.currentAmount ?? 0, actualTotal, today));
	/** What the plan already takes off the planned total. */
	const deducted = $derived([goal && goal.currentAmount > 0 ? 'l’épargne de l’objectif' : '', actualTotal > 0 ? 'ce qui est déjà payé' : ''].filter(Boolean));

	function takeEstimate() {
		if (!estimate) return;
		for (const [id, v] of Object.entries(estimatedEnvelopes(estimate, days))) setEnvelope(trip.id, id as EnvelopeId, v);
		showToast('Enveloppes remplies d’après tes séjours');
	}
	const parseAmount = (s: string) => Number(s.replace(/\s/g, '').replace(',', '.'));

	function onEnvelopeInput(envelope: EnvelopeId, e: Event & { currentTarget: HTMLInputElement }) {
		const n = parseAmount(e.currentTarget.value);
		if (Number.isFinite(n) && n >= 0) setEnvelope(trip.id, envelope, n);
	}

	/** Opens Transactions on the trip's period, widened by 5 days after the end (late bank booking). */
	function openOperations() {
		if (!trip.periodId) return;
		const d = new Date(`${trip.end}T12:00:00`);
		d.setDate(d.getDate() + 5);
		uiState.txFilter = { from: trip.start, to: d.toISOString().slice(0, 10), vacationId: trip.periodId };
		navigate('/transactions');
	}

	let qSite = $state('');
	let qLabel = $state('');
	let qPrice = $state('');
	let qUrl = $state('');
	let qConditions = $state('');
	let qEnvelope = $state<EnvelopeId>('hebergement');
	let qError = $state('');
	function submitQuote(e: SubmitEvent) {
		e.preventDefault();
		const price = parseAmount(qPrice);
		if (!qSite.trim() || !Number.isFinite(price) || price <= 0) {
			qError = 'Un site et un prix, au moins.';
			return;
		}
		if (qUrl.trim() && !/^https?:\/\//i.test(qUrl.trim())) {
			qError = 'Le lien doit commencer par http(s)://';
			return;
		}
		addQuote(trip.id, { site: qSite.trim(), label: qLabel.trim(), price: Math.round(price * 100) / 100, url: qUrl.trim(), conditions: qConditions.trim(), date: today, envelope: qEnvelope });
		qSite = qLabel = qPrice = qUrl = qConditions = qError = '';
		showToast('Devis noté');
	}

	const hostOf = (url: string) => {
		try {
			return new URL(url).hostname.replace(/^www\./, '');
		} catch {
			return '';
		}
	};
</script>

<div class="trip-budget">
	<section class="card p-4" aria-label="Enveloppes">
		<div class="flex flex-wrap items-baseline justify-between gap-2">
			<h2 class="label-xs">Enveloppes</h2>
			{#if budget}<span class="meta-xs tabular">{formatEUR(budget.total)} / jour{trip.travellers > 1 ? ` · ${formatEUR(budget.perPerson)} / pers.` : ''}</span>{/if}
		</div>
		<table class="mt-2 w-full text-[13px]">
			<thead class="meta-xs text-left">
				<tr><th class="py-1 font-normal">Enveloppe</th><th class="py-1 text-right font-normal">Prévu</th><th class="py-1 text-right font-normal">Dépensé</th></tr>
			</thead>
			<tbody class="divide-y divide-[var(--border-subtle)]">
				{#each ENVELOPES as e (e.id)}
					{@const planned = trip.envelopes[e.id] ?? 0}
					{@const actual = actuals[e.id] ?? 0}
					<tr>
						<td class="py-1.5">{e.label}</td>
						<td class="py-1.5 text-right">
							<input type="text" inputmode="decimal" class="input-surface tabular w-24 py-0.5 text-right" value={planned ? String(planned) : ''} placeholder="0" aria-label="Prévu · {e.label} (€)" onchange={(ev) => onEnvelopeInput(e.id, ev)} />
						</td>
						<td class="tabular py-1.5 text-right {planned && actual > planned ? 'font-medium' : ''}" style={planned && actual > planned ? 'color: var(--amber);' : ''}>{actual ? formatEUR(actual) : '—'}</td>
					</tr>
				{/each}
			</tbody>
			<tfoot class="font-medium">
				<tr><td class="pt-2">Total</td><td class="tabular pt-2 pr-2 text-right">{formatEUR(plannedTotal(trip))}</td><td class="tabular pt-2 text-right">{actualTotal ? formatEUR(actualTotal) : '—'}</td></tr>
			</tfoot>
		</table>
		<p class="meta-xs mt-2">
			Dépensé = opérations de la période de vacances, par sous-catégorie, et les réservations payées avant (sites de voyage, paiements à l’étranger) rattachées au voyage.
			{#if trip.periodId}<button type="button" class="press cursor-pointer font-medium hover:underline" style="color: var(--accent);" onclick={openOperations}>Voir les opérations</button>{:else}Donne des dates au voyage pour les compter.{/if}
		</p>
		{#if estimate}
			<p class="meta-xs mt-2">
				Repère : {describeEstimate(estimate, formatEUR)}{#if budget} · ce voyage : <span class="tabular">{formatEUR(budget.total)}/jour</span> prévus{/if}.
				{#if plannedTotal(trip) === 0 && days > 0}
					<button type="button" class="press cursor-pointer font-medium hover:underline" style="color: var(--accent);" onclick={takeEstimate}>Prendre ces montants ({formatEUR(estimate.perDay * days)} pour {days} jour{days > 1 ? 's' : ''})</button>
				{/if}
			</p>
		{/if}
		<div class="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-subtle)] pt-3 text-[12px]">
			<label class="flex items-center gap-2">
				<span class="meta-xs">Financé par</span>
				<select class="input-surface min-w-0 cursor-pointer py-1 text-[12px]" value={trip.goalId ?? ''} aria-label="Objectif d’épargne lié" onchange={(e) => setGoal(trip.id, e.currentTarget.value || null)}>
					<option value="">aucun objectif</option>
					{#each goalsState.goals as g (g.id)}<option value={g.id}>{g.name}</option>{/each}
				</select>
			</label>
			{#if goal}<span class="tabular">{formatEUR(goal.currentAmount)} épargnés sur {formatEUR(goal.targetAmount)}</span>{/if}
		</div>
		{#if plan}
			<p class="mt-2 text-[12px]">
				{#if plan.remaining > 0}
					<span class="tabular font-medium">{formatEUR(plan.monthly)}/mois</span> à mettre de côté pendant {plan.months} mois : reste <span class="tabular">{formatEUR(plan.remaining)}</span> à financer{deducted.length ? `, une fois ${deducted.join(' et ')} déduit${deducted.length > 1 ? 's' : ''}` : ''}.
				{:else}
					Le voyage est financé : rien à mettre de côté.
				{/if}
				<button type="button" class="press cursor-pointer font-medium hover:underline" style="color: var(--accent);" onclick={() => navigate('/simulateur')} title="Le simulateur propose ce voyage comme scénario : la dépense à la date du départ sur le patrimoine projeté">Voir dans le simulateur</button>
			</p>
		{/if}
	</section>

	<section class="card p-4" aria-label="Devis relevés">
		<h2 class="label-xs">Devis relevés</h2>
		{#if trip.quotes.length === 0}
			<p class="meta-xs mt-2">Note ici ce qu’un site affiche (prix, conditions) : les devis d’une même enveloppe se comparent, « Acheté » remplit l’enveloppe.</p>
		{:else}
			{#each ENVELOPES.filter((e) => trip.quotes.some((q) => q.envelope === e.id)) as e (e.id)}
				{@const compared = compareQuotes(trip.quotes, e.id)}
				<p class="meta-xs mt-3 mb-1">{e.label}</p>
				<ul class="divide-y divide-[var(--border-subtle)] text-[13px]">
					{#each compared as q, i (q.id)}
						<li class="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-1.5 {q.bought ? 'font-medium' : ''}">
							<span class="min-w-0 flex-1">
								<span>{q.site}</span>{#if q.label}<span class="text-secondary"> · {q.label}</span>{/if}
								{#if q.url}<a href={q.url} target="_blank" rel="noopener noreferrer" class="ml-1 text-[11px] hover:underline" style="color: var(--accent);">{hostOf(q.url) || 'lien'} ↗</a>{/if}
								{#if q.conditions}<span class="meta-xs block">{q.conditions}</span>{/if}
							</span>
							<span class="meta-xs tabular">{formatDate(q.date)}</span>
							<span class="tabular w-24 text-right">{formatEUR(q.price)}</span>
							{#if i === 0 && !q.bought && compared.length > 1}<span class="chip chip-accent px-1.5 py-0 text-[10px]">le moins cher</span>{/if}
							<button type="button" class="btn {q.bought ? 'btn-accent' : 'btn-secondary'} btn-sm" onclick={() => toggleBought(trip.id, q.id)}>{q.bought ? 'Acheté ✓' : 'Acheté'}</button>
							<button type="button" class="press cursor-pointer text-xs text-secondary hover:underline" onclick={() => removeQuote(trip.id, q.id)} aria-label="Retirer le devis {q.site}">Retirer</button>
						</li>
					{/each}
				</ul>
			{/each}
		{/if}
		<form class="mt-3 grid grid-cols-2 gap-2 text-[13px] sm:grid-cols-3" onsubmit={submitQuote}>
			<input type="text" class="input-surface py-1" placeholder="Site (Booking…)" maxlength="40" bind:value={qSite} aria-label="Site du devis" />
			<input type="text" class="input-surface py-1" placeholder="Quoi (appartement, vol A/R…)" maxlength="80" bind:value={qLabel} aria-label="Objet du devis" />
			<input type="text" inputmode="decimal" class="input-surface tabular py-1" placeholder="Prix (€)" bind:value={qPrice} aria-label="Prix du devis (€)" />
			<select class="input-surface cursor-pointer py-1" bind:value={qEnvelope} aria-label="Enveloppe du devis">
				{#each ENVELOPES as e (e.id)}<option value={e.id}>{e.label}</option>{/each}
			</select>
			<input type="url" class="input-surface py-1" placeholder="Lien (optionnel)" bind:value={qUrl} aria-label="Lien du devis" />
			<input type="text" class="input-surface py-1" placeholder="Conditions (annulation…)" maxlength="120" bind:value={qConditions} aria-label="Conditions du devis" />
			<div class="col-span-2 flex items-center gap-2 sm:col-span-3">
				<button type="submit" class="btn btn-secondary btn-sm">Noter ce devis</button>
				{#if qError}<span class="meta-xs" style="color: var(--amber);">{qError}</span>{/if}
			</div>
		</form>
	</section>
</div>

<style>
	.trip-budget {
		display: grid;
		gap: 12px;
		grid-template-columns: minmax(0, 1fr);
		align-items: start;
	}
	@media (min-width: 1024px) {
		.trip-budget {
			grid-template-columns: minmax(0, 5fr) minmax(0, 7fr);
		}
	}
</style>
