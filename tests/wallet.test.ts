import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Transaction } from '../src/lib/types';
import { categorize, setVacationPredicate, txKey, type CatRule } from '../src/lib/categories';
import { subcategorize } from '../src/lib/subcategories';
import { isComputedEntry, isPending } from '../src/lib/data';
import { lastFlowDate } from '../src/lib/totals';
import { parseQuickEntry, withoutCashWords } from '../src/lib/quickEntry';
import {
	CASH_ACCOUNT,
	cashEntries,
	cashEntryList,
	emptyWallet,
	fillsWallet,
	isCashWithdrawal,
	keyRank,
	lastMovement,
	needsCheck,
	neededStart,
	readWallet,
	shownBalance,
	storedWallet,
	walletBalance,
	walletBalanceByDay,
	walletStart,
	walletStartFor,
	walletWithdrawals,
	withConfirmedBalance,
	withdrawalDate,
	withdrawalsOf,
	withItemBack,
	withoutCheck,
	withoutItem,
	withStart,
	withWriteOff,
	WRITE_OFF_LABEL,
	type CashSpend,
	type CashWallet,
	type Withdrawal
} from '../src/lib/wallet';

const TODAY = '2026-10-13';

const bank = (date: string, amount: number, label: string, extra: Partial<Transaction> = {}): Transaction => ({
	transaction_amount: { amount: Math.abs(amount).toFixed(2), currency: 'EUR' },
	booking_date: date,
	value_date: date,
	remittance_information: [label],
	credit_debit_indicator: amount < 0 ? 'DBIT' : 'CRDT',
	account: 'cm-1',
	source: 'cm-xlsx',
	...extra
});

const spend = (id: string, date: string, amount: number, label = 'marché', more: Partial<CashSpend> = {}): CashSpend => ({ id, date, label, amount, categoryId: 'alimentation', ...more });

const wallet = (w: Partial<CashWallet>): CashWallet => ({ ...emptyWallet(), ...w });

test('saisie rapide : « en liquide », « liquide » juste après le montant, « espèces », « cash » choisissent le porte-monnaie et quittent le libellé', () => {
	for (const [typed, label] of [
		['boulangerie 3,20 € liquide', 'boulangerie'],
		['boulangerie 3,50 liquide', 'boulangerie'],
		['marché 12,50 € en liquide', 'marché'],
		['marché 12,50 € payé en liquide', 'marché'],
		['en liquide fleuriste 9 €', 'fleuriste'],
		['coiffeur 18 € en espèces', 'coiffeur'],
		['brocante 7 € especes', 'brocante'],
		['espèces brocante 7 €', 'brocante'],
		['pourboire 5 € cash', 'pourboire']
	] as const) {
		const d = parseQuickEntry(typed, TODAY);
		assert.ok(!('error' in d), typed);
		assert.equal(d.payment, 'cash', typed);
		assert.equal(d.label, label, typed);
	}
	const plain = parseQuickEntry('boulangerie 3,20 €', TODAY);
	assert.ok(!('error' in plain) && plain.payment === undefined, 'la carte par défaut');
	const cashback = parseQuickEntry('cashback 4 €', TODAY);
	assert.ok(!('error' in cashback) && cashback.payment === undefined && cashback.label === 'cashback', 'un mot qui contient « cash » ne compte pas');
	const swile = parseQuickEntry('resto 14 € payé en swile', TODAY);
	assert.ok(!('error' in swile) && swile.payment === 'swile' && swile.label === 'resto', 'Swile inchangé, « payé » ôté du libellé');
	const split = parseQuickEntry('vélo 300 € en 3 fois en liquide', TODAY);
	assert.ok(!('error' in split) && split.payment === 'cash' && split.instalments === undefined, 'le liquide ne se paie pas en plusieurs fois');
	const sold = parseQuickEntry('vendu lampe 15 € en liquide', TODAY);
	assert.ok(!('error' in sold) && sold.credit && sold.payment === 'cash', 'argent reçu en liquide');
	const shared = parseQuickEntry('cinéma 24 € pour Léa en liquide', TODAY);
	assert.ok(!('error' in shared) && shared.payment === 'cash' && shared.forWhom === 'Léa' && shared.label === 'cinéma', 'pour Léa reste lu');
	const afterAmount = parseQuickEntry('marché 12 € liquide pour Léa', TODAY);
	assert.ok(!('error' in afterAmount) && afterAmount.payment === 'cash' && afterAmount.label === 'marché', 'juste après le montant');
});

test('saisie rapide : « liquide » ailleurs que juste après le montant, un produit ou une enseigne restent un libellé payé par carte', () => {
	for (const typed of ['lessive liquide 8 €', 'savon liquide 3,50 €', 'liquide vaisselle 2,50 €', 'liquide de frein 9 €', 'liquide lave-glace 5 €', 'e-liquide 12 €', 'Cash Converters 30 €', 'Promocash 40 €', 'Liquide fleuriste 9 €']) {
		const d = parseQuickEntry(typed, TODAY);
		assert.ok(!('error' in d), typed);
		assert.equal(d.payment, undefined, typed);
		assert.equal(d.label, typed.replace(/\s+[\d,]+ €$/, ''), typed);
	}
	for (const [typed, label] of [
		['8€ lessive liquide', 'lessive liquide'],
		['8 € savon liquide', 'savon liquide'],
		['3 € liquide vaisselle', 'liquide vaisselle']
	] as const) {
		const d = parseQuickEntry(typed, TODAY);
		assert.ok(!('error' in d), typed);
		assert.equal(d.payment, undefined, `${typed} : la carte, rien n’entre au porte-monnaie`);
		assert.equal(d.label, label, typed);
	}
	assert.equal(withoutCashWords('8€ lessive liquide'), '8€ lessive liquide');
	assert.equal(withoutCashWords('marché 12,50 € en liquide'), 'marché 12,50 €', 'la puce Liquide éteinte : la phrase rendue sans le liquide');
	assert.equal(withoutCashWords('savon liquide 3 €'), 'savon liquide 3 €');
});

