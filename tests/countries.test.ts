import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COUNTRIES, countryByCode, countryOf, travelAdviceUrl } from '../src/lib/countries';

test('countryOf: French names and aliases, accents, case and hyphens ignored', () => {
	assert.equal(countryOf('Portugal')?.code, 'PT');
	assert.equal(countryOf('  états-unis ')?.code, 'US');
	assert.equal(countryOf('Etats Unis')?.code, 'US');
	assert.equal(countryOf('USA')?.code, 'US');
	assert.equal(countryOf('Vietnam')?.code, 'VN');
	assert.equal(countryOf('République tchèque')?.code, 'CZ');
	assert.equal(countryOf('Ile Maurice')?.code, 'MU');
	assert.equal(countryOf('Atlantide'), null);
	assert.equal(countryOf(''), null);
});

test('countryByCode and the table itself', () => {
	assert.equal(countryByCode('jp')?.names[0], 'Japon');
	assert.equal(countryByCode(undefined), null);
	assert.equal(countryByCode('ZZ'), null);
	assert.equal(new Set(COUNTRIES.map((c) => c.code)).size, COUNTRIES.length);
	assert.ok(COUNTRIES.length >= 60);
	for (const c of COUNTRIES) {
		assert.match(c.code, /^[A-Z]{2}$/);
		assert.match(c.dialling, /^\+\d{1,3}$/);
		assert.ok(c.emergency && c.plugs && c.voltage && c.currency && c.languages && c.tipping, c.code);
	}
	assert.equal(countryOf('Japon')?.drive, 'gauche');
	assert.equal(countryOf('Japon')?.voltage, '100 V');
});

test('travelAdviceUrl: slug from the usual name, overrides where the site differs', () => {
	assert.equal(travelAdviceUrl(countryOf('Portugal')!), 'https://www.diplomatie.gouv.fr/fr/conseils-aux-voyageurs/conseils-par-pays-destination/portugal/');
	assert.equal(travelAdviceUrl(countryOf('Émirats arabes unis')!), 'https://www.diplomatie.gouv.fr/fr/conseils-aux-voyageurs/conseils-par-pays-destination/emirats-arabes-unis/');
	assert.equal(travelAdviceUrl(countryOf('Vietnam')!), 'https://www.diplomatie.gouv.fr/fr/conseils-aux-voyageurs/conseils-par-pays-destination/vietnam/');
	assert.equal(travelAdviceUrl(countryOf('Sri Lanka')!), 'https://www.diplomatie.gouv.fr/fr/conseils-aux-voyageurs/conseils-par-pays-destination/sri-lanka/');
});
