import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectFile, detectPdf, isPdf } from '../src/lib/importDetection';
import type { PdfLine } from '../src/lib/pdfNatixis';

/** Text content → ArrayBuffer (like File.arrayBuffer()). */
const bytes = (text: string): ArrayBuffer => new TextEncoder().encode(text).buffer as ArrayBuffer;
/** Fake PDF page: one line per text. */
const page = (...lines: string[]): PdfLine[] => lines.map((text, i) => ({ y: 800 - i * 14, items: [{ x: 40, str: text }], text }));

test('standard statements recognised by their content, whatever the extension', () => {
	const ofx = 'OFXHEADER:100\nDATA:OFXSGML\n<OFX><BANKMSGSRSV1><STMTTRNRS></STMTTRNRS></BANKMSGSRSV1></OFX>';
	assert.deepEqual(detectFile('releve.ofx', bytes(ofx)), { famille: 'ofx', cible: 'transactions' });
	assert.deepEqual(detectFile('export.txt', bytes(ofx)), { famille: 'ofx', cible: 'transactions' });
	assert.deepEqual(detectFile('compte.qif', bytes('!Type:Bank\nD01/09/2026\nT-12,50\nPBoulangerie Exemple\n^\n')), { famille: 'qif', cible: 'transactions' });
	const camt = '<?xml version="1.0"?><Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt></BkToCstmrStmt></Document>';
	assert.deepEqual(detectFile('releve.xml', bytes(camt)), { famille: 'camt', cible: 'transactions' });
});

/** Unknown header: Transactions opens the remapping modal. */
test('CSV by header: Crédit Mutuel, Natixis, Kraken ledger, Amazon, then remapping', () => {
	assert.deepEqual(detectFile('comptes.csv', bytes('Date;Date de valeur;Débit;Crédit;Libellé;Solde\n01/09/2026;01/09/2026;-4,20;;BOULANGERIE EXEMPLE;100,00\n')), {
		famille: 'cm-csv',
		cible: 'transactions'
	});
	assert.deepEqual(detectFile('natixis.csv', bytes('Date;Libellé;Montant\n01/09/2026;Versement volontaire;150,00\n')), { famille: 'natixis-csv', cible: 'transactions' });
	const kraken = '"txid","refid","time","type","subtype","aclass","subclass","asset","wallet","amount","fee","balance"\n"T1","R1","2026-09-01 10:00:00","spend","","currency","fiat","EUR","spot / main","-5.9900","0","10.0000"\n';
	assert.deepEqual(detectFile('ledgers.csv', bytes(kraken)), { famille: 'kraken-csv', cible: 'transactions' });
	assert.deepEqual(detectFile('Retail.OrderHistory.1.csv', bytes('Order ID,Order Date,Product Name,Total Owed\n111-0000000-0000000,2026-09-01,Câble exemple,9.99\n')), {
		famille: 'amazon',
		cible: 'transactions'
	});
	assert.deepEqual(detectFile('autre-banque.csv', bytes('Quand;Quoi;Combien\n01/09/2026;Café;-2,00\n')), { famille: 'csv', cible: 'transactions' });
	assert.deepEqual(detectFile('comptes.xlsx', bytes('PK\u0003\u0004…')), { famille: 'cm-xlsx', cible: 'transactions' });
});

/** Statement extension but foreign content: no CSV remapping on XML. */
test('unknown format: clear message, no target', () => {
	const doc = detectFile('lettre.docx', bytes('PK\u0003\u0004…'));
	assert.equal(doc.famille, null);
	assert.ok('raison' in doc && doc.raison.length > 0);
	assert.equal(detectFile('photo.png', bytes('\u0089PNG')).famille, null);
	const xml = detectFile('flux.xml', bytes('<?xml version="1.0"?><rss></rss>'));
	assert.equal(xml.famille, null);
	assert.ok('raison' in xml && /OFX/.test(xml.raison));
});

test('PDFs read only once: Krak, Natixis, tax notice, InfoPortage, vehicle, unknown', () => {
	assert.deepEqual(detectPdf([page('Payward Europe Solutions', 'Monthly Statement', 'September 2026')]), { famille: 'krak-pdf', cible: 'transactions' });
	assert.deepEqual(detectPdf([page('Natixis Interépargne', 'Situation de vos avoirs au 30/09/2026')]), { famille: 'natixis-pdf', cible: 'transactions' });
	assert.deepEqual(detectPdf([page('DIRECTION GÉNÉRALE DES FINANCES PUBLIQUES', 'Impôt sur les revenus de 2025')]), { famille: 'impot-pdf', cible: 'transactions' });
	assert.deepEqual(detectPdf([page('BULLETIN DE SALAIRE', 'Période du 01/09/2026 au 30/09/2026')]), { famille: 'infoportage', cible: 'portage' });
	assert.deepEqual(detectPdf([page('FACTURE ATELIER', 'Véhicule AB-123-CD', 'Vidange et filtres')]), { famille: 'vehicule', cible: 'voiture' });
	const unrecognized = detectPdf([page('Facture d’électricité', 'Consommation de septembre')]);
	assert.equal(unrecognized.famille, null);
	assert.ok('raison' in unrecognized && /PDF non reconnu/.test(unrecognized.raison));
});

test('PDF recognised by name or MIME type', () => {
	assert.ok(isPdf('Releve.PDF'));
	assert.ok(isPdf('sans-extension', 'application/pdf'));
	assert.ok(!isPdf('comptes.csv', 'text/csv'));
});
