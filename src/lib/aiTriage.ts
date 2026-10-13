import type { CategoryId, Transaction } from './types';
import { signedAmount } from './data';
import { merchantLabel } from './merchant';
import { merchantDictFor } from './merchantDict';
import { subDictCategoryFor } from './subDict';
import { firstJsonObject, parseLenientJson } from './aiLayout';

/**
 * « ✨ Proposer avec l'IA » on the « À trier » queue (pure module, testable with tsx): the request
 * sent to the local relay (POST /tri), the strict reading of the answer, and the report helpers
 * (grouping by proposed category, « sûres » list).
 *
 * Only what a person sorting by hand would look at leaves the app: for each queued operation an
 * opaque id (t1, t2…), its label (card numbers, IBANs, e-mails, phone numbers, long references and
 * the holders' names removed; a transfer, a person-to-person payment or a direct debit whose other
 * side is not a known business reduced to « Virement à une personne », « Paiement Lydia à une
 * personne »… with its purpose words only), signed amount, date, account kind, bank category, note
 * (names masked) and merchant name; the category catalogue; and the user's habits as « merchant →
 * category » counts (no amount, no date, never a transfer, a person-to-person payment nor a
 * holder's name). Never a balance, a document, an account number or an operation key.
 */

/** What the AI proposes for one operation. */
export type TriageKind = 'category' | 'keep-other' | 'internal-transfer';
export type TriageConfidence = 'haute' | 'moyenne' | 'basse';

/** Operations per relay request: a longer queue is sent in several batches. */
export const TRIAGE_BATCH_SIZE = 60;
/** Most habits sent with a batch (the relevant ones first, then the most frequent). */
export const MAX_TRIAGE_EXAMPLES = 150;
const MAX_LABEL = 160;
const MAX_NOTE = 200;
const MAX_MERCHANT = 80;
const MAX_ACCOUNT = 60;
const MAX_BANK = 60;
const MAX_CATEGORY_LABEL = 60;
const MAX_REASON = 200;
const MAX_SUMMARY = 400;
const MAX_CATEGORIES = 30;
const MAX_SUBCATEGORIES = 80;
const OPERATION_ID = /^t\d{1,5}$/;
const CATALOGUE_ID = /^[a-z-]{2,30}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** One queued operation as the AI sees it. */
export interface TriageOperation {
	id: string;
	label: string;
	/** Signed amount in € (negative = spending). */
	amount: number;
	date: string;
	account?: string;
	bankCategory?: string;
	bankSubcategory?: string;
	note?: string;
	merchant?: string;
}

export interface TriageCatalogue {
	categories: { id: string; label: string }[];
	subcategories: { id: string; categoryId: string; label: string }[];
}

/** A habit of the user: how the operations of one merchant are categorised. */
export interface TriageExample {
	merchant: string;
	categoryId: string;
	subId?: string;
	/** Operations of that merchant in that category. */
	count: number;
	/** At least one of them was categorised by hand (override or rule). */
	manual?: boolean;
}

export interface TriageRequest extends TriageCatalogue {
	operations: TriageOperation[];
	examples: TriageExample[];
}

/** A checked proposal of the AI. */
export interface TriageProposal {
	/** Opaque operation id of the request (t1, t2…). */
	id: string;
	kind: TriageKind;
	/** Proposed category (kind 'category' only). */
	categoryId?: CategoryId;
	/** Subcategory of that category (or of « Autre » for keep-other). */
	subId?: string;
	confidence: TriageConfidence;
	/** Short French reason, may cite a similar past operation. */
	reason: string;
	/** The AI thinks every operation of that merchant belongs there (the user still opts in). */
	always: boolean;
}

export interface TriageAnswer {
	propositions: TriageProposal[];
	summary: string;
	/** Proposals refused by the checks (unknown id or category, duplicate, unusable). */
	rejected: number;
}

/** Categorised operation outside the queue, source of the habits. */
export interface TriageHistoryEntry {
	tx: Transaction;
	categoryId: CategoryId;
	subId: string | null;
	manual: boolean;
}

/** Report group: the proposals for one category, or the keep-other / internal-transfer ones. */
export interface TriageGroup<T extends TriageProposal> {
	key: string;
	kind: TriageKind;
	categoryId?: CategoryId;
	items: T[];
}

const KINDS: readonly TriageKind[] = ['category', 'keep-other', 'internal-transfer'];
/** Display order of the confidence levels (most certain first). */
export const CONFIDENCE_RANK: Readonly<Record<TriageConfidence, number>> = { haute: 0, moyenne: 1, basse: 2 };

/**
 * « CARTE » and the card number after it (a digit or a « * » in it: « carte cadeau » stays), with its
 * following 4-character groups (« CARTE 4974 12XX XXXX 9012 »).
 */
const CARD_RE = /\bCARTE\s+(?=[A-Z*]*[0-9*])[A-Z0-9*]{4,}(?![\p{L}\p{N}*])(?:[ .-][0-9X*•]{4}(?![\p{L}\p{N}*•]))*/giu;
const MASKED_CARD_RE = /\b\d{4}[X*]{4,}\d{0,4}\b/gi;
/** Card numbers in 4-character groups, plain or partly masked: « 4974 12XX XXXX 9012 », « **** **** **** 9012 ». */
const CARD_GROUPS_RE = /(?<![\p{L}\p{N}*•])[0-9X*•]{4}(?:[ .-]?[0-9X*•]{4}){2,3}[0-9X*•]{0,3}(?![\p{L}\p{N}*•])/giu;
/** A masked number showing its last digits: « XXXX 9012 », « ••5678 », « **12 ». */
const MASKED_TAIL_RE = /(?<![\p{L}\p{N}])[X*•]{2,}[ .-]?\d{2,4}(?![\p{L}\p{N}])/giu;
/**
 * IBAN-shaped text in any case (a note typed in lowercase too), whole or a fragment; only replaced
 * when it holds 6 digits or more. Every group after the country code holds a digit or a mask
 * (« * », « • », or only X), so a word after it stays (« FA26 0012 LOYER » keeps « LOYER », « le25
 * juin » is no IBAN) while « FR76 XXXX XXXX 0189 » goes.
 */
const IBAN_RE = /\b[A-Z]{2}\d{2}(?:[ -]?(?:(?=[A-Z]{0,3}[0-9*•])[A-Z0-9*•]{4}|X{4})){1,7}(?:[ -]?(?:(?=[A-Z]{0,3}[0-9*•])[A-Z0-9*•]{1,4}|X{2,4}))?(?![\p{L}\p{N}*•])/giu;
/**
 * Numbers written in 4 groups or more with one same separator: card « 4974 1234 5678 9012 », IBAN
 * tail; never a date followed by a time (« 05.10.2026 12.30 »).
 */
const DIGIT_GROUPS_RE = /\b\d{2,5}([ .])\d{2,5}(?:\1\d{2,5}){2,}\b/g;
/**
 * French phone numbers: 10 digits from 0[1-9], packed or in 2-digit groups with one same separator
 * (« 0612345678 », « 06 12 34 56 78 », « Tél,06-12-34-56-78 »), not inside a longer number; never
 * a date (« 05.10.2026 ») nor a time (« 12.30 »).
 */
