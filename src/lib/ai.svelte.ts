import type { CategoryId, Transaction } from './types';
import { CATEGORIES, categorize, getCategory, saveOverrides, txKey } from './categories';
import { flowKind } from './flow';
import { isPlannedInstalment, signedAmount } from './data';
import { merchantLabel } from './merchant';
import { subcategorize } from './subcategories';
import { accountLabel } from './accounts.svelte';
import { budgetState, setBudget } from './budget.svelte';
import { addRule, restoreRule, rulesState } from './rules.svelte';
import { getMerchantCategoryMap, getTransactions, updateImported, updateImportedMany } from './store.svelte';
import { excludeKeys, includeKeys, isExcluded } from './transfers.svelte';
import { addGoal, goalsState, removeGoal } from './goals.svelte';
import { vacationState } from './vacations.svelte';
import { getTaxNotices } from './taxes.svelte';
import { getNatixisEstimate } from './natixisHoldings.svelte';
import { getAccountsView, getAllocation, getAssets, getCryptoTotal, getEmployeeSavingsTotal, getNetWorth, getTaxProvision } from './wealth.svelte';
import { applyAction, parseActions, type ActionEffects, type AiAction } from './aiActions';
import { addAsset, assetsState, getAssetTotals, logKm, removeAsset, removeKm } from './assets.svelte';
import { vehicleSheet } from './car.svelte';
import { automateVehicle } from './carAuto.svelte';
import { getPendingMoney, getPortageEntries, getMatches, portageState } from './portage.svelte';
import { persistJson } from './storage';
import { effectiveDate } from './vacationDate';
import { isHeic, HEIC_MESSAGE, receiptQuestion, receiptRefusal } from './aiReceipt';

/**
 * AI analysis: client of the local relay (scripts/ia-relay.ts → headless Claude
 * Code, Claude subscription). Builds the data snapshot, sends the question,
 * reads the NDJSON stream (live text, steps, quota), then stores the answer,
 * the HTML report and the PROPOSED actions — applied only when the user
 * clicks « Confirmer », and undoable.
 */

const CONFIG_KEY = 'budget:ia-config';
const CHAT_KEY = 'budget:ia-chat';
const REPORTS_KEY = 'budget:ia-reports';
const MAX_MESSAGES = 80;
const MAX_REPORTS = 6;
const MAX_STORED_REPORT = 400_000;

export type AiModel = 'opus' | 'sonnet';
export type ActionState = 'pending' | 'applied' | 'dismissed' | 'failed' | 'undone';

export interface PendingAction {
	id: string;
	action: AiAction;
	state: ActionState;
	error?: string;
}

export interface AiMessage {
	id: string;
	role: 'user' | 'assistant';
	mode: 'chat' | 'report';
	text: string;
	at: string;
	error?: boolean;
	reportId?: string;
	actions?: PendingAction[];
	rejected?: string[];
}

export interface AiReport {
	id: string;
	title: string;
	prompt: string;
	html: string;
	createdAt: string;
}

export interface AiQuota {
	status?: string;
	utilization?: number;
	resetsAt?: number;
	rateLimitType?: string;
}

export interface Attachment {
	nom: string;
	taille: number;
	date: string;
}

interface AiConfig {
	url: string;
	token: string;
	model: AiModel;
}

function load<T>(key: string, fallback: T): T {
	if (typeof localStorage === 'undefined') return fallback;
	try {
		const raw = localStorage.getItem(key);
		return raw ? (JSON.parse(raw) as T) : fallback;
	} catch {
		return fallback;
	}
}

const config = load<AiConfig>(CONFIG_KEY, { url: 'http://127.0.0.1:8791', token: '', model: 'opus' });
const savedChat = load<{ sessionId: string; messages: AiMessage[] }>(CHAT_KEY, { sessionId: '', messages: [] });

export const aiState = $state({
	url: config.url,
	token: config.token,
	model: config.model,
	connection: 'unknown' as 'unknown' | 'checking' | 'ok' | 'offline' | 'bad-token',
	sessionId: savedChat.sessionId,
	messages: savedChat.messages,
	reports: load<AiReport[]>(REPORTS_KEY, []),
	busy: false,
	status: '',
	/** Text of the current step (stream), shown under the answer bubble. */
	live: '',
	quota: null as AiQuota | null,
	/** Attachments kept by the relay (.ia/workspace/pieces). */
	pieces: [] as Attachment[],
	/** Attachments added since the last question: cited in the next one. */
	piecesNouvelles: [] as string[],
	envoiPieces: false,
	/** Question prepared by another page (e.g. Voiture), put back in the input. */
	brouillon: ''
});

