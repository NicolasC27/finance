/**
 * Destination photos (pure, testable, no import: the local server loads it too): the Wikivoyage
 * banner of a place read from its Wikidata item (property P948, a wide panorama made for page
 * headers; the item's picture P18 as a fallback when it is a view and not a map or a flag), the
 * file names and widths the local proxy accepts, and the hand-made skies shown while the photo
 * loads or when there is none. The queries tried for a trip are in trips.ts (photoQueries).
 */

export type PhotoKind = 'banner' | 'image';

export interface Photo {
	/** Wikimedia Commons file name (« Lisboa banner.jpg »). */
	file: string;
	kind: PhotoKind;
}

/** Widths the proxy serves (Commons renders these): the chip thumbnails and the hero. */
export const PHOTO_WIDTHS = [480, 1600] as const;
export type PhotoWidth = (typeof PHOTO_WIDTHS)[number];

const FILE_RE = /^[^/\\:*?"<>|\u0000-\u001f]{1,190}\.(jpe?g|png|gif|webp|tiff?|svg)$/i;

/** A Commons file name the proxy accepts: one path segment of at most 195 characters with an image extension, no control characters. */
export function isPhotoFile(name: unknown): name is string {
	return typeof name === 'string' && FILE_RE.test(name) && !name.startsWith('.') && !name.includes('..');
}

/** Pictures that are not a view of the place: montages, flags, maps, arms, satellite shots, logos, drawings. */
const NOT_A_VIEW = /montage|collage|flag|drapeau|bandera|\bmaps?\b|carte|\bmapa\b|locat|coat|armoiries|blason|escudo|logo|seal|siegel|satellite|photosat|\.svg$/i;

interface Claim {
	mainsnak?: { datavalue?: { value?: unknown } };
	rank?: string;
}

interface Entity {
	missing?: unknown;
	claims?: Record<string, Claim[]>;
}

/**
 * Photo of the first entity of a `wbgetentities` answer: its Wikivoyage banner (preferred rank
 * first), else its picture when it looks like a view; null without either. `bannersOnly` for an
 * entity found by a text search, where only a banner proves the page is a destination.
 */
export function parseEntityPhoto(json: unknown, bannersOnly = false): Photo | null {
	const entities = (json as { entities?: Record<string, Entity> } | null)?.entities;
	if (!entities || typeof entities !== 'object') return null;
	for (const e of Object.values(entities)) {
		if (!e || e.missing !== undefined) continue;
		const files = (property: string) =>
			[...(e.claims?.[property] ?? [])]
				.sort((a, b) => Number(b.rank === 'preferred') - Number(a.rank === 'preferred'))
				.map((c) => c.mainsnak?.datavalue?.value)
				.filter(isPhotoFile);
		const banner = files('P948')[0];
		if (banner) return { file: banner, kind: 'banner' };
		if (bannersOnly) return null;
		const image = files('P18').find((f) => !NOT_A_VIEW.test(f));
		return image ? { file: image, kind: 'image' } : null;
	}
	return null;
}

/** Wikidata item of the first page of a Wikipedia `generator=search` answer asked with `prop=pageprops`. */
export function parseSearchItem(json: unknown): string | null {
	const pages = (json as { query?: { pages?: { pageprops?: { wikibase_item?: unknown } }[] } } | null)?.query?.pages;
	const id = Array.isArray(pages) ? pages[0]?.pageprops?.wikibase_item : undefined;
	return typeof id === 'string' && /^Q\d{1,12}$/.test(id) ? id : null;
}

/** Page of the file on Wikimedia Commons (its author and licence). */
export const commonsPageUrl = (file: string): string => `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(file.replace(/ /g, '_'))}`;

export interface Sky {
	from: string;
	to: string;
	glow: string;
}

/** Six hand-made skies (dusk, sea, forest, desert, night, lagoon) for trips without a photo. */
export const SKIES: readonly Sky[] = [
	{ from: '#2b3a67', to: '#8690bd', glow: '#f3c57b' },
	{ from: '#0e4f6e', to: '#74bccd', glow: '#fff1c1' },
	{ from: '#1f3d2b', to: '#86a873', glow: '#f9e4a0' },
	{ from: '#8a4b2a', to: '#e3b981', glow: '#fff4d6' },
	{ from: '#17192e', to: '#4f5494', glow: '#c8d3ff' },
	{ from: '#0b5c5c', to: '#86d5c8', glow: '#fffbe6' }
];

/** The sky of a trip, chosen by its name so each trip keeps its own. */
export function skyOf(seed: string): Sky {
	let h = 0;
	for (const ch of seed) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
	return SKIES[h % SKIES.length]!;
}
