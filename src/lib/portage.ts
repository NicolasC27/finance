import type { CategoryId, Transaction } from './types';
import type { PdfLine } from './pdfNatixis';

/**
 * Portage salarial (InfoPortage): pure module, testable with tsx.
 *
 * 1. Reads the 3 documents of the month: activity account (one table per month, columns found by
 *    their position), payslip, expense report.
 * 2. Matches expense-report lines with card purchases: the purchase date is in the label
 *    ('PAIEMENT CB 1809' = 18/09), and so is the foreign-currency amount ('36,00 USD').
 * 3. Computed entries for the BUDGET (never for bank balances):
 *    - meal vouchers: Swile credit (income) and meals (Alimentation);
 *    - culture vouchers: credit, then spending noted by hand;
 *    - purchases advanced for work: neutralised in their category;
 *    - part of the salary that reimburses those purchases: removed from income.
 *    Allowances (remote work, 'régul TT') stay income.
 */

/* ---------- Types ---------- */

export interface ActivityMonth {
	mois: string; // YYYY-MM
	jours?: number;
	ca?: number;
	fraisGestion?: number;
	chargesActivite?: number;
	cheques?: number;
	provision?: number;
	reserve?: number;
	totalCa?: number;
	salaireBase?: number;
	brut?: number;
	chargesSalariales?: number;
	rembFrais?: number;
	netAvantImpot?: number;
	impot?: number;
	netApresImpot?: number;
	chargesPatronales?: number;
	coutGlobal?: number;
	reserveDisponible?: number;
}

export interface ActivityStatement {
	periode: string; // YYYY-MM of the document
	tjm?: number;
	client?: string;
	clientFinal?: string;
	fraisGestionPct?: number;
	delaiPaiement?: string;
	/** 'Reste en attente de paiement client'. */
	attenteClient?: number;
	dateEntree?: string; // YYYY-MM-DD
	mois: ActivityMonth[];
}

export interface Payslip {
	mois: string; // YYYY-MM
	emploi?: string;
	brut?: number;
	titresRestaurant?: { nombre: number; partSalariale: number; partPatronale: number };
	rembFrais: number;
	netAvantImpot?: number;
	/** Withholding tax: base (net taxable), personal rate (%), amount. */
	pas?: { base?: number; taux: number; montant: number };
	netPaye: number;
	datePaiement?: string; // YYYY-MM-DD
}

export interface ExpenseLine {
	id: string; // `${numero}-${n}`
	n: number;
	date: string; // YYYY-MM-DD
	nature: string;
	type: string;
	montant: number; // incl. VAT, in €
	devise?: { montant: number; code: string };
	commentaire?: string;
}

export interface ExpenseReport {
	numero: string;
	mois: string; // YYYY-MM of the expenses
	declareeLe?: string;
	etat?: string;
	total: number;
	lignes: ExpenseLine[];
}

export interface VoucherCredit {
	id: string;
	date: string;
	montant: number;
	libelle: string;
}

export interface VoucherSpend extends VoucherCredit {
	categoryId: CategoryId;
	subId?: string;
}

export interface PortageData {
	/** Last imported activity account: it holds every month of the year. */
	compte?: ActivityStatement;
	paies: Payslip[];
	notes: ExpenseReport[];
	/** Manual choices: expense line id → operation key, 'aucune' or 'indemnite'. */
	choix: Record<string, string>;
	cheques: { credits: VoucherCredit[]; depenses: VoucherSpend[] };
	/** Meals paid with the Swile card, typed one by one (quick entry): they lower the month's lump. */
	swile?: VoucherSpend[];
	/** Daily Swile cap (€), 25 by default. */
	swilePlafond?: number;
	/** Tax provision in the budget (absent = active, neutral rate of the last salary). */
	impot?: TaxSetting;
}

export interface TaxSetting {
	/** false = no provision in the budget. */
	provision?: boolean;
	/** Target rate (%) chosen by hand; absent = neutral rate of the last salary. */
	taux?: number;
}

export const emptyPortage = (): PortageData => ({ paies: [], notes: [], choix: {}, cheques: { credits: [], depenses: [] }, swile: [] });

/** Default daily cap of the Swile meal card (€). */
export const SWILE_DAILY_CAP = 25;

/** Lump of a month's meal vouchers not typed meal by meal: payslip value minus the detailed meals, never below 0. */
export function swileLump(value: number, detailed: number): number {
	return Math.max(0, r2(value - detailed));
}

/* ---------- Reading: helpers ---------- */

const LONG_MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const SHORT_MONTHS: Record<string, number> = {
	jan: 1, janv: 1, fév: 2, fev: 2, févr: 2, fevr: 2, mar: 3, mars: 3, avr: 4, avril: 4, mai: 5, juin: 6,
	juil: 7, juill: 7, août: 8, aout: 8, sept: 9, oct: 10, nov: 11, déc: 12, dec: 12
};
const r2 = (n: number) => Math.round(n * 100) / 100;
const pad = (n: number) => String(n).padStart(2, '0');

