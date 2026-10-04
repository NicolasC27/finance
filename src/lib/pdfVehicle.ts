import type { PdfLine } from './pdfNatixis';
import type { Asset, AssetInput } from './assets';
import { normalizePlate, sortReadings } from './assets';

/**
 * Vehicle documents (PDF) → facts for its sheet. Pure module, testable with tsx. Purchase order or
 * sales invoice (purchase: price, mileage at delivery, used or new), workshop invoice (maintenance:
 * odometer of the day, first registration, end of warranty). Read by labels ('Kilométrage',
 * 'Immatriculation', 'Date 1ère immat.') and by table columns (x position under the header).
 */

export interface VehicleDocument {
	type: 'achat' | 'atelier' | 'autre';
	/** Document date (order validation, invoice date). */
	date?: string;
	marque?: string;
	modele?: string;
	version?: string;
	annee?: number;
	plaque?: string;
	premiereImmat?: string;
	finGarantie?: string;
	/** Odometer read on the document. */
	km?: number;
	/** Date of that odometer reading (workshop reception, else document date). */
	kmDate?: string;
	/** Total price paid (purchase). */
	prix?: number;
	cv?: number;
	occasion?: boolean;
}

const MAKES = [
	'ALFA ROMEO', 'AUDI', 'BMW', 'CITROEN', 'CITROËN', 'CUPRA', 'DACIA', 'DS', 'FIAT', 'FORD', 'HONDA', 'HYUNDAI', 'JEEP', 'KIA', 'LAND ROVER', 'LEXUS', 'MAZDA',
	'MERCEDES-BENZ', 'MERCEDES', 'MG', 'MINI', 'MITSUBISHI', 'NISSAN', 'OPEL', 'PEUGEOT', 'PORSCHE', 'RENAULT', 'SEAT', 'SKODA', 'SMART', 'SUBARU', 'SUZUKI', 'TESLA', 'TOYOTA',
	'VOLKSWAGEN', 'VOLVO'
];

const DATE = /(\d{2})\/(\d{2})\/(\d{4})/;
const iso = (s: string | undefined): string | undefined => {
	const m = s ? DATE.exec(s) : null;
	return m ? `${m[3]}-${m[2]}-${m[1]}` : undefined;
};
/** Amount or odometer written the French way ('18 990,00', '45200'). */
const parseNumber = (s: string | undefined): number | undefined => {
	const m = s ? /\d[\d\s  .]*(?:,\d+)?/.exec(s) : null;
	if (!m) return undefined;
	const n = Number(m[0].replace(/[\s  .]/g, '').replace(',', '.'));
	return Number.isFinite(n) ? n : undefined;
};
const titleCase = (s: string) => s.toLowerCase().replace(/(^|[\s-])\p{L}/gu, (c) => c.toUpperCase());
/** Readable model: 'CLIO' → 'Clio'; 'C-HR', '2008' unchanged. */
const modelName = (m: string) => (/^[A-ZÀ-Ü]{4,}$/.test(m) ? titleCase(m) : m);

/** Text following a label on the same line (first label found). */
function textAfter(lines: readonly PdfLine[], label: RegExp): string | undefined {
	for (const l of lines) {
		const m = label.exec(l.text);
		if (m) return l.text.slice(m.index + m[0].length).replace(/^[\s:|]+/, '');
	}
	return undefined;
}

/** Value of a table column: item of the following lines aligned under the header (± 40). */
function columnValue(lines: readonly PdfLine[], header: RegExp): string | undefined {
	for (let i = 0; i < lines.length; i++) {
		const h = lines[i]!.items.find((it) => header.test(it.str.trim()));
		if (!h) continue;
		for (const l of lines.slice(i + 1, i + 5)) {
			if (l.y < lines[i]!.y - 40) break;
			const nearest = l.items.filter((it) => Math.abs(it.x - h.x) <= 40).sort((a, b) => Math.abs(a.x - h.x) - Math.abs(b.x - h.x))[0];
			if (nearest && /\d/.test(nearest.str)) return nearest.str;
		}
	}
	return undefined;
}

/**
 * Make, model, year and version: a 'MAKE - MODEL …' line, or the Make / Model columns of an invoice
 * (workshop invoice: 'Modèle' column on one or two lines, make alone in the data line; a trim level
 * alone on the next line, e.g. 'Exclusive').
 */
