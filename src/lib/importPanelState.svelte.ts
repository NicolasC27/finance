import { uiState, showToast } from './ui.svelte';
import { navigate } from './router.svelte';
import { recordImport } from './importsLog.svelte';
import { detectFile, detectPdf, isPdf, type ImportTarget, type ImportFamily } from './importDetection';
import { extractPdfPages } from './pdfNatixis';
import { importPortagePdf } from './portage.svelte';
import { importCarDocuments } from './carAuto.svelte';
import { isModuleActive, setModuleActive } from './modules.svelte';
import type { ModuleId } from './modules';

/**
 * « Imports » panel: one place to drop any file. Each file is recognised
 * (importDetection.ts), then handed to its existing importer, unchanged:
 * - Transactions: uiState.importsEnAttente, consumed by the page (usual
 *   multi-file import, import feedback and column remapping);
 * - Portage and Voiture: their importers are library functions
 *   (importPortagePdf, importCarDocuments), called from here.
 */

export interface ImportLine {
	nom: string;
	famille: ImportFamily | null;
	cible: ImportTarget | null;
	/** What happened: sent to Transactions, reading summary, or refusal reason. */
	message: string;
	ok: boolean;
}

export const importPanelState = $state({
	enCours: false,
	/** Files of the last drop, in order. */
	lignes: [] as ImportLine[]
});

export function openImportPanel(): void {
	uiState.importPanelOpen = true;
}

/** "2 PDF" or the file name: label for the import log. */
const batchLabel = (files: File[], noun: string) => (files.length === 1 ? files[0]!.name : `${files.length} ${noun}`);

/** Attaches an importer's summaries (one per file, in order) to the batch rows. The file name is already on the row, so it is stripped from the summary ("facture.pdf (atelier) : …" → "(atelier) : …"). */
function attachSummaries(rows: ImportLine[], batch: File[], summaries: readonly string[]): void {
	batch.forEach((f, i) => {
		const row = rows.find((l) => l.nom === f.name && l.message === '');
		if (!row) return;
		const summary = summaries[i] ?? 'lu';
		row.message = summary.startsWith(f.name) ? summary.slice(f.name.length).replace(/^\s*:\s*/, '').trim() || 'lu' : summary;
	});
}

/** Module of the page that shows an imported family (null: essential pages only). */
const MODULE_BY_FAMILY: Partial<Record<ImportFamily, ModuleId>> = {
	'kraken-csv': 'crypto',
	'krak-pdf': 'crypto',
	'natixis-csv': 'patrimoine',
	'natixis-pdf': 'patrimoine',
	'impot-pdf': 'patrimoine',
	infoportage: 'portage',
	vehicule: 'voiture'
};

/** A file of a switched-off module brings the module back (its page is where the data shows), with a toast. */
function enableImportedModules(rows: readonly ImportLine[]): void {
	for (const row of rows) {
		const id = row.ok && row.famille ? MODULE_BY_FAMILY[row.famille] : undefined;
		if (id && !isModuleActive(id)) showToast(`${setModuleActive(id, true)} : il affiche ce que tu viens d'importer.`, 'Annuler', () => setModuleActive(id, false));
	}
}

/** Recognises each file, then hands it to its importer. A PDF is read once for all signatures (pdfjs loaded on demand). The import feedback (additions, duplicates, remapping) is shown on Transactions, so the panel closes. */
export async function importFiles(fileList: FileList | File[] | null | undefined): Promise<void> {
	const files = [...(fileList ?? [])];
	if (files.length === 0 || importPanelState.enCours) return;
	importPanelState.enCours = true;
	importPanelState.lignes = [];
	const rows: ImportLine[] = [];
	const batches: Record<ImportTarget, File[]> = { transactions: [], portage: [], voiture: [] };
	try {
		for (const f of files) {
			try {
				const buffer = await f.arrayBuffer();
				const d = isPdf(f.name, f.type) ? detectPdf(await extractPdfPages(buffer)) : detectFile(f.name, buffer);
				if (d.famille === null) {
					rows.push({ nom: f.name, famille: null, cible: null, message: d.raison, ok: false });
					continue;
				}
				rows.push({ nom: f.name, famille: d.famille, cible: d.cible, message: '', ok: true });
				batches[d.cible].push(f);
			} catch (e) {
				rows.push({ nom: f.name, famille: null, cible: null, message: `lecture impossible (${e instanceof Error ? e.message : String(e)})`, ok: false });
			}
		}
		if (batches.portage.length > 0) {
			attachSummaries(rows, batches.portage, await importPortagePdf(batches.portage));
			recordImport('portage', batchLabel(batches.portage, 'PDF'));
		}
		if (batches.voiture.length > 0) {
			attachSummaries(rows, batches.voiture, (await importCarDocuments(batches.voiture)).resumes);
			recordImport('vehicule', batchLabel(batches.voiture, 'documents'));
		}
		if (batches.transactions.length > 0) {
			for (const l of rows) if (l.cible === 'transactions') l.message = 'importé par la page Transactions';
			uiState.importsEnAttente = batches.transactions;
		}
	} finally {
		importPanelState.lignes = rows;
		importPanelState.enCours = false;
	}
	enableImportedModules(rows);
	const rejected = rows.filter((l) => !l.ok);
	const others = rows.filter((l) => l.ok && l.cible !== 'transactions');
	if (batches.transactions.length > 0) {
		uiState.importPanelOpen = false;
		navigate('/transactions');
		if (rejected.length > 0 || others.length > 0) {
			const parts = [
				others.length > 0 ? `${others.length} document${others.length > 1 ? 's' : ''} lu${others.length > 1 ? 's' : ''} (Portage, Voiture)` : '',
				rejected.length > 0 ? `${rejected.length} fichier${rejected.length > 1 ? 's' : ''} non reconnu${rejected.length > 1 ? 's' : ''}` : ''
			].filter(Boolean);
			showToast(parts.join(' · '), 'Détails', openImportPanel);
		}
	}
}
