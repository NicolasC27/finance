/**
 * Assets (car, instruments, hi-fi…): purchased objects, tracked APART from
 * financial wealth (net worth does not change). Pure module, testable with
 * tsx: input validation (form, AI action) and totals.
 */

export type AssetType = 'vehicule' | 'instrument' | 'hifi' | 'autre';

/** Odometer reading: read on an invoice, typed by hand, or noted at the roadworthiness test. */
export interface KmReading {
	date: string; // YYYY-MM-DD
	km: number;
	source: 'facture' | 'saisie' | 'ct' | 'estimation';
}

/** Comparable ad collected to estimate a vehicle's value. */
export interface ComparableAd {
	libelle: string;
	annee?: number;
	km: number;
	prix: number;
	source?: string;
	url?: string;
}

/** Origin of an asset's retained value (the one the computations use). */
export type ValueSource = 'reprise' | 'argus' | 'lacentrale' | 'vente' | 'ia' | 'saisie';

/** Value sources the user can pick: label in the form, short wording after the amount. */
export const VALUE_SOURCES: readonly { id: ValueSource; label: string; court: string }[] = [
	{ id: 'reprise', label: 'Offre de reprise', court: 'offre de reprise' },
	{ id: 'argus', label: 'Cote Argus', court: 'cote Argus' },
	{ id: 'lacentrale', label: 'Cote La Centrale', court: 'cote La Centrale' },
	{ id: 'vente', label: 'Vente conclue', court: 'vente conclue' },
	{ id: 'saisie', label: 'Estimation perso', court: 'estimation perso' },
	{ id: 'ia', label: 'Estimation IA (annonces)', court: 'estimation IA' }
];

/** User decision on an AI valuation proposal (missing: still waiting). */
export type ValuationDecision = 'validee' | 'ignoree';

/**
 * Detailed estimate of a vehicle's value at a date. An AI search (`auto`) is only a proposal: it
 * becomes the retained value once the user validates it (`decision`).
 */
export interface VehicleValuation {
	date: string;
	/** Trade-in price from a dealer. */
	reprise?: number;
	/** Private sale price. */
	particulier?: number;
	/** Dealer asking price. */
	pro?: number;
	/** Mileage assumed for the estimate when there is no reading. */
	kmHypothese?: number;
	/** Estimate made automatically (ad search by the AI analysis). */
	auto?: boolean;
	/** What the user decided about this AI proposal. */
	decision?: ValuationDecision;
	annonces: ComparableAd[];
}

/** Vehicle-specific fields. */
export interface Vehicle {
	/** First registration (registration certificate, box B). */
	firstRegistration?: string;
	/** Odometer on the purchase day. */
	kmAtPurchase?: number;
	/** End of the manufacturer warranty. */
	warrantyEnd?: string;
	/** Odometer readings, sorted by date. */
	kmLog: KmReading[];
	/** Exact version (engine, trim, gearbox), e.g. « 1.5 Essence 130 ch Business BVA6 ». */
	version?: string;
	/** Number plate (AA-123-AA): stays on this PC. */
	plate?: string;
	/** Bought used (otherwise new). */
	boughtUsed?: boolean;
	/** Body colour (#rrggbb), for the illustration. */
	color?: string;
	/** Photo chosen by the user (downscaled image, data URL). */
	photo?: string;
	/** Latest detailed value estimate (an AI proposal or a valuation typed by the user). */
	cote?: VehicleValuation;
	/** Successive private-sale prices, one per valuation. */
	coteHistorique?: { date: string; valeur: number }[];
	/** Former flag of the monthly automatic valuation (no longer used: valuations are only asked for). */
	coteAuto?: boolean;
}