const PHONE_RE = /(?<!\p{N}[.,-]?)0[1-9]([ .-]?)\d{2}(?:\1\d{2}){3}(?![\p{N}]|[.,-]\p{N})/gu;
/** International numbers in the French layout: « +33 6 12 34 56 78 », « 0033 (0)6 12 34 56 78 », « +33612345678 ». */
const INTL_PHONE_RE = /(?<![\p{L}\p{N}+])(?:\+|00)\d{2,3}[ .-]?(?:\(0\)[ .-]?)?[1-9]([ .-]?)\d{2}(?:\1\d{2}){3}(?![\p{N}]|[.,-]\p{N})/gu;
const EMAIL_RE = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu;
const LONG_REFERENCE_RE = /\b(?=[A-Z0-9]*\d{6})[A-Z0-9]{6,}\b/gi;

/** « … » for an IBAN-shaped match that really holds (part of) an account number. */
const ibanOrText = (match: string): string => ((match.match(/\d/g)?.length ?? 0) >= 6 ? '…' : match);

/**
 * Text made safe to send: one line, e-mail addresses, IBANs and their fragments (any case), phone
 * numbers, numbers written in groups, card numbers (plain, partly masked, grouped or after
 * « CARTE ») and references of 6 digits or more replaced by « … », length capped. Short numbers
 * stay (« 1309 » card date, « 12,99 USD », « 2026-09-13 »).
 */
export function scrubText(raw: string, max: number): string {
	return raw
		.replace(/[\r\n\t]+/g, ' ')
		.replace(EMAIL_RE, '…')
		.replace(IBAN_RE, ibanOrText)
		.replace(INTL_PHONE_RE, '…')
		.replace(PHONE_RE, '…')
		.replace(DIGIT_GROUPS_RE, '…')
		.replace(CARD_RE, 'CARTE')
		.replace(CARD_GROUPS_RE, '…')
		.replace(MASKED_CARD_RE, '…')
		.replace(MASKED_TAIL_RE, '…')
		.replace(LONG_REFERENCE_RE, '…')
		.replace(/\s{2,}/g, ' ')
		.trim()
		.slice(0, max);
}

/**
 * Courtesy and professional titles written before a person's name in bank labels (« M », « MME »,
 * « DR »…); not « PR », a common short form in labels (« PR IMMO »).
 */
const TITLE_WORDS: ReadonlySet<string> = new Set([
	'M', 'MM', 'MME', 'MMES', 'MLLE', 'MLLES', 'MELLE', 'MLE', 'MR', 'MRS', 'MONSIEUR', 'MADAME', 'MADEMOISELLE',
	'DR', 'DOCTEUR', 'PROFESSEUR', 'ME', 'MAITRE'
]);
/** Words of a transfer or direct-debit label before the other side's name (« VIR INST DE MME … », « VER INI »). */
const LEAD_WORDS: ReadonlySet<string> = new Set([
	'VIR', 'VIREMENT', 'VER', 'VERSEMENT', 'TRANSFERT', 'PRLV', 'PRELEVEMENT', 'INST', 'SEPA', 'EMET', 'EMIS', 'RECU', 'INI',
	'PERMANENT', 'ORDRE', 'DE', 'DU', 'D', 'A', 'AU', 'VERS', 'POUR', 'ET', 'OU'
]);
/** Card and app payment words before the other side (« PAIEMENT CB 1209 LYDIA … », « LYF PAY », « REF … »). */
const PAYMENT_WORDS: ReadonlySet<string> = new Set(['PAIEMENT', 'PAIEMENTS', 'CB', 'PSC', 'CARTE', 'PAY', 'APP', 'REF', 'MOTIF', 'OBJET']);
/** Transfer labels: the other side may be a private person. */
const TRANSFER_START_RE = /^(?:VIR|VIREMENT|VER|VERSEMENT|TRANSFERT)\b/;
/** Direct-debit labels: the other side is a business, unless the label names a person. */
const DEBIT_START_RE = /^(?:PRLV|PRELEVEMENT)\b/;
/**
 * Person-to-person payment apps and the name shown in their anonymous label; the `mixed` ones also
 * pay shops (PayPal, Lyf), so their unknown other side is « un bénéficiaire masqué », not a person.
 */
const PERSON_APPS: ReadonlyMap<string, { name: string; mixed: boolean }> = new Map([
	['LYDIA', { name: 'Lydia', mixed: false }],
	['SUMERIA', { name: 'Sumeria', mixed: false }],
	['PAYLIB', { name: 'Paylib', mixed: false }],
	['WERO', { name: 'Wero', mixed: false }],
	['PUMPKIN', { name: 'Pumpkin', mixed: false }],
	['LYF', { name: 'Lyf', mixed: true }],
	['LYFPAY', { name: 'Lyf', mixed: true }],
	['PAYPAL', { name: 'PayPal', mixed: true }]
]);
/**
 * Legal forms and company names: the other side is a company wherever they stand (« ACME TRAVAUX
 * SARL »), even before a courtesy title (« ACME SARL M … »).
 */
const COMPANY_MARKERS: ReadonlySet<string> = new Set([
	'SAS', 'SASU', 'SARL', 'SARLU', 'EURL', 'SCI', 'SCM', 'SCP', 'SCA', 'SCS', 'SNC', 'SELARL', 'SELAS', 'SELAFA', 'SELURL', 'GIE', 'GAEC', 'EARL', 'EIRL', 'SCOP', 'SCIC',
	'STE', 'SOCIETE', 'CIE', 'LTD', 'LIMITED', 'GMBH', 'INC', 'LLC', 'PLC', 'BV', 'SPA', 'SRL', 'KRAKEN', 'PAYWARD'
]);
/**
 * Company words that end a company's name (« ACME SERVICES »): a company only inside the name, before
 * any purpose word; after one they are a purpose (« LEA EXEMPLE VOYAGE EUROPE », « CADEAU GROUPE »).
 */
const COMPANY_WORDS: ReadonlySet<string> = new Set(['GROUPE', 'HOLDING', 'SERVICES', 'SOLUTIONS', 'INTERNATIONAL', 'EUROPE']);
/**
 * Organisation words and public bodies: the other side is that organisation when its name starts
 * with one (« VIR SEPA MUTUELLE EXEMPLE », « VIR CAF … »); further on they are a purpose (« VIR INST
 * LEA EXEMPLE MUTUELLE », « LEA EXEMPLE REMB CAF »).
 */
