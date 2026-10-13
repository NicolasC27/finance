import type { CategoryId, Transaction } from './types';
import { signedAmount } from './data';
import { formatEUR } from './format';
import { addMonths } from './schedule';

/**
 * Quick expense entry (pure, testable): a sentence typed when the money is spent (« leboncoin
 * 20,25 € », « restaurant hier 34 € ») becomes an operation counted at once, flagged as not yet
 * seen on a statement (source 'manual'). When the statement is imported, the matching bank
 * operation replaces it, so nothing is counted twice.
 */

export interface QuickDraft {
	label: string;
	/** Positive amount (€). */
	amount: number;
	/** true for money received (refund, sale…). */
	credit: boolean;
	/** AAAA-MM-JJ. */
	date: string;
	categoryId?: CategoryId;
	/** Subcategory id (must belong to categoryId). */
	subId?: string;
	/** Payment named in the sentence (« swile », « chèques culture », « en liquide », « 3 € liquide »: see readCash); the card otherwise. */
	payment?: 'swile' | 'culture' | 'cash';
	/** Number of instalments of a card payment (« en 3 fois », « 4x »); one payment when absent. */
	instalments?: number;
	/** Person the spend was for, who pays back their share (« pour Léa »). */
	forWhom?: string;
}

const DAY = 86_400_000;
const isoOf = (t: number) => new Date(t).toISOString().slice(0, 10);
const utc = (d: string) => Date.parse(`${d}T00:00:00Z`);
const WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const CREDIT_WORDS = /\b(re[çc]u|rembours\w*|vente|vendu|salaire|virement re[çc]u|gagn[ée]|encaiss\w*)\b/i;
const AMOUNT_RE = /([+-])?\s*(\d{1,3}(?:[  ]\d{3})+|\d+)(?:[.,](\d{1,2}))?\s*(€|e\b|eur\b|euros?\b)?/gi;

