import type { CategoryId } from './types';
import type { CatRule } from './categories';
import { assetTypeLabel, KM_SOURCES, validateAsset, validateReading, type AssetInput, type KmReading } from './assets';
import { addTags, removeTags, tagKey, TAG_MAX_LENGTH } from './tags';

/**
 * Actions proposed by the AI analysis (the relay's actions.json file) — pure
 * module, testable with tsx. The AI PROPOSES, the user confirms each action on
 * the AI page; applying them (applyAction) goes through effects provided by
 * ai.svelte.ts, which makes it testable here.
 *
 * Strict validation: known type, existing category, existing transaction keys,
 * finite and bounded amounts. Anything else is rejected with a readable reason
 * (never applied "as best we can").
 */

export type AiAction =
	| { type: 'set_budget'; categoryId: CategoryId; amount: number; why?: string }
	| { type: 'recategorize'; keys: string[]; categoryId: CategoryId; why?: string }
	| { type: 'add_rule'; keyword: string; categoryId: CategoryId; why?: string }
	| { type: 'exclude'; keys: string[]; why?: string }
	| { type: 'include'; keys: string[]; why?: string }
	| { type: 'set_note'; key: string; note: string; why?: string }
	| { type: 'tag'; keys: string[]; add?: string[]; remove?: string[]; why?: string }
	| { type: 'add_goal'; name: string; targetAmount: number; targetDate?: string; why?: string }
	| { type: 'add_asset'; bien: AssetInput; why?: string }
	| ({ type: 'log_km'; assetId: string; why?: string } & KmReading);

export interface ParsedActions {
	actions: AiAction[];
	rejected: { raw: unknown; reason: string }[];
}

export interface ActionContext {
	categoryIds: ReadonlySet<string>;
	txKeys: ReadonlySet<string>;
	/** Assets of type vehicle (odometer readings). */
	vehicleIds?: ReadonlySet<string>;
}

const MAX_ACTIONS = 50;
const MAX_KEYS = 2000;
const MAX_AMOUNT = 1_000_000;
/** Tags: 1 to 30 characters, 10 per list; 200 transactions per action. */
const MAX_TAG_LEN = TAG_MAX_LENGTH;
const MAX_TAGS = 10;
const MAX_TAG_KEYS = 200;

function str(v: unknown, max: number): string | null {
	return typeof v === 'string' && v.trim() !== '' && v.length <= max ? v.trim() : null;
}

function why(o: Record<string, unknown>): { why?: string } {
	const w = str(o.why, 500);
	return w ? { why: w } : {};
}

function keysOf(o: Record<string, unknown>, ctx: ActionContext): string[] | string {
	if (!Array.isArray(o.keys) || o.keys.length === 0) return 'liste « keys » vide ou absente';
	if (o.keys.length > MAX_KEYS) return `trop d'opérations (${o.keys.length} > ${MAX_KEYS})`;
	const keys = [...new Set(o.keys.filter((k): k is string => typeof k === 'string'))];
	const unknown = keys.filter((k) => !ctx.txKeys.has(k));
	if (unknown.length) return `${unknown.length} opération(s) introuvable(s)`;
	return keys;
}


/** Tag list of an action: missing → []; otherwise 1 to 30 characters each, spaces collapsed, no duplicates (case-insensitive). */
function tagsOf(v: unknown, field: string): string[] | string {
	if (v === undefined) return [];
	if (!Array.isArray(v)) return `« ${field} » doit être une liste de tags`;
	if (v.length > MAX_TAGS) return `trop de tags dans « ${field} » (${v.length} > ${MAX_TAGS})`;
	const out: string[] = [];
	for (const t of v) {
		const clean = typeof t === 'string' ? t.normalize('NFC').replace(/\s+/g, ' ').trim() : '';
		if (!clean || clean.length > MAX_TAG_LEN) return `tag invalide « ${String(t).slice(0, 40)} » (1 à ${MAX_TAG_LEN} caractères)`;
		if (!out.some((x) => tagKey(x) === tagKey(clean))) out.push(clean);
	}
	return out;
}

function category(o: Record<string, unknown>, ctx: ActionContext): CategoryId | string {
	return typeof o.categoryId === 'string' && ctx.categoryIds.has(o.categoryId)
		? (o.categoryId as CategoryId)
		: `catégorie inconnue « ${String(o.categoryId)} »`;
}

