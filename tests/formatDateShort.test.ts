import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDate, formatDateShort } from '../src/lib/format';

test('a date of the given year drops the year, another year keeps it', () => {
	assert.equal(formatDateShort('2026-07-15', 2026), '15 juil.');
	assert.equal(formatDateShort('2025-07-15', 2026), formatDate('2025-07-15'));
	assert.match(formatDateShort('2025-07-15', 2026), /2025/);
});

test('an empty or unreadable date reads like formatDate', () => {
	assert.equal(formatDateShort('', 2026), 'En cours');
	assert.equal(formatDateShort('2026-xx-01', 2026), '2026-xx-01');
});