test('retraits : libellé RETRAIT ou catégorie de la banque, débit seulement', () => {
	assert.ok(isCashWithdrawal(bank('2026-10-02', -40, 'RETRAIT DAB 0210 LYON CARTE 1234')));
	assert.ok(isCashWithdrawal(bank('2026-10-02', -40, 'Retrait')), 'libellé OFX');
	assert.ok(isCashWithdrawal(bank('2026-10-02', -40, 'DAB LYON', { bank_category: 'Retraits' })), 'catégorie de la banque');
	assert.ok(!isCashWithdrawal(bank('2026-10-02', -40, 'PRLV SEPA PER', { bank_category: 'Retraite' })), 'retraite ≠ retrait');
	assert.ok(!isCashWithdrawal(bank('2026-10-02', 40, 'RETRAIT DAB ANNULE')), 'un crédit ne remplit pas le porte-monnaie');
	assert.ok(!isCashWithdrawal(bank('2026-10-02', -40, 'PAIEMENT CB 0210 LYON RETRAIT COLIS')));
	assert.ok(!isCashWithdrawal(bank('2026-10-02', -40, 'Retrait', { account: 'natixis', source: 'natixis-csv' })), 'une ligne de patrimoine n’est pas du liquide');
	const list = withdrawalsOf([bank('2026-10-02', -40, 'RETRAIT DAB 0210 LYON'), bank('2026-10-03', -12, 'PAIEMENT CB 0310 LYON BOULANGERIE'), bank('', -20, 'RETRAIT DAB 1210 LYON', { value_date: '' })], txKey);
	assert.deepEqual(list.map((w) => [w.date, w.amount]), [['2026-10-02', 40], ['', 20]]);
});

test('ouverture : dernier retrait des 31 jours avant la première dépense, sinon le jour de la dépense', () => {
	const dates = ['2026-08-20', '2026-09-14', '2026-09-21', '2026-10-15'];
	assert.equal(walletStartFor('2026-10-13', dates), '2026-09-21', 'le plus récent avant la dépense, pas celui d’après');
	assert.equal(walletStartFor('2026-09-21', dates), '2026-09-21', 'retrait du jour même');
	assert.equal(walletStartFor('2026-09-20', ['2026-08-20']), '2026-08-20', '31 jours pile');
	assert.equal(walletStartFor('2026-09-21', ['2026-08-20']), '2026-09-21', 'plus de 31 jours : la date de la dépense');
	assert.equal(walletStartFor('2026-10-13', []), '2026-10-13');
	assert.equal(walletStartFor('2026-10-13', ['', '2026-10-01']), '2026-10-01', 'un retrait sans date n’ouvre rien');
	assert.equal(walletStart(wallet({ spends: [spend('s1', '2026-10-13', 12), spend('s2', '2026-09-16', 4)] }), dates), '2026-09-14', 'une dépense datée plus tôt ramène le début à son retrait');
	assert.equal(walletStart(emptyWallet(), dates), undefined, 'rien dedans : pas ouvert');
	assert.equal(walletStart(wallet({ start: '2025-01-01', spends: [spend('s1', '2026-10-13', 12)] }), dates), '2026-09-21', 'un début posé sur le porte-monnaie ne compte pas : il se recalcule');
});

test('début calculé : un retrait arrivé après la dépense qu’il a payée entre dans le porte-monnaie, quel que soit l’ordre de saisie', () => {
	const pending = bank('', -40, 'RETRAIT DAB 3009 VILLEFICTIVE', { value_date: '' });
	const booked = bank('2026-10-02', -40, 'RETRAIT DAB 3009 VILLEFICTIVE');
	const typed = wallet({ spends: [spend('s1', '2026-10-01', 5)] });
	const before = withdrawalsOf([pending], txKey);
	const early = withStart(typed, before.map((w) => w.date));
	assert.equal(early.start, '2026-10-01', 'le retrait encore en cours, sans date : ouvert le jour de la dépense');
	assert.equal(walletBalance(early, before), 35, 'le retrait en cours remplit déjà le porte-monnaie');
	const after = withdrawalsOf([booked], txKey);
	const late = withStart(typed, after.map((w) => w.date));
	assert.equal(late.start, '2026-09-30', 'le relevé le date du 30/09 : il devient le début, rien à refaire');
	assert.deepEqual(walletWithdrawals(after, late.start).map((w) => w.amount), [40], 'hors budget, plus dans « Autre »');
	assert.equal(walletBalance(late, after), 35, '40 − 5, et non −5');

	const list: Withdrawal[] = [{ key: 'a', date: '2026-10-03', amount: 100 }];
	const dates = list.map((w) => w.date);
	const received = wallet({ spends: [spend('r1', '2026-10-05', 20, 'vente', { credit: true })] });
	assert.equal(walletStart(received, dates), '2026-10-05', 'du liquide reçu seul : sa propre date');
	const thenSpent = wallet({ spends: [...received.spends, spend('s1', '2026-10-06', 30)] });
	assert.equal(walletStart(thenSpent, dates), '2026-10-03', 'une dépense après le liquide reçu ramène le début à son retrait');
	assert.equal(walletBalance(withStart(thenSpent, dates), list), 90, '100 + 20 − 30 : les 100 € ne restent pas au budget');
	assert.equal(walletStart(wallet({ spends: [...thenSpent.spends].reverse() }), dates), '2026-10-03', 'même début dans l’autre ordre');
	const noReceipt = withoutItem(thenSpent, 'r1');
	assert.equal(walletStart(noReceipt, dates), '2026-10-03', 'le liquide reçu supprimé : la dépense garde son retrait');
	assert.equal(walletBalance(withStart(noReceipt, dates), list), 70);

	const stored = storedWallet(withStart(thenSpent, dates));
	assert.equal('start' in stored, false, 'jamais enregistré');
	assert.equal(withStart(wallet({ start: '2026-10-03' }), dates).start, undefined, 'plus rien dedans : refermé');
});