/** '1 234,56 €', '-98,70 €', '12,00 $', '2 345.67' → number; null otherwise. */
export function parseEuroAmount(s: string): number | null {
	const t = s.replace(/[\s  €$£]/g, '');
	if (!/^-?\d+(?:[.,]\d{1,2})?$/.test(t)) return null;
	return Number(t.replace(',', '.'));
}

/** '03/08/2026' → '2026-08-03'. */
function dateFr(s: string): string | undefined {
	const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(s);
	return m ? `${m[3]}-${m[2]}-${m[1]}` : undefined;
}

/** 'Septembre 2026' → '2026-09'. */
function monthFr(name: string, year: string): string | undefined {
	const i = LONG_MONTHS.indexOf(name.toLowerCase());
	return i >= 0 ? `${year}-${pad(i + 1)}` : undefined;
}

/** Previous / next month of a 'YYYY-MM'. */
export function shiftPortageMonth(month: string, delta: number): string {
	const [y, m] = month.split('-').map(Number) as [number, number];
	const d = new Date(Date.UTC(y, m - 1 + delta, 1));
	return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

/** Last day of a 'YYYY-MM' month. */
export function endOfMonth(month: string): string {
	const [y, m] = month.split('-').map(Number) as [number, number];
	return `${month}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`;
}

const monthName = (month: string) => `${LONG_MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;

/* ---------- Document type ---------- */

export type PortageDocumentType = 'compte' | 'paie' | 'ndf';

export function portageDocumentType(pages: PdfLine[][]): PortageDocumentType | null {
	const text = pages.flat().map((l) => l.text).join('\n');
	if (/^NDF #\d+/m.test(text)) return 'ndf';
	if (/BULLETIN DE SALAIRE/i.test(text)) return 'paie';
	if (/Compte d'activit[ée]/i.test(text) && /Facturation du mois/i.test(text)) return 'compte';
	return null;
}

/*
 * ---------- Activity account ----------
 * Columns: month header (Jan … Déc) and a Total column; worked days are the integer line right
 * under the header; some values sit one line below their label (line 40).
 */

const ACTIVITY_ROWS: Record<number, keyof ActivityMonth> = {
	10: 'ca', 11: 'fraisGestion', 12: 'chargesActivite', 13: 'cheques', 14: 'provision', 15: 'reserve', 18: 'totalCa',
	20: 'salaireBase', 24: 'brut', 25: 'chargesSalariales', 26: 'rembFrais', 28: 'netAvantImpot', 29: 'impot',
	30: 'netApresImpot', 31: 'chargesPatronales', 32: 'coutGlobal', 40: 'reserveDisponible'
};

/**
 * Value of a header field: right of the label (same block, < 450 pt), else on the next line
 * (value shifted by one step, e.g. 'TJM').
 */
function headerField(lines: PdfLine[], label: string): string | undefined {
	for (let i = 0; i < lines.length; i++) {
		const items = lines[i]!.items;
		const j = items.findIndex((it) => it.str.trim() === label);
		if (j < 0) continue;
		const xl = items[j]!.x;
		const isNear = (it: { x: number }) => it.x > xl && it.x < xl + 450;
		const right = items.slice(j + 1).find(isNear);
		if (right) return right.str.trim();
		return lines[i + 1]?.items.find(isNear)?.str.trim();
	}
	return undefined;
}

export function parseActivityStatement(pages: PdfLine[][]): ActivityStatement | { error: string } {
	const lines = pages[0] ?? [];
	const title = lines.find((l) => /Compte d'activit/i.test(l.text) && /\d{4}-\d{2}/.test(l.text));
	const period = title?.text.match(/(\d{4}-\d{2})/)?.[1];
	if (!period) return { error: 'compte d’activité illisible (période absente)' };

	const headerIdx = lines.findIndex((l) => l.items.filter((it) => SHORT_MONTHS[it.str.trim().toLowerCase()] !== undefined).length >= 6);
	if (headerIdx < 0) return { error: 'compte d’activité illisible (colonnes des mois)' };
	const year = [...lines.slice(0, headerIdx)].reverse().find((l) => /^\d{4}$/.test(l.text.trim()))?.text.trim() ?? period.slice(0, 4);
	const columns = lines[headerIdx]!.items
		.filter((it) => SHORT_MONTHS[it.str.trim().toLowerCase()] !== undefined)
		.map((it) => ({ x: it.x, mois: `${year}-${pad(SHORT_MONTHS[it.str.trim().toLowerCase()]!)}` }));
	const xTotal = lines.slice(Math.max(0, headerIdx - 2), headerIdx).flatMap((l) => l.items).find((it) => it.str.trim() === 'Total')?.x ?? Infinity;
	const columnAt = (x: number): string | null => {
		let best = { d: Math.abs(x - xTotal), mois: null as string | null };
		for (const c of columns) if (Math.abs(x - c.x) < best.d) best = { d: Math.abs(x - c.x), mois: c.mois };
		return best.mois;
	};

	const byMonth = new Map<string, ActivityMonth>();
	const monthRow = (month: string) => byMonth.get(month) ?? byMonth.set(month, { mois: month }).get(month)!;
	const fill = (field: keyof ActivityMonth, items: { x: number; str: string }[]) => {
		for (const it of items) {
			const v = parseEuroAmount(it.str);
			const month = columnAt(it.x);
			if (v === null || !month) continue;
			(monthRow(month) as unknown as Record<string, number>)[field] = v;
		}
	};
	const daysLine = lines[headerIdx + 1];
	if (daysLine && daysLine.items.every((it) => /^\d{1,2}$/.test(it.str.trim()))) {
		for (const it of daysLine.items) {
			const month = columnAt(it.x);
			if (month) monthRow(month).jours = Number(it.str);
		}
	}
	for (let i = headerIdx + 1; i < lines.length; i++) {
		const items = lines[i]!.items;
		const num = Number(items[0]?.str.trim());
		if (!/^\d{2}$/.test(items[0]?.str.trim() ?? '') || !(num in ACTIVITY_ROWS)) continue;
		let values = items.slice(2).filter((it) => parseEuroAmount(it.str) !== null);
		if (!values.length && lines[i + 1] && !/^\d{2}$/.test(lines[i + 1]!.items[0]?.str.trim() ?? '')) {
			values = lines[i + 1]!.items.filter((it) => parseEuroAmount(it.str) !== null);
		}
		fill(ACTIVITY_ROWS[num]!, values);
	}

	const dailyRate = parseEuroAmount(headerField(lines, 'TJM') ?? '');
	const pending = parseEuroAmount(headerField(lines, 'Reste en attente de paiement client') ?? '');
	const pct = parseEuroAmount(headerField(lines, 'Frais de gestion (%)') ?? '');
	return {
		periode: period,
		...(dailyRate !== null ? { tjm: dailyRate } : {}),
		...(headerField(lines, 'Nom client') ? { client: headerField(lines, 'Nom client') } : {}),
		...(headerField(lines, 'Nom client final') ? { clientFinal: headerField(lines, 'Nom client final') } : {}),
		...(pct !== null ? { fraisGestionPct: pct } : {}),
		...(headerField(lines, 'Délai de paiement client') ? { delaiPaiement: headerField(lines, 'Délai de paiement client') } : {}),
		...(pending !== null ? { attenteClient: pending } : {}),
		...(dateFr(headerField(lines, "Date d'entrée") ?? '') ? { dateEntree: dateFr(headerField(lines, "Date d'entrée") ?? '') } : {}),
		mois: [...byMonth.values()].filter((m) => Object.keys(m).length > 1).sort((a, b) => a.mois.localeCompare(b.mois))
	};
}

/* ---------- Payslip ---------- */

const AMOUNT_PATTERN = String.raw`(\d{1,3}(?:[  ]\d{3})*[.,]\d{2})`;
const num = (s: string | undefined) => (s === undefined ? undefined : (parseEuroAmount(s) ?? undefined));

export function parsePayslip(pages: PdfLine[][]): Payslip | { error: string } {
	const texts = pages.flat().map((l) => l.text.replace(/\s+/g, ' ').trim());
	const matchLine = (re: RegExp) => texts.map((t) => re.exec(t)).find(Boolean) ?? null;
	const per = matchLine(/Période\s*:\s*([A-Za-zéû]+)\s+(\d{4})/);
	const month = per ? monthFr(per[1]!, per[2]!) : undefined;
	const net = matchLine(new RegExp(`^Net payé\\s+${AMOUNT_PATTERN}`));
	if (!month || !net) return { error: 'fiche de paie illisible (période ou net payé absent)' };
	const tr = matchLine(new RegExp(String.raw`^Titres-restaurant\s+([\d.]+)\s+[\d.]+\s+${AMOUNT_PATTERN}(?:\s+[\d.]+\s+[\d.]+\s+${AMOUNT_PATTERN})?`));
	const pas = matchLine(new RegExp(String.raw`prélevé à la source - PAS\s+${AMOUNT_PATTERN}\s+-\s*([\d.]+)\s+${AMOUNT_PATTERN}`));
	const job = matchLine(/^Emploi\s*:\s*(.+)$/);
	const payment = matchLine(/Paiement le (\d{2}\/\d{2}\/\d{4})/);
	return {
		mois: month,
		...(job ? { emploi: job[1]!.trim() } : {}),
		...(num(matchLine(new RegExp(`^Salaire brut\\s+${AMOUNT_PATTERN}`))?.[1]) !== undefined ? { brut: num(matchLine(new RegExp(`^Salaire brut\\s+${AMOUNT_PATTERN}`))?.[1]) } : {}),
		...(tr ? { titresRestaurant: { nombre: Number(tr[1]), partSalariale: num(tr[2])!, partPatronale: num(tr[3]) ?? num(tr[2])! } } : {}),
		rembFrais: num(matchLine(new RegExp(`^Remboursement de frais\\s+${AMOUNT_PATTERN}`))?.[1]) ?? 0,
		...(num(matchLine(new RegExp(`^Net à payer avant impôt sur le revenu\\s+${AMOUNT_PATTERN}`))?.[1]) !== undefined
			? { netAvantImpot: num(matchLine(new RegExp(`^Net à payer avant impôt sur le revenu\\s+${AMOUNT_PATTERN}`))?.[1]) }
			: {}),
		...(pas ? { pas: { base: num(pas[1])!, taux: Number(pas[2]), montant: num(pas[3])! } } : {}),
		netPaye: num(net[1])!,
		...(payment ? { datePaiement: dateFr(payment[1]!) } : {})
	};
}

/*
 * ---------- Expense report ----------
 * Foreign-currency amount: '12,00 $' followed by 'USD' (columns missing from older reports).
 */

export function parseExpenseReport(pages: PdfLine[][]): ExpenseReport | { error: string } {
	const lines = pages.flat();
	const header = lines.map((l) => /^NDF #(\d+)\s*:\s*([A-Za-zéû]+)\s+(\d{4}),\s*déclarée le (\d{2}\/\d{2}\/\d{4})/.exec(l.text.trim())).find(Boolean);
	const month = header ? monthFr(header[2]!, header[3]!) : undefined;
	if (!header || !month) return { error: 'note de frais illisible (en-tête NDF absent)' };
	const reportNo = header[1]!;
	const status = lines.map((l) => /Etat\s*:\s*(\S+)/.exec(l.text)).find(Boolean)?.[1];
	const comments = new Map<string, string>();
	for (const l of lines) {
		const m = /^\((\d+)\)\s+(.+)$/.exec(l.text.trim());
		if (m) comments.set(m[1]!, m[2]!.trim());
	}
	const expenseLines: ExpenseLine[] = [];
	for (const l of lines) {
		const it = l.items.map((x) => x.str.trim());
		if (!/^\d+$/.test(it[0] ?? '') || !/^\d{2}\/\d{2}\/\d{4}$/.test(it[1] ?? '')) continue;
		const ref = /^\((\d+)\)$/.exec(it[it.length - 1] ?? '')?.[1];
		const amounts = it.filter((s) => /€$/.test(s) && parseEuroAmount(s) !== null);
		const inclVat = parseEuroAmount(amounts[amounts.length - 1] ?? '');
		if (inclVat === null) continue;
		const currencyIdx = it.findIndex((s, k) => /^[A-Z]{3}$/.test(s) && k > 3);
		const currency = currencyIdx > 0 && it[currencyIdx] !== 'EUR' ? { montant: parseEuroAmount(it[currencyIdx - 1] ?? '') ?? 0, code: it[currencyIdx]! } : undefined;
		expenseLines.push({
			id: `${reportNo}-${it[0]}`,
			n: Number(it[0]),
			date: dateFr(it[1]!)!,
			nature: it[2] ?? '',
			type: it[3] ?? '',
			montant: inclVat,
			...(currency ? { devise: currency } : {}),
			...(ref && comments.has(ref) ? { commentaire: comments.get(ref) } : {})
		});
	}
	const totalLine = lines.find((l) => /^Total\b/.test(l.text.trim()));
	const total = parseEuroAmount(totalLine?.items[totalLine.items.length - 1]?.str ?? '') ?? r2(expenseLines.reduce((s, l) => s + l.montant, 0));
	return { numero: reportNo, mois: month, ...(dateFr(header[4]!) ? { declareeLe: dateFr(header[4]!) } : {}), ...(status ? { etat: status } : {}), total, lignes: expenseLines };
}

/* ---------- Matching with card purchases ---------- */

/** Allowance (remote work, 'TT' regularisation): no purchase behind it, it stays income. */
export function isAllowance(l: ExpenseLine): boolean {
	return /t[ée]l[ée]travail/i.test(l.nature) || /t[ée]l[ée]travail|\bTT\b/i.test(l.commentaire ?? '');
}

const labelOf = (tx: Transaction) => tx.remittance_information.join(' ');

/**
 * Card purchase date read from the label ('PAIEMENT CB 1809' → 18/09), else the booking date
 * (a December purchase booked in January belongs to the previous year).
 */
export function purchaseDateFromLabel(tx: Transaction): string {
	const m = /\bCB\s+(\d{2})(\d{2})\b/.exec(labelOf(tx));
	if (!m || !tx.booking_date) return tx.booking_date;
	let year = Number(tx.booking_date.slice(0, 4));
	if (Number(m[2]) > Number(tx.booking_date.slice(5, 7))) year--;
	return `${year}-${m[2]}-${m[1]}`;
}

/** Original foreign-currency amount read from the label ('36,00 USD'). */
function currencyFromLabel(tx: Transaction): { montant: number; code: string } | null {
	const m = /(\d+[.,]\d{2})\s?(USD|GBP|CHF|CAD|JPY|SGD)\b/.exec(labelOf(tx));
	return m ? { montant: Number(m[1]!.replace(',', '.')), code: m[2]! } : null;
}

const daysBetween = (a: string, b: string) => Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;
const debit = (tx: Transaction) => (tx.credit_debit_indicator === 'DBIT' ? Number(tx.transaction_amount.amount) : 0);

export type LineStatus = 'rapprochee' | 'probable' | 'indemnite' | 'aucune' | 'introuvable';

export interface MatchedLine {
	ligne: ExpenseLine;
	etat: LineStatus;
	/** Card operation kept (matched, probable, or chosen by hand). */
	tx?: Transaction;
	/** Other plausible purchases (manual choice). */
	candidats: Transaction[];
}

/**
 * Expense-report lines ↔ card purchases. Manual choices first; then automatic: same purchase
 * date (±1 d) and identical amount in € or in the foreign currency → matched; date ±3 d and
 * amount within 6 % → probable (to confirm). A purchase is used only once.
 */
export function matchExpenseReport(report: ExpenseReport, txs: Transaction[], choices: Record<string, string>, txKey: (tx: Transaction) => string, taken = new Set<string>()): MatchedLine[] {
	const byKey = new Map(txs.map((t) => [txKey(t), t]));
	const out = new Map<string, MatchedLine>();
	for (const l of report.lignes) {
		const c = choices[l.id];
		if (c === 'indemnite' || (c === undefined && isAllowance(l))) out.set(l.id, { ligne: l, etat: 'indemnite', candidats: [] });
		else if (c === 'aucune') out.set(l.id, { ligne: l, etat: 'aucune', candidats: [] });
		else if (c && byKey.has(c)) {
			taken.add(c);
			out.set(l.id, { ligne: l, etat: 'rapprochee', tx: byKey.get(c)!, candidats: [] });
		}
	}
	const purchases = txs.filter((t) => t.source !== 'portage' && t.booking_date && debit(t) > 0);
	for (const pass of ['rapprochee', 'probable'] as const) {
		for (const l of report.lignes) {
			if (out.has(l.id)) continue;
			const ok = purchases.filter((t) => {
				if (taken.has(txKey(t))) return false;
				const dayGap = daysBetween(purchaseDateFromLabel(t), l.date);
				const foreign = currencyFromLabel(t);
				if (pass === 'rapprochee')
					return dayGap <= 1 && (Math.abs(debit(t) - l.montant) < 0.01 || (!!l.devise && !!foreign && foreign.code === l.devise.code && Math.abs(foreign.montant - l.devise.montant) < 0.01));
				return dayGap <= 3 && Math.abs(debit(t) - l.montant) <= l.montant * 0.06;
			});
			ok.sort((a, b) => daysBetween(purchaseDateFromLabel(a), l.date) - daysBetween(purchaseDateFromLabel(b), l.date) || Math.abs(debit(a) - l.montant) - Math.abs(debit(b) - l.montant));
			if (ok[0]) {
				taken.add(txKey(ok[0]));
				out.set(l.id, { ligne: l, etat: pass, tx: ok[0], candidats: [] });
			}
		}
	}
	return report.lignes.map((l) => {
		const r = out.get(l.id) ?? { ligne: l, etat: 'introuvable' as const, candidats: [] };
		if (r.etat === 'introuvable' || r.etat === 'probable') {
			r.candidats = purchases
				.filter((t) => !taken.has(txKey(t)) && daysBetween(purchaseDateFromLabel(t), l.date) <= 15)
				.sort((a, b) => Math.abs(debit(a) - l.montant) - Math.abs(debit(b) - l.montant))
				.slice(0, 8);
		}
		return r;
	});
}

/** All reports, a purchase being used only once. */
export function matchAllReports(data: PortageData, txs: Transaction[], txKey: (tx: Transaction) => string): Map<string, MatchedLine[]> {
	const taken = new Set<string>();
	const out = new Map<string, MatchedLine[]>();
	for (const report of [...data.notes].sort((a, b) => a.mois.localeCompare(b.mois))) out.set(report.numero, matchExpenseReport(report, txs, data.choix, txKey, taken));
	return out;
}

/** A line counts as 'advanced and matched' (neutralised in the budget). */
export const isMatchedAdvance = (r: MatchedLine) => r.etat === 'rapprochee' && !!r.tx;

/* ---------- Salary received ---------- */

/** Salary transfer of a month: INFOPORTAGE credit of the net paid amount, within 40 days. */
export function salaryTransfer(payslip: Payslip, txs: Transaction[]): Transaction | undefined {
	const refDate = payslip.datePaiement ?? endOfMonth(payslip.mois);
	return txs.find(
		(t) =>
			t.source !== 'portage' &&
			t.credit_debit_indicator === 'CRDT' &&
			/INFOPORTAGE|INFO PORTAGE/i.test(labelOf(t)) &&
			Math.abs(Number(t.transaction_amount.amount) - payslip.netPaye) < 0.01 &&
			daysBetween(t.booking_date || refDate, refDate) <= 40
	);
}

/* ---------- Budget entries ---------- */

export const PORTAGE_ACCOUNT = 'portage';

function entry(date: string, signedAmount: number, label: string, category: CategoryId, note: string, subId?: string): Transaction {
	return {
		transaction_amount: { amount: Math.abs(signedAmount).toFixed(2), currency: 'EUR' },
		booking_date: date,
		value_date: date,
		remittance_information: [label],
		credit_debit_indicator: signedAmount >= 0 ? 'CRDT' : 'DBIT',
		source: 'portage',
		account: PORTAGE_ACCOUNT,
		virtual_category: category,
		...(subId ? { virtual_subcategory: subId } : {}),
		note
	};
}

/**
 * Computed entries (source 'portage'), to add to the BUDGET operations only. `categoryOf`:
 * current category of a bank operation (that of a neutralised purchase). Tax not withheld (rate
 * too low) is set aside on the day the salary arrives; a purchase advanced for work is
 * neutralised in its own category in the month of the purchase; the reimbursement included in
 * the next month's salary is not income.
 */
export function portageEntries(data: PortageData, txs: Transaction[], txKey: (tx: Transaction) => string, categoryOf: (tx: Transaction) => CategoryId): Transaction[] {
	const out: Transaction[] = [];
	for (const p of data.paies) {
		const tr = p.titresRestaurant;
		if (tr && tr.nombre > 0) {
			const value = r2(tr.partSalariale + tr.partPatronale);
			const date = endOfMonth(p.mois);
			out.push(entry(date, value, `Titres-restaurant Swile · ${monthName(p.mois)}`, 'revenus', `${tr.nombre} tickets de ${r2(value / tr.nombre)} € (moitié retenue sur ton salaire, moitié payée par l'employeur)`));
			const detailed = r2((data.swile ?? []).filter((s) => s.date.startsWith(p.mois)).reduce((s, x) => s + x.montant, 0));
			const lump = swileLump(value, detailed);
			if (lump > 0) out.push(entry(date, -lump, `Repas en titres-restaurant (Swile) · ${monthName(p.mois)}`, 'alimentation', detailed > 0 ? `Le reste du mois : ${eur(detailed)} de repas sont saisis un par un` : 'Compté comme dépensé dans le mois : l’historique Swile n’est pas importable'));
		}
	}
	for (const s of data.swile ?? []) out.push(entry(s.date, -s.montant, `Payé en Swile : ${s.libelle}`, s.categoryId, 'Repas payé avec la carte Swile (saisie rapide)', s.subId));
	for (const pr of portageTaxProvisions(data)) {
		const payslip = data.paies.find((p) => p.mois === pr.mois)!;
		const date = salaryTransfer(payslip, txs)?.booking_date ?? payslip.datePaiement ?? endOfMonth(pr.mois);
		const adjustmentMonth = `septembre ${Number(pr.mois.slice(0, 4)) + 1}`;
		out.push(entry(date, -pr.montant, `Provision impôt · ${monthName(pr.mois)}`, 'impots', `Prélevé à ${pct(pr.tauxPreleve)} au lieu de ≈ ${pct(pr.tauxVise)} sur ${eur(pr.base)} imposables : mis de côté pour la régularisation de ${adjustmentMonth}. Quand elle sera prélevée, exclus-la du budget pour ne pas la compter deux fois.`));
	}
	for (const c of data.cheques.credits) out.push(entry(c.date, c.montant, `Chèques culture · ${c.libelle}`, 'revenus', 'Porte-monnaie chèques culture (onglet Portage)'));
	for (const d of data.cheques.depenses) out.push(entry(d.date, -d.montant, `Payé en chèques culture : ${d.libelle}`, d.categoryId, 'Dépense en chèques culture (onglet Portage)', d.subId));

	const matches = matchAllReports(data, txs, txKey);
	for (const report of data.notes) {
		const matched = (matches.get(report.numero) ?? []).filter(isMatchedAdvance);
		for (const r of matched) {
			out.push(entry(r.tx!.booking_date, r.ligne.montant, `Note de frais ${monthName(report.mois)} : ${r.ligne.nature}${r.ligne.commentaire ? ` (${r.ligne.commentaire})` : ''}`, categoryOf(r.tx!), 'Achat avancé pour le portage, remboursé avec le salaire du mois suivant'));
		}
		const payslip = data.paies.find((p) => p.mois === shiftPortageMonth(report.mois, 1));
		const transfer = payslip ? salaryTransfer(payslip, txs) : undefined;
		const advanced = r2(matched.reduce((s, r) => s + r.ligne.montant, 0));
		if (transfer && advanced > 0) {
			out.push(entry(transfer.booking_date, -advanced, `Frais avancés remboursés dans le salaire (note de frais ${monthName(report.mois)})`, 'revenus', 'Part du virement qui rembourse tes achats pro : retirée des revenus'));
		}
	}
	return out;
}