/** Validates a raw action; returns the typed action or the rejection reason. For add_asset, `type` is the action's own type: the asset type arrives in assetType (or category, legacy format). */
export function validateAction(raw: unknown, ctx: ActionContext): AiAction | string {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'action illisible';
	const o = raw as Record<string, unknown>;
	switch (o.type) {
		case 'set_budget': {
			const c = category(o, ctx);
			if (!ctx.categoryIds.has(c)) return c;
			const amount = Number(o.amount);
			if (!Number.isFinite(amount) || amount < 0 || amount > MAX_AMOUNT) return 'montant invalide';
			return { type: 'set_budget', categoryId: c as CategoryId, amount: Math.round(amount * 100) / 100, ...why(o) };
		}
		case 'recategorize': {
			const c = category(o, ctx);
			if (!ctx.categoryIds.has(c)) return c;
			const keys = keysOf(o, ctx);
			if (typeof keys === 'string') return keys;
			return { type: 'recategorize', keys, categoryId: c as CategoryId, ...why(o) };
		}
		case 'add_rule': {
			const c = category(o, ctx);
			if (!ctx.categoryIds.has(c)) return c;
			if (c === 'vacances') return 'une règle ne peut pas viser « Vacances » (périodes datées)';
			const keyword = str(o.keyword, 80)?.toUpperCase().replace(/\s+/g, ' ');
			if (!keyword || keyword.length < 3) return 'mot-clé trop court (3 caractères minimum)';
			return { type: 'add_rule', keyword, categoryId: c as CategoryId, ...why(o) };
		}
		case 'exclude':
		case 'include': {
			const keys = keysOf(o, ctx);
			if (typeof keys === 'string') return keys;
			return { type: o.type, keys, ...why(o) };
		}
		case 'set_note': {
			const key = str(o.key, 200);
			if (!key || !ctx.txKeys.has(key)) return 'opération introuvable';
			if (typeof o.note !== 'string' || o.note.length > 500) return 'note invalide';
			return { type: 'set_note', key, note: o.note.trim(), ...why(o) };
		}
		case 'tag': {
			const keys = keysOf(o, ctx);
			if (typeof keys === 'string') return keys;
			if (keys.length > MAX_TAG_KEYS) return `trop d'opérations pour des tags (${keys.length} > ${MAX_TAG_KEYS})`;
			const add = tagsOf(o.add, 'add');
			if (typeof add === 'string') return add;
			const remove = tagsOf(o.remove, 'remove');
			if (typeof remove === 'string') return remove;
			if (!add.length && !remove.length) return 'aucun tag à ajouter ni à retirer';
			const conflict = add.find((t) => remove.some((r) => tagKey(r) === tagKey(t)));
			if (conflict) return `tag « ${conflict} » à la fois ajouté et retiré`;
			return { type: 'tag', keys, ...(add.length ? { add } : {}), ...(remove.length ? { remove } : {}), ...why(o) };
		}
		case 'add_goal': {
			const name = str(o.name, 80);
			if (!name) return 'nom d’objectif manquant';
			const targetAmount = Number(o.targetAmount);
			if (!Number.isFinite(targetAmount) || targetAmount <= 0 || targetAmount > MAX_AMOUNT) return 'montant cible invalide';
			const date = o.targetDate === undefined ? undefined : str(o.targetDate, 10);
			if (o.targetDate !== undefined && (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)))) return 'date cible invalide (AAAA-MM-JJ)';
			return { type: 'add_goal', name, targetAmount: Math.round(targetAmount), ...(date ? { targetDate: date } : {}), ...why(o) };
		}
		case 'add_asset': {
			const { type: _action, assetType, category, why: _why, ...fields } = o;
			const v = validateAsset({ ...fields, type: assetType ?? category }, { txKeys: ctx.txKeys });
			if (typeof v === 'string') return v;
			return { type: 'add_asset', bien: v, ...why(o) };
		}
		case 'log_km': {
			const assetId = str(o.assetId, 100);
			if (!assetId || !ctx.vehicleIds?.has(assetId)) return 'véhicule introuvable (assetId : id d’un bien de type vehicule)';
			const r = validateReading({ date: o.date, km: o.km, source: o.source ?? 'saisie' });
			if (typeof r === 'string') return r;
			return { type: 'log_km', assetId, ...r, ...why(o) };
		}
		default:
			return `type d'action inconnu « ${String(o.type)} »`;
	}
}