test('début calculé : le même état que si tout était connu à la saisie, et annuler une saisie rend le porte-monnaie d’avant', () => {
	const older: Withdrawal = { key: 'a', date: '2026-10-01', amount: 50 };
	const pending: Withdrawal = { key: 'b', date: '', amount: 40 };
	const dated: Withdrawal = { ...pending, date: '2026-10-05', booked: '2026-10-07' };
	const one = wallet({ spends: [spend('s1', '2026-10-10', 5)] });
	const early = withStart(one, [older.date, pending.date]);
	assert.equal(early.start, '2026-10-01', 'le retrait encore en cours n’ouvre rien');
	assert.equal(walletBalance(early, [older, pending]), 85);
	const late = withStart(one, [older.date, dated.date]);
	assert.equal(late.start, '2026-10-05', 'daté ensuite : il devient le retrait de la dépense, comme s’il était connu à la saisie');
	assert.equal(walletBalance(late, [older, dated]), 35, 'le retrait d’avant, qu’aucune dépense saisie n’a payé, compte en « Autre »');
	const both = wallet({ spends: [...one.spends, spend('s2', '2026-10-03', 8)] });
	assert.equal(walletStart(both, [older.date, dated.date]), '2026-10-01', 'une dépense payée avec le retrait d’avant le garde dans le porte-monnaie');

	const typed = (w: CashWallet, s: CashSpend): CashWallet => ({ ...w, spends: [...w.spends, s] });
	const first = typed(emptyWallet(), spend('s1', '2026-10-10', 5));
	assert.deepEqual(withoutItem(first, 's1'), emptyWallet(), 'la première saisie annulée : refermé');
	const checked = wallet({ startAmount: 6, spends: [spend('s0', '2026-09-02', 3)], check: { date: '2026-10-05', balance: 20, start: '2026-09-01' } });
	assert.deepEqual(withoutItem(typed(checked, spend('s1', '2026-10-10', 5)), 's1'), checked, 'avec une vérification : son montant de départ reste');
});

test('début calculé : une vérification ou un passage en perte fixe un plancher pour ce qui vient après', () => {
	const list: Withdrawal[] = [{ key: 'a', date: '2026-10-01', amount: 60 }];
	const dates = list.map((w) => w.date);
	const opened = withConfirmedBalance(emptyWallet(), list, '2026-10-05', 'c1', 30);
	assert.equal(walletStart(opened, dates), '2026-10-05');
	const spentAfter = wallet({ ...opened, spends: [spend('s1', '2026-10-07', 2)] });
	assert.equal(walletStart(spentAfter, dates), '2026-10-05', 'compté le 05/10 : le retrait du 01/10 y était déjà, une dépense d’après ne le fait pas entrer');
	assert.equal(walletBalance(withStart(spentAfter, dates), list), 28, '30 − 2, et non 60 + 30 − 2');

	const pending: Withdrawal[] = [{ key: 'p', date: '', amount: 40 }];
	const typed = withStart(wallet({ spends: [spend('s1', '2026-10-01', 5)] }), ['']);
	const checked = withConfirmedBalance(typed, pending, '2026-10-05', 'c2');
	assert.deepEqual(checked.check, { date: '2026-10-05', balance: 35, start: '2026-10-01' }, 'vérifié pendant que le retrait était en cours');
	const dated: Withdrawal[] = [{ key: 'p', date: '2026-09-30', booked: '2026-10-02', amount: 40 }];
	const later = withStart(storedWallet(checked), ['2026-09-30']);
	assert.equal(later.start, '2026-09-30', 'daté ensuite du 30/09 : il reste dans le porte-monnaie vérifié');
	assert.equal(walletBalance(later, dated), 35, 'le solde confirmé ne bouge pas');

	const off = wallet({ writeOffs: [{ id: 'w1', date: '2026-10-10', amount: 5, start: '2026-10-08' }], spends: [spend('s1', '2026-10-12', 3)] });
	assert.equal(walletStart(off, ['2026-10-01']), '2026-10-08', 'une dépense après un passage en perte ne recule pas avant son début');
	assert.equal(walletStart(wallet({ writeOffs: [{ id: 'w1', date: '2026-10-10', amount: 5 }] }), dates), '2026-10-10', 'sans début enregistré : sa date');
});

