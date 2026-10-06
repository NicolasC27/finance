import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GLYPHS } from '../src/lib/merchantGlyphs';
import { glyphOf, loadGlyphs, MERCHANT_BRANDS, merchantLogo } from '../src/lib/merchantLogos';

const brandOf = (label: string) => merchantLogo(label)?.name ?? null;

test('merchantLogo: display labels and raw bank labels name their brand', () => {
	const cases: [string, string][] = [
		['Lyon LIDL', 'Lidl'],
		['Lyon Carrefour', 'Carrefour'],
		['CB CRF CITY 0908 LYON', 'Carrefour'],
		['San Francisco Anthropic Claude', 'Claude'],
		['ANTHROPIC PBC', 'Anthropic'],
		['Netflix Com', 'Netflix'],
		['Paris SNCF Connect', 'SNCF'],
		['OUIGO PARIS', 'SNCF'],
		['Orange Internet', 'Orange'],
		['Spotify', 'Spotify'],
		['PRLV SEPA SPOTIFY AB', 'Spotify'],
		['APPLE.COM/BILL', 'Apple'],
		['GOOGLE *YouTube', 'YouTube'],
		['Airbnb Paris', 'Airbnb'],
		['Lyon Ikea', 'IKEA'],
		['Paris Fnac', 'Fnac'],
		['GITHUB INC', 'GitHub'],
		['JETBRAINS S R O', 'JetBrains'],
		['OVH SAS', 'OVH'],
		['REVOLUT**1234*', 'Revolut']
	];
	for (const [label, brand] of cases) assert.equal(brandOf(label), brand, label);
});

test('merchantLogo: a brand missing from the bundled set gives no logo', () => {
	for (const label of ['Free Mobile', 'Lyon Decathlon', 'Luxembourg Amazon Eu', 'Lyon Total Access', 'Lyon Esso Express', 'EDF Clients Particuliers', 'Bouygues Telecom', 'Foncia Loyer Appartement']) {
		assert.equal(brandOf(label), null, label);
	}
});

test('merchantLogo: whole words only, and context for names that are also words, first names or towns', () => {
	const none = [
		'Lyon Boulangerie Du Parc',
		'Lille Le Boulanger Du Coin',
		'Orangerie Du Parc',
		'Orange Boulangerie Du Parc',
		'L Orange Bleue',
		'Freelance Mission',
		'VIR SEPA CLAUDE MARTIN',
		'VIR LYDIA MARTIN',
		'Pharmacie Du Carrefour',
		'Bar Le Carrefour',
		'Dr Leclerc Paul',
		'Cabinet Picard',
		'Pineapple Bar',
		'Dockers Store'
	];
	for (const label of none) assert.equal(brandOf(label), null, label);
	assert.equal(brandOf('Orange'), 'Orange');
	assert.equal(brandOf('PRLV SEPA ORANGE'), 'Orange');
	assert.equal(brandOf('PRLV SEPA ORANGE SA 0612345678'), 'Orange');
	assert.equal(brandOf('Boulanger'), 'Boulanger');
	assert.equal(brandOf('Lydia'), 'Lydia');
	assert.equal(brandOf('CLAUDE.AI SUBSCRIPTION'), 'Claude');
	assert.equal(brandOf('Carrefour Market Lyon'), 'Carrefour');
	assert.equal(brandOf('Leclerc Station Lyon'), 'E.Leclerc');
	assert.equal(brandOf('Picard Surgelés'), 'Picard');
});

test('merchantLogo: the most specific brand wins, billing platforms and payment processors come last', () => {
	assert.equal(brandOf('CB UBER *EATS'), 'Uber Eats');
	assert.equal(brandOf('UBER *TRIP HELP.UBER.COM'), 'Uber');
	assert.equal(brandOf('GOOGLE *YouTube Music'), 'YouTube Music');
	assert.equal(brandOf('APPLE MUSIC'), 'Apple Music');
	assert.equal(brandOf('PAYPAL *STEAM GAMES'), 'Steam');
	assert.equal(brandOf('PAYPAL *SPOTIFY'), 'Spotify');
	assert.equal(brandOf('KLARNA*ZALANDO'), 'Zalando');
	assert.equal(brandOf('PAYPAL EUROPE'), 'PayPal');
	assert.equal(brandOf('GOOGLE PLAY APPS'), 'Google Play');
	assert.equal(brandOf('GOOGLE ONE'), 'Google');
});

