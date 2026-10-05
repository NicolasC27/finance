import type { CategoryId, Transaction } from './types';
import { normalizeHeader, tokenize, detectDelimiter } from './csvCore';
import { signedAmount } from './data';
import { txKey } from './categories';

/**
 * Amazon order history (GDPR export « Demander mes données », file
 * Retail.OrderHistory.N.csv: one row per ITEM) — pure module.
 *
 * - parseAmazonOrders: CSV → orders (items grouped by order number)
 * - matchAmazonOrders: matching with the « AMAZON » lines of the statement
 *   (exact amount of an order, a partial shipment or an item, order/ship date
 *   within a −12/+3 day window)
 * - inferCategory: category + subcategory inferred from the item titles
 *
 * Shared Amazon account: only orders whose amount lands on a line of THIS
 * statement are kept; the others (paid by someone else) are ignored. No
 * network call: everything stays local.
 */

export interface AmazonItem {
	name: string;
	/** Amount owed for the row (VAT included, quantity included). */
	amount: number;
	quantity: number;
}

export interface AmazonOrder {
	id: string;
	/** ISO YYYY-MM-DD. */
	orderDate: string;
	/** ISO, or '' when unknown. */
	shipDate: string;
	items: AmazonItem[];
	total: number;
	/** E.g. « Visa - 1234 »: helps sort a shared account. */
	payment: string;
	status: string;
	website: string;
}

export interface AmazonMatch {
	txKey: string;
	orderId: string;
	/** Items covered by this bank line (whole order or partial shipment). */
	items: AmazonItem[];
	amount: number;
	orderDate: string;
	/** 'order' = order total, 'partial' = subset of items, 'item' = a single item. */
	kind: 'order' | 'partial' | 'item';
	categoryId: CategoryId;
	subId: string | null;
	/**
	 * Category Amazon actually set as an override (null = nothing set, the user
	 * had already decided; missing = older match, where the inferred category
	 * was always set).
	 */
	appliedCategory?: CategoryId | null;
}

/** Row note: « Amazon · item 1 · item 2 » (titles cut at 60 characters). */
export function amazonNote(m: Pick<AmazonMatch, 'items'>): string {
	const titles = m.items.map((it) => (it.name.length > 60 ? `${it.name.slice(0, 59).trimEnd()}…` : it.name));
	return `Amazon · ${titles.join(' · ')}`;
}

/**
 * Merged note: the user's note is kept and the Amazon note appended; on
 * re-import only the previous Amazon part is replaced (never overwritten:
 * « cadeau neveu » survives the import).
 */
export function mergeAmazonNote(current: string | undefined, previousAmazon: string | null, nextAmazon: string): string {
	const note = (current ?? '').trim();
	if (!note) return nextAmazon;
	if (note.includes(nextAmazon)) return note;
	if (previousAmazon && note.includes(previousAmazon)) return note.replace(previousAmazon, nextAmazon);
	return `${note} · ${nextAmazon}`;
}

/**
 * Is the row's category still « Amazon's »? Yes on the first match when there
 * is no override; afterwards only if the current override is exactly the one
 * Amazon set — a manual correction (or a return to automatic categorisation)
 * is never rewritten on re-import.
 */
export function amazonOwnsCategory(current: CategoryId | undefined, previous: AmazonMatch | undefined): boolean {
	if (!previous) return current === undefined;
	const applied = previous.appliedCategory === undefined ? previous.categoryId : previous.appliedCategory;
	return applied !== null && current === applied;
}

export interface AmazonImportResult {
	orders: AmazonOrder[];
	matches: AmazonMatch[];
	/** Amazon statement lines without a matching order (other payer, outside the export, Prime…). */
	unmatchedTx: number;
	/** Export orders never found on this statement (paid by someone else, another card…). */
	unmatchedOrders: number;
	errors: string[];
}

const COL = {
	orderId: ['order id', 'order number', 'n de commande', 'numero de commande', 'commande'],
	orderDate: ['order date', 'date de commande', 'date de la commande'],
	shipDate: ['ship date', 'date d expedition', 'date expedition'],
	total: ['total owed', 'item total', 'total du', 'montant total', 'total'],
	name: ['product name', 'title', 'nom du produit', 'titre', 'article'],
	quantity: ['quantity', 'quantite', 'qty'],
	payment: ['payment instrument type', 'payment method', 'moyen de paiement'],
	status: ['order status', 'statut'],
	website: ['website', 'site']
} as const;

