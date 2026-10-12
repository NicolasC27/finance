import { test } from 'node:test';
import assert from 'node:assert/strict';
import { instalmentDates, instalmentPlan, instalmentText, instalmentTransactions, parseQuickEntry, splitInstalments, type QuickDraft } from '../src/lib/quickEntry';
import { isPending } from '../src/lib/data';

const TODAY = '2026-10-12';

function parsed(text: string): QuickDraft {
	const d = parseQuickEntry(text, TODAY);
	assert.ok(!('error' in d), text);
	return d as QuickDraft;
}

test('the sentence names the number of instalments, the label and the amount stay clean', () => {
	for (const text of ['fnac 300 € en 3 fois', 'fnac 300 € 3x', 'fnac payé en 3 fois 300 €', 'fnac 300 € en 3 fois sans frais']) {
		const d = parsed(text);
		assert.equal(d.instalments, 3, text);
		assert.equal(d.amount, 300, text);
		assert.equal(d.label, 'fnac', text);
	}
	assert.equal(parsed('darty 899 € en 4x').instalments, 4);
	for (const text of ['darty 4x 899 €', 'darty payé en 4x 899 €']) {
		const d = parsed(text);
		assert.equal(d.instalments, 4, text);
		assert.equal(d.amount, 899, text);
		assert.equal(d.label, 'darty', text);
	}
	assert.equal(parsed('fnac 300 €').instalments, undefined);
	assert.equal(parsed('café 2 x 15 €').instalments, undefined);
	assert.equal(parsed('cinema 2 fois 9 €').instalments, undefined);
	assert.equal(parsed('remboursement 300 € en 3 fois').instalments, undefined);
});

test('the amount splits to the cent, the first instalment takes the odd cents', () => {
	assert.deepEqual(splitInstalments(300, 3), [100, 100, 100]);
	assert.deepEqual(splitInstalments(100, 3), [33.34, 33.33, 33.33]);
	assert.deepEqual(splitInstalments(899.99, 4), [225.02, 224.99, 224.99, 224.99]);
});

test('instalments fall on the same day of the next months, the last day when it is missing', () => {
	assert.deepEqual(instalmentDates('2026-10-12', 3), ['2026-10-12', '2026-11-12', '2026-12-12']);
	assert.deepEqual(instalmentDates('2026-11-30', 4), ['2026-11-30', '2026-12-30', '2027-01-30', '2027-02-28']);
	assert.deepEqual(instalmentDates('2027-12-31', 3), ['2027-12-31', '2028-01-31', '2028-02-29']);
});

test('due instalments are counted, the next ones wait for the bank debit', () => {
	const draft: QuickDraft = { label: 'fnac', amount: 300, credit: false, date: TODAY, instalments: 3 };
	const txs = instalmentTransactions(draft, 'cm-00012345678', TODAY);
	assert.deepEqual(txs.map((t) => [t.booking_date, t.transaction_amount.amount, isPending(t), t.instalment?.n]), [
		['2026-10-12', '100.00', false, 1],
		['2026-11-12', '100.00', true, 2],
		['2026-12-12', '100.00', true, 3]
	]);
	assert.ok(txs.every((t) => t.source === 'manual' && t.instalment?.of === 3 && t.credit_debit_indicator === 'DBIT'));
	const late = instalmentPlan({ ...draft, date: '2026-08-20' }, TODAY);
	assert.deepEqual(late.map((p) => p.due), [true, true, false]);
	assert.equal(instalmentPlan({ ...draft, credit: true }, TODAY).length, 1);
	assert.deepEqual(instalmentPlan({ ...draft, amount: 0.02 }, TODAY).map((p) => p.amount), [0.01, 0.01]);
	const past = instalmentTransactions({ ...draft, date: '2026-08-20' }, 'cm-00012345678', TODAY);
	assert.ok(past.every(isPending), 'past instalments wait to be settled');
});

test('the plan reads as one sentence', () => {
	const plan = instalmentPlan({ label: 'fnac', amount: 100, credit: false, date: TODAY, instalments: 3 }, TODAY);
	assert.equal(instalmentText(plan, TODAY).replace(/\s/g, ' '), "33,34 € aujourd'hui, puis 33,33 € le 12 nov. et le 12 déc.");
});
