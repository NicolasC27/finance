/**
 * Global UI state (Svelte 5 runes): collapsed sidebar, Cmd+K palette, Kraken modal, cross-page
 * requests (CSV import, prefilled search).
 */

import { setPersistFailureHandler } from './storage';

const SIDEBAR_KEY = 'budget:sidebar';
const COLLAPSE_KEY = 'budget:ui-collapse';

function loadSidebar(): boolean {
	if (typeof localStorage === 'undefined') return false;
	try {
		return localStorage.getItem(SIDEBAR_KEY) === 'collapsed';
	} catch {
		return false;
	}
}

/** Persisted collapsible sections (SPEC v13 §B): Record<id, true = collapsed>. */
function loadCollapse(): Record<string, boolean> {
	if (typeof localStorage === 'undefined') return {};
	try {
		const parsed = JSON.parse(localStorage.getItem(COLLAPSE_KEY) ?? '{}') as Record<string, boolean>;
		return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
	} catch {
		return {};
	}
}

export const uiState = $state({
	/** Collapsed sidebar (64 px, icons only), persisted. */
	sidebarCollapsed: loadSidebar(),
	/** Command palette open (Cmd/Ctrl+K). */
	paletteOpen: false,
	/** Kraken keys configuration modal. */
	krakenModalOpen: false,
	/** Keyboard shortcuts cheat sheet ('?' key). */
	shortcutsOpen: false,
	/** Encrypted auto-backup setting. */
	backupDialogOpen: false,
	/** Settings: theme, density, width, backups, Kraken (sidebar gear, Ctrl+,). */
	settingsOpen: false,
	/** 'Imports' panel (right drawer): file drop, format recognised automatically. */
	importPanelOpen: false,
	/** Settings section to scroll to when the dialog opens (« Tous les réglages des modules… »). */
	settingsSection: null as 'modules' | null,
	/** Options panel of a module (right drawer, ⚙ button of the module page). */
	moduleOptions: null as import('./modules').ModuleId | null,
	/**
	 * Modules menu (right-click on the sidebar, « + Modules », long press on « Plus »): the point it
	 * opens at (its top-left corner, or its bottom-left one with `above`) and the module right-clicked.
	 */
	modulesMenu: null as { x: number; y: number; above: boolean; target: import('./modules').ModuleId | null } | null,
	/**
	 * Files dropped in the panel for Transactions (statements, exports, Krak / Natixis PDFs, tax
	 * notices): the page imports them on opening with its multi-file import, then resets to null.
	 */
	importsEnAttente: null as File[] | null,
	/** 'Corriger les colonnes…' requested from the panel: Transactions reopens its remapper. */
	remapRequest: false,
	/**
	 * CSV import request triggered outside the Transactions page (Cmd+K palette, Patrimoine card): the
	 * page opens the file picker.
	 */
	importRequest: null as 'cm' | 'natixis' | null,
	/** Search to prefill on the Transactions page. */
	txSearch: null as string | null,
	/**
	 * Filter requested from the Transactions page (click on a donut segment, a Budget card…):
	 * category, subcategory (null = 'Autres', no subcategory), date range. Consumed then reset to null.
	 */
	txFilter: null as { categoryId?: import('./types').CategoryId; subId?: string | null; from?: string; to?: string; vacationId?: string; minAmount?: number; maxAmount?: number; search?: string } | null,
	/** Goal form prefill (link from the Advice card). */
	goalPrefill: null as { name: string; targetAmount: number } | null,
	/** Global toast (e.g. 'Opération supprimée — Annuler'), auto-closes after 5 s. */
	toast: null as { message: string; actionLabel?: string; onAction?: () => void; success?: boolean; nonce: number } | null,
	/** Collapsed page sections (persisted in `budget:ui-collapse`, true = collapsed). */
	sectionCollapse: loadCollapse(),
	/**
	 * Number of open dialogs (`use:modal` action): single-key page shortcuts are ignored while a
	 * dialog is in front.
	 */
	dialogDepth: 0
});

/** Sections collapsed until the user chooses (Budget page density). */
const COLLAPSED_BY_DEFAULT = new Set(['advisor', 'forecast', 'notes']);

/** Is section `id` collapsed? (default: expanded, except COLLAPSED_BY_DEFAULT) */
export function isSectionCollapsed(id: string): boolean {
	return uiState.sectionCollapse[id] ?? COLLAPSED_BY_DEFAULT.has(id);
}

/**
 * Collapses/expands a section and persists the choice (survives visits; in memory only for the
 * session if storage is unavailable).
 */
export function toggleSectionCollapse(id: string): void {
	uiState.sectionCollapse = { ...uiState.sectionCollapse, [id]: !isSectionCollapsed(id) };
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(COLLAPSE_KEY, JSON.stringify(uiState.sectionCollapse));
	} catch {
	}
}

/** Shows the global toast (replaces any current toast). */
export function showToast(message: string, actionLabel?: string, onAction?: () => void): void {
	uiState.toast = { message, actionLabel, onAction, nonce: Date.now() };
}

/** Shows the global toast with an animated success check (something was saved or applied). */
export function showSuccess(message: string, actionLabel?: string, onAction?: () => void): void {
	uiState.toast = { message, actionLabel, onAction, success: true, nonce: Date.now() };
}

// localStorage write failure (quota full…): reported instead of swallowed
setPersistFailureHandler(() =>
	showToast('Stockage du navigateur plein : les dernières modifications ne sont pas enregistrées. Faites une sauvegarde, puis libérez de la place.')
);

/**
 * Collapses/expands the sidebar and persists the choice (in memory only for the session if storage
 * is unavailable).
 */
export function toggleSidebar(): void {
	uiState.sidebarCollapsed = !uiState.sidebarCollapsed;
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(SIDEBAR_KEY, uiState.sidebarCollapsed ? 'collapsed' : 'expanded');
	} catch {
	}
}