/*
 * ---------- Money waiting for you ----------
 * A report already included in a payslip is part of the expected salary: never counted twice.
 */

export interface PendingMoney {
	client?: number;
	delaiClient?: string;
	reserve?: number;
	/** Expense reports whose reimbursing salary is not known yet (payslip missing). */
	frais: { numero: string; mois: string; montant: number; salaire: string }[];
	/** Salaries paid (payslip) that have not reached the account yet. */
	salaires: { mois: string; montant: number; datePaiement?: string }[];
}

export function pendingMoney(data: PortageData, txs: Transaction[]): PendingMoney {
	const reserve = data.compte?.mois.reduce((s, m) => s + (m.reserveDisponible ?? 0), 0);
	return {
		...(data.compte?.attenteClient !== undefined ? { client: data.compte.attenteClient } : {}),
		...(data.compte?.delaiPaiement ? { delaiClient: data.compte.delaiPaiement } : {}),
		...(reserve ? { reserve: r2(reserve) } : {}),
		frais: data.notes
			.filter((n) => !data.paies.some((p) => p.mois === shiftPortageMonth(n.mois, 1)))
			.map((n) => ({ numero: n.numero, mois: n.mois, montant: n.total, salaire: shiftPortageMonth(n.mois, 1) })),
		salaires: data.paies.filter((p) => !salaryTransfer(p, txs)).map((p) => ({ mois: p.mois, montant: p.netPaye, ...(p.datePaiement ? { datePaiement: p.datePaiement } : {}) }))
	};
}