function findCol(headers: string[], names: readonly string[]): number {
	for (const n of names) {
		const i = headers.indexOf(n);
		if (i !== -1) return i;
	}
	return -1;
}

/** Does the header look like an Amazon orders export? */
export function matchesAmazonHeader(headerFields: string[]): boolean {
	const h = headerFields.map(normalizeHeader);
	return findCol(h, COL.orderId) !== -1 && findCol(h, COL.name) !== -1 && (findCol(h, COL.total) !== -1 || findCol(h, COL.orderDate) !== -1);
}

/** « 2026-08-03T10:12:33Z » / « 2026-08-03 » / « 03/08/2026 » → YYYY-MM-DD. */
function toIso(raw: string): string {
	const s = raw.trim();
	const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
	if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
	const fr = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s);
	if (fr) return `${fr[3]}-${fr[2]}-${fr[1]}`;
	return '';
}

/** « 1,234.56 » / « 12,34 » / « €12.34 » → number (French decimal comma vs thousands separator). */
function toAmount(raw: string): number | null {
	let s = raw.replace(/[^\d,.-]/g, '');
	if (!s) return null;
	if (/,\d{1,2}$/.test(s) && !s.includes('.')) s = s.replace(',', '.');
	else s = s.replace(/,/g, '');
	const n = Number(s);
	return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

/** Parses the CSV into orders; cancelled orders (never charged) are skipped and an order keeps its latest ship date. */
export function parseAmazonOrders(text: string): { orders: AmazonOrder[]; errors: string[] } {
	const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
	const rows = tokenize(text, detectDelimiter(firstLine));
	const errors: string[] = [];
	if (rows.length < 2) return { orders: [], errors: ['Fichier vide'] };
	const h = rows[0]!.map(normalizeHeader);
	const ci = {
		orderId: findCol(h, COL.orderId),
		orderDate: findCol(h, COL.orderDate),
		shipDate: findCol(h, COL.shipDate),
		total: findCol(h, COL.total),
		name: findCol(h, COL.name),
		quantity: findCol(h, COL.quantity),
		payment: findCol(h, COL.payment),
		status: findCol(h, COL.status),
		website: findCol(h, COL.website)
	};
	if (ci.orderId === -1 || ci.name === -1) return { orders: [], errors: ['Colonnes « Order ID » et « Product Name » introuvables'] };

	const byId = new Map<string, AmazonOrder>();
	rows.slice(1).forEach((row, i) => {
		if (row.every((c) => c.trim() === '')) return;
		const id = (row[ci.orderId] ?? '').trim();
		if (!id) return;
		const amount = ci.total !== -1 ? toAmount(row[ci.total] ?? '') : null;
		if (amount === null) {
			errors.push(`Ligne ${i + 2} : montant illisible, article ignoré`);
			return;
		}
		const status = ci.status !== -1 ? (row[ci.status] ?? '').trim() : '';
		if (/cancel|annul/i.test(status)) return;
		let order = byId.get(id);
		if (!order) {
			order = {
				id,
				orderDate: ci.orderDate !== -1 ? toIso(row[ci.orderDate] ?? '') : '',
				shipDate: ci.shipDate !== -1 ? toIso(row[ci.shipDate] ?? '') : '',
				items: [],
				total: 0,
				payment: ci.payment !== -1 ? (row[ci.payment] ?? '').trim() : '',
				status,
				website: ci.website !== -1 ? (row[ci.website] ?? '').trim() : ''
			};
			byId.set(id, order);
		}
		const qty = ci.quantity !== -1 ? Number(row[ci.quantity]) || 1 : 1;
		order.items.push({ name: (row[ci.name] ?? '').replace(/\s+/g, ' ').trim(), amount, quantity: qty });
		order.total = Math.round((order.total + amount) * 100) / 100;
		const ship = ci.shipDate !== -1 ? toIso(row[ci.shipDate] ?? '') : '';
		if (ship > order.shipDate) order.shipDate = ship;
	});
	return { orders: [...byId.values()], errors };
}

/** Amazon statement line (excluding the Prime subscription, which is not an order). */
export function isAmazonTx(tx: Transaction): boolean {
	const l = tx.remittance_information.join(' ').toUpperCase();
	return /AMAZON|AMZN/.test(l) && !/PRIME/.test(l);
}

function daysBetween(a: string, b: string): number {
	return Math.round((new Date(`${a}T12:00:00`).getTime() - new Date(`${b}T12:00:00`).getTime()) / 86_400_000);
}

// ---------- Category inferred from the items ----------

interface Rule {
	re: RegExp;
	categoryId: CategoryId;
	subId: string | null;
}

/** Keyword rules (normalised titles: lowercase, no accents). Order = priority. */
const ITEM_RULES: Rule[] = [
	{ re: /\b(piano|partition|guitare|ukulele|metronome|pupitre|clavier maitre|midi|solfege|violon)\b/, categoryId: 'loisirs', subId: 'musique-cours' },
	{ re: /\b(livre|book|roman|manga|bande dessinee|tome|poche|edition|essai|guide|dictionnaire|cahier|agenda|vinyles?|disques?|vinyl|cd|dvd|blu ray|album|platine)\b|\bbd\b/, categoryId: 'loisirs', subId: 'culture-sorties' },
	{ re: /\b(jeu|jeux|game|lego|puzzle|playmobil|figurine|nintendo|playstation|xbox|switch oled|manette|jouet|peluche|carte a jouer|board)\b/, categoryId: 'loisirs', subId: 'culture-sorties' },
	{ re: /\b(fitness|haltere|yoga|velo|running|raquette|ballon|gourde|tapis de sol|musculation|natation|randonnee|trek)\b/, categoryId: 'loisirs', subId: 'sport' },
	{ re: /\b(vitamine|complement alimentaire|pharmacie|medical|thermometre|tensiometre|pansement|lunettes|orthese|omega|magnesium|melatonine)\b/, categoryId: 'sante', subId: 'soins' },
	{ re: /\b(cafe|capsule|the vert|the noir|infusion|chocolat|biscuit|snack|epicerie|bio|boisson|pates|riz|huile|miel|proteine|whey|cereale|confiture|sirop|dentifrice|brosse a dents|rasoir|shampoing|savon|deodorant|lessive|papier toilette|essuie)\b/, categoryId: 'alimentation', subId: 'courses' },
	{ re: /\b(cable|usb|chargeur|batterie|powerbank|clavier|souris|ecran|moniteur|ssd|disque dur|hdmi|adaptateur|hub|webcam|casque|ecouteur|enceinte|imprimante|cartouche|toner|tablette|smartphone|coque|protection ecran|support|routeur|wifi|raspberry|arduino|capteur|alimentation pc|carte sd|micro sd|lampe led bureau|station d accueil|dock|nas|processeur|ram|carte graphique)\b/, categoryId: 'loisirs', subId: 'high-tech' },
	{ re: /\b(t shirt|tee shirt|chemise|pantalon|jean|robe|jupe|chaussure|basket|sneaker|chaussette|veste|manteau|sweat|pull|casquette|bonnet|echarpe|gant|sac|ceinture|montre|bijou|lunettes de soleil|maillot|sous vetement|boxer|pyjama)\b/, categoryId: 'loisirs', subId: 'shopping' },
	{ re: /\b(cuisine|casserole|poele|couteau|assiette|verre|tasse|mug|bouilloire|cafetiere|mixeur|robot|four|micro ondes|frigo|refrigerateur|aspirateur|lampe|ampoule|meuble|etagere|rangement|boite|coussin|rideau|drap|housse|matelas|oreiller|couette|serviette|nettoyant|balai|serpilliere|poubelle|bricolage|perceuse|visseuse|tournevis|peinture|jardin|plante|arrosoir|tondeuse|outil|vis|cheville|crochet|cintre|tapis|miroir|horloge|decoration|bougie|ventilateur|chauffage|radiateur|humidificateur|purificateur|detecteur|serrure|prise|multiprise|interrupteur|filtre|joint|robinet|douche|wc|salle de bain|cuisson|plat|moule|balance de cuisine|thermos|lunch box|bocal)\b/, categoryId: 'logement', subId: 'travaux-equipement' },
	{ re: /\b(voiture|auto|pneu|essuie glace|siege auto|gps|dashcam|chargeur voiture|housse de siege|balai d essuie)\b/, categoryId: 'voiture', subId: 'equipement-auto' },
	{ re: /\b(croquette|chat|chien|litiere|animal|aquarium|gamelle)\b/, categoryId: 'autre', subId: null }
];

function normalizeName(name: string): string {
	return name
		.toLowerCase()
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();
}

/** Category of a product or object name from the keyword rules (« vinyles », « chargeur »…), null when no rule matches. */
export function classifyItemName(name: string): { categoryId: CategoryId; subId: string | null } | null {
	const n = ` ${normalizeName(name)} `;
	for (const r of ITEM_RULES) if (r.re.test(n)) return { categoryId: r.categoryId, subId: r.subId };
	return null;
}

/** Category of a set of items: that of the most expensive item matching a rule; otherwise Loisirs › Shopping. */
export function inferCategory(items: AmazonItem[]): { categoryId: CategoryId; subId: string | null } {
	const sorted = [...items].sort((a, b) => b.amount - a.amount);
	for (const it of sorted) {
		const c = classifyItemName(it.name);
		if (c) return c;
	}
	return { categoryId: 'loisirs', subId: 'shopping' };
}

// ---------- Matching ----------

/** Largest subset of items (≤ 12) whose sum = amount (±1 cent): a shipment groups as many items as possible. */
function subsetMatching(items: AmazonItem[], amount: number): AmazonItem[] | null {
	const n = Math.min(items.length, 12);
	let best: AmazonItem[] | null = null;
	for (let mask = 1; mask < 1 << n; mask++) {
		let sum = 0;
		for (let i = 0; i < n; i++) if (mask & (1 << i)) sum += items[i]!.amount;
		if (Math.abs(sum - amount) < 0.015) {
			const subset = items.filter((_, i) => mask & (1 << i));
			if (!best || subset.length > best.length) best = subset;
		}
	}
	return best;
}

/**
 * Matches each Amazon statement line (debit) with an order: exact amount of
 * the order, otherwise of a partial shipment, otherwise of an item; order or
 * ship date between −12 and +3 days of the booking date. Each item is used
 * only once (`used`: orderId → items already consumed).
 */
export function matchAmazonOrders(txs: Transaction[], orders: AmazonOrder[]): AmazonImportResult {
	const matches: AmazonMatch[] = [];
	const used = new Map<string, Set<AmazonItem>>();
	const remaining = (o: AmazonOrder) => o.items.filter((it) => !(used.get(o.id)?.has(it) ?? false));
	const consume = (o: AmazonOrder, items: AmazonItem[]) => {
		let set = used.get(o.id);
		if (!set) {
			set = new Set();
			used.set(o.id, set);
		}
		for (const it of items) set.add(it);
	};

	const candidates = txs
		.filter((tx) => isAmazonTx(tx) && tx.booking_date && signedAmount(tx) < 0)
		.sort((a, b) => a.booking_date.localeCompare(b.booking_date));
	let unmatchedTx = 0;

	for (const tx of candidates) {
		const amount = Math.round(-signedAmount(tx) * 100) / 100;
		let found: { order: AmazonOrder; items: AmazonItem[]; kind: AmazonMatch['kind']; dist: number } | null = null;
		for (const order of orders) {
			const ref = order.shipDate || order.orderDate;
			if (!ref) continue;
			const d = daysBetween(tx.booking_date, ref);
			const dOrder = order.orderDate ? daysBetween(tx.booking_date, order.orderDate) : d;
			if (!((d >= -3 && d <= 12) || (dOrder >= -3 && dOrder <= 12))) continue;
			const items = remaining(order);
			if (items.length === 0) continue;
			const dist = Math.min(Math.abs(d), Math.abs(dOrder));
			const total = Math.round(items.reduce((s, it) => s + it.amount, 0) * 100) / 100;
			let hit: { items: AmazonItem[]; kind: AmazonMatch['kind'] } | null = null;
			if (Math.abs(total - amount) < 0.015) hit = { items, kind: items.length === order.items.length ? 'order' : 'partial' };
			else {
				const sub = subsetMatching(items, amount);
				if (sub) hit = { items: sub, kind: sub.length === 1 ? 'item' : 'partial' };
			}
			if (hit && (!found || dist < found.dist)) found = { order, ...hit, dist };
		}
		if (!found) {
			unmatchedTx++;
			continue;
		}
		consume(found.order, found.items);
		const cat = inferCategory(found.items);
		matches.push({
			txKey: txKey(tx),
			orderId: found.order.id,
			items: found.items,
			amount,
			orderDate: found.order.orderDate,
			kind: found.kind,
			categoryId: cat.categoryId,
			subId: cat.subId
		});
	}
	const unmatchedOrders = orders.filter((o) => !used.has(o.id)).length;
	return { orders, matches, unmatchedTx, unmatchedOrders, errors: [] };
}
