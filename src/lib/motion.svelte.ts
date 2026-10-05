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
 * Tween following `get()` (a number array): data changes morph over `ms`, the first value is shown
 * as is. Must be called during component initialisation.
 */
export function morphArray(get: () => number[], ms = MORPH_MS): Tween<number[]> {
	return Tween.of(get, { duration: () => motionDuration(ms), easing: cubicOut, interpolate: interpolateArrays });
}

/**
 * Tween starting from zeros, then following `get()`: bars grow from their baseline on first render
 * and morph on later changes. Must be called during component initialisation.
 */
export function growArray(get: () => number[], ms = MORPH_MS): Tween<number[]> {
	const t = new Tween<number[]>(get().map(() => 0), { duration: () => motionDuration(ms), easing: cubicOut, interpolate: interpolateArrays });
	$effect(() => {
		void t.set(get());
	});
	return t;
}