/* ---------- Tax: withholding-tax alerts ---------- */

/**
 * Official neutral rate grid ('taux par défaut'), mainland France, 2025: monthly base (net
 * taxable) → rate. It is the rate of a single person with no child and no other income: a
 * reference, not the exact computation of your tax.
 */
const NEUTRAL_RATE_GRID: readonly [number, number][] = [
	[1620, 0], [1683, 0.5], [1791, 1.3], [1911, 2.1], [2042, 2.9], [2151, 3.5], [2294, 4.1], [2714, 5.3], [3107, 7.5],
	[3539, 9.9], [3983, 11.9], [4648, 13.8], [5574, 15.8], [6974, 17.9], [8711, 20], [12091, 24], [16376, 28], [25706, 33], [55062, 38]
];

export function neutralRate(monthlyBase: number): number {
	for (const [ceiling, rate] of NEUTRAL_RATE_GRID) if (monthlyBase < ceiling) return rate;
	return 43;
}

export interface TaxAlert {
	niveau: 'alerte' | 'info';
	titre: string;
	detail: string;
}

const pct = (n: number) => `${n.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`;
const eur = (n: number) => `${Math.round(n).toLocaleString('fr-FR')} €`;
/** Rate gap compared to a threshold without rounding error (5.3 − 3.3 = 1.9999…). */
const reaches = (gap: number, threshold: number) => gap + 1e-9 >= threshold;

