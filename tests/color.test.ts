import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lighten, readsOnWhite } from '../src/lib/color';

test('readsOnWhite: dark and saturated colours do, pale ones and invalid values do not', () => {
	assert.equal(readsOnWhite('#1e339b'), true);
	assert.equal(readsOnWhite('#e60012'), true);
	assert.equal(readsOnWhite('#1ed760'), true);
	assert.equal(readsOnWhite('#ffffff'), false);
	assert.equal(readsOnWhite('nope'), false);
});

test('lighten: mixes towards white, leaves an invalid colour as is', () => {
	assert.equal(lighten('#000000', 0.5), '#808080');
	assert.equal(lighten('#c9a86c', 0), '#c9a86c');
	assert.equal(lighten('nope'), 'nope');
});
