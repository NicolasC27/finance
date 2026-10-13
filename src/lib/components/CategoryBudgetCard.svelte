<script lang="ts">
	import type { CategoryId } from '$lib/types';
	import { getCategory } from '$lib/categories';
	import { budgetState, setBudget } from '$lib/budget.svelte';
	import { formatEUR } from '$lib/format';
	import { uiState, showToast } from '$lib/ui.svelte';
	import { navigate } from '$lib/router.svelte';
	import { lighten } from '$lib/color';
	import Sparkline from './Sparkline.svelte';
	import { contextActions, type MenuInput } from '$lib/contextMenu.svelte';

	/**
	 * Budget card: consumed percentage + draggable spent/budget slider. The spent/remaining line and the
	 * percentage follow the « Éléments affichés » of the Budget block; the slider always shows, being
	 * the only way to set a budget. `trend` (spending of the last months, oldest first) draws a small
	 * sparkline under the percentage. Right click: its operations, the envelope edit (the slider takes
	 * the focus) and the envelope set to the month's spending, with undo.
	 */
	let {
		categoryId,
		spent,
		index = 0,
		showDetail = true,
		showPercent = true,
		trend = []
	}: {
		categoryId: CategoryId;
		/** Amount spent in the selected month (positive). */
		spent: number;
		/** Position in the grid (entrance stagger). */
		index?: number;
		showDetail?: boolean;
		showPercent?: boolean;
		/** Spending of the last months (oldest first), drawn as a sparkline when 3+ values. */
		trend?: number[];
	} = $props();

	const STEP = 10; // slider step in €
	const FLOOR_MAX = 250; // minimum slider max (avoids squashing on the left)
	const CAP_MAX = 5000; // safety ceiling for the max

	const category = $derived(getCategory(categoryId));
	/** Light tone of the category (slider gradient). */
	const lighter = $derived(lighten(category.color, 0.25));
	const storedBudget = $derived(budgetState.budgets[categoryId] ?? 0);

	// ---- Slider drag (custom pointer events) ----
	let track = $state<HTMLDivElement | null>(null);
	let dragging = $state(false);
	let dragValue = $state(0);
	let lastCommit = 0;
	/** Slider just focused from the menu: outlined a moment so the edit is seen. */
	let editing = $state(false);
	/** Budget when the drag started ('Annuler' toast on release). */
	let dragStart = 0;

	/** Displayed budget: live drag value, otherwise the persisted value. */
	const budget = $derived(dragging ? dragValue : storedBudget);
	// Dynamic max: ~1.3× the largest value (~23 % margin right of the thumb), rounded up to 50 €,
	// clamped to [FLOOR_MAX, CAP_MAX]. Based on storedBudget (not the drag value) so the track does
	// not rescale while dragging.
	const max = $derived(
		Math.min(
			Math.max(Math.ceil((Math.max(storedBudget, spent) * 1.3) / 50) * 50, FLOOR_MAX),
			CAP_MAX
		)
	);

	const ratio = $derived(budget > 0 ? spent / budget : spent > 0 ? Infinity : 0);
	const over = $derived(spent > 0 && spent > budget);
	// Without a budget: no invented percentage ('100 %' was misleading), just 'hors budget'
	const percentText = $derived(budget > 0 ? `${Math.round(ratio * 100)} %` : spent > 0 ? 'hors budget' : '—');

	// Geometry of the merged slider (as % of the track)
	const thumbPct = $derived((budget / max) * 100);
	const spentPct = $derived((Math.min(spent, max) / max) * 100);
	const insidePct = $derived(Math.min(spentPct, thumbPct));
	const beyondPct = $derived(Math.max(0, spentPct - insidePct));

	function valueFromPointer(clientX: number): number {
		if (!track) return 0;
		const rect = track.getBoundingClientRect();
		const t = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
		return Math.min(Math.max(Math.round((t * max) / STEP) * STEP, 0), max);
	}

	/** Persists at most every 150 ms while dragging. */
	function commitThrottled(value: number) {
		const now = Date.now();
		if (now - lastCommit >= 150) {
			lastCommit = now;
			setBudget(categoryId, value);
		}
	}

	/**
	 * The drag starts ONLY on the handle (±16 px): before, a click or tap anywhere on the bar rewrote
	 * the budget with no way back.
	 */
	function onPointerDown(e: PointerEvent) {
		if (!track) return;
		const rect = track.getBoundingClientRect();
		const thumbX = rect.left + (thumbPct / 100) * rect.width;
		if (Math.abs(e.clientX - thumbX) > 16) return;
		track.setPointerCapture(e.pointerId);
		dragging = true;
		dragStart = storedBudget;
		dragValue = storedBudget;
	}

	function onPointerMove(e: PointerEvent) {
		if (!dragging) return;
		dragValue = valueFromPointer(e.clientX);
		commitThrottled(dragValue);
	}

	function onPointerUp(e: PointerEvent) {
		if (!dragging) return;
		dragging = false;
		if (track?.hasPointerCapture(e.pointerId)) track.releasePointerCapture(e.pointerId);
		setBudget(categoryId, dragValue);
		if (dragValue !== dragStart) announce(dragStart, dragValue);
	}

	/** Toast of a budget change, whose « Annuler » restores the former budget. */
	function announce(before: number, after: number) {
		showToast(`${category.label} : ${formatEUR(before)} → ${formatEUR(after)}`, 'Annuler', () => setBudget(categoryId, before));
	}

	/** « Modifier l'enveloppe »: the slider takes the focus (arrows ±10 €, ⇧ ±50 €), outlined a moment. */
	function editBudget() {
		if (!track) return;
		track.focus();
		editing = true;
		setTimeout(() => (editing = false), 1600);
	}

	/** Budget that covers the month's spending, rounded up to the slider step. */
	const spentBudget = $derived(Math.ceil(spent / STEP) * STEP);

	/** Right-click entries of the card. */
	function menuItems(): MenuInput[] {
		return [
			{ label: 'Voir les opérations du mois', onSelect: openTransactions },
			{ label: "Modifier l'enveloppe", hint: '← →', onSelect: editBudget },
			spent > 0 &&
				spentBudget !== storedBudget && {
					label: `Caler l'enveloppe sur la dépense (${formatEUR(spentBudget)})`,
					onSelect: () => {
						const before = storedBudget;
						setBudget(categoryId, spentBudget);
						announce(before, spentBudget);
					}
				}
		];
	}

	/** Opens the Transactions page filtered on this category and the selected month. */
	function openTransactions() {
		const m = budgetState.selectedMonth;
		const [y, mm] = m.split('-').map(Number);
		const last = m ? new Date(y!, mm!, 0).getDate() : 0;
		uiState.txFilter = { categoryId, ...(m ? { from: `${m}-01`, to: `${m}-${String(last).padStart(2, '0')}` } : {}) };
		navigate('/transactions');
	}

	/** Keyboard accessibility: ←/→ ±10 €, ⇧ ±50 €. */
	function onKeyDown(e: KeyboardEvent) {
		const delta = e.shiftKey ? 50 : STEP;
		let next: number | null = null;
		if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = Math.min(budget + delta, max);
		if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = Math.max(budget - delta, 0);
		if (next !== null) {
			e.preventDefault();
			setBudget(categoryId, next);
		}
	}