test('fenêtre : les retraits à partir du début (inclus) entrent dans le porte-monnaie, les plus anciens comptent comme avant', () => {
	const list: Withdrawal[] = [
		{ key: 'a', date: '2026-09-14', amount: 60 },
		{ key: 'b', date: '2026-09-21', amount: 40 },
		{ key: 'c', date: '2026-10-05', amount: 20 },
		{ key: 'd', date: '', amount: 30 }
	];
	assert.deepEqual(walletWithdrawals(list, '2026-09-21').map((w) => w.key), ['b', 'c', 'd'], 'le jour du début compte ; un retrait en cours aussi');
	assert.deepEqual(walletWithdrawals(list, undefined), [], 'porte-monnaie pas ouvert : rien ne change');
	assert.ok(fillsWallet('2026-09-21', '2026-09-21') && !fillsWallet('2026-09-20', '2026-09-21'));
});

test('solde : départ + retraits − dépenses − passages en perte, jamais affiché sous 0 €', () => {
	const list: Withdrawal[] = [
		{ key: 'a', date: '2026-09-14', amount: 60 },
		{ key: 'b', date: '2026-09-21', amount: 40 },
		{ key: 'c', date: '2026-10-05', amount: 20 }
	];
	const w = wallet({ start: '2026-09-21', startAmount: 10, spends: [spend('s1', '2026-09-22', 12.5), spend('s2', '2026-10-06', 7.3), spend('s3', '2026-10-07', 5, 'vente', { credit: true })], writeOffs: [{ id: 'w1', date: '2026-10-08', amount: 4 }] });
	assert.equal(walletBalance(w, list), 51.2, '10 + 40 + 20 + 5 − 12,50 − 7,30 − 4');
	const over = wallet({ start: '2026-09-21', spends: [spend('s1', '2026-09-22', 75)] });
	assert.equal(walletBalance(over, list), -15, 'l’arithmétique garde la vérité');
	assert.equal(shownBalance(walletBalance(over, list)), 0);
	assert.equal(walletBalance(emptyWallet(), list), 0);
});

test('écritures du porte-monnaie : comptées tout de suite dans leur catégorie, hors banque, clés distinctes', () => {
	const w = wallet({ start: '2026-10-01', spends: [spend('s1', '2026-10-02', 1.2, 'café', { subId: 'restaurants' }), spend('s2', '2026-10-02', 1.2, 'café', { subId: 'restaurants' }), spend('s3', '2026-10-03', 20, 'vide-grenier', { credit: true, categoryId: 'revenus' })], writeOffs: [{ id: 'w1', date: '2026-10-09', amount: 6.5 }] });
	const txs = cashEntries(w);
	assert.equal(txs.length, 4);
	assert.ok(txs.every((t) => t.source === 'cash' && t.account === CASH_ACCOUNT && !isPending(t)), 'confirmées, compte liquide');
	assert.equal(new Set(txs.map(txKey)).size, 4, 'deux cafés identiques : deux clés');
	assert.equal(txs[0]!.remittance_information[0], 'Liquide : café');
	assert.equal(categorize(txs[0]!, {}), 'alimentation');
	assert.equal(subcategorize(txs[0]!, {}), 'restaurants');
	assert.equal(categorize(txs[0]!, { [txKey(txs[0]!)]: 'loisirs' }), 'loisirs', 'une catégorie posée à la main l’emporte, comme sur une opération de la banque');
	assert.equal(txs[2]!.credit_debit_indicator, 'CRDT');
	assert.equal(txs[3]!.remittance_information[0], WRITE_OFF_LABEL);
	assert.equal(categorize(txs[3]!, {}), 'autre');
	assert.deepEqual(cashEntryList(w).map((e) => [e.id, e.kind]), [['s1', 'spend'], ['s2', 'spend'], ['s3', 'spend'], ['w1', 'writeOff']]);

	const typed = (id: string, more: Partial<CashSpend> = {}): CashSpend => ({ ...spend(id, '2026-10-02', 1.2, 'café', more), dup: keyRank(id) });
	const first = typed('cash-1');
	const second = typed('cash-2', { forWhom: 'Léa' });
	assert.ok(first.dup! > 0 && first.dup !== second.dup && Number.isInteger(first.dup), 'un rang à soi, jamais 0');
	assert.equal(keyRank('cash-1'), first.dup, 'le même identifiant donne le même rang');
	const keyOf = (list: CashSpend[], id: string) => txKey(cashEntryList(wallet({ spends: list })).find((e) => e.id === id)!.tx);
	assert.equal(keyOf([second], 'cash-2'), keyOf([first, second], 'cash-2'), 'le premier café supprimé : la clé du second (et sa part attendue de Léa) ne bouge pas');
	const before = wallet({ spends: [first, second] });
	const removed = withoutItem(before, 'cash-1');
	const retyped = typed('cash-3');
	assert.notEqual(keyOf([...removed.spends, retyped], 'cash-3'), keyOf(before.spends, 'cash-1'), 'un café supprimé puis ressaisi pareil : une clé neuve, sans la catégorie, les vacances ni la part posées sur l’ancien');
	assert.notEqual(keyOf([...removed.spends, retyped], 'cash-3'), keyOf(before.spends, 'cash-2'));
	assert.equal(keyOf(withItemBack(removed, before, 'cash-1').spends, 'cash-1'), keyOf(before.spends, 'cash-1'), 'l’annulation remet la même clé, avec ce qui y était posé');
	assert.notEqual(keyOf([spend('old', '2026-10-02', 1.2, 'café')], 'old'), keyOf([retyped], 'cash-3'), 'une dépense enregistrée sans rang garde sa clé, une nouvelle ne la reprend pas');
});

