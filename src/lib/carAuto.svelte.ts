/**
 * Vehicle automations:
 * - purchase payments attached automatically (deposit + balance);
 * - PDF documents (purchase order, purchase or workshop invoice) read, applied to the right car (or
 *   creating one) and stored in the vault;
 * - valuation searched by the AI analysis (local relay) ONLY when the user asks for it. The result
 *   is a proposal: the retained value changes only when the user validates it (or types their own).
 */

import type { Asset, ValueSource } from './assets';
import { validateAsset } from './assets';
import { addAsset, attachTx, assetsState, updateAsset } from './assets.svelte';
import { txKey } from './categories';
import { getTransactions } from './store.svelte';
import { valuationFromSearch, plateDate, purchasePayments, patchConfirmValue, patchIgnoreProposal, patchRetainValue, patchAcceptProposal } from './vehicle';
import { applyVehicleDocument, readVehicleDocument, vehicleOfDocument } from './pdfVehicle';
import { vehicleSheet } from './car.svelte';

const today = () => new Date().toISOString().slice(0, 10);

export const autoState = $state({
	/** Vehicles whose valuation is being searched. */
	coteEnCours: [] as string[],
	/** Last message (success or error) per vehicle. */
	messages: {} as Record<string, string>
});

/** AI analysis relay (address + token), as set on the AI page. */
function relay(): { url: string; token: string } | null {
	try {
		const c = JSON.parse(localStorage.getItem('budget:ia-config') ?? 'null') as { url?: string; token?: string } | null;
		return c?.url && c.token ? { url: c.url.replace(/\/+$/, ''), token: c.token } : null;
	} catch {
		return null;
	}
}

/** Year of first registration: registration document, else plate, else purchase. */
function registrationYear(b: Asset): number {
	const d = b.vehicle?.firstRegistration ?? (b.vehicle?.plate ? plateDate(b.vehicle.plate)?.estimee : undefined) ?? b.purchaseDate;
	return Number(d.slice(0, 4));
}

/** Attaches the purchase payments if there are none yet (deposit + balance ≈ price). */
export function linkPurchasePayments(b: Asset): number {
	if (b.purchasePrice <= 0) return 0;
	const alreadyLinked = new Set(assetsState.biens.flatMap((x) => x.linkedTxKeys));
	const keys = purchasePayments(b, getTransactions(), txKey, alreadyLinked);
	for (const k of keys) attachTx(b.id, k);
	return keys.length;
}

/**
 * Valuation searched by the AI analysis (comparable listings), asked by the user: saved as a
 * PROPOSAL with its history; the retained value does not move until the user validates it.
 * Returns a readable message (also kept in autoState.messages).
 */
export async function refreshValuation(id: string): Promise<string> {
	const b = assetsState.biens.find((x) => x.id === id);
	const r = relay();
	if (!b) return 'véhicule introuvable';
	if (!r) return (autoState.messages[id] = 'Estimation IA : règle d’abord le relais dans la page Analyse IA.');
	if (autoState.coteEnCours.includes(id)) return 'déjà en cours';
	autoState.coteEnCours = [...autoState.coteEnCours, id];
	try {
		const km = vehicleSheet(b, today()).kmAujourdhui ?? undefined;
		const res = await fetch(`${r.url}/cote`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', 'x-ia-token': r.token },
			body: JSON.stringify({ vehicule: { nom: b.name, annee: registrationYear(b), ...(b.vehicle?.version ? { version: b.vehicle.version } : {}), ...(km !== undefined ? { km } : {}) } })
		});
		const body = (await res.json().catch(() => ({}))) as { cote?: unknown; error?: string };
		const valuation = res.ok ? valuationFromSearch(body.cote, today()) : null;
		if (!valuation) return (autoState.messages[id] = `Pas de proposition : ${body.error ?? 'réponse inutilisable'}.`);
		const current = assetsState.biens.find((x) => x.id === id);
		if (!current) return 'véhicule supprimé entre-temps';
		const history = [...(current.vehicle?.coteHistorique ?? []).filter((h) => h.date !== valuation.date), { date: valuation.date, valeur: valuation.particulier! }].slice(-60);
		updateAsset(id, { vehicle: { ...(current.vehicle ?? { kmLog: [] }), cote: valuation, coteHistorique: history } });
		return (autoState.messages[id] = `Proposition IA : ${valuation.particulier!.toLocaleString('fr-FR')} € entre particuliers (${valuation.annonces.length} annonce${valuation.annonces.length > 1 ? 's' : ''}) : à valider ou ignorer, ta valeur retenue ne bouge pas d'ici là.`);
	} catch {
		return (autoState.messages[id] = 'Pas de proposition : relais IA injoignable (npm run ia).');
	} finally {
		autoState.coteEnCours = autoState.coteEnCours.filter((x) => x !== id);
	}
}

/** Relay reachable with a valid token? */
async function isRelayReady(): Promise<boolean> {
	const r = relay();
	if (!r) return false;
	try {
		const res = await fetch(`${r.url}/health`, { headers: { 'x-ia-token': r.token }, signal: AbortSignal.timeout(4000) });
		const h = (await res.json().catch(() => ({}))) as { busy?: boolean };
		return res.ok && !h.busy;
	} catch {
		return false;
	}
}

