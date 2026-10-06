/**
 * Brand logos of the merchants named in operation and deadline labels (pure, testable): a bundled
 * set of brands with their colour and keywords, `merchantLogo`, which finds the brand a label names,
 * and the glyphs themselves in merchantGlyphs.ts, loaded on first use (150 KB of SVG paths kept out
 * of the main chunk). Nothing is fetched at run time: the app sends no merchant name anywhere.
 *
 * Glyphs, colours and names come from Simple Icons 16.34.0 (https://simpleicons.org), a collection
 * released under CC0 1.0; icons carrying a licence of their own other than CC0 are left out. Brand
 * names and logos remain trademarks of their owners and are used here only to identify the
 * merchant of an operation. Generated on 2026-10-06: 141 brands. Brands absent from Simple Icons
 * (EDF, Free, Amazon, Decathlon…) have no logo here and are never drawn by hand.
 *
 * To add a brand: copy its hex colour into a new entry of MERCHANT_BRANDS and the `d` of its Simple
 * Icons SVG into GLYPHS (merchantGlyphs.ts) under the same name, the entry placed before any brand
 * it must win against (the first match wins: « UBER EATS »
 * before « UBER », merchants before the platforms and payment processors that bill for them), give
 * it precise keywords (precision before recall: a wrong logo is worse than a category icon) and add
 * a label to tests/merchantLogos.test.ts.
 */

export interface MerchantLogo {
	/** Brand name (tooltip, key of its glyph in merchantGlyphs.ts). */
	name: string;
	/** Brand colour, #rrggbb. */
	color: string;
}

export interface MerchantBrand extends MerchantLogo {
	/**
	 * Upper-case words without accents or punctuation, matched as whole words of the label (« ORANGE »
	 * never matches « ORANGERIE »). « ^ » in front or « $ » at the end pins a keyword to the start or
	 * the end of the label, for names that are also common words, first names or towns.
	 */
	keywords: readonly string[];
	/** Same form as the keywords: one of them in the label cancels the match (« PHARMACIE DU CARREFOUR » is not the retailer). */
	except?: readonly string[];
}

