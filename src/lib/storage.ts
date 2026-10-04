/**
 * Guarded localStorage write (pure module, testable with tsx): never an exception in an event
 * handler, and a failure (quota full, storage blocked) is REPORTED; it used to be swallowed:
 * '120 operations added', then everything vanished on reload. The report (toast) is wired by
 * ui.svelte.ts through setPersistFailureHandler.
 */

let onFailure: (() => void) | null = null;
let lastWarnAt = 0;

/** Wires the write-failure warning (UI toast). */
export function setPersistFailureHandler(fn: (() => void) | null): void {
	onFailure = fn;
}

/** Reports a write failure (at most once a minute). */
export function warnPersistFailure(): void {
	const now = Date.now();
	if (now - lastWarnAt < 60_000) return;
	lastWarnAt = now;
	onFailure?.();
}

/** Stores a raw string; false (and a warning) on failure. */
export function persistRaw(key: string, value: string): boolean {
	if (typeof localStorage === 'undefined') return false;
	try {
		localStorage.setItem(key, value);
		return true;
	} catch {
		warnPersistFailure();
		return false;
	}
}

/** Stores a JSON-serialised value; false (and a warning) on failure. */
export function persistJson(key: string, value: unknown): boolean {
	return persistRaw(key, JSON.stringify(value));
}
