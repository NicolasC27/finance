import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CategoryId, Transaction } from '../src/lib/types';
import { CATEGORIES, txKey } from '../src/lib/categories';
import { SUBCATEGORIES } from '../src/lib/subDict';
import {
	TRIAGE_BATCH_SIZE,
	anonymousLabel,
	buildTriageRequest,
	changedOps,
	groupProposals,
	parseTriageAnswer,
	parseTriageRequest,
	namesAPerson,
	privacyContext,
	privateParty,
	revertPlan,
	revertValues,
	scrubText,
	sureProposals,
	triageBatches,
	triageCatalogue,
	triageExamples,
	triageHolderNames,
	undoMessage,
	written,
	type TriageHistoryEntry,
	type TriageProposal,
	type WrittenValue
} from '../src/lib/aiTriage';

const CATALOGUE = triageCatalogue(CATEGORIES, SUBCATEGORIES);

function tx(label: string, amount: number, date = '2026-09-14', extra: Partial<Transaction> = {}): Transaction {
	return {
		transaction_amount: { amount: Math.abs(amount).toFixed(2), currency: 'EUR' },
		booking_date: date,
		value_date: date,
		remittance_information: [label],
		credit_debit_indicator: amount < 0 ? 'DBIT' : 'CRDT',
		...extra
	};
}

function past(label: string, categoryId: CategoryId, subId: string | null = null, manual = false): TriageHistoryEntry {
	return { tx: tx(label, -12.5, '2026-08-02'), categoryId, subId, manual };
}

/** Every string value of a payload, keys included. */
function allStrings(v: unknown): string[] {
	if (typeof v === 'string') return [v];
	if (Array.isArray(v)) return v.flatMap(allStrings);
	if (v && typeof v === 'object') return Object.entries(v).flatMap(([k, x]) => [k, ...allStrings(x)]);
	return [];
}

const OPERATION_FIELDS = new Set(['id', 'label', 'amount', 'date', 'account', 'bankCategory', 'bankSubcategory', 'note', 'merchant']);
const EXAMPLE_FIELDS = new Set(['merchant', 'categoryId', 'subId', 'count', 'manual']);

test('requête : seuls les champs autorisés partent, sans numéro de carte, IBAN, solde ni clé', () => {
	const card = tx('PAIEMENT CB 1309 VILLEFICTIVE BOULANGERIE DU PORT CARTE 4974XXXXXXXX1234', -12.5, '2026-09-14', {
		account: 'cm-00012345678',
		balance_after: 4321.09,
		tags: ['secret-tag'],
		analysis_date: '2026-09-30',
		bank_category: 'Alimentation',
		bank_subcategory: 'Petit commerçant',
		note: 'goûter de Léa'
	});
	const transfer = tx('VIR SEPA LEA EXEMPLE FR7630001007941234567890185 REMBOURSEMENT', 40, '2026-09-12', { account: 'cm-00012345678' });
	const { request, byId } = buildTriageRequest([card, transfer], [past('PAIEMENT CB 0208 VILLEFICTIVE BOULANGERIE DU PORT', 'alimentation', 'petits-commercants', true)], CATALOGUE, {
		accountKind: () => 'Compte courant'
	});
	assert.equal(request.operations.length, 2);
	for (const op of request.operations) for (const k of Object.keys(op)) assert.ok(OPERATION_FIELDS.has(k), `champ inattendu : ${k}`);
	for (const ex of request.examples) for (const k of Object.keys(ex)) assert.ok(EXAMPLE_FIELDS.has(k), `champ d’exemple inattendu : ${k}`);
	const text = allStrings(request).join(' ');
	for (const secret of ['4974', '7630001007941234567890185', '00012345678', 'secret-tag', '4321', '2026-09-30', 'balance', txKey(card), txKey(transfer)]) assert.ok(!text.includes(secret), `fuite : ${secret}`);
	assert.ok(!JSON.stringify(request).includes('4321.09'), 'aucun solde');
	assert.deepEqual(request.operations[0], {
		id: 't1',
		label: 'PAIEMENT CB 1309 VILLEFICTIVE BOULANGERIE DU PORT CARTE',
		amount: -12.5,
		date: '2026-09-14',
		account: 'Compte courant',
		bankCategory: 'Alimentation',
		bankSubcategory: 'Petit commerçant',
		note: 'goûter de …',
		merchant: 'Villefictive Boulangerie Du Port'
	});
	assert.equal(request.operations[1]!.amount, 40, 'crédit en positif');
	assert.equal(request.operations[1]!.label, 'Virement d’une personne (motif : remboursement)');
	assert.equal(request.operations[1]!.merchant, undefined, 'virement d’un particulier : ni nom ni commerçant');
	assert.equal(byId.get('t1'), card);
	assert.equal(byId.get('t2'), transfer);
	assert.deepEqual(request.examples, [{ merchant: 'Villefictive Boulangerie Du Port', categoryId: 'alimentation', subId: 'petits-commercants', count: 1, manual: true }]);
	assert.deepEqual(
		request.categories.map((c) => Object.keys(c).sort().join()),
		request.categories.map(() => 'id,label'),
		'catalogue : id et libellé seulement'
	);
});

test('requête : pas de compte sans libellé fourni, ids numérotés depuis firstId, lot plafonné', () => {
	const many = Array.from({ length: TRIAGE_BATCH_SIZE + 5 }, (_, i) => tx(`PAIEMENT CB 0109 COMMERCE ${i}`, -3, '2026-09-01', { account: 'cm-00012345678' }));
	const { request, byId } = buildTriageRequest(many, [], CATALOGUE, { firstId: 61 });
	assert.equal(request.operations.length, TRIAGE_BATCH_SIZE);
	assert.equal(request.operations[0]!.id, 't61');
	assert.equal(request.operations.at(-1)!.id, `t${60 + TRIAGE_BATCH_SIZE}`);
	assert.equal(byId.size, TRIAGE_BATCH_SIZE);
	assert.ok(request.operations.every((o) => o.account === undefined), "sans accountKind, aucun compte n'est envoyé");
	const numbered = buildTriageRequest(many.slice(0, 1), [], CATALOGUE, { accountKind: () => 'Compte courant ••5678' });
	assert.equal(numbered.request.operations[0]!.account, 'Compte courant …', 'un numéro glissé dans le type de compte est retiré');
});

