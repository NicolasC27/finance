import type { CategoryId, Transaction } from './types';
import { isComputedEntry, signedAmount } from './data';
import { flowKind } from './flow';
import { getCategory } from './categories';
import { getSubcategory } from './subDict';
import { merchantKey, merchantLabel } from './merchant';
import { formatEUR, formatEURCompact, truncateLabel } from './format';
import { isBudgetFlow, monthTotals, type CatOf } from './totals';

/**
 * 'Where the money goes' Sankey chart (Rapport page, Flux du mois): pure module with no rendering
 * dependency. It builds the nodes from the month's operations, then lays them out (positions,
 * Bézier ribbons).
 *
 * Three columns: income sources → 'Entrées' → spending groups. Same conventions as totals.ts
 * (single source of the Rapport KPIs): signed income, spending net of refunds, savings and
 * transfers out of the flows. Amounts are summed in cents, so the left and right columns have
 * exactly the same sum.
 *
 * Special cases (negative flows cannot be drawn):
 * - a category refunded more than spent (credit note, returned item) → left input 'Santé
 *   (remboursé)';
 * - negative net income (cheque reversed the next month, advanced expenses repaid in the
 *   salary) → output 'Déduit des revenus';
 * - spending > income → input 'Puisé dans l'épargne', otherwise the rest goes to 'Épargne nette'
 *   (= the Rapport's net savings KPI).
 */

export type SankeyKind = 'source' | 'refund' | 'draw' | 'category' | 'others' | 'reversal' | 'savings';

/** Detail line of a node (tooltip): subcategory, merchant, grouped item. */
export interface SankeyDetail {
	label: string;
	value: number;
}

export interface SankeyNode {
	id: string;
	label: string;
	/** Amount in euros, strictly positive. */
	value: number;
	/** SVG colour (category hex or CSS token `var(--…)`). */
	color: string;
	kind: SankeyKind;
	side: 'left' | 'right';
	/** Transactions filter on click (absent: node not clickable). */
	categoryId?: CategoryId;
	subId?: string;
	/** Number of aggregated operations (0 for computed nodes). */
	count: number;
	/** Tooltip detail, sorted by decreasing amount (at most 3 shown). */
	details: SankeyDetail[];
}

export interface SankeyFlows {
	monthKey: string;
	/** Rapport KPIs (monthTotals), for labels and percentages. */
	income: number;
	expenses: number;
	net: number;
	left: SankeyNode[];
	right: SankeyNode[];
	/** Value of the central node: Σ left = Σ right. */
	total: number;
}

/** Subcategory of an operation (subcategorize injected: the module stays testable without state). */
export type SubOf = (tx: Transaction) => string | null;

export interface SankeyOptions {
	/** Maximum number of income source nodes, 'Autres revenus' included (default 5). */
	maxSources?: number;
	/** Maximum number of spending nodes, 'Autres postes' included (default 9). */
	maxCategories?: number;
	/** Minimum share (of income / of spending) for a node of its own. */
	minShare?: number;
}

/** Colours of computed nodes: theme tokens (never red). */
export const SANKEY_COLORS = {
	income: 'var(--accent)',
	center: 'var(--text-2)',
	others: 'var(--text-3)',
	savings: 'var(--accent)',
	draw: 'var(--amber)',
	reversal: 'var(--debit)'
} as const;

const toEuros = (cents: number) => cents / 100;

/**
 * Display name of an operation: the merchant (like Analyse › Par commerçant), except for the
 * computed entries of the Portage tab and of the cash wallet whose label is already written
 * ('Chèques culture · septembre' → 'Chèques culture', 'Liquide : marché').
 */
function displayName(tx: Transaction): string {
	if (isComputedEntry(tx)) {
		const raw = tx.remittance_information.join(' ').trim();
		const head = raw.split(' · ')[0]!.replace(/\s*\([^)]*\)\s*$/, '').trim();
		if (head) return head;
	}
	return merchantLabel(tx.remittance_information) || 'Opération sans libellé';
}

/**
 * Detail sorted by absolute amount (cents → euros), zero values removed. Negative amounts stay:
 * they explain a net value (salary minus the advanced expenses it repays, refunded subcategory…).
 */