test('merchantLogo: accents, case, punctuation, numbers and bank prefixes do not matter', () => {
	assert.equal(brandOf('Garage Citroën Lyon'), 'Citroën');
	assert.equal(brandOf('CARTE 1234 PAIEMENT CB 0908 NETFLIX.COM'), 'Netflix');
	assert.equal(brandOf('h&m lyon'), 'H&M');
	assert.equal(brandOf("McDonald's Lyon"), "McDonald's");
	assert.equal(brandOf('E.Leclerc Lyon'), 'E.Leclerc');
	assert.equal(brandOf("Monop' Paris"), 'Monoprix');
	assert.equal(brandOf('Intermarché Lyon'), 'Intermarché');
	assert.equal(brandOf(''), null);
	assert.equal(brandOf('0908 1234'), null);
});

test('merchantLogo: the same label gives the same logo again', () => {
	const first = merchantLogo('Lyon LIDL');
	assert.ok(first);
	assert.equal(merchantLogo('Lyon LIDL'), first);
	assert.equal(merchantLogo('Lyon Boulangerie Du Parc'), null);
	assert.equal(merchantLogo('Lyon Boulangerie Du Parc'), null);
});

/** Keywords allowed below three letters: the bank writes « H&M », read as HM. */
const TWO_LETTER_KEYWORDS: ReadonlySet<string> = new Set(['HM']);

test('MERCHANT_BRANDS: every entry is well formed and can be reached by one of its keywords', () => {
	assert.ok(MERCHANT_BRANDS.length >= 100);
	assert.equal(new Set(MERCHANT_BRANDS.map((b) => b.name)).size, MERCHANT_BRANDS.length, 'unique names');
	for (const brand of MERCHANT_BRANDS) {
		assert.match(brand.color, /^#[0-9a-f]{6}$/, brand.name);
		assert.match(GLYPHS[brand.name] ?? '', /^[Mm][MmLlHhVvCcSsQqTtAaZz0-9eE.,\s+-]+$/, brand.name);
		assert.ok(brand.keywords.length > 0, brand.name);
		for (const keyword of [...brand.keywords, ...(brand.except ?? [])]) {
			assert.match(keyword, /^\^?[A-Z0-9]+( [A-Z0-9]+)*\$?$/, `${brand.name}: ${keyword}`);
			assert.ok(keyword.replace(/[\^$]/g, '').length >= 3 || TWO_LETTER_KEYWORDS.has(keyword), `${brand.name}: ${keyword}`);
		}
		assert.ok(
			brand.keywords.some((keyword) => brandOf(keyword.replace(/[\^$]/g, '')) === brand.name),
			`${brand.name} is hidden by an earlier brand`
		);
	}
});

test('merchantLogo: a surname is not a shop, initials are not H&M, a town before the brand still counts', () => {
	for (const label of ['Thomas Picard', 'M Leclerc Loyer Octobre', 'Dr Leclerc Paul', 'H M Dupont', 'SA H M Habitat']) assert.equal(merchantLogo(label), null, label);
	assert.equal(merchantLogo('Picard Surgeles Lyon')?.name, 'Picard');
	assert.equal(merchantLogo('Leclerc Drive Lyon')?.name, 'E.Leclerc');
	assert.equal(merchantLogo('H&M Lyon')?.name, 'H&M');
	assert.equal(merchantLogo('Lyon Orange')?.name, 'Orange');
	assert.equal(merchantLogo('Booking Paris')?.name, 'Booking.com');
});

test('loadGlyphs: every brand has its glyph, loaded once and then available synchronously', async () => {
	assert.equal(glyphOf('Spotify'), null);
	const glyphs = await loadGlyphs();
	assert.equal(Object.keys(glyphs).length, MERCHANT_BRANDS.length);
	assert.match(glyphOf('Spotify') ?? '', /^M/);
	assert.equal(glyphOf('Marque inconnue'), null);
});

