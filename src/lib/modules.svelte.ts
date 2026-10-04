import { persistJson } from './storage';
import { moduleMeta, moduleOfRoute, modulesFromData, sanitizeModules, toggleModule, type ModuleId } from './modules';
import { sanitizeCarOptions, type CarOptions } from './vehicle';

/**
 * Active modules and module options (reactive, persisted in the encrypted database through
 * localStorage): `budget:modules` = { active }, `budget:car-options` = the Voiture options. The first
 * time, the active modules come from the data already there (see modulesFromData) and the choice is
 * stored at once, so it never changes behind the user's back afterwards.
 */

const MODULES_KEY = 'budget:modules';
const CAR_OPTIONS_KEY = 'budget:car-options';

/** Raw stored string, never throwing (null when storage is unavailable). */
function readRaw(key: string): string | null {
	if (typeof localStorage === 'undefined') return null;
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}

/** Stored JSON, null when absent or invalid. */
function readJson(key: string): unknown {
	try {
		return JSON.parse(readRaw(key) ?? 'null');
	} catch {
		return null;
	}
}

/** Stored choice, else the first-run choice from the data (stored right away). */
function loadActive(): ModuleId[] {
	const stored = sanitizeModules(readJson(MODULES_KEY));
	if (stored) return stored;
	if (typeof localStorage === 'undefined') return [];
	const initial = modulesFromData(readRaw);
	persistJson(MODULES_KEY, { active: initial });
	return initial;
}

export const modulesState = $state({
	active: loadActive(),
	car: sanitizeCarOptions(readJson(CAR_OPTIONS_KEY))
});

/** Is the module switched on? */
export function isModuleActive(id: ModuleId): boolean {
	return modulesState.active.includes(id);
}

/** Can the page be shown: an essential page, or the page of an active module. */
export function isRouteEnabled(path: string): boolean {
	const m = moduleOfRoute(path);
	return m === null || isModuleActive(m);
}

/** Switches a module on or off (its data is never touched); returns the toast text. */
export function setModuleActive(id: ModuleId, on: boolean): string {
	modulesState.active = toggleModule(modulesState.active, id, on);
	persistJson(MODULES_KEY, { active: modulesState.active });
	return `Module « ${moduleMeta(id).label} » ${on ? 'activé' : 'retiré'}`;
}

/** Changes Voiture options (each value checked and bounded). */
export function setCarOptions(patch: Partial<CarOptions>): void {
	modulesState.car = sanitizeCarOptions({ ...modulesState.car, ...patch });
	persistJson(CAR_OPTIONS_KEY, modulesState.car);
}