export interface Asset {
	id: string;
	type: AssetType;
	name: string;
	/** Purchase date (YYYY-MM-DD). */
	purchaseDate: string;
	/** Price paid in €, refunds deducted. */
	purchasePrice: number;
	/** Retained value in € (missing: the price paid, or a vehicle's theoretical value, is used). */
	estimatedValue?: number;
	/** Date of the retained value. */
	valueDate?: string;
	/** Origin of the retained value (missing on values saved before sources existed). */
	valueSource?: ValueSource;
	/** The user confirmed the retained value; a vehicle value without it shows « à confirmer ». */
	valueConfirmed?: boolean;
	/** Operations that paid for (or refunded) this asset. */
	linkedTxKeys: string[];
	note?: string;
	/** Vehicles only. */
	vehicle?: Vehicle;
}

export type AssetInput = Omit<Asset, 'id'>;

export const ASSET_TYPES: readonly { id: AssetType; label: string }[] = [
	{ id: 'vehicule', label: 'Véhicule' },
	{ id: 'instrument', label: 'Instrument' },
	{ id: 'hifi', label: 'Hi-fi' },
	{ id: 'autre', label: 'Autre' }
];

export const KM_SOURCES: readonly { id: KmReading['source']; label: string }[] = [
	{ id: 'saisie', label: 'saisi' },
	{ id: 'facture', label: 'facture' },
	{ id: 'ct', label: 'contrôle technique' },
	{ id: 'estimation', label: 'estimé' }
];

const MAX_AMOUNT = 10_000_000;
const MAX_KM = 2_000_000;
const MAX_READINGS = 1000;
const MAX_PHOTO = 1_500_000;
const MAX_ADS = 30;

export const assetTypeLabel = (id: AssetType): string => ASSET_TYPES.find((c) => c.id === id)?.label ?? id;

function parseAmount(v: unknown): number | null {
	const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v.replace(',', '.')) : NaN;
	return Number.isFinite(n) && n >= 0 && n <= MAX_AMOUNT ? Math.round(n * 100) / 100 : null;
}

const isEmpty = (v: unknown) => v === undefined || v === null || v === '';

function validDate(v: unknown): string | null {
	const d = typeof v === 'string' ? v.trim() : '';
	return /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().startsWith(d) ? d : null;
}

/** Mileage: positive integer (spaces and « km » tolerated). */
export function parseMileage(v: unknown): number | null {
	const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v.replace(/\s|km/gi, '').replace(',', '.')) : NaN;
	return Number.isFinite(n) && n >= 0 && n <= MAX_KM ? Math.round(n) : null;
}

/** Raw reading → valid reading, or the refusal reason. */
export function validateReading(raw: unknown): KmReading | string {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'relevé illisible';
	const o = raw as Record<string, unknown>;
	const date = validDate(o.date);
	if (!date) return 'date du relevé invalide (AAAA-MM-JJ)';
	const km = parseMileage(o.km);
	if (km === null) return 'kilométrage invalide';
	const source = o.source ?? 'saisie';
	if (!KM_SOURCES.some((s) => s.id === source)) return `source du relevé inconnue « ${String(source)} » (facture, saisie ou ct)`;
	return { date, km, source: source as KmReading['source'] };
}

/** Readings sorted by date (same date and same odometer: only one kept). */
export function sortReadings(log: readonly KmReading[]): KmReading[] {
	const seen = new Set<string>();
	return [...log]
		.sort((a, b) => a.date.localeCompare(b.date) || a.km - b.km)
		.filter((r) => {
			const k = `${r.date}|${r.km}`;
			if (seen.has(k)) return false;
			seen.add(k);
			return true;
		});
}

/** Normalised plate: SIV format « AA-123-AA », otherwise the cleaned old format; null when unreadable. */
export function normalizePlate(v: unknown): string | null {
	if (typeof v !== 'string') return null;
	const raw = v.toUpperCase().replace(/[\s.]+/g, '').trim();
	const siv = /^([A-HJ-NP-TV-Z]{2})-?(\d{3})-?([A-HJ-NP-TV-Z]{2})$/.exec(raw);
	if (siv) return `${siv[1]}-${siv[2]}-${siv[3]}`;
	return /^[A-Z0-9-]{4,12}$/.test(raw) ? raw : null;
}

