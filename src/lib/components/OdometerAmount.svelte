<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import { formatEUR, formatEURNarrowParts, sensitiveEUR, sensitiveEURNarrowParts } from '$lib/format';

	/**
	 * Rolling-digit odometer (SPEC v12 §1), a mechanical counter: each digit is a one-line
	 * overflow:hidden column holding a '0…9' strip repeated twice, moved with translateY. Separators
	 * (thin space, comma, '€', 'k€' suffix) are static.
	 * Choreography: the rightmost column lands in ~600 ms and each column to the left adds ~120 ms
	 * (max 1.4 s), landing easing cubic-bezier(0.16, 1.1, 0.3, 1), a single CSS transition per column,
	 * never rAF. Triggered when entering the viewport (IntersectionObserver, once) then on every value
	 * change (re-rolls from the current position; CSS retargeting means no visual jump).
	 * LCP: the initial state IS the final value (no 0000 flash); the strip only restarts from 0 on the
	 * first visible appearance. prefers-reduced-motion → instant display (see also app.css).
	 * Deliberately rare effect: Patrimoine net amount + StatCard KPIs. AnimatedAmount stays the choice
	 * for small changes (tables, lists).
	 */
	type Token = { t: 'd'; d: number } | { t: 's'; s: string };

	/** Digit strip: 0–9 repeated twice (scroll distance). */
	const STRIP = '01234567890123456789'.split('');

	/**
	 * Landing duration of a column: rightmost first (~600 ms), +120 ms per column to the left, capped
	 * at 1.4 s.
	 */
	const LAND_BASE = 600;
	const LAND_STEP = 120;
	const LAND_MAX = 1400;

	let {
		value,
		compact = false,
		flash = undefined,
		sensitive = false,
		class: klass = ''
	}: {
		value: number;
		/** Wealth, balance, salary…: masked in privacy mode. */
		sensitive?: boolean;
		/** 'k€' format (formatEURNarrowParts), static suffix. */
		compact?: boolean;
		/**
		 * When set, teal (up) / amber (down) overlay after landing: same visual signature as the
		 * AnimatedAmount flash.
		 */
		flash?: 'up' | 'down';
		class?: string;
	} = $props();

	/** Splits the formatted amount into tokens: digits (columns) / separators (static). */
	function tokenize(v: number): { tokens: Token[]; suffix: string; label: string } {
		let main: string;
		let suffix = '';
		if (compact) {
			const parts = (sensitive ? sensitiveEURNarrowParts : formatEURNarrowParts)(v);
			main = parts.main;
			suffix = parts.suffix;
		} else {
			main = (sensitive ? sensitiveEUR : formatEUR)(v);
		}
		const tokens: Token[] = [];
		let sep = '';
		for (const ch of main) {
			if (ch >= '0' && ch <= '9') {
				if (sep) {
					tokens.push({ t: 's', s: sep });
					sep = '';
				}
				tokens.push({ t: 'd', d: Number(ch) });
			} else {
				sep += ch;
			}
		}
		if (sep) tokens.push({ t: 's', s: sep });
		return { tokens, suffix, label: suffix ? `${main} ${suffix}` : main };
	}

	const parts = $derived(tokenize(value));

	/**
	 * Duration per token (0 for separators): the rightmost column lands in LAND_BASE ms, each column
	 * to its left adds LAND_STEP.
	 */
	const durations = $derived.by(() => {
		const toks = parts.tokens;
		const count = toks.reduce((n, t) => n + (t.t === 'd' ? 1 : 0), 0);
		let digitIndex = 0;
		return toks.map((t) => {
			if (t.t !== 'd') return 0;
			const fromRight = count - 1 - digitIndex++;
			return Math.min(LAND_MAX, LAND_BASE + fromRight * LAND_STEP);
		});
	});

	let host = $state<HTMLSpanElement | null>(null);
	/** Current offset of each strip (in digits, 0–19), parallel to the tokens. */
	let offsets = $state<number[]>([]);
	/** Transitions enabled (landing in progress). */
	let rolling = $state(false);
	let flashDir = $state<'up' | 'down' | null>(null);

	// --- Non-reactive internal state ---
	let seen = false; // the odometer entered the viewport (once)
	let reduced = false; // prefers-reduced-motion at mount
	let prevDigits: number[] | null = null; // last landed digits
	let lastValue: number | undefined; // last value (flash direction)
	let latestTokens: Token[] = []; // non-reactive mirror of the current tokens
	let snapTimer: number | undefined;
	let flashTimer: number | undefined;

	/**
	 * Fallback without transition on the first copy of the strip (visually identical). The flash is
	 * kept AFTER landing (AnimatedAmount signature), never on first render.
	 */
	function scheduleSnap(toks: Token[], dir?: 'up' | 'down') {
		window.clearTimeout(snapTimer);
		window.clearTimeout(flashTimer);
		const maxDur = durations.reduce((m, d) => Math.max(m, d), 0);
		snapTimer = window.setTimeout(() => {
			rolling = false;
			offsets = toks.map((t) => (t.t === 'd' ? t.d : 0));
			if (dir && flash !== undefined) {
				flashDir = dir;
				flashTimer = window.setTimeout(() => (flashDir = null), 420);
			}
		}, maxDur + 80);
	}

	/**
	 * Lands the columns on a new value (instant before the first appearance: the initial state is the
	 * final value, no 0000 flash, no animation). Re-rolling starts from the current position: columns
	 * are matched from the right and each one only rolls the required steps ((target − current) mod
	 * 10), so an unchanged column does not move; a new column starts at 0.
	 */
	function applyValue(toks: Token[], v: number) {
		latestTokens = toks;
		const nextDigits = toks.filter((t): t is Extract<Token, { t: 'd' }> => t.t === 'd').map((t) => t.d);
		if (!seen || reduced || prevDigits === null) {
			rolling = false;
			offsets = toks.map((t) => (t.t === 'd' ? t.d : 0));
			prevDigits = nextDigits;
			lastValue = v;
			return;
		}
		const prev = prevDigits;
		const count = nextDigits.length;
		let digitIndex = 0;
		offsets = toks.map((t) => {
			if (t.t !== 'd') return 0;
			const fromRight = count - 1 - digitIndex++;
			const current = prev[prev.length - 1 - fromRight] ?? 0;
			const steps = (t.d - current + 10) % 10;
			return current + steps;
		});
		rolling = true;
		prevDigits = nextDigits;
		const from = lastValue;
		lastValue = v;
		scheduleSnap(toks, from === undefined ? undefined : v >= from ? 'up' : 'down');
	}

	// Tracks value changes (tokens derived from `value`/`compact`)
	$effect(() => {
		const toks = parts.tokens;
		untrack(() => applyValue(toks, value));
	});

	/**
	 * First roll on appearance: each strip restarts from 0 (one frame, with a forced reflow so the
	 * transition really starts from 0) then rolls to the second copy of the target digit (+10).
	 */
	async function firstRoll() {
		const toks = latestTokens;
		if (toks.length === 0) return;
		rolling = false;
		offsets = toks.map(() => 0);
		await tick();
		if (host) void host.offsetWidth;
		rolling = true;
		offsets = toks.map((t) => (t.t === 'd' ? t.d + 10 : 0));
		scheduleSnap(toks);
	}

	onMount(() => {
		reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		if (reduced || typeof IntersectionObserver === 'undefined') {
			seen = true;
			return;
		}
		const io = new IntersectionObserver(
			(entries) => {
				if (!entries.some((e) => e.isIntersecting)) return;
				io.disconnect();
				seen = true;
				void firstRoll();
			},
			{ threshold: 0.2 }
		);
		if (host) io.observe(host);
		return () => {
			io.disconnect();
			window.clearTimeout(snapTimer);
			window.clearTimeout(flashTimer);
		};
	});
</script>

<span
	bind:this={host}
	class="odometer {klass}{flash !== undefined ? ' price-ticker' : ''}{flashDir === 'up' ? ' flash-up' : flashDir === 'down' ? ' flash-down' : ''}"
	aria-live="polite"
>
	<!-- Amount readable by screen readers (the animated digits are decorative) -->
	<span class="sr-only">{parts.label}</span>
	<span class="odometer-visual" aria-hidden="true">
		{#each parts.tokens as tok, i (i)}
			{#if tok.t === 's'}
				<span class="odo-sep">{tok.s}</span>
			{:else}
				<span class="odo-col"
					><span
						class="odo-strip"
						style="transform: translateY({-(offsets[i] ?? tok.d)}em); transition-duration: {rolling ? durations[i] : 0}ms;"
						>{#each STRIP as digit, j (j)}<span class="odo-digit">{digit}</span>{/each}</span
					></span
				>
			{/if}
		{/each}
		{#if parts.suffix}<span class="amount-suffix odo-sep">{parts.suffix}</span>{/if}
	</span>
</span>
