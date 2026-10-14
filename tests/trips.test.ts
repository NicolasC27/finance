import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clockAt, compareQuotes, defaultChecklist, envelopeActuals, formatTripDates, isFarAbroad, nextDeadline, perDay, phaseLabel, photoQueries, plannedTotal, reshiftChecklist, sanitizeTrips, sortTrips, tripDays, tripLinks, tripPhase, validateTrip, withBoughtQuote, zoneOffset, type Trip } from '../src/lib/trips';
import { tripItems } from '../src/lib/schedule';

const trip: Trip = {
	id: 't1',
	name: 'Lisbonne',
	destination: 'Lisbonne',
	country: 'Portugal',
	start: '2027-04-10',
	end: '2027-04-16',
	travellers: 2,
	status: 'prevu',
	notes: '',
	photo: '',
	periodId: 'v1',
	goalId: null,
	envelopes: { transport: 300, hebergement: 560.5, repas: 350 },
	checklist: [],
	quotes: [
		{ id: 'q1', site: 'Booking', label: 'Appartement Alfama', price: 620, url: '', conditions: 'annulation gratuite J-7', date: '2026-10-01', envelope: 'hebergement', bought: false },
		{ id: 'q2', site: 'Airbnb', label: 'Studio Baixa', price: 560.5, url: '', conditions: '', date: '2026-10-02', envelope: 'hebergement', bought: false }
	],
	days: [],
	packing: [],
	createdAt: 1
};

test('days, totals and per-day budget', () => {
	assert.equal(tripDays(trip), 7);
	assert.equal(tripDays({ start: '', end: '' }), 0);
	assert.equal(plannedTotal(trip), 1210.5);
	assert.deepEqual(perDay(trip), { total: 172.93, perPerson: 86.46 });
	assert.equal(perDay({ ...trip, start: '', end: '' }), null);
});

test('defaultChecklist: dated from the departure, passport and visa only far abroad', () => {
	const far = defaultChecklist({ start: '2027-07-01', end: '2027-07-15', country: 'Japon' });
	assert.deepEqual(far.map((c) => c.kind), ['acompte', 'solde', 'annulation', 'passeport', 'visa', 'assurance', 'voiture', 'animaux', 'courrier', 'enregistrement']);
	assert.equal(far.find((c) => c.kind === 'acompte')!.date, '2027-05-02');
	assert.equal(far.find((c) => c.kind === 'enregistrement')!.date, '2027-06-30');
	assert.equal(far.find((c) => c.kind === 'animaux')!.date, '');
	assert.match(far.find((c) => c.kind === 'passeport')!.label, /jusqu’au 2028-01-14/);
	const eu = defaultChecklist({ start: '2027-07-01', end: '2027-07-15', country: 'Espagne' });
	assert.equal(eu.some((c) => c.kind === 'passeport' || c.kind === 'visa'), false);
	assert.equal(defaultChecklist({ start: '', end: '', country: '' }).every((c) => c.date === ''), true);
	assert.equal(isFarAbroad('États-Unis'), true);
	assert.equal(isFarAbroad('Grèce'), false);
	assert.equal(isFarAbroad(''), false);
});

test('reshiftChecklist: open default items follow the new departure, done and free ones stay', () => {
	const items = [
		{ id: 'a', kind: 'acompte' as const, label: 'Acompte', date: '2027-02-09', done: false },
		{ id: 'b', kind: 'solde' as const, label: 'Solde', date: '2027-03-11', done: true },
		{ id: 'c', kind: 'libre' as const, label: 'Réserver le resto', date: '2027-04-01', done: false }
	];
	const shifted = reshiftChecklist(items, '2027-04-10', '2027-04-17');
	assert.deepEqual(shifted.map((c) => c.date), ['2027-02-16', '2027-03-11', '2027-04-01']);
	assert.deepEqual(reshiftChecklist(items, '', '2027-04-17'), items);
});

test('sortTrips: coming first by departure, then undated ideas, then past trips', () => {
	const mk = (id: string, start: string, end: string, createdAt = 0): Trip => ({ ...trip, id, start, end, createdAt });
	const sorted = sortTrips([mk('past', '2025-08-02', '2025-08-14'), mk('idea', '', '', 5), mk('later', '2027-08-01', '2027-08-10'), mk('soon', '2026-12-20', '2026-12-27'), mk('idea2', '', '', 9)], '2026-10-07');
	assert.deepEqual(
		sorted.map((t) => t.id),
		['soon', 'later', 'idea2', 'idea', 'past']
	);
});

