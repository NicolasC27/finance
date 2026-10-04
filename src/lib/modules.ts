/**
 * Optional modules (pure module, testable with tsx): pages a new user does not see until they switch
 * them on in Settings › Modules or with a right-click on the sidebar. The essential pages (Accueil,
 * Budget, Transactions, À trier) are always there. Switching a module off only hides it: its data is
 * never erased. Module ids are the page routes without the slash (stored values, kept as they are).
 */

export type ModuleId = 'analyse' | 'patrimoine' | 'crypto' | 'voiture' | 'portage' | 'ia' | 'rapport';

export type ModuleRoute = '/analyse' | '/patrimoine' | '/crypto' | '/voiture' | '/portage' | '/ia' | '/rapport';

export interface ModuleMeta {
	id: ModuleId;
	label: string;
	/** One line shown in Settings › Modules and as the tooltip of the sidebar menu. */
	description: string;
	route: ModuleRoute;
}

export const MODULES: readonly ModuleMeta[] = [
	{ id: 'analyse', label: 'Analyse', description: 'Épargne mois par mois, commerçants, abonnements, inflation et courbes par catégorie.', route: '/analyse' },
	{ id: 'patrimoine', label: 'Patrimoine', description: 'Comptes, crédits, épargne salariale, biens, rendement réel et projection.', route: '/patrimoine' },
	{ id: 'crypto', label: 'Crypto', description: 'Portefeuille Kraken, récompenses, positions et fiscalité des plus-values.', route: '/crypto' },
	{ id: 'voiture', label: 'Voiture', description: 'Coût réel par mois, valeur retenue, compteur et prochaines échéances.', route: '/voiture' },
	{ id: 'portage', label: 'Portage', description: "Portage salarial : salaire, notes de frais, titres-restaurant, alertes d'impôt.", route: '/portage' },
	{ id: 'ia', label: 'Analyse IA', description: 'Questions et rapports par Claude via le relais local, actions confirmées une à une.', route: '/ia' },
	{ id: 'rapport', label: 'Rapport', description: 'Rapport mensuel imprimable : flux du mois, catégories, faits marquants.', route: '/rapport' }
];

export const ALL_MODULES: readonly ModuleId[] = MODULES.map((m) => m.id);

/** Pages always on: the strict minimum of a budget app. */
export const ESSENTIAL_PAGES: readonly { route: string; label: string }[] = [
	{ route: '/', label: 'Accueil' },
	{ route: '/budget', label: 'Budget' },
	{ route: '/transactions', label: 'Transactions' },
	{ route: '/trier', label: 'À trier' }
];

/** Metadata of a module. */
export function moduleMeta(id: ModuleId): ModuleMeta {
	return MODULES.find((m) => m.id === id)!;
}

/** Module owning a page (null for an essential page or an unknown path). */
export function moduleOfRoute(path: string): ModuleId | null {
	return MODULES.find((m) => m.route === path)?.id ?? null;
}

/** Stored choice `{ active: [...] }`, unknown ids dropped; null when absent or invalid. */
export function sanitizeModules(raw: unknown): ModuleId[] | null {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
	const active = (raw as { active?: unknown }).active;
	if (!Array.isArray(active)) return null;
	return ALL_MODULES.filter((id) => active.includes(id));
}

/** Active modules after switching one on or off, in the canonical order. */
export function toggleModule(active: readonly ModuleId[], id: ModuleId, on: boolean): ModuleId[] {
	return ALL_MODULES.filter((m) => (m === id ? on : active.includes(m)));
}

/** Stored JSON value read through `get`, never throwing (null when absent or invalid). */
function readJson(get: (key: string) => string | null, key: string): unknown {
	try {
		const raw = get(key);
		return raw === null ? null : JSON.parse(raw);
	} catch {
		return null;
	}
}

/** Holds something: a non-empty array, object or string, a number or true. */
function hasContent(v: unknown): boolean {
	if (Array.isArray(v)) return v.length > 0;
	if (v && typeof v === 'object') return Object.keys(v).length > 0;
	if (typeof v === 'string') return v.length > 0;
	return typeof v === 'number' || v === true;
}

const CRYPTO_KEYS = ['budget:kraken-keys', 'budget:kraken-manual', 'budget:kraken-ledger', 'budget:kraken-prices', 'budget:krak-card', 'budget:crypto-snapshots', 'budget:crypto-tax-declared', 'budget:crypto-news'];
const AI_KEYS = ['budget:ia-config', 'budget:ia-chat', 'budget:ia-reports'];
const WEALTH_KEYS = ['budget:accounts', 'budget:loans', 'budget:biens', 'budget:natixis-holdings', 'budget:natixis-snapshot', 'budget:natixis-payments', 'budget:tax-notices', 'budget:reconcile', 'budget:rendements', 'budget:credits-couts'];
const CRYPTO_SOURCES = new Set(['kraken', 'kraken-csv', 'krak-pdf']);

/**
 * Modules switched on the very first time (no stored choice yet), from the data `get` reads:
 * a new install with no data gets none (only the essential pages); an existing user keeps every
 * module that already holds data or settings, and in doubt the module stays on, so nothing they used
 * disappears (transactions alone keep Analyse, Rapport and Patrimoine, whose accounts come from them).
 */
export function modulesFromData(get: (key: string) => string | null): ModuleId[] {
	const txs = readJson(get, 'budget:imported-txs');
	const operations = Array.isArray(txs) ? (txs as unknown[]) : [];
	const hasTransactions = operations.length > 0 || hasContent(readJson(get, 'budget:imports-log'));
	const assets = readJson(get, 'budget:biens');
	const hasVehicle =
		Array.isArray(assets) &&
		assets.some((b) => !!b && typeof b === 'object' && ((b as { type?: unknown }).type === 'vehicule' || (b as { category?: unknown }).category === 'vehicule'));
	const hasCryptoTx = operations.some((t) => {
		const o = (t ?? {}) as { source?: unknown; account?: unknown };
		return (typeof o.source === 'string' && CRYPTO_SOURCES.has(o.source)) || o.account === 'kraken';
	});
	const enabled: Record<ModuleId, boolean> = {
		analyse: hasTransactions,
		patrimoine: hasTransactions || WEALTH_KEYS.some((k) => hasContent(readJson(get, k))),
		crypto: hasCryptoTx || CRYPTO_KEYS.some((k) => hasContent(readJson(get, k))),
		voiture: hasVehicle,
		portage: hasContent(readJson(get, 'budget:portage')),
		ia: AI_KEYS.some((k) => hasContent(readJson(get, k))),
		rapport: hasTransactions
	};
	return ALL_MODULES.filter((id) => enabled[id]);
}