/** Net taxable amount of the month: base from the payslip, else amount ÷ rate (old imports). */
export const taxableBase = (p: Payslip) => (p.pas ? (p.pas.base ?? (p.pas.taux > 0 ? p.pas.montant / (p.pas.taux / 100) : 0)) : 0);

/** Target rate for the provision: chosen by hand, else the neutral rate of the last salary. */
export function targetRate(data: PortageData): number | undefined {
	if (data.impot?.taux !== undefined) return data.impot.taux;
	const last = data.paies.filter((p) => p.pas).sort((a, b) => a.mois.localeCompare(b.mois)).pop();
	const b = last ? taxableBase(last) : 0;
	return b > 0 ? neutralRate(b) : undefined;
}

export interface PortageTaxProvision {
	mois: string;
	base: number;
	tauxPreleve: number;
	tauxVise: number;
	montant: number;
}

/**
 * Tax not withheld yet, to set aside every month: (target rate − withheld rate) × net taxable.
 * In automatic mode only from a 2-point gap (like the alert); with a rate chosen by hand, from
 * 0.1 point.
 */
export function portageTaxProvisions(data: PortageData): PortageTaxProvision[] {
	const target = data.impot?.provision === false ? undefined : targetRate(data);
	if (target === undefined) return [];
	const threshold = data.impot?.taux !== undefined ? 0.1 : 2;
	const out: PortageTaxProvision[] = [];
	for (const p of data.paies) {
		const base = taxableBase(p);
		if (!p.pas || base <= 0 || !reaches(target - p.pas.taux, threshold)) continue;
		out.push({ mois: p.mois, base: r2(base), tauxPreleve: p.pas.taux, tauxVise: target, montant: r2(((target - p.pas.taux) / 100) * base) });
	}
	return out;
}