const ORGANISATION_WORDS: ReadonlySet<string> = new Set([
	'ASSO', 'ASSOCIATION', 'FONDATION', 'FEDERATION', 'COMITE', 'MUTUELLE', 'BANQUE', 'BANK', 'CAISSE', 'CREDIT', 'ASSURANCE', 'ASSURANCES', 'CABINET', 'AGENCE', 'OFFICE',
	'SYNDIC', 'SYNDICAT', 'MAIRIE', 'PREFECTURE', 'TRESOR', 'TRESORERIE', 'IMPOT', 'IMPOTS', 'FINANCES', 'DIRECTION', 'CENTRE', 'CLINIQUE', 'HOPITAL', 'CHU', 'LABORATOIRE', 'LABO',
	'ECOLE', 'COLLEGE', 'LYCEE', 'UNIVERSITE', 'CRECHE', 'CLUB', 'GARAGE', 'PHARMACIE', 'EMPLOYEUR',
	'CPAM', 'CAF', 'URSSAF', 'DGFIP', 'DRFIP', 'DDFIP', 'CARSAT', 'MSA', 'CNAV', 'AGIRC', 'ARRCO', 'IRCANTEC', 'AMELI', 'CROUS', 'ANTAI', 'ANTS'
]);
/** Purposes of a payment, never anyone's name: the only words an anonymous label keeps (« Virement à une personne (motif : loyer) »). */
const PURPOSE_WORDS: ReadonlySet<string> = new Set([
	'LOYER', 'LOYERS', 'COLOC', 'COLOCATION', 'LOCATION', 'CAUTION', 'CHARGES', 'REMBOURSEMENT', 'REMBOURSE', 'REMB', 'REMBT', 'RBT', 'CADEAU', 'CADEAUX', 'ANNIVERSAIRE', 'ANNIV',
	'MARIAGE', 'NAISSANCE', 'RESTO', 'RESTAURANT', 'REPAS', 'DINER', 'DEJEUNER', 'APERO', 'SOIREE', 'COURSES', 'VACANCES', 'VOYAGE', 'WEEKEND', 'SEJOUR', 'HOTEL', 'CAMPING',
	'BILLET', 'BILLETS', 'TRAIN', 'AVION', 'CONCERT', 'CINEMA', 'THEATRE', 'SPECTACLE', 'SPORT', 'LOISIRS', 'PRET', 'AVANCE', 'DETTE', 'PENSION', 'ALIMENTAIRE', 'ARGENT', 'POCHE',
	'GARDE', 'BABYSITTING', 'NOUNOU', 'MENAGE', 'COURS', 'COVOITURAGE', 'ESSENCE', 'CARBURANT', 'TAXI', 'PARKING', 'PEAGE', 'FACTURE', 'ACOMPTE', 'SOLDE', 'COTISATION', 'ADHESION',
	'CAGNOTTE', 'PARTAGE', 'EPARGNE', 'SALAIRE', 'PRIME', 'VENTE', 'ACHAT', 'TRAVAUX', 'DEPANNAGE', 'DEMENAGEMENT', 'MEDECIN', 'DOCTEUR', 'DENTISTE', 'BOULANGERIE', 'ABONNEMENT',
	'ELECTRICITE', 'EAU', 'GAZ', 'INTERNET', 'TELEPHONE', 'FORFAIT', 'MATERIEL', 'MEUBLE', 'MEUBLES', 'VELO', 'VOITURE', 'FRAIS', 'SOINS', 'RETRAITE', 'ALLOCATION',
	'ALLOCATIONS', 'INDEMNITE', 'INDEMNITES'
]);
/** Other words that are no one's name: months, days, account and banking words, French small words. */
const COMMON_WORDS: ReadonlySet<string> = new Set([
	'JANVIER', 'FEVRIER', 'MARS', 'AVRIL', 'MAI', 'JUIN', 'JUILLET', 'AOUT', 'SEPTEMBRE', 'OCTOBRE', 'NOVEMBRE', 'DECEMBRE', 'JANV', 'FEV', 'FEVR', 'AVR', 'JUIL', 'SEPT', 'OCT', 'NOV', 'DEC',
	'LUNDI', 'MARDI', 'MERCREDI', 'JEUDI', 'VENDREDI', 'SAMEDI', 'DIMANCHE', 'NOEL', 'PAQUES', 'TOUSSAINT', 'JOUR', 'SEMAINE', 'MOIS', 'TRIMESTRE', 'ANNEE', 'MENSUEL', 'MENSUELLE',
	'MENSUALITE', 'ECHEANCE', 'ANNUEL', 'ANNUELLE', 'COMPTE', 'COURANT', 'JOINT', 'LIVRET', 'BLEU', 'JEUNE', 'LDD', 'LDDS', 'LEP', 'PEL', 'CEL', 'PEA', 'CTO', 'EUROCOMPTE', 'CPTE', 'CC',
	'INTERNE', 'PERSO', 'PERSONNEL', 'CLIENT', 'CLIENTS', 'PARTICULIERS', 'PRESTATIONS', 'FAMILIALES', 'COMMANDE', 'DOSSIER', 'NUMERO', 'NOTE', 'MERCI', 'PART', 'PARTS', 'TOTAL', 'RESTE',
	'SUITE', 'RETOUR', 'DEMI', 'MOITIE', 'LE', 'LA', 'LES', 'L', 'UN', 'UNE', 'DES', 'AUX', 'EN', 'PAR', 'AVEC', 'CHEZ', 'SUR', 'SANS', 'SOUS', 'DANS', 'MON', 'MA', 'MES', 'TON', 'TA', 'TES',
	'SON', 'SA', 'SES', 'NOTRE', 'VOTRE', 'LEUR', 'LEURS', 'JE', 'TU', 'IL', 'ELLE', 'ON', 'NOUS', 'VOUS', 'ILS', 'ELLES', 'CE', 'CET', 'CETTE', 'CES', 'QUI', 'QUE', 'APRES', 'AVANT', 'PLUS', 'MOINS'
]);
/** Every word that is no one's name. */
const NOT_A_NAME: ReadonlySet<string> = new Set([
	...TITLE_WORDS, ...LEAD_WORDS, ...PAYMENT_WORDS, ...PERSON_APPS.keys(), ...COMPANY_MARKERS, ...COMPANY_WORDS, ...ORGANISATION_WORDS, ...PURPOSE_WORDS, ...COMMON_WORDS
]);
/** Particles of compound surnames (« DE LA … », « VAN … »): masked only next to another name of the holder. */
const PARTICLES: ReadonlySet<string> = new Set(['D', 'L', 'DE', 'DU', 'DES', 'LA', 'LE', 'LES', 'DI', 'DA', 'DEL', 'DELLA', 'DOS', 'DAS', 'VAN', 'VON', 'DER', 'DEN', 'TER', 'EL', 'AL', 'BEN', 'BIN', 'MAC', 'MC', 'ST', 'STE', 'Y']);
/** « ET », « OU » between the holders of a joint account (« M OU MME … »). */
const CONNECTORS: ReadonlySet<string> = new Set(['ET', 'OU']);

/** What the privacy checks of one request know: built once (privacyContext) and passed down. */
export interface PrivacyContext {
	/**
	 * Holder name words (whole, joined when hyphenated, and each part) → the name they belong to;
	 * `whole` is false for a mere part of a hyphenated name (JEAN of JEAN-PAUL: masked, but no proof
	 * that the holder is meant).
	 */
	holders: ReadonlyMap<string, { name: number; whole: boolean }>;
	/** Other sides paid by card or direct debit in the history (businessKey): known businesses. */
	businesses: ReadonlySet<string>;
	/** Words of a note that are no one's name: catalogue labels and the common words. */
	vocabulary: ReadonlySet<string>;
}

const NO_PRIVACY: PrivacyContext = { holders: new Map(), businesses: new Set(), vocabulary: NOT_A_NAME };

/** Upper case without accents (« Léa » → « LEA »). */
function plain(text: string): string {
	return text
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toUpperCase();
}

/**
 * Words of a label as the checks read them: upper case without accents, dotted acronyms joined
 * (« S.A.R.L. » → SARL), apostrophes and hyphens splitting words (« JEAN-PAUL » → JEAN, PAUL).
 */
function labelWords(text: string): string[] {
	return plain(text)
		.replace(/\b(?:[A-Z]\.){2,}[A-Z]?/g, (m) => m.replace(/\./g, ''))
		.split(/[^A-Z0-9]+/)
		.filter(Boolean);
}

