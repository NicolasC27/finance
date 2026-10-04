<script lang="ts">
	import DateField from '$lib/components/DateField.svelte';
	import { goalsState, addGoal, updateGoal, removeGoal, adjustGoal, monthlyNeeded, monthlySuggested, type Goal } from '$lib/goals.svelte';
	import { uiState } from '$lib/ui.svelte';
	import { formatEUR, formatDate } from '$lib/format';
	import BudgetRing from './BudgetRing.svelte';

	/**
	 * 'Objectifs' section (Budget page block): progress rings, CRUD, quick +/−. The optional parts
	 * (monthly pace, ring, quick buttons) follow the block's « Éléments affichés »; `columns` sets the
	 * cards per row (the Budget page passes container-query classes that follow the tile width).
	 */
	let {
		showPace = true,
		showRing = true,
		showAdjust = true,
		columns = 'sm:grid-cols-2 xl:grid-cols-4'
	}: { showPace?: boolean; showRing?: boolean; showAdjust?: boolean; columns?: string } = $props();

	const SUGGESTIONS = [
		{ name: 'Vacances', targetAmount: 2000 },
		{ name: "Fonds d'urgence", targetAmount: 5000 }
	];

	let formOpen = $state(false);
	let editingId = $state<string | null>(null);
	let fName = $state('');
	let fTarget = $state('');
	let fDate = $state('');

	const goals = $derived(goalsState.goals);

	/** Opens the form (create or edit). */
	function openForm(goal?: Goal, prefill?: { name: string; targetAmount: number }) {
		editingId = goal?.id ?? null;
		fName = goal?.name ?? prefill?.name ?? '';
		fTarget = String(goal?.targetAmount ?? prefill?.targetAmount ?? '');
		fDate = goal?.targetDate ?? '';
		formOpen = true;
	}

	// Prefill requested from the Conseils card (savings capacity)
	$effect(() => {
		if (uiState.goalPrefill) {
			openForm(undefined, uiState.goalPrefill);
			uiState.goalPrefill = null;
		}
	});

	function saveForm() {
		const target = Number(fTarget.replace(',', '.').replace(/[^\d.]/g, ''));
		if (!fName.trim() || !Number.isFinite(target) || target <= 0) return;
		if (editingId) {
			updateGoal(editingId, { name: fName, targetAmount: target, targetDate: fDate || undefined });
		} else {
			addGoal({ name: fName, targetAmount: target, targetDate: fDate || undefined });
		}
		formOpen = false;
		editingId = null;
	}

	function confirmRemove(goal: Goal) {
		if (window.confirm(`Supprimer l'objectif « ${goal.name} » ?`)) removeGoal(goal.id);
	}

	/** Progress 0..1 of a goal. */
	function ratio(goal: Goal): number {
		return goal.targetAmount > 0 ? goal.currentAmount / goal.targetAmount : 0;
	}
</script>