/**
 * Everything that can be done alone for a vehicle: the purchase payments. The AI valuation runs only
 * on demand (`forcerCote`, the « Demander une estimation » button) and only proposes a value.
 */
export async function automateVehicle(id: string, opts: { forcerCote?: boolean } = {}): Promise<void> {
	const b = assetsState.biens.find((x) => x.id === id);
	if (!b || b.type !== 'vehicule') return;
	if (!b.linkedTxKeys.length) linkPurchasePayments(b);
	if (opts.forcerCote && (await isRelayReady())) await refreshValuation(id);
}

/** Applies a pure patch to a vehicle and keeps a readable message; null patch → `fallback`. */
function applyPatch(id: string, patch: Partial<Asset> | null, message: string, fallback: string): string {
	if (!patch) return (autoState.messages[id] = fallback);
	updateAsset(id, patch);
	return (autoState.messages[id] = message);
}

/** The pending AI proposal becomes the retained value (source « estimation IA », confirmed today). */
export function acceptProposal(id: string): string {
	const b = assetsState.biens.find((x) => x.id === id);
	const amount = b?.vehicle?.cote?.particulier;
	return applyPatch(id, b ? patchAcceptProposal(b, today()) : null, `Valeur retenue : ${amount?.toLocaleString('fr-FR')} € (estimation IA validée).`, 'Aucune proposition en attente.');
}

/** The pending AI proposal is set aside: the retained value stays as it is. */
export function ignoreProposal(id: string): string {
	const b = assetsState.biens.find((x) => x.id === id);
	return applyPatch(id, b ? patchIgnoreProposal(b) : null, 'Proposition écartée : ta valeur retenue ne change pas.', 'Aucune proposition en attente.');
}

/** The current retained value is confirmed as it is. */
export function confirmValue(id: string): string {
	const b = assetsState.biens.find((x) => x.id === id);
	return applyPatch(id, b ? patchConfirmValue(b) : null, 'Valeur retenue confirmée.', 'Pas de valeur à confirmer.');
}

/** A value given by the user (amount and source) becomes the retained, confirmed value. */
export function retainValue(id: string, amount: number, source: ValueSource): string {
	const ok = Number.isFinite(amount) && amount > 0 && amount <= 10_000_000;
	return applyPatch(id, ok ? patchRetainValue(amount, source, today()) : null, `Valeur retenue : ${Math.round(amount).toLocaleString('fr-FR')} €.`, 'Montant invalide.');
}

/** Storage name in the vault: vehicules/<plate or name>/<file>. */
function vaultPath(b: Asset, fileName: string): string {
	const folder = (b.vehicle?.plate ?? b.name).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '') || 'vehicule';
	const name = fileName.split(/[\\/]/).pop()!.replace(/[^\p{L}\p{N} ._()+-]/gu, '_').slice(-120) || 'document.pdf';
	return `vehicules/${folder}/${name}`;
}

async function storeInVault(b: Asset, f: File): Promise<boolean> {
	try {
		const res = await fetch(`/__data/documents?nom=${encodeURIComponent(vaultPath(b, f.name))}`, { method: 'POST', headers: { 'x-budget-data': '1', 'content-type': 'application/pdf' }, body: f });
		return res.ok;
	} catch {
		return false;
	}
}

/**
 * PDF documents of a vehicle: read, applied to the right car (same plate, else same model) or to a
 * new one, stored in the vault, then automations started. Returns a summary per file.
 */
export async function importCarDocuments(files: File[]): Promise<{ resumes: string[]; vehicules: string[] }> {
	const { extractPdfPages } = await import('./pdfNatixis');
	const summaries: string[] = [];
	const touched = new Set<string>();
	for (const f of files) {
		try {
			const doc = readVehicleDocument(await extractPdfPages(await f.arrayBuffer()));
			if ('error' in doc) {
				summaries.push(`${f.name} : ${doc.error}`);
				continue;
			}
			const vehicles = assetsState.biens.filter((b) => b.type === 'vehicule');
			const target = vehicleOfDocument(vehicles, doc);
			const { saisi: input, changements: changes } = applyVehicleDocument(target, doc);
			const v = validateAsset(input);
			if (typeof v === 'string') {
				summaries.push(`${f.name} : ${v}`);
				continue;
			}
			let b: Asset;
			if (target) {
				updateAsset(target.id, v);
				b = assetsState.biens.find((x) => x.id === target.id)!;
			} else {
				b = addAsset(v);
			}
			touched.add(b.id);
			const stored = await storeInVault(b, f);
			summaries.push(`${f.name} (${doc.type === 'achat' ? 'achat' : doc.type === 'atelier' ? 'atelier' : 'document'}) : ${changes.length ? changes.join(' · ') : 'rien de nouveau'}${stored ? ' · rangé au coffre' : ''}`);
		} catch (e) {
			summaries.push(`${f.name} : lecture impossible (${e instanceof Error ? e.message : String(e)})`);
		}
	}
	for (const id of touched) void automateVehicle(id);
	return { resumes: summaries, vehicules: [...touched] };
}