test('scrubText : cartes, IBAN et références longues retirés, dates courtes et devises gardées', () => {
	assert.equal(scrubText('PAIEMENT PSC 0209 VILLEFICTIVE CAFE DU COIN 4974XXXXXXXX1234', 200), 'PAIEMENT PSC 0209 VILLEFICTIVE CAFE DU COIN …');
	assert.equal(scrubText('PRLV SEPA ASSO DES JARDINS UIR0123456789012345', 200), 'PRLV SEPA ASSO DES JARDINS …');
	assert.equal(scrubText('PAIEMENT CB 1209 AMAZON 12,99 USD', 200), 'PAIEMENT CB 1209 AMAZON 12,99 USD');
	assert.equal(scrubText('ligne\nsur deux', 200), 'ligne sur deux');
	assert.equal(scrubText('x'.repeat(50), 10), 'x'.repeat(10));
});

test('scrubText : IBAN en minuscules, numéros groupés (carte, téléphone) retirés, texte et dates gardés', () => {
	assert.equal(scrubText('loyer vers fr76 3000 6000 0112 3456 7890 189 merci', 200), 'loyer vers … merci');
	assert.equal(scrubText('carte 4974 1234 5678 9012 perdue', 200), 'carte … perdue');
	assert.equal(scrubText('4974 1234 5678 9012', 200), '…');
	assert.equal(scrubText('rappeler Léa au 06 12 34 56 78', 200), 'rappeler Léa au …');
	assert.equal(scrubText('le25 juin pour leclerc', 200), 'le25 juin pour leclerc', 'forme d’IBAN sans chiffres : gardée');
	assert.equal(scrubText('dîner du 2026-09-13 : 45,50 €', 200), 'dîner du 2026-09-13 : 45,50 €');
	assert.equal(scrubText('1 234,56 € le 13.10.2026', 200), '1 234,56 € le 13.10.2026');
});

test('scrubText : un téléphone a 10 chiffres en groupes réguliers, jamais une date ni une heure', () => {
	assert.equal(scrubText('ref le 05.10.2026 12.30', 200), 'ref le 05.10.2026 12.30', 'date puis heure');
	assert.equal(scrubText('rdv 05.10.26 à 09.15', 200), 'rdv 05.10.26 à 09.15');
	assert.equal(scrubText('du 01.02.2026 au 03.04.2026', 200), 'du 01.02.2026 au 03.04.2026');
	assert.equal(scrubText('appeler le 06.12.34.56.78 ou le 01 23 45 67 89', 200), 'appeler le … ou le …');
	assert.equal(scrubText('fixe 0033 (0)1 23 45 67 89', 200), 'fixe …');
	assert.equal(scrubText('portable +33612345678.', 200), 'portable ….');
	assert.equal(scrubText('carte 4974.1234.5678.9012', 200), 'carte …', 'carte en groupes pointés');
	assert.equal(scrubText('Tél,06-12-34-56-78', 200), 'Tél,…', 'après une virgule ou un point collé');
	assert.equal(scrubText('tel.06-12-34-56-78', 200), 'tel.…');
	assert.equal(scrubText('lot 1-0612345678901', 200), 'lot 1-…', 'pas un téléphone au milieu d’un nombre plus long (référence retirée)');
});

test('scrubText : cartes partiellement masquées, e-mails, téléphones et morceaux d’IBAN retirés', () => {
	assert.equal(scrubText('carte 4974 12XX XXXX 9012', 200), 'CARTE');
	assert.equal(scrubText('payé 4974 12XX XXXX 9012 hier', 200), 'payé … hier');
	assert.equal(scrubText('**** **** **** 9012', 200), '…');
	assert.equal(scrubText('carte finissant par XXXX 9012', 200), 'carte finissant par …');
	assert.equal(scrubText('carte cadeau librairie', 200), 'carte cadeau librairie', 'un mot après « carte » reste');
	assert.equal(scrubText('Compte courant ••5678', 200), 'Compte courant …');
	assert.equal(scrubText('écrire à lea.exemple@example.org svp', 200), 'écrire à … svp');
	assert.equal(scrubText('appeler le +33 6 12 34 56 78 vite', 200), 'appeler le … vite');
	assert.equal(scrubText('tel 06-12-34-56-78 ou 0612345678', 200), 'tel … ou …');
	assert.equal(scrubText('iban FR76 3000 6000 (début)', 200), 'iban … (début)');
	assert.equal(scrubText('vers FR76 **** **** 0189', 200), 'vers …');
	assert.equal(scrubText('taille XXL 12 ans', 200), 'taille XXL 12 ans', 'un mot avec des X reste');
	assert.equal(scrubText('PAIEMENT CB 1209 AMAZON 12,99 USD', 200), 'PAIEMENT CB 1209 AMAZON 12,99 USD');
	assert.equal(scrubText('VIR SEPA REF FA26 0012 LOYER OCTOBRE', 200), 'VIR SEPA REF … LOYER OCTOBRE', 'le mot après un morceau d’IBAN reste');
	assert.equal(scrubText('VIR FR7630001007941234567890185 LOYER', 200), 'VIR … LOYER');
	assert.equal(scrubText('rdv le25 juin 2026', 200), 'rdv le25 juin 2026', 'un mot collé à un nombre n’est pas un IBAN');
	assert.equal(scrubText('vers FR76 XXXX XXXX XXXX XXXX 0189 ou FR76XXXXXXXX0189', 200), 'vers … ou …', 'IBAN masqué par des X');
});

