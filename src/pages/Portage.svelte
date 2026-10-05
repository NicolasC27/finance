<script lang="ts">
	import DateField from '$lib/components/DateField.svelte';
	import type { CategoryId, Transaction } from '$lib/types';
	import PageTitle from '$lib/components/PageTitle.svelte';
	import ModuleOptionsButton from '$lib/components/ModuleOptionsButton.svelte';
	import { clearModuleActions, setModuleActions } from '$lib/sidePanel.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
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
	import { purchaseDateFromLabel, shiftPortageMonth, salaryTransfer, type MatchedLine } from '$lib/portage';
	import {
		portageState,
		getMatches,
		getPendingMoney,
		getTaxAlerts,
		getPortageTaxProvisions,
		getTargetRate,
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
	const targetRate = $derived(getTargetRate());
	const totalProvisions = $derived(provisions.reduce((s, p) => s + p.montant, 0));
	const rateText = $derived(targetRate === undefined ? '' : targetRate.toLocaleString('fr-FR'));
	const matches = $derived(getMatches());
	const latest = $derived(data.paies[data.paies.length - 1]);
	const latestActivity = $derived(latest ? statement?.mois.find((m) => m.mois === latest.mois) : undefined);
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

	/** Customisable blocks of the page (default order). */
	const BLOCKS = ['alertes', 'impot', 'dernier', 'attente', 'mois', 'notes', 'titres', 'cheques', 'regles'] as const;

	/** Optional elements of each block, all shown by default. */
	const ALERTS_ELEMENTS: BlockElement[] = [
		{ id: 'details', label: 'Explication de chaque alerte' },
		{ id: 'infos', label: "Messages d'information (pas seulement les alertes)" }
	];
	const TAX_ELEMENTS: BlockElement[] = [
		{ id: 'taux', label: 'Taux visé' },
		{ id: 'detail', label: 'Provisions mois par mois' }
	];
	const LATEST_ELEMENTS: BlockElement[] = [
		{ id: 'versement', label: 'Date de versement et frais remboursés' },
		{ id: 'ca', label: 'CA et part nette' },
		{ id: 'retenues', label: 'Impôt et titres-restaurant' }
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
		{ id: 'choix', label: 'Choix manuel du rapprochement' }
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
			{#if statement || latest}
				<p class="meta-xs mt-1">
					InfoPortage{latest?.emploi ? ` · ${latest.emploi}` : ''}{statement?.tjm ? ` · TJM ${formatEUR(statement.tjm)}` : ''}{statement?.client
						? ` · ${statement.client}${statement.clientFinal ? ` → ${statement.clientFinal}` : ''}`
						: ''}{statement?.dateEntree ? ` · depuis le ${formatDate(statement.dateEntree)}` : ''}
				</p>
			{/if}
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
				{#if id === 'alertes'}
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
												{#if show('details')}<p class="meta-xs mt-0.5">{maskAmounts(a.detail)}</p>{/if}
											</div>
										{/each}
									</div>
								{:else}
									<p class="meta-xs mt-1">Aucune alerte : {alerts.length} message{alerts.length > 1 ? 's' : ''} d'information masqué{alerts.length > 1 ? 's' : ''}.</p>
								{/if}
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
											<button type="button" class="btn btn-ghost btn-sm" onclick={() => setTaxSetting({ taux: null })}>revenir au taux neutre</button>
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
				{:else if id === 'dernier'}
					{#if latest}
						<Block page="portage" {id} defaults={BLOCKS} title="Dernier mois" size="M" sizes={['S', 'M', 'L']} elements={LATEST_ELEMENTS}>
							{#snippet children(show)}
								<h2 class="label-xs">{formatMonth(latest.mois)}</h2>
								<p class="amount-md tabular mt-2">{formatEUR(latest.netPaye)}</p>
								<p class="meta-xs mt-1">
									net versé{#if show('versement')}{latest.datePaiement ? ` le ${formatDate(latest.datePaiement)}` : ''}{latest.rembFrais > 0 ? ` · dont ${formatEUR(latest.rembFrais)} de frais remboursés` : ''}{/if}
								</p>
								{#if (show('ca') && latestActivity?.ca) || (show('retenues') && (latest.pas || latest.titresRestaurant))}
									<dl class="mt-3 space-y-1 border-t pt-3 text-[13px]" style="border-color: var(--border-subtle);">
										{#if show('ca') && latestActivity?.ca}
											<div class="chiffre"><dt class="text-secondary">CA HT</dt><dd class="tabular">{formatEUR(latestActivity.ca)}{latestActivity.jours ? ` · ${latestActivity.jours} j` : ''}</dd></div>
											<div class="chiffre"><dt class="text-secondary">Net / CA</dt><dd class="tabular">{Math.round(((latest.netPaye - latest.rembFrais) / latestActivity.ca) * 100)} %</dd></div>
										{/if}
										{#if show('retenues') && latest.pas}
											<div class="chiffre"><dt class="text-secondary">Prélèvement à la source</dt><dd class="tabular">{formatEUR(latest.pas.montant)} · {latest.pas.taux.toLocaleString('fr-FR')} %</dd></div>
										{/if}
										{#if show('retenues') && latest.titresRestaurant}
											<div class="chiffre"><dt class="text-secondary">Titres-restaurant</dt><dd class="tabular">{latest.titresRestaurant.nombre} · {formatEUR(latest.titresRestaurant.partSalariale + latest.titresRestaurant.partPatronale)}</dd></div>
										{/if}
									</dl>
								{/if}
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
								<h2 class="label-xs">Notes de frais</h2>
								{#each [...data.notes].reverse() as note (note.numero)}
									{@const lines = matches.get(note.numero) ?? []}
									<div class="mt-3 @container">
										<p class="flex flex-wrap items-baseline gap-x-2 text-[13px]">
											<span class="font-medium">{formatMonth(note.mois)}</span>
											<span class="meta-xs min-w-0 flex-1">· n° {note.numero}{note.etat ? ` · ${note.etat.toLowerCase()}` : ''} · remboursée avec le salaire {ofMonth(shiftPortageMonth(note.mois, 1))}</span>
											<span class="tabular font-medium">{formatEUR(note.total)}</span>
										</p>
										<!-- One line per expense: a row from 44rem of tile width, stacked below -->
										<ul class="mt-1.5 divide-y divide-[var(--border-subtle)] text-[12px]">
											{#each lines as r (r.ligne.id)}
												{@const status = STATUSES[r.etat]!}
												<li class="ligne-ndf">
													<span class="ndf-date tabular whitespace-nowrap text-secondary">{formatDate(r.ligne.date)}</span>
													<span class="ndf-nature min-w-0">
														{r.ligne.nature}{#if show('commentaires') && r.ligne.commentaire}{' '}<span class="meta-xs">· {r.ligne.commentaire}</span>{/if}
													</span>
													<span class="ndf-montant tabular text-right">
														{formatEUR(r.ligne.montant)}{#if show('devises') && r.ligne.devise}<span class="meta-xs block">{r.ligne.devise.montant.toLocaleString('fr-FR')} {r.ligne.devise.code}</span>{/if}
													</span>
													<span class="ndf-etat"><span class="chip {status.cls} px-1.5 py-0 text-[10px]">{status.label}</span></span>
													{#if (showPurchase && r.tx && (r.etat === 'rapprochee' || r.etat === 'probable')) || (showPurchase && r.etat === 'indemnite') || (r.etat === 'probable' && r.tx) || showChoice}
														<div class="ndf-actions flex min-w-0 flex-wrap items-center gap-2">
															{#if showPurchase}
																{#if r.tx && (r.etat === 'rapprochee' || r.etat === 'probable')}
																	<span class="meta-xs min-w-0 truncate" title={r.tx.remittance_information.join(' ')}>{txSummary(r.tx)}</span>
																{:else if r.etat === 'indemnite'}
																	<span class="meta-xs">sans achat : reste un revenu</span>
																{/if}
															{/if}
															{#if r.etat === 'probable' && r.tx}
																<button type="button" class="btn btn-primary btn-sm" onclick={() => chooseMatch(r.ligne.id, txKey(r.tx!))}>Confirmer</button>
															{/if}
															{#if showChoice}
																<select
																	class="input-surface w-full max-w-56 min-w-0 cursor-pointer text-[12px]"
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
															{/if}
														</div>
													{/if}
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
												<button type="button" class="cursor-pointer text-secondary hover:text-[var(--amber)]" aria-label="Supprimer le repas {m.libelle}" onclick={() => removeSwileSpend(m.id)}>×</button>
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
											<button type="button" class="cursor-pointer text-secondary hover:text-[var(--amber)]" aria-label="Supprimer" onclick={() => removeVoucher(m.id)}>×</button>
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
	/* Label and value on one line, the value under its label when the tile is too narrow */
	.chiffre {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		justify-content: space-between;
		column-gap: 0.75rem;
	}
	.chiffre dd {
		margin-left: auto;
		text-align: right;
	}
	/* Month column kept in view while the table scrolls sideways */
	.colle {
		position: sticky;
		left: 0;
		z-index: 1;
		background-color: var(--surface);
	}
	/* Expense report line: stacked in a narrow tile, one row from 44rem of tile width */
	.ligne-ndf {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		grid-template-areas:
			'nature montant'
			'date etat'
			'actions actions';
		align-items: center;
		column-gap: 0.75rem;
		row-gap: 0.25rem;
		padding: 0.375rem 0;
	}
	@container (min-width: 44rem) {
		.ligne-ndf {
			grid-template-columns: 6rem minmax(8rem, 1fr) 7rem 6.5rem minmax(14rem, 1.4fr);
			grid-template-areas: 'date nature montant etat actions';
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
	.ndf-etat {
		grid-area: etat;
		justify-self: end;
	}
	@container (min-width: 44rem) {
		.ndf-etat {
			justify-self: start;
		}
	}
	.ndf-actions {
		grid-area: actions;
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