test('envelopeActuals: subcategories feed their envelope, unknown ones Extras', () => {
	const actuals = envelopeActuals([
		{ sub: 'vols', amount: 180 },
		{ sub: 'vac-transport', amount: 20.5 },
		{ sub: 'hebergement', amount: 600 },
		{ sub: 'vac-alimentation', amount: 90 },
		{ sub: null, amount: 12 },
		{ sub: 'inconnue', amount: 8 }
	]);
	assert.deepEqual(actuals, { transport: 200.5, hebergement: 600, repas: 90, activites: 0, assurance: 0, extras: 20 });
});

test('quotes: buying one fills the envelope and un-buys its siblings; comparison is cheapest first, bought on top', () => {
	const bought = withBoughtQuote(trip, 'q1');
	assert.equal(bought.envelopes.hebergement, 620);
	assert.deepEqual(bought.quotes.map((q) => q.bought), [true, false]);
	const switched = withBoughtQuote(bought, 'q2');
	assert.deepEqual(switched.quotes.map((q) => q.bought), [false, true]);
	assert.equal(switched.envelopes.hebergement, 560.5);
	assert.deepEqual(compareQuotes(switched.quotes, 'hebergement').map((q) => q.id), ['q2', 'q1']);
	assert.equal(withBoughtQuote(trip, 'nope'), trip);
});

test('tripPhase and phaseLabel: idea, countdown, on the spot, back', () => {
	assert.deepEqual(tripPhase({ start: '', end: '' }, '2026-10-07'), { kind: 'idea' });
	assert.deepEqual(tripPhase(trip, '2026-10-07'), { kind: 'before', days: 185 });
	assert.deepEqual(tripPhase(trip, '2027-04-10'), { kind: 'during', day: 1, days: 7 });
	assert.deepEqual(tripPhase(trip, '2027-04-16'), { kind: 'during', day: 7, days: 7 });
	assert.deepEqual(tripPhase(trip, '2027-04-17'), { kind: 'after', days: 1 });
	assert.deepEqual(phaseLabel({ kind: 'idea' }), { big: 'Idée', small: 'dates à fixer' });
	assert.deepEqual(phaseLabel({ kind: 'before', days: 185 }), { big: 'J−185', small: 'avant le départ' });
	assert.deepEqual(phaseLabel({ kind: 'before', days: 1 }), { big: 'J−1', small: 'départ demain' });
	assert.deepEqual(phaseLabel({ kind: 'during', day: 3, days: 7 }), { big: 'Jour 3', small: 'sur 7' });
	assert.deepEqual(phaseLabel({ kind: 'after', days: 12 }), { big: 'Terminé', small: 'retour il y a 12 j' });
	assert.deepEqual(phaseLabel({ kind: 'after', days: 95 }), { big: 'Terminé', small: 'retour il y a 3 mois' });
});

test('formatTripDates, clockAt and zoneOffset: French dates, the clock and the time difference on the spot', () => {
	assert.equal(formatTripDates('2027-04-10', '2027-04-16'), 'sam. 10 → ven. 16 avril 2027');
	assert.equal(formatTripDates('2027-04-29', '2027-05-04'), 'jeu. 29 avr. → mar. 4 mai 2027');
	assert.equal(formatTripDates('2027-12-30', '2028-01-04'), 'jeu. 30 déc. 2027 → mar. 4 janv. 2028');
	assert.equal(formatTripDates('', ''), '');
	const noon = Date.UTC(2027, 0, 15, 12, 0);
	assert.equal(clockAt('Asia/Tokyo', noon), '21:00');
	assert.equal(clockAt('Europe/Lisbon', noon), '12:00');
	assert.equal(clockAt(undefined, noon), '');
	assert.equal(clockAt('Mars/Olympus', noon), '');
	assert.equal(zoneOffset('Asia/Tokyo', noon, 'Europe/Paris'), '+8 h');
	assert.equal(zoneOffset('America/New_York', noon, 'Europe/Paris'), '−6 h');
	assert.equal(zoneOffset('Asia/Kolkata', noon, 'Europe/Paris'), '+4 h 30');
	assert.equal(zoneOffset('Europe/Madrid', noon, 'Europe/Paris'), '');
	assert.equal(zoneOffset('Asia/Tokyo', Date.UTC(2027, 6, 15, 12, 0), 'Europe/Paris'), '+7 h');
	assert.equal(zoneOffset(undefined, noon, 'Europe/Paris'), '');
});