test('personnes : nom du titulaire ou particulier sur un virement, jamais sur un paiement par carte', () => {
	const ctx = privacyContext({ holderNames: ['JEAN', 'DUPONT'] });
	const none = privacyContext();
	assert.equal(privateParty('VIR SEPA M JEAN DUPONT', ctx), 'holder', 'deux noms du titulaire : son propre compte');
	assert.equal(privateParty('VIR SEPA MME LEA EXEMPLE LOYER', ctx), 'person');
	assert.equal(privateParty('VIR SEPA DUPONT CLAIRE', ctx), 'person', 'un seul nom du titulaire : un proche');
	assert.equal(privateParty('PRLV SEPA M. LEA EXEMPLE', none), 'person');
	assert.equal(privateParty('PRLV SEPA C M ASSURANCES', none), null, 'une initiale n’est pas un titre');
	assert.equal(privateParty('PAIEMENT CB 1209 MR BRICOLAGE', ctx), null, 'un paiement par carte va à un commerce');
	assert.equal(privateParty('VIR SEPA SAS ACME DUPONT JEAN SALAIRE', ctx), null, 'les noms après l’employeur : un salaire, pas son propre compte');
	assert.equal(privateParty('VIR INST DE M. JEAN DUPONT', ctx), 'holder');
	assert.equal(privateParty('PRLV SEPA CREDIT EXEMPLE PR IMMO', none), null, '« PR » n’est pas un titre');
	assert.ok(namesAPerson('VIR SEPA SOCIETE EXEMPLE SALAIRE', none), 'habitudes : jamais un virement');
	assert.ok(namesAPerson('PAIEMENT CB 1209 LYDIA LEA EXEMPLE', none), 'habitudes : jamais une appli entre particuliers');
	assert.ok(namesAPerson('PRLV SEPA MME LEA EXEMPLE', none), 'prélèvement avec un titre');
	assert.ok(namesAPerson('PAIEMENT CB 1209 BOULANGERIE DUPONT', ctx), 'nom du titulaire');
	assert.ok(!namesAPerson('PRLV SEPA ASSO DES JARDINS', ctx));
	assert.ok(!namesAPerson('PAIEMENT CB 1209 CINEMA DU PORT', ctx));
});

test('personnes : un titre ne signale une personne que sur un virement ou un prélèvement, jamais sur un paiement par carte', () => {
	const none = privacyContext();
	assert.ok(!namesAPerson('PAIEMENT CB 1809 MR BRICOLAGE', none), 'l’enseigne « Mr Bricolage » reste une habitude');
	assert.ok(!namesAPerson('PAIEMENT CB 1209 MME EXEMPLE COUTURE', none), 'une couturière payée par carte est un commerce');
	assert.ok(!namesAPerson('PAIEMENT CB 1209 VILLEFICTIVE DR EXEMPLE MEDECIN', none), 'un cabinet payé par carte est un commerce');
	assert.ok(!namesAPerson('PAIEMENT CB 1209 LYDIA', none), 'l’appli seule ne nomme personne');
	assert.ok(!namesAPerson('PRLV SEPA PAYPAL EUROPE S.A.R.L. ET CIE S.C.A', none), 'PayPal suivi d’une société');
	const { request } = buildTriageRequest([tx('PAIEMENT CB 1309 CINEMA DU PORT', -9)], [past('PAIEMENT CB 1809 MR BRICOLAGE', 'logement'), past('PAIEMENT CB 1709 LYDIA LEA EXEMPLE', 'loisirs')], CATALOGUE);
	assert.deepEqual(request.examples.map((e) => e.merchant), ['Mr Bricolage']);
	const relayed = parseTriageRequest({ ...request, examples: [...request.examples, { merchant: 'Lydia Lea Exemple', categoryId: 'loisirs', count: 2 }, { merchant: 'Vir Sepa Lea Exemple', categoryId: 'loisirs', count: 1 }] });
	assert.ok(typeof relayed !== 'string');
	assert.deepEqual(relayed.examples.map((e) => e.merchant), ['Mr Bricolage'], 'le relais garde l’enseigne et refuse l’appli entre particuliers et le virement, comme l’app');
});

