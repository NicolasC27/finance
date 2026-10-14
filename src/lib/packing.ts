import type { DailyWeather } from './weather';

/**
 * Packing list of a trip (pure, testable): categories, the templates to start from, the
 * suggestions drawn from the weather, progress, copies from a past trip. Items are stored on
 * the trip (`packing`); the store (trips.svelte.ts) applies the changes.
 */

export type PackCategory = 'papiers' | 'vetements' | 'toilette' | 'sante' | 'tech' | 'divers';

export const PACK_CATEGORIES: readonly { id: PackCategory; label: string }[] = [
	{ id: 'papiers', label: 'Papiers & argent' },
	{ id: 'vetements', label: 'Vêtements' },
	{ id: 'toilette', label: 'Toilette' },
	{ id: 'sante', label: 'Santé' },
	{ id: 'tech', label: 'Tech' },
	{ id: 'divers', label: 'Divers' }
];

export interface PackItem {
	id: string;
	category: PackCategory;
	label: string;
	/** Total quantity to pack (per-traveller items are multiplied when a template is applied). */
	qty: number;
	/** One for the whole group (a charger, a first-aid kit) rather than one per traveller. */
	shared: boolean;
	done: boolean;
	/** Ticked after the trip: it was missing on the spot (lesson for next time). */
	forgot: boolean;
}

export type PackTemplateId = 'base' | 'ville' | 'plage' | 'montagne' | 'rando' | 'bebe' | 'affaires';

/** [category, label, shared?] */
type TemplateLine = readonly [PackCategory, string, boolean?];

export const PACK_TEMPLATES: readonly { id: PackTemplateId; label: string; items: readonly TemplateLine[] }[] = [
	{
		id: 'base',
		label: 'L’essentiel (toujours)',
		items: [
			['papiers', 'Carte d’identité ou passeport'],
			['papiers', 'Carte bancaire + une de secours', true],
			['papiers', 'Billets et réservations hors ligne', true],
			['papiers', 'Carte d’assurance / assistance', true],
			['papiers', 'Permis de conduire'],
			['sante', 'Trousse à pharmacie', true],
			['sante', 'Traitements personnels'],
			['tech', 'Téléphone + chargeur'],
			['tech', 'Batterie externe', true],
			['tech', 'Adaptateur de prise', true],
			['tech', 'Écouteurs'],
			['toilette', 'Trousse de toilette'],
			['toilette', 'Brosse à dents + dentifrice'],
			['vetements', 'Sous-vêtements'],
			['vetements', 'Chaussettes'],
			['vetements', 'Tenue de nuit'],
			['vetements', 'Veste'],
			['divers', 'Sac à dos de journée', true],
			['divers', 'Gourde'],
			['divers', 'Cadenas', true]
		]
	},
	{ id: 'ville', label: 'Ville', items: [['vetements', 'Chaussures confortables'], ['vetements', 'Tenue de sortie'], ['divers', 'Guide ou plan hors ligne', true], ['divers', 'Tote bag', true], ['tech', 'Appareil photo', true]] },
	{ id: 'plage', label: 'Plage', items: [['vetements', 'Maillots de bain'], ['vetements', 'Tongs'], ['vetements', 'Chapeau'], ['vetements', 'Serviette de plage ou paréo'], ['sante', 'Crème solaire', true], ['sante', 'Après-soleil', true], ['divers', 'Lunettes de soleil'], ['divers', 'Masque et tuba'], ['divers', 'Livre']] },
	{ id: 'montagne', label: 'Montagne / ski', items: [['vetements', 'Pantalon de ski'], ['vetements', 'Veste chaude'], ['vetements', 'Sous-couches thermiques'], ['vetements', 'Gants'], ['vetements', 'Bonnet'], ['vetements', 'Chaussettes de ski'], ['vetements', 'Après-ski'], ['divers', 'Masque de ski'], ['divers', 'Casque'], ['sante', 'Crème solaire haute protection', true], ['papiers', 'Forfait ou carte de ski']] },
	{ id: 'rando', label: 'Randonnée', items: [['vetements', 'Chaussures de randonnée'], ['vetements', 'Veste imperméable'], ['vetements', 'Polaire'], ['vetements', 'Casquette'], ['divers', 'Sac à dos 30 L'], ['divers', 'Bâtons', true], ['divers', 'Carte ou GPS hors ligne', true], ['divers', 'Couverture de survie', true], ['divers', 'Lampe frontale'], ['sante', 'Pansements anti-ampoules', true]] },
	{ id: 'bebe', label: 'Avec un bébé', items: [['divers', 'Poussette ou porte-bébé', true], ['divers', 'Couches', true], ['divers', 'Lingettes', true], ['divers', 'Biberons + lait', true], ['divers', 'Doudou', true], ['divers', 'Petits pots et cuillères', true], ['divers', 'Siège auto (ou location)', true], ['divers', 'Jouets de voyage', true], ['sante', 'Thermomètre', true], ['sante', 'Paracétamol pédiatrique', true], ['papiers', 'Carnet de santé', true]] },
	{ id: 'affaires', label: 'Déplacement pro', items: [['vetements', 'Tenues de travail'], ['vetements', 'Chaussures de ville'], ['tech', 'Ordinateur + chargeur'], ['tech', 'Adaptateur HDMI', true], ['papiers', 'Cartes de visite'], ['papiers', 'Ordre de mission, invitations', true]] }
];

