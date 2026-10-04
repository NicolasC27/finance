<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import {
		WEEK_HEADERS,
		WEEK_NAMES,
		canTurn,
		clampIso,
		dayLabel,
		inRange,
		marksOn,
		monthGrid,
		monthOf,
		monthTitle,
		monthWeeks,
		moveFocus,
		orderRange,
		outOfBounds,
		rangeDays,
		rangeLabel,
		revealMonth,
		shiftMonth,
		todayIso,
		type CalendarMark
	} from '$lib/rangeCalendar';

	/**
	 * French calendar to pick a period by sliding across the days (mouse, pen or finger): press on the
	 * first day, slide, release on the last one. The preview follows the pointer, and hovering a month
	 * arrow while sliding turns the page after ~500 ms. Also: click the start then the end,
	 * Shift+click moves the nearest bound of the current period, keyboard (arrows, Enter or Space on
	 * the start then on the end, Shift+arrows to stretch, PageUp/PageDown, Home/End, Escape cancels a
	 * pending start). `marks` paints existing zones (vacation periods) as a thin band, their name on
	 * hover. `single` picks one day. The calendar keeps no value: `onselect` hands it to the parent.
	 * `past` ends the strip on the current month when nothing is selected (filters look backwards).
	 * `onanchor` reports the start chosen by a first click (null once the period is picked or
	 * dropped), so a parent can offer an open period (« depuis le … »). A period with one bound only
	 * is shown as « Depuis le … » / « Jusqu'au … ».
	 */
	let {
		start = '',
		end = '',
		mode = 'range',
		months = 2,
		min = '',
		max = '',
		marks = [],
		label = 'Calendrier',
		past = false,
		autofocus = false,
		onselect,
		onanchor
	}: {
		start?: string;
		end?: string;
		mode?: 'range' | 'single';
		/** Months side by side (one when the calendar is narrower than ~440 px). */
		months?: number;
		min?: string;
		max?: string;
		marks?: readonly CalendarMark[];
		label?: string;
		past?: boolean;
		/** Focus the selected day (or today) when the calendar appears. */
		autofocus?: boolean;
		onselect?: (start: string, end: string) => void;
		onanchor?: (date: string | null) => void;
	} = $props();

	const today = todayIso();
	const initialFocus = untrack(() => clampIso(start || end || today, min, max));
	let first = $state(untrack(() => (start || end || !past ? monthOf(initialFocus) : shiftMonth(monthOf(today), 1 - Math.max(1, months)))));
	let width = $state(0);
	const shown = $derived(width > 0 && width < 440 ? 1 : Math.max(1, months));
	const grids = $derived(Array.from({ length: shown }, (_, i) => monthGrid(shiftMonth(first, i))));
	let focusDate = $state(initialFocus);
	let anchor = $state<string | null>(null);
	let hover = $state<string | null>(null);
	let dragging = $state(false);
	let root = $state<HTMLElement | null>(null);

	let moved = false;
	let secondClick = false;
	let shiftPress = false;
	let navTimer: ReturnType<typeof setTimeout> | null = null;
	let navDir = 0;

	const preview = $derived.by((): [string, string] | null => {
		if (anchor) return orderRange(anchor, hover ?? anchor);
		if (start && end) return orderRange(start, end);
		if (start || end) return [start || end, start || end];
		return null;
	});

	const footer = $derived.by(() => {
		if (mode === 'single') return start ? rangeLabel(start, start, today) : 'Choisis un jour.';
		if (anchor && !dragging) return `Début : ${rangeLabel(anchor, anchor, today)} · clique ou glisse jusqu'au dernier jour (Échap pour annuler)`;
		if (!anchor && start && !end) return `Depuis le ${rangeLabel(start, start, today)}`;
		if (!anchor && end && !start) return `Jusqu'au ${rangeLabel(end, end, today)}`;
		if (preview) return rangeLabel(preview[0], preview[1], today);
		return 'Glisse sur les jours pour choisir une période, ou clique le début puis la fin.';
	});

	/** The pending start is reported to the parent (open periods). */
	$effect(() => {
		const pending = anchor;
		untrack(() => onanchor?.(pending));
	});

	/** A selection set from outside (shortcut, other field) is brought into view. */
	$effect(() => {
		const s = start || end;
		if (!s) return;
		untrack(() => {
			first = revealMonth(first, shown, monthOf(s));
			if (!anchor) focusDate = clampIso(s, min, max);
		});
	});

	/** When the calendar narrows to one month, the focused month stays visible. */
	$effect(() => {
		const count = shown;
		untrack(() => (first = revealMonth(first, count, monthOf(focusDate))));
	});

	onMount(() => {
		if (autofocus) void focusDay(focusDate);
		return () => detach();
	});

	/** The selectable day under a viewport point (null outside the calendar or out of bounds). */
	function dateUnder(x: number, y: number): string | null {
		const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-rc-date]');
		if (!el || !root?.contains(el)) return null;
		const date = el.dataset.rcDate ?? '';
		return date && !outOfBounds(date, min, max) ? date : null;
	}

	/** Direction of the enabled month arrow under a viewport point (0 when none). */
	function navUnder(x: number, y: number): number {
		const el = document.elementFromPoint(x, y)?.closest<HTMLButtonElement>('[data-rc-nav]');
		if (!el || el.disabled || !root?.contains(el)) return 0;
		return Number(el.dataset.rcNav) || 0;
	}

	function stopNav() {
		if (navTimer) clearTimeout(navTimer);
		navTimer = null;
		navDir = 0;
	}

	/** While a slide rests on a month arrow, the page turns every ~500 ms, and stops at `min` / `max`. */
	function armNav(dir: number) {
		if (dir === navDir) return;
		stopNav();
		if (!dir || !canTurn(first, shown, dir, min, max)) return;
		navDir = dir;
		const turn = () => {
			if (!canTurn(first, shown, dir, min, max)) return stopNav();
			first = shiftMonth(first, dir);
			navTimer = setTimeout(turn, 500);
		};
		navTimer = setTimeout(turn, 500);
	}

	function detach() {
		stopNav();
		window.removeEventListener('pointermove', onPointerMove);
		window.removeEventListener('pointerup', onPointerUp);
		window.removeEventListener('pointercancel', onPointerCancel);
	}

	/**
	 * Press on a day: starts a slide (or ends a pending two-click period). The gesture is followed on
	 * the window, so the release can happen anywhere; a press with Shift moves the nearest bound.
	 */
	function onPointerDown(e: PointerEvent, date: string) {
		if (e.button !== 0 || outOfBounds(date, min, max)) return;
		e.preventDefault();
		(e.currentTarget as HTMLElement).focus({ preventScroll: true });
		focusDate = date;
		shiftPress = e.shiftKey && mode === 'range' && !!start && !!end;
		secondClick = mode === 'range' && anchor !== null && !e.shiftKey;
		if (!secondClick) anchor = date;
		hover = date;
		moved = false;
		dragging = true;
		window.addEventListener('pointermove', onPointerMove);
		window.addEventListener('pointerup', onPointerUp);
		window.addEventListener('pointercancel', onPointerCancel);
	}

	function onPointerMove(e: PointerEvent) {
		armNav(navUnder(e.clientX, e.clientY));
		const date = dateUnder(e.clientX, e.clientY);
		if (date && date !== hover) {
			hover = date;
			moved = true;
		}
	}

	/** Release: a slide or a second click selects the period; a still click marks the start. */
	function onPointerUp() {
		detach();
		dragging = false;
		const date = hover ?? anchor;
		if (!date) return;
		if (mode === 'single') return commit(date, date);
		if (shiftPress) return stretch(date);
		if (moved || secondClick) return commit(anchor ?? date, date);
		anchor = date;
		hover = date;
	}

	function onPointerCancel() {
		detach();
		dragging = false;
		if (!secondClick) {
			anchor = null;
			hover = null;
		}
	}

	/** Pending start chosen by a click: the preview follows the mouse until the second click. */
	function onHover(e: PointerEvent) {
		if (!anchor || dragging || e.pointerType === 'touch') return;
		const date = dateUnder(e.clientX, e.clientY);
		if (date) hover = date;
	}

	/** Shift+click: the period grows to the day, or its nearest bound moves to it. */
	function stretch(date: string) {
		const [s, e] = orderRange(start, end);
		if (date < s) return commit(date, e);
		if (date > e) return commit(s, date);
		return rangeDays(s, date) <= rangeDays(date, e) ? commit(date, e) : commit(s, date);
	}

	function commit(a: string, b: string) {
		const [s, e] = orderRange(a, b);
		anchor = null;
		hover = null;
		onselect?.(s, e);
	}

	/** Enter / Space on a day (or a click from assistive technology): start, then end. */
	function activate(date: string) {
		if (outOfBounds(date, min, max)) return;
		focusDate = date;
		if (mode === 'single') return commit(date, date);
		if (anchor) return commit(anchor, date);
		anchor = date;
		hover = date;
	}

	async function focusDay(date: string) {
		focusDate = date;
		first = revealMonth(first, shown, monthOf(date));
		await tick();
		root?.querySelector<HTMLElement>(`[data-rc-date="${date}"]`)?.focus({ preventScroll: true });
	}

	/**
	 * Arrows, PageUp/PageDown, Home/End move the focus (Shift stretches a period); Enter or Space
	 * marks the start then the end (handled here, so the button's own click never doubles it);
	 * Escape drops a pending start.
	 */
	function onKeyDown(e: KeyboardEvent) {
		if (!(e.target as HTMLElement).closest('[data-rc-date]')) return;
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			activate(focusDate);
			return;
		}
		const next = moveFocus(focusDate, e.key);
		if (next) {
			e.preventDefault();
			const date = clampIso(next, min, max);
			if (e.shiftKey && mode === 'range') {
				if (!anchor) anchor = focusDate;
				hover = date;
			} else if (anchor) hover = date;
			void focusDay(date);
			return;
		}
		if (e.key === 'Escape' && anchor) {
			e.preventDefault();
			e.stopPropagation();
			anchor = null;
			hover = null;
		}
	}

	/** Spoken name of a day: date, today, zones. */
	function dayAria(date: string): string {
		const extra = [date === today ? "aujourd'hui" : '', ...marksOn(date, marks).map((m) => m.label)].filter(Boolean);
		return extra.length ? `${dayLabel(date)}, ${extra.join(', ')}` : dayLabel(date);
	}