test('personnes : un virement ou une appli vers un inconnu part sans nom, avec le sens, la date, le montant et la catégorie de la banque', () => {
	const history = [past('PAIEMENT CB 0108 ATELIER MODELE', 'loisirs')];
	const ops = [
		tx('VIR SEPA LEA EXEMPLE', -30, '2026-09-10', { bank_category: 'Virements émis' }),
		tx('VIR INST LYDIA LEA EXEMPLE', -15),
		tx('VIR INST LYDIA LEA EXEMPLE', 15),
		tx('VIR SEPA MME J EXEMPLE', -20),
		tx('PAIEMENT CB 1209 PAYPAL *LEAEXEMPLE', -12),
		tx('VIR SEPA LOYER LEA EXEMPLE', -500),
		tx('VIR INST LEA EXEMPLE SNCF', 40),
		tx('VIR SEPA ACME SARL FACTURE 12', -80),
		tx('VIR CAF PRESTATIONS FAMILIALES', 120),
		tx('VIR SEPA EDF REMBOURSEMENT', 25),
		tx('VIR SEPA ATELIER MODELE FACTURE', -60),
		tx('VIR SEPA LIVRET A', -100),
		tx('VIR SEPA REMBOURSEMENT', 10),
		tx('PRLV SEPA PAYPAL EUROPE S.A.R.L. ET CIE S.C.A 1234567890123 PAYPAL', -9)
	];
	const { request } = buildTriageRequest(ops, history, CATALOGUE);
	assert.deepEqual(request.operations[0], { id: 't1', label: 'Virement à une personne', amount: -30, date: '2026-09-10', bankCategory: 'Virements émis' });
	assert.deepEqual(
		request.operations.slice(1, 7).map((o) => [o.label, o.merchant]),
		[
			['Paiement Lydia à une personne', undefined],
			['Paiement Lydia d’une personne', undefined],
			['Virement à une personne', undefined],
			['Paiement PayPal à un bénéficiaire masqué', undefined],
			['Virement à une personne (motif : loyer)', undefined],
			['Virement d’une personne', undefined]
		],
		'aucune entreprise connue : particulier'
	);
	assert.deepEqual(
		request.operations.slice(7).map((o) => o.label),
		['VIR SEPA ACME SARL FACTURE 12', 'VIR CAF PRESTATIONS FAMILIALES', 'VIR SEPA EDF REMBOURSEMENT', 'VIR SEPA ATELIER MODELE FACTURE', 'VIR SEPA LIVRET A', 'VIR SEPA REMBOURSEMENT', 'PRLV SEPA PAYPAL EUROPE S.A.R.L. ET CIE S.C.A … PAYPAL'],
		'forme juridique, organisme, commerçant du dictionnaire ou de l’historique, ou aucun nom : libellé gardé'
	);
	const words = new Set(allStrings(request.operations).join(' ').toUpperCase().split(/[^A-Z]+/));
	for (const secret of ['LEA', 'EXEMPLE', 'LEAEXEMPLE']) assert.ok(!words.has(secret), `fuite : ${secret}`);
	assert.equal(anonymousLabel('VIR INST LEA EXEMPLE CADEAU ANNIVERSAIRE', -50, 'person'), 'Virement à une personne (motif : cadeau, anniversaire)', 'seuls les mots de motif connus restent');
	assert.equal(privateParty('VIR SEPA MUTUELLE EXEMPLE', privacyContext()), null, 'un organisme en tête');
	assert.equal(privateParty('VIR SEPA REMBOURSEMENT MUTUELLE EXEMPLE', privacyContext()), null, 'un organisme après un motif');
	assert.equal(privateParty('VIR SEPA LOYER SNCF', privacyContext()), null, 'un commerçant du dictionnaire après un motif');
	assert.equal(privateParty('VIR INST LEA EXEMPLE MUTUELLE', privacyContext()), 'person', 'le même mot après un nom est un motif');
});

test('personnes : un organisme ou un mot de société après un motif reste un motif, un titre désigne une personne', () => {
	const none = privacyContext();
	const ops = [
		tx('VIR SEPA LEA EXEMPLE REMB CAF', 50),
		tx('VIR INST LEA EXEMPLE PART CPAM', 20),
		tx('VIR INST LEA EXEMPLE VOYAGE EUROPE', -80),
		tx('VIR SEPA LEA EXEMPLE FRAIS SERVICES', -15),
		tx('VIR INST LEA EXEMPLE CADEAU GROUPE', -25),
		tx('VIR SEPA MME ZARA EXEMPLE', -30),
		tx('VIR INST LYDIA MME ZARA EXEMPLE', -10)
	];
	const { request } = buildTriageRequest(ops, [], CATALOGUE);
	assert.deepEqual(
		request.operations.map((o) => [o.label, o.merchant]),
		[
			['Virement d’une personne (motif : remb, caf)', undefined],
			['Virement d’une personne (motif : cpam)', undefined],
			['Virement à une personne (motif : voyage)', undefined],
			['Virement à une personne (motif : frais)', undefined],
			['Virement à une personne (motif : cadeau)', undefined],
			['Virement à une personne', undefined],
			['Paiement Lydia à une personne', undefined]
		],
		'organisme après un nom, mot de société après un motif, titre devant un nom qui est aussi une enseigne : particulier'
	);
	const words = new Set(allStrings(request.operations).join(' ').toUpperCase().split(/[^A-Z]+/));
	for (const secret of ['LEA', 'EXEMPLE', 'ZARA', 'MME']) assert.ok(!words.has(secret), `fuite : ${secret}`);
	assert.equal(privateParty('VIR SEPA ACME SERVICES', none), null, 'mot de société dans le nom');
	assert.equal(privateParty('VIR SEPA ACME SA FACTURE 12', none), null, '« SA » à la fin du nom, avant le motif');
	assert.equal(privateParty('VIR SEPA ACME TRAVAUX SARL', none), null, 'forme juridique après un mot de motif');
	assert.equal(privateParty('VIR SEPA ACME SARL M LEA EXEMPLE', none), null, 'forme juridique avant un titre : une société');
	assert.equal(privateParty('VIR SEPA REMBOURSEMENT SOINS CPAM', none), null, 'organisme en tête après les motifs');
	assert.equal(privateParty('PAIEMENT CB 1209 MME ZARA EXEMPLE', none), null, 'paiement par carte : un commerce, titre ou non');
	assert.ok(namesAPerson('PAIEMENT CB 1209 LYDIA MME ZARA EXEMPLE', none), 'habitudes : appli avec un titre');
	assert.ok(namesAPerson('PAIEMENT CB 1209 LYDIA LEA EXEMPLE REMB CAF', none), 'habitudes : organisme en motif d’une appli');
	const relayed = parseTriageRequest({ ...request, examples: [{ merchant: 'Lydia Mme Zara Exemple', categoryId: 'loisirs', count: 1 }, { merchant: 'Mme Exemple Couture', categoryId: 'loisirs', count: 1 }] });
	assert.ok(typeof relayed !== 'string');
	assert.deepEqual(relayed.examples.map((e) => e.merchant), ['Mme Exemple Couture'], 'le relais refuse l’appli avec un titre, garde le commerce payé par carte');
});

