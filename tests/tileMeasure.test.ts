import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pressOnScrollbar, type ScrollBox } from '../src/lib/tileMeasure';

const box = (o: Partial<ScrollBox>): ScrollBox => ({ overflowX: 'visible', overflowY: 'visible', clientWidth: 0, clientHeight: 0, scrollWidth: 0, scrollHeight: 0, ...o });

test('inline text (client size 0, no scrolling) is never a scrollbar press: the tile can be lifted from an amount', () => {
	assert.equal(pressOnScrollbar(box({}), 12, 8), false);
	assert.equal(pressOnScrollbar(box({ overflowY: 'auto', clientWidth: 0, clientHeight: 0, scrollHeight: 0 }), 30, 5), false);
});

test('a press past the client area of an element that really scrolls is a scrollbar press', () => {
	const scrolling = box({ overflowY: 'auto', clientWidth: 300, clientHeight: 200, scrollWidth: 300, scrollHeight: 900 });
	assert.equal(pressOnScrollbar(scrolling, 305, 50), true);
	assert.equal(pressOnScrollbar(scrolling, 150, 50), false);
	const fits = box({ overflowY: 'auto', clientWidth: 300, clientHeight: 200, scrollWidth: 300, scrollHeight: 200 });
	assert.equal(pressOnScrollbar(fits, 305, 50), false, 'content fits: no scrollbar');
	const wide = box({ overflowX: 'scroll', clientWidth: 300, clientHeight: 200, scrollWidth: 800, scrollHeight: 200 });
	assert.equal(pressOnScrollbar(wide, 40, 205), true);
});
