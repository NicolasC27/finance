import type { CategoryId, Transaction } from './types';
import { signedAmount } from './data';

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
	/** Payment named in the sentence (« swile », « chèques culture »); the card otherwise. */
	payment?: 'swile' | 'culture';
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
 * the rest is the label. « + », « reçu », « remboursement »… make it money received. Returns an
 * error message when no amount can be read.
 */
export function parseQuickEntry(text: string, today: string): QuickDraft | { error: string } {
	const typed = text.replace(/\s+/g, ' ').trim();
	if (!typed) return { error: 'Écris par exemple « leboncoin 20,25 € ».' };
	const pay = PAYMENT_WORDS.find((p) => p.re.test(typed));
	const raw = typed.replace(/\s*\b(en|par|avec)?\s*(swile|ch[eè]ques?[- ]culture|carte|cb)\b/gi, ' ').replace(/\s+/g, ' ').trim();
	const { date, used } = readDate(raw, today);
	let rest = raw;
	for (const u of used) rest = rest.replace(new RegExp(u.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'), 'i'), ' ');
	const amounts = [...rest.matchAll(AMOUNT_RE)].filter((m) => m[4] || m[3] !== undefined || !/^\d{4}$/.test(m[2]!));
	const pick = amounts.find((m) => m[4]) ?? amounts.find((m) => m[3] !== undefined) ?? amounts[amounts.length - 1];
	if (!pick) return { error: 'Montant introuvable : ajoute-le, par exemple « 20,25 € ».' };
	const amount = Number(`${pick[2]!.replace(/[  ]/g, '')}.${pick[3] ?? '0'}`);
	if (!(amount > 0) || amount > 1_000_000) return { error: 'Montant invalide.' };
	const label = (rest.slice(0, pick.index) + ' ' + rest.slice(pick.index! + pick[0].length))
		.replace(/\b(pour|de|à|a|chez|le|la|les|du|des)\s*$/i, '')
		.replace(/\s+/g, ' ')
		.replace(/^[\s,;:–-]+|[\s,;:–-]+$/g, '')
		.trim();
	const credit = pick[1] === '+' || CREDIT_WORDS.test(raw);
	return { label: label || 'Dépense', amount: Math.round(amount * 100) / 100, credit, date, ...(pay ? { payment: pay.payment } : {}) };
}

/** Payment means a sentence can name (the bank card is the default and needs no word). */
const PAYMENT_WORDS: readonly { re: RegExp; payment: 'swile' | 'culture' }[] = [
	{ re: /\bswile\b/i, payment: 'swile' },
	{ re: /\bch[eè]ques?[- ]culture\b/i, payment: 'culture' }
];

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

// ---------- Payment: meal card and culture vouchers ----------

export type QuickPayment = 'card' | 'swile' | 'culture';

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