/** Date mentioned in the sentence (hier, avant-hier, lundi, le 12, 12/09, 12/09/2026), else today; with the text it used. */
function readDate(text: string, today: string): { date: string; used: string[] } {
	const t = utc(today);
	const used: string[] = [];
	let date = today;
	const lower = text.toLowerCase();
	const m = /\b(avant[- ]hier|hier|aujourd['’]hui|ce matin|ce soir)\b/.exec(lower);
	if (m) {
		used.push(m[0]);
		date = m[1]!.startsWith('avant') ? isoOf(t - 2 * DAY) : m[1] === 'hier' ? isoOf(t - DAY) : today;
		return { date, used };
	}
	const dm = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(lower);
	if (dm) {
		used.push(dm[0]);
		const y = dm[3] ? (dm[3].length === 2 ? 2000 + Number(dm[3]) : Number(dm[3])) : Number(today.slice(0, 4));
		const candidate = `${y}-${dm[2]!.padStart(2, '0')}-${dm[1]!.padStart(2, '0')}`;
		const ok = !Number.isNaN(utc(candidate));
		const fixed = ok && !dm[3] && candidate > today ? `${y - 1}${candidate.slice(4)}` : candidate;
		return { date: ok ? fixed : today, used };
	}
	const le = /\ble (\d{1,2})\b/.exec(lower);
	if (le && Number(le[1]) >= 1 && Number(le[1]) <= 31) {
		used.push(le[0]);
		const day = le[1]!.padStart(2, '0');
		const sameMonth = `${today.slice(0, 7)}-${day}`;
		const d = sameMonth > today ? isoOf(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 2, Number(day))) : sameMonth;
		return { date: d, used };
	}
	const wd = WEEKDAYS.findIndex((w) => new RegExp(`\\b${w}\\b`).test(lower));
	if (wd >= 0) {
		used.push(WEEKDAYS[wd]!);
		const cur = new Date(t).getUTCDay();
		const back = (cur - wd + 7) % 7 || 7;
		return { date: isoOf(t - back * DAY), used };
	}
	return { date, used };
}

/**
 * Local parser (no AI): the amount (« 20,25 », « 20.25 € », « 20e », « 1 200 € »), the date words,
 * the rest is the label. « + », « reçu », « remboursement »… make it money received. « pour Léa »
 * names who the spend was for (`people`: names already used, understood in lowercase too). Returns
 * an error message when no amount can be read.
 */
export function parseQuickEntry(text: string, today: string, people: readonly string[] = []): QuickDraft | { error: string } {
	const typed = text.replace(/\s+/g, ' ').trim();
	if (!typed) return { error: 'Écris par exemple « leboncoin 20,25 € ».' };
	const unpaid = withoutCashWords(typed);
	const pay = PAYMENT_WORDS.find((p) => p.re.test(unpaid)) ?? (unpaid !== typed ? { payment: 'cash' as const } : undefined);
	const times = INSTALMENTS_RE.exec(unpaid);
	const count = times ? Number(times[1] ?? times[2] ?? times[3]) : 0;
	const raw = unpaid
		.replace(INSTALMENTS_RE, ' ')
		.replace(/\s*(?:\bpay[ée]e?s?\s+)?\b(en|par|avec)?\s*(swile|ch[eè]ques?[- ]culture|carte|cb)(?![\p{L}\d])/giu, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	const who = readForWhom(raw, people);
	const { date, used } = readDate(raw, today);
	let rest = raw;
	for (const u of used) rest = rest.replace(new RegExp(u.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'), 'i'), ' ');
	const amounts = [...rest.matchAll(AMOUNT_RE)].filter((m) => m[4] || m[3] !== undefined || !/^\d{4}$/.test(m[2]!));
	const pick = amounts.find((m) => m[4]) ?? amounts.find((m) => m[3] !== undefined) ?? amounts[amounts.length - 1];
	if (!pick) return { error: 'Montant introuvable : ajoute-le, par exemple « 20,25 € ».' };
	const amount = Number(`${pick[2]!.replace(/[  ]/g, '')}.${pick[3] ?? '0'}`);
	if (!(amount > 0) || amount > 1_000_000) return { error: 'Montant invalide.' };
	const credit = pick[1] === '+' || CREDIT_WORDS.test(raw);
	const instalments = credit || pay?.payment === 'cash' ? 0 : count;
	const forWhom = who && !credit && instalments <= 1 ? who : null;
	const words = rest.slice(0, pick.index) + ' ' + rest.slice(pick.index! + pick[0].length);
	const label = (forWhom ? words.replace(forWhom.used, ' ') : words)
		.replace(/(?<!\p{L})(pour|de|à|a|chez|le|la|les|du|des)\s*$/iu, '')
		.replace(/\s+/g, ' ')
		.replace(/^[\s,;:–-]+|[\s,;:–-]+$/g, '')
		.trim();
	return { label: label || 'Dépense', amount: Math.round(amount * 100) / 100, credit, date, ...(pay ? { payment: pay.payment } : {}), ...(instalments > 1 ? { instalments } : {}), ...(forWhom ? { forWhom: forWhom.who } : {}) };
}

const FOR_RE = /\b[Pp]our\s+([\p{L}'’-]+)(?:\s+([\p{L}'’-]+))?/gu;
const CAPITAL_RE = /^[A-ZÀ-ÖØ-Þ]/u;
const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/’/g, "'").toLowerCase();
/** Words after « pour » that never name someone who pays back: holidays, pronouns, determiners, date words. */
const NOT_A_PERSON = new Set(
	"noel paques halloween toussaint saint nouvel anniversaire fete moi toi lui elle elles nous vous eux tous toutes tout toute le la les l' un une des du mon ma mes ton ta tes son sa ses notre nos votre vos leur leurs ce cet cette ces hier avant-hier demain aujourd'hui lundi mardi mercredi jeudi vendredi samedi dimanche janvier fevrier mars avril mai juin juillet aout septembre octobre novembre decembre".split(' ')
);

/**
 * Who a spend was for: a person already named in a shared spend (« pour léa », « pour léa martin »,
 * any case), else a capitalised name (« pour Léa », « pour Léa Martin ») that is not a holiday, a
 * pronoun or a date word. Returns the name and the words it used.
 */
function readForWhom(text: string, people: readonly string[]): { who: string; used: string } | null {
	const known = people.map((name) => ({ name, words: name.split(/\s+/).map(fold) }));
	for (const m of text.matchAll(FOR_RE)) {
		const first = m[1]!;
		const second = m[2];
		const upToFirst = m[0].slice(0, m[0].indexOf(first, 4) + first.length);
		const both = second !== undefined ? known.find((k) => k.words.length > 1 && k.words[0] === fold(first) && k.words[1] === fold(second)) : undefined;
		if (both) return { who: both.name, used: m[0] };
		const one = known.find((k) => k.words[0] === fold(first) && !NOT_A_PERSON.has(k.words[0]!));
		if (one) return { who: one.name, used: upToFirst };
		if (!CAPITAL_RE.test(first) || NOT_A_PERSON.has(fold(first))) continue;
		if (second !== undefined && CAPITAL_RE.test(second) && !NOT_A_PERSON.has(fold(second))) return { who: `${first} ${second}`, used: m[0] };
		return { who: first, used: upToFirst };
	}
	return null;
}

/**
 * « en 3 fois », « payé en 4x », « 3x », « 3 fois sans frais » (2 to 12). Without « en » nor a glued
 * « x », a number right after reads as a product (« 2 x 15 € », « 2 fois 9 € »).
 */
const INSTALMENTS_RE = /(?:\bpay[ée]e?s?\s+)?(?:\ben\s+(1[0-2]|[2-9])\s*(?:fois|x)\b|\b(1[0-2]|[2-9])x\b|\b(1[0-2]|[2-9])\s*(?:fois|x)\b(?!\s*\d))(?:\s+sans\s+frais)?/i;

/** Payment means a sentence can name (the bank card is the default and needs no word); cash is read by readCash. */
const PAYMENT_WORDS: readonly { re: RegExp; payment: 'swile' | 'culture' }[] = [
	{ re: /\bswile\b/i, payment: 'swile' },
	{ re: /\bch[eè]ques?[- ]culture\b/i, payment: 'culture' }
];

/** « liquide », « espèces », « cash » as whole words (group 2), with « en », « par », « avec (du) », « payé (en) » before them (group 1). */
const CASH_RE = /(?<![\p{L}\p{N}'’-])((?:pay[ée]e?s?\s+)?(?:(?:en|par|avec)\s+(?:du\s+)?)|pay[ée]e?s?\s+)?(liquide|esp[eè]ces?|cash)(?![\p{L}\p{N}'’-])/giu;
/** What turns a bare « liquide » or « cash » into a product or a shop: « liquide vaisselle », « liquide de frein », « cash converters ». */
const PRODUCT_NEXT_RE = /^\s+(?:vaisselle|lave|de|d['’]|du|des|à|a|pour\s+(?:la\s+)?vaisselle|frein|refroidissement|converters|express|piscines?)(?![\p{L}])/iu;
/** The amount right before a word (« 12,50 € liquide », « 5 € cash », « 3e espèces »). */
const AMOUNT_BEFORE_RE = /(?:\d|€|(?<![\p{L}])eur(?:os?)?|\de)\s*$/iu;

/**
 * Cash named in the sentence: « en liquide », « payé (en) liquide », « en espèces », « par cash »
 * anywhere; a bare « espèces » (« especes ») or a standalone « cash » anywhere too; a bare
 * « liquide » only right after the amount (« 3,50 € liquide »). A bare word is never cash when the
 * next word makes it a product or a shop name (« 3 € liquide vaisselle », « Cash Converters »).
 * Anywhere else « liquide » stays in the label: « lessive liquide 8 € », « 8 € lessive liquide »,
 * « savon liquide », « Liquide vaisselle », « e-liquide ». Returns the span of the words to leave
 * out of the label.
 */
function readCash(text: string): { index: number; length: number } | null {
	for (const m of text.matchAll(CASH_RE)) {
		const index = m.index!;
		if (m[1]) return { index, length: m[0].length };
		const after = text.slice(index + m[0].length);
		if (PRODUCT_NEXT_RE.test(after) || /^\s+\p{Lu}/u.test(after)) continue;
		if (fold(m[2]!) !== 'liquide' || AMOUNT_BEFORE_RE.test(text.slice(0, index))) return { index, length: m[0].length };
	}
	return null;
}

/** The sentence without the words that name cash (see readCash); unchanged when it names none. */
export function withoutCashWords(text: string): string {
	const typed = text.replace(/\s+/g, ' ').trim();
	const cash = readCash(typed);
	return cash ? `${typed.slice(0, cash.index)} ${typed.slice(cash.index + cash.length)}`.replace(/\s+/g, ' ').trim() : text;
}

/**
 * Reads the AI answer (JSON alone or in a ```json fence): label, positive amount, direction, date,
 * category among the known ones. Null when unusable (the app then keeps the local parse).
 */
export function readQuickAnswer(raw: string, categories: readonly string[], today: string, subcategories: readonly { id: string; categoryId: string }[] = []): QuickDraft | null {
	const body = /```(?:json)?\s*([\s\S]*?)```/.exec(raw)?.[1] ?? raw;
	let o: Record<string, unknown>;
	try {
		o = JSON.parse(body.trim()) as Record<string, unknown>;
	} catch {
		return null;
	}
	const label = typeof o.libelle === 'string' ? o.libelle.trim().slice(0, 80) : '';
	const amount = typeof o.montant === 'number' ? Math.abs(o.montant) : Number(String(o.montant ?? '').replace(',', '.'));
	const date = typeof o.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.date) && !Number.isNaN(utc(o.date)) && o.date <= today ? o.date : today;
	if (!label || !(amount > 0) || amount > 1_000_000) return null;
	const cat = typeof o.categorie === 'string' && categories.includes(o.categorie) ? (o.categorie as CategoryId) : undefined;
	const sub = cat && typeof o.sous_categorie === 'string' && subcategories.some((s) => s.id === o.sous_categorie && s.categoryId === cat) ? o.sous_categorie : undefined;
	return { label, amount: Math.round(amount * 100) / 100, credit: o.sens === 'credit', date, ...(cat ? { categoryId: cat } : {}), ...(sub ? { subId: sub } : {}) };
}

/** Operation built from a draft, counted at once (booking and value dates set), flagged 'manual'. */
export function draftToTransaction(d: QuickDraft, account: string): Transaction {
	return {
		transaction_amount: { amount: d.amount.toFixed(2), currency: 'EUR' },
		booking_date: d.date,
		value_date: d.date,
		remittance_information: [d.label],
		credit_debit_indicator: d.credit ? 'CRDT' : 'DBIT',
		account,
		source: 'manual'
	};
}

// ---------- Payment in several instalments ----------

export interface Instalment {
	/** 1 for the first. */
	n: number;
	of: number;
	date: string;
	amount: number;
	/** Date reached: counted at once like a quick entry; later ones wait for the bank debit. */
	due: boolean;
}

/** Same day of the months after `date` (the last day when the month is shorter). */
export function instalmentDates(date: string, count: number): string[] {
	return Array.from({ length: count }, (_, i) => addMonths(date, i));
}

/** Amount split to the cent, the first instalment taking the odd cents (100 € → 33,34 + 33,33 + 33,33). */
export function splitInstalments(amount: number, count: number): number[] {
	const cents = Math.round(amount * 100);
	const part = Math.floor(cents / count);
	return Array.from({ length: count }, (_, i) => (i === 0 ? cents - part * (count - 1) : part) / 100);
}

/** Instalments of a draft (a single one when it is not split, for money received, or below a cent each). */
export function instalmentPlan(draft: QuickDraft, today: string): Instalment[] {
	const asked = !draft.credit && draft.instalments && draft.instalments > 1 ? Math.min(12, Math.floor(draft.instalments)) : 1;
	const count = Math.max(1, Math.min(asked, Math.round(draft.amount * 100)));
	const dates = instalmentDates(draft.date, count);
	return splitInstalments(draft.amount, count).map((amount, i) => ({ n: i + 1, of: count, date: dates[i]!, amount, due: dates[i]! <= today }));
}

const shortDate = (iso: string) => new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));

/** « 100,00 € aujourd'hui, puis 100,00 € le 12 nov. et le 12 déc. » (the later instalments share one amount). */
export function instalmentText(plan: readonly Instalment[], today: string): string {
	const [first, ...rest] = plan;
	if (!first) return '';
	const when = (iso: string) => (iso === today ? "aujourd'hui" : `le ${shortDate(iso)}`);
	if (!rest.length) return `${formatEUR(first.amount)} ${when(first.date)}`;
	const dates = rest.map((p) => when(p.date));
	const list = dates.length > 1 ? `${dates.slice(0, -1).join(', ')} et ${dates.at(-1)}` : dates[0];
	return `${formatEUR(first.amount)} ${when(first.date)}, puis ${formatEUR(rest[0]!.amount)} ${list}`;
}

/**
 * Operations of a split payment: today's instalment is counted at once; the others wait without a
 * value date, the future ones until their date, the past ones until they are settled (paired with a
 * bank debit already imported, or counted from their date).
 */
export function instalmentTransactions(draft: QuickDraft, account: string, today: string): Transaction[] {
	return instalmentPlan(draft, today).map((p) => ({
		...draftToTransaction({ ...draft, amount: p.amount, date: p.date }, account),
		...(p.date === today ? {} : { value_date: '' }),
		instalment: { n: p.n, of: p.of }
	}));
}

/** Words of a label worth comparing (lowercase, no accents, 3+ letters, no card/date noise). */
function words(label: string): Set<string> {
	const noise = new Set(['paiement', 'carte', 'prlv', 'sepa', 'vir', 'virement', 'achat', 'cb', 'ech', 'facture']);
	return new Set(
		label
			.toLowerCase()
			.normalize('NFD')
			.replace(/[̀-ͯ]/g, '')
			.split(/[^a-z]+/)
			.filter((w) => w.length >= 3 && !noise.has(w))
	);
}

/** Do two labels share a meaningful word (or does one contain the other)? */
export function labelsMatch(a: string, b: string): boolean {
	const wa = words(a);
	const wb = words(b);
	for (const w of wa) for (const v of wb) if (w === v || (w.length >= 5 && v.includes(w)) || (v.length >= 5 && w.includes(v))) return true;
	return false;
}

export interface QuickMatch {
	/** Index of the quick entry in `manual`. */
	manual: number;
	/** Index of the bank operation in `incoming`. */
	incoming: number;
}

/**
 * Pairs quick entries with imported bank operations: same direction and amount to the cent, bank
 * date from 3 days before to 10 days after the entry (card payments are booked later). A similar
 * label wins; without one, a single candidate is still taken. Each operation is used once, and an
 * entry the user split from its match (`keep`) is never paired again.
 */
export function matchQuickEntries(manual: readonly Transaction[], incoming: readonly Transaction[], keep: (tx: Transaction) => boolean = () => false): QuickMatch[] {
	const used = new Set<number>();
	const out: QuickMatch[] = [];
	const order = manual.map((tx, i) => ({ tx, i })).sort((a, b) => a.tx.booking_date.localeCompare(b.tx.booking_date));
	for (const { tx, i } of order) {
		if (keep(tx)) continue;
		const t = utc(tx.booking_date);
		const candidates = incoming
			.map((inc, j) => ({ inc, j }))
			.filter(({ inc, j }) => {
				if (used.has(j) || inc.source === 'manual' || inc.credit_debit_indicator !== tx.credit_debit_indicator) return false;
				if (Math.abs(Math.abs(signedAmount(inc)) - Math.abs(signedAmount(tx))) > 0.005) return false;
				const d = (utc(inc.booking_date) - t) / DAY;
				return d >= -3 && d <= 10;
			});
		const similar = candidates.filter(({ inc }) => labelsMatch(tx.remittance_information.join(' '), inc.remittance_information.join(' ')));
		const pool = similar.length ? similar : candidates.length === 1 ? candidates : [];
		const best = pool.sort((a, b) => Math.abs(utc(a.inc.booking_date) - t) - Math.abs(utc(b.inc.booking_date) - t))[0];
		if (best) {
			used.add(best.j);
			out.push({ manual: i, incoming: best.j });
		}
	}
	return out;
}

/**
 * Quick entry still unmatched although a statement of its account already covers 7 days after it:
 * probably never paid, or paid differently (other amount, other account).
 */
export function isStale(entry: Transaction, lastStatementDate: string | undefined): boolean {
	return !!lastStatementDate && (utc(lastStatementDate) - utc(entry.booking_date)) / DAY > 7;
}

// ---------- Learning (category and subcategory per word) ----------

/** Votes per meaningful word of the labels saved so far: « categoryId|subId » → count. */
export type QuickMemory = Record<string, Record<string, number>>;

/** Words of a quick-entry label worth remembering (lowercase, no accents, 3+ letters, no stop words). */
export function memoryWords(label: string): string[] {
	const stop = new Set(['pour', 'chez', 'avec', 'les', 'des', 'une', 'aux', 'sur', 'dans', 'achat', 'paiement', 'carte', 'euros', 'eur']);
	return [...new Set(label.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !stop.has(w) && !/^\d+$/.test(w)))];
}