test('contrôle d’honnêteté : 30 jours sans mouvement avec un solde, puis confirmation ou passage en perte', () => {
	const list: Withdrawal[] = [{ key: 'a', date: '2026-09-01', amount: 50 }];
	const w = wallet({ start: '2026-09-01', spends: [spend('s1', '2026-09-05', 10)] });
	assert.equal(lastMovement(w), '2026-09-05');
	assert.ok(!needsCheck(w, list, '2026-10-04'), '29 jours');
	assert.ok(needsCheck(w, list, '2026-10-05'), '30 jours, 40 € restants');
	assert.ok(!needsCheck(wallet({ start: '2026-09-01', spends: [spend('s1', '2026-09-05', 50)] }), list, '2026-12-01'), 'solde nul : rien à vérifier');
	assert.ok(!needsCheck(emptyWallet(), list, '2026-12-01'), 'pas ouvert');
	assert.ok(needsCheck(w, [...list, { key: 'b', date: '2026-10-01', amount: 20 }], '2026-10-05'), 'un retrait récent ne repousse pas le contrôle : seules tes saisies comptent');
	assert.ok(!needsCheck(wallet({ ...w, spends: [...w.spends, spend('s2', '2026-10-01', 3)] }), list, '2026-10-05'), 'une dépense en liquide récente le repousse');
	assert.ok(!needsCheck(wallet({ ...w, writeOffs: [{ id: 'w0', date: '2026-10-01', amount: 2 }] }), list, '2026-10-05'), 'un passage en Autre récent aussi');

	const confirmed = withConfirmedBalance(w, list, '2026-10-05', 'c1');
	assert.deepEqual(confirmed.check, { date: '2026-10-05', balance: 40, start: '2026-09-01' }, 'le début confirmé est gardé avec la vérification');
	assert.equal(walletBalance(confirmed, list), 40);
	assert.ok(!needsCheck(confirmed, list, '2026-10-20') && needsCheck(confirmed, list, '2026-11-04'), 'la confirmation repart pour 30 jours');

	const fewer = withConfirmedBalance(w, list, '2026-10-05', 'c2', 25);
	assert.deepEqual(fewer.writeOffs, [{ id: 'c2', date: '2026-10-05', amount: 15, start: '2026-09-01' }], 'compté 25 € : 15 € non détaillés, avec le début dont ils viennent');
	assert.equal(walletBalance(fewer, list), 25);
	const more = withConfirmedBalance(w, list, '2026-10-05', 'c3', 55);
	assert.equal(more.startAmount, 15, 'compté plus : venu d’ailleurs');
	assert.equal(walletBalance(more, list), 55);
	const negative = wallet({ start: '2026-09-01', spends: [spend('s1', '2026-09-05', 70)] });
	assert.equal(walletBalance(withConfirmedBalance(negative, list, '2026-10-05', 'c4'), list), 0, 'confirmer le 0 € affiché remet le compte juste');
	const fresh = withConfirmedBalance(emptyWallet(), list, '2026-10-05', 'c5', 30);
	assert.equal(walletStart(fresh, ['2026-09-01']), '2026-10-05');
	assert.equal(walletBalance(withStart(fresh, ['2026-09-01']), list), 30, 'un porte-monnaie vérifié avant toute dépense s’ouvre ce jour-là');

	const off = withWriteOff(w, list, '2026-10-05', 'w1');
	assert.ok(off);
	assert.deepEqual(off.writeOffs, [{ id: 'w1', date: '2026-10-05', amount: 40, start: '2026-09-01' }]);
	assert.equal(walletBalance(off, list), 0);
	assert.equal(cashEntries(off).at(-1)!.remittance_information[0], WRITE_OFF_LABEL, 'le reste compte en Autre, rien ne disparaît');
	assert.equal(withWriteOff(negative, list, '2026-10-05', 'w2'), null, 'rien à passer en perte');
});