/** Bundled brands, in match order: the first brand with a keyword in the label wins. */
export const MERCHANT_BRANDS: readonly MerchantBrand[] = [
	{ name: 'Uber Eats', color: '#06c167', keywords: ['UBER EATS', 'UBEREATS'] },
	{ name: 'Deliveroo', color: '#00ccbc', keywords: ['DELIVEROO'] },
	{ name: 'Just Eat', color: '#ff8000', keywords: ['JUST EAT', 'JUSTEAT'] },
	{ name: "McDonald's", color: '#fbc817', keywords: ['MCDONALD', 'MCDONALDS', 'MC DONALD', 'MC DONALDS', 'MCDO'] },
	{ name: 'Burger King', color: '#d62300', keywords: ['BURGER KING', 'BURGERKING'] },
	{ name: 'KFC', color: '#f40027', keywords: ['KFC'] },
	{ name: 'Starbucks', color: '#006241', keywords: ['STARBUCKS'] },
	{ name: 'HelloFresh', color: '#99cc33', keywords: ['HELLOFRESH', 'HELLO FRESH'] },
	{ name: 'Carrefour', color: '#004e9f', keywords: ['CARREFOUR', 'CARREFOURMARKET', 'CRF CITY', 'CRF EXPRESS', 'CRF MARKET', 'CRF CONTACT', 'CRF MKT', 'CRF PROXI', 'CRF DRIVE'], except: ['DU CARREFOUR', 'LE CARREFOUR', 'AU CARREFOUR', 'CARREFOUR DE', 'CARREFOUR DES', 'CARREFOUR DU'] },
	{ name: 'Lidl', color: '#0050aa', keywords: ['LIDL'] },
	{ name: 'Aldi', color: '#2490d7', keywords: ['ALDI'] },
	{ name: 'Auchan', color: '#d6180b', keywords: ['AUCHAN'] },
	{ name: 'E.Leclerc', color: '#0066cc', keywords: ['E LECLERC', 'LECLERC DRIVE', 'LECLERC STATION', 'LECLERC EXPRESS', 'CENTRE LECLERC', 'LECLERC SP'] },
	{ name: 'Intermarché', color: '#e2001a', keywords: ['INTERMARCHE'] },
	{ name: 'Monoprix', color: '#fb1911', keywords: ['MONOPRIX', 'MONOP'] },
	{ name: 'Franprix', color: '#ec6237', keywords: ['FRANPRIX'] },
	{ name: 'Picard', color: '#2d4999', keywords: ['PICARD SURGELES', 'PICARD SURGELE', 'PICARD SURG'] },
	{ name: 'Grand Frais', color: '#ed2d2f', keywords: ['GRAND FRAIS', 'GRANDFRAIS'] },
	{ name: 'IKEA', color: '#0058a3', keywords: ['IKEA'] },
	{ name: 'Leroy Merlin', color: '#78be20', keywords: ['LEROY MERLIN', 'LEROY MERLI', 'LEROYMERLIN'] },
	{ name: 'Castorama', color: '#0078d7', keywords: ['CASTORAMA'] },
	{ name: 'Fnac', color: '#e1a925', keywords: ['FNAC'] },
	{ name: 'Darty', color: '#eb1b23', keywords: ['DARTY'] },
	{ name: 'Boulanger', color: '#fd5300', keywords: ['^BOULANGER$', 'BOULANGER COM', 'BOULANGER SA', 'BOULANGER ELECTROMENAGER', 'BOULANGER MULTIMEDIA'] },
	{ name: 'Cultura', color: '#1d2c54', keywords: ['CULTURA'] },
	{ name: 'AliExpress', color: '#ff4747', keywords: ['ALIEXPRESS', 'ALI EXPRESS'] },
	{ name: 'eBay', color: '#e53238', keywords: ['EBAY'] },
	{ name: 'Etsy', color: '#f16521', keywords: ['ETSY'] },
	{ name: 'Vinted', color: '#007782', keywords: ['VINTED'] },
	{ name: 'Zalando', color: '#ff6900', keywords: ['ZALANDO'] },
	{ name: 'Veepee', color: '#ec008c', keywords: ['VEEPEE', 'VENTE PRIVEE', 'VENTEPRIVEE'] },
	{ name: 'Rakuten', color: '#bf0000', keywords: ['RAKUTEN', 'PRICEMINISTER'] },
	{ name: 'Zara', color: '#000000', keywords: ['ZARA'] },
	{ name: 'H&M', color: '#e50010', keywords: ['HM', 'HM COM', 'HENNES MAURITZ'] },
	{ name: 'Uniqlo', color: '#ff0000', keywords: ['UNIQLO'] },
	{ name: 'Nike', color: '#111111', keywords: ['NIKE'] },
	{ name: 'Adidas', color: '#000000', keywords: ['ADIDAS'] },
	{ name: 'SNCF', color: '#ca0939', keywords: ['SNCF', 'OUIGO', 'INOUI', 'TGV'] },
	{ name: 'Uber', color: '#000000', keywords: ['UBER'] },
	{ name: 'Lyft', color: '#ff00bf', keywords: ['LYFT'] },
	{ name: 'Tesla', color: '#cc0000', keywords: ['TESLA'] },
	{ name: 'Air France', color: '#002157', keywords: ['AIR FRANCE', 'AIRFRANCE'] },
	{ name: 'easyJet', color: '#ff6600', keywords: ['EASYJET', 'EASY JET'] },
	{ name: 'Ryanair', color: '#073590', keywords: ['RYANAIR'] },
	{ name: 'KLM', color: '#00a1de', keywords: ['KLM'] },
	{ name: 'Lufthansa', color: '#05164d', keywords: ['LUFTHANSA'] },
	{ name: 'Airbnb', color: '#ff5a5f', keywords: ['AIRBNB'] },
	{ name: 'Booking.com', color: '#003a9a', keywords: ['BOOKING COM', 'BOOKINGCOM', '^BOOKING$', '^BOOKING', 'BOOKING$'] },
	{ name: 'Hotels.com', color: '#ef3346', keywords: ['HOTELS COM', 'HOTELSCOM'] },
	{ name: 'Expedia', color: '#191e3b', keywords: ['EXPEDIA'] },
	{ name: 'trivago', color: '#e32851', keywords: ['TRIVAGO'] },
	{ name: 'Shell', color: '#ffd500', keywords: ['SHELL'] },
	{ name: 'Renault', color: '#ffcc33', keywords: ['RENAULT RETAIL', 'RENAULT MINUTE', 'GARAGE RENAULT', 'RENAULT SAS', 'CONCESSION RENAULT', 'AGENT RENAULT', 'RENAULT OCCASION'] },
	{ name: 'Peugeot', color: '#000000', keywords: ['PEUGEOT'] },
	{ name: 'Citroën', color: '#da291c', keywords: ['CITROEN'] },
	{ name: 'Dacia', color: '#646b52', keywords: ['DACIA'] },
	{ name: 'Toyota', color: '#eb0a1e', keywords: ['TOYOTA'] },
	{ name: 'Volkswagen', color: '#151f5d', keywords: ['VOLKSWAGEN'] },
	{ name: 'Orange', color: '#ff7900', keywords: ['^ORANGE$', 'ORANGE$', 'ORANGE SA', 'ORANGE FRANCE', 'ORANGE INTERNET', 'ORANGE MOBILE', 'ORANGE FIBRE', 'ORANGE LIVEBOX', 'ORANGE BOUTIQUE', 'BOUTIQUE ORANGE', 'ORANGE BANK', 'ORANGE CARAIBE', 'ORANGE REUNION', 'ORANGE PRO', 'ORANGE BUSINESS', 'LIVEBOX'] },
	{ name: 'Netflix', color: '#e50914', keywords: ['NETFLIX'] },
	{ name: 'Spotify', color: '#1ed760', keywords: ['SPOTIFY'] },
	{ name: 'Deezer', color: '#a238ff', keywords: ['DEEZER'] },
	{ name: 'YouTube Music', color: '#ff0000', keywords: ['YOUTUBE MUSIC', 'YOUTUBEMUSIC'] },
	{ name: 'YouTube', color: '#ff0000', keywords: ['YOUTUBE', 'YOUTUBEPREMIUM'] },
	{ name: 'Twitch', color: '#9146ff', keywords: ['TWITCH'] },
	{ name: 'Crunchyroll', color: '#ff5e00', keywords: ['CRUNCHYROLL'] },
	{ name: 'HBO', color: '#000000', keywords: ['HBO'] },
	{ name: 'TIDAL', color: '#000000', keywords: ['TIDAL'] },
	{ name: 'Audible', color: '#f8991c', keywords: ['AUDIBLE'] },
	{ name: 'Patreon', color: '#000000', keywords: ['PATREON'] },
	{ name: 'Discord', color: '#5865f2', keywords: ['DISCORD'] },
	{ name: 'Tinder', color: '#ff6b6b', keywords: ['TINDER'] },
	{ name: 'PlayStation', color: '#0070d1', keywords: ['PLAYSTATION'] },
	{ name: 'Steam', color: '#000000', keywords: ['STEAM', 'STEAMGAMES', 'STEAMPOWERED'] },
	{ name: 'Epic Games', color: '#313131', keywords: ['EPIC GAMES', 'EPICGAMES'] },
	{ name: 'Riot Games', color: '#eb0029', keywords: ['RIOT GAMES', 'RIOTGAMES'] },
	{ name: 'Ubisoft', color: '#000000', keywords: ['UBISOFT'] },
	{ name: 'EA', color: '#000000', keywords: ['ELECTRONIC ARTS', 'EA GAMES', 'EA SPORTS', 'EA COM'] },
	{ name: 'GOG.com', color: '#86328a', keywords: ['GOG COM', 'GOG'] },
	{ name: 'Roblox', color: '#000000', keywords: ['ROBLOX'] },
	{ name: 'Battle.net', color: '#4381c3', keywords: ['BATTLE NET', 'BLIZZARD'] },
	{ name: 'Claude', color: '#d97757', keywords: ['CLAUDE AI', 'CLAUDEAI', 'ANTHROPIC CLAUDE', 'CLAUDE ANTHROPIC', 'CLAUDE CODE', 'CLAUDE PRO', 'CLAUDE MAX', 'CLAUDE SUBSCRIPTION'] },
	{ name: 'Anthropic', color: '#191919', keywords: ['ANTHROPIC'] },
	{ name: 'Mistral AI', color: '#fa520f', keywords: ['MISTRAL AI', 'MISTRALAI'] },
	{ name: 'Perplexity', color: '#1fb8cd', keywords: ['PERPLEXITY'] },
	{ name: 'DeepSeek', color: '#5786fe', keywords: ['DEEPSEEK'] },
	{ name: 'OpenRouter', color: '#94a3b8', keywords: ['OPENROUTER'] },
	{ name: 'Replicate', color: '#000000', keywords: ['REPLICATE'] },
	{ name: 'ElevenLabs', color: '#000000', keywords: ['ELEVENLABS', 'ELEVEN LABS'] },
	{ name: 'Hugging Face', color: '#ffd21e', keywords: ['HUGGING FACE', 'HUGGINGFACE'] },
	{ name: 'Cursor', color: '#000000', keywords: ['CURSOR'] },
	{ name: 'GitHub', color: '#181717', keywords: ['GITHUB'] },
	{ name: 'GitLab', color: '#fc6d26', keywords: ['GITLAB'] },
	{ name: 'JetBrains', color: '#000000', keywords: ['JETBRAINS'] },
	{ name: 'Notion', color: '#000000', keywords: ['NOTION'] },
	{ name: 'Figma', color: '#f24e1e', keywords: ['FIGMA'] },
	{ name: 'Docker', color: '#2496ed', keywords: ['DOCKER'] },
	{ name: 'Dropbox', color: '#0061ff', keywords: ['DROPBOX'] },
	{ name: 'OVH', color: '#123f6d', keywords: ['OVH', 'OVHCLOUD'] },
	{ name: 'Scaleway', color: '#4f0599', keywords: ['SCALEWAY'] },
	{ name: 'Hetzner', color: '#d50c2d', keywords: ['HETZNER'] },
	{ name: 'Cloudflare', color: '#f38020', keywords: ['CLOUDFLARE'] },
	{ name: 'DigitalOcean', color: '#0080ff', keywords: ['DIGITALOCEAN', 'DIGITAL OCEAN'] },
	{ name: 'Vercel', color: '#000000', keywords: ['VERCEL'] },
	{ name: 'Netlify', color: '#00c7b7', keywords: ['NETLIFY'] },
	{ name: 'Supabase', color: '#3fcf8e', keywords: ['SUPABASE'] },
	{ name: 'Gandi', color: '#6640fe', keywords: ['GANDI'] },
	{ name: 'Namecheap', color: '#de3723', keywords: ['NAMECHEAP'] },
	{ name: 'Infomaniak', color: '#0098ff', keywords: ['INFOMANIAK'] },
	{ name: 'Proton', color: '#6d4aff', keywords: ['PROTON', 'PROTONMAIL', 'PROTONVPN'] },
	{ name: 'ExpressVPN', color: '#da3940', keywords: ['EXPRESSVPN', 'EXPRESS VPN'] },
	{ name: 'Mullvad', color: '#294d73', keywords: ['MULLVAD'] },
	{ name: '1Password', color: '#145fe4', keywords: ['1PASSWORD'] },
	{ name: 'Bitwarden', color: '#175ddc', keywords: ['BITWARDEN'] },
	{ name: 'Dashlane', color: '#0e353d', keywords: ['DASHLANE'] },
	{ name: 'Zoom', color: '#0b5cff', keywords: ['ZOOM US', 'ZOOM VIDEO', 'ZOOM COM'] },
	{ name: 'Udemy', color: '#a435f0', keywords: ['UDEMY'] },
	{ name: 'Duolingo', color: '#58cc02', keywords: ['DUOLINGO'] },
	{ name: 'Strava', color: '#fc4c02', keywords: ['STRAVA'] },
	{ name: 'Ticketmaster', color: '#026cdf', keywords: ['TICKETMASTER'] },
	{ name: 'Kickstarter', color: '#05ce78', keywords: ['KICKSTARTER'] },
	{ name: 'Ulule', color: '#18a5d6', keywords: ['ULULE'] },
	{ name: 'DHL', color: '#ffcc00', keywords: ['DHL'] },
	{ name: 'UPS', color: '#150400', keywords: ['UPS'] },
	{ name: 'FedEx', color: '#4d148c', keywords: ['FEDEX'] },
	{ name: 'DPD', color: '#dc0032', keywords: ['DPD'] },
	{ name: 'Revolut', color: '#191c1f', keywords: ['REVOLUT'] },
	{ name: 'N26', color: '#48ac98', keywords: ['N26'] },
	{ name: 'Wise', color: '#9fe870', keywords: ['WISE EUROPE', 'WISE PAYMENTS', 'TRANSFERWISE', 'WISE COM', '^WISE$'] },
	{ name: 'Lydia', color: '#0180ff', keywords: ['LYDIA SOLUTIONS', 'LYDIA APP', 'LYDIA SAS', '^LYDIA$'] },
	{ name: 'Binance', color: '#f0b90b', keywords: ['BINANCE'] },
	{ name: 'Coinbase', color: '#0052ff', keywords: ['COINBASE'] },
	{ name: 'Apple Music', color: '#fa243c', keywords: ['APPLE MUSIC'] },
	{ name: 'Apple TV', color: '#000000', keywords: ['APPLE TV'] },
	{ name: 'iCloud', color: '#3693f3', keywords: ['ICLOUD'] },
	{ name: 'Apple', color: '#000000', keywords: ['APPLE', 'ITUNES'] },
	{ name: 'Google Play', color: '#414141', keywords: ['GOOGLE PLAY', 'GOOGLEPLAY'] },
	{ name: 'Google Cloud', color: '#4285f4', keywords: ['GOOGLE CLOUD'] },
	{ name: 'Google', color: '#4285f4', keywords: ['GOOGLE'] },
	{ name: 'Klarna', color: '#ffb3c7', keywords: ['KLARNA'] },
	{ name: 'PayPal', color: '#002991', keywords: ['PAYPAL'] },
];

