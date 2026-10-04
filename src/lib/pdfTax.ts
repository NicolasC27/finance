import { extractPdfPages, type PdfLine } from './pdfNatixis';

/**
 * Income tax notice (impots.gouv, PDF) → key figures of the year: net income tax, net social
 * levies, reference taxable income, base taxed at the flat rate (crypto gains…), amount still
 * due and its due date (both on the lines after 'Somme qu'il vous reste à payer', the amount
 * after the date). Pure module apart from the pdfjs extraction.
 */

export interface TaxNotice {
	/** Income year ('Impôt sur les revenus de 2024' → 2024). */
	year: number;
	/** Year the notice was issued (payment), if read. */
	issuedYear?: number;
	/** Additional / corrective notice (completes an initial notice). */
	supplementary: boolean;
	incomeTax: number;
	socialLevies: number;
	/** incomeTax + socialLevies. */
	total: number;
	rfr?: number;
	/** 'Revenus au taux forfaitaire' base (12.8 %): crypto gains and the like. */
	flatTaxBase?: number;
	salaries?: number;
	/** 'Somme qu'il vous reste à payer' and due date. */
	remaining?: number;
	remainingDueDate?: string;
	importedAt: number;
}

/** '12 345,00 €' / '6789' → number. */
function num(raw: string): number {
	const s = raw.replace(/[\s  €]/g, '').replace(',', '.');
	const n = Number(s);
	return Number.isFinite(n) ? n : 0;
}

/** First capture of a pattern over all lines. */
function find(lines: PdfLine[], re: RegExp): RegExpExecArray | null {
	for (const l of lines) {
		const m = re.exec(l.text);
		if (m) return m;
	}
	return null;
}

export function parseTaxNoticeLines(pages: PdfLine[][]): TaxNotice | { error: string } {
	const lines = pages.flat();
	const yearM = find(lines, /sur les revenus (?:et prélèvements sociaux )?(?:de |)(\d{4})/i) ?? find(lines, /revenus de (\d{4})/i);
	if (!yearM) return { error: 'Année des revenus introuvable (« Impôt sur les revenus de AAAA » attendu)' };
	const year = Number(yearM[1]);
	const issued = find(lines, /Avis d'impôt établi en (\d{4})/i);
	const supplementary = lines.some((l) => /AVIS_IR_RS|Avis supplémentaire|avis rectificatif/i.test(l.text));
	const amount = (re: RegExp): number | undefined => {
		const m = find(lines, re);
		return m ? num(m[1]!) : undefined;
	};
	const incomeTax = amount(/Total de l'impôt sur le revenu net\D*?(-?\d[\d  ]*(?:,\d{2})?)\s*$/i) ?? amount(/Montant net de votre imposition\D*?(-?\d[\d  ]*)\s*$/i) ?? 0;
	const socialLevies = amount(/Total des prélèvements sociaux nets\D*?(-?\d[\d  ]*)\s*$/i) ?? 0;
	const rfr = amount(/Revenu fiscal de référence\D*?(\d[\d  ]*)\s*$/i);
	const flatTaxBase = amount(/Revenus au taux forfaitaire.*?Montant\D*?(\d[\d  ]*)\s*$/i);
	const salaries = amount(/^Salaires\.*\s*(\d[\d  ]*)\s*$/i);
	let remaining: number | undefined;
	let remainingDueDate: string | undefined;
	const idx = lines.findIndex((l) => /Somme qu'il vous reste à payer/i.test(l.text));
	if (idx !== -1) {
		const window = lines.slice(idx, idx + 8).map((l) => l.text).join(' ');
		const dates = [...window.matchAll(/(\d{2})\/(\d{2})\/(\d{4})/g)].map((d) => `${d[3]}-${d[2]}-${d[1]}`);
		const lastDateEnd = (() => { let end = 0; for (const m of window.matchAll(/\d{2}\/\d{2}\/\d{4}/g)) end = (m.index ?? 0) + m[0].length; return end; })();
		const after = window.slice(lastDateEnd);
		const ma = /(\d{1,3}(?:[ \u00a0]\d{3})*,\d{2}) ?€/.exec(after) ?? /\b(\d+) ?€/.exec(after);
		if (ma) remaining = num(ma[1]!);
		if (dates.length > 0) remainingDueDate = dates[dates.length - 1];
	}
	if (incomeTax === 0 && socialLevies === 0 && rfr === undefined) return { error: 'Aucun montant reconnu : est-ce bien un avis d’impôt sur le revenu ?' };
	return {
		year,
		...(issued ? { issuedYear: Number(issued[1]) } : {}),
		supplementary,
		incomeTax,
		socialLevies,
		total: Math.round((incomeTax + socialLevies) * 100) / 100,
		...(rfr !== undefined ? { rfr } : {}),
		...(flatTaxBase !== undefined ? { flatTaxBase } : {}),
		...(salaries !== undefined ? { salaries } : {}),
		...(remaining !== undefined ? { remaining } : {}),
		...(remainingDueDate ? { remainingDueDate } : {}),
		importedAt: Date.now()
	};
}

export async function parseTaxNoticePdf(buffer: ArrayBuffer): Promise<TaxNotice | { error: string }> {
	let pages: PdfLine[][];
	try {
		pages = await extractPdfPages(buffer);
	} catch {
		return { error: 'Lecture du PDF impossible (fichier illisible ou protégé).' };
	}
	return parseTaxNoticeLines(pages);
}

/** Does the header look like a tax notice? (dispatch of dropped PDFs) */
export function looksLikeTaxNotice(pages: PdfLine[][]): boolean {
	const head = pages[0]?.map((l) => l.text).join('\n') ?? '';
	return /AVIS_IR|Impôt sur les revenus de \d{4}|DIRECTION G[ÉE]N[ÉE]RALE DES FINANCES PUBLIQUES/i.test(head);
}