test('photoQueries and nextDeadline', () => {
	assert.deepEqual(photoQueries(trip), ['Lisbonne', 'Portugal']);
	assert.deepEqual(photoQueries({ photo: 'Alfama', destination: 'Tokyo et Kyoto', country: 'Japon' }), ['Alfama', 'Tokyo et Kyoto', 'Tokyo', 'Japon']);
	assert.deepEqual(photoQueries({ photo: '', destination: 'Rome, Florence', country: '' }), ['Rome, Florence', 'Rome']);
	assert.deepEqual(photoQueries({ photo: '', destination: 'X', country: '<script>' }), []);
	const items = [
		{ id: 'a', kind: 'acompte' as const, label: 'Acompte', date: '2027-02-09', done: true },
		{ id: 'b', kind: 'solde' as const, label: 'Solde', date: '2027-03-11', done: false },
		{ id: 'c', kind: 'libre' as const, label: 'Resto', date: '', done: false },
		{ id: 'd', kind: 'annulation' as const, label: 'Annulation', date: '2027-01-20', done: false }
	];
	assert.equal(nextDeadline(items)?.id, 'd');
	assert.equal(nextDeadline(items.filter((i) => i.id !== 'd'))?.id, 'b');
	assert.equal(nextDeadline([]), null);
});

test('validateTrip and sanitizeTrips', () => {
	const base = { name: ' Lisbonne ', destination: 'Lisbonne', country: 'Portugal', start: '2027-04-10', end: '2027-04-16', travellers: 2, status: 'prevu' as const, notes: '', photo: '  Alfama   Lisbonne ' };
	const ok = validateTrip(base);
	assert.equal(ok.ok && ok.value.name, 'Lisbonne');
	assert.equal(ok.ok && ok.value.photo, 'Alfama Lisbonne');
	assert.equal(validateTrip({ ...base, photo: 'x'.repeat(61) }).ok, false);
	assert.equal(validateTrip({ ...base, name: ' ' }).ok, false);
	assert.equal(validateTrip({ ...base, end: '2027-04-01' }).ok, false);
	assert.equal(validateTrip({ ...base, end: '' }).ok, false);
	assert.equal(validateTrip({ ...base, travellers: 0 }).ok, false);
	assert.equal(validateTrip({ ...base, start: '', end: '' }).ok, true);
	const clean = sanitizeTrips([trip, { id: 'x' }, null, { id: 'y', name: 'Y', status: 'nope', envelopes: { transport: 'a', repas: 10 }, quotes: [{ id: 'q', price: 5, envelope: 'zzz' }] }]);
	assert.equal(clean.length, 2);
	assert.equal(clean[1]!.status, 'idee');
	assert.equal(clean[1]!.photo, '');
	assert.deepEqual(clean[1]!.envelopes, { repas: 10 });
	assert.equal(clean[1]!.quotes[0]!.envelope, 'extras');
	assert.deepEqual(sanitizeTrips('x'), []);
});

test('tripLinks: pre-filled with destination and dates where the site accepts them, home page otherwise', () => {
	const links = tripLinks(trip);
	const booking = links.find((l) => l.label === 'Booking')!;
	assert.equal(booking.prefilled, true);
	assert.match(booking.url, /ss=Lisbonne&checkin=2027-04-10&checkout=2027-04-16&group_adults=2/);
	assert.equal(links.find((l) => l.label === 'SNCF Connect')!.prefilled, false);
	assert.equal(links.every((l) => l.url.startsWith('https://')), true);
	assert.equal(tripLinks({ ...trip, start: '' }).every((l) => !l.prefilled), true);
});

test('tripItems: dated open checklist items and the departure appear in the schedule window', () => {
	const items = tripItems(
		[
			{
				id: 't1',
				name: 'Lisbonne',
				start: '2026-11-20',
				planned: 1210.5,
				checklist: [
					{ id: 'a', label: 'Acompte versé', date: '2026-10-15', done: false },
					{ id: 'b', label: 'Solde réglé', date: '2026-10-21', done: true },
					{ id: 'c', label: 'Garde des animaux', date: '', done: false },
					{ id: 'd', label: 'Trop loin', date: '2027-06-01', done: false }
				]
			}
		],
		'2026-10-07',
		'2027-01-05'
	);
	assert.deepEqual(
		items.map((i) => [i.id, i.date, i.label]),
		[
			['trip:t1:a', '2026-10-15', 'Acompte versé · Lisbonne'],
			['trip:t1:depart', '2026-11-20', 'Départ · Lisbonne']
		]
	);
	assert.equal(items[0]!.kind, 'trip');
	assert.equal(items[1]!.amount, 1210.5);
});
