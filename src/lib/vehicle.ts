import { valueSourceOf, valueNeedsConfirmation, type Asset, type AssetInput, type VehicleValuation, type KmReading, type ValueSource } from './assets';
import type { Transaction } from './types';

/**
 * Vehicle sheet: pure module, testable with tsx. Odometer curve, km per year, monthly cost
 * (operations of the Voiture category, plus the loss of value when the option counts it) and
 * upcoming deadlines (roadworthiness test, mileage milestones, warranty).
 */

/** Operation of the Voiture category, already classified: spending > 0, refund < 0. */
export interface CarExpense {
	date: string;
	montant: number;
	sub: string | null;
	/** Operation key (txKey): spots the payments attached to the asset. */
	key?: string;
}

export interface KmPoint {
	date: string;
	km: number;
	source: KmReading['source'] | 'achat';
}

const DAY_MS = 86_400_000;
const AVG_MONTH_DAYS = 30.4375;
const r2 = (n: number) => Math.round(n * 100) / 100;
const toMs = (d: string) => Date.parse(`${d}T00:00:00Z`);
const daysBetween = (a: string, b: string) => (toMs(b) - toMs(a)) / DAY_MS;
const addDays = (d: string, n: number) => new Date(toMs(d) + Math.round(n) * DAY_MS).toISOString().slice(0, 10);
const addYears = (d: string, n: number) => `${Number(d.slice(0, 4)) + n}${d.slice(4)}`.replace(/-02-29$/, '-02-28');

/** Curve points: odometer at purchase (if known), then the readings. */
export function kmPoints(b: Asset): KmPoint[] {
	const v = b.vehicle;
	if (!v) return [];
	const pts: KmPoint[] = [...(v.kmAtPurchase !== undefined ? [{ date: b.purchaseDate, km: v.kmAtPurchase, source: 'achat' as const }] : []), ...v.kmLog];
	return pts.sort((a, b2) => a.date.localeCompare(b2.date) || a.km - b2.km);
}

/** Average pace in km per day between the first and the last point (null: less than a month of history). */
export function kmPerDay(points: readonly KmPoint[]): number | null {
	if (points.length < 2) return null;
	const a = points[0]!;
	const z = points[points.length - 1]!;
	const d = daysBetween(a.date, z.date);
	return d >= 30 && z.km > a.km ? (z.km - a.km) / d : null;
}

/** Odometer at a date: interpolated between two readings, extended at the average pace after the last one. */
export function kmAt(points: readonly KmPoint[], date: string): number | null {
	if (!points.length) return null;
	const first = points[0]!;
	if (date <= first.date) return first.km;
	for (let i = 1; i < points.length; i++) {
		const p0 = points[i - 1]!;
		const p1 = points[i]!;
		if (date <= p1.date) {
			const d = daysBetween(p0.date, p1.date);
			return d > 0 ? Math.round(p0.km + ((p1.km - p0.km) * daysBetween(p0.date, date)) / d) : p1.km;
		}
	}
	const last = points[points.length - 1]!;
	const pace = kmPerDay(points);
	return pace ? Math.round(last.km + pace * daysBetween(last.date, date)) : last.km;
}

export interface KmYear {
	annee: number;
	km: number;
	/** Year started after the purchase or not finished. */
	partiel: boolean;
	/** Part of the year is beyond the last reading (extended at the average pace). */
	estime: boolean;
}

/** km per year: average since the first point, then per calendar year (from purchase to today). */
export function kmPerYear(points: readonly KmPoint[], today: string): { moyenne: number | null; annees: KmYear[] } {
	const pace = kmPerDay(points);
	if (!points.length) return { moyenne: null, annees: [] };
	const start = points[0]!.date;
	const lastDate = points[points.length - 1]!.date;
	const years: KmYear[] = [];
	for (let year = Number(start.slice(0, 4)); year <= Number(today.slice(0, 4)); year++) {
		const from = `${year}-01-01` < start ? start : `${year}-01-01`;
		const to = `${year + 1}-01-01` > today ? today : `${year + 1}-01-01`;
		const k0 = kmAt(points, from);
		const k1 = kmAt(points, to);
		if (k0 === null || k1 === null || to <= from) continue;
		years.push({ annee: year, km: Math.max(0, k1 - k0), partiel: from > `${year}-01-01` || to < `${year + 1}-01-01`, estime: to > lastDate });
	}
	return { moyenne: pace ? Math.round(pace * 365.25) : null, annees: years };
}

/* ---------- Monthly cost ---------- */

export type CostItem = 'amortissement' | 'credit' | 'assurance' | 'entretien' | 'carburant' | 'peages' | 'equipement' | 'autres';

export interface CostLine {
	poste: CostItem;
	label: string;
	parMois: number;
	total: number;
}