/**
 * Withholding tax, from the payslips: rate change (increase = alert, decrease = info) and rate
 * too low for the current salary (gap ≥ 2 points with the neutral rate) → regularisation to
 * expect (August to December of the next year; the reminder avoids counting it twice).
 */
export function taxAlerts(payslips: Payslip[], opts: { provisions?: PortageTaxProvision[]; aujourdhui?: string } = {}): TaxAlert[] {
	const withRate = payslips.filter((p) => p.pas && p.pas.taux >= 0).sort((a, b) => a.mois.localeCompare(b.mois));
	const last = withRate[withRate.length - 1];
	if (!last?.pas) return [];
	const prev = withRate[withRate.length - 2];
	const base = taxableBase;
	const out: TaxAlert[] = [];
	const today = opts.aujourdhui ?? new Date().toISOString().slice(0, 10);
	const byYear = new Map<number, number>();
	for (const pr of opts.provisions ?? []) {
		const year = Number(pr.mois.slice(0, 4));
		byYear.set(year, (byYear.get(year) ?? 0) + pr.montant);
	}
	for (const [year, total] of byYear) {
		if (today >= `${year + 1}-08-01` && today <= `${year + 1}-12-31`) {
			out.push({
				niveau: 'info',
				titre: `Régularisation de ton impôt ${year} : ${eur(total)} déjà mis de côté`,
				detail: `Ton budget a provisionné ${eur(total)} en ${year}. Quand la régularisation sera prélevée (souvent en septembre), exclus cette opération du budget : sinon la même dépense compte deux fois.`
			});
		}
	}
	if (prev?.pas && Math.abs(last.pas.taux - prev.pas.taux) >= 0.05) {
		const rising = last.pas.taux > prev.pas.taux;
		out.push({
			niveau: rising ? 'alerte' : 'info',
			titre: `Taux de prélèvement en ${rising ? 'hausse' : 'baisse'} : ${pct(prev.pas.taux)} → ${pct(last.pas.taux)}`,
			detail: `Depuis ${monthName(last.mois)} : environ ${eur((Math.abs(last.pas.taux - prev.pas.taux) / 100) * base(last))} ${rising ? 'de moins' : 'de plus'} sur ton net chaque mois.`
		});
	}
	const b = base(last);
	const neutral = neutralRate(b);
	if (b > 0 && reaches(neutral - last.pas.taux, 2)) {
		const gap = ((neutral - last.pas.taux) / 100) * b;
		const lastProvision = opts.provisions?.find((x) => x.mois === last.mois);
		const monthsLeft = 12 - Number(last.mois.slice(5, 7)) + 1;
		const year = Number(last.mois.slice(0, 4));
		out.push({
			niveau: 'alerte',
			titre: `Taux de prélèvement bas pour ton salaire actuel : ${pct(last.pas.taux)}`,
			detail: `Appliqué à ${eur(b)} imposables par mois, alors que le taux neutre (célibataire sans enfant, grille 2025) serait d'environ ${pct(neutral)}. Écart ≈ ${eur(gap)} par mois : si ton salaire reste à ce niveau, prévois une régularisation en septembre ${year + 1} (≈ ${eur(gap * monthsLeft)} pour ${monthName(last.mois)} à décembre ${year}). Tu peux actualiser ton taux sur impots.gouv.fr.${lastProvision ? ` Ton budget en tient déjà compte : ${eur(lastProvision.montant)} mis de côté pour ${monthName(last.mois)}.` : ''}`
		});
	}
	return out;
}

