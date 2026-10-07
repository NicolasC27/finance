/**
 * Weather (pure, testable): the WMO weather codes of Open-Meteo read as a French label and one of
 * nine icons, the places and forecasts parsed from the API's answers, the town query accepted by
 * the local server, the French formats of the badge.
 */

export interface Place {
	/** Town name as the user will read it. */
	name: string;
	/** Region (admin1) and country, for the tooltip and to tell namesakes apart. */
	region: string;
	country: string;
	lat: number;
	lon: number;
}

export interface Weather {
	/** WMO weather code. */
	code: number;
	/** Current temperature (°C). */
	temperature: number;
	max: number;
	min: number;
	/** Rain of the day (mm). */
	precipitation: number;
	/** ISO date-time of the observation, local to the place. */
	at: string;
}

export type SkyIcon = 'sun' | 'cloud-sun' | 'cloud' | 'fog' | 'drizzle' | 'rain' | 'snow' | 'showers' | 'storm';

/** French label and icon of a WMO weather code (https://open-meteo.com/en/docs). */
export function describeSky(code: number): { label: string; icon: SkyIcon } {
	if (code === 0) return { label: 'Ciel dégagé', icon: 'sun' };
	if (code === 1) return { label: 'Plutôt dégagé', icon: 'cloud-sun' };
	if (code === 2) return { label: 'Partiellement nuageux', icon: 'cloud-sun' };
	if (code === 3) return { label: 'Couvert', icon: 'cloud' };
	if (code === 45 || code === 48) return { label: 'Brouillard', icon: 'fog' };
	if (code >= 51 && code <= 57) return { label: 'Bruine', icon: 'drizzle' };
	if (code >= 61 && code <= 67) return { label: 'Pluie', icon: 'rain' };
	if (code >= 71 && code <= 77) return { label: 'Neige', icon: 'snow' };
	if (code >= 80 && code <= 82) return { label: 'Averses', icon: 'showers' };
	if (code === 85 || code === 86) return { label: 'Averses de neige', icon: 'snow' };
	if (code >= 95) return { label: 'Orage', icon: 'storm' };
	return { label: 'Nuageux', icon: 'cloud' };
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** A place as stored or sent by the server: a name and finite coordinates. */
export function isPlace(v: unknown): v is Place {
	const p = v as Place | null;
	return typeof p?.name === 'string' && p.name !== '' && Number.isFinite(p.lat) && Number.isFinite(p.lon);
}

/** « Lyon, Auvergne-Rhône-Alpes (France) »: the name, then the region and the country when known. */
export function placeLabel(p: Place): string {
	return `${p.name}${p.region ? `, ${p.region}` : ''}${p.country ? ` (${p.country})` : ''}`;
}

/** Places of a geocoding answer (`results`), without the ones missing a name or coordinates. */
export function parsePlaces(json: unknown): Place[] {
	const results = (json as { results?: unknown } | null)?.results;
	if (!Array.isArray(results)) return [];
	const out: Place[] = [];
	for (const r of results as Record<string, unknown>[]) {
		const lat = num(r.latitude);
		const lon = num(r.longitude);
		if (typeof r.name !== 'string' || !r.name || lat === null || lon === null) continue;
		out.push({ name: r.name, region: typeof r.admin1 === 'string' ? r.admin1 : '', country: typeof r.country === 'string' ? r.country : '', lat, lon });
	}
	return out;
}

/** Current weather and the day's range of a forecast answer; null when a field is missing. */
export function parseForecast(json: unknown): Weather | null {
	const j = json as { current?: Record<string, unknown>; daily?: Record<string, unknown[]> } | null;
	const code = num(j?.current?.weather_code);
	const temperature = num(j?.current?.temperature_2m);
	const max = num(j?.daily?.temperature_2m_max?.[0]);
	const min = num(j?.daily?.temperature_2m_min?.[0]);
	const precipitation = num(j?.daily?.precipitation_sum?.[0]) ?? 0;
	const at = typeof j?.current?.time === 'string' ? j.current.time : '';
	if (code === null || temperature === null || max === null || min === null) return null;
	return { code, temperature, max, min, precipitation, at };
}

export const QUERY_RULE = 'Nom de ville attendu (2 à 60 caractères : lettres, chiffres, espaces, apostrophes, tirets, virgules, points).';

/**
 * Town query the geocoder accepts, or null: 2 to 60 characters of letters (with their accents),
 * digits, spaces and the punctuation of place names (« Aix-en-Provence », « St. Louis », « Lyon, France »).
 */
export function cleanQuery(q: unknown): string | null {
	if (typeof q !== 'string') return null;
	const text = q.normalize('NFC').replace(/\s+/g, ' ').trim();
	return text.length >= 2 && text.length <= 60 && /^[\p{L}\p{M}\p{N} '’.,()-]+$/u.test(text) ? text : null;
}

const degrees = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const millimetres = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
const typoMinus = (s: string) => s.replace('-', '−');

/** Temperature rounded the French way, typographic minus, no-break space before the degree sign: −1,5 → « −2 ° ». */
export const formatDegrees = (t: number): string => `${typoMinus(degrees.format(t)).replace('−0', '0')} °`;

/** Rain of the day: 0.3 → « 0,3 mm ». */
export const formatMillimetres = (mm: number): string => `${millimetres.format(mm)} mm`;

/** Hour of an observation from its ISO date-time: « 2026-10-07T14:30 » → « 14:30 », '' when unknown. */
export const observationHour = (at: string): string => (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(at) ? at.slice(11, 16) : '');
