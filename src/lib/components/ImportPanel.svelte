<script lang="ts">
	import { onMount } from 'svelte';
	import { uiState } from '$lib/ui.svelte';
	import SidePanel from './SidePanel.svelte';
	import { navigate, route } from '$lib/router.svelte';
	import { formatDate, formatMonth } from '$lib/format';
	import { importsState, SOURCE_LABELS, type ImportEntry, type ImportSource } from '$lib/importsLog.svelte';
	import { importFiles, importPanelState } from '$lib/importPanelState.svelte';
	import { FAMILY_LABELS } from '$lib/importDetection';

	/**
	 * 'Imports' panel (SidePanel, right-hand drawer, fullscreen on mobile): file drop, result of the last drop,
	 * recognised formats, latest imports. Opened from the sidebar, the palette, a page button, or a
	 * file dragged anywhere in the app (global listeners below).
	 */

	let input = $state<HTMLInputElement | null>(null);
	let zoneDragOver = $state(false);
	/** Files dragged over the app (discreet hint, intercepts nothing). */
	let appDragOver = $state(false);

	function close() {
		uiState.importPanelOpen = false;
	}

	const FORMATS: { famille: string; detail: string }[] = [
		{ famille: 'Banque', detail: 'CSV/XLSX Crédit Mutuel, relevés OFX/QFX, QIF, CAMT.053/052 de toute banque' },
		{ famille: 'Épargne et crypto', detail: 'CSV et PDF Natixis, ledger Kraken (CSV), relevés Krak (PDF)' },
		{ famille: 'Documents', detail: "avis d'impôt, PDF InfoPortage (paie, compte d'activité, note de frais), bon de commande ou facture du véhicule" },
		{ famille: 'Achats', detail: 'export de commandes Amazon (CSV)' }
	];

	const history = $derived(
		(Object.entries(importsState.log) as [ImportSource, ImportEntry][]).sort((a, b) => b[1].at.localeCompare(a[1].at)).slice(0, 8)
	);

	const periodLabel = (p: string) => (p.length === 7 ? formatMonth(p) : p.length === 4 ? p : `jusqu’au ${formatDate(p)}`);

	const TARGET_PAGE = { portage: { href: '/portage', label: 'Ouvrir Portage' }, voiture: { href: '/voiture', label: 'Ouvrir la fiche' } } as const;

	function openPage(href: '/portage' | '/voiture') {
		close();
		navigate(href);
	}

	function fixColumns() {
		close();
		uiState.remapRequest = true;
		navigate('/transactions');
	}

	const hasFiles = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])].includes('Files');
	/** Bank files (no PDF, no image): the ones Portage and Voiture leave to the panel. */
	const isBankFile = (f: File) => /\.(csv|tsv|txt|xlsx|ofx|qfx|qif|xml)$/i.test(f.name);

	// Drop anywhere: Portage and Voiture read PDFs and photos dropped on their own page; a drop
	// already handled by a page drop zone is skipped, and the browser never opens the file itself.
	onMount(() => {
		let depth = 0;
		const pageHasDropZone = () => route.path === '/portage' || route.path === '/voiture';
		const onEnter = (e: DragEvent) => {
			if (!hasFiles(e)) return;
			e.preventDefault();
			depth++;
			appDragOver = !pageHasDropZone();
		};
		const onOver = (e: DragEvent) => {
			if (hasFiles(e)) e.preventDefault();
		};
		const onLeave = (e: DragEvent) => {
			if (!hasFiles(e)) return;
			depth = Math.max(0, depth - 1);
			if (depth === 0) appDragOver = false;
		};
		const onDrop = (e: DragEvent) => {
			if (!hasFiles(e)) return;
			depth = 0;
			appDragOver = false;
			const all = [...(e.dataTransfer?.files ?? [])];
			let files: File[];
			if (pageHasDropZone()) files = all.filter(isBankFile);
			else if (e.defaultPrevented) return;
			else files = all;
			e.preventDefault();
			if (files.length === 0) return;
			uiState.importPanelOpen = true;
			void importFiles(files);
		};
		window.addEventListener('dragenter', onEnter);
		window.addEventListener('dragover', onOver);
		window.addEventListener('dragleave', onLeave);
		window.addEventListener('drop', onDrop);
		return () => {
			window.removeEventListener('dragenter', onEnter);
			window.removeEventListener('dragover', onOver);
			window.removeEventListener('dragleave', onLeave);
			window.removeEventListener('drop', onDrop);
		};
	});
</script>