/**
 * Remembers the final category/subcategory of a saved entry for each of its words (`weight` votes).
 * Capped at `max` words: the least used are dropped first.
 */
export function learnQuick(mem: QuickMemory, label: string, categoryId: CategoryId, subId: string | null | undefined, weight = 1, max = 600): QuickMemory {
	const next: QuickMemory = { ...mem };
	const choice = `${categoryId}|${subId ?? ''}`;
	for (const w of memoryWords(label)) next[w] = { ...(next[w] ?? {}), [choice]: (next[w]?.[choice] ?? 0) + weight };
	const words = Object.keys(next);
	if (words.length > max) {
		const total = (w: string) => Object.values(next[w]!).reduce((s, n) => s + n, 0);
		for (const w of words.sort((a, b) => total(a) - total(b)).slice(0, words.length - max)) delete next[w];
	}
	return next;
}

/** Most voted category/subcategory among the words of a label, null when no word is known. */
export function suggestFromMemory(mem: QuickMemory, label: string): { categoryId: CategoryId; subId: string | null; word: string } | null {
	let best: { categoryId: CategoryId; subId: string | null; word: string; n: number } | null = null;
	for (const w of memoryWords(label)) {
		for (const [choice, n] of Object.entries(mem[w] ?? {})) {
			if (!best || n > best.n) {
				const [cat, sub] = choice.split('|');
				best = { categoryId: cat as CategoryId, subId: sub || null, word: w, n };
			}
		}
	}
	return best ? { categoryId: best.categoryId, subId: best.subId, word: best.word } : null;
}

