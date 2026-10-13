import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CategoryId, Transaction } from '../src/lib/types';
import { categoryLayout, headPage, monthBounds, monthsWithRows, pageHeads, rangeMonth, spendingShare, stepMonth, type CategoryLayout } from '../src/lib/categoryGroups';

/** « Catégorie » sort of the Transactions list: groups, order, folding, headers per page and the month stepper. */

let seq = 0;
const tx = (cat: CategoryId, date: string, amount: number, extra: Partial<Transaction> = {}): Transaction => ({
	transaction_amount: { amount: Math.abs(amount).toFixed(2), currency: 'EUR' },
	booking_date: date,
	value_date: date,
	remittance_information: [`Shop ${++seq}`],
	credit_debit_indicator: amount >= 0 ? 'CRDT' : 'DBIT',
	virtual_category: cat,
	...extra
});

const catOf = (t: Transaction): CategoryId => t.virtual_category!;
const all = () => true;
const ids = (layout: CategoryLayout) => layout.groups.map((g) => g.id);
const heads = (list: { group: { id: string }; continued: boolean; folded: boolean }[]) => list.map((h) => `${h.group.id}${h.continued ? '+' : ''}${h.folded ? '-' : ''}`);

const food1 = tx('alimentation', '2026-03-02', -30);
const food2 = tx('alimentation', '2026-03-09', -20);
const foodRefund = tx('alimentation', '2026-03-10', 10);
const fun = tx('loisirs', '2026-03-05', -60);
const health = tx('sante', '2026-03-04', -5);
const pay = tx('revenus', '2026-03-01', 100);
const savings = tx('epargne', '2026-03-03', -50);
const sample = [food1, pay, food2, savings, fun, foodRefund, health];

test('spending first by net spending, then savings and transfers, then income; ascending is the reverse', () => {
	const desc = categoryLayout(sample, catOf, all, 'desc');
	assert.deepEqual(ids(desc), ['loisirs', 'alimentation', 'sante', 'epargne', 'revenus']);
	assert.deepEqual(ids(categoryLayout(sample, catOf, all, 'asc')), ['revenus', 'epargne', 'sante', 'alimentation', 'loisirs']);
});

test('net counts only the rows of the page totals, refunds deducted; the count keeps every row', () => {
	const pending = tx('alimentation', '', -500, { value_date: '' });
	const layout = categoryLayout([...sample, pending], catOf, (t) => t.booking_date !== '', 'desc');
	const food = layout.groups.find((g) => g.id === 'alimentation')!;
	assert.equal(food.net, -40);
	assert.equal(food.count, 4);
	assert.equal(food.kind, 'expense');
	assert.equal(layout.groups.find((g) => g.id === 'revenus')!.kind, 'income');
});

test('a category whose refunds exceed its spending ends the spending block', () => {
	const layout = categoryLayout([tx('sante', '2026-03-01', -5), tx('sante', '2026-03-02', 25), tx('loisirs', '2026-03-03', -1), pay], catOf, all, 'desc');
	assert.deepEqual(ids(layout), ['loisirs', 'sante', 'revenus']);
});

test('rows follow the category order, newest first inside a category whatever the direction, pending rows last', () => {
	const pending = tx('alimentation', '', -7, { value_date: '' });
	const desc = categoryLayout([...sample, pending], catOf, all, 'desc');
	assert.deepEqual(desc.rows, [fun, foodRefund, food2, food1, pending, health, savings, pay]);
	const asc = categoryLayout([...sample, pending], catOf, all, 'asc');
	assert.deepEqual(asc.rows, [pay, savings, health, foodRefund, food2, food1, pending, fun]);
});

test('ties go to the busier category, then to the id, so the order never flickers', () => {
	const layout = categoryLayout([tx('sante', '2026-03-01', -10), tx('loisirs', '2026-03-01', -10), tx('transport', '2026-03-01', -4), tx('transport', '2026-03-02', -6)], catOf, all, 'desc');
	assert.deepEqual(ids(layout), ['transport', 'loisirs', 'sante']);
});