/**
 * Holder names from the account registry labels (« C/C EUROCOMPTE M JEAN-PAUL LI »): every word
 * after the title as written, short ones (« LI ») and hyphenated ones (« JEAN-PAUL ») included;
 * privacyContext adds their parts and joined forms. Titles and the « ET » / « OU » of a joint
 * account are left out.
 */
export function triageHolderNames(labels: readonly string[]): string[] {
	const names = new Set<string>();
	for (const label of labels) {
		const m = /\b(?:M|MM?E|MLLE|MR)\.?\s+([A-Z'’-]+(?:\s+[A-Z'’.-]+)*)\s*$/.exec(plain(label).replace(/\s+/g, ' ').trim());
		if (!m) continue;
		for (const word of m[1]!.split(' ')) {
			const name = word.replace(/\./g, '');
			if (name && !TITLE_WORDS.has(name) && !CONNECTORS.has(name)) names.add(name);
		}
	}
	return [...names];
}

/**
 * Privacy knowledge of one request, built once: the holders' names (each hyphenated one also as
 * its parts and joined: JEAN-PAUL → JEANPAUL whole, JEAN and PAUL parts; a whole name of another
 * holder wins over a part; 2 letters or more), the businesses of the
 * history (other sides paid by card or direct debit, never through a transfer nor an app) and the
 * words of the catalogue (a category named in a note is no one's name).
 */
export function privacyContext(options: { holderNames?: readonly string[]; history?: readonly TriageHistoryEntry[]; catalogue?: TriageCatalogue } = {}): PrivacyContext {
	const holders = new Map<string, { name: number; whole: boolean }>();
	(options.holderNames ?? []).forEach((name, i) => {
		const parts = labelWords(name).filter((w) => !TITLE_WORDS.has(w) && !CONNECTORS.has(w));
		const forms = [{ word: parts.join(''), whole: true }, ...parts.map((word) => ({ word, whole: parts.length === 1 }))];
		for (const { word, whole } of forms) if (/^[A-Z]{2,}$/.test(word) && !holders.get(word)?.whole) holders.set(word, { name: i, whole });
	});
	const businesses = new Set<string>();
	for (const h of options.history ?? []) {
		const name = businessName(h.tx.remittance_information.join(' '));
		if (name) businesses.add(name);
	}
	const labels = [...(options.catalogue?.categories ?? []), ...(options.catalogue?.subcategories ?? [])].map((c) => c.label);
	return { holders, businesses, vocabulary: new Set([...NOT_A_NAME, ...labels.flatMap(labelWords)]) };
}

/**
 * Which words name a holder: runs of consecutive holder words (two words joined count too: « JEAN
 * PAUL » for JEANPAUL) masked whole when they hold a name of 4 letters or more, two distinct names,
 * or such a joined name; particles (« DE », « LA ») and a short name alone (« LEO ») stay, too
 * common to be told from a word.
 */
function holderMask(words: readonly string[], holders: PrivacyContext['holders']): boolean[] {
	const joined = words.map((w, i) => i + 1 < words.length && holders.has(w + words[i + 1]));
	const hit = words.map((w, i) => holders.has(w) || joined[i]! || joined[i - 1] === true);
	const mask = words.map(() => false);
	for (let i = 0; i < words.length; ) {
		let end = i;
		while (end < words.length && hit[end]) end++;
		const names = new Set(words.slice(i, end).filter((w) => !PARTICLES.has(w)));
		if ([...names].some((w) => w.length >= 4) || names.size >= 2 || joined.slice(i, end).some(Boolean)) mask.fill(true, i, end);
		i = Math.max(end, i + 1);
	}
	return mask;
}

/**
 * A courtesy title before a name (« M JEAN DUPONT », « MME DUPONT »): a title word followed by a
 * word of 2 letters or more, and not itself an initial after another one (« C M ASSURANCES »).
 */
function hasTitle(words: readonly string[]): boolean {
	return words.some((w, i) => TITLE_WORDS.has(w) && /^[A-Z]{2,}$/.test(words[i + 1] ?? '') && !/^[A-Z]$/.test(words[i - 1] ?? ''));
}

/** The other side of a transfer, a direct debit or a person-to-person app payment. */
interface OtherSide {
	kind: 'transfer' | 'debit' | 'app';
	app?: { name: string; mixed: boolean };
	/** Every word of the label (title detection). */
	words: string[];
	/** The other side's words in order (headOf). */
	head: string[];
}

/** Words of a label without numbers nor app, from the other side's first word on (prefix, titles and payment words skipped). */
function headOf(words: readonly string[]): string[] {
	const rest = words.filter((w) => /[A-Z]/.test(w) && !PERSON_APPS.has(w));
	const start = rest.findIndex((w) => !LEAD_WORDS.has(w) && !TITLE_WORDS.has(w) && !PAYMENT_WORDS.has(w));
	return start < 0 ? [] : rest.slice(start);
}

/** The other side of a transfer, a direct debit or a person-to-person app payment; null for anything else (a card payment goes to a business). */
function otherSide(label: string): OtherSide | null {
	const words = labelWords(label);
	const flat = words.join(' ');
	const app = words.find((w) => PERSON_APPS.has(w));
	const kind: OtherSide['kind'] | null = app ? 'app' : TRANSFER_START_RE.test(flat) ? 'transfer' : DEBIT_START_RE.test(flat) ? 'debit' : null;
	return kind ? { kind, ...(app ? { app: PERSON_APPS.get(app)! } : {}), words, head: headOf(words) } : null;
}

/** Words of the other side that may be someone's name: letters only, 2 or more, no known word. */
function namedWords(head: readonly string[]): string[] {
	return head.filter((w) => /^[A-Z]{2,}$/.test(w) && !NOT_A_NAME.has(w));
}

/** Key of a business name: its words made of letters only. */
function businessKey(head: readonly string[]): string {
	return head.filter((w) => /^[A-Z]+$/.test(w)).join(' ');
}

/**
 * The business paid in a history line (card payment, direct debit without a title…), as
 * businessKey; '' for a transfer, an app payment, a debit naming a person, or no name at all.
 */
function businessName(label: string): string {
	const side = otherSide(label);
	if (side && (side.kind !== 'debit' || hasTitle(side.words))) return '';
	const head = side ? side.head : headOf(labelWords(label));
	return namedWords(head).length ? businessKey(head) : '';
}

/** A merchant of the built-in dictionaries (generic words such as « SALAIRE » aside). */
function inDictionary(key: string): boolean {
	const category = merchantDictFor(key);
	return (category !== undefined && category !== 'revenus') || subDictCategoryFor(key) !== undefined;
}

/**
 * The other side's name starts with a dictionary merchant (« EDF … », « LA FERME DE … »): the first
 * leading words that match, only through their first word; a common word of the dictionaries
 * (« LOYER », « RESTO ») or a merchant further on (a purpose: « LEA EXEMPLE SNCF ») is no business.
 */
function startsWithMerchant(head: readonly string[]): boolean {
	for (let n = 1; n <= Math.min(head.length, 4); n++) {
		const lead = head.slice(0, n);
		if (lead.every((w) => NOT_A_NAME.has(w)) || !inDictionary(lead.join(' '))) continue;
		return !inDictionary(head.slice(0, n - 1).join(' ')) && !inDictionary(head.slice(1, n).join(' '));
	}
	return false;
}

