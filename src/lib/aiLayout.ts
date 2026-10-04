import { isLeaf, leafIds, type TileNode } from './tiles';

/**
 * « ✨ Organiser par l'IA » (pure module, testable with tsx): the request sent to the local relay
 * (POST /disposition) and the checks run on the tree Claude sends back.
 *
 * Only layout metadata leaves the app: block ids, titles and element labels (static UI text, with
 * anything that looks like an amount or a long number removed), coarse hints (« graphique »,
 * « tableau », « alerte »…), tile and content sizes in px and the current tree. No amount, label of
 * an operation or account ever goes to Claude.
 */

export interface LayoutBlock {
	id: string;
	titre: string;
	elements: string[];
	indices: string[];
	/** Current tile size in px (absent for a block that is not on screen). */
	taille?: { w: number; h: number };
	/** Natural content height in px, measured by the block. */
	hauteurNaturelle?: number;
}

export interface LayoutRequest {
	page: string;
	canevas: { w: number; h: number };
	/** One column on narrow screens: only the order of the tree matters there. */
	etroit: boolean;
	blocs: LayoutBlock[];
	ranges: { id: string; titre: string }[];
	arbre: TileNode | null;
	consigne?: string;
}

/** What the page tells about one of its blocks. */
export interface AiBlockMeta {
	title: string;
	elements: readonly { id: string; label: string }[];
}

export const MAX_INSTRUCTION = 300;
const MAX_TEXT = 80;
const MAX_ELEMENTS = 12;
export const MAX_BLOCKS = 30;
const RATIO_MIN = 0.1;
const RATIO_MAX = 0.9;
const MAX_DEPTH = 40;

/** Canvas used to describe a page shown in one column (narrow screen): only the order counts. */
const NARROW_CANVAS = { w: 1100, h: 900 } as const;

const AMOUNT_RE = /[-+−]?\d[\d\s  .,]*\s?(?:€|eur\b|euros?\b|\$|usd\b)/giu;
const LONG_NUMBER_RE = /\d[\d\s  .,]{2,}\d/gu;

/**
 * UI text made safe to send: one line, amounts and numbers of 4 digits or more removed (years and
 * plain figures such as « Objectif 2500 » included; a count such as « Alertes (2) » stays), length
 * capped.
 */
export function safeText(raw: string, max = MAX_TEXT): string {
	return raw.replace(/[\r\n\t]+/g, ' ').replace(AMOUNT_RE, '…').replace(LONG_NUMBER_RE, '…').replace(/\s{2,}/g, ' ').trim().slice(0, max);
}

