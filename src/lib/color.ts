/** Colour helpers (two-tone category gradients). */

/** "#c9a86c" → [201, 168, 108]; null when invalid. */
function hexToRgb(hex: string): [number, number, number] | null {
	const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
	if (!m) return null;
	const n = parseInt(m[1], 16);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Lightens a hex colour by mixing it towards white.
 * amount = 0.25 → ~25 % lighter tone (for two-tone gradients).
 */
export function lighten(hex: string, amount = 0.25): string {
	const rgb = hexToRgb(hex);
	if (!rgb) return hex;
	const mix = rgb.map((c) => Math.round(c + (255 - c) * Math.min(Math.max(amount, 0), 1)));
	return `#${mix.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}
