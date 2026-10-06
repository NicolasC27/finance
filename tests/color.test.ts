import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lighten, readableInk } from '../src/lib/color';

test('readableInk: white on dark colours, black on light ones, white when the colour is invalid', () => {
	assert.equal(readableInk('#000000'), '#ffffff');
	assert.equal(readableInk('#1e339b'), '#ffffff');
	assert.equal(readableInk('#ffffff'), '#000000');
	assert.equal(readableInk('#ffd400'), '#000000');
	assert.equal(readableInk('pas une couleur'), '#ffffff');
});

test('lighten: mixes towards white, leaves an invalid colour as is', () => {
	assert.equal(lighten('#000000', 0.5), '#808080');
	assert.equal(lighten('#c9a86c', 0), '#c9a86c');
	assert.equal(lighten('nope'), 'nope');
});