</script>

<div class="card card-hover fade-slide p-4" style="--stagger: {index * 60}ms;" use:contextActions={menuItems}>
	<div class="flex items-start justify-between gap-4">
		<div class="min-w-0">
			<button
				type="button"
				class="press flex cursor-pointer items-center gap-2.5 text-left transition-colors hover:text-[var(--accent)]"
				title="Voir les opérations {category.label} du mois"
				onclick={openTransactions}
			>
				<span class="h-2.5 w-2.5 shrink-0 rounded-full" style="background-color: {category.color};"></span>
				<span class="truncate text-sm font-medium">{category.label}</span>
			</button>
			<!-- Target budget: updated live while dragging -->
			<p class="amount-md mt-2">{formatEUR(budget)}</p>
			{#if showDetail}
				<p class="meta-xs mt-1">
					Dépensé {formatEUR(spent)}
					{#if over}
						· <span class="font-medium" style="color: var(--amber);">dépassé de {formatEUR(spent - budget)}</span>
					{:else}
						· reste {formatEUR(Math.max(budget - spent, 0))}
					{/if}
				</p>
			{/if}
		</div>

		<!-- Consumed percentage as text (amber pill on overrun); the ring duplicated the slider -->
		<div class="flex shrink-0 flex-col items-end gap-1.5">
			{#if showPercent}
				<span class="tabular shrink-0 {over ? 'chip chip-amber' : 'meta-xs'}" title="{formatEUR(spent)} dépensés sur {formatEUR(budget)}">{percentText}</span>
			{/if}
			{#if trend.length >= 3 && trend.some((v) => v !== 0)}
				<span title="Dépenses des {trend.length} derniers mois : {trend.map((v) => formatEUR(v)).join(' · ')}">
					<Sparkline values={trend} color={category.color} width={52} height={20} />
				</span>
			{/if}
		</div>
	</div>

	<!-- Merged slider: fill = spent, handle = target budget -->
	<div
		bind:this={track}
		class="budget-slider relative mt-3 flex h-6 touch-pan-y items-center {dragging
			? 'dragging'
			: ''}"
		class:editing
		role="slider"
		tabindex="0"
		aria-label="Budget {category.label}"
		aria-valuemin={0}
		aria-valuemax={max}
		aria-valuenow={Math.round(budget)}
		aria-valuetext="{formatEUR(budget)} sur un maximum de {formatEUR(max)}"
		onpointerdown={onPointerDown}
		onpointermove={onPointerMove}
		onpointerup={onPointerUp}
		onpointercancel={onPointerUp}
		onkeydown={onKeyDown}
	>
		<!-- Background track -->
		<div class="absolute inset-x-0 top-1/2 h-3 -translate-y-1/2 overflow-hidden rounded-full">
			<div class="absolute inset-0" style="background-color: var(--surface-hover);"></div>
			<!-- Area beyond the marker: faded -->
			<div
				class="slider-anim absolute inset-y-0 rounded-full"
				style="left: {thumbPct}%; right: 0; background-color: color-mix(in srgb, var(--bg) 55%, transparent);"
			></div>
			<!-- Spent within the envelope: two-tone category gradient -->
			<div
				class="slider-fill slider-anim absolute inset-y-0 left-0 rounded-full"
				style="width: {insidePct}%; background: linear-gradient(90deg, {category.color}, {lighter}); animation-delay: {index * 50}ms;"
			></div>
			<!-- Spent beyond the budget: amber stripes (overrun) or faded tone -->
			{#if beyondPct > 0.05}
				<div
					class="slider-fill slider-anim absolute inset-y-0"
					style="left: {insidePct}%; width: {beyondPct}%; {over
						? 'background: repeating-linear-gradient(45deg, var(--accent-2) 0 5px, color-mix(in srgb, var(--accent-2) 22%, transparent) 5px 10px);'
						: `background: linear-gradient(90deg, ${category.color}, ${lighter}); opacity: 0.35;`}"
				></div>
			{/if}
		</div>
		<!-- Handle = target budget -->
		<div
			class="slider-thumb absolute top-1/2"
			style="left: {thumbPct}%; background-color: {category.color}; animation-delay: {index * 50}ms;"
		></div>
	</div>
</div>

<style>
	/* Ring: fill animated on load (from 0 %), then transitions */

	/* Slider fills: animated growth on load */
	.slider-fill {
		transform-origin: left;
		animation: grow-x 350ms ease-out backwards;
	}

	@keyframes grow-x {
		from {
			transform: scaleX(0);
		}
	}

	/* Handle: solid dot + ring, grab cursor */
	.slider-thumb {
		width: 18px;
		height: 18px;
		border-radius: 9999px;
		transform: translate(-50%, -50%);
		box-shadow:
			0 0 0 3px var(--surface),
			0 0 0 4.5px var(--border);
		cursor: grab;
		animation: pop-in 300ms ease-out backwards;
		transition: left 200ms ease-out;
	}

	@keyframes pop-in {
		from {
			scale: 0;
		}
	}

	.slider-anim {
		transition:
			left 200ms ease-out,
			width 200ms ease-out;
	}

	/* While dragging: instant tracking, no transition */
	.budget-slider.dragging .slider-thumb,
	.budget-slider.dragging .slider-anim {
		transition: none;
	}

	.budget-slider.dragging .slider-thumb {
		cursor: grabbing;
		scale: 1.15;
	}

	/* Only the handle can be grabbed: the track is no longer a clickable area */
	.slider-thumb {
		touch-action: none;
	}

	.budget-slider:focus-visible,
	.budget-slider.editing {
		outline: 2px solid var(--accent);
		outline-offset: 4px;
		border-radius: 9999px;
	}
</style>
