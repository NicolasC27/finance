import { test } from 'node:test';
import assert from 'node:assert/strict';
import { child, findAll, parseMarkup, textAt } from '../src/lib/markup';
import { mergeLabel, statementAccountId } from '../src/lib/statementCore';
import { parseOfx } from '../src/lib/ofx';
import { parseQif } from '../src/lib/qif';
import { parseCamt } from '../src/lib/camt';
import { detectStatementFormat, isStatementSource, parseStatement, skipKnownMovements } from '../src/lib/statements';
import { txKey } from '../src/lib/categories';
import type { Transaction } from '../src/lib/types';

/**
 * Standard-format statements (OFX/QFX, QIF, CAMT): parsers, detection, account
 * id and anti-duplicate guard vs CSV. 100 % fictitious data.
 */

/** Bytes of a text (latin1 = windows-1252 for the usual accents) → ArrayBuffer. */
function bytes(text: string, encoding: 'latin1' | 'utf8' = 'utf8'): ArrayBuffer {
	const buf = Buffer.from(text, encoding);
	return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

const OFX_SGML = [
	'OFXHEADER:100',
	'DATA:OFXSGML',
	'VERSION:102',
	'SECURITY:NONE',
	'ENCODING:USASCII',
	'CHARSET:1252',
	'COMPRESSION:NONE',
	'OLDFILEUID:NONE',
	'NEWFILEUID:NONE',
	'',
	'<OFX>',
	'<SIGNONMSGSRSV1><SONRS><STATUS><CODE>0<SEVERITY>INFO</STATUS><DTSERVER>20261001120000<LANGUAGE>FRA</SONRS></SIGNONMSGSRSV1>',
	'<BANKMSGSRSV1>',
	'<STMTTRNRS>',
	'<TRNUID>00000001',
	'<STATUS><CODE>0<SEVERITY>INFO</STATUS>',
	'<STMTRS>',
	'<CURDEF>EUR',
	'<BANKACCTFROM>',
	'<BANKID>99999',
	'<BRANCHID>01234',
	'<ACCTID>00012345678',
	'<ACCTTYPE>CHECKING',
	'</BANKACCTFROM>',
	'<BANKTRANLIST>',
	'<DTSTART>20260901',
	'<DTEND>20260930',
	'<STMTTRN>',
	'<TRNTYPE>DEBIT',
	'<DTPOSTED>20260903',
	'<DTUSER>20260901',
	'<TRNAMT>-42.50',
	'<FITID>F0001',
	'<NAME>PAIEMENT CB 0109 VILLEFICTIVE',
	'<MEMO>PAIEMENT CB 0109 VILLEFICTIVE ÉPICERIE DU PORT CARTE 0000',
	'</STMTTRN>',
	'<STMTTRN>',
	'<TRNTYPE>CHECK',
	'<DTPOSTED>20260910',
	'<TRNAMT>-120,00',
	'<FITID>F0002',
	'<CHECKNUM>1234567',
	'<NAME>CHEQUE',
	'<MEMO>',
	'</STMTTRN>',
	'<STMTTRN>',
	'<TRNTYPE>CREDIT',
	'<DTPOSTED>20260929000000.000[+2:CEST]',
	'<DTAVAIL>20260930',
	'<TRNAMT>2500.00',
	'<FITID>F0003',
	'<NAME>VIR SEPA EMPLOYEUR FICTIF',
	'<MEMO>SALAIRE SEPTEMBRE',
	'</STMTTRN>',
	'</BANKTRANLIST>',
	'<LEDGERBAL><BALAMT>1234.56<DTASOF>20260930235959</LEDGERBAL>',
	'</STMTRS>',
	'</STMTTRNRS>',
	'</BANKMSGSRSV1>',
	'</OFX>'
].join('\r\n');

const OFX_XML = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<?OFX OFXHEADER="200" VERSION="211" SECURITY="NONE" OLDFILEUID="NONE" NEWFILEUID="NONE"?>
<OFX>
  <BANKMSGSRSV1><STMTTRNRS><STMTRS>
    <CURDEF>EUR</CURDEF>
    <BANKACCTFROM><BANKID>99999</BANKID><BRANCHID>01234</BRANCHID><ACCTID>0001234567812</ACCTID><ACCTTYPE>SAVINGS</ACCTTYPE></BANKACCTFROM>
    <BANKTRANLIST>
      <STMTTRN><TRNTYPE>INT</TRNTYPE><DTPOSTED>20261231</DTPOSTED><TRNAMT>15.30</TRNAMT><FITID>X1</FITID><NAME>INTERETS 2026</NAME><MEMO></MEMO></STMTTRN>
      <STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20261215</DTPOSTED><TRNAMT>-80.00</TRNAMT><FITID>X2</FITID><PAYEE><NAME>DUPONT &amp; FILS</NAME></PAYEE></STMTTRN>
    </BANKTRANLIST>
  </STMTRS></STMTTRNRS></BANKMSGSRSV1>
  <CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS>
    <CURDEF>EUR</CURDEF>
    <CCACCTFROM><ACCTID>XXXX XXXX XXXX 4321</ACCTID></CCACCTFROM>
    <BANKTRANLIST><STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20261220</DTPOSTED><TRNAMT>-19.99</TRNAMT><FITID>C1</FITID><NAME>ABONNEMENT FICTIF</NAME></STMTTRN></BANKTRANLIST>
  </CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1>
</OFX>`;

const QIF_FR = `!Account
NCompte joint
TBank
^
!Type:Bank
D25/09/2026
T-1 234,56
PLOYER FICTIF
MSeptembre
LLogement:Loyer
CX
^
D01/10'26
T2 000,00
PEMPLOYEUR FICTIF
^
D02/10/26
U-12,50
PBOULANGERIE DU COIN
^
!Type:Invst
D01/10/26
NBuy
YACTION FICTIVE
T100.00
^
`;

const CAMT_053 = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02">
 <BkToCstmrStmt>
  <GrpHdr><MsgId>MSG-FICTIF-1</MsgId><CreDtTm>2026-10-01T06:00:00</CreDtTm></GrpHdr>
  <Stmt>
   <Id>STMT-1</Id>
   <Acct><Id><IBAN>FR7699999012340001234567812</IBAN></Id><Ccy>EUR</Ccy><Nm>Compte courant fictif</Nm></Acct>
   <Bal><Tp><CdOrPrtry><Cd>OPBD</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">900.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>2026-09-01</Dt></Dt></Bal>
   <Bal><Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">1500.25</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>2026-09-30</Dt></Dt></Bal>
   <Ntry>
    <Amt Ccy="EUR">64.90</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts>BOOK</Sts>
    <BookgDt><Dt>2026-09-15</Dt></BookgDt><ValDt><Dt>2026-09-14</Dt></ValDt>
    <AddtlNtryInf>PRLV SEPA ENERGIE FICTIVE</AddtlNtryInf>
    <NtryDtls><TxDtls><RltdPties><Cdtr><Nm>ENERGIE FICTIVE SA</Nm></Cdtr></RltdPties><RmtInf><Ustrd>FACTURE 0042</Ustrd></RmtInf></TxDtls></NtryDtls>
   </Ntry>
   <Ntry>
    <Amt Ccy="EUR">665.15</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>BOOK</Sts>
    <BookgDt><DtTm>2026-09-28T10:15:00+02:00</DtTm></BookgDt>
    <NtryDtls><TxDtls><RltdPties><Dbtr><Nm>CLIENT FICTIF</Nm></Dbtr></RltdPties><RmtInf><Ustrd>REMBOURSEMENT</Ustrd></RmtInf></TxDtls></NtryDtls>
   </Ntry>
   <Ntry>
    <Amt Ccy="EUR">10.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts>PDNG</Sts>
    <BookgDt><Dt>2026-09-30</Dt></BookgDt>
   </Ntry>
  </Stmt>
 </BkToCstmrStmt>
</Document>`;

const amounts = (txs: Transaction[]) => txs.map((t) => `${t.credit_debit_indicator === 'DBIT' ? '-' : '+'}${t.transaction_amount.amount}`);

test('tag tree: unclosed SGML data, empty data, nested XML, entities, namespaces', () => {
	const sgml = parseMarkup('<A><B>un<C><D>deux</A>', { leaves: new Set(['B', 'C', 'D']) });
	const a = child(sgml, 'A')!;
	assert.deepEqual(a.children.map((n) => [n.name, n.text]), [['B', 'un'], ['C', ''], ['D', 'deux']]);
	const xml = parseMarkup('<ns:X a="1"><Dt><Dt>2026-01-02</Dt></Dt><Y>A &amp; B&#233;</Y><Z><![CDATA[<brut>]]></Z><W/></ns:X>');
	const x = child(xml, 'X')!;
	assert.equal(x.attrs.a, '1');
	assert.equal(textAt(x, 'Dt>Dt'), '2026-01-02');
	assert.equal(textAt(x, 'Y'), 'A & Bé');
	assert.equal(textAt(x, 'Z'), '<brut>');
	assert.equal(findAll(xml, 'W').length, 1);
});

/** A full MEMO containing the truncated NAME: MEMO alone, accents decoded. */
test('OFX 1.x SGML (windows-1252): transactions, labels, cheque, date with a time zone, dated declared balance', () => {
	const buffer = bytes(OFX_SGML, 'latin1');
	assert.equal(detectStatementFormat(buffer), 'ofx');
	const r = parseStatement(buffer, 'export.ofx')!;
	assert.equal(r.format, 'ofx');
	assert.deepEqual(r.errors, []);
	assert.equal(r.transactions.length, 3);
	const [card, cheque, salary] = r.transactions as [Transaction, Transaction, Transaction];
	assert.deepEqual(card.remittance_information, ['PAIEMENT CB 0109 VILLEFICTIVE ÉPICERIE DU PORT CARTE 0000']);
	assert.equal(card.booking_date, '2026-09-03');
	assert.equal(card.value_date, '2026-09-03');
	assert.equal(card.account, 'cm-00012345678');
	assert.equal(card.source, 'ofx');
	assert.deepEqual(cheque.remittance_information, ['CHEQUE 1234567'], 'MEMO vide refermé, n° de chèque ajouté');
	assert.equal(salary.booking_date, '2026-09-29', 'date écrite gardée, sans conversion de fuseau');
	assert.equal(salary.value_date, '2026-09-30', 'DTAVAIL = date de valeur');
	assert.deepEqual(amounts(r.transactions), ['-42.50', '-120.00', '+2500.00']);
	assert.deepEqual(r.accounts, [
		{ id: 'cm-00012345678', label: 'Compte ••5678', last4: '5678', kind: 'courant', balance: 1234.56, currency: 'EUR', balanceAt: '2026-09-29' }
	]);
});

test('OFX: a file written in UTF-8 that declares 1252 stays readable (valid UTF-8 wins)', () => {
	const r = parseStatement(bytes(OFX_SGML, 'utf8'), 'export.ofx')!;
	assert.equal(r.transactions[0]!.remittance_information[0], 'PAIEMENT CB 0109 VILLEFICTIVE ÉPICERIE DU PORT CARTE 0000');
});

test('OFX 2.x XML: number + RIB key, PAYEE, entities, card statement, several statements', () => {
	const r = parseOfx(OFX_XML);
	assert.deepEqual(r.errors, []);
	assert.deepEqual(
		r.transactions.map((t) => [t.account, t.booking_date, t.remittance_information[0]]),
		[
			['cm-00012345678', '2026-12-31', 'INTERETS 2026'],
			['cm-00012345678', '2026-12-15', 'DUPONT & FILS'],
			['carte-4321', '2026-12-20', 'ABONNEMENT FICTIF']
		]
	);
	assert.deepEqual(amounts(r.transactions), ['+15.30', '-80.00', '-19.99']);
	assert.deepEqual(
		r.accounts.map((a) => [a.id, a.label, a.kind]),
		[
			['cm-00012345678', 'Compte ••5678', 'livret'],
			['carte-4321', 'Carte ••4321', 'courant']
		]
	);
	assert.equal(r.accounts[0]!.balance, undefined, 'pas de LEDGERBAL : pas de solde déclaré');
});

test('unreadable OFX or OFX without a statement: clear message, nothing imported', () => {
	assert.match(parseOfx('OFXHEADER:100\r\nDATA:OFXSGML').errors[0]!, /<OFX> introuvable/);
	assert.match(parseOfx('<OFX><SIGNONMSGSRSV1></SIGNONMSGSRSV1></OFX>').errors[0]!, /Aucun relevé/);
});

test('French QIF: DD/MM and Quicken dates, decimal-comma amounts, category, cleared flag, named account, investments ignored', () => {
	const buffer = bytes(QIF_FR, 'latin1');
	assert.equal(detectStatementFormat(buffer), 'qif');
	const r = parseQif(QIF_FR);
	assert.equal(r.transactions.length, 3);
	assert.deepEqual(r.transactions.map((t) => t.booking_date), ['2026-09-25', '2026-10-01', '2026-10-02']);
	assert.deepEqual(amounts(r.transactions), ['-1234.56', '+2000.00', '-12.50']);
	const [rent] = r.transactions as [Transaction];
	assert.deepEqual(rent.remittance_information, ['LOYER FICTIF Septembre']);
	assert.equal(rent.bank_category, 'Logement');
	assert.equal(rent.bank_subcategory, 'Loyer');
	assert.equal(rent.checked, true);
	assert.equal(rent.account, 'cm-compte-joint');
	assert.deepEqual(r.accounts, [{ id: 'cm-compte-joint', label: 'Compte joint', last4: '••••', kind: 'courant' }]);
	assert.equal(r.ignored, 1);
	assert.match(r.errors[0]!, /placement/);
});

test('US QIF (month first) and Quicken opening balance', () => {
	const qif = '!Type:Bank\nD12/25/2026\nT-10.00\nPSHOP\n^\nD1/2/2027\nT0.00\nPOpening Balance\n^\nD01/03/2027\nT5.00\nPREFUND\n^\n';
	const r = parseQif(qif, 'cm-00099988877');
	assert.deepEqual(r.transactions.map((t) => t.booking_date), ['2026-12-25', '2027-01-03']);
	assert.equal(r.ignored, 1, 'solde d’ouverture écarté');
	assert.equal(r.transactions[0]!.account, 'cm-00099988877', 'sans !Account : compte du nom de fichier');
	assert.deepEqual(r.accounts.map((a) => a.id), ['cm-00099988877']);
});

test('CAMT.053: IBAN → same account as the CSV, labels, timestamped dates, pending entry skipped, dated CLBD balance', () => {
	const buffer = bytes(CAMT_053);
	assert.equal(detectStatementFormat(buffer), 'camt');
	const r = parseStatement(buffer, 'camt053.xml')!;
	assert.equal(r.format, 'camt');
	assert.deepEqual(
		r.transactions.map((t) => [t.account, t.booking_date, t.value_date, t.remittance_information[0]]),
		[
			['cm-00012345678', '2026-09-15', '2026-09-14', 'PRLV SEPA ENERGIE FICTIVE ENERGIE FICTIVE SA FACTURE 0042'],
			['cm-00012345678', '2026-09-28', '2026-09-28', 'CLIENT FICTIF REMBOURSEMENT']
		]
	);
	assert.deepEqual(amounts(r.transactions), ['-64.90', '+665.15']);
	assert.equal(r.ignored, 1);
	assert.match(r.errors[0]!, /en attente/);
	assert.deepEqual(r.accounts, [
		{ id: 'cm-00012345678', label: 'Compte courant fictif', last4: '5678', balance: 1500.25, currency: 'EUR', balanceAt: '2026-09-28' }
	]);
});

test('CAMT.052 (Rpt, prefixes, v8 status « Sts>Cd ») and CAMT without a statement', () => {
	const camt052 = `<?xml version="1.0"?><n:Document xmlns:n="urn:iso:std:iso:20022:tech:xsd:camt.052.001.08"><n:BkToCstmrAcctRpt><n:Rpt>
		<n:Acct><n:Id><n:Othr><n:Id>00012345678</n:Id></n:Othr></n:Id></n:Acct>
		<n:Bal><n:Tp><n:CdOrPrtry><n:Cd>ITBD</n:Cd></n:CdOrPrtry></n:Tp><n:Amt Ccy="EUR">50.00</n:Amt><n:CdtDbtInd>DBIT</n:CdtDbtInd><n:Dt><n:DtTm>2026-10-02T12:00:00</n:DtTm></n:Dt></n:Bal>
		<n:Ntry><n:Amt Ccy="EUR">3.20</n:Amt><n:CdtDbtInd>DBIT</n:CdtDbtInd><n:Sts><n:Cd>BOOK</n:Cd></n:Sts><n:BookgDt><n:Dt>2026-10-02</n:Dt></n:BookgDt><n:AddtlNtryInf>PAIEMENT CB 0110 CAFE FICTIF</n:AddtlNtryInf></n:Ntry>
	</n:Rpt></n:BkToCstmrAcctRpt></n:Document>`;
	assert.equal(detectStatementFormat(bytes(camt052)), 'camt');
	const r = parseCamt(camt052);
	assert.deepEqual(r.transactions.map((t) => [t.account, t.remittance_information[0]]), [['cm-00012345678', 'PAIEMENT CB 0110 CAFE FICTIF']]);
	assert.equal(r.accounts[0]!.balance, -50, 'solde débiteur négatif');
	assert.equal(r.accounts[0]!.balanceAt, '2026-10-02');
	assert.match(parseCamt('<Document><Autre/></Document>').errors[0]!, /aucun relevé/);
});

test('detection: CSV, XLSX or arbitrary text are not statements', () => {
	assert.equal(detectStatementFormat(bytes('Date;Date de valeur;Libellé;Débit;Crédit\n01/09/2026;01/09/2026;X;1,00;\n')), null);
	assert.equal(detectStatementFormat(bytes('PK\u0003\u0004binaire')), null);
	assert.equal(parseStatement(bytes('bonjour'), 'x.txt'), null);
});

test('account id: number alone, number + key, full RIB, French IBAN, foreign IBAN, card, name', () => {
	assert.equal(statementAccountId({ number: '00012345678' }), 'cm-00012345678');
	assert.equal(statementAccountId({ number: '0001234567812' }), 'cm-00012345678');
	assert.equal(statementAccountId({ number: '99999 01234 00012345678 12' }), 'cm-00012345678');
	assert.equal(statementAccountId({ iban: 'FR76 9999 9012 3400 0123 4567 812' }), 'cm-00012345678');
	assert.equal(statementAccountId({ number: 'FR7699999012340001234567812' }), 'cm-00012345678');
	assert.equal(statementAccountId({ iban: 'DE89 3704 0044 0532 0130 00' }), 'cm-de89370400440532013000');
	assert.equal(statementAccountId({ number: '**** 4321', card: true }), 'carte-4321');
	assert.equal(statementAccountId({ number: 'Livret A' }), 'cm-livret-a');
	assert.equal(statementAccountId({ number: 'CCHQ 00012345678' }), 'cm-00012345678');
	assert.equal(statementAccountId({ number: '' }), null);
});

test('label: truncated NAME + full MEMO, disjoint pieces, repetitions', () => {
	assert.equal(mergeLabel(['PAIEMENT CB 0109', 'PAIEMENT CB 0109 MAGASIN']), 'PAIEMENT CB 0109 MAGASIN');
	assert.equal(mergeLabel(['VIR SEPA X', 'loyer']), 'VIR SEPA X loyer');
	assert.equal(mergeLabel(['  A  B ', 'a b', '']), 'A B');
});

// ---------- Anti-duplicate guard vs CSV ----------

const csvTx = (date: string, amount: string, dir: 'DBIT' | 'CRDT', label: string): Transaction => ({
	transaction_amount: { amount, currency: 'EUR' },
	booking_date: date,
	value_date: date,
	remittance_information: [label],
	credit_debit_indicator: dir,
	source: 'cm-csv',
	account: 'cm-00012345678'
});

test('guard: a movement already imported by CSV (different label) is skipped, the rest added', () => {
	const existing = [
		csvTx('2026-09-03', '42.50', 'DBIT', 'PAIEMENT CB 0109 VILLEFICTIVE EPICERIE DU PORT'),
		csvTx('2026-09-10', '120.00', 'DBIT', 'CHQ. 1234567')
	];
	const ofx = parseOfx(OFX_SGML).transactions;
	const { kept, skipped } = skipKnownMovements(existing, ofx);
	assert.equal(skipped, 2);
	assert.deepEqual(kept.map((t) => t.remittance_information[0]), ['VIR SEPA EMPLOYEUR FICTIF SALAIRE SEPTEMBRE']);
});

test('guard: re-importing the same statement → strict duplicates left to addImported, nothing else skipped', () => {
	const ofx = parseOfx(OFX_SGML).transactions;
	const { kept, skipped } = skipKnownMovements(ofx, ofx);
	assert.equal(skipped, 0);
	assert.deepEqual(kept.map(txKey), ofx.map(txKey));
});

/** Demo transactions are ignored by the guard (not a real account). */
test('guard: two coffees on the same day, only one known → only one added; other account or other amount → added', () => {
	const cafe = (account = 'cm-00012345678', amount = '2.50'): Transaction => ({
		...csvTx('2026-09-12', amount, 'DBIT', 'CB CAFE'),
		source: 'ofx',
		account
	});
	const existing = [csvTx('2026-09-12', '2.50', 'DBIT', 'PAIEMENT CB 1209 CAFE DU COIN')];
	const { kept, skipped } = skipKnownMovements(existing, [cafe(), cafe(), cafe('cm-00099988877'), cafe(undefined, '2.60')]);
	assert.equal(skipped, 1);
	assert.equal(kept.length, 3);
	const demo = { ...csvTx('2026-09-12', '2.50', 'DBIT', 'DEMO'), source: 'demo' as const };
	assert.equal(skipKnownMovements([demo], [cafe()]).skipped, 0);
});

test('reverse guard: CSV imported AFTER an OFX statement of the same period → already known movements skipped', () => {
	const ofx = parseOfx(OFX_SGML).transactions;
	const csv = [
		csvTx('2026-09-03', '42.50', 'DBIT', 'PAIEMENT CB 0109 VILLEFICTIVE EPICERIE DU PORT'),
		csvTx('2026-09-10', '120.00', 'DBIT', 'CHQ. 1234567'),
		csvTx('2026-09-20', '9.90', 'DBIT', 'PAIEMENT CB 1909 VILLEFICTIVE LIBRAIRIE')
	];
	const { kept, skipped } = skipKnownMovements(ofx, csv, { seulementSi: isStatementSource });
	assert.equal(skipped, 2);
	assert.deepEqual(kept.map((t) => t.remittance_information[0]), ['PAIEMENT CB 1909 VILLEFICTIVE LIBRAIRIE']);
});

test('reverse guard: two CSV exports never interfere (only statements count)', () => {
	const older = [csvTx('2026-09-12', '2.50', 'DBIT', 'PAIEMENT CB 1209 BOULANGERIE')];
	const newer = [csvTx('2026-09-12', '2.50', 'DBIT', 'PAIEMENT CB 1209 BOULANGERIE'), csvTx('2026-09-12', '2.50', 'DBIT', 'PAIEMENT CB 1209 CAFE')];
	const { kept, skipped } = skipKnownMovements(older, newer, { seulementSi: isStatementSource });
	assert.equal(skipped, 0);
	assert.equal(kept.length, 2);
});

/** With two numbered accounts there is no way to know which one: nothing is ignored. */
test('guard: a CSV without an account number (« cm ») stands for the only numbered Crédit Mutuel account', () => {
	const statementTx = (account: string): Transaction => ({ ...csvTx('2026-09-12', '2.50', 'DBIT', 'CB CAFE'), source: 'ofx', account });
	const noAccountNumber: Transaction = { ...csvTx('2026-09-12', '2.50', 'DBIT', 'PAIEMENT CB 1209 CAFE'), account: undefined };
	assert.equal(skipKnownMovements([statementTx('cm-00012345678')], [noAccountNumber], { seulementSi: isStatementSource }).skipped, 1);
	assert.equal(skipKnownMovements([statementTx('cm-00012345678'), statementTx('cm-00099988877')], [noAccountNumber], { seulementSi: isStatementSource }).skipped, 0);
});

test('US QIF: the comma groups thousands (« -1,234 » = 1 234 €), French QIF keeps its decimal comma', () => {
	const us = parseQif('!Type:Bank\nD09/25/2026\nT-1,234\nPLOYER FICTIF\n^\nD09/26/2026\nT2,500.50\nPVIREMENT FICTIF\n^\n');
	assert.deepEqual(us.transactions.map((t) => [t.booking_date, t.credit_debit_indicator, t.transaction_amount.amount]), [
		['2026-09-25', 'DBIT', '1234.00'],
		['2026-09-26', 'CRDT', '2500.50']
	]);
	const fr = parseQif('!Type:Bank\nD25/09/2026\nT-12,50\nPBOULANGERIE FICTIVE\n^\n');
	assert.equal(fr.transactions[0]!.transaction_amount.amount, '12.50');
});

/**
 * Account WITHOUT its own name but with an owner: the label must fall back to « Compte ••… ».
 */
test('CAMT: the account name is Acct>Nm, never the owner (Ownr>Nm) nor the bank', () => {
	const xml = CAMT_053.replace('<Nm>Compte courant fictif</Nm></Acct>', '<Ownr><Nm>M TITULAIRE FICTIF</Nm></Ownr></Acct>');
	assert.notEqual(xml, CAMT_053);
	const r = parseCamt(xml);
	assert.ok(r.accounts.length > 0, 'compte lu');
	assert.ok(r.accounts.every((a) => a.label !== 'M TITULAIRE FICTIF'), 'le titulaire ne devient pas le nom du compte');
});
