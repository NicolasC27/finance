<script lang="ts">
	import { sensitiveEUR, sensitiveEURCompact } from '$lib/format';
	import { dueTotal as dueOf, ribbonScale, type RibbonDay } from '$lib/monthRibbon';
	import { floating } from '$lib/actions/floating';
	import { navigate } from '$lib/router.svelte';
	import { uiState } from '$lib/ui.svelte';

	/**
	 * « Fil du mois »: the month on one line, one slot per day. Days gone by carry a solid tick as
	 * tall as what was spent, a hollow tick (over it today) for the debits expected, a dot marks income
	 * (hollow when expected), a rule marks today. Hover or focus a day for its detail (← → move
	 * between days); a click opens its operations, or the schedule for a day to come.
	 */
	let { days, showLegend = true }: { days: RibbonDay[]; showLegend?: boolean } = $props();

	const scale = $derived(ribbonScale(days));
	const spentTotal = $derived(days.reduce((s, d) => s + (d.past ? d.spent : 0), 0));
	const dueTotal = $derived(days.reduce((s, d) => s + dueOf(d), 0));
	const todayIndex = $derived(days.findIndex((d) => d.today));

	const TICK_MAX = 44;
	const heightOf = (value: number): number => (value > 0 ? Math.max(3, Math.round((value / scale) * TICK_MAX)) : 0);
	const spentHeight = (d: RibbonDay): number => (d.past ? heightOf(d.spent) : 0);
	const labelled = (d: RibbonDay, i: number): boolean => i === 0 || i === days.length - 1 || d.today || d.weekday === 0;

	const longDate = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
	const dayTitle = (d: RibbonDay): string => longDate.format(new Date(`${d.iso}T12:00:00`));

	let active = $state<number | null>(null);
	const show = (i: number) => (active = i);
	let focusIndex = $state(-1);
	const tabStop = $derived(focusIndex >= 0 ? focusIndex : todayIndex >= 0 ? todayIndex : 0);
	let slots: HTMLButtonElement[] = $state([]);

	function onKey(e: KeyboardEvent, i: number) {
		const to = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? days.length - 1 : null;
		if (to === null || to < 0 || to >= days.length) return;
		e.preventDefault();
		focusIndex = to;
		slots[to]?.focus();
	}

	function open(d: RibbonDay) {
		if (!d.past || (d.today && d.spent === 0 && d.due.length > 0)) return navigate('/echeancier');
		uiState.txFilter = { from: d.iso, to: d.iso };
		navigate('/transactions');
	}

	const aria = (d: RibbonDay): string => {
		const parts = [dayTitle(d)];
		if (d.past) parts.push(d.spent > 0 ? `${sensitiveEUR(d.spent)} dépensés` : 'aucune dépense');
		if (d.due.length > 0) parts.push(`${sensitiveEUR(dueOf(d))} à venir`);
		if (d.income.length > 0) parts.push(`revenu${d.past ? '' : ' attendu'} : ${d.income.map((e) => e.label).join(', ')}`);
		return parts.join(', ');
	};
</script>

