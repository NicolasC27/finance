/**
 * Natixis Interépargne PDF parser (SPEC v14 §F), 100 % local.
 *
 * FCPE REALITY (honesty): employee savings funds (FCPE) are NOT continuously quoted; there is no
 * reliable public source of their live net asset value. We therefore show the value AT THE
 * VALUATION DATE of the last imported transaction notice ('au JJ/MM/AAAA · avant frais') and the
 * yearly performance from the 'scheme performance', NEVER a simulated live price.
 *
 * Two recognised documents:
 *   1. 'Avis d'opération' (Payment transaction notice): holdings per fund (NAV, units, amount,
 *      availability), PEI/PERCOL totals, availability timeline per year, last payment.
 *   2. 'Tableau des performances et frais' (Scheme performance): final yearly performance per
 *      fund (QS… codes).
 *
 * pdfjs-dist is loaded through a DYNAMIC IMPORT only (lazy chunk, never in the initial bundle):
 * browser → modern build + external worker; Node (tsx tests) → legacy build + built-in fake worker.
 */

// ---------- Types (SPEC §F.2) ----------

export interface FundHolding {
	/** Full normalised fund label. */
	fund: string;
	/** ISO availability date ('2029-06-01') or 'retraite'. */
	availableAt: string;
	/** Net asset value (NAV). */
	shareValue: number;
	shares: number;
	/** Amount in € (before fees). */
	amount: number;
	/** ISO valuation date ('2026-03-03'). */
	valuedAt: string;
	plan: 'PEI' | 'PERCOL';
	/** Yearly scheme performance (%) if imported. */
	perfY?: number;
}

export interface NatixisHoldings {
	holdings: FundHolding[];
	total: number;
	importedAt: number;
}

/** Segment of the availability timeline ('2029', 'Retraite'…). */
export interface AvailabilitySegment {
	/** Displayed label ('2029', 'Retraite'). */
	label: string;
	/** Sort key (numeric year, 9999 = retirement). */
	key: number;
	amount: number;
}

/** Last payment read on page 1 of the notice (if present). */
export interface NatixisPayment {
	/** Kind ('Abondement', 'Versement'…). */
	kind: string;
	fund: string;
	/** Gross amount paid / matched. */
	amount: number;
	/** Social levies deducted (if mentioned). */
	socialLevy?: number;
	/** Net amount credited (TOTAL of the payment block). */
	netAmount?: number;
	valuedAt: string;
	availableAt: string;
}

export interface NatixisNotice {
	holdings: FundHolding[];
	totalPei: number;
	totalPercol: number;
	total: number;
	/** Timeline read in the PDF (fallback: computed from the holdings). */
	availability: AvailabilitySegment[];
	valuedAt: string;
	lastPayment?: NatixisPayment;
	/** Candidate data lines vs recognised ones (50 % rule). */
	stats: { candidates: number; matched: number };
}

export interface NatixisScheme {
	/** Final yearly performance per normalised fund (%). */
	perfs: Record<string, number>;
	/** Year of the summary (2025). */
	year: number;
}

export type NatixisPdfResult =
	| { kind: 'avis'; avis: NatixisNotice }
	| { kind: 'scheme'; scheme: NatixisScheme }
	| { kind: 'error'; reason: 'unknown' | 'low-match'; message: string };

// ---------- Known funds and normalisation ----------

/**
 * FCPE funds of the plan (labels sometimes split over 2 lines in the PDF, e.g. 'SELECTION DORVAL
 * GLOBAL CONVICTIONS' + '(PART I)', or truncated in the payment table: 'SELECT DORVAL GLOBAL CONVIC I').
 */
export const KNOWN_FUNDS: string[] = [
	'CAP ISR MONETAIRE R',
	'CAP ISR RENDEMENT R',
	'CAP ISR CROISSANCE R',
	'CAP ISR MIXTE SOLIDAIRE R',
	'CAP ISR ACTIONS EUROPE R',
	'CAP ISR OBLIG EURO R',
	'SELECTION DORVAL GLOBAL CONVICTIONS (PART I)'
];

/**
 * Cleans a raw fund label ('' if it is not one). Handles the truncated/split Dorval variants of the
 * payment table, and '(PART R)' (2025 notices) vs a bare 'R' (2026 notices) for the same fund.
 */