/** Raw valuation (typed, searched) → valid valuation, or the refusal reason. */
export function validateValuation(raw: unknown): VehicleValuation | string {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'cote illisible';
	const o = raw as Record<string, unknown>;
	const date = validDate(o.date);
	if (!date) return 'date de la cote invalide (AAAA-MM-JJ)';
	const out: VehicleValuation = {
		date,
		annonces: [],
		...(o.auto === true ? { auto: true } : {}),
		...(o.decision === 'validee' || o.decision === 'ignoree' ? { decision: o.decision } : {})
	};
	for (const k of ['reprise', 'particulier', 'pro'] as const) {
		if (isEmpty(o[k])) continue;
		const m = parseAmount(o[k]);
		if (m === null) return `cote « ${k} » invalide`;
		out[k] = m;
	}
	if (!isEmpty(o.kmHypothese)) {
		const km = parseMileage(o.kmHypothese);
		if (km === null) return 'kilométrage supposé invalide';
		out.kmHypothese = km;
	}
	if (o.annonces !== undefined) {
		if (!Array.isArray(o.annonces) || o.annonces.length > MAX_ADS) return `annonces : liste de ${MAX_ADS} au plus`;
		for (const a of o.annonces as unknown[]) {
			if (!a || typeof a !== 'object') return 'annonce illisible';
			const x = a as Record<string, unknown>;
			const label = typeof x.libelle === 'string' ? x.libelle.trim().slice(0, 120) : '';
			const km = parseMileage(x.km);
			const price = parseAmount(x.prix);
			if (!label || km === null || price === null) return 'annonce incomplète (libellé, km, prix)';
			const year = typeof x.annee === 'number' && Number.isInteger(x.annee) && x.annee >= 1950 && x.annee <= 2100 ? x.annee : undefined;
			const source = typeof x.source === 'string' && x.source.trim() ? x.source.trim().slice(0, 40) : undefined;
			const url = typeof x.url === 'string' && /^https:\/\/[^\s]{4,500}$/.test(x.url) ? x.url : undefined;
			out.annonces.push({ libelle: label, km, prix: price, ...(year ? { annee: year } : {}), ...(source ? { source } : {}), ...(url ? { url } : {}) });
		}
	}
	return out;
}

