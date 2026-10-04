import type { CategoryId } from './types';
import { compileTokens, longestToken, type CompiledToken } from './merchant';

/**
 * Built-in dictionary of French merchants (SPEC v10 §3bis).
 *
 * What we do NOT do (SPEC §4bis): no external enrichment API
 * (Plaid/Powens/SIRENE…). Sending bank labels to a third party would break the
 * app's 100 % local/private promise, and MCC codes are not in Crédit Mutuel
 * exports. The built-in dictionary + learning (rules + cross bank votes) cover
 * the need.
 *
 * Guidelines: precision > recall — a doubtful token stays out (« PAUL » too
 * common a first name, « AVIS » common word, « TOTAL » alone ambiguous,
 * insurance brands deliberately absent); no token under 4 letters except safe
 * acronyms (EDF, SNCF, KFC, BP, KLM, UGC, GDF, ENI…). The former CATEGORIES
 * `keywords` are merged here: one source, no double maintenance. Matching runs
 * on merchantKey by word-boundary inclusion, the LONGEST token wins
 * (« UBER EATS » beats « UBER », « LECLERC MOBILE » beats « LECLERC »).
 */
export const MERCHANT_DICT: Partial<Record<CategoryId, string[]>> = {
	alimentation: [
		'MAISON LAFAYE',
		'MAISON FRUGIER',
		'LAPIERRE TRADITI',
		'LAPIERRE TRADITION',
		'TRAIT D UNION',
		'LE VICTOR HUGO',
		'PMU',
		'SWILE',
		'DELPECH WILLIAM',
		'GARCIN',
		'BOULANGE D AUTRE',
		// (SUMUP removed: generic payment terminal — « SUMUP *COIFFURE » is not groceries)
		'SARL BLIN FLAVI',
		// Krak card (Kraken statements: merchant name)
		'LA FERME DE',
		'LE BILLOT DE THEO',
		'MAISON MAURICE',
		'MARCHE DE LEOPOLD',
		'PARFUMS SUCRES',
		'LE COIN DES DOUCEURS',
		'PRIMEURS',
		'PRIMEUR',
		'ETAL DES SAVEURS',
		'MAISON NOISETTE',
		'LAPIERRE',
		'LA CUCINA DI MAMMA',
		'NOUVEAU HONG KONG',
		'AROMA SUNSET',
		'BISTRONOMIE',
		'AU BUREAU',
		'COHI BAR',
		'LE BAL DES GRANDS HOMMES',
		'BLIN FLAVI',
		'BRULERIE',
		'FROMAGE',
		'BOULANGE',
		'PATISSERIE',
		'TRAITEUR',
		'LES PETITS PAINS',
		// Supermarkets (merged former keywords)
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
		'PETIT CASINO',
		'GEANT CASINO',
		'HYPER CASINO',
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
		'METRO',
		// Fast food
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
		// Food shops (safe generic terms)
		'BOULANGERIE',
		'PATISSERIE',
		'TRAITEUR',
		'BOUCHERIE',
		'CHARCUTERIE',
		'FROMAGERIE',
		'POISSONNERIE',
		'EPICERIE',
		'CREPERIE',
		'PIZZERIA',
		'RESTAURANT',
		'BRASSERIE',
		'BISTROT',
		'RESTO',
		'PIZZA',
		'KEBAB',
		'SUSHI'
	],
	transport: [
		// Rail
		'SNCF',
		'OUIGO',
		'TGV',
		'EUROSTAR',
		'THALYS',
		'TRAINLINE',
		// Urban transport
		'RATP',
		'NAVIGO',
		'KEOLIS',
		'TISSEO',
		'MOBILITE AMENAGEMENT',
		// Ride-hailing / car sharing
		'UBER',
		'BOLT',
		'LYFT',
		'KARHOO',
		'HEETCH',
		'FREENOW',
		'BLABLACAR',
		// Vehicle rental
		'EUROPCAR',
		'HERTZ',
		'SIXT',
		'RENT A CAR',
		'RENTACAR',
		// Air
		// (airlines: see « vacances »)
		// Bus
		'FLIXBUS',
		'BLABLABUS',
		// Soft mobility
		'LIME',
		'DOTT',
		'TIER',
		'VELO'
	],
	// Your car: tolls, parking, fuel, maintenance, roadworthiness test, insurance
	voiture: [
		// Tolls
		'AUTOROUTES DU SUD',
		'AUTOROUTE',
		'VINCI AUTOROUTES',
		'ASF',
		'APRR',
		'SANEF',
		'COFIROUTE',
		// Parking
		'PARKING',
		'INDIGO',
		'EFFIA',
		'Q PARK',
		'EASY PARK',
		'EASYPARK',
		'GESTA',
		// Fuel: stations (TotalEnergies paid by card → see categories.ts; TOTAL alone deliberately absent: too ambiguous)
		'TOTAL ACCESS',
		'RELAIS TOTAL',
		'STATION SERVICE',
		'STATION ESSENCE',
		'LECLERC STATION',
		'SHELL',
		'ESSO',
		'AVIA',
		'BP',
		'SO GEST OUEST',
		"SO'GEST OUEST",
		'SOGEST OUEST',
		// Maintenance and parts
		'NORAUTO',
		'FEU VERT',
		'FEUVERT',
		'FEUVERTS',
		'SPEEDY',
		'MIDAS',
		'POINT S',
		'EUROMASTER',
		'CARGLASS',
		'OSCARO',
		'REFERENCE AUTOMOBILES',
		'REFERENCE AUTOM',
		'AUTOMOBILES',
		// Roadworthiness test (« CT 16 »: searched in the raw label, merchantKey removes digits)
		'CONTROLE TECHNIQUE',
		'AUTOSUR',
		'DEKRA',
		'SECURITEST',
		'AUTOVISION',
		'NORISKO',
		'CT 16',
		// Car insurance and loan
		'AUTOMOBILE',
		'ASSURANCE AUTO',
		'CREDIT AUTO'
	],
	energie: [
		'EDF',
		'ENGIE',
		'TOTALENERGIES',
		'TOTAL ENERGIE',
		'ENI',
		'EKWATEUR',
		'VEOLIA',
		'SUEZ',
		'GDF',
		'ALTERNA ENERGIE',
		'PLUM ENERGIE',
		'VATTENFALL'
	],
	abonnements: [
		'QOBUZ',
		'OVHCLOUD',
		'FAL FEATURES LAB',
		'FAL AI',
		// Telecom
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
		// Audio/video streaming
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
		// AI & assistants
		'OPENAI',
		'CHATGPT',
		'ANTHROPIC',
		'CLAUDE AI',
		'MISTRAL AI',
		'MIDJOURNEY',
		'MOONSHOT',
		'MOONSHOT AI',
		'PERPLEXITY',
		'CURSOR',
		'OPENROUTER',
		'DEEPSEEK',
		'ELEVENLABS',
		'LOVABLE',
		'REPLICATE',
		// Software / cloud
		'APPLE',
		'ICLOUD',
		'GOOGLE',
		'GITHUB',
		'MICROSOFT',
		'ADOBE',
		'NOTION',
		'DROPBOX',
		'PROTON',
		'DISCORD',
		'JETBRAINS',
		'NORDVPN',
		// Hosting
		'OVH',
		'O2SWITCH',
		'GANDI'
	],
	loisirs: [
		'TH POITIERS',
		'OPERA NATIONAL',
		'OPERA',
		'CENTRE AQUATIQUE',
		'RIOT GAMES',
		'FDJ',
		'KINGUIN',
		'DOFUS',
		'ANKAMA',
		'MUSESCORE',
		'THEATRE',
		'CGR',
		'CONCORDE LOV',
		// Piano tuner (instant transfers to a sole trader)
		'BIROLLEAU VINCENT',
		'ACCORDEUR',
		'ACCORDAGE',
		'AMAZON',
		'AMAZON PAYMENTS',
		'TICKETMASTER',
		'OFFICE TOURISME',
		'OFFICE TOURISM',
		'FLUTE DE PAN',
		// Music & lessons
		'PIANO',
		'CONSERVATOIRE',
		'ECOLE DE MUSIQUE',
		'COURS DE MUSIQUE',
		'SUPERPROF',
		'YOUSICIAN',
		'FLOWKEY',
		// Culture / media
		'FNAC',
		'CULTURA',
		// Sport
		'DECATHLON',
		'INTERSPORT',
		'GO SPORT',
		// Cinema
		'CINEMA',
		'UGC',
		'PATHE',
		// Video games
		'STEAM',
		'PLAYSTATION',
		'NINTENDO',
		'XBOX',
		'INSTANT GAMING',
		// Fashion / beauty
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
		// Home / DIY / garden
		'IKEA',
		'LEROY MERLIN',
		'LEROY MERLI',
		'CASTORAMA',
		'BRICO DEPOT',
		'ACTION',
		'GIFI',
		'APPLE STORE',
		'CASINO BARRIERE',
		'ORANGE BLEUE',
		'TRUFFAUT',
		'JARDILAND',
		// Gambling
		'WINAMAX'
	],
	vacances: [
		// Holiday accommodation
		'AIRBNB',
		'BOOKING',
		'BOOKING COM',
		'ABRITEL',
		'HOMEAWAY',
		'VRBO',
		'EXPEDIA',
		'HOTELS COM',
		'TRIVAGO',
		'LASTMINUTE',
		'HOTEL',
		'HOTELS',
		'IBIS',
		'NOVOTEL',
		'MERCURE',
		'CAMPANILE',
		'KYRIAD',
		'ACCOR',
		'HOSTEL',
		// (AUBERGE removed: « AUBERGE DU PONT » is a restaurant first)
		'CAMPING',
		'GITE',
		'GITES DE FRANCE',
		'PIERRE VACANCES',
		'PIERRE ET VACANCES',
		'CENTER PARCS',
		'CLUB MED',
		'BELAMBRA',
		'VVF',
		'HUTTOPIA',
		// Airlines (for an individual, a flight is almost always a holiday)
		'AIR FRANCE',
		'EASYJET',
		'RYANAIR',
		'TRANSAVIA',
		'VUELING',
		'VOLOTEA',
		'KLM',
		'LUFTHANSA'
	],
	sante: [
		'DR MARTIN PAUL',
		'REDCARE',
		'PHARMACIE',
		'PHARMA',
		'DOCTEUR',
		'DENTISTE',
		'OPTICIEN',
		'OPTIQUE',
		'KINESITHER',
		'OSTEOPATHE',
		'LABORATOIRE',
		'BIOGROUP',
		'SYNLAB',
		'CERBA',
		'MUTUELLE',
		'MGEN',
		'CPAM',
		'AMELI',
		'COMPLEMENTAIRE SANTE',
		'HOSPI'
	],
	logement: [
		'ASSURANCE HABITATION',
		'RENT',
		'MIELE',
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
		'COPROPRIETE',
		'ACTION LOGEMENT'
	],
	impots: ['IMPOT', 'IMPOTS', 'DGFIP', 'TRESOR PUBLIC', 'DIRECTION GENERALE DES FINANCES', 'SOLDE IMPOT', 'TAXE FONCIERE', 'TAXE HABITATION'],
	// Savings & transfers (not spending): payments to savings named in the label
	epargne: ['LIVRET A', 'LIVRET BLEU', 'LIVRET JEUNE', 'LIVRET DEV', 'LDDS', 'PLAN EPARGNE', 'ASSURANCE VIE'],
	// Neutralised false friends (the longest token wins): « HOTEL DE VILLE » is not a hotel
	autre: ['HOTEL DE VILLE'],
	revenus: [
		// (merged former keywords; credits already go to « revenus »)
		'VIREMENT SALAIRE',
		'SALAIRE',
		'REMBOURSEMENT'
	]
};

