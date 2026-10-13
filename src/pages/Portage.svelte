<script lang="ts">
	import DateField from '$lib/components/DateField.svelte';
	import type { CategoryId, Transaction } from '$lib/types';
	import PageTitle from '$lib/components/PageTitle.svelte';
	import ModuleOptionsButton from '$lib/components/ModuleOptionsButton.svelte';
	import { clearModuleActions, setModuleActions } from '$lib/sidePanel.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import PortageHero from '$lib/components/PortageHero.svelte';
	import PortageTaxYear from '$lib/components/PortageTaxYear.svelte';
	import Block from '$lib/components/Block.svelte';
	import TileCanvas from '$lib/components/TileCanvas.svelte';
	import type { BlockElement } from '$lib/layoutModel';
	import { isStored, orderedIds, bringBackBlock } from '$lib/layout.svelte';
	import { CATEGORIES, getCategory, txKey } from '$lib/categories';
	import { signedAmount } from '$lib/data';
	import { merchantLabel } from '$lib/merchant';
	import { cleanLabel, formatDate, formatEUR, formatMonth, maskAmounts } from '$lib/sensitiveFormat';
	import { getTransactions } from '$lib/store.svelte';
	import { showToast } from '$lib/ui.svelte';
	import { lastRateChange, lastWithholding, purchaseDateFromLabel, shiftPortageMonth, salaryTransfer, voucherSpendEntry, voucherSpendRank, type MatchedLine } from '$lib/portage';
	import { dropClaim, moveClaim } from '$lib/refunds.svelte';
	import { setTaxSettings } from '$lib/incomeTax.svelte';
	import {
		portageState,
		getMatches,
		getPendingMoney,
		getTaxAlerts,
		getPortageTaxProvisions,
		getTarget,
		getPortageYearTax,
		setTaxSetting,
		importPortagePdf,
		chooseMatch,
		addCultureVouchers,
		addVoucherSpend,
		removeVoucher,
		cultureVoucherBalance,
		removeSwileSpend,
		swileCap,
		setSwileCap
	} from '$lib/portage.svelte';

	/**
	 * Portage tab (InfoPortage): the 3 monthly PDFs (activity statement, payslip, expense report) read
	 * automatically. Activity and salary month by month, money waiting, expense reports matched to
	 * card purchases, meal vouchers and culture vouchers. What enters the budget is computed in
	 * src/lib/portage.ts.
	 */

	const data = $derived(portageState.data);
	const statement = $derived(data.compte);
	const txs = $derived(getTransactions());
	const pending = $derived(getPendingMoney());
	const alerts = $derived(getTaxAlerts());
	const provisions = $derived(getPortageTaxProvisions());
	const targetRate = $derived(getTarget()?.rate);
	const targetSource = $derived(getTarget()?.source);
	const yearTax = $derived(getPortageYearTax());
	/** The last payslip's rate change, when it belongs to the year shown (it is told inside the year's block). */
	const rateChange = $derived.by(() => {
		const c = lastRateChange(data.paies);
		return c && yearTax && c.month.startsWith(`${yearTax.year}-`) ? c : null;
	});
	/** Rate of the last payslip, and what the budget set aside for the estimated year. */
	const lastRate = $derived(lastWithholding(data.paies)?.pas.taux ?? 0);
	const yearProvisioned = $derived(yearTax ? provisions.filter((p) => p.mois.startsWith(`${yearTax.year}-`)).reduce((s, p) => s + p.montant, 0) : 0);
	const totalProvisions = $derived(provisions.reduce((s, p) => s + p.montant, 0));
	const rateText = $derived(targetRate === undefined ? '' : targetRate.toLocaleString('fr-FR', { maximumFractionDigits: 1 }));
	const matches = $derived(getMatches());
	const isEmpty = $derived(!statement && data.paies.length === 0 && data.notes.length === 0);

	/** Table rows: months of the activity statement and of the payslips. */
	const monthRows = $derived.by(() => {
		const months = [...new Set([...(statement?.mois.map((m) => m.mois) ?? []), ...data.paies.map((p) => p.mois)])].sort().reverse();
		return months.map((m) => {
			const a = statement?.mois.find((x) => x.mois === m);
			const p = data.paies.find((x) => x.mois === m);
			return { mois: m, a, p, vir: p ? salaryTransfer(p, txs) : undefined };
		});
	});

	/** Total owed TO YOU (client invoices pay your salaries: not added). */
	const totalPending = $derived((pending.reserve ?? 0) + pending.frais.reduce((s, f) => s + f.montant, 0) + pending.salaires.reduce((s, x) => s + x.montant, 0));

	/**
	 * Deletes a typed Swile or culture voucher spend with the refund it was waiting for; the
	 * identical spends typed after it move up one rank and their refunds follow.
	 */
	function deleteVoucherSpend(id: string, voucher: 'swile' | 'culture') {
		const list = voucher === 'swile' ? (data.swile ?? []) : data.cheques.depenses;
		const spend = list.find((x) => x.id === id);
		const twins = spend ? list.filter((x) => x.date === spend.date && x.montant === spend.montant && x.libelle === spend.libelle) : [];
		const keys = twins.map((x) => txKey(voucherSpendEntry(x, voucher, voucherSpendRank(list, x))));
		const at = twins.findIndex((x) => x.id === id);
		if (at >= 0) dropClaim(keys[at]!);
		if (voucher === 'swile') removeSwileSpend(id);
		else removeVoucher(id);
		for (let j = at + 1; at >= 0 && j < keys.length; j++) moveClaim(keys[j]!, keys[j - 1]!);
	}

	/** Target rate typed in: empty = automatic neutral rate. */
	function onRateChange(el: HTMLInputElement) {
		if (!el.value.trim()) return setTaxSetting({ taux: null });
		const n = Number(el.value.replace(/[\s%]/g, '').replace(',', '.'));
		if (!Number.isFinite(n) || n < 0 || n > 45) {
			el.value = rateText;
			showToast('Taux entre 0 et 45 %');
			return;
		}
		setTaxSetting({ taux: Math.round(n * 10) / 10 });
	}

	// ---------- Import ----------
	let fileInput = $state<HTMLInputElement | null>(null);
	let importing = $state(false);

	/** The page hands its import action to the « ⚙ Portage » panel while it is shown. */
	$effect(() => {
		setModuleActions('portage', { render: portageActions });
		return () => clearModuleActions('portage');
	});
	let dragActive = $state(false);
	let summaries = $state<string[]>([]);

	async function handleFiles(list: FileList | null | undefined) {
		const files = [...(list ?? [])].filter((f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
		if (!files.length) return;
		importing = true;
		try {
			summaries = await importPortagePdf(files);
			showToast(`${files.length} PDF lu${files.length > 1 ? 's' : ''}`);
		} finally {
			importing = false;
		}
	}

	// ---------- Expense reports ----------
	/** 'de septembre 2026' / 'd'octobre 2026'. */
	const ofMonth = (month: string) => {
		const name = formatMonth(month).toLowerCase();
		return /^[aeiouyéèêâh]/.test(name) ? `d'${name}` : `de ${name}`;
	};
	const txLabel = (tx: Transaction) => merchantLabel(tx.remittance_information) || cleanLabel(tx.remittance_information);
	const txSummary = (tx: Transaction) => `${formatDate(purchaseDateFromLabel(tx))} · ${txLabel(tx)} · ${formatEUR(-signedAmount(tx))}`;

	/** Manual choice options: retained purchase + candidates. */
	function options(r: MatchedLine): Transaction[] {
		const seen = new Set<string>();
		return [r.tx, ...r.candidats].filter((t): t is Transaction => !!t && !seen.has(txKey(t)) && !!seen.add(txKey(t)));
	}

	function choiceValue(r: MatchedLine): string {
		return data.choix[r.ligne.id] ?? '';
	}

	const STATUSES: Record<string, { label: string; cls: string }> = {
		rapprochee: { label: 'rapprochée', cls: 'chip-accent' },
		probable: { label: 'à confirmer', cls: 'chip-amber' },
		indemnite: { label: 'indemnité', cls: 'chip-muted' },
		aucune: { label: 'pas d’achat CB', cls: 'chip-muted' },
		introuvable: { label: 'achat introuvable', cls: 'chip-amber' }
	};

	/** Line whose manual choice is open. */
	let editing = $state<string | null>(null);
	/** The choice stored for the line is the one in force (a purchase that disappeared falls back to automatic). */
	function manualApplied(r: MatchedLine): boolean {
		const c = choiceValue(r);
		if (!c) return false;
		if (c === 'indemnite' || c === 'aucune') return r.etat === c;
		return !!r.tx && txKey(r.tx) === c;
	}
	const focusOnMount = (node: HTMLElement) => node.focus();
	/** Lines still to confirm or without any purchase found, for the report header. */
	const lineTally = (lines: MatchedLine[]) => ({ toConfirm: lines.filter((r) => r.etat === 'probable').length, missing: lines.filter((r) => r.etat === 'introuvable').length });

	/** Reports newest first; the rail shows one at a time (the newest by default) with a dot per month saying whether something is left to do. */
	const notesDesc = $derived([...data.notes].reverse());
	let noteSel = $state<string | null>(null);
	const currentNote = $derived(notesDesc.find((n) => n.numero === noteSel) ?? notesDesc[0]);
	const monthShort = new Intl.DateTimeFormat('fr-FR', { month: 'short', year: '2-digit' });
	const noteLabel = (mois: string) => (/^\d{4}-(0[1-9]|1[0-2])$/.test(mois) ? monthShort.format(new Date(`${mois}-15T12:00:00`)) : mois);
	/** Something left on the report: a line to confirm or a purchase not found. */
	const noteTodo = (numero: string) => {
		const t = lineTally(matches.get(numero) ?? []);
		return t.toConfirm + t.missing > 0;
	};
	function stepNote(delta: -1 | 1) {
		const at = notesDesc.findIndex((n) => n.numero === currentNote?.numero);
		const next = notesDesc[at - delta];
		if (next) noteSel = next.numero;
	}
	function onRailKey(e: KeyboardEvent) {
		if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
			e.preventDefault();
			stepNote(e.key === 'ArrowLeft' ? -1 : 1);
		}
	}
	/** The month shown stays in view in the rail; when the rail has the keyboard, the focus follows it. */
	$effect(() => {
		const numero = currentNote?.numero;
		if (!numero) return;
		const chip = document.querySelector<HTMLElement>(`.ndf-rail-chip[data-note="${CSS.escape(numero)}"]`);
		if (!chip) return;
		chip.scrollIntoView({ block: 'nearest', inline: 'nearest' });
		if (chip.parentElement?.contains(document.activeElement)) chip.focus();
	});

	// ---------- Culture vouchers ----------
	const today = () => new Date().toISOString().slice(0, 10);
	let cDate = $state(today());
	let cAmount = $state('');
	let cLabel = $state('');
	let cCat = $state<CategoryId>('loisirs');
	let creditOpen = $state(false);
	const vouchers = $derived(data.cheques);
	const voucherMoves = $derived(
		[
			...vouchers.credits.map((c) => ({ ...c, signe: 1, categoryId: undefined as CategoryId | undefined })),
			...vouchers.depenses.map((d) => ({ ...d, signe: -1, categoryId: d.categoryId as CategoryId | undefined }))
		].sort((a, b) => b.date.localeCompare(a.date))
	);
	const voucherMonths = $derived(statement?.mois.filter((m) => m.cheques) ?? []);

	function typedAmount(): number | null {
		const n = Number(cAmount.replace(/\s/g, '').replace(',', '.'));
		return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
	}

	function addSpend() {
		const m = typedAmount();
		if (!m || !cLabel.trim()) return;
		addVoucherSpend({ date: cDate, montant: m, libelle: cLabel.trim(), categoryId: cCat });
		cAmount = '';
		cLabel = '';
	}

	function addCredit() {
		const m = typedAmount();
		if (!m) return;
		addCultureVouchers({ date: cDate, montant: m, libelle: cLabel.trim() || formatMonth(cDate.slice(0, 7)) });
		cAmount = '';
		cLabel = '';
		creditOpen = false;
	}

	/** Customisable blocks of the page (default order): the last month's header first. */
	const BLOCKS = ['dernier', 'alertes', 'impot', 'attente', 'mois', 'notes', 'titres', 'cheques', 'regles'] as const;
	/** Months with a known net salary (payslip, else statement), newest first: the header shows the first one. */
	const netMonths = $derived(
		monthRows.flatMap((r) => {
			const net = r.p?.netPaye ?? r.a?.netApresImpot;
			return net === undefined ? [] : [{ mois: r.mois, net, a: r.a, p: r.p }];
		})
	);
	const latestRow = $derived(netMonths[0]);
	const netRows = $derived([...netMonths].reverse().map((r) => ({ mois: r.mois, net: r.net })));

	/** Optional elements of each block, all shown by default. */
	const ALERTS_ELEMENTS: BlockElement[] = [
		{ id: 'details', label: 'Explication de chaque alerte' },
		{ id: 'annee', label: 'Ton année en un coup d’œil (revenu et impôt)' },
		{ id: 'infos', label: "Messages d'information (pas seulement les alertes)" }
	];
	const LATEST_ELEMENTS: BlockElement[] = [
		{ id: 'versement', label: 'Jours, date de versement et frais remboursés' },
		{ id: 'barres', label: 'Net par mois' },
		{ id: 'flux', label: 'Où part la facture' }
	];
	const TAX_ELEMENTS: BlockElement[] = [
		{ id: 'taux', label: 'Taux visé' },
		{ id: 'detail', label: 'Provisions mois par mois' }
	];
	const PENDING_ELEMENTS: BlockElement[] = [
		{ id: 'salaires', label: 'Salaires en route' },
		{ id: 'frais', label: 'Notes de frais à rembourser' },
		{ id: 'reserve', label: 'Réserve financière' },
		{ id: 'client', label: 'Factures du client en attente' }
	];
	const MONTHS_ELEMENTS: BlockElement[] = [
		{ id: 'activite', label: 'Jours, frais de gestion et réserve' },
		{ id: 'brut', label: 'Brut et impôt' },
		{ id: 'extras', label: 'Frais remboursés et titres-resto' },
		{ id: 'virement', label: 'Virement reçu' }
	];
	const NOTES_ELEMENTS: BlockElement[] = [
		{ id: 'commentaires', label: 'Commentaires des lignes' },
		{ id: 'devises', label: 'Montants en devise' },
		{ id: 'achat', label: 'Achat CB retrouvé' },
		{ id: 'choix', label: 'Choix manuel du rapprochement' },
		{ id: 'unparun', label: 'Un mois à la fois (sinon toutes les notes à la suite)' }
	];
	const MEAL_VOUCHERS_ELEMENTS: BlockElement[] = [
		{ id: 'tickets', label: 'Nombre et valeur des tickets' },
		{ id: 'detail', label: 'Part employeur et compléments CB' }
	];
	const CULTURE_VOUCHERS_ELEMENTS: BlockElement[] = [
		{ id: 'activite', label: "Ligne du compte d'activité" },
		{ id: 'formulaire', label: "Formulaire d'ajout" },
		{ id: 'mouvements', label: 'Historique des chèques' }
	];
	const RULES_ELEMENTS: BlockElement[] = [
		{ id: 'frais', label: 'Notes de frais et télétravail' },
		{ id: 'avantages', label: 'Titres-restaurant et chèques culture' },
		{ id: 'impot', label: 'Impôt' },
		{ id: 'soldes', label: 'Soldes bancaires' }
	];

	/** Number of real alerts (not information messages): shown in the block title, even collapsed. */
	const alertCount = $derived(alerts.filter((a) => a.niveau === 'alerte').length);
	const alertsTitle = $derived(alertCount > 0 ? `Alertes impôt (${alertCount})` : 'Alertes impôt');
	/**
	 * Tax alert block hidden while an alert is active: a one-line reminder stays on the page (and the
	 * « ! » in the sidebar), so the alert never disappears silently.
	 */
	const alertHidden = $derived(alertCount > 0 && isStored('portage', 'alertes'));

	/** Top-ups paid by card when the Swile balance is not enough (already in Alimentation). */
	function swileTopUps(month: string): number {
		return txs
			.filter((t) => t.booking_date.startsWith(month) && /SWILE/i.test(t.remittance_information.join(' ')))
			.reduce((s, t) => s - signedAmount(t), 0);
	}
</script>

<section
	class="min-h-[60vh]"
	class:drop-active={dragActive}
	aria-label="Portage salarial"
	ondragover={(e) => {
		if ([...(e.dataTransfer?.types ?? [])].includes('Files')) {
			e.preventDefault();
			dragActive = true;
		}
	}}
	ondragleave={() => (dragActive = false)}
	ondrop={(e) => {
		e.preventDefault();
		dragActive = false;
		void handleFiles(e.dataTransfer?.files);
	}}
>
	<header class="mb-4 flex flex-wrap items-end justify-between gap-3">
		<div>
			<PageTitle title="Portage" />
		</div>
		<div class="flex items-center gap-2">
			<input
				bind:this={fileInput}
				type="file"
				accept=".pdf,application/pdf"
				multiple
				class="hidden"
				aria-label="Importer les PDF InfoPortage (compte d'activité, fiche de paie, note de frais)"
				onchange={(e) => {
					void handleFiles((e.target as HTMLInputElement).files);
					(e.target as HTMLInputElement).value = '';
				}}
			/>
			<ModuleOptionsButton module="portage" />
		</div>
	</header>

	{#if summaries.length}
		<ul class="card mb-3 p-3 text-[12px]" aria-live="polite">
			{#each summaries as r, i (i)}<li class="text-secondary">{r}</li>{/each}
		</ul>
	{/if}

	{#if alertHidden}
		<!-- A stored tax alert never disappears silently: one line here, and the « ! » stays in the sidebar -->
		<p class="meta-xs mb-3 flex flex-wrap items-center gap-2" role="status">
			<span class="inline-block h-1.5 w-1.5 shrink-0 rounded-full" style="background-color: var(--amber);" aria-hidden="true"></span>
			Alerte sur ton prélèvement à la source rangée : la pastille « ! » reste dans la barre latérale.
			<button type="button" class="cursor-pointer underline hover:text-[var(--text)]" onclick={() => bringBackBlock('portage', 'alertes')}>Ressortir</button>
		</p>
	{/if}

	{#if isEmpty}
		<div class="card p-4">
			<EmptyState
				icon="import"
				title="Dépose tes PDF InfoPortage"
				text="Compte d'activité, fiche de paie et note de frais : glisse-les ici chaque mois, tout est lu automatiquement (salaire, frais, tickets resto)."
				ctaLabel="Importer des PDF"
				onCta={() => fileInput?.click()}
			/>
		</div>
	{:else}
		<!-- Customisable blocks: 12 columns on large screens, one column below -->
		<TileCanvas page="portage" defaults={BLOCKS}>
			{#each orderedIds('portage', BLOCKS) as id (id)}
				{#if id === 'dernier'}
					{#if latestRow}
						<Block page="portage" {id} defaults={BLOCKS} title="Dernier mois" size="XL" sizes={['L', 'XL']} elements={LATEST_ELEMENTS} bare>
							{#snippet children(show)}
								<PortageHero {statement} row={latestRow} rows={netRows} {show} />
							{/snippet}
						</Block>
					{/if}
				{:else if id === 'alertes'}
					{#if alerts.length}
						<Block page="portage" {id} defaults={BLOCKS} title={alertsTitle} size="XL" sizes={['M', 'L', 'XL']} elements={ALERTS_ELEMENTS}>
							{#snippet children(show)}
								{@const shownAlerts = alerts.filter((a) => a.niveau === 'alerte' || show('infos'))}
								<h2 class="label-xs">Prélèvement à la source</h2>
								{#if shownAlerts.length}
									<div class="mt-2 space-y-2">
										{#each shownAlerts as a, i (i)}
											<!-- Withholding tax: rate increase or rate too low for the current salary -->
											<div
												class="border-l-4 pl-3 text-[13px]"
												role={a.niveau === 'alerte' ? 'alert' : 'status'}
												style="border-left-color: {a.niveau === 'alerte' ? 'var(--amber)' : 'var(--accent)'};"
											>
												<p class="font-medium" style={a.niveau === 'alerte' ? 'color: var(--amber);' : ''}>{a.niveau === 'alerte' ? '⚠ ' : ''}{maskAmounts(a.titre)}</p>
												{#if show('details') && !(a.annee && show('annee'))}<p class="meta-xs mt-0.5">{maskAmounts(a.detail)}</p>{/if}
											</div>
										{/each}
									</div>
								{:else}
									<p class="meta-xs mt-1">Aucune alerte : {alerts.length} message{alerts.length > 1 ? 's' : ''} d'information masqué{alerts.length > 1 ? 's' : ''}.</p>
								{/if}
								{#if show('annee') && yearTax}
									<PortageTaxYear year={yearTax} rate={lastRate} provisioned={yearProvisioned} change={rateChange} />
								{/if}
								<a href="/impot" class="meta-xs mt-2 inline-block underline" onclick={() => yearTax && setTaxSettings({ year: yearTax.year })}>{yearTax ? `Détail du calcul de ${yearTax.year} sur la page Impôt →` : 'Estimer l’impôt de l’année et la régularisation →'}</a>
							{/snippet}
						</Block>
					{/if}
				{:else if id === 'impot'}
					{#if data.paies.some((p) => p.pas)}
						<Block page="portage" {id} defaults={BLOCKS} title="Provision d'impôt" size="XL" sizes={['M', 'L', 'XL']} elements={TAX_ELEMENTS}>
							{#snippet children(show)}
								<!-- Tax provision: the part not withheld, counted each month as 'Impôts' spending -->
								<div class="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px]">
									<h2 class="label-xs">Provision d'impôt</h2>
									<label class="flex cursor-pointer items-center gap-1.5 font-medium">
										<input type="checkbox" checked={data.impot?.provision !== false} onchange={(e) => setTaxSetting({ provision: e.currentTarget.checked })} />
										Mettre de côté l'impôt pas prélevé
									</label>
									{#if show('taux')}
										<label class="text-secondary flex items-center gap-1.5">
											taux visé
											<input
												type="text"
												inputmode="decimal"
												class="input-surface tabular w-16 text-right"
												value={rateText}
												onchange={(e) => onRateChange(e.currentTarget)}
												aria-label="Taux d'impôt visé (%)"
											/>
											%
										</label>
										{#if data.impot?.taux !== undefined}
											<button type="button" class="btn btn-ghost btn-sm" onclick={() => setTaxSetting({ taux: null })}>{yearTax?.portageRate != null ? 'revenir au taux de l’année' : 'revenir au taux neutre'}</button>
										{:else if targetSource === 'annee'}
											<span class="meta-xs">= moyenne de ton année {yearTax?.year} : sa part d’impôt ÷ tes salaires du portage (page Impôt)</span>
										{:else}
											<span class="meta-xs">= taux neutre de ton dernier salaire</span>
										{/if}
									{/if}
									{#if show('detail')}
										<span class="meta-xs tabular ml-auto">
											{#if data.impot?.provision === false}
												désactivée : ton budget ne compte que l'impôt prélevé
											{:else if provisions.length}
												{provisions.map((p) => `${formatMonth(p.mois)} ${formatEUR(p.montant)}`).join(' · ')} → {formatEUR(totalProvisions)} en dépense « Impôts »
											{:else}
												rien à mettre de côté : le taux prélevé suffit
											{/if}
										</span>
									{/if}
								</div>
							{/snippet}
						</Block>
					{/if}
				{:else if id === 'attente'}
					<Block page="portage" {id} defaults={BLOCKS} title="Argent qui t'attend" size="M" sizes={['S', 'M', 'L', 'XL']} elements={PENDING_ELEMENTS}>
						{#snippet children(show)}
							<div class="flex items-baseline justify-between gap-2">
								<h2 class="label-xs">Argent qui t'attend</h2>
								<p class="tabular text-[13px] font-medium">{formatEUR(totalPending)}</p>
							</div>
							<ul class="mt-2 divide-y divide-[var(--border-subtle)] text-[13px]">
								{#if show('salaires')}
									{#each pending.salaires as s (s.mois)}
										<li class="flex items-center gap-3 py-1.5">
											<span class="min-w-0 flex-1">Salaire {ofMonth(s.mois)} <span class="meta-xs">versé{s.datePaiement ? ` le ${formatDate(s.datePaiement)}` : ''}, pas encore sur ton compte</span></span>
											<span class="tabular font-medium">{formatEUR(s.montant)}</span>
										</li>
									{/each}
								{/if}
								{#if show('frais')}
									{#each pending.frais as f (f.numero)}
										<li class="flex items-center gap-3 py-1.5">
											<span class="min-w-0 flex-1">Note de frais {ofMonth(f.mois)} <span class="meta-xs">remboursée avec le salaire {ofMonth(f.salaire)}</span></span>
											<span class="tabular font-medium">{formatEUR(f.montant)}</span>
										</li>
									{/each}
								{/if}
								{#if show('reserve') && pending.reserve}
									<li class="flex items-center gap-3 py-1.5">
										<span class="min-w-0 flex-1">Réserve financière <span class="meta-xs">à toi, récupérable sur demande ou en fin de contrat</span></span>
										<span class="tabular font-medium">{formatEUR(pending.reserve)}</span>
									</li>
								{/if}
								{#if show('client') && pending.client}
									<li class="flex items-center gap-3 py-1.5">
										<span class="min-w-0 flex-1">Factures pas encore payées par le client <span class="meta-xs">{pending.delaiClient ? `paiement à ${pending.delaiClient}` : ''} · déjà comptées dans tes salaires</span></span>
										<span class="tabular text-secondary">{formatEUR(pending.client)}</span>
									</li>
								{/if}
							</ul>
						{/snippet}
					</Block>
				{:else if id === 'mois'}
					{#if monthRows.length}
						<Block page="portage" {id} defaults={BLOCKS} title="Mois par mois" size="XL" sizes={['L', 'XL']} elements={MONTHS_ELEMENTS}>
							{#snippet children(show)}
								{@const showActivity = show('activite')}
								{@const showGross = show('brut')}
								{@const showExtras = show('extras')}
								{@const showTransfer = show('virement')}
								{@const columns = 3 + (showActivity ? 3 : 0) + (showGross ? 2 : 0) + (showExtras ? 2 : 0) + (showTransfer ? 1 : 0)}
								<h2 class="label-xs">Mois par mois</h2>
								<div class="mt-2 overflow-x-auto">
									<table class="w-full text-[12px] whitespace-nowrap" style="min-width: {columns * 70}px;">
										<thead>
											<tr class="text-left text-secondary">
												<th class="colle py-1 pr-2 font-normal">Mois</th>
												{#if showActivity}<th class="py-1 pr-2 text-right font-normal">Jours</th>{/if}
												<th class="py-1 pr-2 text-right font-normal">CA HT</th>
												{#if showActivity}
													<th class="py-1 pr-2 text-right font-normal">Frais gestion</th>
													<th class="py-1 pr-2 text-right font-normal">Réserve</th>
												{/if}
												{#if showGross}
													<th class="py-1 pr-2 text-right font-normal">Brut</th>
													<th class="py-1 pr-2 text-right font-normal">Impôt</th>
												{/if}
												<th class="py-1 pr-2 text-right font-normal">Net versé</th>
												{#if showExtras}
													<th class="py-1 pr-2 text-right font-normal">dont frais</th>
													<th class="py-1 pr-2 text-right font-normal">Titres-resto</th>
												{/if}
												{#if showTransfer}<th class="py-1 text-right font-normal">Virement</th>{/if}
											</tr>
										</thead>
										<tbody class="divide-y divide-[var(--border-subtle)]">
											{#each monthRows as l (l.mois)}
												<tr>
													<td class="colle py-1.5 pr-2 font-medium whitespace-nowrap">{formatMonth(l.mois)}</td>
													{#if showActivity}<td class="tabular py-1.5 pr-2 text-right">{l.a?.jours ?? '—'}</td>{/if}
													<td class="tabular py-1.5 pr-2 text-right">{l.a?.ca !== undefined ? formatEUR(l.a.ca) : '—'}</td>
													{#if showActivity}
														<td class="tabular py-1.5 pr-2 text-right text-secondary">{l.a?.fraisGestion !== undefined ? formatEUR(l.a.fraisGestion) : '—'}</td>
														<td class="tabular py-1.5 pr-2 text-right text-secondary">{l.a?.reserve !== undefined ? formatEUR(-l.a.reserve) : '—'}</td>
													{/if}
													{#if showGross}
														<td class="tabular py-1.5 pr-2 text-right">{(l.p?.brut ?? l.a?.brut) !== undefined ? formatEUR((l.p?.brut ?? l.a?.brut)!) : '—'}</td>
														<td class="tabular py-1.5 pr-2 text-right text-secondary">{(l.p?.pas?.montant ?? l.a?.impot) !== undefined ? formatEUR((l.p?.pas?.montant ?? l.a?.impot)!) : '—'}</td>
													{/if}
													<td class="tabular py-1.5 pr-2 text-right font-medium">{(l.p?.netPaye ?? l.a?.netApresImpot) !== undefined ? formatEUR((l.p?.netPaye ?? l.a?.netApresImpot)!) : '—'}</td>
													{#if showExtras}
														<td class="tabular py-1.5 pr-2 text-right text-secondary">{(l.p?.rembFrais ?? l.a?.rembFrais) ? formatEUR((l.p?.rembFrais ?? l.a?.rembFrais)!) : '—'}</td>
														<td class="tabular py-1.5 pr-2 text-right">{l.p?.titresRestaurant ? `${l.p.titresRestaurant.nombre} · ${formatEUR(l.p.titresRestaurant.partSalariale + l.p.titresRestaurant.partPatronale)}` : '—'}</td>
													{/if}
													{#if showTransfer}
														<td class="py-1.5 text-right">
															{#if l.vir}
																<span class="chip chip-accent px-1.5 py-0 text-[10px]" title={l.vir.remittance_information.join(' ')}>reçu le {formatDate(l.vir.booking_date)}</span>
															{:else if l.p}
																<span class="chip chip-amber px-1.5 py-0 text-[10px]">attendu</span>
															{:else}
																<span class="text-secondary">—</span>
															{/if}
														</td>
													{/if}
												</tr>
											{/each}
										</tbody>
									</table>
								</div>
							{/snippet}
						</Block>
					{/if}
				{:else if id === 'notes'}
					{#if data.notes.length}
						<Block page="portage" {id} defaults={BLOCKS} title="Notes de frais" size="XL" sizes={['L', 'XL']} elements={NOTES_ELEMENTS}>
							{#snippet children(show)}
								{@const showPurchase = show('achat')}
								{@const showChoice = show('choix')}
								{@const oneByOne = show('unparun') && notesDesc.length > 1}
								<div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
									<h2 class="label-xs">Notes de frais</h2>
									{#if oneByOne}
										<!-- One month at a time: a rail of months, a dot on those with something left to do, arrows and ← → to move -->
										<nav class="ndf-rail" aria-label="Mois des notes de frais">
											<button type="button" class="ndf-rail-arrow" aria-label="Mois précédent" disabled={currentNote?.numero === notesDesc[notesDesc.length - 1]?.numero} onclick={() => stepNote(-1)}>‹</button>
											<div class="ndf-rail-months" role="tablist" aria-label="Choisir le mois" tabindex="-1" onkeydown={onRailKey}>
												{#each [...notesDesc].reverse() as n (n.numero)}
													{@const todo = noteTodo(n.numero)}
													<button type="button" role="tab" data-note={n.numero} class="ndf-rail-chip {n.numero === currentNote?.numero ? 'is-current' : ''}" aria-selected={n.numero === currentNote?.numero} tabindex={n.numero === currentNote?.numero ? 0 : -1} title="{formatMonth(n.mois)} · {formatEUR(n.total)}{todo ? ' · à traiter' : ''}" onclick={() => (noteSel = n.numero)}>
														{noteLabel(n.mois)}{#if todo}<i class="ndf-rail-dot" aria-label="à traiter"></i>{/if}
													</button>
												{/each}
											</div>
											<button type="button" class="ndf-rail-arrow" aria-label="Mois suivant" disabled={currentNote?.numero === notesDesc[0]?.numero} onclick={() => stepNote(1)}>›</button>
										</nav>
									{/if}
								</div>
								{#each oneByOne ? (currentNote ? [currentNote] : []) : notesDesc as note (note.numero)}
									{@const lines = matches.get(note.numero) ?? []}
									{@const tally = lineTally(lines)}
									<div class="mt-3 @container" role={oneByOne ? 'tabpanel' : undefined}>
										<p class="ndf-head">
											<span class="font-medium">{formatMonth(note.mois)}</span>
											<span class="meta-xs min-w-0 flex-1">n° {note.numero}{note.etat ? ` · ${note.etat.toLowerCase()}` : ''} · remboursée avec le salaire {ofMonth(shiftPortageMonth(note.mois, 1))}</span>
											{#if tally.toConfirm}<span class="chip chip-amber px-1.5 py-0 text-[10px]">{tally.toConfirm} à confirmer</span>{/if}
											{#if tally.missing}<span class="chip chip-amber px-1.5 py-0 text-[10px]">{tally.missing} introuvable{tally.missing > 1 ? 's' : ''}</span>{/if}
											<span class="tabular font-medium">{formatEUR(note.total)}</span>
										</p>
										<!-- One calm row per expense: the purchase found (or the state) on the right, the manual choice behind « modifier » -->
										<ul class="divide-y divide-[var(--border-subtle)] text-[12px]">
											{#each lines as r (r.ligne.id)}
												{@const manual = manualApplied(r)}
												{@const open = editing === r.ligne.id}
												<li class="ligne-ndf">
													<span class="ndf-date tabular whitespace-nowrap text-secondary">{formatDate(r.ligne.date)}</span>
													<span class="ndf-nature min-w-0 truncate" title={r.ligne.commentaire ? `${r.ligne.nature} · ${r.ligne.commentaire}` : r.ligne.nature}>{r.ligne.nature}{#if show('commentaires') && r.ligne.commentaire}<span class="meta-xs"> · {r.ligne.commentaire}</span>{/if}</span>
													<span class="ndf-montant tabular text-right">{formatEUR(r.ligne.montant)}{#if show('devises') && r.ligne.devise}<span class="meta-xs"> · {r.ligne.devise.montant.toLocaleString('fr-FR')} {r.ligne.devise.code}</span>{/if}</span>
													<span class="ndf-achat">
														{#if r.etat === 'rapprochee' && r.tx}
															<span class="ndf-ok" role="img" aria-label="rapprochée">✓</span>
															{#if showPurchase}<span class="meta-xs min-w-0 truncate" title={r.tx.remittance_information.join(' ')}>{txSummary(r.tx)}</span>{/if}
														{:else if r.etat === 'probable' && r.tx}
															<span class="chip chip-amber flex-none px-1.5 py-0 text-[10px]">à confirmer</span>
															{#if showPurchase}<span class="meta-xs min-w-0 truncate" title={r.tx.remittance_information.join(' ')}>{txSummary(r.tx)}</span>{/if}
															<button type="button" class="btn btn-secondary btn-sm flex-none" onclick={() => chooseMatch(r.ligne.id, txKey(r.tx!))}>Confirmer</button>
														{:else}
															<span class="chip {STATUSES[r.etat]!.cls} flex-none px-1.5 py-0 text-[10px]">{STATUSES[r.etat]!.label}</span>
															{#if showPurchase && r.etat === 'indemnite'}<span class="meta-xs">reste un revenu</span>{/if}
														{/if}
														{#if manual && !open}<span class="meta-xs flex-none">· choix manuel</span>{/if}
														{#if showChoice}
															{#if open}
																<select
																	class="input-surface ndf-select cursor-pointer"
																	use:focusOnMount
																	value={choiceValue(r)}
																	aria-label="Rapprochement de la ligne {r.ligne.n}"
																	onchange={(e) => {
																		const v = (e.target as HTMLSelectElement).value;
																		chooseMatch(r.ligne.id, v === '' ? null : v);
																	}}
																>
																	<option value="">Automatique</option>
																	{#each options(r) as t (txKey(t))}
																		<option value={txKey(t)}>{txSummary(t)}</option>
																	{/each}
																	<option value="indemnite">Indemnité (sans achat)</option>
																	<option value="aucune">Pas d'achat CB</option>
																</select>
																<button type="button" class="ndf-tool is-open" onclick={() => (editing = null)}>fermer</button>
															{:else}
																<button type="button" class="ndf-tool" onclick={() => (editing = r.ligne.id)} aria-label="Modifier le rapprochement de la ligne {r.ligne.n}">modifier</button>
															{/if}
														{/if}
													</span>
												</li>
											{/each}
										</ul>
									</div>
								{/each}
							{/snippet}
						</Block>
					{/if}
				{:else if id === 'titres'}
					{#if data.paies.some((p) => p.titresRestaurant)}
						<Block page="portage" {id} defaults={BLOCKS} title="Titres-restaurant" size="M" sizes={['S', 'M', 'L', 'XL']} elements={MEAL_VOUCHERS_ELEMENTS}>
							{#snippet children(show)}
								<h2 class="label-xs">Titres-restaurant (Swile)</h2>
								<ul class="mt-2 divide-y divide-[var(--border-subtle)] text-[13px]">
									{#each [...data.paies].reverse().filter((p) => p.titresRestaurant) as p (p.mois)}
										{@const t = p.titresRestaurant!}
										{@const topUp = swileTopUps(p.mois)}
										<li class="py-1.5">
											<div class="flex items-center gap-3">
												<span class="min-w-0 flex-1">{formatMonth(p.mois)}{#if show('tickets')}{' '}<span class="meta-xs">· {t.nombre} tickets de {formatEUR((t.partSalariale + t.partPatronale) / t.nombre)}</span>{/if}</span>
												<span class="tabular font-medium">{formatEUR(t.partSalariale + t.partPatronale)}</span>
											</div>
											{#if show('detail')}
												<p class="meta-xs">dont {formatEUR(t.partPatronale)} payés par l'employeur{topUp > 0 ? ` · compléments CB Swile ${formatEUR(topUp)}` : ''}</p>
											{/if}
										</li>
									{/each}
								</ul>
								{#if (data.swile ?? []).length}
									<p class="label-xs mt-3">Repas saisis un par un</p>
									<ul class="mt-1 divide-y divide-[var(--border-subtle)] text-[13px]">
										{#each [...(data.swile ?? [])].reverse().slice(0, 8) as m (m.id)}
											<li class="flex items-center gap-3 py-1">
												<span class="meta-xs tabular w-20 shrink-0">{formatDate(m.date)}</span>
												<span class="min-w-0 flex-1 truncate">{m.libelle}</span>
												<span class="tabular">{formatEUR(m.montant)}</span>
												<button type="button" class="cursor-pointer text-secondary hover:text-[var(--amber)]" aria-label="Supprimer le repas {m.libelle}" onclick={() => deleteVoucherSpend(m.id, 'swile')}>×</button>
											</li>
										{/each}
									</ul>
									<p class="meta-xs mt-1">Ils réduisent d'autant le forfait « repas Swile » du mois.</p>
								{/if}
								<label class="meta-xs mt-2 flex items-center gap-1.5">
									Plafond par jour
									<input type="text" inputmode="decimal" class="input-surface tabular w-14 !px-1.5 !py-0.5 text-right text-xs" value={String(swileCap()).replace('.', ',')} aria-label="Plafond Swile par jour (€)" onchange={(e) => { const v = Number((e.target as HTMLInputElement).value.replace(',', '.')); setSwileCap(Number.isFinite(v) && v > 0 ? v : null); }} />
									€ · au-delà, la saisie rapide met le reste sur ta carte
								</label>
							{/snippet}
						</Block>
					{/if}
				{:else if id === 'cheques'}
					<Block page="portage" {id} defaults={BLOCKS} title="Chèques culture" size="M" sizes={['S', 'M', 'L', 'XL']} elements={CULTURE_VOUCHERS_ELEMENTS}>
						{#snippet children(show)}
							<div class="@container">
							<div class="flex flex-wrap items-baseline justify-between gap-x-2">
								<h2 class="label-xs">Chèques culture</h2>
								{#if show('formulaire')}
									<button type="button" class="text-[12px] text-secondary hover:underline" onclick={() => (creditOpen = !creditOpen)}>+ chèques reçus</button>
								{/if}
							</div>
							<p class="amount-md tabular mt-2">{formatEUR(cultureVoucherBalance())}</p>
							<p class="meta-xs mt-1">
								solde disponible{#if show('activite')}{#each voucherMonths as m (m.mois)}{' '}<span>· ligne « chèques » du compte d'activité en {formatMonth(m.mois).toLowerCase()} : {formatEUR(-(m.cheques ?? 0))}</span>{/each}{/if}
							</p>
							{#if show('formulaire')}
								<form
									class="mt-3 flex flex-wrap items-end gap-2"
									onsubmit={(e) => {
										e.preventDefault();
										if (creditOpen) addCredit();
										else addSpend();
									}}
								>
									<DateField bind:value={cDate} label="Date de la dépense" clearable={false} class="w-full min-w-0 @min-[17rem]:w-36" />
									<input type="text" inputmode="decimal" class="input-surface tabular w-full min-w-0 @min-[17rem]:w-24" placeholder="€" bind:value={cAmount} aria-label="Montant (€)" />
									<input type="text" class="input-surface w-full min-w-0 flex-1 @min-[17rem]:w-auto @min-[17rem]:min-w-32" placeholder={creditOpen ? 'ex. septembre 2026' : 'ex. Livres, concert'} maxlength="80" bind:value={cLabel} aria-label="Libellé" />
									{#if !creditOpen}
										<select class="input-surface w-full min-w-0 cursor-pointer @min-[17rem]:w-auto" bind:value={cCat} aria-label="Catégorie">
											{#each CATEGORIES.filter((c) => c.id !== 'revenus' && c.id !== 'epargne') as c (c.id)}
												<option value={c.id}>{c.label}</option>
											{/each}
										</select>
									{/if}
									<button type="submit" class="btn btn-primary btn-sm">{creditOpen ? 'Ajouter les chèques' : 'J’ai payé avec'}</button>
								</form>
							{/if}
							{#if show('mouvements') && voucherMoves.length}
								<ul class="mt-3 divide-y divide-[var(--border-subtle)] text-[12px]">
									{#each voucherMoves as m (m.id)}
										<li class="flex items-center gap-2 py-1">
											<span class="tabular shrink-0 whitespace-nowrap text-secondary @min-[17rem]:w-24">{formatDate(m.date)}</span>
											<span class="min-w-0 flex-1 truncate">{m.libelle}{m.categoryId ? ` · ${getCategory(m.categoryId).label}` : ''}</span>
											<span class="tabular" style={m.signe > 0 ? 'color: var(--accent);' : ''}>{m.signe > 0 ? '+' : '−'}{formatEUR(m.montant)}</span>
											<button type="button" class="cursor-pointer text-secondary hover:text-[var(--amber)]" aria-label="Supprimer" onclick={() => (m.signe < 0 ? deleteVoucherSpend(m.id, 'culture') : removeVoucher(m.id))}>×</button>
										</li>
									{/each}
								</ul>
							{/if}
							</div>
						{/snippet}
					</Block>
				{:else if id === 'regles'}
					<Block page="portage" {id} defaults={BLOCKS} title="Comment c'est compté" size="XL" sizes={['M', 'L', 'XL']} elements={RULES_ELEMENTS}>
						{#snippet children(show)}
							<h2 class="label-xs">Comment c'est compté dans ton budget</h2>
							<ul class="meta-xs mt-2 list-disc space-y-1 pl-4">
								{#if show('frais')}
									<li>Achats CB d'une note de frais : neutralisés dans leur catégorie ; la part du salaire suivant qui les rembourse n'est pas comptée comme revenu.</li>
									<li>Indemnités de télétravail (et leurs régularisations, ex. « Documentation · Régul TT ») : comptées en revenu, sans achat.</li>
								{/if}
								{#if show('avantages')}
									<li>Titres-restaurant : crédit Swile en revenu et repas en Alimentation, chaque mois, d'après la fiche de paie.</li>
									<li>Chèques culture : crédit en revenu, puis chaque dépense notée ici dans sa catégorie.</li>
								{/if}
								{#if show('impot')}
									<li>Impôt : si le taux prélevé est trop bas, l'écart avec le taux visé est compté en dépense « Impôts » le jour du salaire (provision). Quand la régularisation sera prélevée, exclus-la du budget.</li>
								{/if}
								{#if show('soldes')}
									<li>Rien de tout ça ne touche tes soldes bancaires : ce sont des écritures du budget, marquées « Portage » dans Transactions.</li>
								{/if}
							</ul>
						{/snippet}
					</Block>
				{/if}
			{/each}
		</TileCanvas>
	{/if}
</section>

<style>
	/* Month column kept in view while the table scrolls sideways */
	.colle {
		position: sticky;
		left: 0;
		z-index: 1;
		background-color: var(--surface);
	}
	.ndf-head {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.25rem 0.5rem;
		padding-bottom: 0.25rem;
		font-size: 13px;
	}
	/* Expense line: stacked in a narrow tile, one row from 44rem of tile width */
	.ligne-ndf {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		grid-template-areas:
			'nature montant'
			'date date'
			'achat achat';
		align-items: center;
		column-gap: 0.75rem;
		row-gap: 0.2rem;
		padding: 0.3rem 0;
	}
	@container (min-width: 44rem) {
		.ligne-ndf {
			grid-template-columns: 5.5rem minmax(8rem, 1fr) 8.5rem minmax(14rem, 1.5fr);
			grid-template-areas: 'date nature montant achat';
		}
	}
	.ndf-date {
		grid-area: date;
	}
	.ndf-nature {
		grid-area: nature;
	}
	.ndf-montant {
		grid-area: montant;
	}
	.ndf-achat {
		grid-area: achat;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-width: 0;
	}
	.ndf-ok {
		flex: none;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1rem;
		height: 1rem;
		border-radius: 9999px;
		color: var(--accent);
		font-weight: 600;
		font-size: 10px;
		line-height: 1;
	}
	.ndf-select {
		max-width: 16rem;
		min-width: 0;
		padding-top: 1px;
		padding-bottom: 1px;
		font-size: 11px;
	}
	/* « modifier » waits for the pointer (or the keyboard) on the row */
	.ndf-tool {
		flex: none;
		color: var(--text-2);
		font-size: 11px;
		cursor: pointer;
		opacity: 0;
		transition: opacity var(--motion-fast) ease;
	}
	.ndf-tool:hover {
		color: var(--accent);
		text-decoration: underline;
	}
	.ligne-ndf:hover .ndf-tool,
	.ligne-ndf:focus-within .ndf-tool,
	.ndf-tool.is-open {
		opacity: 1;
	}
	@media (hover: none) {
		.ndf-tool {
			opacity: 0.7;
		}
	}
	/* Month rail of the expense reports */
	.ndf-rail {
		display: flex;
		align-items: center;
		gap: 2px;
		min-width: 0;
	}
	.ndf-rail-months {
		display: flex;
		gap: 2px;
		max-width: 28rem;
		overflow-x: auto;
		scrollbar-width: none;
	}
	.ndf-rail-chip {
		position: relative;
		flex: none;
		padding: 2px 8px 2px 8px;
		border-radius: 9999px;
		color: var(--text-2);
		font-size: 11px;
		white-space: nowrap;
		cursor: pointer;
		transition:
			background-color var(--motion-fast) ease,
			color var(--motion-fast) ease;
	}
	.ndf-rail-chip:hover {
		background: var(--surface-2);
		color: var(--text);
	}
	.ndf-rail-chip.is-current {
		background: var(--accent);
		color: var(--surface);
		font-weight: 500;
	}
	.ndf-rail-dot {
		display: inline-block;
		width: 6px;
		height: 6px;
		margin-left: 4px;
		border-radius: 9999px;
		background: var(--amber);
		vertical-align: 1px;
	}
	.ndf-rail-arrow {
		flex: none;
		width: 1.4rem;
		height: 1.4rem;
		border-radius: 9999px;
		color: var(--text-2);
		font-size: 15px;
		line-height: 1;
		cursor: pointer;
	}
	.ndf-rail-arrow:hover:not(:disabled) {
		background: var(--surface-2);
		color: var(--text);
	}
	.ndf-rail-arrow:disabled {
		opacity: 0.3;
		cursor: default;
	}
	.drop-active {
		outline: 2px dashed var(--accent);
		outline-offset: 6px;
		border-radius: 12px;
	}
</style>

<!-- Action of the « ⚙ Portage » panel -->
{#snippet portageActions()}
	<button type="button" class="btn btn-accent btn-sm" disabled={importing} onclick={() => fileInput?.click()}>
		{importing ? 'Lecture des PDF…' : 'Importer des PDF du mois'}
	</button>
	<p class="meta-xs mt-1.5">Compte d'activité, fiche de paie, note de frais : tu peux aussi les glisser directement sur la page.</p>
{/snippet}
