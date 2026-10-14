/**
 * Practical facts of destination countries (pure, static): emergency numbers, plugs and voltage,
 * currency, languages, dialling code, driving side, tipping habit. Written 2026-10-07 from the
 * IEC « World Plugs » list, the EU 112 directive and the public lists of national emergency
 * numbers; a fact can change (Bulgaria adopted the euro on 2026-01-01), so check the number
 * before an emergency and keep the date here current when the table is revised.
 */

export interface CountryFacts {
	/** ISO 3166-1 alpha-2. */
	code: string;
	/** French names, the usual one first, then aliases the user may type. */
	names: readonly string[];
	/** Number(s) to call, the general one first. */
	emergency: string;
	/** IEC plug types. */
	plugs: string;
	voltage: string;
	currency: string;
	languages: string;
	dialling: string;
	drive: 'droite' | 'gauche';
	tipping: string;
}

const EU112 = '112';

const c = (code: string, names: string[], emergency: string, plugs: string, voltage: string, currency: string, languages: string, dialling: string, drive: 'droite' | 'gauche', tipping: string): CountryFacts => ({ code, names, emergency, plugs, voltage, currency, languages, dialling, drive, tipping });

export const COUNTRIES: readonly CountryFacts[] = [
	c('FR', ['France', 'Corse', 'Métropole'], EU112, 'C, E', '230 V', 'euro (EUR)', 'français', '+33', 'droite', 'service compris, on arrondit'),
	c('PT', ['Portugal', 'Madère', 'Açores'], EU112, 'C, F', '230 V', 'euro (EUR)', 'portugais', '+351', 'droite', '5–10 % appréciés'),
	c('ES', ['Espagne', 'Canaries', 'Baléares'], EU112, 'C, F', '230 V', 'euro (EUR)', 'espagnol (catalan, basque, galicien)', '+34', 'droite', 'on arrondit, 5–10 % au restaurant'),
	c('IT', ['Italie', 'Sardaigne', 'Sicile'], EU112, 'C, F, L', '230 V', 'euro (EUR)', 'italien', '+39', 'droite', 'couvert facturé, on arrondit'),
	c('GR', ['Grèce', 'Crète', 'Cyclades'], EU112, 'C, F', '230 V', 'euro (EUR)', 'grec', '+30', 'droite', '5–10 %'),
	c('DE', ['Allemagne'], EU112, 'C, F', '230 V', 'euro (EUR)', 'allemand', '+49', 'droite', '5–10 %, annoncés au serveur'),
	c('BE', ['Belgique'], EU112, 'C, E', '230 V', 'euro (EUR)', 'français, néerlandais, allemand', '+32', 'droite', 'service compris'),
	c('NL', ['Pays-Bas', 'Hollande'], EU112, 'C, F', '230 V', 'euro (EUR)', 'néerlandais', '+31', 'droite', 'on arrondit'),
	c('LU', ['Luxembourg'], EU112, 'C, F', '230 V', 'euro (EUR)', 'luxembourgeois, français, allemand', '+352', 'droite', 'service compris'),
	c('CH', ['Suisse'], '112 (117 police, 144 ambulance)', 'C, J', '230 V', 'franc suisse (CHF)', 'allemand, français, italien', '+41', 'droite', 'service compris, on arrondit'),
	c('AT', ['Autriche'], EU112, 'C, F', '230 V', 'euro (EUR)', 'allemand', '+43', 'droite', '5–10 %'),
	c('GB', ['Royaume-Uni', 'Angleterre', 'Grande-Bretagne', 'Écosse', 'Pays de Galles', 'Irlande du Nord'], '999 ou 112', 'G', '230 V', 'livre sterling (GBP)', 'anglais', '+44', 'gauche', '10–12,5 % si le service n’est pas inclus'),
	c('IE', ['Irlande'], '112 ou 999', 'G', '230 V', 'euro (EUR)', 'anglais, irlandais', '+353', 'gauche', '10 % au restaurant'),
	c('DK', ['Danemark'], EU112, 'C, E, F, K', '230 V', 'couronne danoise (DKK)', 'danois', '+45', 'droite', 'pas attendu, on arrondit'),
	c('SE', ['Suède'], EU112, 'C, F', '230 V', 'couronne suédoise (SEK)', 'suédois', '+46', 'droite', 'pas attendu, on arrondit'),
	c('NO', ['Norvège'], '112 (113 ambulance, 110 pompiers)', 'C, F', '230 V', 'couronne norvégienne (NOK)', 'norvégien', '+47', 'droite', 'pas attendu, on arrondit'),
	c('FI', ['Finlande', 'Laponie'], EU112, 'C, F', '230 V', 'euro (EUR)', 'finnois, suédois', '+358', 'droite', 'pas attendu'),
	c('IS', ['Islande'], EU112, 'C, F', '230 V', 'couronne islandaise (ISK)', 'islandais', '+354', 'droite', 'pas attendu'),
	c('PL', ['Pologne'], EU112, 'C, E', '230 V', 'złoty (PLN)', 'polonais', '+48', 'droite', '10 %'),
	c('CZ', ['Tchéquie', 'République tchèque'], EU112, 'C, E', '230 V', 'couronne tchèque (CZK)', 'tchèque', '+420', 'droite', '10 %'),
	c('HU', ['Hongrie'], EU112, 'C, F', '230 V', 'forint (HUF)', 'hongrois', '+36', 'droite', '10 %'),
	c('HR', ['Croatie'], EU112, 'C, F', '230 V', 'euro (EUR)', 'croate', '+385', 'droite', 'on arrondit'),
	c('SI', ['Slovénie'], EU112, 'C, F', '230 V', 'euro (EUR)', 'slovène', '+386', 'droite', 'on arrondit'),
	c('RO', ['Roumanie'], EU112, 'C, F', '230 V', 'leu (RON)', 'roumain', '+40', 'droite', '10 %'),
	c('BG', ['Bulgarie'], EU112, 'C, F', '230 V', 'euro (EUR, depuis 2026)', 'bulgare', '+359', 'droite', '10 %'),
	c('MT', ['Malte'], EU112, 'G', '230 V', 'euro (EUR)', 'maltais, anglais', '+356', 'gauche', '5–10 %'),
	c('CY', ['Chypre'], EU112, 'G', '240 V', 'euro (EUR)', 'grec, turc', '+357', 'gauche', 'on arrondit'),
	c('TR', ['Turquie', 'Türkiye', 'Istanbul'], EU112, 'C, F', '230 V', 'livre turque (TRY)', 'turc', '+90', 'droite', '5–10 %'),
	c('MA', ['Maroc'], '19 (police), 15 (secours), 177 (gendarmerie)', 'C, E', '220 V', 'dirham (MAD)', 'arabe, amazigh, français courant', '+212', 'droite', '5–10 %, petite monnaie pour les services'),
	c('TN', ['Tunisie'], '197 (police), 190 (SAMU), 198 (pompiers)', 'C, E', '230 V', 'dinar tunisien (TND)', 'arabe, français courant', '+216', 'droite', '5–10 %'),
	c('EG', ['Égypte'], '122 (police), 123 (ambulance)', 'C, F', '220 V', 'livre égyptienne (EGP)', 'arabe', '+20', 'droite', 'bakchich attendu, 10 %'),
	c('ZA', ['Afrique du Sud'], '10111 (police), 10177 (ambulance), 112 depuis un mobile', 'C, M, N', '230 V', 'rand (ZAR)', 'anglais, afrikaans, zoulou, xhosa…', '+27', 'gauche', '10–15 %'),
	c('KE', ['Kenya'], '999 ou 112', 'G', '240 V', 'shilling kényan (KES)', 'swahili, anglais', '+254', 'gauche', '10 %'),
	c('TZ', ['Tanzanie', 'Zanzibar'], '112', 'D, G', '230 V', 'shilling tanzanien (TZS)', 'swahili, anglais', '+255', 'gauche', '10 %'),
	c('MU', ['Maurice', 'Île Maurice'], '999 (police), 114 (SAMU)', 'C, G', '230 V', 'roupie mauricienne (MUR)', 'créole, français, anglais', '+230', 'gauche', 'on arrondit'),
	c('SN', ['Sénégal'], '17 (police), 18 (pompiers)', 'C, D, E, K', '230 V', 'franc CFA (XOF)', 'français, wolof', '+221', 'droite', 'petite monnaie appréciée'),
	c('AE', ['Émirats arabes unis', 'Emirats', 'Dubaï', 'Abu Dhabi'], '999 (police), 998 (ambulance)', 'G', '230 V', 'dirham (AED)', 'arabe, anglais courant', '+971', 'droite', '10 % souvent inclus'),
	c('OM', ['Oman'], '9999', 'G', '240 V', 'rial omanais (OMR)', 'arabe, anglais courant', '+968', 'droite', '10 %'),
	c('JO', ['Jordanie'], '911', 'B, C, D, F, G, J', '230 V', 'dinar jordanien (JOD)', 'arabe, anglais courant', '+962', 'droite', '10 %'),
	c('IL', ['Israël'], '100 (police), 101 (ambulance)', 'C, H, M', '230 V', 'shekel (ILS)', 'hébreu, arabe, anglais courant', '+972', 'droite', '10–15 %'),
	c('IN', ['Inde', 'Rajasthan', 'Kerala', 'Goa'], '112', 'C, D, M', '230 V', 'roupie indienne (INR)', 'hindi, anglais et langues régionales', '+91', 'gauche', '10 %'),
	c('LK', ['Sri Lanka'], '119 (police), 1990 (ambulance)', 'D, G', '230 V', 'roupie srilankaise (LKR)', 'cinghalais, tamoul, anglais', '+94', 'gauche', '10 %'),
	c('TH', ['Thaïlande', 'Bangkok', 'Phuket'], '191 (police), 1669 (ambulance), 1155 (police touristique)', 'A, B, C, O', '220 V', 'baht (THB)', 'thaï', '+66', 'gauche', 'on arrondit, 20–50 THB'),
	c('VN', ['Viêt Nam', 'Vietnam'], '113 (police), 115 (ambulance)', 'A, C, F', '220 V', 'dong (VND)', 'vietnamien', '+84', 'droite', 'pas attendu, apprécié'),
	c('KH', ['Cambodge'], '117 (police), 119 (ambulance)', 'A, C, G', '230 V', 'riel (KHR), dollar américain courant', 'khmer', '+855', 'droite', '1–2 USD'),
	c('LA', ['Laos'], '191 (police), 195 (ambulance)', 'A, B, C, E, F', '230 V', 'kip (LAK)', 'lao', '+856', 'droite', 'on arrondit'),
	c('ID', ['Indonésie', 'Bali', 'Java'], '112 (110 police, 118 ambulance)', 'C, F', '230 V', 'roupie indonésienne (IDR)', 'indonésien', '+62', 'gauche', '5–10 %'),
	c('MY', ['Malaisie', 'Bornéo'], '999', 'G', '240 V', 'ringgit (MYR)', 'malais, anglais courant', '+60', 'gauche', 'pas attendu'),
	c('SG', ['Singapour'], '999 (police), 995 (ambulance)', 'G', '230 V', 'dollar de Singapour (SGD)', 'anglais, malais, mandarin, tamoul', '+65', 'gauche', 'pas attendu (10 % de service facturés)'),
	c('PH', ['Philippines'], '911', 'A, B, C', '220 V', 'peso philippin (PHP)', 'filipino, anglais', '+63', 'droite', '10 %'),
	c('JP', ['Japon', 'Tokyo', 'Kyoto', 'Okinawa'], '110 (police), 119 (ambulance et pompiers)', 'A, B', '100 V', 'yen (JPY)', 'japonais', '+81', 'gauche', 'jamais : cela gêne'),
	c('KR', ['Corée du Sud', 'Corée', 'Séoul'], '112 (police), 119 (ambulance)', 'C, F', '220 V', 'won (KRW)', 'coréen', '+82', 'droite', 'pas attendu'),
	c('CN', ['Chine', 'Pékin', 'Shanghai'], '110 (police), 120 (ambulance)', 'A, C, I', '220 V', 'yuan (CNY)', 'mandarin', '+86', 'droite', 'pas attendu'),
	c('TW', ['Taïwan', 'Taiwan'], '110 (police), 119 (ambulance)', 'A, B', '110 V', 'dollar taïwanais (TWD)', 'mandarin', '+886', 'droite', 'pas attendu'),
	c('AU', ['Australie'], '000', 'I', '230 V', 'dollar australien (AUD)', 'anglais', '+61', 'gauche', 'pas attendu'),
	c('NZ', ['Nouvelle-Zélande'], '111', 'I', '230 V', 'dollar néo-zélandais (NZD)', 'anglais, maori', '+64', 'gauche', 'pas attendu'),
	c('US', ['États-Unis', 'Etats-Unis', 'USA', 'Amérique', 'New York', 'Californie', 'Floride', 'Hawaï'], '911', 'A, B', '120 V', 'dollar américain (USD)', 'anglais, espagnol courant', '+1', 'droite', '18–22 % attendus au restaurant'),
	c('CA', ['Canada', 'Québec'], '911', 'A, B', '120 V', 'dollar canadien (CAD)', 'anglais, français', '+1', 'droite', '15–20 %'),
	c('MX', ['Mexique', 'Yucatán'], '911', 'A, B', '127 V', 'peso mexicain (MXN)', 'espagnol', '+52', 'droite', '10–15 %'),
	c('CU', ['Cuba'], '106 (police), 104 (ambulance)', 'A, B, C, L', '110 V et 220 V', 'peso cubain (CUP)', 'espagnol', '+53', 'droite', '10 %, en devise'),
	c('DO', ['République dominicaine', 'Punta Cana'], '911', 'A, B', '110 V', 'peso dominicain (DOP)', 'espagnol', '+1', 'droite', '10 % inclus par la loi'),
	c('CR', ['Costa Rica'], '911', 'A, B', '120 V', 'colón (CRC)', 'espagnol', '+506', 'droite', '10 % inclus'),
	c('CO', ['Colombie'], '123', 'A, B', '110 V', 'peso colombien (COP)', 'espagnol', '+57', 'droite', '10 % proposés à l’addition'),
	c('PE', ['Pérou'], '105 (police), 116 (SAMU)', 'A, B, C', '220 V', 'sol (PEN)', 'espagnol, quechua', '+51', 'droite', '10 %'),
	c('BR', ['Brésil'], '190 (police), 192 (SAMU)', 'C, N', '127 V et 220 V selon l’État', 'real (BRL)', 'portugais', '+55', 'droite', '10 % inclus'),
	c('AR', ['Argentine', 'Patagonie'], '911 (101 police, 107 ambulance)', 'C, I', '220 V', 'peso argentin (ARS)', 'espagnol', '+54', 'droite', '10 %'),
	c('CL', ['Chili'], '133 (police), 131 (ambulance)', 'C, L', '220 V', 'peso chilien (CLP)', 'espagnol', '+56', 'droite', '10 % proposés à l’addition')
];

