<script lang="ts">
	import PageTitle from '$lib/components/PageTitle.svelte';
	import { segmented } from '$lib/actions/segmented';
	import { formatDate, formatEUR, sensitiveEUR } from '$lib/format';
	import { confidenceLabel, confidenceStyle } from '$lib/forecast';
	import { addDays, addMonths, daysBetween, KIND_COLORS, KIND_LABELS, scheduleTotal, type ScheduleItem, type ScheduleKind } from '$lib/schedule';
	import { getSchedule, getScheduleFrom } from '$lib/schedule.svelte';

	/**
	 * Schedule: every upcoming deadline on one list (direct debits, loans, taxes, car, employee
	 * savings, goals), grouped by week, filtered by kind and horizon, with a two-month calendar; a
	 * day of the calendar narrows the list to that day.
	 */

	const HORIZONS: [number, string][] = [
		[30, '30 jours'],
		[90, '90 jours'],
		[365, '1 an']
	];

	let horizon = $state(90);
	let kind = $state<ScheduleKind | 'all'>('all');
	let day = $state<string | null>(null);

	const from = $derived(getScheduleFrom());
	const inHorizon = $derived(getSchedule(horizon));
	const counts = $derived.by(() => {
		const c = new Map<string, number>([['all', inHorizon.length]]);
		for (const i of inHorizon) c.set(i.kind, (c.get(i.kind) ?? 0) + 1);
		return c;
	});
	const byKind = $derived(kind === 'all' ? inHorizon : inHorizon.filter((i) => i.kind === kind));
	const shown = $derived(day ? byKind.filter((i) => i.date === day) : byKind);
	const total = $derived(scheduleTotal(byKind));
	const hasSensitive = $derived(byKind.some((i) => i.sensitive && i.amount !== undefined));

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
	const weekTitle = (start: string) => {
		const thisWeek = from ? weekStart(from) : '';
		if (start === thisWeek) return 'Cette semaine';
		if (start === addDays(thisWeek, 7)) return 'Semaine prochaine';
		return `Semaine du ${formatDate(start)}`;
	};

	const months = $derived(from ? [from.slice(0, 7), addMonths(`${from.slice(0, 7)}-01`, 1).slice(0, 7)] : []);
	const byDay = $derived.by(() => {
		const m = new Map<string, ScheduleItem[]>();
		for (const i of byKind) m.set(i.date, [...(m.get(i.date) ?? []), i]);
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
	const inDays = (d: string) => {
		const n = from ? daysBetween(from, d) : 0;
		return n === 0 ? "aujourd'hui" : n === 1 ? 'demain' : `dans ${n} j`;
	};
</script>

<header class="mb-3 flex flex-wrap items-end justify-between gap-3">
	<PageTitle title="Échéancier" />
	<div class="flex items-center gap-1" role="group" aria-label="Horizon" use:segmented>
		{#each HORIZONS as [h, label] (h)}
			<button type="button" class="chip cursor-pointer {horizon === h ? 'chip-accent' : 'chip-muted'}" aria-pressed={horizon === h} onclick={() => (horizon = h)}>{label}</button>
		{/each}
	</div>
</header>

<p class="meta-xs mb-2">
	Prélèvements détectés, échéances de crédit, impôts, voiture, épargne salariale et objectifs, réunis ici.
	{#if byKind.length}<span class="tabular">{byKind.length} échéance{byKind.length > 1 ? 's' : ''} · {hasSensitive ? sensitiveEUR(total) : formatEUR(total)} connus</span>{/if}
</p>
<div class="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Type d'échéance">
	<button type="button" class="chip {kind === 'all' ? 'chip-accent' : 'chip-outline'}" aria-pressed={kind === 'all'} onclick={() => (kind = 'all')}>
		Tout <span class="tabular opacity-70">{counts.get('all') ?? 0}</span>
	</button>
	{#each Object.entries(KIND_LABELS) as [k, label] (k)}
		{#if counts.get(k)}
			<button type="button" class="chip {kind === k ? 'chip-accent' : 'chip-outline'}" aria-pressed={kind === k} onclick={() => (kind = k as ScheduleKind)}>
				<span class="h-1.5 w-1.5 rounded-full" style="background-color: {KIND_COLORS[k as ScheduleKind]};" aria-hidden="true"></span>
				{label} <span class="tabular opacity-70">{counts.get(k)}</span>
			</button>
		{/if}
	{/each}
</div>

{#if !from}
	<p class="card p-4 text-[13px] text-secondary">Importe un relevé pour voir les échéances à venir.</p>
{:else}
	<div class="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,19rem)]">
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
			{#each weeks as w (w.start)}
				<section>
					<h2 class="label-plain sticky top-0 border-b px-4 py-1.5" style="border-color: var(--border-subtle); background-color: var(--surface);">{weekTitle(w.start)}</h2>
					<ul class="divide-y divide-[var(--border-subtle)] text-[12px]">
						{#each w.items as i (i.id)}
							<li>
								<a href={i.href} class="flex items-center gap-3 px-4 py-1.5 hover:bg-[var(--surface-hover)]">
									<span class="w-20 shrink-0">
										<span class="tabular block text-secondary">{weekday(i.date)}</span>
										<span class="meta-xs">{inDays(i.date)}</span>
									</span>
									<span class="h-2 w-2 shrink-0 rounded-full" style="background-color: {KIND_COLORS[i.kind]};" title={KIND_LABELS[i.kind]}></span>
									<span class="min-w-0 flex-1">
										<span class="block truncate">{i.label}</span>
										<span class="meta-xs block truncate">{KIND_LABELS[i.kind]}{i.detail ? ` · ${i.detail}` : ''}</span>
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
								<span class={cell === from ? 'font-semibold' : ''} style={cell === from ? 'color: var(--accent);' : ''}>{Number(cell.slice(8))}</span>
								{#if items.length}
									<span class="flex gap-0.5">
										{#each [...new Set(items.map((x) => x.kind))].slice(0, 3) as kd (kd)}
											<span class="h-1.5 w-1.5 rounded-full" style="background-color: {KIND_COLORS[kd]};"></span>
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