const COST_ITEM_BY_SUB: Record<string, CostItem> = {
	'credit-auto': 'credit',
	'assurance-auto': 'assurance',
	'entretien-auto': 'entretien',
	'controle-technique': 'entretien',
	carburant: 'carburant',
	'peages-parkings': 'peages',
	'equipement-auto': 'equipement'
};

const LABELS: Record<CostItem, string> = {
	amortissement: 'Perte de valeur',
	credit: 'Crédit',
	assurance: 'Assurance',
	entretien: 'Entretien & contrôle technique',
	carburant: 'Carburant',
	peages: 'Péages & parkings',
	equipement: 'Équipement',
	autres: 'Autres dépenses voiture'
};

/** Default depreciation when no estimate is entered: −15 % per year. */
export const ANNUAL_DEPRECIATION = 0.15;

/**
 * Vehicle value at a date: the retained value (confirmed or still to confirm), else the theoretical
 * estimate (`depreciation` per year since purchase, −15 % by default, `parDefaut`). An AI proposal never
 * counts until validated.
 */
export function vehicleValue(b: Asset, date: string, depreciation = ANNUAL_DEPRECIATION): { valeur: number; parDefaut: boolean } {
	if (b.estimatedValue !== undefined) return { valeur: b.estimatedValue, parDefaut: false };
	const years = Math.max(0, daysBetween(b.purchaseDate, date) / 365.25);
	return { valeur: Math.round(b.purchasePrice * (1 - depreciation) ** years), parDefaut: true };
}

/** Age after which a retained value is worth re-checking (« à revalider »). */
export const REVALIDATE_MONTHS = 6;

/** Settings of the Voiture module (its options panel). */
export interface CarOptions {
	/** Ask the user to confirm the retained value (« à confirmer » chip and Confirmer button). */
	confirmValue: boolean;
	/** Theoretical yearly depreciation used while no value is retained (0.15 = −15 %/year). */
	depreciation: number;
	/** Months after which a retained value shows « à revalider ». */
	revalidateMonths: number;
	/** Count the loss of value in the monthly cost (then only the loan interest counts). */
	countValueLoss: boolean;
}

/**
 * Defaults: no confirmation asked, −15 %/year, 6 months, and no loss of value in the monthly cost,
 * which is then the money spent on the car (the user chose both on 2026-10-04).
 */
export const DEFAULT_CAR_OPTIONS: CarOptions = { confirmValue: false, depreciation: ANNUAL_DEPRECIATION, revalidateMonths: REVALIDATE_MONTHS, countValueLoss: false };

/** Stored options, each field checked and bounded (depreciation 0–60 %, reminder 1–60 months), defaults otherwise. */
export function sanitizeCarOptions(raw: unknown): CarOptions {
	const o = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Partial<Record<keyof CarOptions, unknown>>;
	const bounded = (v: unknown, min: number, max: number, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback);
	return {
		confirmValue: typeof o.confirmValue === 'boolean' ? o.confirmValue : DEFAULT_CAR_OPTIONS.confirmValue,
		depreciation: bounded(o.depreciation, 0, 0.6, DEFAULT_CAR_OPTIONS.depreciation),
		revalidateMonths: Math.round(bounded(o.revalidateMonths, 1, 60, DEFAULT_CAR_OPTIONS.revalidateMonths)),
		countValueLoss: typeof o.countValueLoss === 'boolean' ? o.countValueLoss : DEFAULT_CAR_OPTIONS.countValueLoss
	};
}

/** Retained value of a vehicle and where it stands, for the sheet, the assets card and the AI export. */
export interface RetainedValue {
	/** Value the computations use: the retained value, else the theoretical one. */
	valeur: number;
	/** No retained value: theoretical depreciation since purchase. */
	theorique: boolean;
	/** Origin of the retained value (null when theoretical). */
	source: ValueSource | null;
	/** Date of the retained value (null when theoretical or unknown). */
	date: string | null;
	/** Confirmed by the user; a theoretical value, or any value while confirmation is off, is never « à confirmer ». */
	confirmee: boolean;
	/** The confirmation is asked (Voiture option): only then show a « validée » / « à confirmer » status. */
	tracked: boolean;
	/** Retained value older than the reminder delay (`revalidateMonths` option, 6 months by default). */
	aRevalider: boolean;
}

/**
 * Retained value of a vehicle at `today`, with its origin, status and age. `confirmation`
 * (Voiture option, on by default here so the computation stays complete) asks the user to confirm
 * the value; `depreciation` and `revalidateMonths` follow the module options.
 */