function identity(lines: readonly PdfLine[]): Pick<VehicleDocument, 'marque' | 'modele' | 'annee' | 'version'> {
	for (let i = 0; i < lines.length; i++) {
		const t = lines[i]!.text.trim();
		const make = MAKES.find((m) => t.toUpperCase().startsWith(`${m} -`) || t.toUpperCase().startsWith(`${m} – `));
		if (!make) continue;
		const words = t.slice(make.length).replace(/^\s*[-–]\s*/, '').split(/\s+/);
		const model = words.shift();
		let year: number | undefined;
		if (/^(19|20)\d{2}$/.test(words[0] ?? '')) year = Number(words.shift());
		if (words[0] === model) words.shift();
		const nextLine = lines[i + 1];
		if (nextLine && lines[i]!.y - nextLine.y < 16 && /^[\p{L}][\p{L}\s+-]{2,24}$/u.test(nextLine.text.trim())) words.push(nextLine.text.trim());
		return { marque: titleCase(make), ...(model ? { modele: modelName(model) } : {}), ...(year ? { annee: year } : {}), ...(words.length ? { version: words.join(' ') } : {}) };
	}
	for (let i = 0; i < lines.length; i++) {
		const h = lines[i]!.items.find((it) => /^mod[èe]le$/i.test(it.str.trim()));
		if (!h) continue;
		const below = lines.slice(i + 1, i + 5).filter((l) => l.y >= lines[i]!.y - 30);
		const pieces = below.flatMap((l) => l.items.filter((it) => it.x >= h.x - 60 && it.x <= h.x + 90 && /[\p{L}\d]/u.test(it.str) && !DATE.test(it.str) && !normalizePlate(it.str)?.match(/^[A-Z]{2}-\d{3}-[A-Z]{2}$/)).map((it) => it.str.trim()));
		const makeItem = below.flatMap((l) => l.items).find((it) => MAKES.includes(it.str.trim().toUpperCase()));
		const text = pieces.join(' ').replace(/\s+/g, ' ').trim();
		if (!text && !makeItem) continue;
		const [model, ...rest] = text.split(' ');
		return { ...(makeItem ? { marque: titleCase(makeItem.str.trim()) } : {}), ...(model ? { modele: modelName(model) } : {}), ...(rest.length ? { version: rest.join(' ') } : {}) };
	}
	return {};
}

/**
 * Reads a PDF already extracted into lines (first 2 pages), including the power table
 * ('CV | Ch DIN | CO2 | 10 | 180 | 118 g/km').
 */
