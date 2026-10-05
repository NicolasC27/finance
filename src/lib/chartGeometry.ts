/**
 * Pure SVG geometry shared by the hand-made charts (testable outside the browser).
 */

/**
 * Bar anchored on a baseline with only its far end rounded (data end), radius capped by half the
 * width and by the bar length. `yBase` is the baseline, `yEnd` the value end (above or below).
 */
export function barPath(x: number, width: number, yBase: number, yEnd: number, radius = 4): string {
	const h = Math.abs(yEnd - yBase);
	if (h < 0.01 || width <= 0) return '';
	const r = Math.max(0, Math.min(radius, width / 2, h));
	const up = yEnd < yBase;
	const s = up ? 1 : -1;
	const x0 = x;
	const x1 = x + width;
	const f = (n: number) => Math.round(n * 100) / 100;
	return [
		`M${f(x0)},${f(yBase)}`,
		`L${f(x0)},${f(yEnd + s * r)}`,
		`Q${f(x0)},${f(yEnd)} ${f(x0 + r)},${f(yEnd)}`,
		`L${f(x1 - r)},${f(yEnd)}`,
		`Q${f(x1)},${f(yEnd)} ${f(x1)},${f(yEnd + s * r)}`,
		`L${f(x1)},${f(yBase)}`,
		'Z'
	].join(' ');
}

/** Relative change (%) between two values, null when the reference is zero. */
export function changePct(previous: number, current: number): number | null {
	if (!Number.isFinite(previous) || previous === 0) return null;
	return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}

/**
 * Index of the series whose point at `index` is closest to `y` (pixels), or null when none is
 * within `maxDistance`. Used to focus a curve under the pointer.
 */
export function nearestSeries(ys: readonly (readonly number[])[], index: number, y: number, maxDistance = 18): number | null {
	let best: number | null = null;
	let bestD = maxDistance;
	ys.forEach((s, k) => {
		const v = s[index];
		if (v === undefined) return;
		const d = Math.abs(v - y);
		if (d <= bestD) {
			bestD = d;
			best = k;
		}
	});
	return best;
}

/**
 * Element-wise interpolation of two number arrays. A length change cannot be interpolated
 * meaningfully, so it jumps straight to the target.
 */
export function interpolateArrays(a: readonly number[], b: readonly number[]): (t: number) => number[] {
	if (a.length !== b.length) return () => [...b];
	return (t) => b.map((v, i) => a[i]! + (v - a[i]!) * t);
}
