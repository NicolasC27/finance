/**
 * Theme handling: 5 themes (Encre by default), persisted through `data-theme` on <html>; the
 * `light` class stays the switch of the existing component overrides (Papier AND Sable).
 */

export type Theme = 'encre' | 'papier' | 'ardoise' | 'foret' | 'sable';

export interface ThemeMeta {
	id: Theme;
	label: string;
	mode: 'dark' | 'light';
	bg: string;
	accent: string;
}

export const THEMES: ThemeMeta[] = [
	{ id: 'encre', label: 'Encre', mode: 'dark', bg: '#1c1c1c', accent: '#c9a86c' },
	{ id: 'papier', label: 'Papier', mode: 'light', bg: '#f7f5f0', accent: '#8a6d3b' },
	{ id: 'ardoise', label: 'Ardoise', mode: 'dark', bg: '#1a1d20', accent: '#9db4b8' },
	{ id: 'foret', label: 'Forêt', mode: 'dark', bg: '#171c18', accent: '#9caf88' },
	{ id: 'sable', label: 'Sable', mode: 'light', bg: '#f2ede4', accent: '#9a6b3f' }
];

const THEME_KEY = 'budget:theme';

const canStore = typeof localStorage !== 'undefined';

const THEME_IDS = new Set<string>(THEMES.map((t) => t.id));

/** Migrates the old values ('dark' | 'light') to the new themes. */
function migrate(raw: string | null): Theme | null {
	if (raw === null) return null;
	if (raw === 'dark') return 'encre';
	if (raw === 'light') return 'papier';
	return THEME_IDS.has(raw) ? (raw as Theme) : null;
}

/** Reads the stored preference (migrated) without ever throwing. */
function storedTheme(): Theme | null {
	if (!canStore) return null;
	try {
		return migrate(localStorage.getItem(THEME_KEY));
	} catch {
		return null;
	}
}

/** Metadata of a theme (Encre as fallback). */
export function themeMeta(theme: Theme): ThemeMeta {
	return THEMES.find((t) => t.id === theme) ?? THEMES[0]!;
}

/** Initial theme: stored preference if any, otherwise Encre, ALWAYS. */
export function initTheme(): Theme {
	return storedTheme() ?? 'encre';
}

/**
 * Applies the theme: `data-theme` on <html> + `light` class for a light theme (the existing
 * `html.light …` overrides apply to Papier AND Sable) + the mobile browser bar colour (it stayed
 * #1c1c1c in Papier/Sable). Persists only on an explicit user choice; if storage is unavailable
 * the theme stays applied for the session.
 */
export function applyTheme(theme: Theme, persist = true): void {
	if (typeof document === 'undefined') return;
	const meta = themeMeta(theme);
	document.documentElement.dataset.theme = meta.id;
	document.documentElement.classList.toggle('light', meta.mode === 'light');
	document.querySelector('meta[name="theme-color"]')?.setAttribute('content', meta.bg);
	if (persist && canStore) {
		try {
			localStorage.setItem(THEME_KEY, meta.id);
		} catch {
		}
	}
}
