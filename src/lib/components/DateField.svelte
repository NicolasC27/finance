<script lang="ts">
	import { formatDate } from '$lib/format';
	import { floating } from '$lib/actions/floating';
	import RangeCalendar from './RangeCalendar.svelte';

	/**
	 * Single date field replacing `<input type="date">`: a button showing the date in French and a
	 * calendar popover (Monday first, never red) living in <body>, so a tile never clips it. The value
	 * is an ISO date, '' when empty; « Effacer » empties it when `clearable`.
	 */
	let {
		value = $bindable(''),
		label,
		class: cls = '',
		min = '',
		max = '',
		clearable = true,
		placeholder = 'Choisir une date'
	}: {
		value?: string;
		/** Accessible name of the field (and of its calendar). */
		label: string;
		class?: string;
		min?: string;
		max?: string;
		clearable?: boolean;
		placeholder?: string;
	} = $props();

	let open = $state(false);
	let trigger = $state<HTMLButtonElement | null>(null);
	let pop = $state<HTMLElement | null>(null);

	function choose(date: string) {
		value = date;
		open = false;
		trigger?.focus();
	}

	/** Closing: click outside the popover and its button, or Escape. */
	$effect(() => {
		if (!open) return;
		const onDown = (e: PointerEvent) => {
			const target = e.target as Node | null;
			if (target && (pop?.contains(target) || trigger?.contains(target))) return;
			open = false;
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== 'Escape') return;
			open = false;
			trigger?.focus();
		};
		document.addEventListener('pointerdown', onDown, true);
		document.addEventListener('keydown', onKey);
		return () => {
			document.removeEventListener('pointerdown', onDown, true);
			document.removeEventListener('keydown', onKey);
		};
	});
</script>

<button
	type="button"
	class="input-surface tabular flex cursor-pointer items-center justify-between gap-2 text-left {cls}"
	bind:this={trigger}
	aria-label={value ? `${label} : ${formatDate(value)}` : label}
	aria-haspopup="dialog"
	aria-expanded={open}
	onclick={() => (open = !open)}
>
	<span class="min-w-0 truncate {value ? '' : 'text-secondary'}">{value ? formatDate(value) : placeholder}</span>
	<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="shrink-0 text-secondary">
		<rect x="3" y="5" width="18" height="16" rx="2" />
		<path d="M3 10h18M8 3v4M16 3v4" />
	</svg>
</button>

{#if open}
	<div class="date-pop card w-[18rem] max-w-[calc(100vw-1rem)] p-3 shadow-xl" role="dialog" aria-label={label} bind:this={pop} use:floating={{ anchor: trigger }}>
		<RangeCalendar mode="single" months={1} start={value} end={value} {min} {max} {label} autofocus onselect={(d) => choose(d)} />
		{#if clearable && value}
			<div class="flex justify-end">
				<button
					type="button"
					class="btn btn-secondary btn-sm"
					onclick={() => {
						value = '';
						open = false;
						trigger?.focus();
					}}>Effacer</button
				>
			</div>
		{/if}
	</div>
{/if}

<style>
	.date-pop {
		animation: date-pop 150ms ease-out backwards;
	}
	@keyframes date-pop {
		from {
			opacity: 0;
			transform: translateY(-4px);
		}
	}
</style>