test('titulaires : noms courts et composés du registre, masqués mot à mot sous toutes leurs formes', () => {
	const names = triageHolderNames(['C/C EUROCOMPTE M JEAN-PAUL LI', 'LIVRET M OU MME LEA DE LA EXEMPLE', 'COMPTE SANS TITULAIRE']);
	assert.deepEqual(names, ['JEAN-PAUL', 'LI', 'LEA', 'DE', 'LA', 'EXEMPLE'], 'noms de 2 lettres gardés, « OU » et titres retirés');
	const privacy = privacyContext({ holderNames: names });
	const label = (raw: string) => buildTriageRequest([tx(raw, -5)], [], CATALOGUE, { privacy }).request.operations[0]!;
	assert.equal(label('PAIEMENT CB 1209 BOULANGERIE JEAN PAUL LI').label, 'PAIEMENT CB 1209 BOULANGERIE … … …', 'prénom composé écrit avec une espace');
	assert.equal(label('PAIEMENT CB 1209 BOULANGERIE JEANPAUL').label, 'PAIEMENT CB 1209 BOULANGERIE …', 'prénom composé collé');
	assert.equal(label('PAIEMENT CB 1209 JEAN-PAUL TRAITEUR').label, 'PAIEMENT CB 1209 … TRAITEUR', 'prénom composé avec un tiret');
	assert.equal(label('PAIEMENT CB 1209 CAISSE DE LA REGION').label, 'PAIEMENT CB 1209 CAISSE DE LA REGION', 'les particules seules restent');
	assert.equal(label('PAIEMENT CB 1209 LI SHOP').label, 'PAIEMENT CB 1209 LI SHOP', 'un nom court seul reste');
	assert.equal(label('PAIEMENT CB 1209 CHEZ LEA DE LA EXEMPLE').label, 'PAIEMENT CB 1209 CHEZ … … … …', 'nom à particule entier');
	assert.equal(label('VIR INST JEAN PAUL LI').label, 'Virement vers un compte à son nom', 'prénom composé et nom court : le titulaire');
	assert.equal(label('VIR INST JEAN PAUL MODELE').label, 'Virement à une personne', 'un seul nom du titulaire (composé) : un proche');
	const family = privacyContext({ holderNames: triageHolderNames(['C/C EUROCOMPTE M JEAN-PAUL DUPONT', 'LIVRET A M JEAN DUPONT']) });
	const solo = privacyContext({ holderNames: triageHolderNames(['C/C EUROCOMPTE M JEAN-PAUL DUPONT']) });
	assert.equal(privateParty('VIR INST JEAN DUPONT', solo), 'person', 'une partie du prénom composé ne prouve pas le titulaire : un proche');
	assert.equal(privateParty('VIR INST PAUL DUPONT', solo), 'person');
	assert.equal(privateParty('VIR INST JEAN PAUL DUPONT', solo), 'holder', 'prénom composé écrit en deux mots');
	assert.equal(privateParty('VIR INST DUPONT JEAN-PAUL', solo), 'holder');
	assert.equal(privateParty('VIR INST JEAN DUPONT', family), 'holder', 'JEAN est aussi le prénom entier d’un autre titulaire');
	assert.equal(buildTriageRequest([tx('PAIEMENT CB 1209 BOULANGERIE JEAN DUPONT', -5)], [], CATALOGUE, { privacy: solo }).request.operations[0]!.label, 'PAIEMENT CB 1209 BOULANGERIE … …', 'la partie reste masquée');
});

test('notes : les noms des autres personnes masqués, les mots utiles gardés', () => {
	const privacy = privacyContext({ holderNames: ['JEAN', 'DUPONT'], history: [past('PAIEMENT CB 0108 MODELEXPRESS', 'loisirs')], catalogue: CATALOGUE });
	const note = (text: string) => buildTriageRequest([tx('PAIEMENT CB 1209 CINEMA DU PORT', -9, '2026-09-13', { note: text })], [], CATALOGUE, { privacy }).request.operations[0]!.note;
	assert.equal(note('remboursé par Alex'), 'remboursé par …');
	assert.equal(note('Alex Modele m’a remboursé'), '… … m’a remboursé', 'prénom et nom en tête');
	assert.equal(note('Cadeau de Noël pour Léa, payé sur Amazon'), 'Cadeau de Noël pour …, payé sur Amazon', 'fête et commerçant du dictionnaire gardés');
	assert.equal(note('Courses avec jean. Santé ensuite'), 'Courses avec …. Santé ensuite', 'titulaire en minuscules, catégorie gardée');
	assert.equal(note('rdv Dr Exemple, puis Modelexpress'), 'rdv Dr …, puis Modelexpress', 'titre gardé, nom masqué, commerce de l’historique gardé');
	assert.equal(note('Loyer octobre'), 'Loyer octobre');
	assert.equal(note('rdv avec M. Modele'), 'rdv avec M. …', 'le point d’un titre n’ouvre pas de phrase');
	assert.equal(note('payé par Dr. Modele hier'), 'payé par Dr. … hier');
	assert.equal(note('vu avec J. Modele'), 'vu avec …. …', 'initiale et nom');
	assert.equal(note('Payé. Merci'), 'Payé. Merci', 'une vraie fin de phrase');
});

