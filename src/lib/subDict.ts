import type { CategoryId } from './types';
import { compileTokens, longestToken } from './merchant';

/**
 * Subcategory taxonomy and fine merchant dictionary: PURE module (data + lookup) with no
 * dependency on categories.ts, so categorisation (category implied by a fine token) and
 * subcategorisation use it without a circular import.
 */

export interface Subcategory {
	id: string;
	categoryId: CategoryId;
	label: string;
}

/** Frozen v11 taxonomy (SPEC §1). */
export const SUBCATEGORIES: Subcategory[] = [
	// alimentation
	{ id: 'courses', categoryId: 'alimentation', label: 'Courses' },
	{ id: 'restaurants', categoryId: 'alimentation', label: 'Restaurants & fast-food' },
	{ id: 'petits-commercants', categoryId: 'alimentation', label: 'Petits commerçants' },
	// logement
	{ id: 'loyer-charges', categoryId: 'logement', label: 'Loyer & charges' },
	{ id: 'assurance-habitat', categoryId: 'logement', label: 'Assurance habitation' },
	{ id: 'travaux-equipement', categoryId: 'logement', label: 'Travaux & équipement' },
	// energie
	{ id: 'electricite-gaz', categoryId: 'energie', label: 'Électricité & gaz' },
	{ id: 'eau', categoryId: 'energie', label: 'Eau' },
	// transport
	{ id: 'transports-commun', categoryId: 'transport', label: 'Transports en commun' },
	{ id: 'vtc-taxi', categoryId: 'transport', label: 'VTC & taxi' },
	{ id: 'voyages', categoryId: 'transport', label: 'Voyages (train, avion)' },
	// voiture (the `carburant` and `peages-parkings` ids are kept: old manual choices stay valid)
	{ id: 'achat-vehicule', categoryId: 'voiture', label: 'Achat du véhicule' },
	{ id: 'credit-auto', categoryId: 'voiture', label: 'Crédit auto' },
	{ id: 'assurance-auto', categoryId: 'voiture', label: 'Assurance auto' },
	{ id: 'entretien-auto', categoryId: 'voiture', label: 'Entretien & réparations' },
	{ id: 'carburant', categoryId: 'voiture', label: 'Carburant' },
	{ id: 'peages-parkings', categoryId: 'voiture', label: 'Péages & parkings' },
	{ id: 'equipement-auto', categoryId: 'voiture', label: 'Équipement' },
	{ id: 'controle-technique', categoryId: 'voiture', label: 'Contrôle technique' },
	// abonnements
	{ id: 'telecom', categoryId: 'abonnements', label: 'Télécom & internet' },
	{ id: 'streaming', categoryId: 'abonnements', label: 'Streaming & médias' },
	{ id: 'logiciels', categoryId: 'abonnements', label: 'Logiciels & cloud' },
	{ id: 'ia', categoryId: 'abonnements', label: 'IA & assistants' },
	// loisirs
	{ id: 'shopping', categoryId: 'loisirs', label: 'Shopping & mode' },
	{ id: 'high-tech', categoryId: 'loisirs', label: 'High-tech & informatique' },
	{ id: 'sport', categoryId: 'loisirs', label: 'Sport' },
	{ id: 'culture-sorties', categoryId: 'loisirs', label: 'Culture & sorties' },
	{ id: 'bricolage-jardin', categoryId: 'loisirs', label: 'Bricolage & jardin' },
	{ id: 'musique-cours', categoryId: 'loisirs', label: 'Musique & cours' },
	{ id: 'cadeaux', categoryId: 'loisirs', label: 'Cadeaux' },
	// sante
	{ id: 'pharmacie', categoryId: 'sante', label: 'Pharmacie' },
	{ id: 'soins', categoryId: 'sante', label: 'Soins & praticiens' },
	{ id: 'mutuelle', categoryId: 'sante', label: 'Mutuelle & optique' },
	// revenus
	{ id: 'salaire', categoryId: 'revenus', label: 'Salaire' },
	{ id: 'chomage', categoryId: 'revenus', label: 'Allocations chômage' },
	{ id: 'remboursements', categoryId: 'revenus', label: 'Remboursements' },
	{ id: 'cheques-recus', categoryId: 'revenus', label: 'Chèques reçus' },
	// autre
	// vacances
	{ id: 'hebergement', categoryId: 'vacances', label: 'Hébergement' },
	{ id: 'vols', categoryId: 'vacances', label: 'Vols' },
	// On site: the real nature of the spending is kept ('Alimentation + Vacances')
	{ id: 'vac-alimentation', categoryId: 'vacances', label: 'Alimentation' },
	{ id: 'vac-loisirs', categoryId: 'vacances', label: 'Loisirs' },
	{ id: 'vac-transport', categoryId: 'vacances', label: 'Transport' },
	{ id: 'sur-place', categoryId: 'vacances', label: 'Sur place (autre)' },
	{ id: 'frais-bancaires', categoryId: 'autre', label: 'Frais bancaires' },
	{ id: 'cheques-virements', categoryId: 'autre', label: 'Chèques & virements' },
	{ id: 'avances', categoryId: 'autre', label: 'Prêts & avances à des proches' },
	{ id: 'credits', categoryId: 'autre', label: 'Échéances de crédit' },
	{ id: 'impots-taxes', categoryId: 'impots', label: 'Impôts & taxes' }
];