export function retainedValue(
	b: Asset,
	today: string,
	options: { confirmation?: boolean; depreciation?: number; revalidateMonths?: number } = {}
): RetainedValue {
	const confirmation = options.confirmation ?? true;
	const { valeur: value, parDefaut: isDefault } = vehicleValue(b, today, options.depreciation);
	if (isDefault) return { valeur: value, theorique: true, source: null, date: null, confirmee: true, tracked: confirmation, aRevalider: false };
	const date = b.valueDate ?? null;
	return {
		valeur: value,
		theorique: false,
		source: valueSourceOf(b),
		date,
		confirmee: !valueNeedsConfirmation(b, confirmation),
		tracked: confirmation,
		aRevalider: date !== null && daysBetween(date, today) >= (options.revalidateMonths ?? REVALIDATE_MONTHS) * AVG_MONTH_DAYS
	};
}

/** AI valuation waiting for the user's decision: a searched private-sale price, neither validated nor ignored. */
export function pendingProposal(b: Asset): VehicleValuation | null {
	const c = b.vehicle?.cote;
	return c?.auto && !c.decision && c.particulier !== undefined ? c : null;
}

/** Patch that retains a value given by the user (amount, source), confirmed, dated today. */
export function patchRetainValue(amount: number, source: ValueSource, today: string): Partial<AssetInput> {
	return { estimatedValue: Math.round(amount * 100) / 100, valueDate: today, valueSource: source, valueConfirmed: true };
}

/** Patch that confirms the current retained value as it is (null without a retained value). */
export function patchConfirmValue(b: Asset): Partial<AssetInput> | null {
	const source = valueSourceOf(b);
	return source ? { valueSource: source, valueConfirmed: true } : null;
}

/** Patch that makes the pending AI proposal the retained value (source « ia », dated today). */
export function patchAcceptProposal(b: Asset, today: string): Partial<AssetInput> | null {
	const c = pendingProposal(b);
	if (!c || !b.vehicle) return null;
	return { ...patchRetainValue(c.particulier!, 'ia', today), vehicle: { ...b.vehicle, cote: { ...c, decision: 'validee' } } };
}

/** Patch that sets the pending AI proposal aside: the retained value stays, the ads stay visible. */
export function patchIgnoreProposal(b: Asset): Partial<AssetInput> | null {
	const c = pendingProposal(b);
	if (!c || !b.vehicle) return null;
	return { vehicle: { ...b.vehicle, cote: { ...c, decision: 'ignoree' } } };
}

/** Cost of a vehicle since its purchase (Voiture sheet, AI export). */
export interface VehicleCost {
	lignes: CostLine[];
	/** Real cost per month: sum of the lines. */
	total: number;
	/** Months owned, to the tenth. */
	mois: number;
	amortissementParDefaut: boolean;
	/** Is the loss of value one of the lines (Voiture option)? Otherwise the cost is the money spent. */
	countsLoss: boolean;
	/** Loss of value, counted or not: price paid, value used, months it is spread over (until the date of the estimate), per month. */
	perte: { prix: number; valeur: number; mois: number; parMois: number };
	/** Money spent from the account on the car, per month (full payments, purchase excluded): what the budget sees. */
	sortiesParMois: number;
	/** 'Crédit auto' payments since purchase and their interest share (null: unknown share, payments counted in full). */
	credit: { mensualites: number; interets: number | null } | null;
}

/**
 * Monthly cost since purchase: each item of the Voiture category (total since purchase ÷ months
 * owned). The purchase itself never counts: 'Achat du véhicule' subcategory, or an operation attached
 * to the asset, at most 45 days from the purchase and at least 5 % of the price (deposit, balance).
 * Every Voiture operation counts for this vehicle.
 * By default the cost is the money spent on the car: full loan payments, no loss of value.
 * With `countLoss` (Voiture option), the loss of value (price paid − value, spread over the ownership
 * period) is the first line, and with `partInterets` (interest share of the payments, known when the
 * loan is tracked) only the interest counts, because the repaid capital pays the purchase price,
 * already in the loss of value. Without that share, payments count in full.
 */