/** Prepares a question for the AI page (put in the input, not sent). */
export function prepareQuestion(text: string): void {
	aiState.brouillon = text;
}

/** Undo functions available during the session (not persisted: they are functions). */
const undoers = new Map<string, () => void>();
let controller: AbortController | null = null;

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const round2 = (n: number) => Math.round(n * 100) / 100;

export function saveConfig(patch: Partial<AiConfig>): void {
	if (patch.url !== undefined) aiState.url = patch.url.trim().replace(/\/+$/, '');
	if (patch.token !== undefined) aiState.token = patch.token.trim();
	if (patch.model !== undefined) aiState.model = patch.model;
	persistJson(CONFIG_KEY, { url: aiState.url, token: aiState.token, model: aiState.model });
}

/** Persists the chat: decided actions stay visible; a reloaded « pending » action can still be confirmed. */
function persistChat(): void {
	persistJson(CHAT_KEY, { sessionId: aiState.sessionId, messages: aiState.messages.slice(-MAX_MESSAGES) });
}

function persistReports(): void {
	persistJson(
		REPORTS_KEY,
		aiState.reports.filter((r) => r.html.length <= MAX_STORED_REPORT).slice(0, MAX_REPORTS)
	);
}

/** Checks that the relay answers and that the token is valid. */
export async function checkRelay(): Promise<void> {
	if (!aiState.token) {
		aiState.connection = 'bad-token';
		return;
	}
	aiState.connection = 'checking';
	try {
		const res = await fetch(`${aiState.url}/health`, { headers: { 'x-ia-token': aiState.token }, signal: AbortSignal.timeout(4000) });
		aiState.connection = res.ok ? 'ok' : res.status === 401 ? 'bad-token' : 'offline';
		if (res.ok) void listAttachments();
	} catch {
		aiState.connection = 'offline';
	}
}

/**
 * Snapshot sent to the relay: transactions categorised as in the app + budgets,
 * rules, wealth. It includes the purchase date (DDMM of the card label, debited
 * 1 to 5 days later) to match receipts; owned items, tracked APART since
 * netWorth doesn't count them; each vehicle's sheet (same computation as the
 * Voiture page, photo removed: useless for analysis and heavy); and portage
 * data (documents read, matched expense reports, entries added to the budget).
 */