function topDetails(parts: Map<string, number>): SankeyDetail[] {
	return [...parts.entries()]
		.filter(([, c]) => c !== 0)
		.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
		.map(([label, c]) => ({ label, value: toEuros(c) }));
}

/**
 * Splits the displayed items from the grouped ones: under `minCents` or beyond `max` nodes (the
 * group then counts as a node). A group of a single item teaches nothing: the item keeps its name
 * if there is room left.
 */
function bucketize<T extends { cents: number }>(items: T[], max: number, minCents: number): { kept: T[]; grouped: T[] } {
	const sorted = [...items].sort((a, b) => b.cents - a.cents);
	let kept = sorted.filter((it) => it.cents >= minCents);
	let grouped = sorted.filter((it) => it.cents < minCents);
	if (kept.length > max || (grouped.length > 0 && kept.length >= max)) {
		grouped = [...kept.slice(max - 1), ...grouped];
		kept = kept.slice(0, max - 1);
	}
	if (grouped.length === 1 && kept.length < max) {
		kept = [...kept, grouped[0]!];
		grouped = [];
	}
	return { kept, grouped };
}

interface SourceGroup {
	key: string;
	label: string;
	subId?: string;
	cents: number;
	count: number;
	/** Merchants of the group (detail of a Salaire, Remboursements… subcategory). */
	parts: Map<string, number>;
}

interface CategoryAgg {
	id: CategoryId;
	cents: number;
	count: number;
	subs: Map<string, number>;
	/** Refunds (credits) of the category, per merchant. */
	refunds: Map<string, number>;
}

/**
 * Sankey nodes of a 'YYYY-MM' month; null if the month has no flow. `txs`: budget scope
 * (getBudgetTransactions), filtered here like monthTotals. Left: income sources (detected income
 * subcategory such as Salaire, else the merchant), then net refunds; right: spending groups,
 * grouping and deducted income; balance: net savings (right) or savings drawn (left).
 */
