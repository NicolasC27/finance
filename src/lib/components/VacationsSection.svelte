<script lang="ts">
	import { vacationState, addVacation, removeVacation, updateVacation, vacationOf, type VacationPeriod } from '$lib/vacations.svelte';
	import { categorize, VACATION_ELIGIBLE } from '$lib/categories';
	import { budgetState } from '$lib/budget.svelte';
	import { getMerchantCategoryMap } from '$lib/store.svelte';
	import { getBudgetTransactions } from '$lib/transfers.svelte';
	import { isPending, spendAmount } from '$lib/data';
	import { formatDate, formatEUR } from '$lib/format';
	import { showToast, uiState, showSuccess } from '$lib/ui.svelte';
	import { navigate } from '$lib/router.svelte';
	import { rangeLabel, suggestVacationLabel } from '$lib/rangeCalendar';
	import { floating } from '$lib/actions/floating';
	import RangeCalendar from './RangeCalendar.svelte';

	/**
	 * 'Périodes de vacances' section (Budget page block): for each period the number of reclassified
	 * operations and their total. A period is created or redated on a French calendar by sliding
	 * across its days; the other periods show as zones on it, and the name is proposed from the
	 * month. The explanation, dates, operation count and total follow the block's « Éléments
	 * affichés ».
	 */
	let {
		showExplanation = true,
		showDates = true,
		showCount = true,
		showTotal = true,
		fill = null
	}: {
		showExplanation?: boolean;
		showDates?: boolean;
		showCount?: boolean;
		showTotal?: boolean;
		/** Height of the tile in px when it is set: the card then stretches down to the tile bottom. */
		fill?: number | null;
	} = $props();

	/** Period being created (id null) or redated, with the element the calendar hangs from. */
	interface Editor {
		id: string | null;
		start: string;
		end: string;
		label: string;
		/** The name was typed (or exists): the month suggestion no longer overwrites it. */
		named: boolean;
		anchor: HTMLElement;
	}

	let editor = $state<Editor | null>(null);
	let addButton = $state<HTMLButtonElement | null>(null);
	let pop = $state<HTMLElement | null>(null);

	function openAdd() {
		if (!addButton) return;
		editor = { id: null, start: '', end: '', label: '', named: false, anchor: addButton };
	}

	function openEdit(e: MouseEvent, p: VacationPeriod) {
		editor = { id: p.id, start: p.start, end: p.end, label: p.label, named: true, anchor: e.currentTarget as HTMLElement };
	}

	/** Dates slid on the calendar; the name follows the month until the user types one. */
	function pick(start: string, end: string) {
		if (!editor) return;
		editor.start = start;
		editor.end = end;
		if (!editor.named) editor.label = suggestVacationLabel(start);
	}

	function save() {
		if (!editor || !editor.start || !editor.end) return;
		if (editor.id) {
			updateVacation(editor.id, { label: editor.label, start: editor.start, end: editor.end });
			showToast('Période modifiée');
		} else {
			const p = addVacation(editor.label, editor.start, editor.end);
			showSuccess(`Période « ${p.label} » ajoutée : les dépenses du ${formatDate(p.start)} au ${formatDate(p.end)} passent en Vacances`, 'Annuler', () => removeVacation(p.id));
		}
		editor = null;
	}

	/** Other periods, painted as zones on the calendar. */
	const marks = $derived(vacationState.periods.filter((p) => p.id !== editor?.id).map((p) => ({ start: p.start, end: p.end, label: p.label })));

	/** Closing the calendar: click outside it (and outside its button) or Escape. */
	$effect(() => {
		if (!editor) return;
		const onDown = (e: PointerEvent) => {
			const target = e.target as Node | null;
			if (target && (pop?.contains(target) || editor?.anchor.contains(target))) return;
			editor = null;
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') editor = null;
		};
		document.addEventListener('pointerdown', onDown, true);
		document.addEventListener('keydown', onKey);
		return () => {
			document.removeEventListener('pointerdown', onDown, true);
			document.removeEventListener('keydown', onKey);
		};
	});

	function remove(id: string, label: string) {
		removeVacation(id);
		showToast(`Période « ${label} » supprimée`);
	}

	/**
	 * Per period: operations classified as Vacances (attached manually, otherwise by real date) and
	 * net total (refunds deducted).
	 */
	const stats = $derived.by(() => {
		const out = new Map<string, { count: number; total: number }>();
		for (const p of vacationState.periods) out.set(p.id, { count: 0, total: 0 });
		for (const tx of getBudgetTransactions()) {
			if (isPending(tx)) continue;
			if (categorize(tx, budgetState.overrides, undefined, getMerchantCategoryMap()) !== 'vacances') continue;
			const spend = spendAmount(tx, 'vacances') ?? 0;
			const period = vacationOf(tx);
			if (!period) continue;
			const s = out.get(period.id)!;
			s.count += 1;
			s.total = Math.round((s.total + spend) * 100) / 100;
		}
		return out;
	});

	const eligibleLabel = [...VACATION_ELIGIBLE].join(', ');

	/** Opens Transactions on the period, widened by 5 days after the end (late bank booking). */
	function openPeriod(id: string, start: string, end: string) {
		const d = new Date(`${end}T12:00:00`);
		d.setDate(d.getDate() + 5);
		uiState.txFilter = { from: start, to: d.toISOString().slice(0, 10), vacationId: id };
		navigate('/transactions');
	}
