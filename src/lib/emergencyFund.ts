/**
 * Emergency fund (pure, testable): how many months of usual spending the available savings would
 * cover, against a target range (3 to 6 months by default).
 */

export interface EmergencyTarget {
	min: number;
	max: number;
}

export const DEFAULT_TARGET: EmergencyTarget = { min: 3, max: 6 };

const median = (v: readonly number[]) => {
	const s = [...v].sort((a, b) => a - b);
	const m = Math.floor(s.length / 2);
	return s.length ? (s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2) : 0;
};

/**
 * Usual monthly spending: average of the given complete months (12 at most, the latest), each month
 * capped at twice the median so a one-off month (a big purchase) does not inflate the reference.
 * Returns 0 without data.
 */
export function referenceSpending(monthly: readonly number[]): number {
	const last = monthly.slice(-12).filter((v) => v > 0);
	if (!last.length) return 0;
	const cap = 2 * median(last);
	return Math.round((last.reduce((s, v) => s + Math.min(v, cap), 0) / last.length) * 100) / 100;
}

export interface Coverage {
	/** Months covered (one decimal), null without reference spending. */
	months: number | null;
	state: 'below' | 'within' | 'above' | 'unknown';
	/** What is missing to reach the target's minimum (0 when reached). */
	missing: number;
}

/** Months of spending covered by `available`, and where it stands against the target. */
export function coverage(available: number, monthlySpending: number, target: EmergencyTarget = DEFAULT_TARGET): Coverage {
	if (!(monthlySpending > 0)) return { months: null, state: 'unknown', missing: 0 };
	const months = Math.max(0, Math.round((available / monthlySpending) * 10) / 10);
	const state = months < target.min ? 'below' : months > target.max ? 'above' : 'within';
	return { months, state, missing: Math.max(0, Math.round((target.min * monthlySpending - available) * 100) / 100) };
}

/** Valid target range (min ≥ 1, max ≥ min, both ≤ 36), else the default. */
export function readTarget(v: unknown): EmergencyTarget {
	const t = v as Partial<EmergencyTarget> | null;
	const ok = (n: unknown): n is number => typeof n === 'number' && n >= 1 && n <= 36;
	return t && ok(t.min) && ok(t.max) && t.max >= t.min ? { min: t.min, max: t.max } : { ...DEFAULT_TARGET };
}
