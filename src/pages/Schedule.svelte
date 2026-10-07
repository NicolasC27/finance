<script lang="ts">
	import PageTitle from '$lib/components/PageTitle.svelte';
	import RowsToggle from '$lib/components/RowsToggle.svelte';
	import ScheduleMark from '$lib/components/ScheduleMark.svelte';
	import { segmented } from '$lib/actions/segmented';
	import { formatDate, formatEUR, sensitiveEUR } from '$lib/format';
	import { confidenceLabel, confidenceStyle } from '$lib/forecast';
	import { addDays, addMonths, daysBetween, GROUP_ORDER, groupColor, groupLabel, scheduleGroup, scheduleTotal, type ScheduleGroup, type ScheduleItem } from '$lib/schedule';
	import { getSchedule, getScheduleFrom } from '$lib/schedule.svelte';

	/**
	 * Schedule: every upcoming deadline on one list (direct debits, loans, taxes, car, employee
	 * savings, goals), in week bands with their totals, filtered by group and horizon, with a
	 * two-month calendar; a day of the calendar narrows the list to that day. One colour code on the
	 * whole page: the group of a deadline (budget category, loans, savings, goals) gives the mark of
	 * its row, the dot of its filter chip and its dot on the calendar.
	 */

	const HORIZONS: [number, string][] = [
		[30, '30 jours'],
		[90, '90 jours'],
		[365, '1 an']
	];

	let horizon = $state(90);
	let group = $state<ScheduleGroup | 'all'>('all');
	let day = $state<string | null>(null);

	const from = $derived(getScheduleFrom());
	const inHorizon = $derived(getSchedule(horizon));
	const counts = $derived.by(() => {
		const c = new Map<string, number>([['all', inHorizon.length]]);
		for (const i of inHorizon) c.set(scheduleGroup(i), (c.get(scheduleGroup(i)) ?? 0) + 1);
		return c;
	});
	const groups = $derived(GROUP_ORDER.filter((g) => counts.get(g) || g === group));
	const byGroup = $derived(group === 'all' ? inHorizon : inHorizon.filter((i) => scheduleGroup(i) === group));
	const shown = $derived(day ? byGroup.filter((i) => i.date === day) : byGroup);
	const totalText = (items: readonly ScheduleItem[]) => (items.some((i) => i.sensitive && i.amount !== undefined) ? sensitiveEUR(scheduleTotal(items)) : formatEUR(scheduleTotal(items)));

	const weekStart = (d: string) => addDays(d, -((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7));
	const weeks = $derived.by(() => {
		const out: { start: string; items: ScheduleItem[] }[] = [];
		for (const i of shown) {
			const start = weekStart(i.date);
			if (out.at(-1)?.start === start) out.at(-1)!.items.push(i);
			else out.push({ start, items: [i] });
		}
		return out;
	});
	const thisWeek = $derived(from ? weekStart(from) : '');
	const weekTitle = (start: string) => {
		if (start === thisWeek) return 'Cette semaine';
		if (start === addDays(thisWeek, 7)) return 'Semaine prochaine';
		return `Semaine du ${formatDate(start)}`;
	};

	const months = $derived(from ? [from.slice(0, 7), addMonths(`${from.slice(0, 7)}-01`, 1).slice(0, 7)] : []);
	const byDay = $derived.by(() => {
		const m = new Map<string, ScheduleItem[]>();
		for (const i of byGroup) m.set(i.date, [...(m.get(i.date) ?? []), i]);
		return m;
	});
	function monthCells(month: string): (string | null)[] {
		const first = `${month}-01`;
		const lead = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7;
		const length = daysBetween(first, addMonths(first, 1));
		return [...Array.from({ length: lead }, () => null), ...Array.from({ length }, (_, k) => addDays(first, k))];
	}
	const monthName = (month: string) => new Date(`${month}-01T00:00:00Z`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
	const weekday = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
	const money = (i: ScheduleItem) => (i.amount === undefined ? '' : i.sensitive ? sensitiveEUR(i.amount) : formatEUR(i.amount));
	const daysTo = (d: string) => (from ? daysBetween(from, d) : 0);
	const inDays = (n: number) => (n === 1 ? 'demain' : `dans ${n} j`);
</script>

<header class="mb-3 flex flex-wrap items-end justify-between gap-3">
	<PageTitle title="Échéancier" />
	<div class="flex items-center gap-3">
		<span class="hidden md:inline-flex"><RowsToggle /></span>
		<div class="flex items-center gap-1" role="group" aria-label="Horizon" use:segmented>
			{#each HORIZONS as [h, label] (h)}
				<button type="button" class="chip cursor-pointer {horizon === h ? 'chip-accent' : 'chip-muted'}" aria-pressed={horizon === h} onclick={() => (horizon = h)}>{label}</button>
			{/each}
		</div>
	</div>
</header>

<p class="meta-xs mb-2">
	Prélèvements détectés, échéances de crédit, impôts, voiture, épargne salariale et objectifs, réunis ici.
	{#if byGroup.length}<span class="tabular">{byGroup.length} échéance{byGroup.length > 1 ? 's' : ''} · {totalText(byGroup)} connus</span>{/if}
</p>
<!-- Groups: filter and legend of the colours at once -->
<div class="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Groupe d'échéances">
	<button type="button" class="chip {group === 'all' ? 'chip-accent' : 'chip-outline'}" aria-pressed={group === 'all'} onclick={() => (group = 'all')}>
		Tout <span class="tabular opacity-70">{counts.get('all') ?? 0}</span>
	</button>
	{#each groups as g (g)}
		<button type="button" class="chip {group === g ? 'chip-accent' : 'chip-outline'}" aria-pressed={group === g} onclick={() => (group = g)}>
			<span class="h-[7px] w-[7px] rounded-full" style="background-color: {groupColor(g)};" aria-hidden="true"></span>
			{groupLabel(g)} <span class="tabular opacity-70">{counts.get(g) ?? 0}</span>
		</button>
	{/each}
</div>

{#if !from}
	<p class="card p-4 text-[13px] text-secondary">Importe un relevé pour voir les échéances à venir.</p>
{:else}
	<div class="grid grid-cols-1 items-start gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,19rem)]">
		<div class="card p-0">
			{#if day}
				<div class="flex items-center justify-between border-b px-4 py-1.5 text-[12px]" style="border-color: var(--border-subtle);">
					<span>{weekday(day)}</span>
					<button type="button" class="btn btn-secondary btn-sm" onclick={() => (day = null)}>Tout l'horizon</button>
				</div>
			{/if}
			{#if shown.length === 0}
				<p class="meta-xs p-4">Aucune échéance sur cette période.</p>
			{/if}
			{#each weeks as w, k (w.start)}
				<section>
					<!-- Week band: the current week tinted with the accent and its rail, the others raised; total of the known amounts -->
					<h2
						class="sticky top-0 flex items-baseline justify-between gap-3 border-b px-4 py-1.5 {k === 0 && !day ? 'rounded-t-[7px]' : 'border-t'}"
						style="border-color: var(--border-subtle); {w.start === thisWeek ? 'background-color: color-mix(in srgb, var(--accent) 22%, var(--surface)); box-shadow: inset 2px 0 0 var(--accent);' : 'background-color: var(--surface-2);'}"
					>
						<span class="label-plain" style="color: var(--text);">{weekTitle(w.start)}</span>
						{#if w.items.some((i) => i.amount !== undefined)}
							<span class="tabular text-[11px] font-medium" title="Total des montants connus de la semaine">{totalText(w.items)}</span>
						{/if}
					</h2>
					<ul class="rows divide-y divide-[var(--border-subtle)] text-[12px]">
						{#each w.items as i (i.id)}
							{@const g = scheduleGroup(i)}
							{@const n = daysTo(i.date)}
							<li class="row">
								<a href={i.href} class="flex items-center gap-3 px-4 py-1.5 select-none hover:bg-[var(--surface-hover)]">
									<span class="w-24 shrink-0 whitespace-nowrap" title={n === 0 ? "aujourd'hui" : inDays(n)}>
										<span class="tabular block {n === 0 ? 'font-medium' : n <= 7 ? '' : 'text-secondary'}">{weekday(i.date)}</span>
										{#if n === 0}
											<span class="row-sub chip chip-accent">aujourd'hui</span>
										{:else}
											<span class="row-sub meta-xs" style={n <= 7 ? 'color: var(--text);' : ''}>{inDays(n)}</span>
										{/if}
									</span>
									<ScheduleMark group={g} label={i.id.startsWith('debit:') ? i.label : ''} />
									<span class="row-text min-w-0 flex-1">
										<span class="block truncate">{i.label}</span>
										<span class="meta-xs block truncate">{groupLabel(g)}{i.detail ? ` · ${i.detail}` : ''}</span>
									</span>
									{#if i.confidence && i.confidence !== 'haute'}
										<span class="chip shrink-0" style={confidenceStyle(i.confidence)}>{confidenceLabel(i.confidence)}</span>
									{/if}
									<span class="tabular shrink-0 font-medium">{money(i)}</span>
								</a>
							</li>
						{/each}
					</ul>
				</section>
			{/each}
		</div>

		<aside class="card p-4 lg:sticky lg:top-3" aria-label="Calendrier des échéances">
			{#each months as month (month)}
				<p class="label-plain mb-1.5 first-letter:uppercase {month === months[0] ? '' : 'mt-3'}">{monthName(month)}</p>
				<div class="grid grid-cols-7 gap-0.5 text-center text-[11px]">
					{#each ['L', 'M', 'M', 'J', 'V', 'S', 'D'] as d, k (k)}
						<span class="meta-xs">{d}</span>
					{/each}
					{#each monthCells(month) as cell, k (cell ?? `pad-${k}`)}
						{#if cell}
							{@const items = byDay.get(cell) ?? []}
							<button
								type="button"
								class="relative flex h-8 flex-col items-center justify-center rounded-md tabular {items.length ? 'cursor-pointer hover:bg-[var(--surface-hover)]' : 'cursor-default text-secondary'}"
								style="{cell === day ? 'background-color: var(--surface-2); outline: 1px solid var(--accent);' : ''}{cell < from || cell > addDays(from, horizon) ? ' opacity: 0.35;' : ''}"
								disabled={!items.length}
								aria-pressed={cell === day}
								aria-label="{formatDate(cell)} : {items.length} échéance{items.length > 1 ? 's' : ''}"
								onclick={() => (day = day === cell ? null : cell)}
							>
								<!-- Today: a disc in the accent colour -->
								<span
									class="flex h-[17px] min-w-[17px] items-center justify-center rounded-full px-1 leading-none {cell === from ? 'font-semibold' : items.length ? 'font-medium' : ''}"
									style={cell === from ? 'background-color: var(--accent); color: var(--surface);' : ''}
								>{Number(cell.slice(8))}</span>
								{#if items.length}
									<span class="flex gap-0.5">
										{#each [...new Set(items.map(scheduleGroup))].slice(0, 3) as g (g)}
											<span class="h-[6px] w-[6px] rounded-full" style="background-color: {groupColor(g)};"></span>
										{/each}
									</span>
								{/if}
							</button>
						{:else}
							<span></span>
						{/if}
					{/each}
				</div>
			{/each}
		</aside>
	</div>
{/if}