/** Words a bank puts before the merchant (« PRLV SEPA », « PAIEMENT CB »): skipped, so a keyword can be pinned to the start of the label. */
const BANK_PREFIXES: ReadonlySet<string> = new Set(['PRLV', 'PRELEVEMENT', 'SEPA', 'CB', 'CARTE', 'PAIEMENT', 'PAIEMENTS', 'PSC', 'VIR', 'VIREMENT', 'INST', 'EMET']);

/** Expression of one keyword: whole words of the label (their space optional: « UBEREATS »), pinned to its start or its end when asked. */
function keywordPattern(keyword: string): string {
	const start = keyword.startsWith('^');
	const end = keyword.endsWith('$');
	return `${start ? '^' : '(?:^| )'}${keyword.slice(start ? 1 : 0, end ? -1 : undefined).replace(/ /g, ' ?')}${end ? '$' : '(?: |$)'}`;
}

/** Compiled keywords and exceptions of each brand, in the order of MERCHANT_BRANDS. */
const MATCHERS: readonly { match: RegExp; except: RegExp | null }[] = MERCHANT_BRANDS.map((brand) => ({
	match: new RegExp(brand.keywords.map(keywordPattern).join('|')),
	except: brand.except ? new RegExp(brand.except.map(keywordPattern).join('|')) : null
}));