export function readVehicleDocument(pages: readonly PdfLine[][]): VehicleDocument | { error: string } {
	const lines = pages.slice(0, 2).flat();
	const allText = lines.map((l) => l.text).join('\n');
	const type: VehicleDocument['type'] = /bon de commande\s+v[ée]hicule|facture de vente|certificat de cession|commande v[ée]hicule/i.test(allText)
		? 'achat'
		: /facture atelier|ordre de r[ée]paration|entretien|r[ée]vision|vidange/i.test(allText)
			? 'atelier'
			: 'autre';
	const id = identity(lines);
	const plate = normalizePlate((columnValue(lines, /^immatriculation$/i) ?? textAfter(lines, /immatriculation/i) ?? '').match(/[A-Z]{2}[- ]?\d{3}[- ]?[A-Z]{2}/)?.[0] ?? (/\b[A-HJ-NP-TV-Z]{2}-\d{3}-[A-HJ-NP-TV-Z]{2}\b/.exec(allText)?.[0] ?? ''));
	const dateLine = lines.find((l) => /^date$/i.test(l.items[0]?.str.trim() ?? ''));
	const date = iso(textAfter(lines, /date de validation/i)) ?? iso(dateLine?.text) ?? iso(textAfter(lines, /date de facture/i)) ?? iso(lines.slice(0, 12).map((l) => l.text).find((t) => DATE.test(t)));
	const firstRegistration = iso(columnValue(lines, /^date 1[èe]re/i)) ?? iso(textAfter(lines, /date mec|1[èe]re mise en circulation|date de 1[èe]re immatriculation|1[èe]re immatriculation/i));
	const warrantyEnd = iso(columnValue(lines, /^date de fin de/i)) ?? iso(textAfter(lines, /fin de garantie/i));
	const kmText = type === 'achat' ? (textAfter(lines, /kilom[ée]trage estim[ée] [àa] la livraison/i) ?? textAfter(lines, /kilom[ée]trage/i)) : (columnValue(lines, /^km$/i) ?? textAfter(lines, /kilom[ée]trage/i));
	const km = parseNumber(kmText);
	const price = type === 'achat' ? (parseNumber(textAfter(lines, /total de la commande/i)) ?? parseNumber(textAfter(lines, /prix du v[ée]hicule/i))) : undefined;
	const fiscal = textAfter(lines, /CV\s*\|\s*Ch DIN\s*\|\s*CO2/i)?.split('|').map((s) => s.trim());
	const taxHp = fiscal ? parseNumber(fiscal[0]) : parseNumber(/(\d{1,2})\s*CV\b/.exec(allText)?.[1]);
	const used = /d[´'’]?\s?occasion/i.test(allText) ? true : /v[ée]hicule neuf/i.test(allText) ? false : undefined;
	const doc: VehicleDocument = {
		type,
		...(date ? { date } : {}),
		...id,
		...(plate ? { plaque: plate } : {}),
		...(firstRegistration ? { premiereImmat: firstRegistration } : {}),
		...(warrantyEnd ? { finGarantie: warrantyEnd } : {}),
		...(km && km >= 10 && km < 2_000_000 ? { km: Math.round(km), kmDate: iso(textAfter(lines, /date de r[ée]ception/i)) ?? date } : {}),
		...(price && price > 100 ? { prix: price } : {}),
		...(taxHp && taxHp > 0 && taxHp < 100 ? { cv: taxHp } : {}),
		...(used !== undefined ? { occasion: used } : {})
	};
	if (!doc.plaque && !doc.km && !doc.marque && !doc.prix) return { error: 'aucune information de véhicule reconnue (bon de commande, facture d’achat ou d’atelier attendus)' };
	return doc;
}

const fr = (n: number) => n.toLocaleString('fr-FR');
const dateFr = (d: string) => d.split('-').reverse().join('/');

/**
 * Applies a document to a vehicle (or creates one): official facts (plate, first registration, end
 * of warranty) win, the rest only fills gaps; an invoice odometer becomes a reading. Returns the
 * entry to save and the readable list of what changes.
 */
export function applyVehicleDocument(asset: Asset | undefined, doc: VehicleDocument): { saisi: AssetInput; changements: string[] } {
	const changes: string[] = [];
	const veh = { ...(asset?.vehicle ?? { kmLog: [] }) };
	const name = asset?.name ?? ([doc.marque, doc.modele].filter(Boolean).join(' ') || 'Véhicule');
	if (!asset) changes.push(`nouveau véhicule « ${name} »`);
	const setOfficial = <K extends 'plate' | 'firstRegistration' | 'warrantyEnd'>(k: K, v: string | undefined, label: string) => {
		if (!v || veh[k] === v) return;
		veh[k] = v;
		changes.push(label);
	};
	setOfficial('plate', doc.plaque, `plaque ${doc.plaque}`);
	setOfficial('firstRegistration', doc.premiereImmat, `1re immatriculation ${doc.premiereImmat ? dateFr(doc.premiereImmat) : ''}`);
	setOfficial('warrantyEnd', doc.finGarantie, `fin de garantie ${doc.finGarantie ? dateFr(doc.finGarantie) : ''}`);
	if (!veh.version && (doc.version || doc.cv)) {
		veh.version = [doc.version, doc.cv ? `${doc.cv} CV` : ''].filter(Boolean).join(' · ');
		changes.push(`version ${veh.version}`);
	}
	if (doc.type === 'achat') {
		if (doc.occasion !== undefined && veh.boughtUsed === undefined) veh.boughtUsed = doc.occasion;
		if (doc.km && veh.kmAtPurchase === undefined) {
			veh.kmAtPurchase = doc.km;
			changes.push(`${fr(doc.km)} km à l'achat`);
		}
	} else if (doc.km && doc.kmDate) {
		const before = veh.kmLog.length;
		veh.kmLog = sortReadings([...veh.kmLog, { date: doc.kmDate, km: doc.km, source: 'facture' }]);
		if (veh.kmLog.length > before) changes.push(`${fr(doc.km)} km le ${dateFr(doc.kmDate)}`);
	}
	const priceKnown = asset && asset.purchasePrice > 0;
	const purchase = doc.type === 'achat' && doc.prix && !priceKnown;
	if (purchase) changes.push(`achat ${fr(doc.prix!)} € le ${dateFr(doc.date ?? '')}`);
	const input: AssetInput = {
		type: 'vehicule',
		name,
		purchaseDate: purchase && doc.date ? doc.date : (asset?.purchaseDate ?? doc.date ?? doc.premiereImmat ?? new Date().toISOString().slice(0, 10)),
		purchasePrice: purchase ? doc.prix! : (asset?.purchasePrice ?? 0),
		...(asset?.estimatedValue !== undefined ? { estimatedValue: asset.estimatedValue } : {}),
		...(asset?.valueDate ? { valueDate: asset.valueDate } : {}),
		...(asset?.valueSource ? { valueSource: asset.valueSource } : {}),
		...(asset?.valueConfirmed ? { valueConfirmed: true } : {}),
		linkedTxKeys: asset?.linkedTxKeys ?? [],
		...(asset?.note ? { note: asset.note } : {}),
		vehicle: veh
	};
	return { saisi: input, changements: changes };
}

/** Vehicle concerned by a document: same plate, else same make and model, else the only vehicle. */
export function vehicleOfDocument(vehicles: readonly Asset[], doc: VehicleDocument): Asset | undefined {
	if (doc.plaque) {
		const v = vehicles.find((b) => b.vehicle?.plate === doc.plaque);
		if (v) return v;
	}
	const name = [doc.marque, doc.modele].filter(Boolean).join(' ').toLowerCase();
	const sameName = name ? vehicles.filter((b) => b.name.toLowerCase() === name) : [];
	if (sameName.length === 1) return sameName[0];
	return doc.type !== 'achat' && vehicles.length === 1 && !doc.plaque ? vehicles[0] : undefined;
}