export function buildSnapshot(): Record<string, unknown> {
	const merchantMap = getMerchantCategoryMap();
	const overrides = budgetState.overrides;
	const rules = rulesState.rules;
	const transactions = getTransactions().filter((tx) => !isPlannedInstalment(tx)).map((tx) => {
		const key = txKey(tx);
		const category = categorize(tx, overrides, rules, merchantMap);
		return {
			key,
			date: tx.booking_date || tx.value_date || '',
			purchaseDate: effectiveDate(tx) || tx.value_date || '',
			amount: round2(signedAmount(tx)),
			label: tx.remittance_information.join(' ').replace(/\s+/g, ' ').trim(),
			merchant: merchantLabel(tx.remittance_information) || '',
			account: tx.account ? accountLabel(tx.account) : '',
			category,
			subcategory: subcategorize(tx, overrides, rules, merchantMap) ?? '',
			flow: flowKind(category),
			excluded: isExcluded(key),
			note: tx.note ?? '',
			tags: tx.tags ?? []
		};
	});
	const dates = transactions.map((t) => t.date).filter(Boolean).sort();
	const safe = <T>(fn: () => T): T | null => {
		try {
			return fn();
		} catch {
			return null;
		}
	};
	return {
		meta: {
			generatedAt: new Date().toISOString(),
			period: { from: dates[0] ?? null, to: dates[dates.length - 1] ?? null },
			transactionCount: transactions.length,
			categories: CATEGORIES.map((c) => ({ id: c.id, label: c.label, flow: flowKind(c.id) }))
		},
		transactions,
		budgets: { ...budgetState.budgets },
		rules: rules.map((r) => ({ keyword: r.keyword, categoryId: r.categoryId })),
		patrimoine: {
			netWorth: safe(getNetWorth),
			accounts: safe(() => getAccountsView().map((a) => ({ label: a.label, kind: a.kind, balance: round2(a.balance) }))),
			allocation: safe(() => getAllocation().map((s) => ({ label: s.label, value: round2(s.value) }))),
			cryptoTotal: safe(getCryptoTotal),
			crypto: safe(() =>
				getAssets().map((a) => ({ symbol: a.symbol, qty: a.qty, eur: a.eur, avgCost: a.avgCost, pnlEur: a.pnlEur, pnlPct: a.pnlPct }))
			),
			epargneSalariale: safe(getEmployeeSavingsTotal),
			natixis: safe(getNatixisEstimate),
			taxProvision: safe(getTaxProvision),
			biens: assetsState.biens.map((b) => ({ ...b, linkedTxKeys: [...b.linkedTxKeys], ...(b.vehicle ? { vehicle: { ...b.vehicle, photo: undefined } } : {}) })),
			biensTotaux: safe(getAssetTotals),
			vehicules: safe(() =>
				assetsState.biens
					.filter((b) => b.type === 'vehicule')
					.map((b) => {
						const f = vehicleSheet(b, new Date().toISOString().slice(0, 10));
						return {
							id: b.id,
							name: b.name,
							kmAujourdhui: f.kmAujourdhui,
							kmParAn: f.km.moyenne,
							kmParAnnee: f.km.annees,
							valeur: f.valeur,
							valeurRetenue: { ...f.retenue, statut: f.retenue.theorique ? 'estimation théorique' : !f.retenue.tracked ? 'retenue' : f.retenue.confirmee ? 'validée' : 'à confirmer' },
							propositionIA: f.proposition ? { date: f.proposition.date, particulier: f.proposition.particulier, annonces: f.proposition.annonces.length, statut: 'en attente de validation' } : null,
							coutMensuel: { total: f.cout.total, mois: f.cout.mois, lignes: f.cout.lignes, amortissementParDefaut: f.cout.amortissementParDefaut, perteDeValeurComptee: f.cout.countsLoss, perte: f.cout.perte, sortiesParMois: f.cout.sortiesParMois, credit: f.cout.credit },
							prochainesEtapes: f.etapes
						};
					})
			)
		},
		impots: safe(getTaxNotices),
		goals: goalsState.goals.map((g) => ({ name: g.name, targetAmount: g.targetAmount, currentAmount: g.currentAmount, targetDate: g.targetDate })),
		vacations: vacationState.periods.map((p) => ({ label: p.label, start: p.start, end: p.end })),
		portage: safe(() => ({
			compte: portageState.data.compte ?? null,
			paies: portageState.data.paies,
			notesDeFrais: portageState.data.notes.map((n) => ({
				...n,
				lignes: (getMatches().get(n.numero) ?? []).map((r) => ({ ...r.ligne, etat: r.etat, achat: r.tx ? txKey(r.tx) : null }))
			})),
			argentEnAttente: getPendingMoney(),
			ecrituresBudget: getPortageEntries().map((t) => ({ date: t.booking_date, amount: round2(signedAmount(t)), label: t.remittance_information[0] ?? '', category: t.virtual_category, note: t.note ?? '' }))
		}))
	};
}

function titleOf(html: string, fallback: string): string {
	const m = /<title[^>]*>([^<]{1,140})<\/title>/i.exec(html) ?? /<h1[^>]*>([\s\S]{1,200}?)<\/h1>/i.exec(html);
	const t = m?.[1]?.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
	return t || fallback.slice(0, 80);
}

/**
 * Asks a question (chat) or requests a report; the stream is shown live. Files
 * dropped since the last question are listed so Claude knows which ones to
 * read.
 */