test('confidentialité : le contexte se construit une fois et sert à tout le lot', () => {
	const privacy = privacyContext({ holderNames: ['DUPONT'], history: [past('PAIEMENT CB 0108 ATELIER MODELE', 'loisirs')] });
	const ops = [tx('VIR SEPA ATELIER MODELE', -60), tx('PAIEMENT CB 1209 BOULANGERIE DUPONT', -3)];
	const { request } = buildTriageRequest(ops, [], CATALOGUE, { privacy, holderNames: ['AUTRE'] });
	assert.equal(request.operations[0]!.label, 'VIR SEPA ATELIER MODELE', 'commerce connu du contexte, même sans historique passé à la requête');
	assert.equal(request.operations[1]!.label, 'PAIEMENT CB 1209 BOULANGERIE …', 'noms du contexte, pas de holderNames');
});

test('requête : habitudes sans virement ni personne, opérations avec un particulier sans son nom', () => {
	const holders = ['JEAN', 'DUPONT'];
	const history = [
		past('VIR SEPA M JEAN DUPONT', 'epargne'),
		past('VIR INST LEA EXEMPLE REMBOURSEMENT', 'loisirs'),
		past('PRLV SEPA MME LEA EXEMPLE', 'logement'),
		past('PAIEMENT CB 0108 LYDIA LEA EXEMPLE', 'loisirs'),
		past('PAIEMENT CB 0108 BOULANGERIE DUPONT', 'alimentation'),
		past('PAIEMENT CB 0208 CINEMA DU PORT', 'loisirs', 'culture-sorties'),
		past('PRLV SEPA ASSO DES JARDINS', 'loisirs')
	];
	const ops = [
		tx('VIR SEPA MME LEA EXEMPLE LOYER', -450),
		tx('VIR INST M JEAN DUPONT', 300),
		tx('PAIEMENT CB 1309 CINEMA DU PORT', -9, '2026-09-13', { note: 'avec Jean et Léa' }),
		tx('VIR SEPA LEA EXEMPLE', 20),
		tx('VIR SEPA SAS ACME DUPONT JEAN SALAIRE', 1000)
	];
	const { request } = buildTriageRequest(ops, history, CATALOGUE, { holderNames: holders });
	assert.deepEqual(request.examples.map((e) => e.merchant).sort(), ['Asso Des Jardins', 'Cinema Du Port']);
	assert.deepEqual(request.operations[0], { id: 't1', label: 'Virement à une personne (motif : loyer)', amount: -450, date: '2026-09-14' });
	assert.deepEqual(request.operations[1], { id: 't2', label: 'Virement depuis un compte à son nom', amount: 300, date: '2026-09-14' });
	assert.equal(request.operations[2]!.note, 'avec … et …', 'noms masqués dans la note : le titulaire et les autres');
	assert.equal(request.operations[3]!.label, 'Virement d’une personne', 'sans titre ni entreprise connue : un particulier');
	assert.deepEqual(
		{ label: request.operations[4]!.label, merchant: request.operations[4]!.merchant },
		{ label: 'VIR SEPA SAS ACME … … SALAIRE', merchant: 'SAS Acme … … Salaire' },
		'un salaire reste un salaire, sans le nom du titulaire'
	);
	const words = new Set(allStrings(request).join(' ').toUpperCase().split(/[^A-Z]+/));
	for (const secret of ['JEAN', 'DUPONT', 'MME', 'LYDIA', 'LEA', 'EXEMPLE']) assert.ok(!words.has(secret), `fuite : ${secret}`);
	const relayed = parseTriageRequest({ ...request, examples: [{ merchant: 'Lydia Lea Exemple', categoryId: 'loisirs', count: 3 }, { merchant: 'Cinema Du Port', categoryId: 'loisirs', count: 1 }] });
	assert.ok(typeof relayed !== 'string');
	assert.deepEqual(relayed.examples.map((e) => e.merchant), ['Cinema Du Port'], 'le relais refuse aussi une habitude qui nomme une personne');
});

test('annulation : seules les valeurs encore posées par l’étape reviennent, les choix faits depuis restent', () => {
	const keys = Array.from({ length: 12 }, (_, i) => `k${i + 1}`);
	const store: Record<string, string | undefined> = {};
	const writes: WrittenValue<string>[] = keys.flatMap((k) => written<string>(k, k, undefined, 'alimentation'));
	for (const k of keys) store[k] = 'alimentation';
	store.k2 = 'loisirs';
	store.k5 = 'sante';
	delete store.k9;
	const plan = revertPlan(writes, (k) => store[k]);
	assert.deepEqual(plan.changedOps.sort(), ['k2', 'k5', 'k9']);
	assert.equal(Object.keys(plan.revert).length, 9);
	assert.ok(Object.values(plan.revert).every((v) => v === undefined), 'retour à « pas de choix »');
	assert.deepEqual(written('k1', 'k1', 'loisirs', 'loisirs'), [], 'une valeur inchangée n’est pas journalisée');
	const sub = revertPlan(written<string | null>('k1', 'k1', null, 'courses'), () => 'courses');
	assert.deepEqual(sub.revert, { k1: null }, '« aucune sous-catégorie » choisie avant revient');
	const rule = { categoryId: 'loisirs', createdAt: 2 };
	const sameRule = (a?: { categoryId: string; createdAt: number }, b?: { categoryId: string; createdAt: number }) => a?.categoryId === b?.categoryId && a?.createdAt === b?.createdAt;
	assert.deepEqual(revertPlan(written('KW', 'k1', undefined, rule, sameRule), () => ({ categoryId: 'loisirs', createdAt: 2 }), sameRule).changedOps, []);
	assert.deepEqual(revertPlan(written('KW', 'k1', undefined, rule, sameRule), () => ({ categoryId: 'loisirs', createdAt: 9 }), sameRule).changedOps, ['k1'], 'règle refaite depuis');
	const category = written<string>('k1', 'k1', undefined, 'alimentation');
	const subNow = revertPlan(written<string | null>('k1', 'k1', undefined, 'courses'), () => 'marche');
	assert.deepEqual(subNow, { revert: {}, changedOps: ['k1'] }, 'sous-catégorie changée à la main depuis');
	assert.deepEqual(revertPlan(category, () => 'alimentation', Object.is, new Set(subNow.changedOps)).revert, {}, 'l’opération reste entière : sa catégorie aussi');
	assert.deepEqual(revertPlan(category, () => 'alimentation', Object.is, new Set(['k2'])).revert, { k1: undefined }, 'une autre opération changée ne la retient pas');
	const stores = { cat: [...category, ...written<string>('k2', 'k2', 'loisirs', 'sante')], sub: written<string | null>('k2', 'k2', null, 'pharmacie') };
	const now: Record<string, string> = { k1: 'alimentation', k2: 'sante' };
	const changed = new Set([...changedOps(stores.cat, (k) => now[k]), ...changedOps(stores.sub, () => 'medecin')]);
	assert.deepEqual([...changed], ['k2'], 'une seule comparaison par entrée, tous magasins confondus');
	assert.deepEqual(revertValues(stores.cat, changed), { k1: undefined }, 'k2 changé dans un autre magasin : laissé entier');
	assert.deepEqual(revertValues(stores.sub, changed), {});
	assert.equal(undoMessage('12 propositions sûres validées', 0, 12), '12 propositions sûres validées');
	assert.equal(undoMessage('12 propositions sûres validées', 3, 12), '« 12 propositions sûres validées » annulé, sauf 3 opérations modifiées depuis (laissées telles quelles)');
	assert.equal(undoMessage('Cinema Du Port → Loisirs', 1, 1), 'Rien n’a été annulé pour « Cinema Du Port → Loisirs » : l’opération a changé depuis');
});

