import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseAmountFr, parseDateFr, parseDateIso, parseDateFlexible, resolveDirection } from '../src/lib/csvCore';
import { excelSerialToDate, guessMapping, parseDateByFormat, parseRowsWithMapping, type FieldKey } from '../src/lib/importMapper';
import { parseCreditMutuelText } from '../src/lib/csvCreditMutuel';
import { parseNatixisText } from '../src/lib/csvNatixis';
import { parseCreditMutuelXlsx } from '../src/lib/xlsxCreditMutuel';
import { amazonNote, amazonOwnsCategory, mergeAmazonNote, type AmazonMatch } from '../src/lib/amazonOrders';
import { realFile } from './fichiers-reels';

/**
 * Imports (batch 6 of the 2026-10-03 review): amounts, dates, empty lines,
 * multiple columns, Amazon merge. Run: npm test
 */

const MINUS = String.fromCharCode(0x2212); // typographic minus sign
const NBSP = String.fromCharCode(0x00a0);
const NNBSP = String.fromCharCode(0x202f);

/** Covers XLSX cells and rejects ambiguous amounts. */
test('amounts: FR/EN formats tolerated, sign and € symbol', () => {
	assert.equal(parseAmountFr('1 234,56'), 1234.56);
	assert.equal(parseAmountFr(`1${NNBSP}234,56`), 1234.56);
	assert.equal(parseAmountFr(`2${NBSP}450,00${NBSP}€`), 2450);
	assert.equal(parseAmountFr('-250,00'), -250);
	assert.equal(parseAmountFr('+2 450,00'), 2450);
	assert.equal(parseAmountFr(`${MINUS}5,00`), -5);
	assert.equal(parseAmountFr('82,35 €'), 82.35);
	assert.equal(parseAmountFr('€12.34'), 12.34);
	assert.equal(parseAmountFr('12,34 EUR'), 12.34);
	assert.equal(parseAmountFr('-17.75'), -17.75);
	assert.equal(parseAmountFr('5.0000000000000001E-3'), 0.005);
	assert.equal(parseAmountFr('1.234,56'), 1234.56);
	assert.equal(parseAmountFr('1,234.56'), 1234.56);
	assert.equal(parseAmountFr(''), null);
	assert.equal(parseAmountFr('abc'), null);
	assert.equal(parseAmountFr('1,234,567'), null);
});

test('direction: a debit is always an outflow, and so is a negative credit', () => {
	assert.deepEqual(resolveDirection(-82.35, null, null), { isCredit: false, amount: 82.35 });
	assert.deepEqual(resolveDirection(null, -82.35, null), { isCredit: false, amount: 82.35 });
	assert.deepEqual(resolveDirection(null, 82.35, null), { isCredit: false, amount: 82.35 });
	assert.deepEqual(resolveDirection(null, null, 2450), { isCredit: true, amount: 2450 });
	assert.deepEqual(resolveDirection(null, null, -5), { isCredit: false, amount: 5 });
	assert.equal(resolveDirection(null, null, null), null);
});

/** A time of day is ignored: noon on 03/08 stays the 3rd, not the 4th. */
test('dates: time ignored, non-existent days rejected, Excel serial truncated', () => {
	assert.equal(parseDateFr('24/07/2026'), '2026-07-24');
	assert.equal(parseDateFr('24/07/2026 10:12'), '2026-07-24');
	assert.equal(parseDateFr('24/07/2026 10:12:33'), '2026-07-24');
	assert.equal(parseDateFr('1/2/26'), '2026-02-01');
	assert.equal(parseDateFr('31/02/2026'), null);
	assert.equal(parseDateFr('29/02/2026'), null);
	assert.equal(parseDateFr('29/02/2024'), '2024-02-29');
	assert.equal(parseDateFr(''), '');
	assert.equal(parseDateIso('2026-07-24 10:12:33'), '2026-07-24');
	assert.equal(parseDateIso('2026-07-24T10:12:33Z'), '2026-07-24');
	assert.equal(parseDateIso('2026-13-01'), null);
	assert.equal(parseDateFlexible('2026-07-24T23:30:00+02:00'), '2026-07-24');
	assert.equal(parseDateFlexible('24.07.2026'), '2026-07-24');
	assert.equal(excelSerialToDate(46237), '2026-08-03');
	assert.equal(excelSerialToDate(46237.5), '2026-08-03');
	assert.equal(excelSerialToDate(46237.999), '2026-08-03');
	assert.equal(parseDateByFormat('46237.75', 'auto'), '2026-08-03');
	assert.equal(parseDateByFormat('2026-08-03 08:00', 'iso'), '2026-08-03');
});

