<script lang="ts">
	import { formatMonth } from '$lib/format';
	import { floating } from '$lib/actions/floating';
	import RangeCalendar from './RangeCalendar.svelte';

	/**
	 * Period picker (Transactions page): compact button showing the active range, popover with
	 * shortcuts (this month, 30 days, 3 months, year, months present in the data) and a French
	 * calendar where the period is chosen by sliding across the days, applied on release. ISO bounds
	 * are inclusive; empty string = no bound: « Sans date de fin » / « Sans date de début » keep one
	 * bound only (« depuis le … », « jusqu'au … »), from the pending start of a first click or from
	 * the current period. The popover lives in <body> (never clipped); it closes on a press outside
	 * it, read from the event path so a month arrow re-rendered by the calendar never counts as
	 * outside.
	 */
	let {
		from = $bindable(''),
		to = $bindable(''),
		/** Months present in the data (YYYY-MM), for the shortcuts. */
		months = []
	}: { from?: string; to?: string; months?: string[] } = $props();

	let open = $state(false);
	let trigger = $state<HTMLButtonElement | null>(null);
	/** Start picked by a first click in the calendar, not applied yet. */
	let pending = $state<string | null>(null);

	const pad = (n: number) => String(n).padStart(2, '0');
	const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
	const today = () => new Date();

	function monthBounds(key: string): [string, string] {
		const [y, m] = key.split('-').map(Number);
		return [`${key}-01`, iso(new Date(y!, m!, 0))];
	}

	interface Preset {
		label: string;
		range: () => [string, string];
	}

	const presets: Preset[] = [
		{ label: 'Tout', range: () => ['', ''] },
		{
			label: 'Ce mois',
			range: () => {
				const d = today();
				return monthBounds(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`);
			}
		},
		{
			label: 'Mois dernier',
			range: () => {
				const d = today();
				const p = new Date(d.getFullYear(), d.getMonth() - 1, 1);
				return monthBounds(`${p.getFullYear()}-${pad(p.getMonth() + 1)}`);
			}
		},
		{
			label: '30 derniers jours',
			range: () => {
				const d = today();
				const s = new Date(d);
				s.setDate(s.getDate() - 29);
				return [iso(s), iso(d)];
			}
		},
		{
			label: '3 derniers mois',
			range: () => {
				const d = today();
				const s = new Date(d.getFullYear(), d.getMonth() - 2, 1);
				return [iso(s), iso(d)];
			}
		},
		{
			label: 'Cette année',
			range: () => {
				const d = today();
				return [`${d.getFullYear()}-01-01`, iso(d)];
			}
		}
	];

	const fmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
	const fmtShort = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });
	function human(d: string, short = false): string {
		return (short ? fmtShort : fmt).format(new Date(`${d}T12:00:00`));
	}

	/** Button label: 'Toute la période', 'du 3 août au 2 oct.', 'depuis le …', 'jusqu'au …'. */
	const label = $derived.by(() => {
		if (!from && !to) return 'Toute la période';
		if (from && to) {
			const sameYear = from.slice(0, 4) === to.slice(0, 4);
			return `${human(from, sameYear)} → ${human(to)}`;
		}
		return from ? `depuis le ${human(from)}` : `jusqu'au ${human(to)}`;
	});

	const active = $derived(from !== '' || to !== '');

	function isPresetActive(p: Preset): boolean {
		const [a, b] = p.range();
		return a === from && b === to;
	}

	/** Bounds are put back in order when inverted. */
	function apply(a: string, b: string) {
		if (a && b && a > b) [a, b] = [b, a];
		from = a;
		to = b;
		pending = null;
		open = false;
	}

	/** Open period from the pending start, else from the current start: « depuis le … ». */
	const sinceDay = $derived(pending ?? from);
	/** Open period up to the pending day, else to the current end: « jusqu'au … ». */
	const untilDay = $derived(pending ?? to);

	function toggle() {
		open = !open;
	}

	/** Closing while open: a press outside (capture phase, on the event path) or Escape. */
	$effect(() => {
		if (!open) return;
		const onDown = (e: PointerEvent) => {
			if (!e.composedPath().some((n) => n instanceof Element && n.hasAttribute('data-daterange'))) open = false;
		};
		const onEsc = (e: KeyboardEvent) => {
			if (e.key === 'Escape') open = false;
		};
		document.addEventListener('pointerdown', onDown, true);
		document.addEventListener('keydown', onEsc);
		return () => {
			document.removeEventListener('pointerdown', onDown, true);
			document.removeEventListener('keydown', onEsc);
			pending = null;
		};
	});
</script>

<div class="relative" data-daterange>
	<button
		type="button"
		bind:this={trigger}
		class="input-surface flex cursor-pointer items-center gap-2 whitespace-nowrap transition-colors hover:bg-[var(--surface-hover)]"
		style={active ? 'border-color: var(--accent); color: var(--accent);' : ''}
		aria-haspopup="dialog"
		aria-expanded={open}
		onclick={toggle}
	>
		<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="shrink-0">
			<rect x="3" y="5" width="18" height="16" rx="2" />
			<path d="M3 10h18M8 3v4M16 3v4" />
		</svg>
		<span class="tabular">{label}</span>
		{#if active}
			<!-- Clear without opening the popover -->
			<span
				role="button"
				tabindex="0"
				class="ml-1 flex h-4 w-4 items-center justify-center rounded-full transition-colors hover:bg-[var(--accent-soft)]"
				aria-label="Effacer la période"
				onclick={(e) => {
					e.stopPropagation();
					apply('', '');
				}}
				onkeydown={(e) => {
					if (e.key === 'Enter' || e.key === ' ') {
						e.preventDefault();
						e.stopPropagation();
						apply('', '');
					}
				}}
			>
				<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
			</span>
		{:else}
			<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="shrink-0 text-secondary"><path d="m6 9 6 6 6-6" /></svg>
		{/if}
	</button>

	{#if open}
		<div
			class="daterange-pop card flex max-w-[calc(100vw-1rem)] flex-col overflow-hidden shadow-xl sm:flex-row"
			role="dialog"
			aria-label="Choisir une période"
			data-daterange
			use:floating={{ anchor: trigger }}
		>
			<!-- Shortcuts: a column on desktop, wrapped chips above the calendar on a phone -->
			<div class="flex shrink-0 flex-row flex-wrap gap-x-1 border-b px-1.5 py-1.5 sm:w-40 sm:flex-col sm:flex-nowrap sm:gap-x-0 sm:border-r sm:border-b-0 sm:px-0" style="border-color: var(--border-subtle);">
				{#each presets as p (p.label)}
					{@const on = isPresetActive(p)}
					<button
						type="button"
						class="press cursor-pointer rounded-md px-2 py-1 text-left text-[13px] transition-colors hover:bg-[var(--surface-hover)] sm:rounded-none sm:px-3 sm:py-1.5 {on ? 'font-medium' : 'text-secondary'}"
						style={on ? 'color: var(--accent);' : ''}
						onclick={() => apply(...p.range())}
					>
						{p.label}
					</button>
				{/each}
				{#if months.length > 0}
					<p class="label-plain mt-2 mb-0.5 hidden px-3 sm:block">Mois</p>
					<div class="hidden max-h-40 overflow-y-auto sm:block">
						{#each [...months].reverse() as m (m)}
							{@const [a, b] = monthBounds(m)}
							{@const on = a === from && b === to}
							<button
								type="button"
								class="press w-full cursor-pointer px-3 py-1 text-left text-[13px] capitalize transition-colors hover:bg-[var(--surface-hover)] {on ? 'font-medium' : 'text-secondary'}"
								style={on ? 'color: var(--accent);' : ''}
								onclick={() => apply(a, b)}
							>
								{formatMonth(m)}
							</button>
						{/each}
					</div>
				{/if}
			</div>

			<!-- Calendar: slide from the first to the last day, applied on release -->
			<div class="min-w-0 p-3 sm:w-[33rem]">
				<RangeCalendar start={from} end={to} past autofocus label="Période des opérations" onselect={(a, b) => apply(a, b)} onanchor={(d) => (pending = d)} />
				<div class="mt-1 flex flex-wrap items-center justify-end gap-2">
					<button
						type="button"
						class="btn btn-secondary btn-sm"
						disabled={!sinceDay || (!pending && !to)}
						title={sinceDay ? `Toutes les opérations depuis le ${human(sinceDay)}` : 'Choisis d’abord un jour de début'}
						onclick={() => apply(sinceDay, '')}
					>
						Sans date de fin
					</button>
					<button
						type="button"
						class="btn btn-secondary btn-sm"
						disabled={!untilDay || (!pending && !from)}
						title={untilDay ? `Toutes les opérations jusqu'au ${human(untilDay)}` : 'Choisis d’abord un jour de fin'}
						onclick={() => apply('', untilDay)}
					>
						Sans date de début
					</button>
					<button type="button" class="btn btn-secondary btn-sm" onclick={() => apply('', '')}>Effacer</button>
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
	.daterange-pop {
		animation: daterange-pop 150ms ease-out backwards;
	}
	@keyframes daterange-pop {
		from {
			opacity: 0;
			transform: translateY(-4px);
		}
	}
</style>