function validateVehicle(raw: unknown): Vehicle | string {
	if (isEmpty(raw)) return { kmLog: [] };
	if (typeof raw !== 'object' || Array.isArray(raw)) return 'champs véhicule illisibles';
	const o = raw as Record<string, unknown>;
	const out: Vehicle = { kmLog: [] };
	if (!isEmpty(o.firstRegistration)) {
		const d = validDate(o.firstRegistration);
		if (!d) return 'date de 1re mise en circulation invalide (AAAA-MM-JJ)';
		out.firstRegistration = d;
	}
	if (!isEmpty(o.kmAtPurchase)) {
		const km = parseMileage(o.kmAtPurchase);
		if (km === null) return 'kilométrage à l’achat invalide';
		out.kmAtPurchase = km;
	}
	if (!isEmpty(o.warrantyEnd)) {
		const d = validDate(o.warrantyEnd);
		if (!d) return 'date de fin de garantie invalide (AAAA-MM-JJ)';
		out.warrantyEnd = d;
	}
	if (o.kmLog !== undefined) {
		if (!Array.isArray(o.kmLog)) return 'kmLog doit être une liste';
		if (o.kmLog.length > MAX_READINGS) return `trop de relevés (${o.kmLog.length} > ${MAX_READINGS})`;
		const readings: KmReading[] = [];
		for (const r of o.kmLog) {
			const v = validateReading(r);
			if (typeof v === 'string') return v;
			readings.push(v);
		}
		out.kmLog = sortReadings(readings);
	}
	if (!isEmpty(o.version)) {
		if (typeof o.version !== 'string' || o.version.trim().length > 80) return 'version invalide (80 caractères au plus)';
		out.version = o.version.trim().replace(/\s+/g, ' ');
	}
	if (!isEmpty(o.plate)) {
		const plate = normalizePlate(o.plate);
		if (!plate) return 'plaque d’immatriculation illisible (AA-123-AA)';
		out.plate = plate;
	}
	if (o.boughtUsed !== undefined && o.boughtUsed !== null) {
		if (typeof o.boughtUsed !== 'boolean') return 'boughtUsed doit valoir true ou false';
		out.boughtUsed = o.boughtUsed;
	}
	if (!isEmpty(o.color)) {
		if (typeof o.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(o.color)) return 'couleur invalide (#rrggbb)';
		out.color = o.color.toLowerCase();
	}
	if (!isEmpty(o.photo)) {
		if (typeof o.photo !== 'string' || !/^data:image\/(png|jpeg|webp);base64,/.test(o.photo) || o.photo.length > MAX_PHOTO) return 'photo invalide (PNG, JPEG ou WebP réduite)';
		out.photo = o.photo;
	}
	if (!isEmpty(o.cote)) {
		const c = validateValuation(o.cote);
		if (typeof c === 'string') return c;
		out.cote = c;
	}
	if (o.coteAuto !== undefined && o.coteAuto !== null) {
		if (typeof o.coteAuto !== 'boolean') return 'coteAuto doit valoir true ou false';
		out.coteAuto = o.coteAuto;
	}
	if (o.coteHistorique !== undefined) {
		if (!Array.isArray(o.coteHistorique) || o.coteHistorique.length > 60) return 'historique de cote invalide';
		const hist: { date: string; valeur: number }[] = [];
		for (const h of o.coteHistorique as unknown[]) {
			const x = (h ?? {}) as Record<string, unknown>;
			const d = validDate(x.date);
			const v = parseAmount(x.valeur);
			if (!d || v === null) return 'historique de cote invalide';
			hist.push({ date: d, valeur: v });
		}
		if (hist.length) out.coteHistorique = hist.sort((a, b) => a.date.localeCompare(b.date));
	}
	return out;
}

/**
 * Raw input → valid asset (without id), or the refusal reason. `txKeys`:
 * existing operation keys (unknown keys are refused). Accepts the former
 * `category` field (assets saved before vehicles existed).
 */