const HEADER = ['Date', 'Libellé', 'Débit', 'Crédit'];
const MAPPING: FieldKey[] = ['date', 'label', 'debit', 'credit'];
const parse = (rows: string[][], mapping = MAPPING) =>
	parseRowsWithMapping([HEADER, ...rows], { mapping, dateFormat: 'auto', skipRows: 0, account: 'cm', source: 'cm-csv' });

/** A line with a wrong date and an unreadable amount is ignored. */
test('rows: empty ones counted separately, unreadable date = row skipped (never « en cours »)', () => {
	const r = parse([
		['24/07/2026', 'CB CARREFOUR', '-82,35', ''],
		['', '', '', ''],
		['31/02/2026', 'CB DATE FAUSSE', '-10,00', ''],
		['25/07/2026 10:12', 'CB HEURE', '-5,00', ''],
		['26/07/2026', 'REMBOURSEMENT SIGNE', '', '-5,00'],
		['27/07/2026', 'CB MONTANT', 'douze', ''],
		['', '', '', '']
	]);
	assert.equal(r.transactions.length, 3);
	assert.equal(r.blank, 2);
	assert.equal(r.ignored, 2);
	assert.equal(r.errors.length, 2);
	assert.ok(r.errors[0]!.includes('Ligne 4') && r.errors[0]!.includes('date illisible'));
	assert.ok(r.errors[1]!.includes('montant illisible'));
	assert.ok(r.transactions.every((t) => t.booking_date !== ''));
	assert.equal(r.transactions[1]!.booking_date, '2026-07-25');
	const signedCredit = r.transactions[2]!;
	assert.equal(signedCredit.credit_debit_indicator, 'DBIT');
	assert.equal(signedCredit.transaction_amount.amount, '5.00');
});

test('rows: empty date = pending transaction (unchanged), unreadable value date = fallback with a warning', () => {
	const r = parseRowsWithMapping(
		[
			['Date', 'Valeur', 'Libellé', 'Montant'],
			['', '', 'CB EN COURS', '-3,00'],
			['24/07/2026', '99/99/2026', 'CB VALEUR', '-4,00']
		],
		{ mapping: ['date', 'valueDate', 'label', 'amount'], dateFormat: 'fr', skipRows: 0, account: 'cm', source: 'cm-csv' }
	);
	assert.equal(r.transactions.length, 2);
	assert.equal(r.transactions[0]!.booking_date, '');
	assert.equal(r.transactions[1]!.value_date, '2026-07-24');
	assert.equal(r.ignored, 0);
	assert.equal(r.errors.length, 1);
});

/** Auto-detection keeps a single Libellé column (transaction keys do not move). */
test('remapper: several Libellé columns concatenated in order, tags merged', () => {
	const r = parseRowsWithMapping(
		[
			['Date', 'Type', 'Détail', 'Montant', 'Tags', 'Tags 2'],
			['24/07/2026', 'CB', 'CARREFOUR CITY', '-82,35', 'courses', 'courses;quotidien']
		],
		{ mapping: ['date', 'label', 'label', 'amount', 'tags', 'tags'], dateFormat: 'fr', skipRows: 0, account: 'cm', source: 'cm-csv' }
	);
	assert.deepEqual(r.transactions[0]!.remittance_information, ['CB CARREFOUR CITY']);
	assert.deepEqual(r.transactions[0]!.tags, ['courses', 'quotidien']);
	assert.deepEqual(guessMapping(['Date', 'Opération', 'Libellé', 'Montant']), ['date', 'label', 'ignore', 'amount']);
});