<!-- Header: title and the '+ Nouvel objectif' action (collapsing is done by the block); pt-3 keeps it clear of the block's hover toolbar -->
<section class="pt-3">
	<div class="mb-3 flex items-center justify-between gap-3">
		<h2 class="label-xs">Objectifs d'épargne</h2>
		{#if goals.length > 0 && !formOpen}
			<button type="button" class="btn btn-accent btn-sm" onclick={() => openForm()}>
				+ Nouvel objectif
			</button>
		{/if}
	</div>

	{#if formOpen}
		<!-- Create / edit form -->
		<form
			class="card fade-slide mb-4 flex flex-wrap items-end gap-3 p-4"
			style="--stagger: 0ms;"
			onsubmit={(e) => {
				e.preventDefault();
				saveForm();
			}}
		>
			<label class="min-w-36 flex-1">
				<span class="meta-xs">Nom</span>
				<input type="text" class="input-surface mt-1 w-full" placeholder="Vacances" maxlength="40" bind:value={fName} aria-label="Nom de l'objectif" />
			</label>
			<label class="w-32">
				<span class="meta-xs">Montant cible</span>
				<input type="text" inputmode="decimal" class="input-surface tabular mt-1 w-full" placeholder="2 000" bind:value={fTarget} aria-label="Montant cible (€)" />
			</label>
			<label class="w-40">
				<span class="meta-xs">Date cible (optionnel)</span>
				<DateField bind:value={fDate} label="Date cible" class="mt-1 w-full" />
			</label>
			<div class="flex gap-2">
				<button
					type="submit"
					class="btn btn-primary"
				>
					{editingId ? 'Enregistrer' : 'Créer'}
				</button>
				<button
					type="button"
					class="btn btn-secondary"
					onclick={() => (formOpen = false)}
				>
					Annuler
				</button>
			</div>
		</form>
	{/if}

	{#if goals.length === 0}
		<!-- Single-row empty state: title, help, clickable suggestions on the right -->
		<div class="card fade-slide flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5" style="--stagger: 0ms;">
			<p class="shrink-0 text-[13px] font-medium">Aucun objectif</p>
			<p class="meta-xs min-w-0 flex-1">Un montant cible, une date si vous voulez : le rythme mensuel est calculé.</p>
			<div class="flex flex-wrap gap-1.5">
				{#each SUGGESTIONS as s (s.name)}
					<button type="button" class="btn btn-accent btn-sm tabular" onclick={() => openForm(undefined, s)}>
						{s.name} · {formatEUR(s.targetAmount)}
					</button>
				{/each}
				<button type="button" class="btn btn-primary btn-sm" onclick={() => openForm()}>
					+ Objectif personnalisé
				</button>
			</div>
		</div>
	{:else}
		<div class="grid gap-3 {columns}">
			{#each goals as goal, i (goal.id)}
				{@const done = goal.currentAmount >= goal.targetAmount}
				{@const needed = monthlyNeeded(goal)}
				<article class="card card-hover fade-slide p-4" style="--stagger: {i * 60}ms;">
					<div class="flex items-start justify-between gap-3">
						<div class="min-w-0">
							<p class="truncate text-sm font-medium">{goal.name}</p>
							<p class="amount-md mt-1.5">
								{formatEUR(goal.currentAmount)}
								<span class="meta-xs font-normal">/ {formatEUR(goal.targetAmount)}</span>
							</p>
							{#if showPace || done}
							<p class="meta-xs mt-2">
								{#if done}
									<span class="font-medium" style="color: var(--accent);">Objectif atteint — bravo</span>
								{:else if needed !== null}
									Il faut <span class="tabular font-medium" style="color: var(--text);">{formatEUR(needed)}/mois</span>
									d'ici le {formatDate(goal.targetDate ?? '')}
								{:else}
									Reste {formatEUR(goal.targetAmount - goal.currentAmount)} · rythme suggéré
									<span class="tabular">{formatEUR(monthlySuggested(goal))}/mois</span>
								{/if}
							</p>
							{/if}
						</div>
						{#if showRing}
							<BudgetRing ratio={ratio(goal)} color={goal.color ?? '#c9a86c'} size={48} stroke={6} delay={i * 60}>
								{`${Math.min(999, Math.round(ratio(goal) * 100))} %`}
							</BudgetRing>
						{/if}
					</div>
					<!-- Quick adjustment of the saved amount -->
					<div class="mt-3 flex flex-wrap items-center gap-1.5">
						{#each showAdjust ? [-50, 10, 50, 100] : [] as delta (delta)}
							<button
								type="button"
								class="btn btn-secondary btn-sm tabular"
								style={delta > 0 ? 'color: var(--accent);' : 'color: var(--amber);'}
								aria-label="{delta > 0 ? 'Ajouter' : 'Retirer'} {Math.abs(delta)} € à {goal.name}"
								onclick={() => adjustGoal(goal.id, delta)}
							>
								{delta > 0 ? `+${delta}` : `−${Math.abs(delta)}`}
							</button>
						{/each}
						<span class="flex-1"></span>
						<button
							type="button"
							class="press cursor-pointer text-xs text-secondary transition-colors hover:text-[var(--text)] hover:underline"
							onclick={() => openForm(goal)}
						>
							Modifier
						</button>
						<button
							type="button"
							class="press cursor-pointer text-xs transition-colors hover:underline"
							style="color: var(--amber);"
							onclick={() => confirmRemove(goal)}
						>
							Supprimer
						</button>
					</div>
				</article>
			{/each}
		</div>
	{/if}
</section>