/** A legal form or a company name anywhere in the other side (« ACME TRAVAUX SARL »). */
function hasCompanyMarker(head: readonly string[]): boolean {
	return head.some((w) => COMPANY_MARKERS.has(w));
}

/**
 * The other side is a known business: a legal form anywhere (hasCompanyMarker); a company word or a
 * final « SA » in its name, before any purpose word (« ACME SERVICES », « ACME SA FACTURE »); an
 * organisation word, a public body or a dictionary merchant first (purpose and common words before
 * it aside: « LOYER EXEMPLIMMO », « REMBOURSEMENT SOINS CPAM »); or a business of the history
 * (`businesses`) followed by common words only (« ATELIER MODELE FACTURE » after a card payment to
 * « ATELIER MODELE »). The same words after a purpose word are a purpose, not the other side (« LEA
 * EXEMPLE REMB CAF », « LEA EXEMPLE VOYAGE EUROPE »).
 */
function knownBusiness(head: readonly string[], businesses: ReadonlySet<string>): boolean {
	if (hasCompanyMarker(head)) return true;
	const lead = head.slice(Math.max(0, head.findIndex((w) => !PURPOSE_WORDS.has(w) && !COMMON_WORDS.has(w))));
	const purpose = lead.findIndex((w) => PURPOSE_WORDS.has(w));
	const name = purpose < 0 ? lead : lead.slice(0, purpose);
	if (name.some((w, i) => COMPANY_WORDS.has(w) || (w === 'SA' && i === name.length - 1))) return true;
	if (ORGANISATION_WORDS.has(lead[0] ?? '') || startsWithMerchant(head) || startsWithMerchant(lead)) return true;
	return head.some((_, i) => businesses.has(businessKey(head.slice(0, i + 1))) && !namedWords(head.slice(i + 1)).length);
}

/**
 * Distinct holder names spelt whole among the masked words: a whole word (« DUPONT ») or two words
 * joined (« JEAN PAUL » for JEAN-PAUL); a mere part (« JEAN » of JEAN-PAUL) or a particle counts
 * for none, so « JEAN DUPONT » is a relative of JEAN-PAUL DUPONT, not the holder.
 */
function holderCount(words: readonly string[], mask: readonly boolean[], holders: PrivacyContext['holders']): number {
	const names = new Set<number>();
	words.forEach((w, i) => {
		if (!mask[i]) return;
		const own = holders.get(w);
		const pair = mask[i + 1] ? holders.get(w + words[i + 1]) : undefined;
		if (own?.whole && !PARTICLES.has(w)) names.add(own.name);
		if (pair?.whole) names.add(pair.name);
	});
	return names.size;
}

/**
 * Who is on the other side of a transfer, a person-to-person app payment or a direct debit, as far
 * as the label tells: the account holder (a holder name first, then another of the holders' names
 * spelt whole, like detectTransferPairs: holderCount), a private person, or null. A legal form
 * makes it a company; otherwise a courtesy title makes it a person, even before a name that is
 * also a shop (« VIR SEPA MME ZARA EXEMPLE »). A transfer or an app payment goes to a person unless
 * its other side is a known business (knownBusiness) or names no one (« VIR SEPA REMBOURSEMENT »,
 * « VIR LIVRET A »); a direct debit only when it names one (holder name first, courtesy title).
 * Holder names further on are no party (« VIR SEPA SAS ACME DUPONT JEAN SALAIRE » is a salary: the
 * names are masked, the label stays). Card payments are never reduced: their other side is a
 * business, title or not (« MR BRICOLAGE »).
 */
export function privateParty(label: string, privacy: PrivacyContext = NO_PRIVACY): 'holder' | 'person' | null {
	const side = otherSide(label);
	if (!side) return null;
	const { head } = side;
	const mask = holderMask(head, privacy.holders);
	if (side.kind !== 'app' && mask[0] && holderCount(head, mask, privacy.holders) >= 2) return 'holder';
	if (hasCompanyMarker(head)) return null;
	if (hasTitle(side.words)) return 'person';
	if (knownBusiness(head, privacy.businesses)) return null;
	if (side.kind === 'debit') return mask[0] ? 'person' : null;
	return namedWords(head).length > 0 || mask.some(Boolean) ? 'person' : null;
}

/**
 * A history line whose merchant could name a person, never sent as a habit: a transfer (VIR,
 * VIREMENT, VERSEMENT…), a person-to-person app payment or a direct debit with a courtesy title
 * (« LYDIA MME … »), an app payment whose other side may be a person (« LYDIA LEA EXEMPLE »;
 * « PAYPAL » alone or a company after it is fine), or a holder's name. A card payment with a title
 * goes to a business (« MR BRICOLAGE », « DR … »): it stays. The relay runs the same check on the
 * merchants it receives (without the holders' names nor the history: the same decision for an app
 * payment).
 */
export function namesAPerson(label: string, privacy: PrivacyContext = NO_PRIVACY): boolean {
	const side = otherSide(label);
	const words = side?.words ?? labelWords(label);
	if (TRANSFER_START_RE.test(words.join(' '))) return true;
	if (side && hasTitle(words)) return true;
	if (side?.kind === 'app' && namedWords(side.head).length > 0 && !knownBusiness(side.head, NO_PRIVACY.businesses)) return true;
	return holderMask(words, privacy.holders).some(Boolean);
}

/** A word of a text (letters and digits), with its place and its form for the checks. */
interface TextWord {
	start: number;
	end: number;
	word: string;
	form: string;
}

/** The words of a text, in order. */
function textWords(text: string): TextWord[] {
	return [...text.matchAll(/[\p{L}\p{N}]+/gu)].map((m) => ({ start: m.index, end: m.index + m[0].length, word: m[0], form: plain(m[0]) }));
}