export const SUB_BY_ID = new Map(SUBCATEGORIES.map((s) => [s.id, s]));

export function getSubcategory(id: string): Subcategory | undefined {
	return SUB_BY_ID.get(id);
}

/** Subcategories of a category (taxonomy order). */
export function subcategoriesFor(categoryId: CategoryId): Subcategory[] {
	return SUBCATEGORIES.filter((s) => s.categoryId === categoryId);
}

// ---------- 2. Fine merchant dictionary (SPEC §2.2) ----------

/**
 * Extended merchant dictionary at subcategory level: same brands as MERCHANT_DICT
 * (merchantDict.ts), finer granularity. Word-boundary inclusion matching on merchantKey, the
 * LONGEST token wins (e.g. 'UBER EATS' beats 'UBER', 'LECLERC MOBILE' beats 'LECLERC').
 * Inherited guidelines: precision > recall, no token under 4 letters except safe acronyms (EDF,
 * SNCF, KFC, BP, KLM, TGV, UGC…).
 *
 * DOCUMENTED SPECIAL CASE — TOTALENERGIES / TOTAL ENERGIE: the brand is BOTH energy (supplier
 * direct debit) and fuel (station). The tokens live in `electricite-gaz`; if the RESOLVED category
 * of the tx is 'transport' (bank 'Véhicule / Carburant', cross vote…), the match is re-routed to
 * `carburant` (SPEC §2.2: decide by the resolved label). The resolved category of a station is
 * 'voiture'.
 */