test('lecture du stockage : forme inconnue → vide, éléments invalides ignorés, début enregistré avant d’être calculé', () => {
	assert.deepEqual(readWallet(null), emptyWallet());
	assert.deepEqual(readWallet('oops'), emptyWallet());
	const w = readWallet({
		start: '2026-09-21',
		startAmount: 10,
		spends: [spend('s1', '2026-09-22', 12.5, 'marché', { forWhom: 'Léa' }), { id: 's2', date: 'hier', label: 'x', amount: 3, categoryId: 'alimentation' }, { id: 's3', date: '2026-09-22', label: 'x', amount: -3, categoryId: 'alimentation' }, { id: 's4', date: '2026-09-22', label: 'x', amount: 3, categoryId: 'inconnue' }],
		writeOffs: [{ id: 'w1', date: '2026-10-01', amount: 4 }, { id: 'w2', date: '2026-10-01' }],
		check: { date: '2026-10-01', balance: 20 }
	});
	assert.deepEqual(w, { startAmount: 10, spends: [spend('s1', '2026-09-22', 12.5, 'marché', { forWhom: 'Léa' })], writeOffs: [{ id: 'w1', date: '2026-10-01', amount: 4, start: '2026-09-21' }], check: { date: '2026-10-01', balance: 20, start: '2026-09-21' } }, 'l’ancien début n’est plus gardé : il passe au passage en perte et à la vérification qui n’avaient pas le leur');
	assert.equal(walletStart(w, ['2026-09-21']), '2026-09-21');
	assert.deepEqual(readWallet({ start: '2026-09-21', spends: [spend('s1', '2026-10-06', 3)], writeOffs: [] }), wallet({ spends: [spend('s1', '2026-10-06', 3)] }), 'sans passage en perte ni vérification : le début se recalcule');
	assert.deepEqual(readWallet({ start: '2026-09-21', spends: [], writeOffs: [], check: { date: '2026-10-01', balance: 20, start: '2026-09-25' } }).check, { date: '2026-10-01', balance: 20, start: '2026-09-25' }, 'début confirmé gardé');
	assert.deepEqual(readWallet({ start: '2026-09-21', spends: [], writeOffs: [], check: { date: '2026-10-01', balance: 20, start: 'hier' } }).check, { date: '2026-10-01', balance: 20, start: '2026-09-21' }, 'début confirmé invalide : celui du porte-monnaie');
	assert.deepEqual(readWallet({ spends: [], writeOffs: [], check: { date: '2026-10-01', balance: 20, start: 'hier' } }).check, { date: '2026-10-01', balance: 20 }, 'début confirmé invalide ignoré');
	assert.deepEqual(readWallet({ spends: [], writeOffs: [{ id: 'w1', date: '2026-10-01', amount: 4, start: '2026-09-21' }, { id: 'w2', date: '2026-10-01', amount: 2, start: 'hier' }] }).writeOffs, [{ id: 'w1', date: '2026-10-01', amount: 4, start: '2026-09-21' }, { id: 'w2', date: '2026-10-01', amount: 2 }], 'début d’un passage en perte gardé, invalide ignoré');
	assert.deepEqual(readWallet({ spends: [{ ...spend('s1', '2026-09-22', 3), dup: 2 }, { ...spend('s2', '2026-09-22', 3), dup: -1 }] }).spends.map((s) => s.dup), [2, undefined], 'rang gardé, rang invalide ignoré');
});

test('retraits datés du jour où le liquide a été pris (JJMM du libellé), pas de leur passage en banque', () => {
	const late = bank('2026-10-02', -40, 'RETRAIT DAB 3009 VILLEFICTIVE CARTE 1234');
	assert.equal(withdrawalDate(late), '2026-09-30');
	assert.equal(withdrawalDate(bank('2026-01-02', -20, 'RETRAIT DAB 2912 VILLEFICTIVE')), '2025-12-29', 'fin d’année : l’année d’avant');
	assert.equal(withdrawalDate(bank('2026-10-02', -40, 'Retrait')), '2026-10-02', 'sans JJMM : la date de la banque');
	assert.equal(withdrawalDate(bank('', -40, 'RETRAIT DAB 1210', { value_date: '' })), '', 'en cours : sans date');
	const list = withdrawalsOf([bank('2026-09-21', -60, 'RETRAIT DAB 2109 VILLEFICTIVE'), late], txKey);
	assert.deepEqual(list.map((w) => [w.date, w.booked, w.amount]), [['2026-09-21', '2026-09-21', 60], ['2026-09-30', '2026-10-02', 40]]);
	const start = walletStartFor('2026-10-01', list.map((w) => w.date));
	assert.equal(start, '2026-09-30', 'le retrait du 30/09 (passé le 02/10) ouvre le porte-monnaie, pas celui du 21/09 déjà dépensé');
	assert.equal(walletBalance(wallet({ start, spends: [spend('s1', '2026-10-01', 12)] }), list), 28, '40 − 12, et non 60 + 40 − 12');
});

test('liquide reçu : ouvre le porte-monnaie à sa propre date, jamais à un retrait passé', () => {
	const dates = ['2026-09-21'];
	assert.equal(neededStart({ date: '2026-10-01', credit: true }, dates), '2026-10-01');
	assert.equal(neededStart({ date: '2026-10-01' }, dates), '2026-09-21', 'une dépense, elle, vient du retrait');
	const received = wallet({ spends: [spend('r1', '2026-10-01', 50, 'vente', { credit: true })] });
	assert.equal(walletStart(received, dates), '2026-10-01', 'reçu seul : le retrait du 21/09 reste au budget');
	assert.equal(walletBalance(withStart(received, dates), [{ key: 'a', date: '2026-09-21', amount: 60 }]), 50);
	assert.equal(walletStart(wallet({ spends: [...received.spends, spend('r2', '2026-09-23', 5, 'vente', { credit: true })] }), dates), '2026-09-23', 'reçu plus tôt : le début recule à sa date, pas au retrait');
});