export function normalizeFund(raw: string): string {
	let s = raw
		.toUpperCase()
		.replace(/\*+/g, '')
		.replace(/\(\d+\)/g, '')
		.replace(/\s+/g, ' ')
		.trim();
	if (/^SELECT(ION)? DORVAL/.test(s)) return 'SELECTION DORVAL GLOBAL CONVICTIONS (PART I)';
	s = s.replace(/\s*\(PART ([A-Z])\)$/, ' $1');
	if (/^AVENIR RETRAITE \d{4}-\d{4} PART R$/.test(s)) return s;
	if (KNOWN_FUNDS.includes(s)) return s;
	return '';
}

/** '01/06/2029' → '2029-06-01'. */
function dateFrToIso(raw: string): string {
	const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw);
	return m ? `${m[3]}-${m[2]}-${m[1]}` : raw;
}

/** French amount '1 234,56' → 1234.56 (spaces are thousands separators). */
function amountFr(raw: string): number {
	return Number(raw.replace(/\s/g, '').replace(',', '.'));
}

// ---------- Line extraction (pdfjs, dynamic import) ----------

/** A rebuilt text line: items sorted by x, text joined. */
export interface PdfLine {
	y: number;
	items: { x: number; str: string }[];
	text: string;
}

/** Structural subset of pdfjs used here (strict typing, no any). */
interface PdfTextItem {
	str: string;
	transform: number[];
}
interface PdfPageLike {
	getTextContent(): Promise<{ items: unknown[] }>;
}
interface PdfDocLike {
	numPages: number;
	getPage(n: number): Promise<PdfPageLike>;
}
interface PdfjsLike {
	getDocument(src: { data: Uint8Array; disableFontFace?: boolean; enableXfa?: boolean; useSystemFonts?: boolean; isOffscreenCanvasSupported?: boolean }): {
		promise: Promise<PdfDocLike>;
	};
	GlobalWorkerOptions: { workerSrc: string };
}

/**
 * Loads pdfjs-dist lazily:
 * - Node (tsx tests): legacy build + fake worker (no config needed); the module specifier is
 *   computed and marked @vite-ignore so Vite no longer emits the 468 KB 'legacy' chunk that only
 *   Node tests use;
 * - browser: modern build + worker served as a separate asset (`?url`), itself loaded only then.
 */
async function loadPdfjs(): Promise<PdfjsLike> {
	if (typeof window === 'undefined') {
		const legacy = 'pdfjs-dist/legacy/build/pdf.mjs';
		return (await import(/* @vite-ignore */ legacy)) as unknown as PdfjsLike;
	}
	const [pdfjs, worker] = await Promise.all([
		import('pdfjs-dist'),
		import('pdfjs-dist/build/pdf.worker.min.mjs?url')
	]);
	pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
	return pdfjs as unknown as PdfjsLike;
}

/**
 * Extracts the text lines of each page (grouped by y coordinate, ±2 pt tolerance), top to bottom:
 * the only step that touches the binary PDF. Text only: no fonts loaded in the page and no XFA
 * forms (minimal attack surface against a trapped PDF); items without text (markers) are ignored.
 */
export async function extractPdfPages(buffer: ArrayBuffer): Promise<PdfLine[][]> {
	const pdfjs = await loadPdfjs();
	const doc = await pdfjs.getDocument({
		data: new Uint8Array(buffer),
		disableFontFace: true,
		enableXfa: false,
		useSystemFonts: false,
		isOffscreenCanvasSupported: false
	}).promise;
	const pages: PdfLine[][] = [];
	for (let p = 1; p <= doc.numPages; p++) {
		const page = await doc.getPage(p);
		const content = await page.getTextContent();
		const byY = new Map<number, { x: number; str: string }[]>();
		for (const raw of content.items) {
			if (typeof raw !== 'object' || raw === null || !('str' in raw)) continue;
			const item = raw as PdfTextItem;
			if (!item.str.trim()) continue;
			const y = item.transform[5] ?? 0;
			const x = item.transform[4] ?? 0;
			const key = Math.round(y / 2) * 2;
			const list = byY.get(key);
			if (list) list.push({ x, str: item.str });
			else byY.set(key, [{ x, str: item.str }]);
		}
		const lines = [...byY.entries()]
			.sort((a, b) => b[0] - a[0])
			.map(([y, items]): PdfLine => {
				items.sort((a, b) => a.x - b.x);
				return { y, items, text: items.map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim() };
			});
		pages.push(lines);
	}
	return pages;
}