/** The text with its masked words replaced by « … », a hyphenated name by one (« JEAN-PAUL » → « … »). */
function masked(text: string, words: readonly TextWord[], mask: readonly boolean[]): string {
	let out = '';
	let from = 0;
	words.forEach((w, i) => {
		if (!mask[i]) return;
		out += `${text.slice(from, w.start)}…`;
		from = w.end;
	});
	return `${out}${text.slice(from)}`.replace(/…(?:['’-]…)+/g, '…');
}

/** The holders' names in a text replaced by « … » (a label, a merchant): hyphenated, joined or split, short ones next to another. */
function maskHolderNames(text: string, holders: PrivacyContext['holders']): string {
	if (!holders.size) return text;
	const words = textWords(text);
	return masked(text, words, holderMask(words.map((w) => w.form), holders));
}

/** A word of a note that is no one's name: common or catalogue word, business of the history, dictionary merchant. */
function knownWord(form: string, privacy: PrivacyContext): boolean {
	return privacy.vocabulary.has(form) || privacy.businesses.has(form) || inDictionary(form);
}

/** A word whose dot ends no sentence: a title (« M. », « Dr. »), an initial (« J. »), « St. ». */
function abbreviation(word: TextWord): boolean {
	return TITLE_WORDS.has(word.form) || /^\p{L}$/u.test(word.word) || word.form === 'ST' || word.form === 'STE';
}

/** The i-th word opens a sentence: the first one, or one after « . », « ! », « ? », « … » or a new line (not the dot of an abbreviation). */
function opensSentence(text: string, words: readonly TextWord[], i: number): boolean {
	if (i === 0) return true;
	const gap = text.slice(words[i - 1]!.end, words[i]!.start);
	return /[.!?…\n]/.test(gap) && !(/^\.\s*$/.test(gap) && abbreviation(words[i - 1]!));
}

/**
 * A note with its names masked: the holders' names (any case), and every capitalised word that is
 * no known word (knownWord) and does not open a sentence (« remboursé par Alex » → « remboursé par
 * … », « rdv M. Modele » → « rdv M. … »); a capitalised first word goes too when a masked name
 * follows it (« Alex Modele m'a remboursé »). A lone first name opening a sentence (« Alex a payé »)
 * and a name typed in lower case stay: without a French dictionary they cannot be told from
 * ordinary words. Masking keeps what helps to sort (« cadeau de Noël pour … ») where dropping the
 * note would lose it.
 */
function maskNote(text: string, privacy: PrivacyContext): string {
	const words = textWords(text);
	const holder = holderMask(words.map((w) => w.form), privacy.holders);
	const capital = words.map((w) => /^\p{Lu}/u.test(w.word) && !/\p{N}/u.test(w.word) && !knownWord(w.form, privacy));
	const opening = words.map((_, i) => opensSentence(text, words, i));
	const named = words.map((_, i) => holder[i]! || (capital[i]! && !opening[i]));
	const mask = named.map((n, i) => n || (capital[i]! && named[i + 1] === true && /^\s+$/.test(text.slice(words[i]!.end, words[i + 1]!.start))));
	return masked(text, words, mask);
}

/** The purpose words of an other side (PURPOSE_WORDS, organisation words), lower case, at most 3: « loyer, cadeau ». */
function purposeOf(head: readonly string[]): string {
	return [...new Set(head.filter((w) => PURPOSE_WORDS.has(w) || ORGANISATION_WORDS.has(w)))].slice(0, 3).join(', ').toLowerCase();
}

/** The anonymous label without its purpose: direction, kind (transfer, app, direct debit) and party. */
function anonymousBase(side: OtherSide | null, out: boolean, party: 'holder' | 'person'): string {
	if (side?.app?.mixed) return `Paiement ${side.app.name} ${out ? 'à un bénéficiaire masqué' : 'd’un émetteur masqué'}`;
	if (side?.app) return `Paiement ${side.app.name} ${out ? 'à une personne' : 'd’une personne'}`;
	if (side?.kind === 'debit') return party === 'holder' ? 'Prélèvement à son nom' : 'Prélèvement d’une personne';
	if (party === 'holder') return out ? 'Virement vers un compte à son nom' : 'Virement depuis un compte à son nom';
	return out ? 'Virement à une personne' : 'Virement d’une personne';
}

/**
 * Label sent instead of a transfer, an app payment or a direct debit with a private person: what is
 * needed to sort it (to or from a person, between the holder's own accounts, through which app) and
 * its purpose words only (« Virement à une personne (motif : loyer) », « Paiement Lydia à une
 * personne »), never a name.
 */
export function anonymousLabel(label: string, amount: number, party: 'holder' | 'person'): string {
	const side = otherSide(label);
	const base = anonymousBase(side, amount < 0, party);
	const purpose = purposeOf(side?.head ?? []);
	return purpose ? `${base} (motif : ${purpose})` : base;
}

/** Catalogue sent to the AI: ids and French labels only. */
export function triageCatalogue(categories: readonly { id: string; label: string }[], subcategories: readonly { id: string; categoryId: string; label: string }[]): TriageCatalogue {
	return {
		categories: categories.map((c) => ({ id: c.id, label: c.label })),
		subcategories: subcategories.filter((s) => categories.some((c) => c.id === s.categoryId)).map((s) => ({ id: s.id, categoryId: s.categoryId, label: s.label }))
	};
}

const STOP_WORDS = new Set(['paiement', 'carte', 'prlv', 'sepa', 'virement', 'achat', 'facture', 'avoir', 'retrait', 'echeance', 'france', 'paris']);

/** Words worth comparing between two merchants (lowercase, no accents, 4+ letters, no banking noise). */
function meaningfulWords(text: string): string[] {
	return text
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.split(/[^a-z]+/)
		.filter((w) => w.length >= 4 && !STOP_WORDS.has(w));
}

/**
 * Habits of the user from the categorised history: one line per merchant with its most frequent
 * category and subcategory, never a line that would name a person (namesAPerson: transfers,
 * person-to-person app payments, direct debits with a courtesy title, holder names). Merchants
 * sharing a word with an operation of the batch come first, then the ones categorised by hand, then
 * the most frequent; at most `max`.
 */
export function triageExamples(history: readonly TriageHistoryEntry[], batch: readonly Transaction[], catalogue: TriageCatalogue, max = MAX_TRIAGE_EXAMPLES, privacy: PrivacyContext = NO_PRIVACY): TriageExample[] {
	const known = new Set(catalogue.categories.map((c) => c.id));
	const subOf = new Map(catalogue.subcategories.map((s) => [s.id, s.categoryId]));
	const byMerchant = new Map<string, { votes: Map<string, number>; manual: boolean }>();
	for (const h of history) {
		if (!known.has(h.categoryId) || namesAPerson(h.tx.remittance_information.join(' '), privacy)) continue;
		const merchant = scrubText(merchantLabel(h.tx.remittance_information), MAX_MERCHANT);
		if (!merchant) continue;
		const entry = byMerchant.get(merchant) ?? { votes: new Map<string, number>(), manual: false };
		const sub = h.subId && subOf.get(h.subId) === h.categoryId ? h.subId : '';
		const choice = `${h.categoryId}|${sub}`;
		entry.votes.set(choice, (entry.votes.get(choice) ?? 0) + 1);
		entry.manual ||= h.manual;
		byMerchant.set(merchant, entry);
	}
	const batchWords = new Set(batch.flatMap((tx) => meaningfulWords(`${merchantLabel(tx.remittance_information)} ${tx.remittance_information.join(' ')}`)));
	const ranked = [...byMerchant].map(([merchant, { votes, manual }]) => {
		const [choice, count] = [...votes].sort((a, b) => b[1] - a[1])[0]!;
		const [categoryId, subId] = choice.split('|') as [string, string];
		const relevant = meaningfulWords(merchant).some((w) => batchWords.has(w));
		return { example: { merchant, categoryId, ...(subId ? { subId } : {}), count, ...(manual ? { manual: true } : {}) } as TriageExample, relevant };
	});
	ranked.sort((a, b) => Number(b.relevant) - Number(a.relevant) || Number(!!b.example.manual) - Number(!!a.example.manual) || b.example.count - a.example.count || a.example.merchant.localeCompare(b.example.merchant));
	return ranked.slice(0, max).map((r) => r.example);
}

/**
 * Request for one batch of the queue (the first TRIAGE_BATCH_SIZE operations of `batch`): opaque ids
 * numbered from `firstId`, allowed fields only, the catalogue and the habits. `accountKind` gives
 * the readable kind of an account (« Compte courant »), never its number nor its holder. `privacy`
 * (privacyContext, built once per run) is built from `holderNames` (triageHolderNames on the
 * registry), the history and the catalogue when not given: the holders' names are masked
 * everywhere, other names in the note (maskNote), and a transfer, app payment or direct debit with
 * a private person goes as anonymousLabel without its merchant. Returns the operation behind each
 * id so the answer can be mapped back.
 */
export function buildTriageRequest(
	batch: readonly Transaction[],
	history: readonly TriageHistoryEntry[],
	catalogue: TriageCatalogue,
	options: { accountKind?: (id: string) => string; holderNames?: readonly string[]; privacy?: PrivacyContext; firstId?: number; maxExamples?: number } = {}
): { request: TriageRequest; byId: Map<string, Transaction> } {
	const first = options.firstId ?? 1;
	const ops = batch.slice(0, TRIAGE_BATCH_SIZE);
	const privacy = options.privacy ?? privacyContext({ holderNames: options.holderNames, history, catalogue });
	const byId = new Map<string, Transaction>();
	const operations = ops.map((tx, i): TriageOperation => {
		const id = `t${first + i}`;
		byId.set(id, tx);
		const raw = tx.remittance_information.join(' ');
		const amount = Math.round(signedAmount(tx) * 100) / 100;
		const party = privateParty(raw, privacy);
		const account = tx.account && options.accountKind ? scrubText(options.accountKind(tx.account), MAX_ACCOUNT) : '';
		const bankCategory = scrubText(tx.bank_category ?? '', MAX_BANK);
		const bankSubcategory = scrubText(tx.bank_subcategory ?? '', MAX_BANK);
		const note = scrubText(maskNote(tx.note ?? '', privacy), MAX_NOTE);
		const merchant = party ? '' : scrubText(maskHolderNames(merchantLabel(tx.remittance_information), privacy.holders), MAX_MERCHANT);
		return {
			id,
			label: party ? anonymousLabel(raw, amount, party) : scrubText(maskHolderNames(raw, privacy.holders), MAX_LABEL),
			amount,
			date: tx.booking_date || tx.value_date,
			...(account ? { account } : {}),
			...(bankCategory ? { bankCategory } : {}),
			...(bankSubcategory ? { bankSubcategory } : {}),
			...(note ? { note } : {}),
			...(merchant ? { merchant } : {})
		};
	});
	return {
		request: { operations, categories: catalogue.categories, subcategories: catalogue.subcategories, examples: triageExamples(history, ops, catalogue, options.maxExamples, privacy) },
		byId
	};
}

/**
 * Checks a request on the relay side: bounded strings and lists, operation ids t1…, known
 * categories, no habit naming a person (namesAPerson on its merchant: a transfer, a
 * person-to-person app payment; a title alone is a business, as in the app). Returns the cleaned
 * request, or a readable error.
 */
export function parseTriageRequest(body: unknown): TriageRequest | string {
	const o = (body && typeof body === 'object' ? body : null) as Record<string, unknown> | null;
	if (!o) return 'Demande manquante.';
	const text = (v: unknown, max: number): string | null => (typeof v === 'string' ? scrubText(v, max) : null);
	const categories = Array.isArray(o.categories)
		? o.categories.slice(0, MAX_CATEGORIES).flatMap((c) => {
				const x = c as Record<string, unknown>;
				const label = text(x?.label, MAX_CATEGORY_LABEL);
				return typeof x?.id === 'string' && CATALOGUE_ID.test(x.id) && label ? [{ id: x.id, label }] : [];
			})
		: [];
	if (!categories.length) return 'Catégories manquantes.';
	const subcategories = Array.isArray(o.subcategories)
		? o.subcategories.slice(0, MAX_SUBCATEGORIES).flatMap((s) => {
				const x = s as Record<string, unknown>;
				const label = text(x?.label, MAX_CATEGORY_LABEL);
				return typeof x?.id === 'string' && CATALOGUE_ID.test(x.id) && typeof x.categoryId === 'string' && categories.some((c) => c.id === x.categoryId) && label ? [{ id: x.id, categoryId: x.categoryId, label }] : [];
			})
		: [];
	if (!Array.isArray(o.operations) || o.operations.length < 1 || o.operations.length > TRIAGE_BATCH_SIZE) return `Entre 1 et ${TRIAGE_BATCH_SIZE} opérations attendues.`;
	const seen = new Set<string>();
	const operations: TriageOperation[] = [];
	for (const item of o.operations) {
		const x = item as Record<string, unknown>;
		const label = text(x?.label, MAX_LABEL);
		if (typeof x?.id !== 'string' || !OPERATION_ID.test(x.id) || seen.has(x.id)) return 'Identifiant d’opération invalide.';
		if (!label || typeof x.amount !== 'number' || !Number.isFinite(x.amount) || Math.abs(x.amount) >= 10_000_000) return 'Opération invalide.';
		if (typeof x.date !== 'string' || !ISO_DATE.test(x.date)) return 'Date d’opération invalide.';
		seen.add(x.id);
		const account = text(x.account, MAX_ACCOUNT);
		const bankCategory = text(x.bankCategory, MAX_BANK);
		const bankSubcategory = text(x.bankSubcategory, MAX_BANK);
		const note = text(x.note, MAX_NOTE);
		const merchant = text(x.merchant, MAX_MERCHANT);
		operations.push({
			id: x.id,
			label,
			amount: Math.round(x.amount * 100) / 100,
			date: x.date,
			...(account ? { account } : {}),
			...(bankCategory ? { bankCategory } : {}),
			...(bankSubcategory ? { bankSubcategory } : {}),
			...(note ? { note } : {}),
			...(merchant ? { merchant } : {})
		});
	}
	const examples = Array.isArray(o.examples)
		? o.examples.slice(0, MAX_TRIAGE_EXAMPLES).flatMap((e) => {
				const x = e as Record<string, unknown>;
				const merchant = text(x?.merchant, MAX_MERCHANT);
				if (!merchant || namesAPerson(merchant) || typeof x.categoryId !== 'string' || !categories.some((c) => c.id === x.categoryId)) return [];
				if (typeof x.count !== 'number' || !Number.isInteger(x.count) || x.count < 1 || x.count > 1_000_000) return [];
				const subId = typeof x.subId === 'string' && subcategories.some((s) => s.id === x.subId && s.categoryId === x.categoryId) ? x.subId : undefined;
				return [{ merchant, categoryId: x.categoryId, ...(subId ? { subId } : {}), count: x.count, ...(x.manual === true ? { manual: true } : {}) }];
			})
		: [];
	return { operations, categories, subcategories, examples };
}

/**
 * Reads the AI answer strictly: the relay body `{ propositions, summary }` or Claude's raw text (JSON
 * alone, in a ```json fence, or with a sentence around it). Each proposal must name a known operation
 * (once) and, for kind 'category', a known category; a category « autre » becomes keep-other; a
 * subcategory outside its category is dropped and the confidence lowered to « moyenne » at most; an
 * unknown confidence reads « basse »; `always` only holds for a category other than « vacances ».
 */
export function parseTriageAnswer(raw: unknown, knownIds: Iterable<string>, catalogue: TriageCatalogue): TriageAnswer | { error: string } {
	let o: unknown = raw;
	if (typeof o === 'string') {
		const candidate = firstJsonObject(o);
		o = candidate === null ? null : parseLenientJson(candidate);
	}
	const list = o && typeof o === 'object' ? (o as { propositions?: unknown }).propositions : undefined;
	if (!Array.isArray(list)) return { error: "Réponse de l'IA illisible : rien n'a été proposé." };
	const ids = new Set(knownIds);
	const categories = new Set(catalogue.categories.map((c) => c.id));
	const subOf = new Map(catalogue.subcategories.map((s) => [s.id, s.categoryId]));
	const seen = new Set<string>();
	const propositions: TriageProposal[] = [];
	let rejected = 0;
	for (const item of list) {
		const p = proposalFrom(item, ids, seen, categories, subOf);
		if (p) {
			seen.add(p.id);
			propositions.push(p);
		} else rejected++;
	}
	const summary = typeof (o as { summary?: unknown }).summary === 'string' ? scrubText((o as { summary: string }).summary, MAX_SUMMARY) : '';
	return { propositions, summary, rejected };
}

/** One checked proposal, or null when it must be dropped. */
function proposalFrom(item: unknown, ids: ReadonlySet<string>, seen: ReadonlySet<string>, categories: ReadonlySet<string>, subOf: ReadonlyMap<string, string>): TriageProposal | null {
	if (!item || typeof item !== 'object') return null;
	const x = item as Record<string, unknown>;
	if (typeof x.id !== 'string' || !ids.has(x.id) || seen.has(x.id)) return null;
	const rawCategory = typeof x.categoryId === 'string' ? x.categoryId : undefined;
	let kind: TriageKind | undefined = KINDS.find((k) => k === x.kind) ?? (x.kind === undefined && rawCategory ? 'category' : undefined);
	if (!kind) return null;
	if (kind === 'category' && rawCategory === 'autre') kind = 'keep-other';
	let confidence: TriageConfidence = x.confidence === 'haute' || x.confidence === 'moyenne' ? x.confidence : 'basse';
	const reason = typeof x.reason === 'string' ? scrubText(x.reason, MAX_REASON) : '';
	const rawSub = typeof x.subId === 'string' && x.subId ? x.subId : undefined;
	if (kind === 'internal-transfer') return { id: x.id, kind, confidence, reason, always: false };
	const owner = kind === 'category' ? rawCategory : 'autre';
	if (kind === 'category' && (!rawCategory || !categories.has(rawCategory))) return null;
	const subFits = rawSub !== undefined && subOf.get(rawSub) === owner;
	if (rawSub !== undefined && !subFits && kind === 'category' && confidence === 'haute') confidence = 'moyenne';
	const subId = subFits ? rawSub : undefined;
	if (kind === 'keep-other') return { id: x.id, kind, ...(subId ? { subId } : {}), confidence, reason, always: false };
	return { id: x.id, kind, categoryId: rawCategory as CategoryId, ...(subId ? { subId } : {}), confidence, reason, always: x.always === true && rawCategory !== 'vacances' };
}

/** Sorts proposals by confidence (« haute » first), keeping the order of the answer otherwise. */
export function byConfidence<T extends TriageProposal>(items: readonly T[]): T[] {
	return items
		.map((item, i) => ({ item, i }))
		.sort((a, b) => CONFIDENCE_RANK[a.item.confidence] - CONFIDENCE_RANK[b.item.confidence] || a.i - b.i)
		.map((x) => x.item);
}

/**
 * Report grouped by proposed category (largest group first, ties in order of appearance), then the
 * operations to keep in « Autre », then the internal transfers; inside a group, by confidence.
 */
export function groupProposals<T extends TriageProposal>(items: readonly T[]): TriageGroup<T>[] {
	const groups = new Map<string, TriageGroup<T>>();
	for (const item of items) {
		const key = item.kind === 'category' ? item.categoryId! : item.kind;
		const group: TriageGroup<T> = groups.get(key) ?? { key, kind: item.kind, ...(item.kind === 'category' ? { categoryId: item.categoryId } : {}), items: [] };
		group.items.push(item);
		groups.set(key, group);
	}
	const tail = (g: TriageGroup<T>) => (g.kind === 'category' ? 0 : g.kind === 'keep-other' ? 1 : 2);
	const order = [...groups.values()];
	return order
		.map((g, i) => ({ g, i }))
		.sort((a, b) => tail(a.g) - tail(b.g) || b.g.items.length - a.g.items.length || a.i - b.i)
		.map(({ g }) => ({ ...g, items: byConfidence(g.items) }));
}

/** The « sûres »: a category proposed with a high confidence (« Valider les sûres »). */
export function sureProposals<T extends TriageProposal>(items: readonly T[]): T[] {
	return items.filter((p) => p.kind === 'category' && p.confidence === 'haute' && !!p.categoryId);
}

/** Splits the queue into relay batches. */
export function triageBatches<T>(queue: readonly T[], size = TRIAGE_BATCH_SIZE): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < queue.length; i += size) out.push(queue.slice(i, i + size));
	return out;
}

/** One stored entry an AI validation wrote (undefined = no entry), with the operation it was for. */
export interface WrittenValue<T> {
	key: string;
	/** txKey of the operation of the step (counted once when left alone by the undo). */
	op: string;
	before: T | undefined;
	after: T | undefined;
}

/** The entry as a written value, or nothing when the step did not change it. */
export function written<T>(key: string, op: string, before: T | undefined, after: T | undefined, same: (a: T | undefined, b: T | undefined) => boolean = Object.is): WrittenValue<T>[] {
	return same(before, after) ? [] : [{ key, op, before, after }];
}

/** Operations of `writes` with an entry that no longer holds what the step wrote (changed since by hand, another tool). */
export function changedOps<T>(writes: readonly WrittenValue<T>[], current: (key: string) => T | undefined, same: (a: T | undefined, b: T | undefined) => boolean = Object.is): Set<string> {
	return new Set(writes.filter((w) => !same(current(w.key), w.after)).map((w) => w.op));
}

/** Values to put back for an undo: each entry its value from before (undefined = remove it), except the operations in `leftAlone`. */
export function revertValues<T>(writes: readonly WrittenValue<T>[], leftAlone: ReadonlySet<string>): Record<string, T | undefined> {
	const revert: Record<string, T | undefined> = {};
	for (const w of writes) if (!leftAlone.has(w.op)) revert[w.key] = w.before;
	return revert;
}

/**
 * Compare-and-restore of an undo on one store: an entry that still holds what the step wrote goes
 * back to its value from before (`revert`, undefined = remove the entry); an entry changed since (by
 * hand, another tool) is left alone and its operation listed in `changedOps`. Entries of the
 * operations in `leftAlone` (changed since in another store) stay too, so an operation is undone
 * whole or not at all. Several stores: changedOps on each, then revertValues with all of them.
 */
export function revertPlan<T>(
	writes: readonly WrittenValue<T>[],
	current: (key: string) => T | undefined,
	same: (a: T | undefined, b: T | undefined) => boolean = Object.is,
	leftAlone: ReadonlySet<string> = new Set()
): { revert: Record<string, T | undefined>; changedOps: string[] } {
	const changed = changedOps(writes, current, same);
	return { revert: revertValues(writes, new Set([...changed, ...leftAlone])), changedOps: [...changed] };
}

/**
 * Message of an undone AI step: its label, plus the operations the undo left alone because they
 * changed since (all of them: nothing was undone).
 */
export function undoMessage(label: string, changedOps: number, totalOps: number): string {
	if (!changedOps) return label;
	const s = changedOps > 1 ? 's' : '';
	if (changedOps >= totalOps) return `Rien n’a été annulé pour « ${label} » : ${changedOps > 1 ? `les ${changedOps} opérations ont` : 'l’opération a'} changé depuis`;
	return `« ${label} » annulé, sauf ${changedOps} opération${s} modifiée${s} depuis (laissée${s} telle${s} quelle${s})`;
}