export function monthlyCost(
	b: Asset,
	expenses: readonly CarExpense[],
	today: string,
	options: { partInterets?: number | null; depreciation?: number; countLoss?: boolean } = {}
): VehicleCost {
	const months = Math.max(1, daysBetween(b.purchaseDate, today) / AVG_MONTH_DAYS);
	const linked = new Set(b.linkedTxKeys);
	const isPurchase = (d: CarExpense) => d.sub === 'achat-vehicule' || (!!d.key && linked.has(d.key) && Math.abs(daysBetween(b.purchaseDate, d.date)) <= 45 && d.montant >= 0.05 * b.purchasePrice);
	const totals = new Map<CostItem, number>();
	let outflows = 0;
	for (const d of expenses) {
		if (d.date < b.purchaseDate || isPurchase(d)) continue;
		const item = COST_ITEM_BY_SUB[d.sub ?? ''] ?? 'autres';
		totals.set(item, (totals.get(item) ?? 0) + d.montant);
		outflows += d.montant;
	}
	const end = b.estimatedValue !== undefined && b.valueDate ? b.valueDate : today;
	const { valeur: value, parDefaut: isDefault } = vehicleValue(b, today, options.depreciation);
	const valueMonths = Math.max(1, daysBetween(b.purchaseDate, end) / AVG_MONTH_DAYS);
	const loss = Math.max(0, b.purchasePrice - value);
	const part = options.partInterets ?? null;
	const countLoss = options.countLoss ?? false;
	const lossPerMonth = r2(loss / valueMonths);
	const lines: CostLine[] = countLoss ? [{ poste: 'amortissement', label: LABELS.amortissement, parMois: lossPerMonth, total: r2(loss) }] : [];
	for (const item of ['credit', 'assurance', 'entretien', 'carburant', 'peages', 'equipement', 'autres'] as const) {
		const t = totals.get(item);
		if (!t) continue;
		if (item === 'credit' && countLoss && part !== null) lines.push({ poste: item, label: 'Intérêts du crédit', parMois: r2((t * part) / months), total: r2(t * part) });
		else if (item === 'credit') lines.push({ poste: item, label: countLoss ? 'Crédit (mensualités entières)' : 'Mensualités du crédit', parMois: r2(t / months), total: r2(t) });
		else lines.push({ poste: item, label: LABELS[item], parMois: r2(t / months), total: r2(t) });
	}
	const loanPayments = totals.get('credit');
	return {
		lignes: lines,
		total: r2(lines.reduce((s, l) => s + l.parMois, 0)),
		mois: Math.round(months * 10) / 10,
		amortissementParDefaut: isDefault,
		countsLoss: countLoss,
		perte: { prix: b.purchasePrice, valeur: value, mois: Math.round(valueMonths * 10) / 10, parMois: lossPerMonth },
		sortiesParMois: r2(outflows / months),
		credit: loanPayments ? { mensualites: r2(loanPayments), interets: part !== null ? r2(loanPayments * part) : null } : null
	};
}

/* ---------- Upcoming deadlines ---------- */

export interface Milestone {
	id: 'ct' | 'km-100000' | 'km-150000' | 'garantie' | 'releve';
	label: string;
	date: string | null;
	detail: string;
	etat: 'passee' | 'bientot' | 'plus-tard' | 'a-renseigner';
}

export const KM_MILESTONES = [100_000, 150_000] as const;

function milestoneStatus(date: string | null, today: string): Milestone['etat'] {
	if (!date) return 'a-renseigner';
	if (date < today) return 'passee';
	return daysBetween(today, date) <= 90 ? 'bientot' : 'plus-tard';
}

const dateFr = (d: string) => d.split('-').reverse().join('/');
const kmFr = (n: number) => `${Math.round(n).toLocaleString('fr-FR')} km`;

/**
 * Roadworthiness test (last test + 2 years; otherwise 4 years after first registration), 100 000 /
 * 150 000 km milestones at the current pace, end of warranty.
 */
export function nextMilestones(b: Asset, expenses: readonly CarExpense[], today: string, estimatedKm?: number): Milestone[] {
	const v = b.vehicle;
	if (!v) return [];
	const out: Milestone[] = [];
	const lastInspection = [...expenses.filter((d) => d.sub === 'controle-technique' && d.montant > 0).map((d) => d.date), ...v.kmLog.filter((r) => r.source === 'ct').map((r) => r.date)].sort().pop();
	if (lastInspection) {
		const d = addYears(lastInspection, 2);
		out.push({ id: 'ct', label: 'Contrôle technique', date: d, detail: `dernier le ${dateFr(lastInspection)} : tous les 2 ans`, etat: milestoneStatus(d, today) });
	} else if (v.firstRegistration) {
		const d = addYears(v.firstRegistration, 4);
		out.push({ id: 'ct', label: 'Contrôle technique', date: d, detail: `premier CT : 4 ans après la mise en circulation (${dateFr(v.firstRegistration)})`, etat: milestoneStatus(d, today) });
	} else {
		out.push({ id: 'ct', label: 'Contrôle technique', date: null, detail: 'ajoute la date de 1re mise en circulation ou un CT', etat: 'a-renseigner' });
	}
	const pts = kmPoints(b);
	const pace = kmPerDay(pts);
	const kmNow = estimatedKm ?? kmAt(pts, today);
	if (kmNow === null) {
		out.push({ id: 'releve', label: 'Kilométrage', date: null, detail: 'ajoute un relevé du compteur', etat: 'a-renseigner' });
	} else {
		for (const milestone of KM_MILESTONES) {
			if (kmNow >= milestone) continue;
			const d = pace ? addDays(today, (milestone - kmNow) / pace) : null;
			out.push({
				id: `km-${milestone}`,
				label: kmFr(milestone),
				date: d,
				detail: pace ? `au rythme de ${kmFr(pace * 365.25)}/an (≈ ${kmFr(kmNow)} aujourd'hui)` : `≈ ${kmFr(kmNow)} aujourd'hui ; 2 relevés espacés d'un mois pour estimer la date`,
				etat: d ? milestoneStatus(d, today) : 'a-renseigner'
			});
		}
	}
	out.push(
		v.warrantyEnd
			? { id: 'garantie', label: 'Fin de garantie', date: v.warrantyEnd, detail: 'garantie constructeur', etat: milestoneStatus(v.warrantyEnd, today) }
			: { id: 'garantie', label: 'Fin de garantie', date: null, detail: 'date à renseigner (contrat ou carnet d’entretien)', etat: 'a-renseigner' }
	);
	return out.sort((a, c) => (a.date ?? '9999').localeCompare(c.date ?? '9999'));
}

