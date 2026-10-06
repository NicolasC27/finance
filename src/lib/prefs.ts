/**
 * `budget:*` keys that hold a preference of this browser rather than data: the other tabs ignore
 * their writes (no « données modifiées » warning) and a full reset keeps the display ones.
 */

/** Every preference key (theme, sidebar, layout, modules, display toggles). */
export const PREF_KEYS: ReadonlySet<string> = new Set([
	'budget:theme',
	'budget:sidebar',
	'budget:ui-collapse',
	'budget:analyse-ui',
	'budget:layout',
	'budget:modules',
	'budget:car-options',
	'budget:privacy',
	'budget:compact-rows',
	'budget:account-badges',
	'budget:brand-logos'
]);

/** Preferences kept by « Tout réinitialiser »: the look of the app, never what it shows. */
export const KEPT_ON_RESET: ReadonlySet<string> = new Set(['budget:theme', 'budget:sidebar', 'budget:ui-collapse', 'budget:privacy', 'budget:compact-rows', 'budget:account-badges', 'budget:brand-logos']);
