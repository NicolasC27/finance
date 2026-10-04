/**
 * Right-hand side panel constants (pure module).
 * On desktop the panel slides in from the right over the page, which never moves and stays usable.
 * Below the desktop breakpoint the panel is a fullscreen overlay with a dimmed backdrop.
 */

/** Smallest viewport width (px) where the panel slides over the page without a backdrop. */
export const DOCK_MIN_VIEWPORT = 1024;

/** Duration of the panel slide (ms). */
export const PANEL_SLIDE_MS = 260;