export function buildSankeyFlows(
	txs: Transaction[],
	monthKey: string,
	catOf: CatOf,
	subOf: SubOf,
	options: SankeyOptions = {}
): SankeyFlows | null {
	const maxSources = Math.max(1, options.maxSources ?? 5);
	const maxCategories = Math.max(1, options.maxCategories ?? 9);
	const minShare = options.minShare ?? 0.02;

	const sources = new Map<string, SourceGroup>();
	const cats = new Map<CategoryId, CategoryAgg>();

	for (const tx of txs) {
		if (!isBudgetFlow(tx) || tx.booking_date.slice(0, 7) !== monthKey) continue;
		const cat = catOf(tx);
		const kind = flowKind(cat);
		if (kind === 'transfer') continue;
		const cents = Math.round(signedAmount(tx) * 100);
		const name = displayName(tx);
		if (kind === 'income') {
			const sub = subOf(tx);
			const subDef = sub ? getSubcategory(sub) : undefined;
			const bySub = subDef !== undefined && subDef.categoryId === 'revenus';
			const key = bySub
				? `sub:${subDef.id}`
				: isComputedEntry(tx)
					? `p:${name}`
					: `m:${merchantKey(tx.remittance_information) || name}`;
			let g = sources.get(key);
			if (!g) {
				g = { key, label: bySub ? subDef.label : name, ...(bySub ? { subId: subDef.id } : {}), cents: 0, count: 0, parts: new Map() };
				sources.set(key, g);
			}
			g.cents += cents;
			g.count++;
			g.parts.set(name, (g.parts.get(name) ?? 0) + cents);
		} else {
			const spend = -cents;
			let c = cats.get(cat);
			if (!c) {
				c = { id: cat, cents: 0, count: 0, subs: new Map(), refunds: new Map() };
				cats.set(cat, c);
			}
			c.cents += spend;
			c.count++;
			const sub = subOf(tx);
			if (sub) c.subs.set(sub, (c.subs.get(sub) ?? 0) + spend);
			if (spend < 0) c.refunds.set(name, (c.refunds.get(name) ?? 0) - spend);
		}
	}

	const positiveSources = [...sources.values()].filter((g) => g.cents > 0);
	const sourcesCents = positiveSources.reduce((s, g) => s + g.cents, 0);
	const srcSplit = bucketize(positiveSources, maxSources, Math.round(sourcesCents * minShare));
	const left: SankeyNode[] = srcSplit.kept.map((g): SankeyNode => ({
		id: `src:${g.key}`,
		label: g.label,
		value: toEuros(g.cents),
		color: SANKEY_COLORS.income,
		kind: 'source',
		side: 'left',
		categoryId: 'revenus',
		...(g.subId ? { subId: g.subId } : {}),
		count: g.count,
		details: g.parts.size > 1 ? topDetails(g.parts) : []
	}));
	if (srcSplit.grouped.length > 0) {
		left.push({
			id: 'src:autres',
			label: 'Autres revenus',
			value: toEuros(srcSplit.grouped.reduce((s, g) => s + g.cents, 0)),
			color: SANKEY_COLORS.income,
			kind: 'source',
			side: 'left',
			categoryId: 'revenus',
			count: srcSplit.grouped.reduce((s, g) => s + g.count, 0),
			details: topDetails(new Map(srcSplit.grouped.map((g) => [g.label, g.cents])))
		});
	}
	for (const c of [...cats.values()].filter((x) => x.cents < 0).sort((a, b) => a.cents - b.cents)) {
		const cat = getCategory(c.id);
		left.push({
			id: `remb:${c.id}`,
			label: `${cat.label} (remboursé)`,
			value: toEuros(-c.cents),
			color: cat.color,
			kind: 'refund',
			side: 'left',
			categoryId: c.id,
			count: c.count,
			details: topDetails(c.refunds)
		});
	}

	const positiveCats = [...cats.values()].filter((c) => c.cents > 0);
	const catsCents = positiveCats.reduce((s, c) => s + c.cents, 0);
	const catSplit = bucketize(positiveCats, maxCategories, Math.round(catsCents * minShare));
	const right: SankeyNode[] = catSplit.kept.map((c): SankeyNode => {
		const cat = getCategory(c.id);
		const subs = new Map([...c.subs.entries()].map(([id, v]) => [getSubcategory(id)?.label ?? id, v]));
		return {
			id: `cat:${c.id}`,
			label: cat.label,
			value: toEuros(c.cents),
			color: cat.color,
			kind: 'category',
			side: 'right',
			categoryId: c.id,
			count: c.count,
			details: topDetails(subs)
		};
	});
	if (catSplit.grouped.length > 0) {
		right.push({
			id: 'cat:autres',
			label: 'Autres postes',
			value: toEuros(catSplit.grouped.reduce((s, c) => s + c.cents, 0)),
			color: SANKEY_COLORS.others,
			kind: 'others',
			side: 'right',
			count: catSplit.grouped.reduce((s, c) => s + c.count, 0),
			details: topDetails(new Map(catSplit.grouped.map((c) => [getCategory(c.id).label, c.cents])))
		});
	}
	const negativeSources = [...sources.values()].filter((g) => g.cents < 0);
	if (negativeSources.length > 0) {
		right.push({
			id: 'deduit',
			label: 'Déduit des revenus',
			value: toEuros(-negativeSources.reduce((s, g) => s + g.cents, 0)),
			color: SANKEY_COLORS.reversal,
			kind: 'reversal',
			side: 'right',
			categoryId: 'revenus',
			count: negativeSources.reduce((s, g) => s + g.count, 0),
			details: topDetails(new Map(negativeSources.map((g) => [g.label, -g.cents])))
		});
	}

	const sumCents = (nodes: SankeyNode[]) => nodes.reduce((s, n) => s + Math.round(n.value * 100), 0);
	const leftCents = sumCents(left);
	const rightCents = sumCents(right);
	if (leftCents === 0 && rightCents === 0) return null;
	if (leftCents > rightCents) {
		right.push({ id: 'epargne-nette', label: 'Épargne nette', value: toEuros(leftCents - rightCents), color: SANKEY_COLORS.savings, kind: 'savings', side: 'right', count: 0, details: [] });
	} else if (rightCents > leftCents) {
		left.push({ id: 'puise', label: "Puisé dans l'épargne", value: toEuros(rightCents - leftCents), color: SANKEY_COLORS.draw, kind: 'draw', side: 'left', count: 0, details: [] });
	}

	const t = monthTotals(txs, monthKey, catOf);
	return {
		monthKey,
		income: t.income,
		expenses: t.expenses,
		net: t.net,
		left,
		right,
		total: toEuros(Math.max(leftCents, rightCents))
	};
}