const fold = (s: string) => s.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[-’']/g, ' ').replace(/\s+/g, ' ');

const byName = new Map<string, CountryFacts>();
for (const country of COUNTRIES) for (const name of country.names) byName.set(fold(name), country);

/** The country a trip names (French name or alias, accents and case ignored), null when the table does not know it. */
export function countryOf(name: string): CountryFacts | null {
	return byName.get(fold(name)) ?? null;
}

/** The country of an ISO 3166-1 alpha-2 code (from the geocoder), null when unknown. */
export function countryByCode(code: string | undefined): CountryFacts | null {
	return (code && COUNTRIES.find((c) => c.code === code.toUpperCase())) || null;
}

/** Slug of a country on the « Conseils aux voyageurs » site, from its usual French name. */
const ADVICE_SLUGS: Record<string, string> = { VN: 'vietnam', CZ: 'republique-tcheque', MU: 'maurice', TW: 'taiwan', AE: 'emirats-arabes-unis', GB: 'royaume-uni', US: 'etats-unis', KR: 'coree-du-sud', ZA: 'afrique-du-sud', DO: 'republique-dominicaine', NZ: 'nouvelle-zelande' };

/** « Conseils aux voyageurs » page of the French foreign office for the country. */
export function travelAdviceUrl(country: CountryFacts): string {
	const slug = ADVICE_SLUGS[country.code] ?? fold(country.names[0]!).replace(/ /g, '-');
	return `https://www.diplomatie.gouv.fr/fr/conseils-aux-voyageurs/conseils-par-pays-destination/${slug}/`;
}

export const EMBASSIES_URL = 'https://www.diplomatie.gouv.fr/fr/le-ministere-et-son-reseau/annuaires-et-adresses-du-ministere-de-l-europe-et-des-affaires-etrangeres-meae/ambassades-et-consulats-francais-a-l-etranger/';
export const ADVICE_HOME_URL = 'https://www.diplomatie.gouv.fr/fr/conseils-aux-voyageurs/';