test('supprimer une dépense qui fixait le début : il suit ce qui reste, rien ne reste → fermé ; l’annulation remet tout', () => {
	const dates = ['2025-10-01', '2026-09-21', '2026-10-05'];
	const typo: CashWallet = wallet({ spends: [spend('s1', '2026-09-22', 12), spend('typo', '2025-10-02', 8), spend('s2', '2026-10-06', 4)] });
	assert.equal(walletStart(typo, dates), '2025-10-01');
	const fixed = withoutItem(typo, 'typo');
	assert.equal(walletStart(fixed, dates), '2026-09-21', 'la dépense datée d’un an trop tôt partie : un an de retraits revient au budget');
	assert.deepEqual(fixed.spends.map((s) => s.id), ['s1', 's2']);
	assert.deepEqual(withItemBack(fixed, typo, 'typo'), typo, 'annuler remet exactement le porte-monnaie');
	assert.equal(walletStart(withoutItem(typo, 's2'), dates), '2025-10-01', 'une dépense qui ne fixait pas le début ne le bouge pas');

	const only = wallet({ startAmount: 5, spends: [spend('s1', '2026-09-22', 12)] });
	const closed = withoutItem(only, 's1');
	assert.equal(walletStart(closed, dates), undefined, 'plus rien : le porte-monnaie se referme, ses retraits comptent comme avant');
	assert.equal(closed.startAmount, undefined);
	assert.deepEqual(withItemBack(closed, only, 's1'), only);
	const reopened = withItemBack({ ...closed, spends: [spend('s3', '2026-10-06', 2)] }, only, 's1');
	assert.equal(walletStart(reopened, dates), '2026-09-21', 'rouvert entre-temps plus tard : l’annulation ramène le début dont elle a besoin');
	assert.deepEqual(reopened.spends.map((s) => s.id), ['s1', 's3']);

	const checked = wallet({ ...only, check: { date: '2026-10-05', balance: 48, start: '2026-09-21' } });
	assert.equal(walletStart(withoutItem(checked, 's1'), dates), '2026-09-21', 'un solde confirmé garde son début : il venait de ces retraits');
	assert.equal(withoutItem(checked, 's1').startAmount, 5, 'la vérification reste : le montant de départ aussi');
	const typoAfterCheck = wallet({ ...checked, spends: [...checked.spends, spend('typo', '2025-10-02', 8)] });
	assert.equal(walletStart(typoAfterCheck, dates), '2025-10-01');
	assert.equal(walletStart(withoutItem(typoAfterCheck, 'typo'), dates), '2026-09-21', 'une dépense mal datée après la vérification : le début revient à celui qu’elle a confirmé');
	assert.equal(walletStart(withoutItem(wallet({ check: { date: '2026-10-05', balance: 30, start: '2026-10-05' }, spends: [spend('s1', '2026-10-06', 2)] }), 's1'), dates), '2026-10-05', 'ouvert par une vérification : il reste ouvert');

	const offOnly = wallet({ writeOffs: [{ id: 'w1', date: '2026-10-05', amount: 3, start: '2026-10-05' }] });
	assert.equal(walletStart(withoutItem(offOnly, 'w1'), dates), undefined, 'un passage en perte compte aussi comme élément');
	const received = wallet({ spends: [spend('r1', '2026-09-25', 50, 'vente', { credit: true }), spend('s1', '2026-10-06', 4)] });
	assert.equal(walletStart(withoutItem(received, 'r1'), dates), '2026-10-05', 'le liquide reçu parti : le début suit la dépense restante');

	const list: Withdrawal[] = [{ key: 'a', date: '2026-09-21', amount: 60 }];
	const spent = withWriteOff(withStart(wallet({ spends: [spend('s1', '2026-09-22', 12)] }), ['2026-09-21']), list, '2026-10-30', 'w1')!;
	assert.deepEqual(spent.writeOffs, [{ id: 'w1', date: '2026-10-30', amount: 48, start: '2026-09-21' }]);
	const left = withStart(withoutItem(storedWallet(spent), 's1'), ['2026-09-21']);
	assert.equal(left.start, '2026-09-21', 'le reste passé en Autre venait de ce retrait : le début reste');
	assert.equal(walletBalance(left, list), 12, 'la dépense supprimée revient au porte-monnaie, le retrait n’est pas compté deux fois (48 € en Autre + 60 € au budget)');
});

test('annuler une vérification : seulement ce qu’elle a ajouté, une dépense saisie depuis reste', () => {
	const list: Withdrawal[] = [{ key: 'a', date: '2026-09-01', amount: 50 }];
	const dates = list.map((w) => w.date);
	const w = wallet({ spends: [spend('s1', '2026-09-05', 10)] });
	const check = (from: CashWallet, id: string, counted: number) => storedWallet(withConfirmedBalance(withStart(from, dates), list, '2026-10-05', id, counted));
	const fewer = check(w, 'c1', 25);
	assert.deepEqual(withoutCheck(fewer, w, fewer), w, 'rien entre-temps : le porte-monnaie d’avant');
	const typed = { ...fewer, spends: [...fewer.spends, spend('s2', '2026-10-06', 3)] };
	const undone = withoutCheck(typed, w, fewer);
	assert.deepEqual(undone.spends.map((s) => s.id), ['s1', 's2'], 'la dépense saisie après la vérification reste');
	assert.deepEqual(undone.writeOffs, []);
	assert.equal(undone.check, undefined);
	assert.equal(walletBalance(withStart(undone, dates), list), 37);

	const more = check(w, 'c2', 55);
	const raised = withoutCheck({ ...more, spends: [...more.spends, spend('s2', '2026-10-06', 3)] }, w, more);
	assert.equal(raised.startAmount, undefined, 'la hausse du montant de départ part');
	assert.equal(walletBalance(withStart(raised, dates), list), 37);
	const earlier = wallet({ ...w, startAmount: 4, check: { date: '2026-09-10', balance: 44, start: '2026-09-01' } });
	const again = check(earlier, 'c3', 60);
	assert.deepEqual(withoutCheck(again, earlier, again), earlier, 'la vérification d’avant et son montant reviennent');

	const opened = check(emptyWallet(), 'c4', 30);
	assert.deepEqual(withoutCheck(opened, emptyWallet(), opened), emptyWallet(), 'ouvert par la vérification : refermé');
	const spentSince = { ...opened, spends: [spend('s9', '2026-10-07', 2)] };
	const kept = withoutCheck(spentSince, emptyWallet(), opened);
	assert.equal(walletStart(kept, dates), '2026-10-07', 'une dépense saisie depuis garde le porte-monnaie ouvert, au début qu’elle demande');
	assert.equal(kept.startAmount, undefined);
});