/** Summary sentence for screen readers (aria-label of the chart). */
export function sankeySummary(flows: SankeyFlows, monthLabel: string): string {
	const list = (nodes: SankeyNode[], n: number) =>
		nodes
			.slice(0, n)
			.map((x) => `${x.label} ${formatEUR(x.value)}`)
			.join(', ');
	const sources = flows.left.filter((n) => n.kind === 'source');
	const posts = flows.right.filter((n) => n.kind === 'category' || n.kind === 'others');
	const savings = flows.right.find((n) => n.kind === 'savings');
	const draw = flows.left.find((n) => n.kind === 'draw');
	const parts = [`Flux de ${monthLabel} : ${formatEUR(flows.income)} d'entrées`];
	if (sources.length > 0) parts[0] += ` (${list(sources, 3)})`;
	if (posts.length > 0) parts.push(`principales sorties : ${list(posts, 4)}`);
	if (savings) parts.push(`épargne nette ${formatEUR(savings.value)}`);
	if (draw) parts.push(`${formatEUR(draw.value)} puisés dans l'épargne`);
	return `${parts.join(' ; ')}.`;
}

/* ---------------- Layout ---------------- */

export interface SankeyLabel {
	x: number;
	/** Vertical centre of the label block. */
	y: number;
	anchor: 'start' | 'end' | 'middle';
	/** Name truncated to fit the column (the full name stays in the tooltip). */
	name: string;
	amount: string;
	/** Name then amount on two lines (narrow screens). */
	twoLines: boolean;
	/** Estimated width of the label block (clickable area). */
	w: number;
}

export interface PlacedNode {
	id: string;
	/** null: central 'Entrées' node. */
	node: SankeyNode | null;
	x: number;
	y: number;
	w: number;
	h: number;
	color: string;
	label: SankeyLabel;
}

export interface PlacedLink {
	/** Id of the side node linked to the centre (one link per node). */
	id: string;
	d: string;
	/** Ribbon thickness (px), equal to the side node's height. */
	width: number;
	color: string;
}

export interface SankeyLayout {
	width: number;
	height: number;
	compact: boolean;
	nodeWidth: number;
	center: PlacedNode;
	nodes: PlacedNode[];
	links: PlacedLink[];
}

export interface SankeyLayoutOptions {
	width: number;
	/** Two-line labels; default: width < 520 px. */
	compact?: boolean;
}

/** Label size (px), aligned on text-xs in app.css. */
export const SANKEY_FONT = 11;
/** Average advance of Inter (tabular figures included), in em. */
const CHAR_EM = 0.58;

/** Estimated text width (no DOM measurement: pure module). */
export function estimateTextWidth(s: string, font = SANKEY_FONT): number {
	return s.length * font * CHAR_EM;
}

/**
 * Truncates a name to fit `maxW` px (with an epsilon so a name measured exactly at its place,
 * such as 'Alimentation', is not cut by rounding).
 */
function fitName(name: string, maxW: number): string {
	const maxChars = Math.max(4, Math.floor(maxW / (SANKEY_FONT * CHAR_EM) + 1e-6));
	return truncateLabel(name, maxChars);
}

/**
 * Label anti-overlap within a column: centres (in the vertical order of the nodes) pushed apart
 * to keep `spacing` between two labels, within [lo, hi]. Too many labels for the height:
 * regular spread.
 */
