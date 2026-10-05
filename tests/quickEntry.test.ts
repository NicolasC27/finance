import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Transaction } from '../src/lib/types';
import { draftToTransaction, isStale, labelsMatch, matchQuickEntries, parseQuickEntry, readQuickAnswer } from '../src/lib/quickEntry';

const TODAY = '2026-10-05';

test('saisie rapide sans IA : montant, libellé, date, sens', () => {
	assert.deepEqual(parseQuickEntry('leboncoin 20,25e', TODAY), { label: 'leboncoin', amount: 20.25, credit: false, date: TODAY });
	assert.deepEqual(parseQuickEntry('20.25 € leboncoin', TODAY), { label: 'leboncoin', amount: 20.25, credit: false, date: TODAY });
	assert.equal((parseQuickEntry('restaurant hier 34 €', TODAY) as { date: string }).date, '2026-10-04');
	assert.equal((parseQuickEntry('restaurant hier 34 €', TODAY) as { label: string }).label, 'restaurant');
	assert.equal((parseQuickEntry('plein avant-hier 62', TODAY) as { date: string }).date, '2026-10-03');
	assert.equal((parseQuickEntry('cinéma samedi 12,50', TODAY) as { date: string }).date, '2026-10-03', 'dernier samedi');
	assert.equal((parseQuickEntry('pharmacie le 28 8,90 €', TODAY) as { date: string }).date, '2026-09-28', 'le 28 : mois précédent');
	assert.equal((parseQuickEntry('garage 12/09 1 200 €', TODAY) as { amount: number }).amount, 1200);
	assert.equal((parseQuickEntry('garage 12/09 1 200 €', TODAY) as { date: string }).date, '2026-09-12');
	assert.equal((parseQuickEntry('vente vinted 15 €', TODAY) as { credit: boolean }).credit, true);
	assert.equal((parseQuickEntry('+40 remboursement Léa', TODAY) as { credit: boolean }).credit, true);
	assert.equal((parseQuickEntry('loyer 2026 780 €', TODAY) as { amount: number }).amount, 780, "l'année n'est pas le montant");
	assert.ok('error' in parseQuickEntry('boulangerie', TODAY));
	assert.ok('error' in parseQuickEntry('   ', TODAY));
});

test('réponse de l’IA lue et vérifiée', () => {
	const cats = ['alimentation', 'loisirs'];
	assert.deepEqual(readQuickAnswer('```json\n{"libelle":"Restaurant","montant":34,"sens":"debit","date":"2026-10-04","categorie":"alimentation"}\n```', cats, TODAY), { label: 'Restaurant', amount: 34, credit: false, date: '2026-10-04', categoryId: 'alimentation' });
	assert.equal(readQuickAnswer('{"libelle":"X","montant":"12,5","categorie":"inconnue","date":"2030-01-01"}', cats, TODAY)?.date, TODAY, 'date future refusée');
	assert.equal(readQuickAnswer('{"libelle":"X","montant":"12,5","categorie":"inconnue"}', cats, TODAY)?.categoryId, undefined);
	assert.equal(readQuickAnswer('pas du json', cats, TODAY), null);
	assert.equal(readQuickAnswer('{"libelle":"","montant":3}', cats, TODAY), null);
});

const bank = (date: string, amount: number, label: string, credit = false): Transaction => ({
	transaction_amount: { amount: amount.toFixed(2), currency: 'EUR' },
	booking_date: date,
	value_date: date,
	remittance_information: [label],
	credit_debit_indicator: credit ? 'CRDT' : 'DBIT',
	account: 'cm-1',
	source: 'cm-xlsx'
});

test('rapprochement à l’import : montant, fenêtre de dates, libellé', () => {
	const manual = [
		draftToTransaction({ label: 'leboncoin', amount: 20.25, credit: false, date: '2026-10-01' }, 'cm-1'),
		draftToTransaction({ label: 'restaurant', amount: 34, credit: false, date: '2026-10-02' }, 'cm-1'),
		draftToTransaction({ label: 'cadeau', amount: 15, credit: false, date: '2026-10-02' }, 'cm-1')
	];
	assert.equal(manual[0]!.source, 'manual');
	const incoming = [
		bank('2026-10-03', 20.25, 'PAIEMENT CB 0110 PARIS LEBONCOIN CARTE 1234'),
		bank('2026-10-04', 34, 'PAIEMENT CB 0210 LYON BISTROT DU COIN'),
		bank('2026-10-04', 15, 'PAIEMENT CB FNAC'),
		bank('2026-10-04', 15, 'PAIEMENT CB DECATHLON'),
		bank('2026-10-20', 20.25, 'PAIEMENT CB LEBONCOIN')
	];
	const m = matchQuickEntries(manual, incoming);
	assert.deepEqual(m, [{ manual: 0, incoming: 0 }, { manual: 1, incoming: 1 }], 'libellé proche, ou candidat unique ; deux candidats sans indice : rien');
	assert.deepEqual(matchQuickEntries(manual, incoming, (tx) => tx.remittance_information[0] === 'leboncoin'), [{ manual: 1, incoming: 1 }], 'entrée séparée par l’utilisateur');
	assert.deepEqual(matchQuickEntries([manual[0]!], [bank('2026-10-03', 20.25, 'LEBONCOIN', true)]), [], 'sens différent');
	assert.ok(labelsMatch('Leboncoin', 'PAIEMENT CB 0110 PARIS LEBONCOIN'));
	assert.equal(labelsMatch('restaurant', 'BISTROT DU COIN'), false);
	assert.equal(isStale(manual[0]!, '2026-10-20'), true);
	assert.equal(isStale(manual[0]!, '2026-10-05'), false);
	assert.equal(isStale(manual[0]!, undefined), false);
});