export const SUB_MERCHANT_DICT: Record<string, string[]> = {
	hebergement: ['AIRBNB', 'BOOKING', 'ABRITEL', 'HOMEAWAY', 'VRBO', 'EXPEDIA', 'HOTELS COM', 'HOTEL', 'HOTELS', 'IBIS', 'NOVOTEL', 'MERCURE', 'CAMPANILE', 'KYRIAD', 'ACCOR', 'HOSTEL', 'AUBERGE', 'CAMPING', 'GITE', 'PIERRE VACANCES', 'CENTER PARCS', 'CLUB MED', 'BELAMBRA', 'VVF', 'HUTTOPIA'],
	vols: ['AIR FRANCE', 'EASYJET', 'RYANAIR', 'TRANSAVIA', 'VUELING', 'VOLOTEA', 'KLM', 'LUFTHANSA'],
	courses: [
		'CARREFOUR',
		'E LECLERC',
		'LECLERC',
		'INTERMARCHE',
		'SUPER U',
		'HYPER U',
		'SYSTEME U',
		'AUCHAN',
		'MONOPRIX',
		'FRANPRIX',
		'LIDL',
		'ALDI',
		'CASINO',
		'CORA',
		'LEADER PRICE',
		'COLRUYI',
		'SPAR',
		'VIVAL',
		'G20',
		'PICARD',
		'THIRIET',
		'GRAND FRAIS',
		'BIOCOOP',
		'NATURALIA',
		'METRO'
	],
	restaurants: [
		'AROMA SUNSET',
		'BISTRONOMIE',
		'AU BUREAU',
		'COHI BAR',
		'LA CUCINA DI MAMMA',
		'NOUVEAU HONG KONG',
		'LE BAL DES GRANDS HOMMES',
		'MC DONALD',
		'MCDONALD',
		'BURGER KING',
		'KFC',
		'SUBWAY',
		'STARBUCKS',
		'QUICK',
		'PIZZA HUT',
		'DOMINO',
		'O TACOS',
		'SUSHI SHOP',
		'PLANET SUSHI',
		'BRIOCHE DOREE',
		'LA MIE CALINE',
		'MIE CALINE',
		'LA CROISSANTERIE',
		'BUFFALO GRILL',
		'COURTEPAILLE',
		'FLUNCH',
		'HIPPOPOTAMUS',
		'UBER EATS',
		'DELIVEROO',
		'KEBAB',
		'RESTAURANT',
		'BRASSERIE',
		'BISTROT',
		'RESTO',
		'PIZZERIA',
		'PIZZA',
		'SUSHI',
		'CREPERIE'
	],
	'petits-commercants': [
		'BOULANGERIE',
		'PATISSERIE',
		'TRAITEUR',
		'BOUCHERIE',
		'CHARCUTERIE',
		'FROMAGERIE',
		'POISSONNERIE',
		'EPICERIE',
		'PRIMEUR',
		'BISCUITERIE',
		'CHOCOLATERIE',
		'ROTISSERIE'
	],
	'loyer-charges': [
		'LOYER',
		'FONCIA',
		'NEXITY',
		'CITYA',
		'ORPI',
		'CENTURY 21',
		'LAFORET',
		'GUY HOQUET',
		'CHARGES COPRO',
		'SYNDIC',
		'COPROPRIETE'
	],
	'assurance-habitat': ['ASSURANCE HABITATION', 'ASSURANCE LOGEMENT', 'ASSURANCE MAISON', 'MRH'],
	'travaux-equipement': [
		'PLOMBERIE',
		'MENUISERIE',
		'CHAUFFAGE',
		'CLIMATISATION',
		'SERRURERIE',
		'ETANCHEITE',
		'RENOVATION'
	],
	'electricite-gaz': [
		'EDF',
		'ENGIE',
		'TOTALENERGIES', // see the TOTALENERGIES special case (dictionary header)
		'TOTAL ENERGIE', // same
		'ENI',
		'EKWATEUR',
		'GDF',
		'ALTERNA ENERGIE',
		'PLUM ENERGIE',
		'VATTENFALL',
		'OHM ENERGIE',
		'MINT ENERGIE'
	],
	eau: ['VEOLIA', 'SUEZ', 'SAUR', 'REGIE DES EAUX', 'SERVICE DES EAUX', 'EAU POTABLE', 'COMPAGNIE DES EAUX'],
	carburant: [
		'TOTAL ACCESS',
		'RELAIS TOTAL',
		'STATION ESSENCE',
		'LECLERC STATION',
		'SO GEST OUEST',
		"SO'GEST OUEST",
		'SOGEST OUEST',
		'SHELL',
		'ESSO',
		'AVIA',
		'BP',
		'DYNEFF',
		'STATION SERVICE',
		'CARBURANT',
		'ESSO EXPRESS',
		'AGIP',
		'TEXACO'
	],
	'transports-commun': ['RATP', 'NAVIGO', 'KEOLIS', 'TISSEO', 'FLIXBUS', 'BLABLABUS', 'TRANSPORT URBAIN'],
	'vtc-taxi': ['UBER', 'BOLT', 'LYFT', 'KARHOO', 'HEETCH', 'FREENOW', 'TAXI'],
	voyages: [
		'SNCF',
		'OUIGO',
		'TGV',
		'EUROSTAR',
		'THALYS',
		'TRAINLINE',
		'AIR FRANCE',
		'EASYJET',
		'RYANAIR',
		'TRANSAVIA',
		'VOLOTEA',
		'VUELING',
		'LUFTHANSA',
		'KLM'
	],
	'peages-parkings': [
		'AUTOROUTE',
		'AUTOROUTES',
		'AUTOROUTES DU SUD',
		'ASF',
		'SANEF',
		'APRR',
		'VINCI AUTOROUTES',
		'COFIROUTE',
		'PARKING',
		'INDIGO',
		'EFFIA',
		'Q PARK',
		'EASY PARK',
		'EASYPARK',
		'GESTA',
		'PEAGE'
	],
	'credit-auto': ['CREDIT AUTO', 'LEASING', 'LOCATION LONGUE DUREE'],
	'assurance-auto': ['ASSURANCE AUTO', 'ASSURANCE AUTOMOBILE', 'AUTOMOBILE'],
	'entretien-auto': ['NORAUTO', 'FEU VERT', 'FEUVERT', 'FEUVERTS', 'SPEEDY', 'MIDAS', 'POINT S', 'EUROMASTER', 'CARGLASS', 'OSCARO', 'REFERENCE AUTOMOBILES', 'REFERENCE AUTOM', 'AUTOMOBILES'],
	'controle-technique': ['CONTROLE TECHNIQUE', 'AUTOSUR', 'DEKRA', 'SECURITEST', 'AUTOVISION', 'NORISKO', 'CT 16'],
	telecom: [
		'ORANGE',
		'SFR',
		'FREE',
		'BOUYGUES',
		'RED BY SFR',
		'SOSH',
		'B&YOU',
		'NRJ MOBILE',
		'PRIXTEL',
		'LECLERC MOBILE',
		'TELECOM'
	],
	streaming: [
		'NETFLIX',
		'SPOTIFY',
		'DEEZER',
		'TIDAL',
		'DISNEY',
		'CANAL',
		'PRIME VIDEO',
		'AMAZON PRIME',
		'YOUTUBE',
		'AUDIBLE',
		'QOBUZ',
		'MYCANAL'
	],
	ia: ['FAL FEATURES LAB', 'FAL AI', 'OPENAI', 'CHATGPT', 'ANTHROPIC', 'CLAUDE AI', 'MISTRAL AI', 'MIDJOURNEY', 'MOONSHOT', 'MOONSHOT AI', 'KIMI', 'PERPLEXITY', 'CURSOR', 'OPENROUTER', 'DEEPSEEK', 'ELEVENLABS', 'GITHUB COPILOT', 'LOVABLE', 'REPLICATE'],
	logiciels: [
		'APPLE',
		'ICLOUD',
		'GOOGLE',
		'GITHUB',
		'MICROSOFT',
		'MICROSOF', // frequent truncation of CM labels ('PAYPAL *MICROSOF')
		'ADOBE',
		'NOTION',
		'DROPBOX',
		'PROTON',
		'DISCORD',
		'JETBRAINS',
		'NORDVPN',
		'OVH',
		'O2SWITCH',
		'GANDI'
	],
	shopping: [
		'ZARA',
		'H&M',
		'UNIQLO',
		'KIABI',
		'PRIMARK',
		'SEPHORA',
		'YVES ROCHER',
		'LUSH',
		'MANGO',
		'PIMKIE',
		'CELIO',
		'ETAM',
		'ZALANDO',
		'ASOS',
		'VINTED',
		'SHEIN',
		'AMAZON',
		'AMZ',
		'CDISCOUNT',
		'CDISCOUN' // frequent truncation ('PAYPAL *CDISCOUN')
	],
	sport: ['DECATHLON', 'INTERSPORT', 'GO SPORT', 'SPORT', 'SNOWLEADER', 'BASIC FIT', 'FITNESS', 'ESCALADE', 'NATATION'],
	'musique-cours': ['BIROLLEAU VINCENT', 'ACCORDEUR', 'ACCORDAGE', 'FLUTE DE PAN', 'PARTITION', 'PIANO', 'CONSERVATOIRE', 'ECOLE DE MUSIQUE', 'COURS DE MUSIQUE', 'COURS PARTICULIER', 'COURS PARTICULIERS', 'PROFESSEUR', 'LECON', 'LECONS', 'SOLFEGE', 'GUITARE', 'YOUSICIAN', 'FLOWKEY', 'SIMPLY PIANO', 'SUPERPROF'],
	'culture-sorties': [
		'FNAC',
		'CULTURA',
		'CINEMA',
		'UGC',
		'PATHE',
		'STEAM',
		'PLAYSTATION',
		'NINTENDO',
		'XBOX',
		'INSTANT GAMING',
		'MUSEE',
		'THEATRE',
		'CONCERT'
	],
	'bricolage-jardin': [
		'LEROY MERLIN',
		'LEROY MERLI', // frequent truncation of CM labels
		'CASTORAMA',
		'BRICO DEPOT',
		'TRUFFAUT',
		'JARDILAND',
		'IKEA',
		'ACTION',
		'GIFI',
		'BRICORAMA',
		'WELDOM'
	],
	pharmacie: ['PHARMACIE', 'PHARMA', 'PARAPHARMACIE'],
	soins: [
		'DR MARTIN PAUL',
		'DOCTEUR',
		'DENTISTE',
		'KINESITHER',
		'OSTEOPATHE',
		'LABORATOIRE',
		'BIOGROUP',
		'SYNLAB',
		'CERBA',
		'HOSPI',
		'MEDECIN',
		'INFIRMIER',
		'PODOLOGUE',
		'DERMATO'
	],
	mutuelle: ['OPTICIEN', 'OPTIQUE', 'MUTUELLE', 'MGEN', 'CPAM', 'AMELI', 'COMPLEMENTAIRE SANTE', 'LUNETTES'],
	salaire: ['VIREMENT SALAIRE', 'SALAIRE'],
	chomage: ['POLE EMPLOI', 'FRANCE TRAVAIL', 'FRANCETRAVAIL', 'ALLOCATION ARE'],
	remboursements: ['REMBOURSEMENT'],
	'cheques-recus': ['REMISE CHEQUE'],
	credits: ['ECHEANCE PRET', 'ECHEANCE CREDIT', 'REMBOURSEMENT PRET', 'MENSUALITE PRELEVEE'],
	'impots-taxes': ['IMPOT', 'IMPOTS', 'DGFIP', 'TRESOR PUBLIC', 'DIRECTION GENERALE DES FINANCES', 'SOLDE IMPOT', 'TAXE FONCIERE', 'TAXE HABITATION'],
	'frais-bancaires': ['EUROCOMPTE', 'COMMISSION BANCAIRE', 'FRAIS BANCAIRES', 'COTISATION CARTE', 'AGIOS'],
	'cheques-virements': ['CHEQUE', 'VIREMENT']
};