/** Validates the content of actions.json (an array, or an object { actions: [...] }). */
export function parseActions(raw: unknown, ctx: ActionContext): ParsedActions {
	const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' && Array.isArray((raw as { actions?: unknown }).actions) ? (raw as { actions: unknown[] }).actions : null;
	if (!list) return { actions: [], rejected: raw === undefined || raw === null ? [] : [{ raw, reason: 'format inattendu (tableau attendu)' }] };
	const out: ParsedActions = { actions: [], rejected: [] };
	for (const item of list.slice(0, MAX_ACTIONS)) {
		const v = validateAction(item, ctx);
		if (typeof v === 'string') out.rejected.push({ raw: item, reason: v });
		else out.actions.push(v);
	}
	if (list.length > MAX_ACTIONS) out.rejected.push({ raw: null, reason: `${list.length - MAX_ACTIONS} action(s) au-delà de ${MAX_ACTIONS} ignorée(s)` });
	return out;
}

const fmt = (n: number) => `${n.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} €`;
const ops = (n: number) => `${n} opération${n > 1 ? 's' : ''}`;

const dateFr = (d: string) => d.split('-').reverse().join('/');
const kmFr = (n: number) => `${n.toLocaleString('fr-FR')} km`;

/** Readable confirmation sentence (catLabel: id → label; assetName: asset id → name). */
export function describeAction(a: AiAction, catLabel: (id: CategoryId) => string, assetName?: (id: string) => string | undefined): string {
	switch (a.type) {
		case 'set_budget':
			return a.amount > 0 ? `Budget « ${catLabel(a.categoryId)} » : ${fmt(a.amount)} / mois` : `Retirer le budget « ${catLabel(a.categoryId)} »`;
		case 'recategorize':
			return `Classer ${ops(a.keys.length)} en « ${catLabel(a.categoryId)} »`;
		case 'add_rule':
			return `Règle : « ${a.keyword} » → ${catLabel(a.categoryId)} (toutes les opérations qui contiennent ce texte)`;
		case 'exclude':
			return `Masquer ${ops(a.keys.length)} du budget`;
		case 'include':
			return `Ré-inclure ${ops(a.keys.length)} dans le budget`;
		case 'set_note':
			return a.note ? `Note sur une opération : « ${a.note} »` : 'Effacer la note d’une opération';
		case 'tag': {
			const list = (t: string[]) => t.map((x) => `« ${x} »`).join(', ');
			const summary = [a.add?.length ? `ajouter ${list(a.add)}` : '', a.remove?.length ? `retirer ${list(a.remove)}` : ''].filter(Boolean).join(' · ');
			return `Tags sur ${ops(a.keys.length)} : ${summary}`;
		}
		case 'add_goal':
			return `Nouvel objectif « ${a.name} » : ${fmt(a.targetAmount)}${a.targetDate ? ` d'ici le ${a.targetDate.split('-').reverse().join('/')}` : ''}`;
		case 'add_asset': {
			const b = a.bien;
			const n = b.linkedTxKeys.length;
			const r = b.vehicle?.kmLog.length ?? 0;
			return `Nouveau bien « ${b.name} » (${assetTypeLabel(b.type)}) : ${fmt(b.purchasePrice)} payés le ${dateFr(b.purchaseDate)}${b.estimatedValue !== undefined ? `, estimé ${fmt(b.estimatedValue)}` : ''}${b.vehicle?.kmAtPurchase !== undefined ? ` · ${kmFr(b.vehicle.kmAtPurchase)} à l'achat` : ''}${r ? ` · ${r} relevé${r > 1 ? 's' : ''} du compteur` : ''}${n ? ` · ${ops(n)} rattachée${n > 1 ? 's' : ''}` : ''}`;
		}
		case 'log_km':
			return `Relevé du compteur « ${assetName?.(a.assetId) ?? 'véhicule'} » : ${kmFr(a.km)} le ${dateFr(a.date)} (${KM_SOURCES.find((x) => x.id === a.source)?.label ?? a.source})`;
	}
}

/** Transactions affected by an action (preview before confirmation). */
export function actionKeys(a: AiAction): string[] {
	if (a.type === 'recategorize' || a.type === 'exclude' || a.type === 'include' || a.type === 'tag') return a.keys;
	if (a.type === 'set_note') return [a.key];
	if (a.type === 'add_asset') return a.bien.linkedTxKeys;
	return [];
}

/**
 * Effects of an action on the app, provided by ai.svelte.ts (stores). An
 * action ONLY calls the effects it announces: "exclude" touches neither notes
 * nor categories (tested in tests/ia.test.ts).
 */
