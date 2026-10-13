import type { Transaction } from './types';
import { isComputedEntry } from './data';
import { cleanLabel } from './format';
import { merchantLabel } from './merchant';

/**
 * Merchant searches of the Transactions list, shared by every page that opens it on a merchant
 * (right click on a row of Transactions, on a recent operation of the dashboard, on a direct debit
 * of the schedule). The search box looks into the raw and cleaned labels while the pages show the
 * short merchant name (« Villefictive E Marche » for « PAIEMENT CB 1210 VILLEFICTIVE E.MARCHE CARTE
 * 1234 », « Liquide : Marche » for « Liquide : marché »): searching that name could list nothing. The
 * query built here is always found in the operation it comes from, so its list is never empty.
 */

/** Text the Transactions search box looks into, in lower case: raw and cleaned label, note, tags. */
export function transactionSearchText(tx: Transaction): string {
	return [tx.remittance_information.join(' '), cleanLabel(tx.remittance_information), tx.note ?? '', (tx.tags ?? []).join(' ')].join(' ').toLowerCase();
}

/** Does an operation match the text of the search box (trimmed, case ignored; empty matches all)? */
export function matchesSearch(tx: Transaction, query: string): boolean {
	return transactionSearchText(tx).includes(query.trim().toLowerCase());
}

/** List label of an operation: short merchant name, cleaned label when empty; computed entries keep their written label. */
export function listLabel(tx: Transaction): string {
	return isComputedEntry(tx) ? cleanLabel(tx.remittance_information) : merchantLabel(tx.remittance_information) || cleanLabel(tx.remittance_information);
}

const LETTER_OR_DIGIT = '[\\p{L}\\p{N}\\p{M}]';
const SEPARATOR = '[^\\p{L}\\p{N}\\p{M}]+';
/** Shortest stretch kept as a query: one or two letters would match almost every operation. */
const MIN_STRETCH = 3;

/** Words of a name, without accents and in lower case. */
function nameWords(name: string): string[] {
	return name
		.normalize('NFD')
		.replace(/\p{M}/gu, '')
		.toLowerCase()
		.split(/[^\p{L}\p{N}]+/u)
		.filter((w) => w !== '');
}

/**
 * Pattern of a word in a decomposed text: any accent may follow each of its letters, and a dot may
 * part them (merchantKey joins a dotted acronym: « CPAM » for « C.P.A.M. »).
 */
function wordPattern(word: string): string {
	return [...word].map((c) => `${c}\\p{M}*`).join('\\.?');
}

/** Pattern of whole words of a decomposed text, in this order, joined by `gap` (a pattern source). */
function wordsPattern(words: readonly string[], gap: string, flags = 'u'): RegExp {
	return new RegExp(`(?<!${LETTER_OR_DIGIT})${words.map(wordPattern).join(gap)}(?!${LETTER_OR_DIGIT})`, flags);
}

/** Stretch of a decomposed text back in the form of the text; null when not in it as written or under MIN_STRETCH. */
function asWritten(text: string, stretch: string | undefined): string | null {
	const hit = stretch?.normalize('NFC');
	return hit && hit.length >= MIN_STRETCH && text.includes(hit) ? hit : null;
}

/** First stretch of a text matched by a pattern of words, as written in it; null under MIN_STRETCH. */
function stretchIn(text: string, pattern: RegExp): string | null {
	return asWritten(text, pattern.exec(text.normalize('NFD'))?.[0]);
}

/**
 * Longest stretch of a lower-case text that spells consecutive words of a name, accents allowed and
 * whatever punctuation separates them (« villefictive e.marche » for « Villefictive E Marche »,
 * « streamflix.com » for « Streamflix Com »); a number standing between two words splits the stretch.
 * At least half of the words must be spelled, and at least `fewest` of them (two by default, all of
 * a shorter name): a lone word of a longer name may be its city (« villefictive ») or a generic word
 * (« assurances »). Null when no stretch of at least three characters is found.
 */
export function spelledStretch(name: string, text: string, fewest = 2): string | null {
	const words = nameWords(name);
	const least = Math.max(Math.ceil(words.length / 2), Math.min(fewest, words.length), 1);
	for (let n = words.length; n >= least; n--) {
		let best: string | null = null;
		for (let i = 0; i + n <= words.length; i++) {
			const hit = stretchIn(text, wordsPattern(words.slice(i, i + n), SEPARATOR));
			if (hit && hit.length > (best?.length ?? 0)) best = hit;
		}
		if (best) return best;
	}
	return null;
}

/**
 * Stretch of a lower-case text holding every word of a name in its order, whatever stands between
 * them (« villefictive 15 boulangerie » for « Villefictive Boulangerie »): a shop number between two
 * words splits every spelled stretch, and one word alone could list a whole town. Each word is taken
 * at its first place after the previous one (linear, whatever the label repeats). Null for a name of
 * fewer than two words, or whose words are not in that order in the text.
 */
export function coveringStretch(name: string, text: string): string | null {
	const words = nameWords(name);
	if (words.length < 2) return null;
	const decomposed = text.normalize('NFD');
	let start = -1;
	let end = 0;
	for (const word of words) {
		const pattern = wordsPattern([word], '', 'gu');
		pattern.lastIndex = end;
		const hit = pattern.exec(decomposed);
		if (!hit) return null;
		if (start < 0) start = hit.index;
		end = hit.index + hit[0].length;
	}
	return asWritten(text, decomposed.slice(start, end));
}

/** First hit of a search over texts taken in their order; null when none hits. */
function firstHit(texts: readonly string[], find: (text: string) => string | null): string | null {
	for (const text of texts) {
		const hit = find(text);
		if (hit !== null) return hit;
	}
	return null;
}

/**
 * Search box text that lists the operations of the merchant of `tx` and is always found in the label
 * of `tx` itself (never only in its note or tags, which its other operations lack): its short name
 * when the label holds it, else the stretch of the label spelling most of that name (spelledStretch),
 * else the stretch covering all of it (coveringStretch), else one word of it (a name built in another
 * order, « Carte Kraken »), else its cleaned label. A portage entry drops what follows « · » (its
 * month), so every month of that entry is listed. Empty only for an empty label.
 */
export function merchantSearchQuery(tx: Transaction): string {
	const label = listLabel(tx);
	const name = tx.source === 'portage' ? label.split(' · ')[0]!.trim() : label;
	const cleaned = cleanLabel(tx.remittance_information);
	const labels = [tx.remittance_information.join(' ').toLowerCase(), cleaned.toLowerCase()];
	if (name !== '' && labels.some((l) => l.includes(name.toLowerCase()))) return name;
	return (
		firstHit(labels, (l) => spelledStretch(name, l)) ??
		firstHit(labels, (l) => coveringStretch(name, l)) ??
		firstHit(labels, (l) => spelledStretch(name, l, 1)) ??
		cleaned
	);
}

/**
 * Merchant search of a group of operations (the occurrences of a detected direct debit): that of the
 * latest one, whose label names the group, so its list holds at least that operation; '' when empty.
 */
export function latestMerchantQuery(txs: readonly Transaction[]): string {
	let latest: Transaction | null = null;
	for (const tx of txs) if (!latest || tx.booking_date > latest.booking_date) latest = tx;
	return latest ? merchantSearchQuery(latest) : '';
}
