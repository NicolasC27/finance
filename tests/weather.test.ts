import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanQuery, describeSky, flagEmoji, formatDegrees, formatMillimetres, isPlace, observationHour, parseDaily, parseForecast, parsePlaces, pickPlace, placeLabel } from '../src/lib/weather';
import { cleanCoordinates } from '../server/weather';
import { describeFailure, serverError } from '../src/lib/localApi';

test('describeSky: every WMO code gets a label and one of the nine icons', () => {
	assert.deepEqual(describeSky(0), { label: 'Ciel dégagé', icon: 'sun' });
	assert.equal(describeSky(2).icon, 'cloud-sun');
	assert.equal(describeSky(3).label, 'Couvert');
	assert.equal(describeSky(45).icon, 'fog');
	assert.equal(describeSky(53).icon, 'drizzle');
	assert.equal(describeSky(63).label, 'Pluie');
	assert.equal(describeSky(75).icon, 'snow');
	assert.equal(describeSky(81).label, 'Averses');
	assert.equal(describeSky(86).icon, 'snow');
	assert.equal(describeSky(95).icon, 'storm');
	assert.equal(describeSky(99).label, 'Orage');
	assert.equal(describeSky(42).icon, 'cloud');
});

test('parsePlaces and parseForecast: read the API answers, drop what is incomplete', () => {
	const places = parsePlaces({ results: [{ name: 'Lyon', latitude: 45.75, longitude: 4.85, admin1: 'Auvergne-Rhône-Alpes', country: 'France' }, { name: '', latitude: 1, longitude: 2 }, { name: 'Nulle part', latitude: 'x' }] });
	assert.deepEqual(places, [{ name: 'Lyon', region: 'Auvergne-Rhône-Alpes', country: 'France', lat: 45.75, lon: 4.85 }]);
	assert.deepEqual(parsePlaces({}), []);
	const lisbon = parsePlaces({ results: [{ name: 'Lisbonne', latitude: 38.72, longitude: -9.13, country: 'Portugal', timezone: 'Europe/Lisbon', country_code: 'pt' }] })[0]!;
	assert.equal(lisbon.timezone, 'Europe/Lisbon');
	assert.equal(lisbon.countryCode, 'PT');
	assert.equal(flagEmoji(lisbon.countryCode), '🇵🇹');
	assert.equal(flagEmoji('x'), '');
	assert.equal(flagEmoji(undefined), '');
	const namesakes = [{ ...lisbon, name: 'Paris', country: 'États-Unis' }, { ...lisbon, name: 'Paris', country: 'France' }];
	assert.equal(pickPlace(namesakes, 'france')?.country, 'France');
	assert.equal(pickPlace(namesakes, 'Espagne')?.country, 'États-Unis');
	assert.equal(pickPlace(namesakes, '')?.country, 'États-Unis');
	assert.equal(pickPlace([], 'France'), null);
	const daily = parseDaily({ daily: { time: ['2026-10-08', '2026-10-09', 'bad', '2026-10-11'], weather_code: [0, 61, 3, null], temperature_2m_max: [21.4, 17, 15, 14], temperature_2m_min: [12.1, 10, 9, 8], precipitation_sum: [0, 4.2, 0, 0] } });
	assert.deepEqual(daily, [
		{ date: '2026-10-08', code: 0, max: 21.4, min: 12.1, precipitation: 0 },
		{ date: '2026-10-09', code: 61, max: 17, min: 10, precipitation: 4.2 }
	]);
	assert.deepEqual(parseDaily({}), []);
	assert.equal(placeLabel(places[0]!), 'Lyon, Auvergne-Rhône-Alpes (France)');
	assert.equal(placeLabel({ name: 'Lyon', region: '', country: '', lat: 1, lon: 2 }), 'Lyon');
	assert.equal(isPlace(places[0]), true);
	assert.equal(isPlace({ name: 'Lyon', lat: 'x', lon: 2 }), false);
	assert.equal(isPlace(null), false);
	const weather = parseForecast({ current: { time: '2026-10-07T14:30', temperature_2m: 18.6, weather_code: 3 }, daily: { temperature_2m_max: [21.2], temperature_2m_min: [11.4], precipitation_sum: [0.3] } });
	assert.deepEqual(weather, { code: 3, temperature: 18.6, max: 21.2, min: 11.4, precipitation: 0.3, at: '2026-10-07T14:30' });
	assert.equal(parseForecast({ current: { temperature_2m: 18 } }), null);
});

test('formats: French rounding and units, typographic minus, no-break spaces', () => {
	assert.equal(formatDegrees(18.6), '19 °');
	assert.equal(formatDegrees(-1.5), '−2 °');
	assert.equal(formatDegrees(-0.4), '0 °');
	assert.equal(formatMillimetres(0.3), '0,3 mm');
	assert.equal(formatMillimetres(12), '12 mm');
	assert.equal(observationHour('2026-10-07T14:30'), '14:30');
	assert.equal(observationHour(''), '');
});

test('cleanQuery: the punctuation of place names passes, injections and odd input do not', () => {
	assert.equal(cleanQuery('  Saint-Étienne  '), 'Saint-Étienne');
	assert.equal(cleanQuery("L'Isle-d'Abeau"), "L'Isle-d'Abeau");
	assert.equal(cleanQuery('Lyon, France'), 'Lyon, France');
	assert.equal(cleanQuery('St. Louis'), 'St. Louis');
	assert.equal(cleanQuery('Aix-en-Provence (13)'), 'Aix-en-Provence (13)');
	assert.equal(cleanQuery('a'), null);
	assert.equal(cleanQuery('Lyon; DROP TABLE'), null);
	assert.equal(cleanQuery('<b>Lyon</b>'), null);
	assert.equal(cleanQuery('x'.repeat(61)), null);
	assert.equal(cleanQuery(42), null);
});

test('cleanCoordinates: decimal strings within bounds only, rounded to 2 decimals', () => {
	assert.deepEqual(cleanCoordinates('45.74906', '4.84789'), { lat: 45.75, lon: 4.85 });
	assert.deepEqual(cleanCoordinates('-33.9', '-70.6'), { lat: -33.9, lon: -70.6 });
	assert.equal(cleanCoordinates('91', '0'), null);
	assert.equal(cleanCoordinates('abc', '0'), null);
	assert.equal(cleanCoordinates(null, null), null);
	assert.equal(cleanCoordinates('', ''), null);
	assert.equal(cleanCoordinates(' ', '0x10'), null);
	assert.equal(cleanCoordinates('1e1', '0'), null);
});

test('localApi: every error shape of the local server reads as one French message', () => {
	assert.equal(serverError({ error: ['Open-Meteo : HTTP 429'] }, 502), 'Open-Meteo : HTTP 429');
	assert.equal(serverError({ error: 'interdit', message: 'hôte non local' }, 403), 'hôte non local');
	assert.equal(serverError({ error: 'conflit' }, 409), 'conflit');
	assert.equal(serverError({}, 500), 'serveur local : erreur 500');
	assert.equal(describeFailure(new TypeError('Failed to fetch')), 'serveur local injoignable');
	assert.equal(describeFailure(new SyntaxError('Unexpected token <')), 'réponse illisible du serveur local');
	assert.equal(describeFailure(new DOMException('aborted', 'TimeoutError')), 'le serveur ne répond pas');
	assert.equal(describeFailure(new Error('Open-Meteo : HTTP 429')), 'Open-Meteo : HTTP 429');
});