test('habitudes : catégorie majoritaire par commerçant, pertinentes puis manuelles puis fréquentes', () => {
	const history: TriageHistoryEntry[] = [
		...Array.from({ length: 5 }, () => past('PAIEMENT CB 0108 GRANDE SURFACE EXEMPLE', 'alimentation', 'courses')),
		past('PAIEMENT CB 0108 GRANDE SURFACE EXEMPLE', 'loisirs'),
		past('PAIEMENT CB 0208 LIBRAIRIE DES QUAIS', 'loisirs', 'culture-sorties', true),
		past('PAIEMENT CB 0308 CINEMA DU PORT', 'loisirs', 'culture-sorties'),
		past('PAIEMENT CB 0308 CINEMA DU PORT', 'loisirs', 'culture-sorties'),
		past('PAIEMENT CB 0408 COIFFEUR EXEMPLE', 'autre'),
		past('PAIEMENT CB 0508 MAGASIN INCONNU', 'loisirs', 'courses')
	];
	const batch = [tx('PAIEMENT CB 1209 CINEMA DU PORT', -9)];
	const examples = triageExamples(history, batch, CATALOGUE);
	assert.equal(examples[0]!.merchant, 'Cinema Du Port', 'commerçant de la file en tête');
	assert.equal(examples[1]!.merchant, 'Librairie Des Quais', 'puis ceux classés à la main');
	assert.deepEqual(examples[2], { merchant: 'Grande Surface Exemple', categoryId: 'alimentation', subId: 'courses', count: 5 });
	assert.deepEqual(examples.find((e) => e.merchant === 'Coiffeur Exemple'), { merchant: 'Coiffeur Exemple', categoryId: 'autre', count: 1 }, '« gardé en Autre » est une habitude');
	assert.deepEqual(examples.find((e) => e.merchant === 'Magasin Inconnu'), { merchant: 'Magasin Inconnu', categoryId: 'loisirs', count: 1 }, 'sous-catégorie hors catégorie ignorée');
	assert.equal(triageExamples(history, batch, CATALOGUE, 2).length, 2, 'plafond');
	for (const e of examples) assert.ok(!allStrings(e).some((s) => /12,5|12\.5|2026/.test(s)), 'ni montant ni date');
});

const IDS = ['t1', 't2', 't3', 't4', 't5', 't6', 't7'];

test('lecture : ids, catégories et sous-catégories vérifiés strictement', () => {
	const answer = parseTriageAnswer(
		{
			propositions: [
				{ id: 't1', kind: 'category', categoryId: 'alimentation', subId: 'courses', confidence: 'haute', reason: 'comme Grande Surface Exemple, 5 fois', always: true },
				{ id: 't1', kind: 'category', categoryId: 'loisirs', confidence: 'haute', reason: 'doublon' },
				{ id: 't99', kind: 'category', categoryId: 'loisirs', confidence: 'haute', reason: 'id inconnu' },
				{ id: 't2', kind: 'category', categoryId: 'jeux', confidence: 'haute', reason: 'catégorie inconnue' },
				{ id: 't3', kind: 'category', categoryId: 'loisirs', subId: 'courses', confidence: 'haute', reason: 'sous-catégorie fausse' },
				{ id: 't4', kind: 'category', categoryId: 'autre', subId: 'avances', confidence: 'moyenne', reason: 'avance à Léa' },
				{ id: 't5', kind: 'internal-transfer', categoryId: 'epargne', confidence: 'certaine', reason: 'vers son livret', always: true },
				{ id: 't6', kind: 'category', categoryId: 'vacances', confidence: 'moyenne', reason: 'hôtel', always: true },
				{ id: 't7', kind: 'devine', categoryId: 'loisirs', confidence: 'haute' },
				'pas un objet'
			],
			summary: 'Cinq opérations reconnues.\nDeux restent douteuses.'
		},
		IDS,
		CATALOGUE
	);
	assert.ok(!('error' in answer));
	assert.equal(answer.rejected, 5, 'doublon, id inconnu, catégorie inconnue, kind inconnu, pas un objet');
	assert.equal(answer.summary, 'Cinq opérations reconnues. Deux restent douteuses.');
	assert.deepEqual(answer.propositions, [
		{ id: 't1', kind: 'category', categoryId: 'alimentation', subId: 'courses', confidence: 'haute', reason: 'comme Grande Surface Exemple, 5 fois', always: true },
		{ id: 't3', kind: 'category', categoryId: 'loisirs', confidence: 'moyenne', reason: 'sous-catégorie fausse', always: false },
		{ id: 't4', kind: 'keep-other', subId: 'avances', confidence: 'moyenne', reason: 'avance à Léa', always: false },
		{ id: 't5', kind: 'internal-transfer', confidence: 'basse', reason: 'vers son livret', always: false },
		{ id: 't6', kind: 'category', categoryId: 'vacances', confidence: 'moyenne', reason: 'hôtel', always: false }
	]);
});