export function relaxLabels(ys: readonly number[], spacing: number, lo: number, hi: number): number[] {
	const out = [...ys];
	if (out.length === 0) return out;
	if ((out.length - 1) * spacing > hi - lo) {
		const step = out.length > 1 ? (hi - lo) / (out.length - 1) : 0;
		return out.map((_, i) => lo + i * step);
	}
	for (let i = 0; i < out.length; i++) out[i] = Math.max(out[i]!, i === 0 ? lo : out[i - 1]! + spacing);
	const last = out.length - 1;
	if (out[last]! > hi) {
		out[last] = hi;
		for (let i = last - 1; i >= 0; i--) out[i] = Math.min(out[i]!, out[i + 1]! - spacing);
	}
	return out;
}

const f1 = (n: number) => (Math.round(n * 10) / 10).toString();

/**
 * Ribbon of a link: top and bottom edges as horizontal Béziers, vertical ends, filled. More
 * accurate than a thick stroke, which overflows the node when the link is both thick and steep
 * (narrow screen). (x0, y0) and (x1, y1): top corners of both ends; h: thickness.
 */
export function ribbonPath(x0: number, y0: number, x1: number, y1: number, h: number): string {
	const mx = (x0 + x1) / 2;
	return (
		`M${f1(x0)},${f1(y0)} C${f1(mx)},${f1(y0)} ${f1(mx)},${f1(y1)} ${f1(x1)},${f1(y1)}` +
		` L${f1(x1)},${f1(y1 + h)} C${f1(mx)},${f1(y1 + h)} ${f1(mx)},${f1(y0 + h)} ${f1(x0)},${f1(y0 + h)} Z`
	);
}

/**
 * Positions of nodes, links and labels for a given width (px). Label columns take the width of the
 * longest label, capped; when space is short, the shorter side keeps its width and the other
 * takes the rest (truncated names). Both columns share one scale so a link has the same thickness
 * at both ends; small nodes are spread out (centres ≥ `spacing`) so each label stays in front of
 * its node, using the largest scale that fits the height. The central node is as tall as the
 * taller link stack; on a narrow screen the 'Entrées' label sits at the top of its column, above
 * the steep links. Links are stacked in node order on each side of the centre (no crossing).
 */