test('apprentissage : mots du libellé, votes, suggestion, plafond', async () => {
	const { learnQuick, suggestFromMemory, memoryWords } = await import('../src/lib/quickEntry');
	assert.deepEqual(memoryWords('Leboncoin vinyles pour Léa 20'), ['leboncoin', 'vinyles', 'lea']);
	let mem = learnQuick({}, 'leboncoin vinyles', 'loisirs', 'culture-sorties');
	assert.deepEqual(suggestFromMemory(mem, 'vinyles jazz'), { categoryId: 'loisirs', subId: 'culture-sorties', word: 'vinyles' });
	mem = learnQuick(mem, 'leboncoin canapé', 'logement', 'travaux-equipement', 2);
	assert.equal(suggestFromMemory(mem, 'leboncoin')?.categoryId, 'logement', 'le choix le plus voté gagne');
	assert.equal(suggestFromMemory(mem, 'boulangerie'), null);
	const capped = learnQuick(learnQuick({}, 'aaa bbb', 'autre', null), 'ccc', 'autre', null, 5, 1);
	assert.deepEqual(Object.keys(capped), ['ccc'], 'les mots les moins utilisés partent');
});

test('IA : sous-catégorie acceptée seulement si elle appartient à la catégorie', () => {
	const subs = [{ id: 'culture-sorties', categoryId: 'loisirs' }, { id: 'courses', categoryId: 'alimentation' }];
	assert.equal(readQuickAnswer('{"libelle":"Vinyles","montant":20,"categorie":"loisirs","sous_categorie":"culture-sorties"}', ['loisirs', 'alimentation'], TODAY, subs)?.subId, 'culture-sorties');
	assert.equal(readQuickAnswer('{"libelle":"Vinyles","montant":20,"categorie":"loisirs","sous_categorie":"courses"}', ['loisirs', 'alimentation'], TODAY, subs)?.subId, undefined);
});

test('paiement : partage carte / titres, forfait Swile réduit par les repas saisis', async () => {
	const { splitVoucherPayment } = await import('../src/lib/quickEntry');
	const { swileLump } = await import('../src/lib/portage');
	assert.deepEqual(splitVoucherPayment(32, 25), { voucher: 25, card: 7 });
	assert.deepEqual(splitVoucherPayment(18, 25), { voucher: 18, card: 0 });
	assert.deepEqual(splitVoucherPayment(30, 25 - 13), { voucher: 12, card: 18 }, '13 € déjà payés en Swile ce jour');
	assert.deepEqual(splitVoucherPayment(40, 0), { voucher: 0, card: 40 });
	assert.equal(swileLump(220, 45.5), 174.5);
	assert.equal(swileLump(100, 130), 0);
});

test('mots du quotidien', async () => {
	const { everydayCategory } = await import('../src/lib/quickEntry');
	assert.deepEqual(everydayCategory('déjeuner 9,50'), { categoryId: 'alimentation', subId: 'restaurants' });
	assert.deepEqual(everydayCategory('plein total'), { categoryId: 'voiture', subId: 'carburant' });
	assert.deepEqual(everydayCategory('dentiste'), { categoryId: 'sante', subId: 'soins' });
	assert.equal(everydayCategory('vinyles'), null);
});

test('paiement nommé dans la phrase, sinon carte', () => {
	assert.deepEqual(parseQuickEntry('resto 30 € swile', TODAY), { label: 'resto', amount: 30, credit: false, date: TODAY, payment: 'swile' });
	assert.equal((parseQuickEntry('fnac 40 € en chèques culture', TODAY) as { payment?: string }).payment, 'culture');
	assert.equal((parseQuickEntry('fnac 40 € en chèques culture', TODAY) as { label: string }).label, 'fnac');
	assert.equal((parseQuickEntry('restaurant 32 €', TODAY) as { payment?: string }).payment, undefined, 'carte par défaut');
	assert.equal((parseQuickEntry('restaurant 32 € cb', TODAY) as { label: string }).label, 'restaurant');
});
