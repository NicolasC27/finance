import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	addTags,
	hasTag,
	normalizeTag,
	normalizeTags,
	removeTags,
	sameTags,
	splitTagInput,
	suggestTags,
	tagInventory,
	TAG_MAX_LENGTH
} from '../src/lib/tags';

/** Free tags on transactions (Transactions page, bulk edit). */

/** Cut at the 30th character: no trailing space. */
test('normalizeTag: spaces collapsed, at most 30 characters, empty → ""', () => {
	assert.equal(normalizeTag('  travaux   cuisine '), 'travaux cuisine');
	assert.equal(normalizeTag('   '), '');
	const long = 'x'.repeat(50);
	assert.equal(normalizeTag(long).length, TAG_MAX_LENGTH);
	assert.equal(normalizeTag(`${'a'.repeat(29)} b`), 'a'.repeat(29));
});

test('normalizeTags: case-insensitive duplicates, first spelling kept', () => {
	assert.deepEqual(normalizeTags(['Travaux', 'travaux', ' TRAVAUX ', 'Noël', '']), ['Travaux', 'Noël']);
});

test('splitTagInput: commas and semicolons', () => {
	assert.deepEqual(splitTagInput('travaux, cuisine; travaux'), ['travaux', 'cuisine']);
	assert.deepEqual(splitTagInput(' , ; '), []);
});

test('addTags / removeTags: no duplicates, case-insensitive removal', () => {
	assert.deepEqual(addTags(undefined, ['mariage Léa']), ['mariage Léa']);
	assert.deepEqual(addTags(['amazon'], ['Amazon', 'cadeaux']), ['amazon', 'cadeaux']);
	assert.deepEqual(removeTags(['amazon', 'Cadeaux'], ['cadeaux']), ['amazon']);
	assert.deepEqual(removeTags(undefined, ['x']), []);
	assert.ok(hasTag(['Travaux'], 'travaux'));
	assert.ok(!hasTag(undefined, 'travaux'));
	assert.ok(!hasTag(['travaux'], '  '));
});

test('sameTags: order and case ignored (no needless write)', () => {
	assert.ok(sameTags(['b', 'A'], ['a', 'B']));
	assert.ok(sameTags(undefined, []));
	assert.ok(!sameTags(['a'], ['a', 'b']));
});

test('tagInventory: decreasing frequency, most frequent spelling', () => {
	const inv = tagInventory([
		{ tags: ['travaux', 'Cuisine'] },
		{ tags: ['Travaux'] },
		{ tags: ['travaux'] },
		{ tags: ['amazon'] },
		{},
		{ tags: ['cuisine'] }
	]);
	assert.deepEqual(inv, [
		{ tag: 'travaux', count: 3 },
		{ tag: 'Cuisine', count: 2 },
		{ tag: 'amazon', count: 1 }
	]);
});

test('suggestTags: prefix matches first, then substring matches; tags already set excluded', () => {
	const inv = [
		{ tag: 'travaux', count: 5 },
		{ tag: 'cadeaux', count: 3 },
		{ tag: 'gros travaux', count: 2 },
		{ tag: 'amazon', count: 1 }
	];
	assert.deepEqual(suggestTags(inv, 'tra'), ['travaux', 'gros travaux']);
	assert.deepEqual(suggestTags(inv, 'TRA', ['Travaux']), ['gros travaux']);
	assert.deepEqual(suggestTags(inv, '', ['cadeaux'], 2), ['travaux', 'gros travaux']);
	assert.deepEqual(suggestTags(inv, 'zzz'), []);
});