export async function ask(prompt: string, mode: 'chat' | 'report'): Promise<void> {
	const text = prompt.trim();
	if (!text || aiState.busy) return;
	const now = new Date().toISOString();
	aiState.messages = [...aiState.messages, { id: uid(), role: 'user', mode, text, at: now }];
	const reply: AiMessage = { id: uid(), role: 'assistant', mode, text: '', at: now };
	aiState.messages = [...aiState.messages, reply];
	const patchReply = (patch: Partial<AiMessage>) => {
		aiState.messages = aiState.messages.map((m) => (m.id === reply.id ? { ...m, ...patch } : m));
	};
	aiState.busy = true;
	aiState.status = 'Envoi des données…';
	aiState.live = '';
	controller = new AbortController();

	const attachments = aiState.piecesNouvelles;
	const sentPrompt = attachments.length ? `${text}\n\n(Pièces jointes : ${attachments.map((n) => `pieces/${n}`).join(', ')})` : text;
	aiState.piecesNouvelles = [];

	try {
		const snapshot = buildSnapshot();
		const res = await fetch(`${aiState.url}/ask`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', 'x-ia-token': aiState.token },
			body: JSON.stringify({ prompt: sentPrompt, mode, model: aiState.model, ...(aiState.sessionId ? { sessionId: aiState.sessionId } : {}), snapshot }),
			signal: controller.signal
		});
		if (!res.ok || !res.body) {
			const err = await res.json().catch(() => ({ error: `Erreur ${res.status}` }));
			if (res.status === 401) aiState.connection = 'bad-token';
			throw new Error((err as { error?: string }).error ?? `Erreur ${res.status}`);
		}
		aiState.connection = 'ok';
		const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
		let buf = '';
		let done = false;
		while (!done) {
			const chunk = await reader.read();
			if (chunk.done) break;
			buf += chunk.value;
			let i: number;
			while ((i = buf.indexOf('\n')) >= 0) {
				const line = buf.slice(0, i).trim();
				buf = buf.slice(i + 1);
				if (!line) continue;
				let ev: Record<string, unknown>;
				try {
					ev = JSON.parse(line);
				} catch {
					continue;
				}
				if (ev.type === 'delta') aiState.live += String(ev.text ?? '');
				else if (ev.type === 'turn') aiState.live = '';
				else if (ev.type === 'status') aiState.status = String(ev.text ?? '');
				else if (ev.type === 'quota') aiState.quota = (ev.info as AiQuota) ?? null;
				else if (ev.type === 'error') throw new Error(String(ev.message ?? 'Erreur du relais.'));
				else if (ev.type === 'done') {
					done = true;
					if (typeof ev.sessionId === 'string' && ev.sessionId) aiState.sessionId = ev.sessionId;
					const final = String(ev.text ?? '') || aiState.live;
					const patch: Partial<AiMessage> = { text: final || '(réponse vide)', error: ev.isError === true };
					if (typeof ev.report === 'string' && ev.report.trim()) {
						const report: AiReport = { id: uid(), title: titleOf(ev.report, text), prompt: text, html: ev.report, createdAt: new Date().toISOString() };
						aiState.reports = [report, ...aiState.reports].slice(0, MAX_REPORTS);
						patch.reportId = report.id;
						persistReports();
					} else if (mode === 'report' && !patch.error) {
						patch.text = `${patch.text}\n\n*(Aucun fichier de rapport n'a été produit.)*`;
					}
					if (ev.actions !== undefined && ev.actions !== null) {
						const ctx = {
							categoryIds: new Set(CATEGORIES.map((c) => c.id as string)),
							txKeys: new Set(getTransactions().map(txKey)),
							vehicleIds: new Set(assetsState.biens.filter((b) => b.type === 'vehicule').map((b) => b.id))
						};
						const parsed = parseActions(ev.actions, ctx);
						patch.actions = parsed.actions.map((action) => ({ id: uid(), action, state: 'pending' as const }));
						if (parsed.rejected.length) patch.rejected = parsed.rejected.map((r) => r.reason);
					}
					patchReply(patch);
				}
			}
		}
		if (!done) throw new Error('Le relais a coupé la réponse avant la fin.');
	} catch (e) {
		const aborted = e instanceof DOMException && e.name === 'AbortError';
		const offline = e instanceof TypeError;
		if (offline) aiState.connection = 'offline';
		patchReply({
			error: !aborted,
			text: aborted
				? `${aiState.live ? aiState.live + '\n\n' : ''}*(Arrêté.)*`
				: offline
					? 'Relais injoignable. Lance `npm run ia` dans le dossier app/, puis réessaie.'
					: `Erreur : ${e instanceof Error ? e.message : String(e)}`
		});
	} finally {
		aiState.busy = false;
		aiState.status = '';
		aiState.live = '';
		controller = null;
		persistChat();
	}
}

export function stop(): void {
	controller?.abort();
}

/** New conversation: the local history and the Claude session start over (reports stay). */
export function resetConversation(): void {
	if (aiState.busy) return;
	aiState.messages = [];
	aiState.sessionId = '';
	undoers.clear();
	persistChat();
}

export function removeReport(id: string): void {
	aiState.reports = aiState.reports.filter((r) => r.id !== id);
	persistReports();
}