</script>

<div class="rc" bind:this={root} bind:clientWidth={width} role="group" aria-label={label}>
	<div class="rc-months" style="grid-template-columns: repeat({shown}, minmax(0, 1fr));">
		{#each grids as g, gi (g.month)}
			<div class="min-w-0">
				<div class="rc-head">
					{#if gi === 0}
						<button
							type="button"
							class="rc-nav"
							data-rc-nav="-1"
							aria-label="Mois précédent"
							title="Mois précédent (Page↑)"
							disabled={!canTurn(first, shown, -1, min, max)}
							onclick={() => (first = shiftMonth(first, -1))}
						>
							<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
						</button>
					{:else}
						<span class="rc-nav-gap" aria-hidden="true"></span>
					{/if}
					<p class="rc-title">{monthTitle(g.month)}</p>
					{#if gi === grids.length - 1}
						<button
							type="button"
							class="rc-nav"
							data-rc-nav="1"
							aria-label="Mois suivant"
							title="Mois suivant (Page↓)"
							disabled={!canTurn(first, shown, 1, min, max)}
							onclick={() => (first = shiftMonth(first, 1))}
						>
							<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
						</button>
					{:else}
						<span class="rc-nav-gap" aria-hidden="true"></span>
					{/if}
				</div>
				<div role="grid" tabindex="-1" aria-label={monthTitle(g.month)} aria-multiselectable={mode === 'range'} onkeydown={onKeyDown} onpointermove={onHover}>
					<div role="row" class="rc-row">
						{#each WEEK_HEADERS as h, i (i)}
							<span role="columnheader" class="rc-wd" class:rc-we={i >= 5} aria-label={WEEK_NAMES[i]}>{h}</span>
						{/each}
					</div>
					{#each monthWeeks(g) as week, wi (wi)}
						<div role="row" class="rc-row">
							{#each week as d, di (d ? d.date : `${g.month}-pad-${wi}-${di}`)}
								{#if d}
									{@const inside = !!preview && inRange(d.date, preview[0], preview[1])}
									{@const isStart = !!preview && d.date === preview[0]}
									{@const isEnd = !!preview && d.date === preview[1]}
									{@const zones = marksOn(d.date, marks)}
									{@const off = outOfBounds(d.date, min, max)}
									<button
										type="button"
										role="gridcell"
										class="rc-day"
										class:rc-in={inside && !isStart && !isEnd}
										class:rc-start={isStart && !isEnd}
										class:rc-end={isEnd && !isStart}
										class:rc-edge={isStart || isEnd}
										class:rc-today={d.date === today}
										class:rc-we={d.weekday >= 5}
										class:rc-off={off}
										data-rc-date={d.date}
										tabindex={d.date === focusDate ? 0 : -1}
										aria-selected={inside}
										aria-disabled={off}
										aria-label={dayAria(d.date)}
										title={zones.length ? zones.map((z) => z.label).join(' · ') : undefined}
										onpointerdown={(e) => onPointerDown(e, d.date)}
										onclick={(e) => {
											if (e.detail === 0) activate(d.date);
										}}
									>
										<span class="rc-num">{d.day}</span>
										{#if zones.length}<span class="rc-mark" aria-hidden="true"></span>{/if}
									</button>
								{:else}
									<span class="rc-pad" aria-hidden="true"></span>
								{/if}
							{/each}
						</div>
					{/each}
				</div>
			</div>
		{/each}
	</div>
	<p class="meta-xs rc-foot tabular" aria-live="polite">{footer}</p>
</div>

<style>
	.rc {
		user-select: none;
		-webkit-user-select: none;
	}
	/* Sliding a finger over the days selects them instead of scrolling the page */
	.rc-months {
		display: grid;
		gap: 1rem;
		touch-action: none;
	}
	.rc-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.25rem;
		margin-bottom: 0.25rem;
	}
	.rc-title {
		font-size: 13px;
		font-weight: 500;
		color: var(--text);
	}
	.rc-nav,
	.rc-nav-gap {
		display: flex;
		width: 1.6rem;
		height: 1.6rem;
		flex-shrink: 0;
		align-items: center;
		justify-content: center;
		border-radius: 9999px;
	}
	.rc-nav {
		border: 1px solid var(--hairline);
		color: var(--text-2);
		cursor: pointer;
	}
	.rc-nav:hover:enabled {
		background-color: var(--surface-hover);
		color: var(--text);
	}
	.rc-nav:disabled {
		cursor: default;
		opacity: 0.3;
	}
	.rc-row {
		display: grid;
		grid-template-columns: repeat(7, minmax(0, 1fr));
	}
	.rc-wd {
		padding: 2px 0 4px;
		text-align: center;
		font-size: 10px;
		letter-spacing: 0.04em;
		color: var(--text-2);
	}
	.rc-day {
		position: relative;
		display: flex;
		height: 2rem;
		align-items: center;
		justify-content: center;
		font-size: 12.5px;
		font-variant-numeric: tabular-nums;
		color: var(--text);
		cursor: pointer;
	}
	.rc-num {
		display: flex;
		width: 1.75rem;
		height: 1.75rem;
		align-items: center;
		justify-content: center;
		border-radius: 9999px;
	}
	/* Weekends: quieter ink, never red */
	.rc-we {
		color: var(--text-2);
	}
	.rc-day:hover:not(.rc-off):not(.rc-edge) .rc-num {
		box-shadow: inset 0 0 0 1px var(--accent);
	}
	.rc-today .rc-num {
		box-shadow: inset 0 0 0 1.5px var(--accent);
	}
	/* Period band: soft accent between the bounds, solid accent discs on the bounds */
	.rc-in {
		background-color: color-mix(in srgb, var(--accent) 16%, transparent);
	}
	.rc-start {
		background: linear-gradient(to right, transparent 50%, color-mix(in srgb, var(--accent) 16%, transparent) 50%);
	}
	.rc-end {
		background: linear-gradient(to left, transparent 50%, color-mix(in srgb, var(--accent) 16%, transparent) 50%);
	}
	.rc-edge .rc-num {
		background-color: var(--accent);
		color: var(--bg);
		font-weight: 600;
	}
	.rc-off {
		cursor: default;
		opacity: 0.3;
	}
	.rc-mark {
		position: absolute;
		right: 20%;
		bottom: 1px;
		left: 20%;
		height: 3px;
		border-radius: 2px;
		background-color: color-mix(in srgb, var(--text-2) 55%, transparent);
	}
	.rc-day:focus-visible {
		outline: none;
	}
	.rc-day:focus-visible .rc-num {
		outline: 2px solid var(--accent);
		outline-offset: 1px;
	}
	.rc-foot {
		margin-top: 0.5rem;
		min-height: 1.1rem;
	}
	@media (prefers-reduced-motion: no-preference) {
		.rc-num {
			transition:
				background-color 120ms ease,
				box-shadow 120ms ease;
		}
	}
</style>