<!-- Hint while dragging over the app (intercepts no event) -->
{#if appDragOver && !uiState.importPanelOpen}
	<div class="pointer-events-none fixed inset-0 z-50 flex items-center justify-center" style="background-color: color-mix(in srgb, var(--bg) 55%, transparent);">
		<div class="flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed px-8 py-6 text-center" style="border-color: var(--accent); background-color: var(--surface);">
			<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
				<path d="M12 16V4m0 0 4 4m-4-4-4 4" />
				<path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
			</svg>
			<p class="text-base font-semibold">Dépose tes fichiers</p>
			<p class="meta-xs">Relevés, exports, PDF : le format est reconnu tout seul</p>
		</div>
	</div>
{/if}

<SidePanel open={uiState.importPanelOpen} title="Imports" onClose={close} width={380}>
	<!-- Drop zone -->
	<!-- A drop here stops at the zone, so the app-wide drop handler does not import the files a second time -->
	<div
		class="zone flex flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-5 text-center"
		class:zone-active={zoneDragOver}
		role="region"
		aria-label="Zone de dépôt des fichiers"
		ondragover={(e) => {
			if (!hasFiles(e)) return;
			e.preventDefault();
			zoneDragOver = true;
		}}
		ondragleave={() => (zoneDragOver = false)}
		ondrop={(e) => {
			if (!hasFiles(e)) return;
			e.preventDefault();
			e.stopPropagation();
			zoneDragOver = false;
			void importFiles(e.dataTransfer?.files);
		}}
	>
		<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
			<path d="M12 16V4m0 0 4 4m-4-4-4 4" />
			<path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
		</svg>
		<p class="font-medium">{importPanelState.enCours ? 'Lecture des fichiers…' : 'Dépose tes fichiers ici'}</p>
		<p class="meta-xs">Plusieurs à la fois : le format de chacun est reconnu tout seul</p>
		<button type="button" class="btn btn-secondary btn-sm mt-1" disabled={importPanelState.enCours} data-autofocus onclick={() => input?.click()}>Choisir des fichiers…</button>
		<!-- The input is emptied after each pick so the same file can be imported again -->
		<input
			bind:this={input}
			type="file"
			multiple
			accept=".csv,.tsv,.txt,.xlsx,.ofx,.qfx,.qif,.xml,.pdf,text/csv,application/pdf"
			class="hidden"
			onchange={(e) => {
				void importFiles((e.target as HTMLInputElement).files);
				(e.target as HTMLInputElement).value = '';
			}}
		/>
	</div>

	<!-- Result of the last drop -->
	{#if importPanelState.lignes.length > 0}
		<section class="mt-3" aria-labelledby="imports-resultat">
			<h3 id="imports-resultat" class="label-plain mb-1">Dernier dépôt</h3>
			<ul class="divide-y divide-[var(--border-subtle)]">
				{#each importPanelState.lignes as l, i (`${l.nom}-${i}`)}
					<li class="flex items-start gap-2 py-1.5">
						<span class="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full" style="background-color: {l.ok ? 'var(--accent)' : 'var(--amber)'};" aria-hidden="true"></span>
						<div class="min-w-0 flex-1">
							<p class="truncate" title={l.nom}>{l.nom}</p>
							<p class="meta-xs">
								{l.famille ? FAMILY_LABELS[l.famille] : 'Non importé'}{l.message ? ` · ${l.message}` : ''}
							</p>
						</div>
						{#if l.ok && (l.cible === 'portage' || l.cible === 'voiture')}
							<button type="button" class="meta-xs shrink-0 cursor-pointer underline-offset-2 hover:text-[var(--accent)] hover:underline" onclick={() => openPage(TARGET_PAGE[l.cible as 'portage' | 'voiture'].href)}>
								{TARGET_PAGE[l.cible as 'portage' | 'voiture'].label}
							</button>
						{/if}
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	<!-- Recognised formats -->
	<section class="mt-3 border-t pt-3" style="border-color: var(--border-subtle);" aria-labelledby="imports-formats">
		<h3 id="imports-formats" class="label-plain mb-1">Formats reconnus</h3>
		<ul class="space-y-1">
			{#each FORMATS as f (f.famille)}
				<li class="meta-xs"><span class="font-medium text-[var(--text-2)]">{f.famille}</span> · {f.detail}</li>
			{/each}
		</ul>
		<button type="button" class="meta-xs mt-2 cursor-pointer underline-offset-2 hover:text-[var(--accent)] hover:underline" onclick={fixColumns}>
			Corriger les colonnes d'un CSV…
		</button>
	</section>

	<!-- Latest imports -->
	{#if history.length > 0}
		<section class="mt-3 border-t pt-3" style="border-color: var(--border-subtle);" aria-labelledby="imports-historique">
			<h3 id="imports-historique" class="label-plain mb-1">Derniers imports</h3>
			<ul class="divide-y divide-[var(--border-subtle)]">
				{#each history as [source, e] (source)}
					<li class="flex items-baseline justify-between gap-3 py-1.5">
						<div class="min-w-0">
							<p>{SOURCE_LABELS[source]}</p>
							<p class="meta-xs truncate" title={e.fileName}>{e.fileName}{e.period ? ` · ${periodLabel(e.period)}` : ''}</p>
						</div>
						<span class="meta-xs tabular shrink-0">{formatDate(e.at.slice(0, 10))}</span>
					</li>
				{/each}
			</ul>
		</section>
	{/if}
</SidePanel>

<style>
	.zone {
		border-color: var(--hairline);
		transition: border-color 150ms ease, background-color 150ms ease;
	}

	.zone-active {
		border-color: var(--accent);
		background-color: var(--accent-soft);
	}
</style>