// ---------- 'Avis d'opération' parser ----------

/**
 * Data line of the 'Situation de vos avoirs' table:
 *   [Fund] <availability DD/MM/YYYY|RETRAITE> <NAV> <units> <amount> <valuation date>
 * NAV and units have ≥ 4 decimals, the amount 2: that is what tells them apart.
 */
const ROW_RE =
	/^(?:(.+?) )?(\d{2}\/\d{2}\/\d{4}|RETRAITE) (\d+,\d{4,}) (\d{1,3}(?: \d{3})*,\d{4}) (\d{1,3}(?: \d{3})*,\d{2}) (\d{2}\/\d{2}\/\d{4})$/;

/** Payment line (page 1): Fund <amount> <valuation> <NAV> <units> <availability> [rights %]. */
const PAYMENT_RE =
	/^(.+?) (\d{1,3}(?: \d{3})*,\d{2}) (\d{2}\/\d{2}\/\d{4}) (\d+,\d{4,}) (\d{1,3}(?: \d{3})*,\d{4,}) (\d{2}\/\d{2}\/\d{4})(?: [\d,]+ %)?$/;

const TOTAL_RE = /^TOTAL\*? (\d{1,3}(?: \d{3})*,\d{2})/;

/**
 * Parses the lines of the 'Situation de vos avoirs' page + the payment page. PURE function
 * (testable in Node without pdfjs). The table starts after the section title (the column header is
 * split over 3 y lines). A split label takes its start from the PREVIOUS line and its possible end
 * from the NEXT one ('(PART I)'). The valuation date is the most frequent one; the total falls back
 * to the sum of lines when the TOTAL line was not read. Lines that look like data but are not
 * recognised count against the 50 % rule.
 */