function setActionState(msgId: string, actionId: string, state: ActionState, error?: string): void {
	aiState.messages = aiState.messages.map((m) =>
		m.id !== msgId ? m : { ...m, actions: m.actions?.map((p) => (p.id === actionId ? { ...p, state, ...(error ? { error } : { error: undefined }) } : p)) }
	);
	persistChat();
}

/** Key → transaction index, recomputed only when the list changes (tags read before a batch action). */
let index: { liste: Transaction[]; parCle: Map<string, Transaction> } | null = null;
function byKey(): Map<string, Transaction> {
	const list = getTransactions();
	if (index?.liste !== list) index = { liste: list, parCle: new Map(list.map((t): [string, Transaction] => [txKey(t), t])) };
	return index.parCle;
}

/** Empty tags → field removed (nothing stored). */
const tagsOrNone = (tags: string[]) => (tags.length ? tags : undefined);

/** Real effects of the AI actions (app stores): see applyAction (aiActions.ts). */
const effects: ActionEffects = {
	budget: (id) => budgetState.budgets[id],
	setBudget,
	overrides: () => budgetState.overrides,
	setOverrides: (next) => {
		budgetState.overrides = next;
		saveOverrides(next);
	},
	addRule,
	restoreRule,
	isExcluded,
	excludeKeys,
	includeKeys,
	note: (key) => getTransactions().find((t) => txKey(t) === key)?.note ?? '',
	setNote: (key, note) => updateImported(key, { note }),
	tags: (key) => [...(byKey().get(key)?.tags ?? [])],
	// All or nothing, in one write: one non-editable (demo) transaction cancels everything
	setTags: (changes) => {
		const patches = new Map(changes.map((c) => [c.key, { tags: tagsOrNone(c.tags) }]));
		return updateImportedMany(patches, { toutOuRien: true }) === patches.size;
	},
	addGoal,
	removeGoal,
	// New vehicle proposed by the AI: purchase payments and valuation are looked up automatically
	addBien: (asset) => {
		const b = addAsset(asset);
		if (b.type === 'vehicule') void automateVehicle(b.id);
		return b;
	},
	removeBien: (id) => void removeAsset(id),
	logKm,
	removeKm
};

/* ---------- Attachments (PDF, images): kept by the relay in .ia/workspace/pieces ---------- */

const ATTACHMENT_OK = /\.(pdf|png|jpe?g|webp|gif|txt|csv)$/i;
const MAX_ATTACHMENT = 25 * 1024 * 1024;
/** Longest side of a sent photo: Claude reads it downscaled anyway (≈ 1,600 px). */
const MAX_SIDE = 2000;
const MAX_PHOTO = 3 * 1024 * 1024;

/**
 * Photo (JPEG, PNG, WebP) ALWAYS re-encoded as JPEG before sending: its metadata
 * (including the GPS position) never leaves, even for a small image. Beyond
 * 2,000 px it is also downscaled (lighter for the relay and for Claude). A
 * white background keeps a transparent PNG screenshot readable as JPEG, and
 * the quality is a bit higher under 3 MB so a receipt's text stays sharp. Any
 * error (undecodable format) → the file is sent as is.
 */
