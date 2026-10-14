import { MERCHANT_DICT } from './merchantDict';
import { countryOf } from './countries';
import { shiftDays } from './trips';

/**
 * Which operations outside a trip's dates belong to it (pure, testable): a payment to a travel
 * brand in the year before the departure (flights, beds, holiday operators, rental cars, tours
 * booked ahead; trains, buses and car sharing are everyday spending and stay out), a payment in
 * a foreign currency or naming the destination around the dates (bank bookings come late), the
 * bank's foreign-payment fees just after. The category itself stays with the vacation
 * reclassification: attaching an operation to the period is what counts it in the envelopes.
 */

export type AttachKind = 'marque' | 'devise' | 'lieu' | 'frais';

/** Travel sellers the merchant dictionary does not list under « vacances ». */
const EXTRA_BRANDS = ['EUROPCAR', 'HERTZ', 'SIXT', 'RENT A CAR', 'RENTACAR', 'GETYOURGUIDE', 'CIVITATIS', 'TIQETS', 'OPODO', 'EDREAMS', 'GO VOYAGES', 'KIWI COM', 'TAP AIR PORTUGAL', 'TAP PORTUGAL', 'IBERIA', 'BRITISH AIRWAYS', 'AER LINGUS', 'WIZZ AIR', 'WIZZAIR', 'NORWEGIAN', 'SWISS', 'AUSTRIAN', 'ITA AIRWAYS', 'TURKISH AIRLINES', 'EMIRATES', 'QATAR AIRWAYS', 'ETIHAD', 'JAPAN AIRLINES', 'ALL NIPPON', 'KOREAN AIR', 'AIR CANADA', 'DELTA AIR', 'UNITED AIRLINES', 'AMERICAN AIRLINES', 'LATAM', 'ROYAL AIR MAROC', 'TUNISAIR', 'AIR CARAIBES', 'CORSAIR', 'FRENCH BEE', 'CORSICA FERRIES', 'BRITTANY FERRIES', 'DFDS', 'BALEARIA'];

export const TRAVEL_BRANDS: readonly string[] = [...new Set([...(MERCHANT_DICT.vacances ?? []), ...EXTRA_BRANDS])];

const CURRENCIES = /\b(?:USD|GBP|CHF|JPY|CNY|THB|MAD|TND|DZD|CAD|AUD|NZD|MXN|BRL|ARS|CLP|COP|PEN|INR|IDR|VND|KRW|SGD|HKD|MYR|PHP|TRY|EGP|ZAR|NOK|SEK|DKK|PLN|CZK|HUF|RON|BGN|ISK|AED|QAR|ILS|TWD|LKR|NPR|KES|TZS|GEL|AMD|AZN|KZT|UZS|MUR|XOF|XPF|XAF|CRC|DOP|CUP|GTQ|JOD|LBP|OMR|SAR|BHD|KWD|RSD|MKD|ALL|BAM|UAH|MDL|KHR|LAK|MMK|BDT|PKR|MNT|FJD)\b/;
const FOREIGN_FEE = /\b(?:COMMISSIONS?|FRAIS)\b.*\b(?:ETRANGER|HORS ZONE EURO|HORS ZONE|CHANGE|DEVISES?)\b/;
/** Words of a destination too common to name a place on their own. */
const STOP = new Set(['PAYS', 'SAINT', 'SAINTE', 'VILLE', 'PLAGE', 'ILES', 'NORD', 'OUEST', 'COTE', 'PORT', 'MONT', 'BAIE', 'GRAND', 'PETIT', 'CENTRE', 'VILLAGE', 'VALLEE', 'PARC', 'LAC']);

/** The label as a bank prints it, compared without accents, case or punctuation. */
export function normalizeLabel(label: string): string {
	return label
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.toUpperCase()
		.replace(/[^A-Z0-9]+/g, ' ')
		.trim();
}

const BRAND_RES = TRAVEL_BRANDS.map((b) => new RegExp(`\\b${normalizeLabel(b).replace(/ /g, '\\s+')}\\b`));

/** Words that name the trip's place: the destination's and the country's names (and aliases), 4 letters or more, the common ones out. */
export function placeTokens(trip: { destination: string; country: string }): string[] {
	const names = [trip.destination, trip.country, ...(countryOf(trip.country)?.names ?? [])];
	const out = new Set<string>();
	for (const n of names) for (const w of normalizeLabel(n).split(' ')) if (w.length >= 4 && !STOP.has(w)) out.add(w);
	return [...out];
}

/** Why an operation looks like the trip's, null when it does not. */
export function attachKind(label: string, trip: { destination: string; country: string }): AttachKind | null {
	const text = normalizeLabel(label);
	if (!text) return null;
	if (FOREIGN_FEE.test(text)) return 'frais';
	if (BRAND_RES.some((re) => re.test(text))) return 'marque';
	if (CURRENCIES.test(text)) return 'devise';
	if (placeTokens(trip).some((t) => new RegExp(`\\b${t}\\b`).test(text))) return 'lieu';
	return null;
}

/** Days around the trip during which each kind of operation can belong to it. */
export const ATTACH_WINDOWS: Record<AttachKind, { before: number; after: number }> = {
	marque: { before: 365, after: 5 },
	devise: { before: 30, after: 10 },
	lieu: { before: 30, after: 10 },
	frais: { before: 0, after: 15 }
};

/** The kind of attachment when the operation's real date falls in the window of what it looks like, null otherwise. */
export function attachmentFor(label: string, date: string, trip: { destination: string; country: string; start: string; end: string }): AttachKind | null {
	if (!trip.start || !trip.end || !date) return null;
	const kind = attachKind(label, trip);
	if (!kind) return null;
	const w = ATTACH_WINDOWS[kind];
	return shiftDays(trip.start, -w.before) <= date && date <= shiftDays(trip.end, w.after) ? kind : null;
}