test('sample Crédit Mutuel CSV: 0 errors, trailing empty line not counted as unreadable', () => {
	const text = readFileSync(resolve(import.meta.dirname, '../data/exemple-credit-mutuel.csv'), 'utf8');
	const r = parseCreditMutuelText(`${text.trimEnd()}\n;;;;;;;;;;;\n`);
	assert.ok(r.transactions.length > 0);
	assert.equal(r.errors.length, 0);
	assert.equal(r.ignored, 0);
	assert.equal(r.blank, 1);
});

test('Natixis CSV: amounts tolerated, negative credit = debit, empty line counted separately', () => {
	const r = parseNatixisText(
		['Date;Libellé;Montant;Débit;Crédit', '01/09/2026;VERSEMENT;+1 000,00 €;;', '02/09/2026;FRAIS;;;-12,50', ';;;;', '31/09/2026;DATE FAUSSE;5,00;;'].join('\n')
	);
	assert.equal(r.transactions.length, 2);
	assert.equal(r.transactions[0]!.credit_debit_indicator, 'CRDT');
	assert.equal(r.transactions[0]!.transaction_amount.amount, '1000.00');
	assert.equal(r.transactions[1]!.credit_debit_indicator, 'DBIT');
	assert.equal(r.blank, 1);
	assert.equal(r.ignored, 1);
});

/**
 * An identical re-import changes nothing. The 1st import sets the category only
 * without a manual choice; a re-import only if the override is still the one set
 * by Amazon; a return to automatic categorisation is respected; an earlier match
 * keeps the deduced category equal to the one set.
 */
test('Amazon: the user note and tags survive, a corrected category is never rewritten', () => {
	const m = { items: [{ name: 'Câble USB-C chargeur', amount: 9.99, quantity: 1 }], categoryId: 'loisirs' } as AmazonMatch;
	const note = amazonNote(m);
	assert.equal(note, 'Amazon · Câble USB-C chargeur');
	assert.equal(mergeAmazonNote(undefined, null, note), note);
	assert.equal(mergeAmazonNote('cadeau neveu', null, note), `cadeau neveu · ${note}`);
	assert.equal(mergeAmazonNote(`cadeau neveu · ${note}`, note, note), `cadeau neveu · ${note}`);
	const next = amazonNote({ items: [{ name: 'Câble USB-C 2 m', amount: 9.99, quantity: 1 }] });
	assert.equal(mergeAmazonNote(`cadeau neveu · ${note}`, note, next), `cadeau neveu · ${next}`);
	assert.equal(amazonOwnsCategory(undefined, undefined), true);
	assert.equal(amazonOwnsCategory('abonnements', undefined), false);
	assert.equal(amazonOwnsCategory('loisirs', { ...m, appliedCategory: 'loisirs' }), true);
	assert.equal(amazonOwnsCategory('abonnements', { ...m, appliedCategory: 'loisirs' }), false);
	assert.equal(amazonOwnsCategory(undefined, { ...m, appliedCategory: 'loisirs' }), false);
	assert.equal(amazonOwnsCategory('loisirs', { ...m, appliedCategory: null }), false);
	assert.equal(amazonOwnsCategory('loisirs', m), true);
});

const CM_XLSX = await realFile('comptes(1).xlsx');

test('real CM workbook: 107 rows, 0 errors, 3 accounts (parser non-regression)', { skip: CM_XLSX ? false : 'fichier absent (projet et coffre) : comptes(1).xlsx' }, async () => {
	const r = await parseCreditMutuelXlsx(new Blob([CM_XLSX!]));
	assert.equal(r.transactions.length, 107);
	assert.equal(r.errors.length, 0);
	assert.equal(r.ignored, 0);
	assert.equal(r.accounts.length, 3);
	assert.ok((r.skipped ?? 0) > 0, 'lignes « Solde au … » écartées volontairement');
	assert.ok(r.transactions.every((t) => /^\d{4}-\d{2}-\d{2}$/.test(t.booking_date)));
});
