import { applyTree, layoutState } from './layout.svelte';
import { blockKey } from './layoutModel';
import { layoutTiles } from './tiles';
import { aiState } from './ai.svelte';
import { buildLayoutRequest, createRequestTracker, readLayoutAnswer, validateAiTree, MAX_INSTRUCTION, type AiBlockMeta } from './aiLayout';
import { showToast } from './ui.svelte';

/**
 * « ✨ Organiser par l'IA »: the dialog state, the call to the local relay (POST /disposition) and
 * the tree applied with « Annuler ». Opened from the tile menu or the command palette.
 */

/** Longest wait for the relay (Claude answers in a few seconds; the relay itself stops at 90 s). */
const TIMEOUT_MS = 45_000;

/** Only the latest request may apply its answer: closing the dialog or sending again makes it stale. */
const tracker = createRequestTracker();

/** Request in progress, aborted when the dialog closes (the relay then stops Claude). */
let inFlight: AbortController | null = null;

export const organizeState = $state({
	/** Page whose dialog is open (null: closed). */
	page: null as string | null,
	consigne: '',
	busy: false,
	erreur: '',
	/** The error comes from the relay setup: the dialog offers to open the « Analyse IA » page. */
	versIa: false
});

/** Opens the dialog for a page (the instruction typed last time is kept). */
export function openOrganize(page: string): void {
	organizeState.page = page;
	organizeState.erreur = '';
	organizeState.versIa = false;
}

/** Closes the dialog and cancels the running request: its answer, if any, is never applied. */
export function closeOrganize(): void {
	tracker.annuler();
	inFlight?.abort();
	inFlight = null;
	organizeState.page = null;
	organizeState.busy = false;
	organizeState.erreur = '';
	organizeState.versIa = false;
}

/** Sets the error shown in the dialog. */
function fail(message: string, toAiPage = false): void {
	organizeState.busy = false;
	organizeState.erreur = message;
	organizeState.versIa = toAiPage;
}

/**
 * Asks the relay for a layout of the open page, checks it against the blocks on screen and applies
 * it with an undo toast quoting the AI's explanation. Errors stay in the dialog (nothing changes).
 * Each request holds a ticket: an answer arriving after a close or a newer request is dropped, so
 * one request applies at most one tree (one undo snapshot).
 */
export async function organizePage(): Promise<void> {
	const page = organizeState.page;
	if (!page || organizeState.busy) return;
	const screen = layoutState.screens[page];
	if (!screen || screen.visible.length < 2) return fail('Il faut au moins deux blocs affichés sur la page pour les organiser.');
	if (!aiState.token) return fail('Relais IA non configuré : colle son jeton dans la page Analyse IA.', true);
	const meta: Record<string, AiBlockMeta> = layoutState.registry[page] ?? {};
	const naturalHeights: Record<string, number> = {};
	for (const id of screen.visible) {
		const h = layoutState.natural[blockKey(page, id)];
		if (typeof h === 'number') naturalHeights[id] = h;
	}
	const sizes = layoutTiles(screen.tree, { x: 0, y: 0, w: screen.size.w, h: screen.size.h }).tiles;
	const request = buildLayoutRequest(page, screen, meta, naturalHeights, sizes, organizeState.consigne.slice(0, MAX_INSTRUCTION));
	inFlight?.abort();
	const controller = new AbortController();
	inFlight = controller;
	const ticket = tracker.demarrer();
	organizeState.busy = true;
	organizeState.erreur = '';
	organizeState.versIa = false;
	let res: Response;
	try {
		res = await fetch(`${aiState.url}/disposition`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', 'x-ia-token': aiState.token },
			body: JSON.stringify({ demande: request }),
			signal: AbortSignal.any([controller.signal, AbortSignal.timeout(TIMEOUT_MS)])
		});
	} catch (e) {
		if (!tracker.estCourant(ticket)) return;
		const timeout = e instanceof DOMException && e.name === 'TimeoutError';
		return fail(timeout ? "L'IA n'a pas répondu à temps : réessaie dans un instant." : 'Relais IA injoignable : lance « npm run ia » (voir la page Analyse IA).', !timeout);
	}
	const body = (await res.json().catch(() => ({}))) as { error?: string };
	if (!tracker.estCourant(ticket) || organizeState.page !== page) return;
	inFlight = null;
	if (res.status === 401) return fail('Jeton du relais IA refusé : recolle-le dans la page Analyse IA.', true);
	if (res.status === 409) return fail('Le relais IA travaille déjà sur une autre demande : réessaie dans un instant.');
	if (!res.ok) return fail(`L'IA n'a pas pu organiser la page : ${body.error ?? `erreur ${res.status}`}.`);
	const answer = readLayoutAnswer(body);
	if ('erreur' in answer) return fail(answer.erreur);
	const titles = Object.fromEntries(Object.entries(meta).map(([id, m]) => [id, m.title]));
	const validation = validateAiTree(answer.arbre, screen.visible, titles);
	if ('erreur' in validation) return fail(validation.erreur);
	tracker.annuler();
	applyTree(page, validation.arbre, answer.explication ? `Disposition proposée par l'IA : ${answer.explication}` : "Disposition proposée par l'IA");
	closeOrganize();
}

/** Plugs the feature into the tile menu (called once at startup). */
export function wireAiOrganize(): void {
	layoutState.organiserIA = (page) => openOrganize(page);
}

/** Palette command: the page with tiles on screen, else a short explanation. */
export function organizeCurrentPage(): void {
	const page = layoutState.currentPage;
	if (page) openOrganize(page);
	else showToast("Ouvre d'abord une page à blocs (Accueil, Budget, Analyse, Patrimoine…).");
}