export interface WeatherProfile {
	hot: boolean;
	cold: boolean;
	rain: boolean;
}

const WEATHER_ITEMS: Record<keyof WeatherProfile, readonly TemplateLine[]> = {
	hot: [
		['sante', 'Crème solaire', true],
		['vetements', 'Chapeau ou casquette'],
		['divers', 'Lunettes de soleil'],
		['vetements', 'Vêtements légers']
	],
	cold: [
		['vetements', 'Polaire'],
		['vetements', 'Bonnet et gants'],
		['vetements', 'Sous-couches thermiques'],
		['vetements', 'Chaussettes chaudes']
	],
	rain: [
		['vetements', 'Veste de pluie'],
		['divers', 'Parapluie pliable', true],
		['vetements', 'Chaussures imperméables'],
		['divers', 'Housse de sac', true]
	]
};

const fold = (s: string) => s.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const has = (items: readonly PackItem[], label: string) => items.some((i) => fold(i.label) === fold(label));

const fromLine = ([category, label, shared]: TemplateLine, travellers: number, idOf: () => string): PackItem => ({ id: idOf(), category, label, qty: shared ? 1 : Math.max(1, travellers), shared: !!shared, done: false, forgot: false });

/** The items of the templates (always with « base ») that the list does not have yet, one per traveller unless shared. */
export function templateItems(ids: readonly PackTemplateId[], travellers: number, existing: readonly PackItem[], idOf: () => string): PackItem[] {
	const wanted = new Set<PackTemplateId>(['base', ...ids]);
	const out: PackItem[] = [];
	for (const t of PACK_TEMPLATES) {
		if (!wanted.has(t.id)) continue;
		for (const line of t.items) if (!has(existing, line[1]) && !has(out, line[1])) out.push(fromLine(line, travellers, idOf));
	}
	return out;
}

/** What the forecast says about the stay: hot days (max ≥ 27 °C), cold ones (min ≤ 5 °C), rain (two days with 2 mm or more, or 10 mm in all). */
export function weatherProfile(daily: readonly DailyWeather[]): WeatherProfile {
	return {
		hot: daily.some((d) => d.max >= 27),
		cold: daily.some((d) => d.min <= 5),
		rain: daily.filter((d) => d.precipitation >= 2).length >= 2 || daily.reduce((s, d) => s + d.precipitation, 0) >= 10
	};
}

/** Items the weather calls for and the list lacks. */
export function weatherSuggestions(profile: WeatherProfile, existing: readonly PackItem[], travellers: number, idOf: () => string): PackItem[] {
	const out: PackItem[] = [];
	for (const key of ['hot', 'cold', 'rain'] as const) {
		if (!profile[key]) continue;
		for (const line of WEATHER_ITEMS[key]) if (!has(existing, line[1]) && !has(out, line[1])) out.push(fromLine(line, travellers, idOf));
	}
	return out;
}

export function packingProgress(items: readonly PackItem[]): { done: number; total: number } {
	return { done: items.filter((i) => i.done).length, total: items.length };
}

/** The list of another trip, unticked, with new ids; what was forgotten there comes first so it is not forgotten twice. */
export function copyPacking(items: readonly PackItem[], idOf: () => string): PackItem[] {
	return [...items].sort((a, b) => Number(b.forgot) - Number(a.forgot)).map((i) => ({ ...i, id: idOf(), done: false, forgot: false }));
}

/** Items grouped in the categories' order (empty categories left out). */
export function groupPacking(items: readonly PackItem[]): { category: (typeof PACK_CATEGORIES)[number]; items: PackItem[] }[] {
	return PACK_CATEGORIES.map((category) => ({ category, items: items.filter((i) => i.category === category.id) })).filter((g) => g.items.length > 0);
}

/** A new item as typed: label required (80 characters), quantity 1–99. */
export function cleanPackItem(input: { label: string; category: PackCategory; qty: string; shared: boolean }, idOf: () => string): PackItem | null {
	const label = input.label.replace(/\s+/g, ' ').trim().slice(0, 80);
	if (!label) return null;
	const n = Math.round(Number(input.qty || '1'));
	return { id: idOf(), category: input.category, label, qty: Number.isFinite(n) && n >= 1 ? Math.min(99, n) : 1, shared: input.shared, done: false, forgot: false };
}

/** Stored items read back. */
export function sanitizePacking(raw: unknown): PackItem[] {
	if (!Array.isArray(raw)) return [];
	const out: PackItem[] = [];
	for (const i of raw as Partial<PackItem>[]) {
		if (!i || typeof i !== 'object' || typeof i.id !== 'string' || typeof i.label !== 'string' || !i.label) continue;
		out.push({ id: i.id, category: PACK_CATEGORIES.some((c) => c.id === i.category) ? (i.category as PackCategory) : 'divers', label: i.label, qty: typeof i.qty === 'number' && i.qty >= 1 ? Math.min(99, Math.round(i.qty)) : 1, shared: !!i.shared, done: !!i.done, forgot: !!i.forgot });
	}
	return out;
}