export function layoutSankey(flows: SankeyFlows, opts: SankeyLayoutOptions): SankeyLayout {
	const width = Math.max(240, Math.round(opts.width));
	const compact = opts.compact ?? width < 520;
	const nodeWidth = compact ? 6 : 8;
	const gap = compact ? 5 : 7;
	const labelGap = 6;
	const spacing = compact ? 26 : 15;
	const padTop = 24;
	const padBottom = 4;
	const nMax = Math.max(flows.left.length, flows.right.length, 1);
	const height = Math.round(Math.min(340, Math.max(compact ? 290 : 264, padTop + padBottom + nMax * spacing + 6)));
	const innerTop = padTop;
	const innerH = height - padTop - padBottom;

	const amountOf = (v: number) => formatEURCompact(v);
	const labelWidth = (n: SankeyNode) =>
		compact
			? Math.max(estimateTextWidth(n.label), estimateTextWidth(amountOf(n.value)))
			: estimateTextWidth(n.label) + 5 + estimateTextWidth(amountOf(n.value));
	const needL = Math.max(0, ...flows.left.map(labelWidth));
	const needR = Math.max(0, ...flows.right.map(labelWidth));
	const avail = Math.max(0, width - 3 * nodeWidth - 2 * labelGap - (compact ? 70 : 150));
	let leftW = needL;
	let rightW = needR;
	if (needL + needR > avail) {
		const halfAvail = avail / 2;
		if (needL <= halfAvail) rightW = avail - needL;
		else if (needR <= halfAvail) leftW = avail - needR;
		else leftW = rightW = halfAvail;
	}
	const xL = Math.round(leftW + labelGap);
	const xR = Math.round(width - rightW - labelGap - nodeWidth);
	const xC = Math.round((xL + nodeWidth + xR) / 2 - nodeWidth / 2);

	const total = flows.total > 0 ? flows.total : 1;
	const thickAt = (v: number, k: number) => Math.max(v * k, 1.5);
	const gapsAt = (hs: number[]) => hs.slice(1).map((h, i) => Math.max(gap, spacing - (hs[i]! + h) / 2));
	const columnHeight = (nodes: SankeyNode[], k: number) => {
		const hs = nodes.map((n) => thickAt(n.value, k));
		return hs.reduce((s, h) => s + h, 0) + gapsAt(hs).reduce((s, g) => s + g, 0);
	};
	const fits = (k: number) => columnHeight(flows.left, k) <= innerH && columnHeight(flows.right, k) <= innerH;
	let lo = 0;
	let hi = innerH / total;
	for (let i = 0; i < 40; i++) {
		const mid = (lo + hi) / 2;
		if (fits(mid)) lo = mid;
		else hi = mid;
	}
	const k = lo;

	const columnWidth = (side: 'left' | 'right') => (side === 'left' ? leftW : rightW);
	const half = spacing / 2 - 1;

	const placeColumn = (nodes: SankeyNode[], x: number, side: 'left' | 'right'): PlacedNode[] => {
		const hs = nodes.map((n) => thickAt(n.value, k));
		const gaps = gapsAt(hs);
		const colH = hs.reduce((s, h) => s + h, 0) + gaps.reduce((s, g) => s + g, 0);
		let y = innerTop + (innerH - colH) / 2;
		const ys = relaxLabels(
			nodes.map((_, i) => {
				const center = y + hs[i]! / 2;
				y += hs[i]! + (gaps[i] ?? 0);
				return center;
			}),
			spacing,
			innerTop + half,
			height - padBottom - half
		);
		y = innerTop + (innerH - colH) / 2;
		return nodes.map((n, i) => {
			const h = hs[i]!;
			const amount = amountOf(n.value);
			const nameMax = compact ? columnWidth(side) : columnWidth(side) - 5 - estimateTextWidth(amount);
			const name = fitName(n.label, nameMax);
			const placed: PlacedNode = {
				id: n.id,
				node: n,
				x,
				y,
				w: nodeWidth,
				h,
				color: n.color,
				label: {
					x: side === 'left' ? x - labelGap : x + nodeWidth + labelGap,
					y: ys[i]!,
					anchor: side === 'left' ? 'end' : 'start',
					name,
					amount,
					twoLines: compact,
					w: compact
						? Math.max(estimateTextWidth(name), estimateTextWidth(amount))
						: estimateTextWidth(name) + 5 + estimateTextWidth(amount)
				}
			};
			y += h + (gaps[i] ?? 0);
			return placed;
		});
	};
	const leftNodes = placeColumn(flows.left, xL, 'left');
	const rightNodes = placeColumn(flows.right, xR, 'right');

	const sumL = leftNodes.reduce((s, n) => s + n.h, 0);
	const sumR = rightNodes.reduce((s, n) => s + n.h, 0);
	const ch = Math.max(sumL, sumR);
	const cy = innerTop + (innerH - ch) / 2;
	const center: PlacedNode = {
		id: 'center',
		node: null,
		x: xC,
		y: cy,
		w: nodeWidth,
		h: ch,
		color: SANKEY_COLORS.center,
		label: {
			x: xC + nodeWidth / 2,
			y: compact ? 10 : Math.max(8, cy - 12),
			anchor: 'middle',
			name: 'Entrées',
			amount: amountOf(flows.income),
			twoLines: false,
			w: estimateTextWidth('Entrées') + 5 + estimateTextWidth(amountOf(flows.income))
		}
	};

	const links: PlacedLink[] = [];
	let ay = cy + (ch - sumL) / 2;
	for (const n of leftNodes) {
		links.push({ id: n.id, d: ribbonPath(n.x + nodeWidth, n.y, xC, ay, n.h), width: n.h, color: n.color });
		ay += n.h;
	}
	let by = cy + (ch - sumR) / 2;
	for (const n of rightNodes) {
		links.push({ id: n.id, d: ribbonPath(xC + nodeWidth, by, n.x, n.y, n.h), width: n.h, color: n.color });
		by += n.h;
	}

	return { width, height, compact, nodeWidth, center, nodes: [...leftNodes, ...rightNodes], links };
}
