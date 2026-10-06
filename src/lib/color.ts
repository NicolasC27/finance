/** Colour helpers (two-tone category gradients, ink on a brand colour). */

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

/** Black or white, whichever has the higher WCAG contrast on `hex` (white when `hex` is invalid). */
export function readableInk(hex: string): '#000000' | '#ffffff' {
	const rgb = hexToRgb(hex);
	if (!rgb) return '#ffffff';
	const [r, g, b] = rgb.map((c) => {
		const v = c / 255;
		return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
	}) as [number, number, number];
	const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
	return 1.05 / (luminance + 0.05) >= (luminance + 0.05) / 0.05 ? '#ffffff' : '#000000';
}