// Ordered categories: on equal token length the first one wins
// (stable order, same as the historical CATEGORIES order).
const DICT_ENTRIES = Object.entries(MERCHANT_DICT) as [CategoryId, string[]][];

const COMPILED = compileTokens(DICT_ENTRIES);
const KEY_TOKENS = COMPILED.filter((t) => !t.raw);
const RAW_TOKENS = COMPILED.filter((t) => t.raw);
/** Generic words (SALAIRE, REMBOURSEMENT…): they only decide when no merchant matches. */
const isGeneric = (t: CompiledToken<CategoryId>) => t.value === 'revenus';
const isSpecific = (t: CompiledToken<CategoryId>) => t.value !== 'revenus';
const longer = <T>(a?: CompiledToken<T>, b?: CompiledToken<T>) => (!a ? b : !b ? a : b.token.length > a.token.length ? b : a);

/** Cache merchant key → best tokens (frozen dictionary: valid for the whole session). */
const keyCache = new Map<string, { specific?: CompiledToken<CategoryId>; generic?: CompiledToken<CategoryId> }>();

/**
 * Dictionary category for a merchant key (and, for tokens merchantKey damages,
 * the normalised raw label `raw`): the longest token matching on word
 * boundaries, undefined if none. A MERCHANT always beats a generic word:
 * « VIR REMBOURSEMENT CPAM » → Santé (before: REMBOURSEMENT, longer than CPAM,
 * sent the refund to Revenus).
 */
export function merchantDictFor(key: string, raw = ''): CategoryId | undefined {
	if (!key && !raw) return undefined;
	let cached = keyCache.get(key);
	if (!cached) {
		cached = key ? { specific: longestToken(KEY_TOKENS, key, '', isSpecific), generic: longestToken(KEY_TOKENS, key, '', isGeneric) } : {};
		keyCache.set(key, cached);
	}
	const specific = longer(cached.specific, raw ? longestToken(RAW_TOKENS, '', raw, isSpecific) : undefined);
	if (specific) return specific.value;
	return longer(cached.generic, raw ? longestToken(RAW_TOKENS, '', raw, isGeneric) : undefined)?.value;
}