/** TOTALENERGIES tokens subject to the fuel re-routing (see the dictionary). */
export const TOTAL_TOKENS: ReadonlySet<string> = new Set(['TOTALENERGIES', 'TOTAL ENERGIE']);

/** Ordered entries: at equal length, the first subcategory wins. */
const SUB_DICT_ENTRIES = Object.entries(SUB_MERCHANT_DICT) as [string, string[]][];
const COMPILED = compileTokens(SUB_DICT_ENTRIES);

/**
 * Fine dictionary match for a merchant key (and the normalised raw label for tokens that
 * merchantKey damages, e.g. 'CT 16'): longest token matching on a word boundary, undefined if
 * none. Also returns the token (TOTALENERGIES re-routing). `accept` restricts the candidate
 * subcategories.
 */
export function subMerchantDictFor(key: string, raw = '', accept?: (subId: string) => boolean): { subId: string; token: string } | undefined {
	if (!key && !raw) return undefined;
	const best = longestToken(COMPILED, key, raw, accept ? (t) => accept(t.value) : undefined);
	return best ? { subId: best.value, token: best.token } : undefined;
}

/**
 * Category IMPLIED by the fine dictionary (each fine token carries its category): fills the 71
 * tokens missing from the main dictionary, which left the operation in 'autre'. Vacances and
 * Revenus subcategories imply nothing (the period / direction of the operation decide).
 */
export function subDictCategoryFor(key: string, raw = ''): CategoryId | undefined {
	const match = subMerchantDictFor(key, raw, (subId) => {
		const c = SUB_BY_ID.get(subId)?.categoryId;
		return c !== undefined && c !== 'vacances' && c !== 'revenus';
	});
	return match ? SUB_BY_ID.get(match.subId)?.categoryId : undefined;
}