/* ---------- Merging an imported document ---------- */

/** Adds (or replaces) a document; returns a readable summary. */
export function mergePortageDocument(data: PortageData, doc: { type: 'compte'; v: ActivityStatement } | { type: 'paie'; v: Payslip } | { type: 'ndf'; v: ExpenseReport }): { data: PortageData; resume: string } {
	if (doc.type === 'compte') {
		if (data.compte && data.compte.periode > doc.v.periode) return { data, resume: `Compte d'activité ${monthName(doc.v.periode)} ignoré (un plus récent est déjà là)` };
		return { data: { ...data, compte: doc.v }, resume: `Compte d'activité ${monthName(doc.v.periode)} : ${doc.v.mois.length} mois` };
	}
	if (doc.type === 'paie') {
		return { data: { ...data, paies: [...data.paies.filter((p) => p.mois !== doc.v.mois), doc.v].sort((a, b) => a.mois.localeCompare(b.mois)) }, resume: `Fiche de paie ${monthName(doc.v.mois)} : ${doc.v.netPaye.toLocaleString('fr-FR')} € net` };
	}
	return {
		data: { ...data, notes: [...data.notes.filter((n) => n.numero !== doc.v.numero), doc.v].sort((a, b) => a.mois.localeCompare(b.mois)) },
		resume: `Note de frais ${monthName(doc.v.mois)} : ${doc.v.lignes.length} ligne(s), ${doc.v.total.toLocaleString('fr-FR')} €`
	};
}

/** Reads a PDF already extracted into lines: type recognised, then the document. */
export function readPortageDocument(pages: PdfLine[][]): { type: 'compte'; v: ActivityStatement } | { type: 'paie'; v: Payslip } | { type: 'ndf'; v: ExpenseReport } | { error: string } {
	const type = portageDocumentType(pages);
	if (type === 'compte') {
		const v = parseActivityStatement(pages);
		return 'error' in v ? v : { type, v };
	}
	if (type === 'paie') {
		const v = parsePayslip(pages);
		return 'error' in v ? v : { type, v };
	}
	if (type === 'ndf') {
		const v = parseExpenseReport(pages);
		return 'error' in v ? v : { type, v };
	}
	return { error: 'document non reconnu (compte d’activité, fiche de paie ou note de frais InfoPortage attendus)' };
}