export function validateAsset(raw: unknown, ctx: { txKeys?: ReadonlySet<string> } = {}): AssetInput | string {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'bien illisible';
	const o = raw as Record<string, unknown>;
	const name = typeof o.name === 'string' ? o.name.trim().replace(/\s+/g, ' ') : '';
	if (!name || name.length > 80) return 'nom du bien manquant (80 caractères au plus)';
	const type = o.type ?? o.category;
	if (!ASSET_TYPES.some((c) => c.id === type)) return `type de bien inconnu « ${String(type)} » (vehicule, instrument, hifi ou autre)`;
	const date = validDate(o.purchaseDate);
	if (!date) return 'date d’achat invalide (AAAA-MM-JJ)';
	const purchasePrice = parseAmount(o.purchasePrice);
	if (purchasePrice === null) return 'prix payé invalide';
	let estimatedValue: number | undefined;
	if (!isEmpty(o.estimatedValue)) {
		const v = parseAmount(o.estimatedValue);
		if (v === null) return 'valeur estimée invalide';
		estimatedValue = v;
	}
	let valueDate: string | undefined;
	if (!isEmpty(o.valueDate)) {
		const d = validDate(o.valueDate);
		if (!d) return 'date de l’estimation invalide (AAAA-MM-JJ)';
		valueDate = d;
	}
	let valueSource: ValueSource | undefined;
	if (!isEmpty(o.valueSource)) {
		if (!VALUE_SOURCES.some((x) => x.id === o.valueSource)) return `source de la valeur inconnue « ${String(o.valueSource)} »`;
		valueSource = o.valueSource as ValueSource;
	}
	if (o.valueConfirmed !== undefined && o.valueConfirmed !== null && typeof o.valueConfirmed !== 'boolean') return 'valueConfirmed doit valoir true ou false';
	if (o.linkedTxKeys !== undefined && !Array.isArray(o.linkedTxKeys)) return 'linkedTxKeys doit être une liste';
	const linkedTxKeys = [...new Set(((o.linkedTxKeys as unknown[] | undefined) ?? []).filter((k): k is string => typeof k === 'string' && k !== ''))];
	if (ctx.txKeys) {
		const unknownKeys = linkedTxKeys.filter((k) => !ctx.txKeys!.has(k));
		if (unknownKeys.length) return `${unknownKeys.length} opération(s) rattachée(s) introuvable(s)`;
	}
	if (o.note !== undefined && (typeof o.note !== 'string' || o.note.length > 500)) return 'note invalide (500 caractères au plus)';
	const note = typeof o.note === 'string' ? o.note.trim() : '';
	let vehicle: Vehicle | undefined;
	if (type === 'vehicule') {
		const v = validateVehicle(o.vehicle);
		if (typeof v === 'string') return v;
		vehicle = v;
	} else if (!isEmpty(o.vehicle)) {
		return 'champs véhicule réservés au type « vehicule »';
	}
	return {
		type: type as AssetType,
		name,
		purchaseDate: date,
		purchasePrice,
		...(estimatedValue !== undefined ? { estimatedValue } : {}),
		...(valueDate ? { valueDate } : {}),
		...(estimatedValue !== undefined && valueSource ? { valueSource } : {}),
		...(estimatedValue !== undefined && o.valueConfirmed === true ? { valueConfirmed: true } : {}),
		linkedTxKeys,
		...(note ? { note } : {}),
		...(vehicle ? { vehicle } : {})
	};
}

/** Value used for an asset: the estimate, otherwise the price paid. */
export const assetValue = (b: Asset): number => b.estimatedValue ?? b.purchasePrice;

/**
 * Origin of the retained value; values saved before sources existed count as an AI estimate when
 * they equal the latest AI private-sale price, otherwise as typed by the user. null without a value.
 */
export function valueSourceOf(b: Asset): ValueSource | null {
	if (b.estimatedValue === undefined) return null;
	if (b.valueSource) return b.valueSource;
	const c = b.vehicle?.cote;
	return c?.auto && c.particulier === b.estimatedValue ? 'ia' : 'saisie';
}

/**
 * Retained value still to confirm by the user: only vehicles, whose value used to be overwritten
 * by the AI search (other assets were always typed by hand), and only while `confirmation` (Voiture
 * option) is on.
 */
export function valueNeedsConfirmation(b: Asset, confirmation = true): boolean {
	return confirmation && b.type === 'vehicule' && b.estimatedValue !== undefined && b.valueConfirmed !== true;
}

/** Short wording of a value source (« offre de reprise », « estimation IA »…). */
export function shortValueSource(source: ValueSource | null): string {
	return VALUE_SOURCES.find((x) => x.id === source)?.court ?? 'valeur saisie';
}

/** Totals: paid, estimated (price paid for assets without an estimate), count without an estimate. */
export function assetTotals(assets: readonly Asset[]): { paye: number; estime: number; sansEstimation: number } {
	const r2 = (n: number) => Math.round(n * 100) / 100;
	return {
		paye: r2(assets.reduce((s, b) => s + b.purchasePrice, 0)),
		estime: r2(assets.reduce((s, b) => s + assetValue(b), 0)),
		sansEstimation: assets.filter((b) => b.estimatedValue === undefined).length
	};
}