/* ---------- Body colour (illustration) ---------- */

/** Suggested shades (common factory colours); any #rrggbb colour is still possible. */
export const BODY_COLORS: readonly { id: string; label: string; hex: string }[] = [
	{ id: 'rouge', label: 'Rouge vif', hex: '#c8102e' },
	{ id: 'gris-clair', label: 'Gris clair', hex: '#8b9096' },
	{ id: 'gris-fonce', label: 'Gris foncé', hex: '#6c767c' },
	{ id: 'blanc', label: 'Blanc nacré', hex: '#e9ebe8' },
	{ id: 'noir', label: 'Noir profond', hex: '#1f2124' },
	{ id: 'bleu', label: 'Bleu nuit', hex: '#1f3554' },
	{ id: 'sable', label: 'Beige sable', hex: '#b9a88c' }
];

function hexToHsl(hex: string): [number, number, number] {
	const n = parseInt(hex.slice(1), 16);
	const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255) as [number, number, number];
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const l = (max + min) / 2;
	if (max === min) return [0, 0, l];
	const d = max - min;
	const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
	const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
	return [h * 60, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
	const k = (n: number) => (n + h / 30) % 12;
	const a = s * Math.min(l, 1 - l);
	const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
	return `#${[f(0), f(8), f(4)].map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('')}`;
}

