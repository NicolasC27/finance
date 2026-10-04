/**
 * Tolerant tag tree (pure module, no DOMParser: testable under Node) for OFX
 * 1.x statements (SGML: data tags are never closed), OFX 2.x and CAMT (XML).
 * Logic inspired by ezBookkeeping (MIT, pkg/converters/sgml):
 * - a tag followed by text is DATA (a leaf): the text closes it, and its
 *   optional end tag (XML) is absorbed;
 * - a tag followed by another tag is an AGGREGATE, closed by its end tag — or
 *   implicitly by a parent's (SGML);
 * - an empty SGML data tag ("<MEMO>" followed by a tag) closes itself when its
 *   name is in `leaves`, instead of swallowing its siblings.
 * Namespace prefixes are dropped ("ns2:Ntry" → "Ntry"); comments, processing
 * instructions (<?xml …?>, <?OFX …?>) and DOCTYPE are ignored.
 */

export interface MarkupNode {
	/** Local tag name (prefix removed; upper-cased when `upperCase`). */
	name: string;
	/** Text of a leaf ('' for an aggregate or empty data). */
	text: string;
	attrs: Record<string, string>;
	children: MarkupNode[];
}

export interface MarkupOptions {
	/** Data tags whose end tag is optional (OFX SGML). */
	leaves?: ReadonlySet<string>;
	/** Upper-cased names (OFX: SGML is case-insensitive). */
	upperCase?: boolean;
}

/** Common and numeric XML entities; a lone "&" (SGML "M&S") is kept as is. */
export function decodeEntities(s: string): string {
	return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos|nbsp);/g, (_, e: string) => {
		if (e[0] === '#') {
			const code = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
			return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
		}
		return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }[e as 'amp'] ?? '';
	});
}

/**
 * Tokens: comment | CDATA (1) | instruction/DOCTYPE | tag (2 = "/",
 * 3 = name, 4 = attributes, 5 = self-closing "/") | text (6) | lone "<".
 */
const TOKEN_RE =
	/<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<[?!][^>]*>|<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)|</g;
const ATTR_RE = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

function localName(raw: string, upper: boolean): string {
	const i = raw.lastIndexOf(':');
	const name = i === -1 ? raw : raw.slice(i + 1);
	return upper ? name.toUpperCase() : name;
}

function parseAttrs(raw: string): Record<string, string> {
	const attrs: Record<string, string> = {};
	ATTR_RE.lastIndex = 0;
	let m: RegExpExecArray | null;
	while ((m = ATTR_RE.exec(raw))) attrs[localName(m[1]!, false)] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
	return attrs;
}

/**
 * Builds the tree (root "#root"); never throws: a truncated file gives a partial tree.
 * Text right after an opening tag makes it a data leaf, closed at once (its
 * optional XML end tag is then absorbed). Comments, instructions, DOCTYPE and
 * lone "<" are ignored. An end tag climbs up to the open tag of the same name;
 * an orphan end tag is ignored. An empty SGML data tag closes itself.
 */
export function parseMarkup(source: string, options: MarkupOptions = {}): MarkupNode {
	const upper = options.upperCase === true;
	const root: MarkupNode = { name: '#root', text: '', attrs: {}, children: [] };
	const stack: MarkupNode[] = [root];
	let closedLeaf: string | null = null;
	const top = () => stack[stack.length - 1]!;
	const isOpenEmpty = (n: MarkupNode) => n !== root && n.text === '' && n.children.length === 0;

	TOKEN_RE.lastIndex = 0;
	let m: RegExpExecArray | null;
	while ((m = TOKEN_RE.exec(source))) {
		const [token, cdata, slash, rawName, rawAttrs, selfClose, text] = m;
		if (text !== undefined || cdata !== undefined) {
			const value = cdata !== undefined ? cdata.trim() : decodeEntities(text!).trim();
			if (!value) continue;
			const node = top();
			if (isOpenEmpty(node)) {
				node.text = value.replace(/\s+/g, ' ');
				stack.pop();
				closedLeaf = node.name;
			}
			continue;
		}
		if (rawName === undefined) {
			if (token !== '<') closedLeaf = null;
			continue;
		}
		const name = localName(rawName, upper);
		if (slash === '/') {
			if (closedLeaf === name) {
				closedLeaf = null;
				continue;
			}
			closedLeaf = null;
			for (let i = stack.length - 1; i > 0; i--) {
				if (stack[i]!.name === name) {
					stack.length = i;
					break;
				}
			}
			continue;
		}
		closedLeaf = null;
		const current = top();
		if (options.leaves?.has(current.name) && isOpenEmpty(current)) stack.pop();
		const node: MarkupNode = { name, text: '', attrs: rawAttrs ? parseAttrs(rawAttrs) : {}, children: [] };
		top().children.push(node);
		if (selfClose !== '/') stack.push(node);
	}
	return root;
}

/** First direct child with this name. */
export function child(node: MarkupNode | undefined, name: string): MarkupNode | undefined {
	return node?.children.find((c) => c.name === name);
}

/** Direct children with this name. */
export function childrenNamed(node: MarkupNode | undefined, name: string): MarkupNode[] {
	return node ? node.children.filter((c) => c.name === name) : [];
}

/** All descendants with this name (document order), without descending into a found node. */
export function findAll(node: MarkupNode | undefined, name: string): MarkupNode[] {
	const out: MarkupNode[] = [];
	const walk = (n: MarkupNode) => {
		for (const c of n.children) {
			if (c.name === name) out.push(c);
			else walk(c);
		}
	};
	if (node) walk(node);
	return out;
}

/**
 * Text at path "A>B>C" under `node` ('' if missing). Each step looks for a
 * direct child, then — fallback for badly nested SGML files — a descendant
 * outside the `skip` aggregates.
 */
export function textAt(node: MarkupNode | undefined, path: string, skip: ReadonlySet<string> = new Set()): string {
	let current = node;
	for (const step of path.split('>')) {
		if (!current) return '';
		current = child(current, step) ?? findOutside(current, step, skip);
	}
	return current?.text ?? '';
}

function findOutside(node: MarkupNode, name: string, skip: ReadonlySet<string>): MarkupNode | undefined {
	for (const c of node.children) {
		if (c.name === name) return c;
		if (skip.has(c.name)) continue;
		const found = findOutside(c, name, skip);
		if (found) return found;
	}
	return undefined;
}