// ---------- Payment: meal card, culture vouchers, cash ----------

/** How an entry was paid: bank card (or account), Swile meal card, culture vouchers, cash wallet. */
export type QuickPayment = 'card' | 'swile' | 'culture' | 'cash';

/**
 * Split of a payment between a voucher wallet and the bank card: the voucher pays up to what is
 * `available` (Swile: daily cap minus what was spent that day; culture vouchers: the balance), the
 * card pays the rest.
 */
export function splitVoucherPayment(amount: number, available: number): { voucher: number; card: number } {
	const voucher = Math.max(0, Math.min(amount, Math.round(available * 100) / 100));
	return { voucher: Math.round(voucher * 100) / 100, card: Math.round((amount - voucher) * 100) / 100 };
}

/** Everyday words typed in a quick entry → category and subcategory (checked after what was learned and the merchant rules). */
const EVERYDAY: readonly { re: RegExp; categoryId: CategoryId; subId: string }[] = [
	{ re: /\b(resto|restaurant|dejeuner|dej|diner|brasserie|bistrot|snack|sandwich|kebab|sushi|pizza|burger|tacos|apero|bar|verre|cafe|the|brunch)\b/, categoryId: 'alimentation', subId: 'restaurants' },
	{ re: /\b(courses|supermarche|marche|epicerie|primeur|fromager|boucherie|carrefour|leclerc|lidl|auchan|monoprix|intermarche|franprix|picard)\b/, categoryId: 'alimentation', subId: 'courses' },
	{ re: /\b(boulangerie|pain|croissant|patisserie|baguette|viennoiserie)\b/, categoryId: 'alimentation', subId: 'petits-commercants' },
	{ re: /\b(essence|plein|carburant|gasoil|diesel|sp95|sp98|e10)\b/, categoryId: 'voiture', subId: 'carburant' },
	{ re: /\b(peage|parking|stationnement)\b/, categoryId: 'voiture', subId: 'peages-parkings' },
	{ re: /\b(taxi|uber|vtc|bolt|heetch)\b/, categoryId: 'transport', subId: 'vtc-taxi' },
	{ re: /\b(metro|bus|tram|navigo|ticket|rer|train|sncf|tgv|ouigo)\b/, categoryId: 'transport', subId: 'transports-commun' },
	{ re: /\b(cinema|concert|theatre|musee|expo|exposition|spectacle|bowling|escape)\b/, categoryId: 'loisirs', subId: 'culture-sorties' },
	{ re: /\b(pharmacie|medicament|doliprane|medecin|dentiste|kine|osteo|ophtalmo)\b/, categoryId: 'sante', subId: 'pharmacie' },
	{ re: /\b(cadeau|anniversaire|fleurs)\b/, categoryId: 'loisirs', subId: 'cadeaux' }
];

/** Category of everyday words in a quick-entry label, null when none matches. */
export function everydayCategory(label: string): { categoryId: CategoryId; subId: string } | null {
	const n = ` ${label.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ')} `;
	const hit = EVERYDAY.find((r) => r.re.test(n));
	if (!hit) return null;
	return { categoryId: hit.categoryId, subId: /\b(medecin|dentiste|kine|osteo|ophtalmo)\b/.test(n) ? 'soins' : hit.subId };
}