export interface ActionEffects {
	budget(categoryId: CategoryId): number | undefined;
	setBudget(categoryId: CategoryId, amount: number): void;
	overrides(): Record<string, CategoryId>;
	setOverrides(next: Record<string, CategoryId>): void;
	addRule(keyword: string, categoryId: CategoryId): { keyword: string; previous?: CatRule };
	restoreRule(keyword: string, previous?: CatRule): void;
	isExcluded(key: string): boolean;
	excludeKeys(keys: string[]): void;
	includeKeys(keys: string[]): void;
	/** Current note of a transaction ('' if none). */
	note(key: string): string;
	/** Writes the note; false if the transaction can't be edited (demo). */
	setNote(key: string, note: string): boolean;
	/** Current tags of a transaction ([] if none). */
	tags(key: string): string[];
	/** Writes the tags of several transactions, all or nothing: false (nothing changed) if one can't be edited (demo). */
	setTags(changes: { key: string; tags: string[] }[]): boolean;
	addGoal(goal: { name: string; targetAmount: number; targetDate?: string }): { id: string };
	removeGoal(id: string): void;
	addBien(asset: AssetInput): { id: string };
	removeBien(id: string): void;
	/** Adds an odometer reading; returns the refusal reason, or null. */
	logKm(assetId: string, reading: KmReading): string | null;
	removeKm(assetId: string, reading: Pick<KmReading, 'date' | 'km'>): void;
}

/**
 * Applies ONE confirmed action; returns its undo (session only). For `tag`,
 * all tags are read BEFORE writing so the undo restores the exact previous
 * state; existing tags come first and are never replaced (only those in
 * `remove` go, case-insensitive).
 */
export function applyAction(a: AiAction, fx: ActionEffects): () => void {
	switch (a.type) {
		case 'set_budget': {
			const prev = fx.budget(a.categoryId);
			fx.setBudget(a.categoryId, a.amount);
			return () => fx.setBudget(a.categoryId, prev ?? 0);
		}
		case 'recategorize': {
			const before = fx.overrides();
			const prev = new Map(a.keys.map((k) => [k, before[k]]));
			fx.setOverrides({ ...before, ...Object.fromEntries(a.keys.map((k) => [k, a.categoryId])) });
			return () => {
				const next = { ...fx.overrides() };
				for (const [k, v] of prev) {
					if (v === undefined) delete next[k];
					else next[k] = v;
				}
				fx.setOverrides(next);
			};
		}
		case 'add_rule': {
			const r = fx.addRule(a.keyword, a.categoryId);
			return () => fx.restoreRule(r.keyword, r.previous);
		}
		case 'exclude': {
			const changed = a.keys.filter((k) => !fx.isExcluded(k));
			fx.excludeKeys(changed);
			return () => fx.includeKeys(changed);
		}
		case 'include': {
			const changed = a.keys.filter((k) => fx.isExcluded(k));
			fx.includeKeys(changed);
			return () => fx.excludeKeys(changed);
		}
		case 'set_note': {
			const prev = fx.note(a.key);
			if (!fx.setNote(a.key, a.note)) throw new Error('note impossible sur une opération de démonstration');
			return () => void fx.setNote(a.key, prev);
		}
		case 'tag': {
			const changes = a.keys.flatMap((key) => {
				const before = fx.tags(key);
				const after = removeTags(addTags(before, a.add ?? []), a.remove ?? []);
				const same = before.length === after.length && before.every((t, i) => t === after[i]);
				return same ? [] : [{ key, avant: before, apres: after }];
			});
			if (changes.length && !fx.setTags(changes.map((c) => ({ key: c.key, tags: c.apres })))) throw new Error('tags impossibles sur une opération de démonstration');
			return () => {
				if (changes.length) fx.setTags(changes.map((c) => ({ key: c.key, tags: c.avant })));
			};
		}
		case 'add_goal': {
			const g = fx.addGoal({ name: a.name, targetAmount: a.targetAmount, ...(a.targetDate ? { targetDate: a.targetDate } : {}) });
			return () => fx.removeGoal(g.id);
		}
		case 'add_asset': {
			const b = fx.addBien(a.bien);
			return () => fx.removeBien(b.id);
		}
		case 'log_km': {
			const reading: KmReading = { date: a.date, km: a.km, source: a.source };
			const err = fx.logKm(a.assetId, reading);
			if (err) throw new Error(err);
			return () => fx.removeKm(a.assetId, reading);
		}
	}
}