test('liquide jour par jour : un seul passage, retraits au jour de la banque, jamais sous 0 €', () => {
	const list: Withdrawal[] = [
		{ key: 'a', date: '2026-09-14', booked: '2026-09-15', amount: 60 },
		{ key: 'b', date: '2026-09-30', booked: '2026-10-02', amount: 40 },
		{ key: 'c', date: '2026-10-05', amount: 20 }
	];
	const w = wallet({ start: '2026-09-30', startAmount: 10, spends: [spend('s1', '2026-10-01', 12.5), spend('s2', '2026-10-03', 5, 'vente', { credit: true }), spend('s3', '2026-10-06', 80)], writeOffs: [{ id: 'w1', date: '2026-10-04', amount: 4 }] });
	const days = ['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06'];
	assert.deepEqual(walletBalanceByDay(w, list, days), [0, 10, 0, 37.5, 42.5, 38.5, 58.5, 0]);
	const naive = days.map((iso) => (iso < w.start! ? 0 : shownBalance(walletBalance({ ...w, spends: w.spends.filter((s) => s.date <= iso), writeOffs: w.writeOffs.filter((x) => x.date <= iso) }, list.filter((x) => (x.booked ?? x.date) <= iso)))));
	assert.deepEqual(walletBalanceByDay(w, list, days), naive, 'même résultat que le solde recalculé chaque jour');
	assert.deepEqual(walletBalanceByDay(emptyWallet(), list, days), days.map(() => 0));
});

test('écritures du porte-monnaie : la catégorie saisie par défaut, puis catégorie posée et vacances comme une opération de la banque', () => {
	const w = wallet({ start: '2026-08-01', spends: [spend('s1', '2026-08-10', 9, 'glace', { subId: 'restaurants' }), spend('s2', '2026-08-11', 30, 'essence', { categoryId: 'voiture', subId: 'carburant' }), spend('s3', '2026-08-12', 15, 'révision', { categoryId: 'voiture' })], writeOffs: [{ id: 'w1', date: '2026-08-13', amount: 6 }] });
	const [glace, essence, revision, off] = cashEntries(w);
	const rules: CatRule[] = [{ keyword: 'GLACE', categoryId: 'loisirs', createdAt: 1 }];
	assert.equal(categorize(glace!, {}, rules), 'alimentation', 'aucune règle apprise ne remplace la catégorie saisie');
	setVacationPredicate((tx) => tx.booking_date >= '2026-08-01' && tx.booking_date <= '2026-08-31');
	try {
		assert.equal(categorize(glace!, {}, []), 'vacances', 'dépensé en liquide pendant les vacances : Vacances');
		assert.equal(subcategorize(glace!, {}, []), 'vac-alimentation');
		assert.equal(categorize(essence!, {}, []), 'vacances', 'le carburant suit le voyage');
		assert.equal(categorize(revision!, {}, []), 'voiture', 'l’entretien de la voiture non');
		assert.equal(categorize(off!, {}, []), 'autre', 'le reste jamais détaillé reste en Autre : daté du jour où il est constaté, pas des vacances');
		assert.ok(!subcategorize(off!, {}, [])?.startsWith('vac-'), 'ni une sous-catégorie de vacances');
		const typedOff: Transaction = { ...glace!, remittance_information: ['Liquide : non détaillé'] };
		assert.equal(categorize(typedOff, {}, []), 'vacances', 'une dépense saisie au libellé proche suit toujours les vacances');
		assert.equal(categorize(glace!, { [txKey(glace!)]: 'loisirs' }, []), 'loisirs', 'une catégorie posée l’emporte sur les vacances');
		const portage: Transaction = { ...bank('2026-08-10', -9, 'Payé en Swile : glace'), source: 'portage', account: 'portage', virtual_category: 'alimentation' };
		assert.equal(categorize(portage, { [txKey(portage)]: 'loisirs' }, []), 'alimentation', 'une écriture du portage garde la sienne');
	} finally {
		setVacationPredicate(null);
	}
	assert.equal(categorize(glace!, { [txKey(glace!)]: 'vacances' }, []), 'vacances', 'rattachée à des vacances (V) : Vacances');
});

test('écritures calculées : jamais la dernière date des relevés', () => {
	const cash = cashEntries(wallet({ start: '2026-10-01', spends: [spend('s1', '2026-10-20', 4)] }))[0]!;
	assert.ok(isComputedEntry(cash) && !isComputedEntry(bank('2026-10-02', -4, 'PAIEMENT CB 0210 BOULANGERIE')));
	assert.equal(lastFlowDate([bank('2026-10-02', -4, 'PAIEMENT CB 0210 BOULANGERIE'), cash]), '2026-10-02', 'une dépense en liquide datée plus tard ne fait pas croire le mois complet');
});
