import { Tween } from 'svelte/motion';
import { MediaQuery } from 'svelte/reactivity';
import { cubicOut } from 'svelte/easing';
import { interpolateArrays } from './chartGeometry';

/**
 * Shared motion helpers for charts and micro-interactions: one reduced-motion switch and array
 * tweens that morph data instead of jumping. Durations follow the CSS tokens (--motion-*).
 */

/** Reactive `prefers-reduced-motion: reduce` (false during SSR or when unsupported). */
export const reducedMotion = new MediaQuery('prefers-reduced-motion: reduce', false);

/** Chart morph duration (ms), aligned with --motion-slow. */
export const MORPH_MS = 420;

/** Duration that collapses to 0 when the user asked for reduced motion. */
export function motionDuration(ms: number): number {
	return reducedMotion.current ? 0 : ms;
}

/**
 * Entrances (bars growing from zero, amounts counting up, rolling digits, cascades) play on the first
 * page and for what appears later (a dialog, data that arrives), not for a page opened by a page
 * change: there the page transition is the only movement and the values show at once. Value changes
 * keep animating.
 */
const PAGE_CHANGE_MS = 600;
let pageChangeUntil = 0;

/** Entrance effects allowed: not while a page change mounts its page, not under reduced motion. */
export function playsEntrance(): boolean {
	return !reducedMotion.current && performance.now() >= pageChangeUntil;
}

/** A page change starts: what mounts in the next PAGE_CHANGE_MS skips its entrances. */
export function beginPageChange(): void {
	pageChangeUntil = performance.now() + PAGE_CHANGE_MS;
}

let stopSettling: (() => void) | null = null;

/**
 * Ends the CSS entrances of a page that just mounted after a page change: its running animations and
 * transitions (title rise, tile cascade, hero fades, line tracing) jump to their end, and those that
 * start later in the page-change window (charts sized after a first layout) end as they start.
 * Infinite animations (loading shimmers) are left alone.
 */
export function settleEntrances(el: Element | null): void {
	stopSettling?.();
	if (!el || typeof el.getAnimations !== 'function') return;
	const settle = (a: Animation) => {
		if (a.playbackRate !== 0 && a.effect?.getComputedTiming().endTime !== Infinity) a.finish();
	};
	for (const a of el.getAnimations({ subtree: true })) settle(a);
	const onStart = (e: Event) => {
		const name = (e as AnimationEvent).animationName;
		for (const a of (e.target as Element).getAnimations()) if (a instanceof CSSAnimation && a.animationName === name) settle(a);
	};
	const stop = () => {
		el.removeEventListener('animationstart', onStart);
		window.clearTimeout(timer);
		stopSettling = null;
	};
	const timer = window.setTimeout(stop, Math.max(0, pageChangeUntil - performance.now()));
	el.addEventListener('animationstart', onStart);
	stopSettling = stop;
}

/**
 * Tween following `get()` (a number array): data changes morph over `ms`, the first value is shown
 * as is. Must be called during component initialisation.
 */
export function morphArray(get: () => number[], ms = MORPH_MS): Tween<number[]> {
	return Tween.of(get, { duration: () => motionDuration(ms), easing: cubicOut, interpolate: interpolateArrays });
}

/**
 * Tween starting from zeros, then following `get()`: bars grow from their baseline on first render
 * (not when mounted by a page change, see playsEntrance) and morph on later changes. Must be called during component initialisation.
 */
export function growArray(get: () => number[], ms = MORPH_MS): Tween<number[]> {
	const t = new Tween<number[]>(playsEntrance() ? get().map(() => 0) : get(), { duration: () => motionDuration(ms), easing: cubicOut, interpolate: interpolateArrays });
	$effect(() => {
		void t.set(get());
	});
	return t;
}