/** 4 shades of the paint gradient (highlight, base, shadow, sill) for a colour. */
export function bodyPalette(hex: string): [string, string, string, string] {
	if (!/^#[0-9a-f]{6}$/i.test(hex)) hex = '#c8102e';
	const [h, s, l] = hexToHsl(hex);
	const isLight = l > 0.8;
	return [hslToHex(h, s, Math.min(0.97, l + (isLight ? 0.06 : 0.17))), hex, hslToHex(h, s, Math.max(0.05, l - (isLight ? 0.16 : 0.2))), hslToHex(h, s, Math.max(0.03, l - (isLight ? 0.42 : 0.34)))];
}

/* ---------- Registration plate: approximate date (SIV) ---------- */

/**
 * Start of allocation of each SIV series (first two letters), from EA to HM (source:
 * francoplaque.fr). Plates are allocated in order, nationwide: the series dates the first
 * registration IN FRANCE.
 */
const SERIES_SIV: readonly [string, string][] = [
	['EA', '2016-02-26'], ['EB', '2016-04-01'], ['EC', '2016-05-09'], ['ED', '2016-06-13'], ['EE', '2016-07-19'], ['EF', '2016-09-05'], ['EG', '2016-10-14'], ['EH', '2016-11-25'],
	['EJ', '2016-12-30'], ['EK', '2017-02-13'], ['EL', '2017-03-23'], ['EM', '2017-04-27'], ['EN', '2017-06-02'], ['EP', '2017-07-06'], ['EQ', '2017-08-23'], ['ER', '2017-10-03'],
	['ES', '2017-11-15'], ['ET', '2017-12-27'], ['EV', '2018-02-13'], ['EW', '2018-03-23'], ['EX', '2018-04-28'], ['EY', '2018-06-08'], ['EZ', '2018-07-12'], ['FA', '2018-08-29'],
	['FB', '2018-10-11'], ['FC', '2018-11-24'], ['FD', '2019-01-08'], ['FE', '2019-02-21'], ['FF', '2019-03-28'], ['FG', '2019-05-07'], ['FH', '2019-06-17'], ['FJ', '2019-07-22'],
	['FK', '2019-09-10'], ['FL', '2019-10-22'], ['FM', '2019-11-29'], ['FN', '2020-01-13'], ['FP', '2020-02-26'], ['FQ', '2020-05-26'], ['FR', '2020-06-29'], ['FS', '2020-08-11'],
	['FT', '2020-09-28'], ['FV', '2020-11-09'], ['FW', '2020-12-21'], ['FX', '2021-02-07'], ['FY', '2021-03-22'], ['FZ', '2021-05-02'], ['GA', '2021-06-15'], ['GB', '2021-07-29'],
	['GC', '2021-09-27'], ['GD', '2021-11-18'], ['GE', '2022-01-06'], ['GF', '2022-03-03'], ['GG', '2022-04-27'], ['GH', '2022-06-20'], ['GJ', '2022-08-17'], ['GK', '2022-10-14'],
	['GL', '2022-12-08'], ['GM', '2023-02-03'], ['GN', '2023-03-29'], ['GP', '2023-05-19'], ['GQ', '2023-07-02'], ['GR', '2023-09-01'], ['GS', '2023-10-25'], ['GT', '2023-12-13'],
	['GV', '2024-02-06'], ['GW', '2024-03-27'], ['GX', '2024-05-21'], ['GY', '2024-07-01'], ['GZ', '2024-09-04'], ['HA', '2024-10-31'], ['HB', '2024-12-21'], ['HC', '2025-02-20'],
	['HD', '2025-04-12'], ['HE', '2025-06-11'], ['HF', '2025-08-01'], ['HG', '2025-10-08'], ['HH', '2025-12-03'], ['HJ', '2026-02-03'], ['HK', '2026-03-31'], ['HL', '2026-05-28'],
	['HM', '2026-07-21']
];
const SIV_LETTERS = 'ABCDEFGHJKLMNPQRSTVWXYZ';

/**
 * Approximate date of first registration in France from a SIV plate ('FN-001-AA' → 13/01/2020):
 * interpolated within the series from the last two letters. null: old format, or series outside
 * the table.
 */
export function plateDate(plate: string): { estimee: string; debut: string; fin?: string } | null {
	const m = /^([A-Z]{2})-(\d{3})-([A-Z]{2})$/.exec(plate);
	if (!m) return null;
	const i = SERIES_SIV.findIndex(([series]) => series === m[1]);
	if (i < 0) return null;
	const start = SERIES_SIV[i]![1];
	const end = SERIES_SIV[i + 1]?.[1];
	if (!end) return { estimee: start, debut: start };
	const pos = (SIV_LETTERS.indexOf(m[3]![0]!) * SIV_LETTERS.length + SIV_LETTERS.indexOf(m[3]![1]!) + Number(m[2]) / 1000) / SIV_LETTERS.length ** 2;
	return { estimee: addDays(start, Math.max(0, Math.min(1, pos)) * daysBetween(start, end)), debut: start, fin: end };
}

/* ---------- Valuation and listing links ---------- */

export interface ValuationLink {
	id: string;
	label: string;
	detail: string;
	url: string;
}

const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/**
 * Links to valuations and comparable listings (same model, same year, close mileage): make = first
 * word of the name, model = the rest. The version refines the search: automatic gearbox ('BVA',
 * 'auto') and power ('180 ch' → 132 kW ± 6).
 */
export function valuationLinks(name: string, year: number, km?: number, version = ''): ValuationLink[] {
	const [make = '', ...rest] = name.trim().split(/\s+/);
	const model = rest.join(' ');
	const M = make.toUpperCase();
	const MOD = model.toUpperCase().replace(/\s+/g, '-');
	const kmMin = km ? Math.max(0, Math.floor((km - 20000) / 5000) * 5000) : undefined;
	const kmMax = km ? Math.ceil((km + 20000) / 5000) * 5000 : undefined;
	const kmRange = (a: string, b: string, sep: string) => (km ? `${sep}${a}${kmMin}${b}${kmMax}` : '');
	const auto = /\b(BVA\d*|EAT\d*|DSG\d*|auto(matique)?)\b/i.test(version);
	const hp = Number(/(\d{2,3})\s?ch\b/i.exec(version)?.[1] ?? 0);
	const kw = hp ? Math.round(hp * 0.7355) : 0;
	const as24Filters = `${auto ? '&gear=A' : ''}${kw ? `&powerfrom=${kw - 6}&powerto=${kw + 6}&powertype=kw` : ''}`;
	const precision = [auto ? 'boîte auto' : '', hp ? `${hp} ch` : ''].filter(Boolean).join(', ');
	const links: ValuationLink[] = [
		{ id: 'largus', label: 'Cote L’argus', detail: 'par modèle ou par plaque, la référence des pros', url: `https://www.largus.fr/cote/voitures-particulieres/${slug(make)}/${slug(model)}.html` },
		{ id: 'autouncle', label: 'AutoUncle', detail: `prix du marché des ${model || 'modèles'} ${year}`, url: `https://www.autouncle.fr/fr/voitures-occasion/${encodeURIComponent(make.charAt(0).toUpperCase() + make.slice(1).toLowerCase())}/${encodeURIComponent(MOD)}/y-${year}` },
		{ id: 'autoscout24', label: 'AutoScout24', detail: `annonces ${year}${km ? `, ${kmMin! / 1000} 000 à ${kmMax! / 1000} 000 km` : ''}${precision ? `, ${precision}` : ''}`, url: `https://www.autoscout24.fr/lst/${slug(make)}/${slug(model)}?fregfrom=${year}&fregto=${year}${kmRange('kmfrom=', '&kmto=', '&')}${as24Filters}` },
		{ id: 'leboncoin', label: 'Leboncoin', detail: `annonces de particuliers${auto ? ', boîte auto' : ''}`, url: `https://www.leboncoin.fr/c/voitures/${auto ? 'gearbox:2+' : ''}u_car_brand:${M}+u_car_model:${M}_${MOD}+regdate:${year}-${year}${kmRange('mileage:', '-', '+')}` },
		{ id: 'largus-annonces', label: 'L’argus Occasion', detail: 'annonces de professionnels', url: `https://occasion.largus.fr/auto/${slug(make)}/${slug(model)}/` },
		{ id: 'histovec', label: 'HistoVec', detail: 'historique officiel gratuit (km aux contrôles, sinistres), avec ta carte grise', url: 'https://histovec.interieur.gouv.fr/histovec/proprietaire' }
	];
	return make && model ? links : links.filter((l) => l.id === 'histovec');
}

/** Price line by mileage (least squares); null under 2 distinct mileages. */
export function priceTrend(ads: readonly { km: number; prix: number }[]): { pente: number; origine: number } | null {
	if (new Set(ads.map((a) => a.km)).size < 2) return null;
	const n = ads.length;
	const mx = ads.reduce((s, a) => s + a.km, 0) / n;
	const my = ads.reduce((s, a) => s + a.prix, 0) / n;
	const slope = ads.reduce((s, a) => s + (a.km - mx) * (a.prix - my), 0) / ads.reduce((s, a) => s + (a.km - mx) ** 2, 0);
	return { pente: slope, origine: my - slope * mx };
}

/* ---------- Estimated mileage between two readings ---------- */

export interface KmEstimate {
	/** Estimated odometer today. */
	km: number;
	/** Last reading (or odometer at purchase). */
	depuis: { date: string; km: number };
	jours: number;
	/** Km added since the last reading, per indicator. */
	composantes: { source: 'rythme' | 'carburant' | 'peages'; km: number; euros?: number }[];
	min: number;
	max: number;
}

/** Default pace without history: the French average (≈ 12 000 km/year). */
export const DEFAULT_KM_PER_YEAR = 12_000;

/**
 * Estimated odometer when the last reading is old: usual pace, plus the fuel and tolls paid since,
 * converted to km with YOUR €/km ratio measured between your readings (it includes what is paid
 * elsewhere), so vacation trips are counted. Weights: pace 50 %, fuel 35 %, tolls 15 % (renormalised
 * over the available indicators); an indicator above 2.5 times the usual pace is dropped (spending
 * for another car…), while few tolls or little fuel stays plausible.
 */
export function estimateKm(points: readonly KmPoint[], expenses: readonly CarExpense[], today: string): KmEstimate | null {
	if (!points.length) return null;
	const first = points[0]!;
	const last = points[points.length - 1]!;
	const days = Math.max(0, daysBetween(last.date, today));
	const pace = kmPerDay(points) ?? DEFAULT_KM_PER_YEAR / 365.25;
	const components: KmEstimate['composantes'] = [{ source: 'rythme', km: pace * days }];
	const periodKm = last.km - first.km;
	const spentBetween = (sub: string, from: string, to: string) => expenses.filter((d) => d.sub === sub && d.date > from && d.date <= to).reduce((s, d) => s + d.montant, 0);
	if (points.length >= 2 && periodKm >= 1000 && daysBetween(first.date, last.date) >= 60) {
		for (const [source, sub] of [['carburant', 'carburant'], ['peages', 'peages-parkings']] as const) {
			const calibration = spentBetween(sub, first.date, last.date);
			if (calibration < 50) continue;
			const euros = spentBetween(sub, last.date, today);
			const indicatorKm = (euros * periodKm) / calibration;
			if (days >= 7 && indicatorKm > pace * days * 2.5 + 500) continue;
			components.push({ source, km: indicatorKm, euros: Math.round(euros * 100) / 100 });
		}
	}
	const WEIGHTS = { rythme: 0.5, carburant: 0.35, peages: 0.15 };
	const totalWeight = components.reduce((s, c) => s + WEIGHTS[c.source], 0);
	const added = components.reduce((s, c) => s + c.km * WEIGHTS[c.source], 0) / totalWeight;
	const kms = components.map((c) => c.km);
	return {
		km: Math.round(last.km + added),
		depuis: { date: last.date, km: last.km },
		jours: Math.round(days),
		composantes: components.map((c) => ({ ...c, km: Math.round(c.km) })),
		min: Math.round(last.km + Math.min(...kms)),
		max: Math.round(last.km + Math.max(...kms))
	};
}

/* ---------- Automations: purchase payments, valuation to refresh ---------- */

/**
 * Payments of a vehicle purchase: 1 to 3 debits between 60 days before and 15 days after the
 * purchase date whose sum matches the price within 3 % (deposit + balance). Operations already
 * attached to an asset are excluded.
 */
export function purchasePayments(b: Asset, txs: readonly Transaction[], keyOf: (t: Transaction) => string, alreadyTaken: ReadonlySet<string> = new Set()): string[] {
	if (b.purchasePrice <= 0) return [];
	const start = addDays(b.purchaseDate, -60);
	const end = addDays(b.purchaseDate, 15);
	const cands = txs
		.filter((t) => t.credit_debit_indicator === 'DBIT' && t.booking_date >= start && t.booking_date <= end && !alreadyTaken.has(keyOf(t)))
		.map((t) => ({ k: keyOf(t), m: Number(t.transaction_amount.amount) }))
		.filter((c) => c.m >= b.purchasePrice * 0.05 && c.m <= b.purchasePrice * 1.03)
		.sort((a, z) => z.m - a.m)
		.slice(0, 12);
	let best: { cles: string[]; ecart: number } | null = null;
	const tryLot = (lot: { k: string; m: number }[]) => {
		const gap = Math.abs(lot.reduce((s, c) => s + c.m, 0) - b.purchasePrice);
		if (gap <= b.purchasePrice * 0.03 && (!best || gap < best.ecart)) best = { cles: lot.map((c) => c.k), ecart: gap };
	};
	for (let i = 0; i < cands.length; i++) {
		tryLot([cands[i]!]);
		for (let j = i + 1; j < cands.length; j++) {
			tryLot([cands[i]!, cands[j]!]);
			for (let k = j + 1; k < cands.length; k++) tryLot([cands[i]!, cands[j]!, cands[k]!]);
		}
	}
	return (best as { cles: string[] } | null)?.cles ?? [];
}

/** Valuation to refresh: missing, or older than `maxDays` (30 by default). */
export function valuationIsStale(valuation: VehicleValuation | undefined, today: string, maxDays = 30): boolean {
	return !valuation || daysBetween(valuation.date, today) >= maxDays;
}

/**
 * Raw answer of the valuation search (AI relay) → clean valuation of the day: plausible, ordered
 * amounts (trade-in ≤ private ≤ dealer), complete listings only; null if unusable.
 */
export function valuationFromSearch(raw: unknown, today: string): VehicleValuation | null {
	if (!raw || typeof raw !== 'object') return null;
	const o = raw as Record<string, unknown>;
	const toPrice = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 300 && v <= 2_000_000 ? Math.round(v) : undefined);
	const dealer = toPrice(o.pro);
	const privateSale = toPrice(o.particulier);
	const tradeIn = toPrice(o.reprise);
	if (privateSale === undefined || (dealer !== undefined && dealer < privateSale) || (tradeIn !== undefined && tradeIn > privateSale)) return null;
	const ads = (Array.isArray(o.annonces) ? o.annonces : [])
		.flatMap((a: unknown) => {
			const x = (a ?? {}) as Record<string, unknown>;
			const label = typeof x.libelle === 'string' ? x.libelle.trim().slice(0, 120) : '';
			const km = typeof x.km === 'number' && x.km >= 0 && x.km < 2_000_000 ? Math.round(x.km) : undefined;
			const p = toPrice(x.prix);
			if (!label || km === undefined || p === undefined) return [];
			const year = typeof x.annee === 'number' && Number.isInteger(x.annee) && x.annee >= 1950 && x.annee <= 2100 ? x.annee : undefined;
			const source = typeof x.source === 'string' && x.source.trim() ? x.source.trim().slice(0, 40) : undefined;
			const url = typeof x.url === 'string' && /^https:\/\/[^\s]{4,500}$/.test(x.url) ? x.url : undefined;
			return [{ libelle: label, km, prix: p, ...(year ? { annee: year } : {}), ...(source ? { source } : {}), ...(url ? { url } : {}) }];
		})
		.slice(0, 20);
	return { date: today, particulier: privateSale, ...(dealer !== undefined ? { pro: dealer } : {}), ...(tradeIn !== undefined ? { reprise: tradeIn } : {}), auto: true, annonces: ads };
}