test('a folded category keeps its header but leaves the rows', () => {
	const layout = categoryLayout(sample, catOf, all, 'desc', new Set<CategoryId>(['alimentation']));
	assert.deepEqual(ids(layout), ['loisirs', 'alimentation', 'sante', 'epargne', 'revenus']);
	assert.deepEqual(layout.rows, [fun, health, savings, pay]);
	assert.deepEqual(layout.starts, [0, 1, 1, 2, 3]);
	const page = pageHeads(layout, 0, 4);
	assert.deepEqual(page.before.map(heads), [['loisirs'], ['alimentation-', 'sante'], ['epargne'], ['revenus']]);
	assert.deepEqual(page.after, []);
});

test('a category cut by the page break repeats its header, marked as continued', () => {
	const layout = categoryLayout(sample, catOf, all, 'desc');
	assert.deepEqual(layout.starts, [0, 1, 4, 5, 6]);
	const first = pageHeads(layout, 0, 3);
	assert.deepEqual(first.before.map(heads), [['loisirs'], ['alimentation'], []]);
	const second = pageHeads(layout, 3, 6);
	assert.deepEqual(second.before.map(heads), [['alimentation+'], ['sante'], ['epargne']]);
	const third = pageHeads(layout, 6, 7);
	assert.deepEqual(third.before.map(heads), [['revenus']]);
	assert.deepEqual(third.after, []);
});

test('a category ending exactly on the page break is not repeated on the next page', () => {
	const layout = categoryLayout(sample, catOf, all, 'desc');
	const first = pageHeads(layout, 0, 4);
	assert.deepEqual(first.before.map(heads), [['loisirs'], ['alimentation'], [], []]);
	const second = pageHeads(layout, 4, 7);
	assert.deepEqual(second.before.map(heads), [['sante'], ['epargne'], ['revenus']]);
	assert.equal(headPage(layout, 'sante', 4), 2);
});

test('folded categories at a page break open the next page, those ending the list follow its last row', () => {
	const folded = new Set<CategoryId>(['sante', 'revenus']);
	const layout = categoryLayout(sample, catOf, all, 'desc', folded);
	assert.equal(layout.rows.length, 5);
	const first = pageHeads(layout, 0, 4);
	assert.deepEqual(first.before.map(heads), [['loisirs'], ['alimentation'], [], []]);
	assert.deepEqual(first.after, []);
	const last = pageHeads(layout, 4, 5);
	assert.deepEqual(last.before.map(heads), [['sante-', 'epargne']]);
	assert.deepEqual(heads(last.after), ['revenus-']);
	assert.equal(headPage(layout, 'sante', 4), 2);
	assert.equal(headPage(layout, 'revenus', 4), 2);
	assert.equal(headPage(layout, 'alimentation', 4), 1);
});

test('everything folded: one empty page holding every header', () => {
	const layout = categoryLayout(sample, catOf, all, 'desc', new Set<CategoryId>(['loisirs', 'alimentation', 'sante', 'epargne', 'revenus']));
	assert.equal(layout.rows.length, 0);
	const page = pageHeads(layout, 0, 0);
	assert.deepEqual(page.before, []);
	assert.deepEqual(heads(page.after), ['loisirs-', 'alimentation-', 'sante-', 'epargne-', 'revenus-']);
	assert.equal(headPage(layout, 'revenus', 50), 1);
});

