/**
 * Minimal home-made XLSX parser (~200 lines):
 * zip → workbook → rels → sharedStrings → sheets as string matrices.
 *
 * Choice: light regex extraction rather than DOMParser, namespace-agnostic by construction and
 * usable outside the browser (Node tests). The target XML is the very regular one of OOXML
 * workbooks (SpreadsheetML). NO conversion here: dates stay as Excel serials and amounts as
 * dot-decimal numbers; that is the mapper's job (importMapper).
 */

export interface XlsxSheet {
	name: string;
	/** Dense string matrix: rows[rowIndex][colIndex], empty cells = ''. */
	rows: string[][];
}

/** Decodes the usual XML entities (&amp; &lt; &gt; &quot; &#39; &#x2F;…). */
function unescapeXml(s: string): string {
	return s
		.replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
		.replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(parseInt(d, 10)))
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&amp;/g, '&');
}

/** Attribute of an XML tag (null if absent). Accepts single/double quotes. */
function attr(tag: string, name: string): string | null {
	const m = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(tag);
	return m ? unescapeXml(m[1]!) : null;
}

/** Cell reference 'B12' → 0-based column index (A=0). */
function colIndex(ref: string): number {
	const m = /^([A-Za-z]+)/.exec(ref);
	if (!m) return -1;
	let idx = 0;
	for (const ch of m[1]!.toUpperCase()) idx = idx * 26 + (ch.charCodeAt(0) - 64);
	return idx - 1;
}

/** sharedStrings.xml: index → string (all the <t> of each <si>, rich text OK). */
function parseSharedStrings(xml: string): string[] {
	const out: string[] = [];
	const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
	let m: RegExpExecArray | null;
	while ((m = siRe.exec(xml))) {
		const body = m[1]!;
		let text = '';
		const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
		let t: RegExpExecArray | null;
		while ((t = tRe.exec(body))) text += unescapeXml(t[1]!);
		out.push(text);
	}
	return out;
}

/** Target path of a relationship, normalised under 'xl/…'. */
function resolveTarget(target: string): string {
	const clean = target.replace(/^\/+/, '');
	return clean.startsWith('xl/') ? clean : `xl/${clean}`;
}

/**
 * One sheet: dense matrix, empty rows/columns = ''. Row index from the r attribute when present,
 * else the next free row; shared strings come from <v>index</v>, inline strings from <is><t>…</t></is>,
 * other types (t="str", t="b", number, formula without cache) keep the raw <v>.
 */
function parseWorksheet(xml: string, shared: string[]): string[][] {
	const rows: string[][] = [];
	const rowRe = /<row\b([^>]*)>([\s\S]*?)<\/row>|<row\b([^>]*)\/>/g;
	let rm: RegExpExecArray | null;
	while ((rm = rowRe.exec(xml))) {
		const rAttr = rm[1] !== undefined ? attr(rm[1], 'r') : null;
		const rowIdx = rAttr !== null ? parseInt(rAttr, 10) - 1 : rows.length;
		if (!Number.isFinite(rowIdx) || rowIdx < 0) continue;
		const body = rm[2] ?? '';
		while (rows.length <= rowIdx) rows.push([]);
		const row = rows[rowIdx]!;
		const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
		let cm: RegExpExecArray | null;
		while ((cm = cellRe.exec(body))) {
			const head = cm[1]!;
			const cellBody = cm[2] ?? '';
			const ref = attr(head, 'r');
			const cIdx = ref !== null ? colIndex(ref) : row.length;
			if (cIdx < 0) continue;
			const type = attr(head, 't');
			let value = '';
			if (type === 's') {
				const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(cellBody)?.[1] ?? '';
				value = shared[parseInt(v, 10)] ?? '';
			} else if (type === 'inlineStr') {
				const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
				let t: RegExpExecArray | null;
				while ((t = tRe.exec(cellBody))) value += unescapeXml(t[1]!);
			} else {
				value = unescapeXml(/<v\b[^>]*>([\s\S]*?)<\/v>/.exec(cellBody)?.[1] ?? '');
			}
			while (row.length <= cIdx) row.push('');
			row[cIdx] = value;
		}
	}
	return rows;
}

interface SheetRef {
	name: string;
	target: string;
	hidden: boolean;
}

/**
 * Parses an XLSX workbook: visible sheets only (hidden and veryHidden excluded), in workbook order.
 * fflate is a dynamic import only (lazy chunk, ~8 kB gzip); relationships map Id → target
 * (worksheets only); shared strings are optional.
 */
export async function parseXlsx(buffer: ArrayBuffer): Promise<XlsxSheet[]> {
	const { unzipSync } = await import('fflate');

	let files: Record<string, Uint8Array>;
	try {
		files = unzipSync(new Uint8Array(buffer));
	} catch {
		throw new Error('XLSX illisible');
	}

	const text = (path: string): string | null => {
		const data = files[path];
		return data ? new TextDecoder('utf-8').decode(data) : null;
	};

	const workbook = text('xl/workbook.xml');
	const rels = text('xl/_rels/workbook.xml.rels');
	if (workbook === null || rels === null) throw new Error('XLSX illisible');

	const targets = new Map<string, string>();
	const relRe = /<Relationship\b([^>]*?)(?:\/>|>[\s\S]*?<\/Relationship>)/g;
	let rel: RegExpExecArray | null;
	while ((rel = relRe.exec(rels))) {
		const head = rel[1]!;
		const type = attr(head, 'Type') ?? '';
		if (!type.endsWith('/worksheet')) continue;
		const id = attr(head, 'Id');
		const target = attr(head, 'Target');
		if (id !== null && target !== null) targets.set(id, resolveTarget(target));
	}

	const sheets: SheetRef[] = [];
	const sheetRe = /<sheet\b([^>]*?)(?:\/>|>[\s\S]*?<\/sheet>)/g;
	let sm: RegExpExecArray | null;
	while ((sm = sheetRe.exec(workbook))) {
		const head = sm[1]!;
		const state = attr(head, 'state');
		if (state === 'hidden' || state === 'veryHidden') continue;
		const name = attr(head, 'name');
		const rid = attr(head, 'r:id') ?? attr(head, 'id');
		if (name === null || rid === null) continue;
		const target = targets.get(rid);
		if (target) sheets.push({ name, target, hidden: false });
	}
	if (sheets.length === 0) throw new Error('XLSX illisible');

	const ss = text('xl/sharedStrings.xml');
	const shared = ss !== null ? parseSharedStrings(ss) : [];

	try {
		return sheets.map((s) => {
			const xml = text(s.target);
			if (xml === null) return { name: s.name, rows: [] };
			return { name: s.name, rows: parseWorksheet(xml, shared) };
		});
	} catch {
		throw new Error('XLSX illisible');
	}
}
