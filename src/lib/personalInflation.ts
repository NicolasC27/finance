import type { CategoryId } from './types';
import { sectorInflation, SECTORS, type Sector } from './inflation';

/**
 * Personal inflation — pure module: the inflation of each INSEE main item
 * weighted by YOUR spending (if you mostly spend on energy, your inflation
 * follows energy), and your spending per item compared with prices.
 */

/** INSEE main item, or "ensemble" (average inflation) when the spending is mixed. */
export type PriceItem = Sector | 'ensemble';

export const PRICE_ITEM_LABELS: Readonly<Record<PriceItem, string>> = { ...SECTORS, ensemble: 'Divers (inflation moyenne)' };

/**
 * Item of each subcategory; null = not consumption, excluded from the
 * computation (loan payments, vehicle purchase, loans to relatives, taxes) —
 * as in the INSEE index.
 */
export const PRICE_ITEM_BY_SUBCATEGORY: Readonly<Record<string, PriceItem | null>> = {
	courses: 'alimentation',
	restaurants: 'services',
	'petits-commercants': 'alimentation',
	'loyer-charges': 'services',
	'assurance-habitat': 'services',
	'travaux-equipement': 'manufactures',
	'electricite-gaz': 'energie',
	eau: 'services',
	'transports-commun': 'services',
	'vtc-taxi': 'services',
	voyages: 'services',
	'achat-vehicule': null,
	'credit-auto': null,
	'assurance-auto': 'services',
	'entretien-auto': 'services',
	carburant: 'energie',
	'peages-parkings': 'services',
	'equipement-auto': 'manufactures',
	'controle-technique': 'services',
	telecom: 'services',
	streaming: 'services',
	logiciels: 'services',
	ia: 'services',
	shopping: 'manufactures',
	'high-tech': 'manufactures',
	sport: 'services',
	'culture-sorties': 'services',
	'bricolage-jardin': 'manufactures',
	'musique-cours': 'services',
	cadeaux: 'manufactures',
	pharmacie: 'manufactures',
	soins: 'services',
	mutuelle: 'services',
	hebergement: 'services',
	vols: 'services',
	'vac-alimentation': 'alimentation',
	'vac-loisirs': 'services',
	'vac-transport': 'services',
	'sur-place': 'ensemble',
	'frais-bancaires': 'services',
	'cheques-virements': 'ensemble',
	avances: null,
	credits: null,
	'impots-taxes': null
};

/** Item of a category when the subcategory is unknown. */
export const PRICE_ITEM_BY_CATEGORY: Readonly<Partial<Record<CategoryId, PriceItem | null>>> = {
	alimentation: 'alimentation',
	logement: 'services',
	energie: 'energie',
	transport: 'services',
	voiture: 'ensemble',
	abonnements: 'services',
	loisirs: 'ensemble',
	sante: 'services',
	vacances: 'services',
	impots: null,
	autre: 'ensemble'
};

/** INSEE item of an expense (null: not consumption). */
export function priceItemOf(categoryId: CategoryId, subId?: string | null): PriceItem | null {
	if (subId && subId in PRICE_ITEM_BY_SUBCATEGORY) return PRICE_ITEM_BY_SUBCATEGORY[subId]!;
	return PRICE_ITEM_BY_CATEGORY[categoryId] ?? null;
}

export interface PriceItemShare {
	poste: PriceItem;
	montant: number;
	/** Share of your spending (0-1). */
	part: number;
	inflation: number;
}

export interface PersonalInflation {
	/** Your inflation: item inflation weighted by your spending (%). */
	taux: number;
	/** Official inflation of the year (%). */
	officielle: number;
	postes: PriceItemShare[];
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Your inflation for a year; null when the year is not covered or has no spending. */
export function personalInflation(spending: ReadonlyMap<PriceItem, number>, year: number): PersonalInflation | null {
	const official = sectorInflation(year, 'ensemble');
	if (official === null || sectorInflation(year, 'alimentation') === null) return null;
	const rows = [...spending].filter(([, m]) => m > 0);
	const total = rows.reduce((s, [, m]) => s + m, 0);
	if (total <= 0) return null;
	const items = rows
		.map(([item, amount]) => ({ poste: item, montant: Math.round(amount), part: amount / total, inflation: sectorInflation(year, item)! }))
		.sort((a, b) => b.montant - a.montant);
	return { taux: r1(items.reduce((s, p) => s + p.part * p.inflation, 0)), officielle: official, postes: items };
}

export interface PriceItemRow extends PriceItemShare {
	/** Your spending over the previous period (same length). */
	avant: number;
	/** Change of your spending (%). */
	variation: number | null;
	/** Price-adjusted change (%): > 0 = you buy more of it (or pricier than average). */
	volume: number | null;
}

/**
 * Items of the recent period (shares) compared with the previous one and with
 * the prices of year `year`. `comparables`: recent spending of the months
 * whose same month of the previous year is known (otherwise the whole
 * period) — a history starting in April does not suggest +90 % spending.
 * Small amounts (< 100 €) or an item missing on one side give no meaningful
 * change.
 */
export function comparePriceItems(recent: ReadonlyMap<PriceItem, number>, previous: ReadonlyMap<PriceItem, number>, year: number, comparables: ReadonlyMap<PriceItem, number> = recent): PriceItemRow[] {
	const personal = personalInflation(recent, year);
	if (!personal) return [];
	return personal.postes.map((p) => {
		const before = Math.round(previous.get(p.poste) ?? 0);
		const comp = comparables.get(p.poste) ?? 0;
		const variation = before >= 100 && comp > 0 ? r1((comp / before - 1) * 100) : null;
		const volume = variation === null ? null : r1(((1 + variation / 100) / (1 + p.inflation / 100) - 1) * 100);
		return { ...p, avant: before, variation, volume };
	});
}

export interface CategorySpend {
	categoryId: CategoryId;
	poste: PriceItem;
	montant: number;
}

/**
 * Inflation specific to each budget category: the items of its spending
 * (e.g. Voiture = fuel + insurance + tolls), weighted. A category without
 * spending uses its default item. Used to index the envelopes "by item".
 */
export function inflationByCategory(spending: readonly CategorySpend[], year: number): Map<CategoryId, number> {
	const byCat = new Map<CategoryId, Map<PriceItem, number>>();
	for (const d of spending) {
		if (d.montant <= 0) continue;
		const m = byCat.get(d.categoryId) ?? new Map<PriceItem, number>();
		m.set(d.poste, (m.get(d.poste) ?? 0) + d.montant);
		byCat.set(d.categoryId, m);
	}
	const out = new Map<CategoryId, number>();
	for (const [cat, item] of Object.entries(PRICE_ITEM_BY_CATEGORY) as [CategoryId, PriceItem | null][]) {
		const personal = byCat.has(cat) ? personalInflation(byCat.get(cat)!, year) : null;
		const fallback = item ? sectorInflation(year, item) : null;
		const rate = personal?.taux ?? fallback;
		if (rate !== null) out.set(cat, rate);
	}
	return out;
}