test('headers never count as rows: a folded summary is one page, one unfolded category alone fills the pages', () => {
	const others = new Set<CategoryId>(['loisirs', 'sante', 'epargne', 'revenus']);
	const layout = categoryLayout(sample, catOf, all, 'desc', others);
	assert.deepEqual(layout.rows, [foodRefund, food2, food1]);
	const first = pageHeads(layout, 0, 2);
	assert.deepEqual(first.before.map(heads), [['loisirs-', 'alimentation'], []]);
	assert.deepEqual(first.after, []);
	const second = pageHeads(layout, 2, 3);
	assert.deepEqual(second.before.map(heads), [['alimentation+']]);
	assert.deepEqual(heads(second.after), ['sante-', 'epargne-', 'revenus-']);
	assert.equal(headPage(layout, 'revenus', 2), 2);
	assert.equal(headPage(layout, 'loisirs', 2), 1);
});

test('the page of a header follows its first row', () => {
	const layout = categoryLayout(sample, catOf, all, 'desc');
	assert.equal(headPage(layout, 'loisirs', 3), 1);
	assert.equal(headPage(layout, 'sante', 3), 2);
	assert.equal(headPage(layout, 'revenus', 3), 3);
	assert.equal(headPage(layout, 'vacances', 3), 1);
});

test('share of the filtered spending: spending categories only, capped at the whole', () => {
	const layout = categoryLayout(sample, catOf, all, 'desc');
	const group = (id: CategoryId) => layout.groups.find((g) => g.id === id)!;
	assert.equal(spendingShare(group('loisirs'), 105), 60 / 105);
	assert.equal(spendingShare(group('revenus'), 105), 0);
	assert.equal(spendingShare(group('epargne'), 105), 0);
	assert.equal(spendingShare(group('loisirs'), 40), 1);
	assert.equal(spendingShare(group('loisirs'), 0), 0);
});

test('a month reads and writes as its first and last day, leap years included', () => {
	assert.deepEqual(monthBounds('2026-09'), ['2026-09-01', '2026-09-30']);
	assert.deepEqual(monthBounds('2026-12'), ['2026-12-01', '2026-12-31']);
	assert.deepEqual(monthBounds('2028-02'), ['2028-02-01', '2028-02-29']);
	assert.deepEqual(monthBounds('2026-02'), ['2026-02-01', '2026-02-28']);
	assert.equal(rangeMonth('2026-09-01', '2026-09-30'), '2026-09');
	assert.equal(rangeMonth('2028-02-01', '2028-02-29'), '2028-02');
});

test('only a period covering exactly one whole month is a month', () => {
	assert.equal(rangeMonth('', ''), '');
	assert.equal(rangeMonth('2026-09-01', ''), '');
	assert.equal(rangeMonth('', '2026-09-30'), '');
	assert.equal(rangeMonth('2026-09-01', '2026-09-29'), '');
	assert.equal(rangeMonth('2026-09-02', '2026-09-30'), '');
	assert.equal(rangeMonth('2026-09-01', '2026-10-31'), '');
	assert.equal(rangeMonth('2026-13-01', '2027-01-31'), '');
});

test('months with operations: dated rows only, oldest first, each once', () => {
	const pending = tx('alimentation', '', -7, { value_date: '' });
	const planned = tx('alimentation', '2027-01-15', -40, { value_date: '', source: 'manual' });
	assert.deepEqual(monthsWithRows([food1, tx('loisirs', '2026-01-20', -3), pending, planned, tx('sante', '2026-05-31', -2), food2]), ['2026-01', '2026-03', '2026-05']);
	assert.deepEqual(monthsWithRows([]), []);
});

test('the period stepper skips the months without operations and stops at both ends', () => {
	const months = ['2026-01', '2026-03', '2026-05'];
	assert.equal(stepMonth(months, '2026-03', -1), '2026-01');
	assert.equal(stepMonth(months, '2026-03', 1), '2026-05');
	assert.equal(stepMonth(months, '2026-04', -1), '2026-03');
	assert.equal(stepMonth(months, '2026-04', 1), '2026-05');
	assert.equal(stepMonth(months, '2026-01', -1), '');
	assert.equal(stepMonth(months, '2026-05', 1), '');
	assert.equal(stepMonth(months, '', -1), '');
	assert.equal(stepMonth([], '2026-03', 1), '');
});
