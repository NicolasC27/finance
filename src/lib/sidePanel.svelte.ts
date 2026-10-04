import { untrack, type Snippet } from 'svelte';
import { DOCK_MIN_VIEWPORT } from './sidePanelLayout';
import type { ModuleId } from './modules';

/**
 * Right-hand side panel state (reactive): whether the viewport is wide enough for the panel to
 * slide over the page without a backdrop, the panels open right now (Escape closes the most recent
 * one), and the actions each module page hands to its « ⚙ » panel.
 */

/** Media query of the desktop layout, null outside the browser. */
const desktopQuery = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(`(min-width: ${DOCK_MIN_VIEWPORT}px)`) : null;

export const sidePanelState = $state({
	wide: desktopQuery?.matches ?? false,
	open: [] as string[]
});

desktopQuery?.addEventListener('change', (e) => (sidePanelState.wide = e.matches));

/** A panel opened on desktop. The list is read untracked, since panels call this from an effect. */
export function panelOpened(id: string): void {
	const current = untrack(() => sidePanelState.open);
	if (!current.includes(id)) sidePanelState.open = [...current, id];
}

/** A panel closed (list read untracked, as above). */
export function panelClosed(id: string): void {
	const current = untrack(() => sidePanelState.open);
	if (current.includes(id)) sidePanelState.open = current.filter((p) => p !== id);
}

/** Is this panel the most recently opened one (the one Escape closes)? */
export function isTopPanel(id: string): boolean {
	return sidePanelState.open.at(-1) === id;
}

/**
 * Actions a module page shows at the top of its « ⚙ » panel (import, edit…). `fullView` true: the
 * actions take the whole panel (a form with « ← Retour »), the options and the switch-off are hidden.
 * `onClose` runs when the panel closes (back to the actions list next time).
 */
export interface ModuleActions {
	render: Snippet;
	fullView?: () => boolean;
	onClose?: () => void;
}

let actionsRegistry = $state.raw<Partial<Record<ModuleId, ModuleActions>>>({});

/**
 * A module page registers its panel actions (on mount). The registry is read untracked: pages call
 * this from an effect, which must not depend on the registry it writes.
 */
export function setModuleActions(id: ModuleId, actions: ModuleActions): void {
	actionsRegistry = { ...untrack(() => actionsRegistry), [id]: actions };
}

/** The page is gone: its actions leave the panel (registry read untracked, as above). */
export function clearModuleActions(id: ModuleId): void {
	const next = { ...untrack(() => actionsRegistry) };
	delete next[id];
	actionsRegistry = next;
}

/** Actions registered by the page of a module, if any. */
export function moduleActions(id: ModuleId | null): ModuleActions | undefined {
	return id ? actionsRegistry[id] : undefined;
}