test('lecture : réponse brute dans un bloc de code ou avec du texte autour, virgule finale tolérée', () => {
	const raw = 'Voici mes propositions :\n```json\n{"propositions":[{"id":"t1","categoryId":"loisirs","confidence":"basse","reason":"cadeau ?"},],"summary":"ok"}\n```\nBonne journée.';
	const answer = parseTriageAnswer(raw, ['t1'], CATALOGUE);
	assert.ok(!('error' in answer));
	assert.deepEqual(answer.propositions, [{ id: 't1', kind: 'category', categoryId: 'loisirs', confidence: 'basse', reason: 'cadeau ?', always: false }], 'kind absent + catégorie = category');
	assert.ok('error' in parseTriageAnswer('Je ne sais pas.', ['t1'], CATALOGUE));
	assert.ok('error' in parseTriageAnswer({ arbre: {} }, ['t1'], CATALOGUE));
	assert.ok('error' in parseTriageAnswer(null, ['t1'], CATALOGUE));
});

test('requête côté relais : validée, nettoyée et bornée', () => {
	const { request } = buildTriageRequest([tx('PAIEMENT CB 1309 CINEMA DU PORT', -9, '2026-09-13', { note: 'avec Léa' })], [past('PAIEMENT CB 0308 CINEMA DU PORT', 'loisirs', 'culture-sorties')], CATALOGUE);
	assert.deepEqual(parseTriageRequest(JSON.parse(JSON.stringify(request))), request, 'aller-retour sans perte');
	assert.equal(parseTriageRequest(null), 'Demande manquante.');
	assert.match(String(parseTriageRequest({ ...request, operations: [] })), /Entre 1 et/);
	const tooMany = Array.from({ length: TRIAGE_BATCH_SIZE + 1 }, (_, i) => ({ ...request.operations[0]!, id: `t${i + 1}` }));
	assert.match(String(parseTriageRequest({ ...request, operations: tooMany })), /Entre 1 et/);
	assert.match(String(parseTriageRequest({ ...request, operations: [{ ...request.operations[0]!, id: 'abc' }] })), /Identifiant/);
	assert.match(String(parseTriageRequest({ ...request, operations: [request.operations[0]!, request.operations[0]!] })), /Identifiant/);
	assert.match(String(parseTriageRequest({ ...request, operations: [{ ...request.operations[0]!, date: '13/09/2026' }] })), /Date/);
	assert.match(String(parseTriageRequest({ ...request, operations: [{ ...request.operations[0]!, amount: '9' }] })), /invalide/);
	const dirty = parseTriageRequest({
		...request,
		operations: [{ ...request.operations[0]!, label: 'VIR FR7630001007941234567890185\nLOYER', balance: 999 }],
		examples: [{ merchant: 'Cinema Du Port', categoryId: 'jeux', count: 2 }, { merchant: 'Librairie', categoryId: 'loisirs', subId: 'courses', count: 1 }]
	});
	assert.ok(typeof dirty !== 'string');
	assert.equal(dirty.operations[0]!.label, 'VIR … LOYER');
	assert.ok(!('balance' in dirty.operations[0]!), 'champ inconnu retiré');
	assert.deepEqual(dirty.examples, [{ merchant: 'Librairie', categoryId: 'loisirs', count: 1 }]);
});

const P = (id: string, kind: TriageProposal['kind'], confidence: TriageProposal['confidence'], categoryId?: CategoryId): TriageProposal => ({
	id,
	kind,
	confidence,
	reason: '',
	always: false,
	...(categoryId ? { categoryId } : {})
});

test('rapport : groupes par catégorie (les plus gros d’abord), puis Autre et virements, triés par confiance', () => {
	const items = [
		P('t1', 'category', 'basse', 'loisirs'),
		P('t2', 'internal-transfer', 'haute'),
		P('t3', 'category', 'moyenne', 'alimentation'),
		P('t4', 'keep-other', 'moyenne'),
		P('t5', 'category', 'haute', 'alimentation'),
		P('t6', 'category', 'haute', 'loisirs'),
		P('t7', 'category', 'moyenne', 'alimentation')
	];
	const groups = groupProposals(items);
	assert.deepEqual(
		groups.map((g) => [g.key, g.items.map((i) => i.id)]),
		[
			['alimentation', ['t5', 't3', 't7']],
			['loisirs', ['t6', 't1']],
			['keep-other', ['t4']],
			['internal-transfer', ['t2']]
		]
	);
	assert.equal(groups[0]!.categoryId, 'alimentation');
	assert.equal(groups[2]!.categoryId, undefined);
	assert.deepEqual(sureProposals(items).map((p) => p.id), ['t5', 't6'], 'seules les catégories de confiance haute sont sûres');
});

test('lots : la file est découpée par 60', () => {
	assert.deepEqual(triageBatches([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
	assert.equal(triageBatches(Array.from({ length: 130 }, (_, i) => i)).length, 3);
	assert.deepEqual(triageBatches([]), []);
});
