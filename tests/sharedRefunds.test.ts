import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchRefunds, shareRange, totalOwed, type Credit, type RefundClaim } from '../src/lib/refunds';
import { parseQuickEntry, type QuickDraft } from '../src/lib/quickEntry';

const TODAY = '2026-10-05';
const spend = (o: Partial<RefundClaim>): RefundClaim => ({ expenseKey: 'a', source: 'personne', who: 'Léa', expected: 14.6, date: '2026-09-02', categoryId: 'alimentation', auto: false, shared: true, ...o });
const credit = (key: string, date: string, amount: number, label = 'VIR INST M LEA MARTIN'): Credit => ({ key, date, amount, label });
const twoSpends = [spend({}), spend({ expenseKey: 'b', expected: 5.1, date: '2026-09-03' })];
const states = (claims: RefundClaim[], credits: Credit[]) => matchRefunds(claims, credits, TODAY).map((s) => [s.state, s.refunded]);

test('one transfer between 40 % and 110 % of two shared spends settles both, split pro rata', () => {
	const s = matchRefunds(twoSpends, [credit('c', '2026-09-10', 19)], TODAY);
	assert.deepEqual(s.map((x) => x.state), ['refunded', 'refunded']);
	assert.deepEqual(s.map((x) => x.refunded), [14.08, 4.92]);
	assert.equal(totalOwed(s), 0);
});

test('a transfer settles the spends it fits, an older unpaid spend does not block a newer one', () => {
	assert.deepEqual(states(twoSpends, [credit('c', '2026-09-10', 7)]), [['refunded', 7], ['overdue', 0]]);
	const older = spend({ expected: 50, date: '2026-09-01' });
	const newer = spend({ expenseKey: 'b', expected: 10, date: '2026-09-05' });
	assert.deepEqual(states([older, newer], [credit('c', '2026-09-06', 5)]), [['overdue', 0], ['refunded', 5]]);
	assert.deepEqual(states([older, newer], [credit('c1', '2026-09-06', 25), credit('c2', '2026-09-10', 5)]), [['refunded', 25], ['refunded', 5]], 'half of each, one transfer each');
});

test('under 40 % or over 110 % is not a share; a non-shared claim can still use it', () => {
	assert.deepEqual(states(twoSpends, [credit('c', '2026-09-10', 1.5)]), [['overdue', 0], ['overdue', 0]]);
	const loan = spend({ expenseKey: 'loan', shared: false, expected: 200, date: '2026-09-01', categoryId: 'autre' });
	assert.deepEqual(states([...twoSpends, loan], [credit('big', '2026-09-10', 300)]), [['overdue', 0], ['overdue', 0], ['refunded', 200]]);
});

test('a transfer repaying exactly a plain claim of that person goes to it, a closed shared spend takes nothing', () => {
	const advance = spend({ expenseKey: 'adv', shared: false, expected: 200, date: '2026-09-01', categoryId: 'autre' });
	const big = spend({ expenseKey: 'big', expected: 300, date: '2026-09-02' });
	assert.deepEqual(states([advance, big], [credit('c', '2026-09-10', 200)]), [['refunded', 200], ['overdue', 0]]);
	const closed = spend({ expected: 20, closed: true });
	const open = spend({ expenseKey: 'b', expected: 20, date: '2026-09-03' });
	assert.deepEqual(states([closed, open], [credit('c', '2026-09-10', 10)]), [['closed', 0], ['refunded', 10]]);
});

test('an unpaid shared spend counts half as still owed; a share comes after the spend and from that person', () => {
	assert.equal(totalOwed(matchRefunds(twoSpends, [], TODAY)), 9.85);
	assert.equal(matchRefunds([spend({})], [credit('early', '2026-09-01', 10)], TODAY)[0]!.state, 'overdue');
	assert.equal(matchRefunds([spend({})], [credit('other', '2026-09-10', 10, 'VIR INST M PAUL DURAND')], TODAY)[0]!.state, 'overdue');
	assert.deepEqual(shareRange(14.6), { min: 5.84, max: 16.06 });
});

test('« pour Léa » names who the spend was for, out of the label', () => {
	const d = parseQuickEntry('resto 14,60 € swile pour Léa', TODAY) as QuickDraft;
	assert.deepEqual([d.label, d.amount, d.payment, d.forWhom], ['resto', 14.6, 'swile', 'Léa']);
	const full = parseQuickEntry('cinéma pour Léa Martin hier 18 €', TODAY) as QuickDraft;
	assert.deepEqual([full.label, full.date, full.forWhom], ['cinéma', '2026-10-04', 'Léa Martin']);
	const late = parseQuickEntry('resto 14 € pour Léa Hier', TODAY) as QuickDraft;
	assert.deepEqual([late.forWhom, late.date], ['Léa', '2026-10-04'], 'a date word is not a surname');
	assert.equal((parseQuickEntry('resto pour midi 14 €', TODAY) as QuickDraft).forWhom, undefined);
	assert.equal((parseQuickEntry('resto pour léa 9 €', TODAY) as QuickDraft).forWhom, undefined);
	const known = parseQuickEntry('resto pour léa martin 9 €', TODAY, ['Léa Martin']) as QuickDraft;
	assert.deepEqual([known.forWhom, known.label], ['Léa Martin', 'resto']);
	assert.equal((parseQuickEntry('resto pour léa 9 €', TODAY, ['Léa Martin']) as QuickDraft).forWhom, 'Léa Martin');
});

test('holidays, determiners, money received and instalments keep « pour … » in the label', () => {
	const gift = parseQuickEntry('cadeau pour Noël 30 €', TODAY) as QuickDraft;
	assert.deepEqual([gift.forWhom, gift.label], [undefined, 'cadeau pour Noël']);
	assert.equal((parseQuickEntry('fleurs pour ma mère 20 €', TODAY, ['Ma voisine']) as QuickDraft).forWhom, undefined, 'a known « Ma voisine » does not take every « pour ma … »');
	assert.equal((parseQuickEntry('fleurs pour ma voisine 20 €', TODAY, ['Ma voisine']) as QuickDraft).forWhom, 'Ma voisine');
	const back = parseQuickEntry('remboursement pour Léa 20 €', TODAY) as QuickDraft;
	assert.deepEqual([back.forWhom, back.label, back.credit], [undefined, 'remboursement pour Léa', true]);
	const plan = parseQuickEntry('tv pour Léa en 3 fois 300 €', TODAY) as QuickDraft;
	assert.deepEqual([plan.forWhom, plan.label, plan.instalments], [undefined, 'tv pour Léa', 3]);
});