/**
 * Label as the keywords read it: no accents, upper case, an ampersand between two letters folded
 * (« H&M » → HM), punctuation turned into spaces, numbers (dates, references) and leading bank
 * prefixes dropped.
 */
function normalise(label: string): string {
	const words = label
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toUpperCase()
		.replace(/\b([A-Z])&([A-Z])\b/g, '$1$2')
		.replace(/[^A-Z0-9]+/g, ' ')
		.trim()
		.split(' ')
		.filter((word) => !/^\d+$/.test(word));
	let first = 0;
	while (first < words.length && BANK_PREFIXES.has(words[first]!)) first++;
	return words.slice(first).join(' ');
}

/** Label → logo cache: rows ask for the same labels at every render. */
const cache = new Map<string, MerchantLogo | null>();

/** Logo of the brand named in an operation or deadline label, null when none is known. */
export function merchantLogo(label: string): MerchantLogo | null {
	const hit = cache.get(label);
	if (hit !== undefined) return hit;
	const text = normalise(label);
	const index = text ? MATCHERS.findIndex((matcher) => matcher.match.test(text) && !matcher.except?.test(text)) : -1;
	const logo = index < 0 ? null : MERCHANT_BRANDS[index]!;
	cache.set(label, logo);
	return logo;
}

type Glyphs = Readonly<Record<string, string>>;
let glyphs: Glyphs | null = null;
let loading: Promise<Glyphs> | null = null;

/** Loads the glyphs once (dynamic import of merchantGlyphs.ts); resolves with every path by brand name. */
export function loadGlyphs(): Promise<Glyphs> {
	loading ??= import('./merchantGlyphs').then((m) => (glyphs = m.GLYPHS));
	return loading;
}

/** SVG path of a brand's glyph once loaded, null before `loadGlyphs` resolved or for an unknown name. */
export function glyphOf(name: string): string | null {
	return glyphs?.[name] ?? null;
}