<div class="ribbon-head">
	<h2 class="label-xs">Fil du mois</h2>
	{#if showLegend}
		<p class="ribbon-legend meta-xs">
			<span><i class="sw sw-spent" aria-hidden="true"></i>{sensitiveEURCompact(spentTotal)} dépensés</span>
			{#if dueTotal > 0}<span><i class="sw sw-due" aria-hidden="true"></i>{sensitiveEURCompact(dueTotal)} à venir</span>{/if}
			<span><i class="sw sw-income" aria-hidden="true"></i>revenu</span>
		</p>
	{/if}
</div>

<div class="ribbon" style="--n: {days.length};" role="group" aria-label="Le mois jour par jour">
	{#each days as d, i (d.iso)}
		<button
			bind:this={slots[i]}
			type="button"
			class="slot"
			class:weekend={d.weekday >= 5}
			class:past={d.past}
			class:today={d.today}
			tabindex={i === tabStop ? 0 : -1}
			aria-label={aria(d)}
			onmouseenter={() => show(i)}
			onmouseleave={() => (active = null)}
			onfocus={() => {
				show(i);
				focusIndex = i;
			}}
			onblur={() => (active = null)}
			onkeydown={(e) => onKey(e, i)}
			onclick={() => open(d)}
		>
			{#if d.income.length > 0}<span class="income" class:expected={!d.past} aria-hidden="true"></span>{/if}
			{#if spentHeight(d) > 0}<span class="tick" style="height: {spentHeight(d)}px;" aria-hidden="true"></span>{/if}
			{#if d.due.length > 0}<span class="tick due" style="height: {heightOf(dueOf(d))}px; bottom: {spentHeight(d)}px;" aria-hidden="true"></span>{/if}
			<span class="day" class:shown={labelled(d, i)} class:edge={i === 0 || i === days.length - 1} class:now={d.today} aria-hidden="true">{d.today ? 'auj.' : d.day}</span>
		</button>
	{/each}

	{#if active !== null && days[active]}
		{@const d = days[active]}
		{@const entries = d.past ? d.spends : []}
		<div class="tip" role="tooltip" use:floating={{ anchor: slots[active], gap: 8 }}>
			<p class="tip-date">{dayTitle(d)}{d.today ? ' · aujourd’hui' : ''}</p>
			{#if d.past}
				<p class="tip-total">{d.spent > 0 ? `${sensitiveEUR(d.spent)} dépensés` : 'Aucune dépense'}</p>
			{/if}
			{#if d.due.length > 0}
				<p class="tip-total">{sensitiveEUR(dueOf(d))} à venir</p>
			{/if}
			{#if entries.length > 0 || d.due.length > 0 || d.income.length > 0}
				<ul class="tip-list">
					{#each entries.slice(0, 4) as e, k (k)}
						<li><span class="tip-label">{e.label}</span><span class="tabular">−{sensitiveEUR(e.amount)}</span></li>
					{/each}
					{#if entries.length > 4}<li class="tip-more">+ {entries.length - 4} autre{entries.length - 4 > 1 ? 's' : ''}</li>{/if}
					{#each d.due.slice(0, 4) as e, k (k)}
						<li class="tip-due"><span class="tip-label">{e.label}{d.past ? ' (prévu)' : ''}</span><span class="tabular">−{sensitiveEUR(e.amount)}</span></li>
					{/each}
					{#if d.due.length > 4}<li class="tip-more">+ {d.due.length - 4} autre{d.due.length - 4 > 1 ? 's' : ''}</li>{/if}
					{#each d.income as e, k (k)}
						<li class="tip-income"><span class="tip-label">{e.label}{d.past ? '' : ' (attendu)'}</span><span class="tabular">+{sensitiveEUR(e.amount)}</span></li>
					{/each}
				</ul>
			{/if}
			{#if !d.past && d.due.length === 0 && d.income.length === 0}<p class="tip-more">Rien de prévu</p>{/if}
		</div>
	{/if}
</div>

<style>
	.ribbon-head {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		justify-content: space-between;
		gap: 4px 12px;
		margin-bottom: 10px;
	}

	.ribbon-legend {
		display: flex;
		flex-wrap: wrap;
		gap: 2px 12px;
	}

	.ribbon-legend span {
		display: inline-flex;
		align-items: center;
		gap: 5px;
	}

	.sw {
		display: inline-block;
		width: 3px;
		height: 10px;
		border-radius: 1px;
	}

	.sw-spent {
		background: color-mix(in srgb, var(--debit) 75%, transparent);
	}

	.sw-due {
		box-shadow: inset 0 0 0 1.25px var(--text-3);
	}

	.sw-income {
		width: 6px;
		height: 6px;
		border-radius: 9999px;
		background: var(--accent);
	}

	.ribbon {
		position: relative;
		margin-bottom: 18px;
		display: grid;
		grid-template-columns: repeat(var(--n), minmax(0, 1fr));
		height: 74px;
		border-bottom: 1px solid var(--hairline);
	}

	.slot {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: flex-end;
		padding: 0;
		cursor: pointer;
		border-radius: 3px 3px 0 0;
		outline-offset: -1px;
	}

	.slot.weekend {
		background: color-mix(in srgb, var(--text) 3.5%, transparent);
	}

	.slot:hover,
	.slot:focus-visible {
		background: color-mix(in srgb, var(--accent) 9%, transparent);
	}

	.slot.today::before {
		content: '';
		position: absolute;
		top: 6px;
		bottom: 0;
		left: 50%;
		border-left: 1px dashed var(--accent);
		opacity: 0.7;
	}

	.tick {
		position: absolute;
		bottom: 0;
		width: min(6px, 55%);
		border-radius: 2px 2px 0 0;
		background: color-mix(in srgb, var(--debit) 70%, transparent);
	}

	.slot.today .tick {
		background: var(--accent);
	}

	.tick.due {
		background: transparent;
		box-shadow: inset 0 0 0 1.25px var(--text-3);
	}

	.income {
		position: absolute;
		top: 4px;
		width: 6px;
		height: 6px;
		border-radius: 9999px;
		background: var(--accent);
	}

	.income.expected {
		background: transparent;
		box-shadow: inset 0 0 0 1.25px var(--accent);
	}

	.day {
		position: absolute;
		bottom: -17px;
		font-size: 10px;
		line-height: 1;
		color: var(--text-3);
		font-variant-numeric: tabular-nums;
		visibility: hidden;
		white-space: nowrap;
	}

	.day.shown {
		visibility: visible;
	}

	.slot.today .day {
		color: var(--accent);
		font-weight: 600;
	}

	.tip {
		width: 240px;
		padding: 10px 12px;
		border-radius: 10px;
		border: 1px solid var(--hairline);
		background: var(--surface);
		box-shadow: 0 10px 28px rgba(0, 0, 0, 0.16);
		font-size: 12px;
		pointer-events: none;
	}

	.tip-date {
		color: var(--text-3);
		font-size: 11px;
	}

	.tip-total {
		margin-top: 2px;
		font-weight: 600;
		color: var(--text);
	}

	.tip-list {
		margin-top: 6px;
		padding-top: 6px;
		border-top: 1px solid var(--border-subtle);
		list-style: none;
	}

	.tip-list li {
		display: flex;
		justify-content: space-between;
		gap: 10px;
		padding: 1px 0;
		color: var(--text-2);
	}

	.tip-label {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.tip-income {
		color: var(--accent) !important;
	}

	.tip-more {
		color: var(--text-3);
		font-size: 11px;
	}

	@media (max-width: 639px) {
		.day.shown:not(.edge, .now) {
			visibility: hidden;
		}
	}
</style>
