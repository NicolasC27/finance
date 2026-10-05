<script lang="ts">
	import DateField from '$lib/components/DateField.svelte';
	import PageTitle from '$lib/components/PageTitle.svelte';
	import ModuleOptionsButton from '$lib/components/ModuleOptionsButton.svelte';
	import Block from '$lib/components/Block.svelte';
	import TileCanvas from '$lib/components/TileCanvas.svelte';
	import type { BlockElement } from '$lib/layoutModel';
	import { isStored, orderedIds, pageCustomized, storeByDefault } from '$lib/layout.svelte';
	import AssetForm from '$lib/components/AssetForm.svelte';
	import SidePanel from '$lib/components/SidePanel.svelte';
	import { clearModuleActions, setModuleActions } from '$lib/sidePanel.svelte';
	import { modulesState, setCarOptions } from '$lib/modules.svelte';
	import CarIllustration from '$lib/components/CarIllustration.svelte';
	import LicensePlate from '$lib/components/LicensePlate.svelte';
	import ValuationEditor from '$lib/components/ValuationEditor.svelte';
	import { getCategory } from '$lib/categories';
	import { formatDate, formatEUR } from '$lib/format';
	import { assetsState, logKm, removeKm, updateAsset } from '$lib/assets.svelte';
	import { KM_SOURCES, VALUE_SOURCES, shortValueSource, type Asset, type KmReading, type ValueSource } from '$lib/assets';
	import { plateDate, valuationLinks, priceTrend, type Milestone } from '$lib/vehicle';
	import { vehicleSheet } from '$lib/car.svelte';
	import { prepareQuestion } from '$lib/ai.svelte';
	import { navigate } from '$lib/router.svelte';
	import { onMount } from 'svelte';
	import { refreshValuation, autoState, automateVehicle, confirmValue, ignoreProposal, importCarDocuments, retainValue, acceptProposal } from '$lib/carAuto.svelte';
	import { showToast, uiState, showSuccess } from '$lib/ui.svelte';

	/**
	 * Vehicle sheet: visual (illustration or photo), plate and identity; valuation (range, comparable
	 * ads, links to valuation sites); monthly cost (Voiture operations since purchase, plus the loss of
	 * value when the option counts it);
	 * odometer (curve, km per year); upcoming deadlines; readings. Computations: src/lib/vehicle.ts
	 * via car.svelte.ts.
	 */

	const today = new Date().toISOString().slice(0, 10);
	const CAR_COLOR = getCategory('voiture').color;

	const vehicles = $derived(assetsState.biens.filter((b) => b.type === 'vehicule').sort((a, b) => b.purchaseDate.localeCompare(a.purchaseDate)));
	let selectedId = $state<string | null>(null);
	const v = $derived(vehicles.find((b) => b.id === selectedId) ?? vehicles[0]);
	let formOpen = $state<'ajout' | 'modif' | null>(null);

	const sheet = $derived(v ? vehicleSheet(v, today) : null);
	const points = $derived(sheet?.points ?? []);
	const km = $derived(sheet?.km ?? { moyenne: null, annees: [] });
	const kmToday = $derived(sheet?.kmAujourdhui ?? null);
	const estimate = $derived(sheet?.estimation ?? null);
	/** Today's odometer is an estimate (last reading older than a week). */
	const kmEstimated = $derived(!!estimate && estimate.jours >= 7);
	const CLUE_LABELS = { rythme: 'rythme habituel', carburant: 'carburant', peages: 'péages' } as const;

	function refineWithAi() {
		if (!v || !estimate) return;
		prepareQuestion(
			`Estime le kilométrage actuel de ma ${v.name}${v.vehicle?.version ? ` (${v.vehicle.version})` : ''}. Dernier relevé : ${formatKm(estimate.depuis.km)} le ${formatDate(estimate.depuis.date)}. Appuie-toi sur mes opérations depuis cette date : carburant, péages, parkings, lieux de mes achats par carte (villes loin de chez moi = trajets), vacances. Donne le détail des trajets repérés et propose un relevé log_km avec la source « estimation ».`
		);
		navigate('/ia');
	}
	const cost = $derived(sheet?.cout ?? null);
	const milestones = $derived(sheet?.etapes ?? []);
	const value = $derived(sheet?.valeur ?? null);
	const retained = $derived(sheet?.retenue ?? null);
	const proposal = $derived(sheet?.proposition ?? null);
	const perKm = $derived(cost && km.moyenne ? (cost.total * 12) / km.moyenne : null);
	const lossPerMonth = $derived(cost?.perte.parMois ?? 0);
	const valuation = $derived(v?.vehicle?.cote);
	const inspection = $derived(milestones.find((e) => e.id === 'ct'));

	/** First registration: registration document, otherwise estimated from the plate series. */
	const registration = $derived.by(() => {
		if (v?.vehicle?.firstRegistration) return { date: v.vehicle.firstRegistration, estimee: false };
		const d = v?.vehicle?.plate ? plateDate(v.vehicle.plate) : null;
		return d ? { date: d.estimee, estimee: true } : null;
	});
	const year = $derived(Number((registration?.date ?? v?.purchaseDate ?? today).slice(0, 4)));
	const kmReference = $derived(kmToday ?? valuation?.kmHypothese ?? null);
	const links = $derived(v ? valuationLinks(v.name, year, kmReference ?? undefined, v.vehicle?.version) : []);

	const formatKm = (n: number) => `${Math.round(n).toLocaleString('fr-FR')} km`;
	const pct = (n: number) => `${Math.round(n * 100)} %`;
	const monthLabel = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });

	// ---------- Visual: slight movement on hover (2D: CSS 3D made the drawing disappear on some
	// GPUs), personal photo ----------
	let offset = $state({ x: 0, y: 0 });
	const reducedMotion = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
	function onSceneHover(e: PointerEvent) {
		if (reducedMotion) return;
		const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
		offset = { x: ((e.clientX - r.left) / r.width - 0.5) * 14, y: ((e.clientY - r.top) / r.height - 0.5) * 6 };
	}
	let photoInput = $state<HTMLInputElement | null>(null);
	let photoDragOver = $state(false);

	/** Image downscaled (1400 px wide at most), then saved in the vehicle. */
	async function pickPhoto(files: FileList | null | undefined) {
		const f = [...(files ?? [])].find((x) => x.type.startsWith('image/'));
		if (!f || !v) return;
		const img = await createImageBitmap(f);
		const scale = Math.min(1, 1400 / img.width, 900 / img.height);
		const canvas = document.createElement('canvas');
		canvas.width = Math.round(img.width * scale);
		canvas.height = Math.round(img.height * scale);
		canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
		let url = canvas.toDataURL('image/webp', 0.85);
		if (!url.startsWith('data:image/webp')) url = canvas.toDataURL('image/jpeg', 0.85);
		if (url.length > 1_500_000) return showToast('Photo trop lourde, même réduite : choisis une image plus petite');
		updateAsset(v.id, { vehicle: { ...(v.vehicle ?? { kmLog: [] }), photo: url } });
		showSuccess('Photo enregistrée (sur ce PC uniquement)');
	}
	function removePhoto() {
		if (!v?.vehicle) return;
		const { photo: _photo, ...rest } = v.vehicle;
		updateAsset(v.id, { vehicle: rest });
	}

	/** Keeps at most one tick per `minGap` px of axis (first one kept): no overlapping labels in a small tile. */
	function thinTicks<T>(ticks: T[], axis: number, minGap: number): T[] {
		const room = Math.max(2, Math.floor(axis / minGap) + 1);
		if (ticks.length <= room) return ticks;
		const step = Math.ceil(ticks.length / room);
		return ticks.filter((_, i) => i % step === 0);
	}

	/** Centre of a hover label, kept inside the drawing (narrow tiles included). */
	function labelX(x: number, left: number, right: number): number {
		return Math.min(Math.max(x, left), Math.max(left, right));
	}

	// ---------- Valuation: comparable ads (price vs km) ----------
	const GW = 520;
	const GH = 190;
	const GM = { l: 52, r: 12, t: 12, b: 26 };
	/** Measured frame of the ads scatter: drawn at its pixel size, so labels keep their size in any tile. */
	let scatterW = $state(0);
	let scatterH = $state(0);
	const gw = $derived(scatterW > 0 ? scatterW : GW);
	const gh = $derived(scatterH > 0 ? scatterH : GH);
	/** Trend only from 3 ads on (2 points give a misleading slope). */
	const scatter = $derived.by(() => {
		const a = valuation?.annonces ?? [];
		if (a.length < 2) return null;
		const kms = [...a.map((x) => x.km), ...(kmReference ? [kmReference] : [])];
		const prices = [...a.map((x) => x.prix), ...(valuation?.particulier ? [valuation.particulier] : [])];
		const x0 = Math.floor(Math.min(...kms) / 10000) * 10000;
		const x1 = Math.ceil(Math.max(...kms) / 10000) * 10000;
		const y0 = Math.floor(Math.min(...prices) / 1000) * 1000;
		const y1 = Math.ceil(Math.max(...prices) / 1000) * 1000;
		const x = (k: number) => GM.l + ((k - x0) / Math.max(1, x1 - x0)) * (gw - GM.l - GM.r);
		const y = (p: number) => gh - GM.b - ((p - y0) / Math.max(1, y1 - y0)) * (gh - GM.t - GM.b);
		const t = a.length >= 3 ? priceTrend(a) : null;
		const ticksX: number[] = [];
		for (let k = x0; k <= x1; k += 10000) ticksX.push(k);
		const ticksY: number[] = [];
		for (let p = y0; p <= y1; p += 1000) ticksY.push(p);
		return {
			x,
			y,
			ticksX: thinTicks(ticksX, gw - GM.l - GM.r, 64),
			ticksY: thinTicks(ticksY, gh - GM.t - GM.b, 22),
			tendance: t ? { x1: x(x0), y1: y(t.origine + t.pente * x0), x2: x(x1), y2: y(t.origine + t.pente * x1) } : null,
			pts: a.map((p) => ({ ...p, cx: x(p.km), cy: y(p.prix) }))
		};
	});
	let hoveredAd = $state<number | null>(null);
	const priceRange = $derived.by(() => {
		if (!valuation) return null;
		const vals = [valuation.reprise, valuation.particulier, valuation.pro].filter((n): n is number => n !== undefined);
		if (vals.length < 2) return null;
		const min = Math.min(...vals);
		const max = Math.max(...vals);
		const pos = (n: number) => ((n - min) / Math.max(1, max - min)) * 100;
		return [
			{ label: 'Reprise par un pro', val: valuation.reprise, retenue: false },
			{ label: 'Entre particuliers', val: valuation.particulier, retenue: true },
			{ label: 'Prix chez un pro', val: valuation.pro, retenue: false }
		]
			.filter((x): x is { label: string; val: number; retenue: boolean } => x.val !== undefined)
			.map((x) => ({ ...x, pos: pos(x.val) }));
	});

	// ---------- Odometer curve ----------
	const W = 640;
	const H = 210;
	const M = { l: 58, r: 14, t: 14, b: 26 };
	/** Measured frame of the odometer curve (pixel drawing, like the ads scatter). */
	let curveW = $state(0);
	let curveH = $state(0);
	const cw = $derived(curveW > 0 ? curveW : W);
	const ch = $derived(curveH > 0 ? curveH : H);
	const toTime = (d: string) => Date.parse(`${d}T00:00:00Z`);

	const chart = $derived.by(() => {
		if (points.length === 0) return null;
		const end = today > points[points.length - 1]!.date ? today : points[points.length - 1]!.date;
		const t0 = toTime(points[0]!.date);
		const t1 = Math.max(toTime(end), t0 + 86_400_000 * 30);
		const kms = [...points.map((p) => p.km), kmToday ?? 0];
		const tickStep = [1000, 2000, 5000, 10_000, 20_000, 25_000, 50_000].find((s) => (Math.max(...kms) - Math.min(...kms)) / s <= 4) ?? 100_000;
		const y0 = Math.floor(Math.min(...kms) / tickStep) * tickStep;
		const y1 = Math.max(y0 + tickStep, Math.ceil(Math.max(...kms) / tickStep) * tickStep);
		const x = (d: string) => M.l + ((toTime(d) - t0) / (t1 - t0)) * (cw - M.l - M.r);
		const y = (k: number) => ch - M.b - ((k - y0) / (y1 - y0)) * (ch - M.t - M.b);
		const ticksY: number[] = [];
		for (let k = y0; k <= y1; k += tickStep) ticksY.push(k);
		const yearTicks: { x: number; label: string }[] = [];
		for (let yr = Number(points[0]!.date.slice(0, 4)) + 1; yr <= Number(end.slice(0, 4)); yr++) yearTicks.push({ x: x(`${yr}-01-01`), label: String(yr) });
		const ticksX = thinTicks(yearTicks, cw - M.l - M.r, 44);
		const pts = points.map((p) => ({ ...p, cx: x(p.date), cy: y(p.km) }));
		const last = pts[pts.length - 1]!;
		const projection = kmToday !== null && today > last.date ? { x1: last.cx, y1: last.cy, x2: x(today), y2: y(kmToday) } : null;
		return { ticksY: thinTicks(ticksY, ch - M.t - M.b, 22), ticksX, y, pts, projection, ligne: pts.map((p, i) => `${i ? 'L' : 'M'}${p.cx.toFixed(1)},${p.cy.toFixed(1)}`).join(' ') };
	});

	/** Hover: closest point (readings + today's estimate). */
	let hover = $state<{ x: number; y: number; texte: string } | null>(null);
	function onHover(e: PointerEvent) {
		const g = chart;
		if (!g) return;
		const svg = e.currentTarget as SVGSVGElement;
		const r = svg.getBoundingClientRect();
		const mx = ((e.clientX - r.left) / r.width) * cw;
		const candidates = [
			...g.pts.map((p) => ({ x: p.cx, y: p.cy, texte: `${formatDate(p.date)} · ${formatKm(p.km)} (${p.source === 'achat' ? 'achat' : (KM_SOURCES.find((s) => s.id === p.source)?.label ?? p.source)})` })),
			...(g.projection && kmToday !== null ? [{ x: g.projection.x2, y: g.projection.y2, texte: `aujourd'hui · ≈ ${formatKm(kmToday)} (estimé)` }] : [])
		];
		hover = candidates.reduce((best, c) => (Math.abs(c.x - mx) < Math.abs(best.x - mx) ? c : best), candidates[0]!);
	}

	const maxPerYear = $derived(Math.max(1, ...km.annees.map((a) => a.km)));

	// ---------- Readings ----------
	let readingDate = $state(today);
	let readingKm = $state('');
	let readingSource = $state<KmReading['source']>('saisie');

	function addReading(e: SubmitEvent) {
		e.preventDefault();
		if (!v) return;
		const err = logKm(v.id, { date: readingDate, km: readingKm, source: readingSource });
		if (err) return showToast(err);
		readingKm = '';
		showSuccess('Relevé ajouté');
	}

	const STATES: Record<Milestone['etat'], { label: string; cls: string }> = {
		passee: { label: 'dépassée', cls: 'chip-amber' },
		bientot: { label: 'bientôt', cls: 'chip-amber' },
		'plus-tard': { label: 'à venir', cls: 'chip-muted' },
		'a-renseigner': { label: 'à renseigner', cls: 'chip-muted' }
	};

	/** New vehicle: purchase payments are looked up automatically (the AI valuation only runs when asked). */
	function afterForm(b?: Asset) {
		const isNew = formOpen === 'ajout';
		if (b) selectedId = b.id;
		formOpen = null;
		uiState.moduleOptions = null;
		if (b && isNew) void automateVehicle(b.id);
	}

	/** Opens the vehicle form inside the « ⚙ Voiture » panel (edit the shown vehicle, or add one). */
	function openVehicleForm(kind: 'ajout' | 'modif') {
		formOpen = kind;
		uiState.moduleOptions = 'voiture';
	}

	/** The page hands its actions (import, edit, add) to the « ⚙ Voiture » panel while it is shown. */
	$effect(() => {
		setModuleActions('voiture', { render: carActions, fullView: () => formOpen !== null, onClose: () => (formOpen = null) });
		return () => clearModuleActions('voiture');
	});

	/**
	 * On open: purchase payments of each vehicle. The « Cote et valeur » block starts stored (in the
	 * « blocs rangés » chip) while the page has no saved layout: an ad-based estimate is only a hint.
	 */
	onMount(() => {
		for (const x of vehicles) void automateVehicle(x.id);
		if (!pageCustomized('voiture') && !isStored('voiture', 'cote')) storeByDefault('voiture', 'cote');
	});

	// ---------- Documents (order form, purchase or workshop invoice) ----------
	let docInput = $state<HTMLInputElement | null>(null);
	let docDragOver = $state(false);
	let readingDocs = $state(false);
	let docSummaries = $state<string[]>([]);
	async function importDocs(files: FileList | null | undefined) {
		const pdfs = [...(files ?? [])].filter((f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
		if (!pdfs.length) return;
		readingDocs = true;
		try {
			const r = await importCarDocuments(pdfs);
			docSummaries = r.resumes;
			if (r.vehicules[0]) selectedId = r.vehicules[0];
			showToast(`${pdfs.length} document${pdfs.length > 1 ? 's' : ''} lu${pdfs.length > 1 ? 's' : ''} : fiche mise à jour`);
		} finally {
			readingDocs = false;
		}
	}
	/**
	 * Customisable blocks of the sheet (default order). The layout belongs to the page: switching
	 * vehicles keeps it.
	 */
	const BLOCKS = ['identite', 'cote', 'cout', 'compteur', 'etapes', 'releves', 'liens'] as const;

	/** Optional elements of each block, all shown by default. */
	const IDENTITY_ELEMENTS: BlockElement[] = [
		{ id: 'visuel', label: 'Illustration ou photo' },
		{ id: 'infos', label: "Infos d'achat (prix, immatriculation, km)" },
		{ id: 'chiffres', label: 'Chiffres clés (valeur, coût, CT)' }
	];
	const VALUATION_ELEMENTS: BlockElement[] = [
		{ id: 'fourchette', label: 'Fourchette reprise / particulier / pro' },
		{ id: 'evolution', label: 'Évolution depuis la cote précédente' },
		{ id: 'nuage', label: 'Nuage des annonces (prix selon les km)' },
		{ id: 'annonces', label: 'Liste des annonces' }
	];
	const COST_ELEMENTS: BlockElement[] = [
		{ id: 'parkm', label: 'Coût au kilomètre' },
		{ id: 'resume', label: 'Perte de valeur et argent sorti' },
		{ id: 'tableau', label: 'Détail par poste' },
		{ id: 'explication', label: '« Comment c’est calculé ? »' }
	];
	const ODOMETER_ELEMENTS: BlockElement[] = [
		{ id: 'estimation', label: 'Estimation du jour (« Affiner avec l’IA »)' },
		{ id: 'courbe', label: 'Courbe du compteur' },
		{ id: 'annees', label: 'Kilomètres par année' }
	];
	const MILESTONES_ELEMENTS: BlockElement[] = [
		{ id: 'details', label: 'Détail de chaque étape' },
		{ id: 'etats', label: 'Badges « à venir », « à renseigner »' },
		{ id: 'a-renseigner', label: 'Étapes à renseigner' }
	];
	const READINGS_ELEMENTS: BlockElement[] = [
		{ id: 'formulaire', label: "Formulaire d'ajout" },
		{ id: 'liste', label: 'Liste des relevés' },
		{ id: 'sources', label: 'Source de chaque relevé' }
	];
	const LINKS_ELEMENTS: BlockElement[] = [
		{ id: 'details', label: 'Détail de chaque recherche' },
		{ id: 'note', label: 'Explication des recherches' }
	];

	/** Overdue or close deadlines keep their badge even when the user hides the badges. */
	const ALWAYS_SHOWN_STATES: ReadonlySet<Milestone['etat']> = new Set(['passee', 'bientot']);

	const valuationRunning = $derived(!!v && autoState.coteEnCours.includes(v.id));

	/** Short date (« 4 oct. 2026 ») of a retained value or proposal. */
	const shortDate = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

	let editingValue = $state(false);
	let valueAmount = $state('');
	let valueSource = $state<ValueSource>('reprise');

	/** Opens the retained-value form (right panel), prefilled with the current value when there is one. */
	function openValueEditor() {
		valueAmount = retained && !retained.theorique ? String(retained.valeur) : '';
		valueSource = retained?.source && retained.source !== 'ia' ? retained.source : 'reprise';
		editingValue = true;
	}

	/** Saves the amount and source typed by the user as the confirmed retained value. */
	function saveValue(e: SubmitEvent) {
		e.preventDefault();
		if (!v) return;
		const n = Number(valueAmount.replace(/[\s€]/g, '').replace(',', '.'));
		showToast(retainValue(v.id, n, valueSource));
		if (Number.isFinite(n) && n > 0) editingValue = false;
	}

	/** Asks the AI analysis for an estimate: it only comes back as a proposal to validate. */
	function requestEstimate() {
		if (v) void refreshValuation(v.id);
	}
	let editingValuation = $state(false);
	const valuationMessage = $derived(v ? autoState.messages[v.id] : undefined);
	/** Previous value (valuation history) to show the change. */
	const previous = $derived.by(() => {
		const h = v?.vehicle?.coteHistorique ?? [];
		return h.length >= 2 ? h[h.length - 2] : undefined;
	});
</script>

<header class="mb-3 flex flex-wrap items-end justify-between gap-3">
	<PageTitle title="Voiture" />
	<div class="flex flex-wrap items-center gap-2">
		{#if vehicles.length > 1}
			<div class="flex overflow-hidden rounded-md border text-[12px]" style="border-color: var(--border);" role="group" aria-label="Véhicule">
				{#each vehicles as x (x.id)}
					<button type="button" class="px-2.5 py-1 {x.id === v?.id ? 'font-medium' : 'text-secondary'}" style={x.id === v?.id ? 'background-color: var(--surface-2);' : ''} onclick={() => (selectedId = x.id)} aria-pressed={x.id === v?.id}>{x.name}</button>
				{/each}
			</div>
		{/if}
		<input
			bind:this={docInput}
			type="file"
			accept=".pdf,application/pdf"
			multiple
			class="hidden"
			aria-label="Documents du véhicule (PDF)"
			onchange={(e) => {
				void importDocs((e.target as HTMLInputElement).files);
				(e.target as HTMLInputElement).value = '';
			}}
		/>
		<ModuleOptionsButton module="voiture" />
	</div>
</header>

<svelte:window
	ondragover={(e) => {
		if ([...(e.dataTransfer?.types ?? [])].includes('Files') && !(e.target as HTMLElement)?.closest?.('.scene')) {
			e.preventDefault();
			docDragOver = true;
		}
	}}
	ondragleave={(e) => {
		if (!e.relatedTarget) docDragOver = false;
	}}
	ondrop={(e) => {
		if ((e.target as HTMLElement)?.closest?.('.scene')) return;
		e.preventDefault();
		docDragOver = false;
		void importDocs(e.dataTransfer?.files);
	}}
/>

{#if docDragOver}
	<div class="depot-doc card mb-3 p-3 text-center text-[13px]">Dépose le bon de commande ou la facture (PDF) : tout est lu et appliqué tout seul.</div>
{/if}
{#if docSummaries.length}
	<ul class="card mb-3 p-3 text-[12px]" aria-live="polite">
		{#each docSummaries as r, i (i)}<li class="text-secondary">{r}</li>{/each}
	</ul>
{/if}

<!-- Actions of the « ⚙ Voiture » panel: import a document, edit or add a vehicle (the form takes the whole panel) -->
{#snippet carActions()}
	{#if formOpen}
		<div class="mb-3 flex items-center gap-2">
			<button type="button" class="btn btn-secondary btn-sm" onclick={() => (formOpen = null)}>← Retour</button>
			<p class="truncate text-[13px] font-medium">{formOpen === 'modif' && v ? `Modifier · ${v.name}` : 'Nouveau véhicule'}</p>
		</div>
		{#key formOpen + (v?.id ?? '')}
			<AssetForm bien={formOpen === 'modif' ? v : undefined} typeParDefaut="vehicule" onDone={afterForm} framed={false} />
		{/key}
	{:else}
		<div class="grid gap-1.5">
			<button type="button" class="btn btn-secondary btn-sm btn-start" disabled={readingDocs} onclick={() => docInput?.click()}>{readingDocs ? 'Lecture…' : 'Importer un document'}</button>
			<p class="meta-xs -mt-0.5 mb-1">Bon de commande, facture d'achat ou d'atelier : lu et appliqué tout seul (ou glisse le PDF sur la page).</p>
			{#if v}<button type="button" class="btn btn-secondary btn-sm btn-start" onclick={() => (formOpen = 'modif')}>Modifier le véhicule</button>{/if}
			<button type="button" class="btn btn-secondary btn-sm btn-start" onclick={() => (formOpen = 'ajout')}>Ajouter un véhicule</button>
		</div>
	{/if}
{/snippet}

{#if !v}
	<div class="card overflow-hidden p-0">
		<div class="grid items-center gap-4 p-4 lg:grid-cols-2">
			<div class="mx-auto w-full max-w-[460px]"><CarIllustration titre="Illustration d'un SUV compact" /></div>
			<div>
				<p class="text-[15px] font-medium">Ajoute ta voiture</p>
				<p class="meta-xs mt-1">Prix, date d'achat, plaque et compteur : la fiche calcule ton coût réel par mois (crédit, assurance, entretien, carburant), sa cote et tes prochaines échéances.</p>
				<button type="button" class="btn btn-accent btn-sm mt-3" onclick={() => openVehicleForm('ajout')} aria-haspopup="dialog">Ajouter un véhicule</button>
			</div>
		</div>
	</div>
{:else}
	<!-- Customisable blocks: 12 columns on large screens, one column below -->
	<TileCanvas page="voiture" defaults={BLOCKS}>
		{#each orderedIds('voiture', BLOCKS) as id (id)}
			{#if id === 'identite'}
				<Block page="voiture" {id} defaults={BLOCKS} title="Ta voiture" size="XL" sizes={['L', 'XL']} elements={IDENTITY_ELEMENTS} class="!p-0">
					{#snippet children(show, _size, box)}
						<!-- Identity: visual (relief on hover), plate, key figures; side by side from 40rem of tile width -->
						<div class="@container" style:min-height={box ? `${box.h}px` : null}>
							<div class="identite grid min-h-[inherit] items-stretch @min-[40rem]:grid-cols-12" class:identite-pleine={!!box && show('visuel')}>
								{#if show('visuel')}
									<div
										class="scene relative @min-[40rem]:col-span-7"
										class:scene-pleine={!!box}
										class:depot={photoDragOver}
										role="presentation"
										onpointermove={onSceneHover}
										onpointerleave={() => (offset = { x: 0, y: 0 })}
										ondragover={(e) => {
											if ([...(e.dataTransfer?.types ?? [])].includes('Files')) {
												e.preventDefault();
												photoDragOver = true;
											}
										}}
										ondragleave={() => (photoDragOver = false)}
										ondrop={(e) => {
											e.preventDefault();
											photoDragOver = false;
											void pickPhoto(e.dataTransfer?.files);
										}}
									>
										<div class="relief" style="transform: translate({offset.x}px, {offset.y}px);">
											{#if v.vehicle?.photo}
												<img src={v.vehicle.photo} alt="Photo de {v.name}" class="photo" />
											{:else}
												<CarIllustration couleur={v.vehicle?.color} titre="Illustration de {v.name}" />
											{/if}
										</div>
										<div class="absolute bottom-2 right-3 flex gap-2 text-[11px]">
											<button type="button" class="action-photo" onclick={() => photoInput?.click()}>{v.vehicle?.photo ? 'Changer la photo' : 'Mettre ta photo'}</button>
											{#if v.vehicle?.photo}<button type="button" class="action-photo" onclick={removePhoto}>Illustration</button>{/if}
										</div>
										<input
											bind:this={photoInput}
											type="file"
											accept="image/png,image/jpeg,image/webp"
											class="hidden"
											aria-label="Photo de la voiture"
											onchange={(e) => {
												void pickPhoto((e.target as HTMLInputElement).files);
												(e.target as HTMLInputElement).value = '';
											}}
										/>
									</div>
								{/if}
								<div
									class="@container/infos flex min-w-0 flex-col justify-center gap-3 p-4 {show('visuel') ? 'border-t @min-[40rem]:col-span-5 @min-[40rem]:border-t-0 @min-[40rem]:border-l' : '@min-[40rem]:col-span-12'}"
									style="border-color: var(--border-subtle);"
								>
									<div>
										<div class="flex flex-wrap items-center gap-x-3 gap-y-1.5">
											<h2 class="text-[22px] font-semibold tracking-tight">{v.name}</h2>
											{#if v.vehicle?.plate}<LicensePlate plaque={v.vehicle.plate} />{/if}
										</div>
										{#if v.vehicle?.version}<p class="text-secondary mt-1 text-[13px]">{v.vehicle.version}</p>{/if}
									</div>
									{#if show('infos')}
										<div class="flex flex-wrap gap-1.5 text-[11px]">
											{#if v.vehicle?.boughtUsed !== undefined}<span class="chip chip-muted">{v.vehicle.boughtUsed ? 'Achetée d’occasion' : 'Achetée neuve'}</span>{/if}
											<span class="chip chip-muted">{formatEUR(v.purchasePrice)} le {formatDate(v.purchaseDate)}</span>
											{#if registration}<span class="chip chip-muted" title={registration.estimee ? 'Estimée d’après la série de la plaque : la carte grise (case B) donne la date exacte' : 'Carte grise, case B'}>1re immatriculation {registration.estimee ? `≈ ${monthLabel(registration.date)}` : formatDate(registration.date)}</span>{/if}
											{#if kmReference}<span class="chip chip-muted" title={kmEstimated ? 'Estimé depuis le dernier relevé (rythme, carburant, péages)' : ''}>{kmToday !== null ? `${kmEstimated ? '≈ ' : ''}${formatKm(kmToday)}${kmEstimated ? ' (estimé)' : ''}` : `${formatKm(kmReference)} supposés`}</span>{/if}
										</div>
									{/if}
									{#if show('chiffres')}
										<!-- Key figures: one column in a narrow tile, two from 15rem, three from 25rem -->
										<dl class="grid grid-cols-1 gap-3 border-t pt-3 @min-[15rem]/infos:grid-cols-2 @min-[25rem]/infos:grid-cols-3" style="border-color: var(--border-subtle);">
											<div class="min-w-0">
												<dt class="label-xs">Valeur retenue</dt>
												<dd class="amount-md tabular mt-1">{retained ? formatEUR(retained.valeur) : '—'}</dd>
												{#if retained?.theorique}
													<dd class="meta-xs" title="Aucune valeur retenue : décote théorique depuis l'achat">estimation théorique (−{pct(modulesState.car.depreciation)}/an)</dd>
												{:else if retained}
													<dd class="meta-xs flex flex-wrap items-center gap-1">
														<span>{shortValueSource(retained.source)}{retained.date ? ` du ${shortDate(retained.date)}` : ''}</span>
														{#if retained.tracked}<span class="chip {retained.confirmee ? 'chip-muted' : 'chip-amber'} px-1.5 py-0 text-[10px]">{retained.confirmee ? 'validée' : 'à confirmer'}</span>{/if}
														{#if retained.aRevalider}<span class="chip chip-muted px-1.5 py-0 text-[10px]" title="Valeur de plus de {modulesState.car.revalidateMonths} mois : une offre de reprise ou une cote récente la remettra à jour">à revalider</span>{/if}
													</dd>
												{/if}
											</div>
											<div class="min-w-0">
												<dt class="label-xs">Coût réel</dt>
												<dd class="amount-md tabular mt-1">{cost ? formatEUR(cost.total) : '—'}</dd>
												<dd class="meta-xs">{cost?.countsLoss ? 'par mois, perte de valeur comprise' : 'par mois, sorti de ton compte'}</dd>
											</div>
											<div class="min-w-0">
												<dt class="label-xs">Prochain CT</dt>
												<dd class="amount-md tabular mt-1">{inspection?.date ? new Date(`${inspection.date}T00:00:00Z`).toLocaleDateString('fr-FR', { month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—'}</dd>
												<dd class="meta-xs">{inspection?.date ? formatDate(inspection.date) : 'à renseigner'}</dd>
											</div>
										</dl>
										<!-- Retained value: confirmed by the user only; an AI estimate is a proposal until validated -->
										<div class="flex flex-wrap items-center gap-1.5 text-[12px]">
											{#if retained && !retained.theorique && !retained.confirmee}
												<button type="button" class="btn btn-accent btn-sm" onclick={() => v && showToast(confirmValue(v.id))}>Confirmer</button>
											{/if}
											<button type="button" class="btn btn-secondary btn-sm" onclick={openValueEditor} aria-haspopup="dialog">{retained?.theorique ? 'Saisir une valeur' : 'Modifier'}</button>
											<button type="button" class="btn btn-secondary btn-sm" disabled={valuationRunning} onclick={requestEstimate} title="L'Analyse IA cherche des annonces comparables (modèle, version, année, km ; ni plaque ni données bancaires). Le résultat reste une proposition à valider.">
												{valuationRunning ? 'Recherche des annonces…' : 'Demander une estimation'}
											</button>
										</div>
										{#if proposal}
											<p class="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md px-2.5 py-1.5 text-[12px]" style="background-color: var(--surface-2);" role="status">
												<span>Proposition IA <b class="tabular font-semibold">{formatEUR(proposal.particulier!)}</b> <span class="meta-xs">({proposal.annonces.length} annonce{proposal.annonces.length > 1 ? 's' : ''}, {shortDate(proposal.date)})</span></span>
												<button type="button" class="btn btn-accent btn-sm" onclick={() => v && showToast(acceptProposal(v.id))}>Valider</button>
												<button type="button" class="btn btn-secondary btn-sm" onclick={() => v && showToast(ignoreProposal(v.id))}>Ignorer</button>
											</p>
										{/if}
										{#if valuationMessage && isStored('voiture', 'cote')}<p class="meta-xs" role="status">{valuationMessage}</p>{/if}
									{/if}
								</div>
							</div>
						</div>
					{/snippet}
				</Block>
			{:else if id === 'cote'}
				<Block page="voiture" {id} defaults={BLOCKS} title="Cote et valeur" size="M" sizes={['M', 'L', 'XL']} elements={VALUATION_ELEMENTS}>
					{#snippet children(show, _size, box)}
						<div class="tuile-col @container" class:tuile-pleine={!!box} style:min-height={box ? `${box.h}px` : null}>
						<div class="flex flex-wrap items-center justify-between gap-2">
							<h2 class="label-xs">Cote et valeur</h2>
							<div class="flex flex-wrap items-center gap-2">
								{#if valuation}<p class="meta-xs">{valuation.auto ? 'proposition IA' : 'cote saisie'} du {formatDate(valuation.date)}{valuation.kmHypothese && kmToday === null ? ` pour ${formatKm(valuation.kmHypothese)} (supposés)` : ''}{valuation.auto ? ` · ${valuation.decision === 'validee' ? 'validée' : valuation.decision === 'ignoree' ? 'écartée' : 'à valider'}` : ''}</p>{/if}
								<button type="button" class="btn btn-secondary btn-sm" onclick={() => (editingValuation = true)} aria-haspopup="dialog">Modifier</button>
								<button type="button" class="btn btn-secondary btn-sm" disabled={valuationRunning} onclick={requestEstimate} title="L'Analyse IA cherche des annonces comparables (modèle, version, année, km ; ni plaque ni données bancaires). Le résultat reste une proposition à valider.">
									{valuationRunning ? 'Recherche des annonces…' : 'Demander une estimation'}
								</button>
							</div>
						</div>
						{#if valuationMessage}<p class="meta-xs mt-1" role="status">{valuationMessage}</p>{/if}
						<p class="meta-xs mt-1">Prix d'annonces : un ordre d'idée, pas une valeur sûre. Ta valeur retenue ne change que si tu la valides.</p>
						{#if show('evolution') && previous && valuation?.particulier !== undefined}
							<p class="meta-xs mt-1">Le {formatDate(previous.date)} : {formatEUR(previous.valeur)} → le {formatDate(valuation.date)} : {formatEUR(valuation.particulier)} ({valuation.particulier - previous.valeur >= 0 ? '+' : ''}{formatEUR(valuation.particulier - previous.valeur)})</p>
						{/if}
						{#if show('fourchette') && priceRange}
							<ul class="mt-3 space-y-0.5 text-[12.5px] @min-[26rem]:hidden">
								{#each priceRange as f (f.label)}
									<li class="flex items-baseline justify-between gap-2">
										<span class="meta-xs min-w-0 truncate">{f.label}</span>
										<span class="tabular shrink-0 {f.retenue ? 'text-[14px] font-semibold' : 'font-medium'}">{formatEUR(f.val)}</span>
									</li>
								{/each}
							</ul>
							<div class="mt-4 hidden px-1 @min-[26rem]:block">
								<div class="relative h-2 rounded-full" style="background: linear-gradient(90deg, var(--surface-2), color-mix(in srgb, {CAR_COLOR} 45%, transparent), var(--surface-2));">
									{#each priceRange as f (f.label)}
										<span class="repere" class:retenue={f.retenue} style="left: {f.pos}%;"></span>
									{/each}
								</div>
								<div class="relative mt-2 h-10 text-[12px]">
									{#each priceRange as f, i (f.label)}
										<div class="absolute" style="left: {f.pos}%; transform: translateX({i === 0 ? '0' : i === priceRange.length - 1 ? '-100%' : '-50%'}); text-align: {i === 0 ? 'left' : i === priceRange.length - 1 ? 'right' : 'center'};">
											<p class="tabular {f.retenue ? 'text-[15px] font-semibold' : 'font-medium'}">{formatEUR(f.val)}</p>
											<p class="meta-xs whitespace-nowrap">{f.label}</p>
										</div>
									{/each}
								</div>
							</div>
						{/if}
						{#if show('nuage') && scatter}
							<div class="graphe mt-3" bind:clientWidth={scatterW} bind:clientHeight={scatterH}>
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<svg viewBox="0 0 {gw} {gh}" class="block h-full w-full" role="img" aria-label="Prix des annonces comparables selon le kilométrage" onpointerleave={() => (hoveredAd = null)}>
								{#each scatter.ticksY as p (p)}
									<line x1={GM.l} x2={gw - GM.r} y1={scatter.y(p)} y2={scatter.y(p)} stroke="var(--border-subtle)" />
									<text x={GM.l - 8} y={scatter.y(p) + 4} text-anchor="end" font-size="11" fill="var(--text-2)">{(p / 1000).toLocaleString('fr-FR')} k€</text>
								{/each}
								{#each scatter.ticksX as k (k)}
									<text x={scatter.x(k)} y={gh - 8} text-anchor={scatter.x(k) < GM.l + 24 ? 'start' : scatter.x(k) > gw - GM.r - 24 ? 'end' : 'middle'} font-size="11" fill="var(--text-2)">{k.toLocaleString('fr-FR')}</text>
								{/each}
								{#if scatter.tendance}
									<line x1={scatter.tendance.x1} y1={scatter.tendance.y1} x2={scatter.tendance.x2} y2={scatter.tendance.y2} stroke="var(--text-2)" stroke-width="1.5" stroke-dasharray="4 4" />
								{/if}
								{#if kmReference}
									<line x1={scatter.x(kmReference)} x2={scatter.x(kmReference)} y1={GM.t} y2={gh - GM.b} stroke={CAR_COLOR} stroke-width="2" />
									<text x={scatter.x(kmReference) + 6} y={GM.t + 10} font-size="11" fill="var(--text)">ta voiture{kmToday === null ? ' (km supposés)' : ''}</text>
									{#if valuation?.particulier}<circle cx={scatter.x(kmReference)} cy={scatter.y(valuation.particulier)} r="6" fill={CAR_COLOR} stroke="var(--surface)" stroke-width="2" />{/if}
								{/if}
								{#each scatter.pts as p, i (i)}
									<circle cx={p.cx} cy={p.cy} r="11" fill="transparent" role="presentation" onpointerenter={() => (hoveredAd = i)} />
									<circle cx={p.cx} cy={p.cy} r={hoveredAd === i ? 6 : 4.5} fill="var(--text-2)" stroke="var(--surface)" stroke-width="2" pointer-events="none" />
								{/each}
								{#if hoveredAd !== null}
									{@const p = scatter.pts[hoveredAd]!}
									<text x={labelX(p.cx, GM.l + 120, gw - GM.r - 120)} y={Math.max(p.cy - 12, GM.t + 12)} text-anchor="middle" font-size="11.5" fill="var(--text)" style="paint-order: stroke; stroke: var(--surface); stroke-width: 4px;">{p.libelle} · {formatKm(p.km)} · {formatEUR(p.prix)}</text>
								{/if}
							</svg>
							</div>
							<p class="meta-xs mt-1">Prix selon le kilométrage (km). Points : annonces de professionnels · pointillés : tendance · trait vert : ta voiture, au prix entre particuliers.</p>
						{/if}
						{#if valuation?.annonces.length}
							{#if show('annonces')}
								<ul class="mt-3 divide-y divide-[var(--border-subtle)] text-[12.5px]">
									{#each valuation.annonces as a, i (i)}
										<li class="flex items-center gap-3 rounded py-1.5" class:survolee={hoveredAd === i}>
											<span class="min-w-0 flex-1 truncate">{a.libelle}{a.annee ? ` · ${a.annee}` : ''}</span>
											<span class="tabular text-secondary hidden shrink-0 text-right @min-[19rem]:inline">{formatKm(a.km)}</span>
											<span class="tabular w-20 shrink-0 text-right font-medium">{formatEUR(a.prix)}</span>
											{#if a.url}
												<a href={a.url} target="_blank" rel="noopener noreferrer" class="text-secondary w-6 shrink-0 text-right hover:underline @min-[30rem]:w-28 @min-[30rem]:truncate" title="Voir l'annonce{a.source ? ` (${a.source})` : ''}"><span class="hidden @min-[30rem]:inline">{a.source ?? 'voir'} </span>↗</a>
											{:else}
												<span class="meta-xs hidden w-28 shrink-0 text-right @min-[30rem]:inline">{a.source ?? ''}</span>
											{/if}
										</li>
									{/each}
								</ul>
							{/if}
						{:else if !valuation}
							<p class="meta-xs mt-2">Pas encore d'estimation détaillée. « Demander une estimation » cherche des annonces comparables (proposition à valider) ; « Modifier » pour saisir une cote toi-même.</p>
						{/if}
						</div>
					{/snippet}
				</Block>
			{:else if id === 'cout'}
				<Block page="voiture" {id} defaults={BLOCKS} title="Coût par mois" size="M" sizes={['S', 'M', 'L', 'XL']} elements={COST_ELEMENTS}>
					{#snippet children(show)}
						<div class="@container">
						<h2 class="label-xs">Coût par mois</h2>
						{#if cost}
							<div class="mt-2 flex flex-wrap items-baseline gap-x-3">
								<p class="amount-md tabular">{formatEUR(cost.total)}</p>
								<p class="meta-xs">coût réel depuis l'achat ({cost.mois.toLocaleString('fr-FR')} mois){show('parkm') && perKm ? ` · ≈ ${perKm.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} €/km` : ''}</p>
							</div>
							{#if show('resume') && cost.countsLoss}
								<p class="meta-xs mt-0.5">
									dont <span class="tabular">{formatEUR(lossPerMonth)}</span>/mois de perte de valeur, invisible sur ton compte · sorti du compte : <span class="tabular">{formatEUR(cost.sortiesParMois)}</span>/mois
								</p>
							{/if}
							{#if show('tableau')}
								<table class="mt-3 w-full text-[13px]">
									<thead>
										<tr class="meta-xs text-left">
											<th class="pb-1 font-normal">Poste</th>
											<th class="pb-1 text-right font-normal">par mois</th>
											<th class="hidden pb-1 text-right font-normal @min-[20rem]:table-cell">depuis l'achat</th>
										</tr>
									</thead>
									<tbody class="divide-y divide-[var(--border-subtle)]">
										{#each cost.lignes as l (l.poste)}
											<tr>
												<td class="py-1">{l.label}{#if l.poste === 'amortissement' && cost.amortissementParDefaut}<span class="meta-xs">{' · estimation théorique'}</span>{:else if l.poste === 'amortissement' && retained && !retained.confirmee}<span class="meta-xs">{' · valeur à confirmer'}</span>{/if}</td>
												<td class="tabular py-1 text-right font-medium">{formatEUR(l.parMois)}</td>
												<td class="tabular text-secondary hidden py-1 text-right @min-[20rem]:table-cell">{formatEUR(l.total)}</td>
											</tr>
										{/each}
									</tbody>
								</table>
							{/if}
							{#if show('explication')}
								<details class="mt-2">
									<summary class="meta-xs cursor-pointer select-none hover:text-[var(--accent)]">Comment c'est calculé ?</summary>
									<div class="meta-xs mt-1.5 space-y-1.5 leading-relaxed">
										{#if !cost.countsLoss}
											<p>
												<b class="font-medium text-[var(--text)]">Ce qui compte</b> : l'argent sorti de ton compte pour la voiture depuis l'achat{cost.credit ? ', mensualités du crédit entières comprises' : ''}, divisé par {cost.mois.toLocaleString('fr-FR')} mois. C'est aussi ce que voit le budget. Le prix d'achat lui-même ne compte pas.
											</p>
										{/if}
										<p>
											<b class="font-medium text-[var(--text)]">Perte de valeur</b> (on dit aussi amortissement ou décote){cost.countsLoss ? '' : ', non comptée ici'} : payée {formatEUR(cost.perte.prix)} le {formatDate(v.purchaseDate)}, ta voiture vaut aujourd'hui
											{#if cost.amortissementParDefaut}≈ {formatEUR(cost.perte.valeur)}, une estimation théorique à −{pct(modulesState.car.depreciation)} par an, faute de valeur retenue (« Saisir une valeur » avec une offre de reprise ou une cote).{:else}{formatEUR(cost.perte.valeur)}, ta valeur retenue ({shortValueSource(retained?.source ?? null)}{retained?.date ? ` du ${shortDate(retained.date)}` : ''}{retained && !retained.confirmee ? ', à confirmer' : ''}).{/if}
											Elle a perdu {formatEUR(cost.perte.prix - cost.perte.valeur)} en {cost.perte.mois.toLocaleString('fr-FR')} mois, soit {formatEUR(lossPerMonth)} par mois. Aucun argent ne sort de ton compte pour ça : c'est ce que tu ne récupéreras pas en la revendant.
											<button type="button" class="cursor-pointer underline decoration-dotted underline-offset-2 hover:text-[var(--accent)]" onclick={() => setCarOptions({ countValueLoss: !cost.countsLoss })}>{cost.countsLoss ? 'Ne plus la compter' : 'La compter dans le coût'}</button>{cost.countsLoss ? '' : ' (le crédit ne compte alors que ses intérêts)'}
										</p>
										{#if cost.countsLoss}
											<p>
												<b class="font-medium text-[var(--text)]">Pourquoi pas le prix d'achat ?</b> Le paiement de {formatEUR(cost.perte.prix)} ne compte qu'à travers cette perte. Sinon, un seul mois porterait tout le prix et la voiture paraîtrait presque gratuite ensuite.
											</p>
											{#if cost.credit}
												<p>
													<b class="font-medium text-[var(--text)]">Crédit</b> :
													{#if cost.credit.interets !== null}
														sur {formatEUR(cost.credit.mensualites)} de mensualités depuis l'achat, {formatEUR(cost.credit.interets)} sont des intérêts : c'est le seul coût du crédit. Le capital remboursé paie le prix d'achat, déjà compté dans la perte de valeur.
													{:else}
														les {formatEUR(cost.credit.mensualites)} de mensualités comptent en entier, faute de taux connu. Leur part de capital est donc comptée deux fois, car elle paie le prix d'achat déjà compté dans la perte de valeur. Pour ne garder que les intérêts, renseigne le taux du crédit dans Patrimoine → Coût réel des crédits.
													{/if}
												</p>
											{/if}
											<p>
												<b class="font-medium text-[var(--text)]">Et le budget ?</b> Il ne voit que l'argent qui sort de ton compte : {formatEUR(cost.sortiesParMois)} par mois en moyenne pour la voiture{cost.credit ? ', mensualités entières comprises' : ''}. La perte de valeur n'apparaît que sur cette fiche : ni le budget, ni les dépenses, ni l'épargne ne la comptent.
											</p>
										{/if}
									</div>
								</details>
							{/if}
						{/if}
						</div>
					{/snippet}
				</Block>
			{:else if id === 'compteur'}
				<Block page="voiture" {id} defaults={BLOCKS} title="Compteur" size="M" sizes={['M', 'L', 'XL']} elements={ODOMETER_ELEMENTS}>
					{#snippet children(show, _size, box)}
						<div class="tuile-col @container" class:tuile-pleine={!!box} style:min-height={box ? `${box.h}px` : null}>
						<div class="flex flex-wrap items-baseline justify-between gap-2">
							<h2 class="label-xs">Compteur</h2>
							<p class="meta-xs tabular">
								{#if kmToday !== null}≈ {formatKm(kmToday)} aujourd'hui{/if}{#if km.moyenne}{` · ${formatKm(km.moyenne)}/an en moyenne`}{/if}
							</p>
						</div>
						{#if show('estimation') && kmEstimated && estimate}
							<!-- Old last reading: estimated odometer, with its clues -->
							<div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md px-2.5 py-1.5 text-[12px]" style="background-color: var(--surface-2);">
								<span>Estimé : <b class="tabular">{formatKm(estimate.km)}</b> <span class="meta-xs">(entre {formatKm(estimate.min)} et {formatKm(estimate.max)})</span></span>
								<span class="meta-xs">
									relevé du {formatDate(estimate.depuis.date)} +{' '}{estimate.composantes.map((c) => `${formatKm(c.km)} (${CLUE_LABELS[c.source]}${c.euros !== undefined ? `, ${formatEUR(c.euros)}` : ''})`).join(' · ')}
								</span>
								<button type="button" class="btn btn-secondary btn-sm ml-auto" onclick={refineWithAi} title="L'Analyse IA lit les lieux de tes achats et tes vacances pour repérer les trajets">Affiner avec l'IA</button>
							</div>
						{/if}
						{#if chart}
							{#if show('courbe')}
								<div class="graphe graphe-courbe mt-2" bind:clientWidth={curveW} bind:clientHeight={curveH}>
								<!-- svelte-ignore a11y_no_static_element_interactions -->
								<svg viewBox="0 0 {cw} {ch}" class="block h-full w-full" role="img" aria-label="Kilométrage dans le temps" onpointermove={onHover} onpointerleave={() => (hover = null)}>
									{#each chart.ticksY as k (k)}
										<line x1={M.l} x2={W - M.r} y1={chart.y(k)} y2={chart.y(k)} stroke="var(--border-subtle)" />
										<text x={M.l - 8} y={chart.y(k) + 4} text-anchor="end" font-size="11" fill="var(--text-2)">{k.toLocaleString('fr-FR')}</text>
									{/each}
									{#each chart.ticksX as t (t.label)}
										<line x1={t.x} x2={t.x} y1={M.t} y2={ch - M.b} stroke="var(--border-subtle)" stroke-dasharray="2 3" />
										<text x={t.x} y={ch - 8} text-anchor="middle" font-size="11" fill="var(--text-2)">{t.label}</text>
									{/each}
									<path d={chart.ligne} fill="none" stroke={CAR_COLOR} stroke-width="2" stroke-linejoin="round" />
									{#if chart.projection}
										<line x1={chart.projection.x1} y1={chart.projection.y1} x2={chart.projection.x2} y2={chart.projection.y2} stroke={CAR_COLOR} stroke-width="2" stroke-dasharray="4 4" />
										<circle cx={chart.projection.x2} cy={chart.projection.y2} r="4" fill="var(--surface)" stroke={CAR_COLOR} stroke-width="2" />
									{/if}
									{#each chart.pts as p (p.date + p.km)}
										<circle cx={p.cx} cy={p.cy} r="4.5" fill={CAR_COLOR} stroke="var(--surface)" stroke-width="2" />
									{/each}
									{#if hover}
										<line x1={hover.x} x2={hover.x} y1={M.t} y2={ch - M.b} stroke="var(--text-2)" stroke-width="1" />
										<text x={labelX(hover.x, M.l + 120, cw - M.r - 120)} y={M.t + 2} text-anchor="middle" font-size="11.5" fill="var(--text)" style="paint-order: stroke; stroke: var(--surface); stroke-width: 4px;">{hover.texte}</text>
									{/if}
								</svg>
								</div>
							{/if}
							{#if show('annees') && km.annees.length}
								<ul class="mt-3 space-y-1 text-[12px]" aria-label="Kilomètres par année">
									{#each km.annees as a (a.annee)}
										<li class="flex items-center gap-3">
											<span class="tabular w-10 shrink-0">{a.annee}</span>
											<span class="h-2 min-w-6 flex-1 overflow-hidden rounded-full" style="background-color: var(--surface-2);">
												<span class="block h-full rounded-full" style="width: {(a.km / maxPerYear) * 100}%; background-color: {CAR_COLOR}; opacity: {a.estime ? 0.55 : 1};"></span>
											</span>
											<span class="tabular shrink-0 text-right @min-[22rem]:w-24">{formatKm(a.km)}</span>
											<span class="meta-xs hidden w-32 shrink-0 @min-[30rem]:inline">{a.partiel ? (a.annee === Number(today.slice(0, 4)) ? 'en cours' : "depuis l'achat") : ''}{a.estime ? ' · estimé' : ''}</span>
										</li>
									{/each}
								</ul>
							{/if}
						{:else}
							<p class="meta-xs mt-2">Ajoute le compteur à l'achat (« Modifier ») ou un relevé ci-dessous : la courbe, les km par an et les paliers de 100 000 km apparaîtront.</p>
						{/if}
						</div>
					{/snippet}
				</Block>
			{:else if id === 'etapes'}
				<Block page="voiture" {id} defaults={BLOCKS} title="Prochaines étapes" size="M" sizes={['S', 'M', 'L']} elements={MILESTONES_ELEMENTS}>
					{#snippet children(show)}
						<div class="@container">
						<h2 class="label-xs">Prochaines étapes</h2>
						<ul class="mt-2 divide-y divide-[var(--border-subtle)] text-[13px]">
							{#each milestones.filter((e) => show('a-renseigner') || e.etat !== 'a-renseigner') as e (e.id)}
								<li class="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-1.5 @min-[20rem]:flex-nowrap">
									<span class="min-w-0 basis-full @min-[20rem]:flex-1 @min-[20rem]:basis-auto">
										<span class="font-medium">{e.label}</span>
										{#if show('details')}<span class="meta-xs block">{e.detail}</span>{/if}
									</span>
									<span class="tabular shrink-0 @min-[20rem]:text-right">{e.date ? formatDate(e.date) : '—'}</span>
									{#if show('etats') || ALWAYS_SHOWN_STATES.has(e.etat)}
										<span class="chip {STATES[e.etat].cls} shrink-0 px-1.5 py-0 text-[10px]">{STATES[e.etat].label}</span>
									{/if}
								</li>
							{/each}
						</ul>
						</div>
					{/snippet}
				</Block>
			{:else if id === 'releves'}
				<Block page="voiture" {id} defaults={BLOCKS} title="Relevés du compteur" size="M" sizes={['S', 'M', 'L', 'XL']} elements={READINGS_ELEMENTS}>
					{#snippet children(show)}
						<div class="@container">
						<h2 class="label-xs">Relevés du compteur</h2>
						{#if show('formulaire')}
							<form class="mt-2 flex flex-wrap items-center gap-2" onsubmit={addReading}>
								<DateField bind:value={readingDate} label="Date du relevé" clearable={false} max={today} class="w-full min-w-0 @min-[17rem]:w-36" />
								<input type="text" inputmode="numeric" class="input-surface tabular w-full min-w-0 @min-[17rem]:w-28" placeholder="km" bind:value={readingKm} aria-label="Kilométrage" />
								<select class="input-surface w-full min-w-0 cursor-pointer @min-[17rem]:w-auto" bind:value={readingSource} aria-label="Source du relevé">
									{#each KM_SOURCES as s (s.id)}<option value={s.id}>{s.label}</option>{/each}
								</select>
								<button type="submit" class="btn btn-primary btn-sm" disabled={!readingKm.trim()}>Ajouter</button>
							</form>
						{/if}
						{#if show('liste')}
							<ul class="mt-2 divide-y divide-[var(--border-subtle)] text-[13px]">
								{#each [...points].reverse() as p (p.date + p.km + p.source)}
									<li class="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-1">
										<span class="tabular text-secondary whitespace-nowrap @min-[18rem]:w-28">{formatDate(p.date)}</span>
										<span class="tabular flex-1 font-medium whitespace-nowrap">{formatKm(p.km)}</span>
										{#if show('sources')}<span class="meta-xs hidden @min-[24rem]:inline">{p.source === 'achat' ? 'à l’achat' : KM_SOURCES.find((s) => s.id === p.source)?.label}</span>{/if}
										{#if p.source !== 'achat'}
											<button type="button" class="text-secondary cursor-pointer text-[12px] hover:underline" onclick={() => removeKm(v.id, p)}>retirer</button>
										{/if}
									</li>
								{:else}
									<li class="meta-xs py-1">Aucun relevé : lis le compteur sur une facture d'entretien ou le procès-verbal du contrôle technique (HistoVec les liste aussi).</li>
								{/each}
							</ul>
						{/if}
						</div>
					{/snippet}
				</Block>
			{:else if id === 'liens'}
				<Block page="voiture" {id} defaults={BLOCKS} title="Vérifier la cote" size="M" sizes={['S', 'M', 'L']} elements={LINKS_ELEMENTS}>
					{#snippet children(show)}
						<h2 class="label-xs">Vérifier la cote</h2>
						<ul class="mt-2 divide-y divide-[var(--border-subtle)] text-[13px]">
							{#each links as l (l.id)}
								<li>
									<a href={l.url} target="_blank" rel="noopener noreferrer" class="lien-cote flex items-center gap-3 py-1.5">
										<span class="min-w-0 flex-1">
											<span class="font-medium">{l.label}</span>
											{#if show('details')}<span class="meta-xs block truncate">{l.detail}</span>{/if}
										</span>
										<span class="text-secondary" aria-hidden="true">↗</span>
									</a>
								</li>
							{/each}
						</ul>
						{#if show('note')}
							<p class="meta-xs mt-2">Recherches préremplies : modèle, année {year}{kmReference ? `, kilométrage proche de ${formatKm(kmReference)}` : ''}{v.vehicle?.version ? ', version (boîte, puissance)' : ''}. Ta plaque n'est envoyée à aucun site : saisis-la toi-même sur la cote L'argus si tu veux.</p>
						{/if}
					{/snippet}
				</Block>
			{/if}
		{/each}
	</TileCanvas>
{/if}

<!-- Retained value: amount and source typed by the user (right panel) -->
<SidePanel open={editingValue && !!v} title={retained?.theorique ? 'Saisir une valeur' : 'Valeur retenue'} onClose={() => (editingValue = false)}>
	<form class="space-y-3" onsubmit={saveValue}>
		<p class="meta-xs">La valeur retenue sert au patrimoine, et à la perte de valeur du coût par mois si tu la comptes. Une offre de reprise ou une cote récente est le plus fiable.</p>
		<label class="block">
			<span class="meta-xs">Montant (€)</span>
			<input type="text" inputmode="decimal" class="input-surface tabular mt-1 block w-40" bind:value={valueAmount} placeholder="18 500" aria-label="Valeur retenue en euros" />
		</label>
		<label class="block">
			<span class="meta-xs">Source</span>
			<select class="input-surface mt-1 block w-full" bind:value={valueSource} aria-label="Source de la valeur">
				{#each VALUE_SOURCES.filter((x) => x.id !== 'ia') as x (x.id)}
					<option value={x.id}>{x.label}</option>
				{/each}
			</select>
		</label>
		<div class="flex flex-wrap gap-2 pt-1">
			<button type="submit" class="btn btn-primary btn-sm">Retenir</button>
			<button type="button" class="btn btn-secondary btn-sm" onclick={() => (editingValue = false)}>Annuler</button>
		</div>
	</form>
</SidePanel>

<!-- Hand-entered valuation and comparable ads (right panel, wider for the ad rows) -->
<SidePanel open={editingValuation && !!v} title="Modifier la cote" onClose={() => (editingValuation = false)} width={600}>
	{#if v}
		{#key v.id + (valuation?.date ?? '')}
			<ValuationEditor bien={v} onDone={() => (editingValuation = false)} framed={false} />
		{/key}
	{/if}
</SidePanel>

<style>
	.scene {
		min-height: 210px;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 8px 12px 26px;
		background: radial-gradient(120% 90% at 50% 30%, color-mix(in srgb, var(--text) 5%, transparent), transparent 70%);
	}
	.scene.depot {
		outline: 2px dashed var(--accent);
		outline-offset: -6px;
	}
	.relief {
		width: 100%;
		max-width: 620px;
		transition: transform 0.35s var(--ease-signature, ease-out);
	}
	/* Block content in a column: once the tile height is fixed, the chart frame takes the free height */
	.tuile-col {
		display: flex;
		min-width: 0;
		flex-direction: column;
	}
	.tuile-col > :global(*) {
		flex-shrink: 0;
	}
	.graphe {
		position: relative;
		min-width: 0;
		height: 190px;
		overflow: hidden;
	}
	.graphe-courbe {
		height: 210px;
	}
	.tuile-pleine > .graphe {
		flex: 1 1 auto;
		height: auto;
		min-height: 140px;
	}
	/* Tile with a fixed height: the visual takes the free height and the car keeps its proportions (720 × 330) */
	.identite-pleine {
		grid-template-rows: minmax(90px, 1fr) auto;
	}
	@container (min-width: 40rem) {
		.identite-pleine {
			grid-template-rows: minmax(0, 1fr);
		}
	}
	.scene-pleine {
		container-type: size;
		min-height: 90px;
	}
	.scene-pleine .relief {
		max-width: min(900px, calc((100cqh - 40px) * 2.18));
	}
	.scene-pleine .photo {
		max-height: calc(100cqh - 40px);
	}
	.photo {
		display: block;
		width: 100%;
		max-height: 300px;
		object-fit: contain;
		border-radius: 10px;
		filter: drop-shadow(0 18px 18px rgba(0, 0, 0, 0.35));
	}
	.action-photo {
		cursor: pointer;
		border-radius: 999px;
		padding: 2px 9px;
		color: var(--text-2);
		background: color-mix(in srgb, var(--surface) 80%, transparent);
		border: 1px solid var(--border-subtle);
	}
	.action-photo:hover {
		color: var(--text);
	}
	.repere {
		position: absolute;
		top: 50%;
		width: 10px;
		height: 10px;
		border-radius: 999px;
		background: var(--text-2);
		border: 2px solid var(--surface);
		transform: translate(-50%, -50%);
	}
	.repere.retenue {
		width: 14px;
		height: 14px;
		background: var(--accent);
	}
	.survolee {
		background: var(--surface-2);
	}
	.depot-doc {
		outline: 2px dashed var(--accent);
		outline-offset: -4px;
	}
	.lien-cote:hover .font-medium {
		text-decoration: underline;
	}
</style>