export async function shrinkImage(f: File): Promise<File> {
	if (!/\.(jpe?g|png|webp)$/i.test(f.name) || typeof createImageBitmap === 'undefined' || typeof document === 'undefined') return f;
	try {
		const bmp = await createImageBitmap(f, { imageOrientation: 'from-image' });
		const side = Math.max(bmp.width, bmp.height);
		const r = Math.min(1, MAX_SIDE / side);
		const canvas = document.createElement('canvas');
		canvas.width = Math.max(1, Math.round(bmp.width * r));
		canvas.height = Math.max(1, Math.round(bmp.height * r));
		const ctx = canvas.getContext('2d');
		if (!ctx) {
			bmp.close();
			return f;
		}
		ctx.fillStyle = '#fff';
		ctx.fillRect(0, 0, canvas.width, canvas.height);
		ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
		bmp.close();
		const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/jpeg', f.size > MAX_PHOTO ? 0.88 : 0.92));
		return blob ? new File([blob], f.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' }) : f;
	} catch {
		return f;
	}
}

/** Lists the attachments kept by the relay (offline relay: the list comes back on reconnection). */
export async function listAttachments(): Promise<void> {
	if (!aiState.token) return;
	try {
		const res = await fetch(`${aiState.url}/pieces`, { headers: { 'x-ia-token': aiState.token }, signal: AbortSignal.timeout(4000) });
		if (res.ok) aiState.pieces = ((await res.json()) as { pieces: Attachment[] }).pieces;
	} catch {
	}
}

/** Sends files to the relay; returns readable refusals. `received` (optional) receives the names kept by the relay. */
export async function sendAttachments(files: File[], received?: string[]): Promise<string[]> {
	const refusals: string[] = [];
	aiState.envoiPieces = true;
	try {
		for (const f of files) {
			if (!ATTACHMENT_OK.test(f.name)) {
				refusals.push(`${f.name} : ${isHeic(f.name) ? HEIC_MESSAGE : 'format non pris en charge (PDF, image, texte ou CSV)'}`);
				continue;
			}
			const upload = await shrinkImage(f);
			if (upload.size > MAX_ATTACHMENT) {
				refusals.push(`${f.name} : plus de 25 Mo`);
				continue;
			}
			const res = await fetch(`${aiState.url}/pieces?nom=${encodeURIComponent(upload.name)}`, {
				method: 'POST',
				headers: { 'content-type': 'application/octet-stream', 'x-ia-token': aiState.token },
				body: upload
			});
			const r = (await res.json().catch(() => ({}))) as { nom?: string; error?: string };
			if (!res.ok || !r.nom) refusals.push(`${f.name} : ${r.error ?? `erreur ${res.status}`}`);
			else {
				received?.push(r.nom);
				if (!aiState.piecesNouvelles.includes(r.nom)) aiState.piecesNouvelles = [...aiState.piecesNouvelles, r.nom];
			}
		}
	} catch {
		refusals.push('relais injoignable : lance `npm run ia`');
	} finally {
		aiState.envoiPieces = false;
		await listAttachments();
	}
	return refusals;
}

/**
 * Receipt (photo or PDF): sent to the relay, then analysed right away with the
 * prepared question (details = text already typed). Names kept by the relay
 * count even when already pending (attached earlier with « Joindre »), so the
 * receipt is analysed. The answer arrives in the conversation; returns the
 * refusals to display.
 */
export async function analyzeReceipt(files: File[], details = ''): Promise<string[]> {
	if (aiState.busy || aiState.envoiPieces) return [];
	const refusals = files.flatMap((f) => {
		const r = receiptRefusal(f.name);
		return r ? [`${f.name} : ${r}`] : [];
	});
	const ok = files.filter((f) => !receiptRefusal(f.name));
	if (!ok.length) return refusals;
	const received: string[] = [];
	refusals.push(...(await sendAttachments(ok, received)));
	if (received.length) void ask(receiptQuestion(received.length, details), 'chat');
	return refusals;
}

/** Removes an attachment from the relay (file deleted from the pieces folder). */
export async function removeAttachment(name: string): Promise<void> {
	try {
		await fetch(`${aiState.url}/pieces?nom=${encodeURIComponent(name)}`, { method: 'DELETE', headers: { 'x-ia-token': aiState.token } });
	} finally {
		aiState.piecesNouvelles = aiState.piecesNouvelles.filter((n) => n !== name);
		await listAttachments();
	}
}

/** Name of an asset (AI action description). */
export const assetName = (id: string): string | undefined => assetsState.biens.find((b) => b.id === id)?.name;

/** Applies ONE confirmed action; records its undo for the session. */
function execute(a: AiAction): () => void {
	return applyAction(a, effects);
}

export function confirmAction(msgId: string, actionId: string): void {
	const p = aiState.messages.find((m) => m.id === msgId)?.actions?.find((x) => x.id === actionId);
	if (!p || p.state !== 'pending') return;
	try {
		undoers.set(actionId, execute(p.action));
		setActionState(msgId, actionId, 'applied');
	} catch (e) {
		setActionState(msgId, actionId, 'failed', e instanceof Error ? e.message : String(e));
	}
}

export function dismissAction(msgId: string, actionId: string): void {
	setActionState(msgId, actionId, 'dismissed');
}

export function canUndo(actionId: string): boolean {
	return undoers.has(actionId);
}

export function undoAction(msgId: string, actionId: string): void {
	const fn = undoers.get(actionId);
	if (!fn) return;
	fn();
	undoers.delete(actionId);
	setActionState(msgId, actionId, 'undone');
}

/** Category label for describeAction. */
export const catLabel = (id: CategoryId): string => getCategory(id).label;
