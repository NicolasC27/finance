/**
 * Free tags of operations (pure module, testable with tsx): 'travaux cuisine', 'mariage Léa'…
 * A tag groups operations of different categories; the Transactions page filter gives its total.
 *
 * Case-insensitive comparison: 'Travaux' and 'travaux' are the same tag, the first spelling met
 * is kept.
 */

/** Maximum tag length (cut beyond). */
export const TAG_MAX_LENGTH = 30;

/** Cleans a typed tag: spaces collapsed, at most 30 characters; '' if empty. */
export function normalizeTag(raw: string): string {
	return raw.normalize('NFC').replace(/\s+/g, ' ').trim().slice(0, TAG_MAX_LENGTH).trim();
}

/** Comparison key of a tag (case insensitive). */
export function tagKey(tag: string): string {
	return normalizeTag(tag).toLocaleLowerCase('fr');
}

/** Input 'travaux, cuisine' → ['travaux', 'cuisine'] (commas or semicolons). */
export function splitTagInput(raw: string): string[] {
	return normalizeTags(raw.split(/[,;]/));
}

/** Clean list: normalised tags, no empty value or duplicate (first spelling kept). */
export function normalizeTags(tags: readonly string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const raw of tags) {
		const tag = normalizeTag(raw);
		const key = tag.toLocaleLowerCase('fr');
		if (!tag || seen.has(key)) continue;
		seen.add(key);
		out.push(tag);
	}
	return out;
}

/** Is the tag set? (case insensitive) */
export function hasTag(tags: readonly string[] | undefined, tag: string): boolean {
	const key = tagKey(tag);
	return key !== '' && (tags ?? []).some((t) => tagKey(t) === key);
}

/** Adds tags (those already present, ignoring case, are skipped). */
export function addTags(current: readonly string[] | undefined, added: readonly string[]): string[] {
	return normalizeTags([...(current ?? []), ...added]);
}

/** Removes tags (case-insensitive comparison). */
export function removeTags(current: readonly string[] | undefined, removed: readonly string[]): string[] {
	const drop = new Set(removed.map(tagKey));
	return normalizeTags(current ?? []).filter((t) => !drop.has(tagKey(t)));
}

/** Same tags, ignoring order and case? (avoids a useless write) */
export function sameTags(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
	const ka = normalizeTags(a ?? []).map(tagKey).sort();
	const kb = normalizeTags(b ?? []).map(tagKey).sort();
	return ka.length === kb.length && ka.every((k, i) => k === kb[i]);
}

export interface TagCount {
	tag: string;
	count: number;
}

/**
 * Tag inventory: number of operations per tag, from the most frequent to the rarest (then
 * alphabetical). Displayed spelling: the most frequent one.
 */
export function tagInventory(txs: readonly { tags?: readonly string[] }[]): TagCount[] {
	const byKey = new Map<string, { count: number; spellings: Map<string, number> }>();
	for (const tx of txs) {
		for (const tag of normalizeTags(tx.tags ?? [])) {
			const key = tag.toLocaleLowerCase('fr');
			const entry = byKey.get(key) ?? { count: 0, spellings: new Map<string, number>() };
			entry.count++;
			entry.spellings.set(tag, (entry.spellings.get(tag) ?? 0) + 1);
			byKey.set(key, entry);
		}
	}
	const out: TagCount[] = [];
	for (const entry of byKey.values()) {
		let tag = '';
		let best = 0;
		for (const [spelling, n] of entry.spellings) {
			if (n > best) {
				tag = spelling;
				best = n;
			}
		}
		out.push({ tag, count: entry.count });
	}
	return out.sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'fr'));
}

/**
 * Autocomplete suggestions: existing tags starting with the input, then those containing it,
 * without the ones already set. Empty input → the most frequent ones.
 */
export function suggestTags(inventory: readonly TagCount[], input: string, exclude: readonly string[] = [], limit = 6): string[] {
	const q = tagKey(input);
	const skip = new Set(exclude.map(tagKey));
	const candidates = inventory.filter((t) => !skip.has(tagKey(t.tag)));
	if (!q) return candidates.slice(0, limit).map((t) => t.tag);
	const starts = candidates.filter((t) => tagKey(t.tag).startsWith(q));
	const contains = candidates.filter((t) => !tagKey(t.tag).startsWith(q) && tagKey(t.tag).includes(q));
	return [...starts, ...contains].slice(0, limit).map((t) => t.tag);
}