const HINTS: [string, RegExp][] = [
	['graphique', /courbe|graphique|donut|diagramme|évolution|répartition|camembert|barres|sankey|allocation|projection|tendance/i],
	['tableau', /tableau|colonnes?|liste|positions|opérations|transactions|relevés|mois par mois|détail par/i],
	['alerte', /alerte|attention|avertissement/i],
	['chiffres clés', /indicateurs|chiffres|totaux|résumé|vue d'ensemble|valeur totale/i],
	['notes', /notes?|bloc-notes|mémo/i]
];

/** Coarse, non-sensitive hints about a block from its title and element labels. */
export function blockHints(title: string, elements: readonly string[], naturalHeight?: number): string[] {
	const text = [title, ...elements].join(' · ');
	const out = HINTS.filter(([, re]) => re.test(text)).map(([name]) => name);
	if (naturalHeight !== undefined && naturalHeight < 130) out.push('peu de contenu');
	return out;
}

/**
 * Request for one page from what its canvas shows and what its blocks registered. Blocks without
 * metadata are described by their id only; the instruction is trimmed and made safe like the titles.
 */
export function buildLayoutRequest(
	page: string,
	screen: { tree: TileNode | null; size: { w: number; h: number }; visible: readonly string[]; stored: readonly string[] },
	meta: Readonly<Record<string, AiBlockMeta>>,
	naturalHeights: Readonly<Record<string, number>>,
	sizes: ReadonlyMap<string, { w: number; h: number }>,
	instruction = ''
): LayoutRequest {
	const narrow = screen.size.w <= 0 || screen.size.h <= 0;
	const blocks = screen.visible.slice(0, MAX_BLOCKS).map((id): LayoutBlock => {
		const m = meta[id];
		const title = safeText(m?.title || id);
		const elements = (m?.elements ?? []).slice(0, MAX_ELEMENTS).map((e) => safeText(e.label, 60));
		const height = naturalHeights[id];
		const size = sizes.get(id);
		return {
			id,
			titre: title,
			elements,
			indices: blockHints(title, elements, height),
			...(size && !narrow ? { taille: { w: Math.round(size.w), h: Math.round(size.h) } } : {}),
			...(height !== undefined ? { hauteurNaturelle: Math.round(height) } : {})
		};
	});
	const safeInstruction = safeText(instruction, MAX_INSTRUCTION);
	return {
		page,
		canevas: narrow ? { ...NARROW_CANVAS } : { w: Math.round(screen.size.w), h: Math.round(screen.size.h) },
		etroit: narrow,
		blocs: blocks,
		ranges: screen.stored.slice(0, MAX_BLOCKS).map((id) => ({ id, titre: safeText(meta[id]?.title || id) })),
		arbre: screen.tree,
		...(safeInstruction ? { consigne: safeInstruction } : {})
	};
}

export type ValidationResult = { arbre: TileNode } | { erreur: string };

/**
 * Checks a tree proposed by the AI against the blocks on screen: leaves are exactly the visible ids
 * (each once, none unknown, none missing), splits have a valid direction and a ratio, clamped to
 * 0.1–0.9. Anything else is refused with a message the user can read; the page then keeps its tiles.
 */
export function validateAiTree(raw: unknown, visibleIds: readonly string[], titles: Readonly<Record<string, string>> = {}): ValidationResult {
	const blockName = (id: string) => `« ${titles[id] || id} »`;
	const readNode = (n: unknown, depth: number): TileNode | string => {
		if (depth > MAX_DEPTH) return 'arbre trop profond';
		if (!n || typeof n !== 'object' || Array.isArray(n)) return 'nœud invalide';
		const o = n as Record<string, unknown>;
		if (typeof o.id === 'string') return { id: o.id };
		if (o.dir !== 'row' && o.dir !== 'col') return 'direction de coupe invalide';
		const ratio = typeof o.ratio === 'number' && Number.isFinite(o.ratio) ? Math.min(RATIO_MAX, Math.max(RATIO_MIN, o.ratio)) : null;
		if (ratio === null) return 'proportion de coupe invalide';
		const a = readNode(o.a, depth + 1);
		if (typeof a === 'string') return a;
		const b = readNode(o.b, depth + 1);
		if (typeof b === 'string') return b;
		return { dir: o.dir, ratio, a, b };
	};
	const tree = readNode(raw, 0);
	if (typeof tree === 'string') return { erreur: `La proposition de l'IA est illisible (${tree}) : rien n'a changé.` };
	const ids = leafIds(tree);
	const expected = new Set(visibleIds);
	const seen = new Set<string>();
	for (const id of ids) {
		if (!expected.has(id)) return { erreur: `La proposition de l'IA contient un bloc inconnu (${blockName(id)}) : rien n'a changé.` };
		if (seen.has(id)) return { erreur: `La proposition de l'IA place deux fois le bloc ${blockName(id)} : rien n'a changé.` };
		seen.add(id);
	}
	const missing = visibleIds.filter((id) => !seen.has(id));
	if (missing.length) return { erreur: `La proposition de l'IA oublie ${missing.length > 1 ? 'les blocs' : 'le bloc'} ${missing.map(blockName).join(', ')} : rien n'a changé.` };
	if (isLeaf(tree) && visibleIds.length !== 1) return { erreur: "La proposition de l'IA est incomplète : rien n'a changé." };
	return { arbre: tree };
}

export interface LayoutAnswer {
	arbre: unknown;
	explication: string;
}

/**
 * Reads the relay answer `{ arbre, explication }`; the answer may also be the raw text of Claude
 * (JSON alone, or inside a ```json fence).
 */
export function readLayoutAnswer(body: unknown): LayoutAnswer | { erreur: string } {
	let o: unknown = body;
	if (typeof o === 'string') {
		const candidate = firstJsonObject(o);
		o = candidate === null ? null : parseLenientJson(candidate);
	}
	if (!o || typeof o !== 'object' || !('arbre' in o)) return { erreur: "Réponse de l'IA illisible : rien n'a changé." };
	const r = o as { arbre: unknown; explication?: unknown };
	const explanation = typeof r.explication === 'string' ? safeText(r.explication, 160) : '';
	return { arbre: r.arbre, explication: explanation };
}

/**
 * First complete JSON object of a text: braces are counted outside strings, so a sentence or a
 * second object after it (or a ```json fence around it) does not break the reading.
 */
export function firstJsonObject(text: string): string | null {
	const start = text.indexOf('{');
	if (start < 0) return null;
	let depth = 0;
	let inString = false;
	let escaped = false;
	for (let i = start; i < text.length; i++) {
		const c = text[i];
		if (inString) {
			if (escaped) escaped = false;
			else if (c === '\\') escaped = true;
			else if (c === '"') inString = false;
		} else if (c === '"') inString = true;
		else if (c === '{') depth++;
		else if (c === '}' && --depth === 0) return text.slice(start, i + 1);
	}
	return null;
}

/** JSON.parse that also accepts trailing commas (a frequent slip of the model); null when unreadable. */
export function parseLenientJson(text: string): unknown {
	for (const candidate of [text, text.replace(/,(\s*[}\]])/g, '$1')]) {
		try {
			return JSON.parse(candidate);
		} catch {
			continue;
		}
	}
	return null;
}

/** Tracker of the latest request: a newer request or a cancel makes every earlier ticket stale. */
export interface RequestTracker {
	/** Starts a request and returns its ticket. */
	demarrer(): number;
	/** Cancels the request in progress (its answer must be dropped). */
	annuler(): void;
	/** The ticket is still the latest one, not cancelled. */
	estCourant(ticket: number): boolean;
}

/** New tracker: only the latest ticket is current, so a late answer is never applied twice. */
export function createRequestTracker(): RequestTracker {
	let current = 0;
	return {
		demarrer: () => ++current,
		annuler: () => void ++current,
		estCourant: (ticket) => ticket === current
	};
}