</script>

<!-- Header: title and the add action (collapsing is done by the block); pt-3 keeps it clear of the block's hover toolbar -->
<section class="flex flex-col pt-3" style={fill ? `min-height: ${fill}px;` : ''}>
	<div class="mb-3 flex flex-wrap items-center justify-between gap-3">
		<h2 class="label-xs">Périodes de vacances</h2>
		<button
			type="button"
			class="btn btn-accent btn-sm"
			bind:this={addButton}
			aria-haspopup="dialog"
			aria-expanded={editor !== null && editor.id === null}
			onclick={() => (editor && editor.id === null ? (editor = null) : openAdd())}
		>
			+ Ajouter une période
		</button>
	</div>

	<div class="card flex-1 p-4">
		{#if showExplanation}
			<p class="meta-xs mb-3">
				Pendant ces dates, les dépenses variables ({eligibleLabel}) passent en <span class="font-medium" style="color: var(--text);">Vacances</span>.
				La date réelle du paiement carte est lue dans le libellé (« PAIEMENT CB 0308 »), même si la banque comptabilise plus tard.
				Charges fixes, abonnements, santé et revenus ne bougent pas ; une catégorie choisie à la main garde la priorité.
			</p>
		{/if}

		{#if vacationState.periods.length > 0}
			<ul class="divide-y divide-[var(--border-subtle)]">
				{#each vacationState.periods as p (p.id)}
					{@const s = stats.get(p.id) ?? { count: 0, total: 0 }}
					<li class="flex flex-wrap items-center gap-x-4 gap-y-1 py-2 text-[13px]" class:vac-editing={editor?.id === p.id}>
						<button type="button" class="press min-w-0 flex-[1_1_9rem] cursor-pointer truncate text-left font-medium transition-colors hover:text-[var(--accent)] hover:underline" title="Voir les opérations de la période, et celles comptabilisées jusqu'à 5 jours après (à vérifier)" onclick={() => openPeriod(p.id, p.start, p.end)}>{p.label}</button>
						{#if showDates}<span class="tabular text-secondary">du {formatDate(p.start)} au {formatDate(p.end)}</span>{/if}
						{#if showCount}<span class="tabular text-secondary">{s.count} opération{s.count > 1 ? 's' : ''}</span>{/if}
						{#if showTotal}<span class="tabular w-24 text-right font-semibold">{formatEUR(s.total)}</span>{/if}
						<button type="button" class="press cursor-pointer text-xs text-secondary transition-colors hover:underline" aria-haspopup="dialog" onclick={(e) => openEdit(e, p)}>Modifier</button>
						<button
							type="button"
							class="press cursor-pointer text-xs transition-colors hover:underline"
							style="color: var(--amber);"
							onclick={() => remove(p.id, p.label)}
						>
							Supprimer
						</button>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="meta-xs">Aucune période pour l'instant : « + Ajouter une période », puis glisse sur les jours.</p>
		{/if}
	</div>
</section>

{#if editor}
	<div
		class="vac-pop card w-[36rem] max-w-[calc(100vw-1rem)] p-3 shadow-xl"
		role="dialog"
		aria-label={editor.id ? 'Modifier la période' : 'Nouvelle période de vacances'}
		bind:this={pop}
		use:floating={{ anchor: editor.anchor, align: 'end' }}
	>
		<p class="label-xs mb-2">{editor.id ? 'Modifier la période' : 'Nouvelle période de vacances'}</p>
		<RangeCalendar start={editor.start} end={editor.end} {marks} autofocus label="Dates de la période" onselect={pick} />
		<form
			class="mt-1 flex flex-wrap items-center gap-2"
			onsubmit={(e) => {
				e.preventDefault();
				save();
			}}
		>
			<input
				type="text"
				class="input-surface min-w-0 flex-[1_1_12rem]"
				placeholder="Nom de la période"
				maxlength="40"
				value={editor.label}
				oninput={(e) => {
					if (!editor) return;
					editor.label = e.currentTarget.value;
					editor.named = true;
				}}
				aria-label="Nom de la période"
			/>
			<button type="submit" class="btn btn-primary btn-sm" disabled={!editor.start || !editor.end} title={editor.start ? rangeLabel(editor.start, editor.end) : 'Glisse d’abord sur les jours'}>
				{editor.id ? 'Enregistrer' : 'Créer'}
			</button>
			<button type="button" class="btn btn-secondary btn-sm" onclick={() => (editor = null)}>Annuler</button>
		</form>
	</div>
{/if}

<style>
	.vac-pop {
		animation: vac-pop 150ms ease-out backwards;
	}
	@keyframes vac-pop {
		from {
			opacity: 0;
			transform: translateY(-4px);
		}
	}
	.vac-editing {
		background-color: var(--accent-soft);
	}
</style>