export function parseNoticePages(pages: PdfLine[][]): NatixisNotice | { error: string; lowMatch: boolean } {
	const sitPage = pages.find((lines) => lines.some((l) => l.text.includes('Situation de vos avoirs')));
	if (!sitPage) return { error: 'Page « Situation de vos avoirs » introuvable', lowMatch: false };

	const holdings: FundHolding[] = [];
	let plan: 'PEI' | 'PERCOL' = 'PEI';
	let totalPei = 0;
	let totalPercol = 0;
	let total = 0;
	let inTable = false;
	let candidates = 0;

	for (let i = 0; i < sitPage.length; i++) {
		const line = sitPage[i]!;
		const text = line.text;
		if (text.includes('Par produit, par date de disponibilit')) {
			inTable = true;
			continue;
		}
		if (text.includes('Par année de disponibilit')) inTable = false;
		if (/^PEI - /.test(text)) {
			plan = 'PEI';
			continue;
		}
		if (/^PERCOL - /.test(text) || /^PER /.test(text)) {
			plan = 'PERCOL';
			continue;
		}
		const mPei = /^TOTAL PEI (\d{1,3}(?: \d{3})*,\d{2})/.exec(text);
		if (mPei) {
			totalPei = amountFr(mPei[1]!);
			continue;
		}
		const mPercol = /^TOTAL PERCOL (\d{1,3}(?: \d{3})*,\d{2})/.exec(text);
		if (mPercol) {
			totalPercol = amountFr(mPercol[1]!);
			continue;
		}
		const mTotal = TOTAL_RE.exec(text);
		if (mTotal) {
			total = amountFr(mTotal[1]!);
			continue;
		}
		if (!inTable) continue;

		const m = ROW_RE.exec(text);
		if (!m) {
			if (/(\d{2}\/\d{2}\/\d{4}|RETRAITE)/.test(text) && (text.match(/\d{2}\/\d{2}\/\d{4}/g) ?? []).length >= 2)
				candidates++;
			continue;
		}
		candidates++;
		let fundName = m[1] ?? '';
		if (!fundName) {
			const before = sitPage[i - 1]?.text ?? '';
			const after = sitPage[i + 1]?.text ?? '';
			fundName = /^\(/.test(after) ? `${before} ${after}` : before;
		}
		const fund = normalizeFund(fundName);
		if (!fund) continue;
		holdings.push({
			fund,
			availableAt: m[2] === 'RETRAITE' ? 'retraite' : dateFrToIso(m[2]!),
			shareValue: amountFr(m[3]!),
			shares: amountFr(m[4]!),
			amount: amountFr(m[5]!),
			valuedAt: dateFrToIso(m[6]!),
			plan
		});
	}

	const matched = holdings.length;
	if (candidates === 0 || matched / candidates < 0.5) {
		return {
			error: `Parsing trop incertain (${matched}/${candidates} lignes reconnues) — saisie manuelle proposée`,
			lowMatch: true
		};
	}

	const valuationCounts = new Map<string, number>();
	for (const h of holdings) valuationCounts.set(h.valuedAt, (valuationCounts.get(h.valuedAt) ?? 0) + 1);
	const valuedAt = [...valuationCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';

	if (!total) total = Math.round(holdings.reduce((s, h) => s + h.amount, 0) * 100) / 100;
	if (!totalPei) totalPei = Math.round(holdings.filter((h) => h.plan === 'PEI').reduce((s, h) => s + h.amount, 0) * 100) / 100;
	if (!totalPercol)
		totalPercol = Math.round(holdings.filter((h) => h.plan === 'PERCOL').reduce((s, h) => s + h.amount, 0) * 100) / 100;

	return {
		holdings,
		totalPei,
		totalPercol,
		total,
		availability: parseAvailability(sitPage, holdings),
		valuedAt,
		...parseLastPayment(pages),
		stats: { candidates, matched }
	};
}

/**
 * 'Par année de disponibilité' timeline: a line of years then a line of amounts (next line, or the
 * same one with tolerance). Fallback: timeline computed from the holdings (sum per availability year).
 */
function parseAvailability(sitPage: PdfLine[], holdings: FundHolding[]): AvailabilitySegment[] {
	const idx = sitPage.findIndex((l) => l.text.includes('Par année de disponibilit'));
	if (idx >= 0) {
		for (let i = idx + 1; i < Math.min(idx + 4, sitPage.length); i++) {
			const years = sitPage[i]!.text.split(' ').filter((t) => /^(20\d{2}|RETRAITE)$/.test(t));
			if (years.length === 0) continue;
			for (let j = i; j < Math.min(i + 3, sitPage.length); j++) {
				const amounts = [...sitPage[j]!.text.matchAll(/(\d{1,3}(?: \d{3})*,\d{2}) €/g)].map((m) => amountFr(m[1]!));
				if (amounts.length >= years.length) {
					return years.map((y, k) => ({
						label: y === 'RETRAITE' ? 'Retraite' : y,
						key: y === 'RETRAITE' ? 9999 : Number(y),
						amount: amounts[k]!
					}));
				}
			}
		}
	}
	const byYear = new Map<string, number>();
	for (const h of holdings) {
		const year = h.availableAt === 'retraite' ? 'Retraite' : h.availableAt.slice(0, 4);
		byYear.set(year, (byYear.get(year) ?? 0) + h.amount);
	}
	return [...byYear.entries()]
		.map(([label, amount]) => ({
			label,
			key: label === 'Retraite' ? 9999 : Number(label),
			amount: Math.round(amount * 100) / 100
		}))
		.sort((a, b) => a.key - b.key);
}

/**
 * Last payment (page 1): 'Versement dans votre …' block if present. Pass 1 reads the block metadata
 * (kind, levies, net total), whose order relative to the payment line is not guaranteed ('¤' on 2025
 * notices, whose font has no €); pass 2 reads the payment line itself.
 */
function parseLastPayment(pages: PdfLine[][]): { lastPayment?: NatixisPayment } {
	const page = pages.find((lines) => lines.some((l) => l.text.includes('Versement dans votre')));
	if (!page) return {};
	let kind = 'Versement';
	let socialLevy: number | undefined;
	let netAmount: number | undefined;
	for (const line of page) {
		const t = line.text;
		if (t === 'Abondement' || t === 'Versement initial' || t === 'Versement volontaire') kind = t;
		const mLevy = /Prélèvements sociaux à déduire\s*-\s*(\d{1,3}(?: \d{3})*,\d{2})/.exec(t);
		if (mLevy) socialLevy = amountFr(mLevy[1]!);
		const mNet = /^TOTAL (\d{1,3}(?: \d{3})*,\d{2}) [€¤]$/.exec(t);
		if (mNet) netAmount = amountFr(mNet[1]!);
	}
	for (const line of page) {
		const m = PAYMENT_RE.exec(line.text);
		if (m) {
			const fund = normalizeFund(m[1]!);
			if (!fund) continue;
			return {
				lastPayment: {
					kind,
					fund,
					amount: amountFr(m[2]!),
					...(socialLevy !== undefined ? { socialLevy } : {}),
					...(netAmount !== undefined ? { netAmount } : {}),
					valuedAt: dateFrToIso(m[3]!),
					availableAt: dateFrToIso(m[6]!)
				}
			};
		}
	}
	return {};
}

// ---------- 'Scheme performance' parser ----------

/**
 * Data line of the table: QS code + 7 percentages in fixed columns. Not anchored at the start of the
 * line: the code sometimes shares its line with the 'SRI : 3/7' label of the previous block (same
 * real y coordinate).
 */
const QS_RE = /\bQS(\d{10})\b/;

/**
 * Parses the performance table. PURE function.
 *
 * Mapping BY POSITION (documented in SPEC §F.1): the order of fund blocks in the document is the
 * order of the QS code lines, so the i-th QS code matches the i-th fund met (a fund label may be
 * split: '… (PART' + 'I)**'). The 'final performance' is the 6th column (order: gross A, fund fees B,
 * net A-B, plan fees C, total fees B+C, FINAL A-B-C, retrocessions).
 */
export function parseSchemePages(pages: PdfLine[][]): NatixisScheme | { error: string } {
	const fundOrder: string[] = [];
	const qsRows: number[][] = [];
	let year = 0;

	for (const lines of pages) {
		for (let i = 0; i < lines.length; i++) {
			const text = lines[i]!.text;
			const mYear = /dispositif (20\d{2})\*?/.exec(text);
			if (mYear) year = Number(mYear[1]);
			if (QS_RE.test(text)) {
				const pcts = [...text.matchAll(/(\d+,\d{2}) %/g)].map((m) => Number(m[1]!.replace(',', '.')));
				if (pcts.length >= 6) qsRows.push(pcts);
				continue;
			}
			let candidate = text;
			if (/\(PART\s*$/.test(candidate) && /^I\)\*?\*?$/.test(lines[i + 1]?.text ?? '')) {
				candidate = `${candidate} I)`;
			}
			const fund = normalizeFund(candidate);
			if (fund) fundOrder.push(fund);
		}
	}

	if (qsRows.length === 0 || fundOrder.length === 0) {
		return { error: 'Tableau des performances (codes QS…) introuvable' };
	}
	const perfs: Record<string, number> = {};
	const n = Math.min(fundOrder.length, qsRows.length);
	for (let i = 0; i < n; i++) {
		perfs[fundOrder[i]!] = qsRows[i]![5]!;
	}
	return { perfs, year };
}

// ---------- Orchestration ----------

/**
 * Parses a Natixis PDF (transaction notice OR scheme performance) and identifies its type. The
 * wrong kind of PDF gives an explicit error, and so does an unreadable file: never an exception.
 */
const MONTHS_FR: Record<string, string> = { janvier: '01', fevrier: '02', février: '02', mars: '03', avril: '04', mai: '05', juin: '06', juillet: '07', aout: '08', août: '08', septembre: '09', octobre: '10', novembre: '11', decembre: '12', décembre: '12' };

/** Fund line of the 'Mon épargne' statement: Fund <amount> EUR <units> <NAV> EUR. */
const SITUATION_ROW_RE = /^(.+?) (\d{1,3}(?: \d{3})*,\d{2}) EUR (\d{1,3}(?: \d{3})*,\d{4}) (\d+,\d{3,}) EUR$/;

/**
 * 'Mon épargne au JJ mois AAAA' statement (export from the online space): one line per fund and per
 * plan, amount + units + NAV of the day. No availability dates: the store takes them from the
 * previous notice (saveNatixisNotice), else 'unknown'. The total is the one Natixis shows (sum of the
 * per-plan totals it rounds), else the sum of lines.
 */
export function parseSituationPages(pages: PdfLine[][]): NatixisNotice | { error: string; lowMatch: boolean } {
	const lines = pages.flat();
	let valuedAt = '';
	for (const l of lines) {
		const m = /Mon épargne au (\d{2}) ([A-Za-zéû]+) (\d{4})/i.exec(l.text);
		if (m) {
			const mm = MONTHS_FR[m[2]!.toLowerCase()];
			if (mm) valuedAt = `${m[3]}-${mm}-${m[1]}`;
			break;
		}
	}
	if (!valuedAt) return { error: 'Date du relevé « Mon épargne au … » introuvable', lowMatch: false };
	const holdings: FundHolding[] = [];
	let plan: 'PEI' | 'PERCOL' = 'PEI';
	let totalPei = 0;
	let totalPercol = 0;
	let candidates = 0;
	for (const l of lines) {
		const t = l.text.trim();
		if (/^PEI\b/.test(t)) plan = 'PEI';
		if (/^PERCOL\b/.test(t)) plan = 'PERCOL';
		const mTotal = /Montant total : (\d{1,3}(?: \d{3})*,\d{2}) EUR/.exec(t);
		if (mTotal) {
			if (plan === 'PEI') totalPei = amountFr(mTotal[1]!);
			else totalPercol = amountFr(mTotal[1]!);
			continue;
		}
		const m = SITUATION_ROW_RE.exec(t);
		if (!m) continue;
		candidates++;
		const fund = normalizeFund(m[1]!);
		if (!fund) continue;
		holdings.push({ fund, availableAt: 'inconnue', shareValue: amountFr(m[4]!), shares: amountFr(m[3]!), amount: amountFr(m[2]!), valuedAt, plan });
	}
	if (candidates === 0 || holdings.length / candidates < 0.5) {
		return { error: `Relevé « Mon épargne » : ${holdings.length}/${candidates} lignes reconnues`, lowMatch: true };
	}
	const sumHoldings = Math.round(holdings.reduce((sum, h) => sum + h.amount, 0) * 100) / 100;
	const total = totalPei && totalPercol ? Math.round((totalPei + totalPercol) * 100) / 100 : sumHoldings;
	return {
		holdings,
		totalPei: totalPei || Math.round(holdings.filter((h) => h.plan === 'PEI').reduce((s2, h) => s2 + h.amount, 0) * 100) / 100,
		totalPercol: totalPercol || Math.round(holdings.filter((h) => h.plan === 'PERCOL').reduce((s2, h) => s2 + h.amount, 0) * 100) / 100,
		total,
		availability: [],
		valuedAt,
		stats: { candidates, matched: holdings.length }
	};
}

/**
 * Natixis document recognised from its text: 'Mon épargne' statement, transaction notice ('Situation
 * de vos avoirs') or performance table; null otherwise. Used by parseNatixisPdf to dispatch, and by
 * the import panel.
 */
export function natixisPdfKind(pages: PdfLine[][]): 'situation' | 'avis' | 'scheme' | null {
	const allText = pages.map((lines) => lines.map((l) => l.text).join('\n')).join('\n');
	if (/Mon épargne au \d{2} /i.test(allText) && allText.includes('Mon épargne par produit et par fonds')) return 'situation';
	if (allText.includes('Situation de vos avoirs')) return 'avis';
	if (QS_RE.test(allText) || allText.includes('Tableau des performances')) return 'scheme';
	return null;
}

export async function parseNatixisPdf(buffer: ArrayBuffer): Promise<NatixisPdfResult> {
	let pages: PdfLine[][];
	try {
		pages = await extractPdfPages(buffer);
	} catch {
		return {
			kind: 'error',
			reason: 'unknown',
			message: 'Lecture du PDF impossible (fichier illisible ou protégé).'
		};
	}
	const kind = natixisPdfKind(pages);

	if (kind === 'situation') {
		const sit = parseSituationPages(pages);
		if ('error' in sit) return { kind: 'error', reason: sit.lowMatch ? 'low-match' : 'unknown', message: sit.error };
		return { kind: 'avis', avis: sit };
	}
	if (kind === 'avis') {
		const notice = parseNoticePages(pages);
		if ('error' in notice) {
			return { kind: 'error', reason: notice.lowMatch ? 'low-match' : 'unknown', message: notice.error };
		}
		return { kind: 'avis', avis: notice };
	}
	if (kind === 'scheme') {
		const scheme = parseSchemePages(pages);
		if ('error' in scheme) return { kind: 'error', reason: 'unknown', message: scheme.error };
		return { kind: 'scheme', scheme };
	}
	return {
		kind: 'error',
		reason: 'unknown',
		message: 'PDF non reconnu : ni avis d’opération, ni relevé « Mon épargne », ni tableau des performances Natixis'
	};
}
