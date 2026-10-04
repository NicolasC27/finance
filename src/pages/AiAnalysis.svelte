<script lang="ts">
	import { onMount, tick } from 'svelte';
	import type { Transaction } from '$lib/types';
	import { txKey } from '$lib/categories';
	import { signedAmount } from '$lib/data';
	import { formatDate, formatEUR } from '$lib/format';
	import { merchantLabel } from '$lib/merchant';
	import { getTransactions } from '$lib/store.svelte';
	import { modal } from '$lib/actions/modal';
	import PageTitle from '$lib/components/PageTitle.svelte';
	import ModuleOptionsButton from '$lib/components/ModuleOptionsButton.svelte';
	import { clearModuleActions, setModuleActions } from '$lib/sidePanel.svelte';
	import { describeAction, actionKeys } from '$lib/aiActions';
	import { mdToHtml } from '$lib/aiMarkdown';
	import { RECEIPT_ACCEPT } from '$lib/aiReceipt';
	import {
		aiState,
		ask,
		stop,
		checkRelay,
		saveConfig,
		resetConversation,
		removeReport,
		confirmAction,
		dismissAction,
		undoAction,
		canUndo,
		catLabel,
		assetName,
		sendAttachments,
		removeAttachment,
		analyzeReceipt,
		type AiReport,
		type AiModel
	} from '$lib/ai.svelte';
	import { showToast } from '$lib/ui.svelte';

	/**
	 * AI analysis: questions about your data, changes proposed by Claude (confirmed one by one,
	 * undoable) and HTML reports. Goes through the local relay `npm run ia` (Claude Code +
	 * subscription): nothing leaves without it.
	 */

	const SUGGESTIONS: { label: string; prompt: string; mode: 'chat' | 'report' }[] = [
		{ label: 'Où part mon argent ?', prompt: 'Où part mon argent sur les 3 derniers mois complets ? Top postes, évolution, et ce qui a dérapé.', mode: 'chat' },
		{ label: 'Abonnements', prompt: 'Liste tous mes abonnements et prélèvements récurrents, leur coût annuel, et ceux qui ont augmenté.', mode: 'chat' },
		{ label: 'Combien investir ?', prompt: 'Combien je peux investir chaque mois sans toucher à mon épargne de précaution ? Base-toi sur les 12 derniers mois.', mode: 'chat' },
		{ label: 'Budgets réalistes', prompt: 'Propose des budgets mensuels réalistes par catégorie à partir de mes 6 derniers mois, et prépare les modifications.', mode: 'chat' },
		{ label: 'Rapport du mois', prompt: 'Fais le rapport complet du dernier mois complet : revenus, dépenses par catégorie vs budget et vs moyenne 6 mois, anomalies, abonnements, et actions.', mode: 'report' },
		{ label: 'Bilan annuel', prompt: "Fais le bilan financier des 12 derniers mois : flux mensuels, taux d'épargne, postes principaux, patrimoine, fiscalité, et plan d'action chiffré.", mode: 'report' }
	];

	// Question prepared elsewhere (e.g. 'Affiner avec l'IA' on the Voiture page)
	let input = $state(aiState.brouillon);
	aiState.brouillon = '';
	let tokenDraft = $state(aiState.token);
	let viewer = $state<AiReport | null>(null);
	let frame = $state<HTMLIFrameElement | null>(null);
	let scroller = $state<HTMLDivElement | null>(null);
	let inputEl = $state<HTMLTextAreaElement | null>(null);
	let attachmentInput = $state<HTMLInputElement | null>(null);
	let receiptInput = $state<HTMLInputElement | null>(null);
	let depot = $state(false);
	let receiptDragOver = $state(false);

	/** Attachments (PDF, images): sent to the relay, cited in the next question. */
	async function attach(list: FileList | null | undefined) {
		const files = [...(list ?? [])];
		if (!files.length || !ready) return;
		const rejected = await sendAttachments(files);
		if (rejected.length) showToast(rejected.join(' · '));
		else showToast(files.length > 1 ? `${files.length} pièces jointes : Claude les lira avec ta prochaine question` : 'Pièce jointe : Claude la lira avec ta prochaine question');
	}

	/**
	 * Receipt: uploaded then analysed right away; the text already typed serves as a clarification and
	 * is cleared once the question is sent.
	 */
	async function importReceipt(list: FileList | null | undefined) {
		const files = [...(list ?? [])];
		if (!files.length || !ready || aiState.busy) return;
		const rejected = await analyzeReceipt(files, input);
		if (rejected.length) showToast(rejected.join(' · '));
		if (aiState.busy) input = '';
	}
	const hasFiles = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])].includes('Files');
	const formatSize = (n: number) => (n >= 1_048_576 ? `${(n / 1_048_576).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Mo` : `${Math.max(1, Math.round(n / 1024))} Ko`);

	const ready = $derived(aiState.connection === 'ok');
	const txByKey = $derived(new Map(getTransactions().map((tx): [string, Transaction] => [txKey(tx), tx])));
	const quotaPct = $derived(aiState.quota?.utilization !== undefined ? Math.round(aiState.quota.utilization * 100) : null);

	onMount(() => {
		void checkRelay();
	});

	// Scrolls to the bottom on every new content
	$effect(() => {
		void aiState.messages.length;
		void aiState.live;
		void tick().then(() => scroller?.scrollTo({ top: scroller.scrollHeight }));
	});

	function send(mode: 'chat' | 'report', text = input) {
		if (!text.trim() || aiState.busy || !ready) return;
		if (text === input) input = '';
		void ask(text, mode);
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			send((e.metaKey || e.ctrlKey) ? 'report' : 'chat');
		}
	}

	function connect() {
		saveConfig({ token: tokenDraft });
		void checkRelay();
	}

	function setModel(m: AiModel) {
		saveConfig({ model: m });
	}

	/** The page hands « Nouvelle conversation » and the model choice to the « ⚙ Analyse IA » panel. */
	$effect(() => {
		setModuleActions('ia', { render: aiActions });
		return () => clearModuleActions('ia');
	});

	function download(r: AiReport) {
		const url = URL.createObjectURL(new Blob([r.html], { type: 'text/html' }));
		const a = document.createElement('a');
		a.href = url;
		a.download = `${r.title.replace(/[^\p{L}\p{N} _-]+/gu, '').trim().slice(0, 60) || 'rapport'} ${r.createdAt.slice(0, 10)}.html`;
		a.click();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}

	function preview(keys: string[]): { label: string; date: string; amount: number }[] {
		return keys.slice(0, 3).flatMap((k) => {
			const tx = txByKey.get(k);
			return tx ? [{ label: merchantLabel(tx.remittance_information) || tx.remittance_information[0] || '', date: tx.booking_date || tx.value_date, amount: signedAmount(tx) }] : [];
		});
	}

	const reportOf = (id?: string) => (id ? aiState.reports.find((r) => r.id === id) : undefined);
	const resetLabel = (ts?: number) => (ts ? new Date(ts * 1000).toLocaleString('fr-FR', { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : '');
</script>

<header class="mb-3 flex flex-wrap items-end justify-between gap-3">
	<PageTitle title="Analyse IA" />
	<div class="flex flex-wrap items-center gap-2 text-[12px]">
		<span class="chip {ready ? 'chip-accent' : 'chip-amber'}" title="Relais local {aiState.url}">
			{#if aiState.connection === 'ok'}Relais connecté{:else if aiState.connection === 'checking'}Connexion…{:else if aiState.connection === 'bad-token'}Jeton à saisir{:else}Relais hors ligne{/if}
		</span>
		{#if quotaPct !== null}
			<span class="chip {quotaPct >= 90 ? 'chip-amber' : 'chip-muted'}" title="Utilisation de ton abonnement Claude ({aiState.quota?.rateLimitType ?? ''})">
				Quota {quotaPct} %{#if aiState.quota?.resetsAt} · reset {resetLabel(aiState.quota.resetsAt)}{/if}
			</span>
		{/if}
		<ModuleOptionsButton module="ia" />
	</div>
</header>

{#if !ready && aiState.connection !== 'checking' && aiState.connection !== 'unknown'}
	<section class="card mb-3 p-4">
		<p class="serif text-lg">Brancher l'analyse IA</p>
		<ol class="mt-2 list-decimal space-y-1.5 pl-5 text-[13px]">
			<li>Dans un terminal, dossier <code class="kbd">app/</code> : <code class="kbd">npm run ia</code>. Le relais utilise ton Claude Code connecté (abonnement), sur ce PC uniquement.</li>
			<li>
				Colle le jeton affiché par le relais :
				<span class="mt-1 flex flex-wrap items-center gap-2">
					<input class="input-surface w-[26rem] max-w-full font-mono" type="password" autocomplete="off" placeholder="jeton (48 caractères)" bind:value={tokenDraft} onkeydown={(e) => e.key === 'Enter' && connect()} aria-label="Jeton du relais" />
					<button type="button" class="btn btn-primary btn-sm" onclick={connect} disabled={!tokenDraft.trim()}>Connecter</button>
				</span>
			</li>
		</ol>
		<p class="meta-xs mt-2">
			{#if !aiState.token}Pas encore de jeton.{:else if aiState.connection === 'bad-token'}Jeton refusé : recopie celui affiché par le relais.{:else}Relais injoignable sur {aiState.url} : est-il lancé ?{/if}
			À chaque question, l'app envoie au relais un instantané de tes données (opérations catégorisées, budgets, patrimoine), puis Claude les analyse. Il ne modifie rien sans ton clic « Confirmer ».
		</p>
	</section>
{/if}

<div class="grid grid-cols-1 gap-3 lg:grid-cols-12">
	<section
		class="card flex min-h-[60vh] flex-col p-0 lg:col-span-8"
		class:depot
		aria-label="Conversation"
		ondragover={(e) => {
			if (ready && [...(e.dataTransfer?.types ?? [])].includes('Files')) {
				e.preventDefault();
				depot = true;
			}
		}}
		ondragleave={() => (depot = false)}
		ondrop={(e) => {
			if (!ready) return;
			e.preventDefault();
			depot = false;
			void attach(e.dataTransfer?.files);
		}}
	>
		<div bind:this={scroller} class="flex-1 space-y-3 overflow-y-auto p-4" style="max-height: calc(100vh - 260px);">
			{#if aiState.messages.length === 0}
				<div class="py-6 text-center">
					<p class="serif text-lg">Pose une question sur ton budget</p>
					<p class="meta-xs mx-auto mt-1 max-w-md">Claude lit toutes tes opérations, calcule, propose des modifications (que tu confirmes) et rédige des rapports complets.</p>
					<div class="mt-4 flex flex-wrap justify-center gap-1.5">
						{#each SUGGESTIONS as s (s.label)}
							<button type="button" class="press rounded-full border px-3 py-1 text-[12px] hover:border-[var(--text-2)]" style="border-color: var(--border);" disabled={!ready || aiState.busy} onclick={() => send(s.mode, s.prompt)}>
								{s.mode === 'report' ? '📄 ' : ''}{s.label}
							</button>
						{/each}
						<button type="button" class="press rounded-full border px-3 py-1 text-[12px] hover:border-[var(--text-2)]" style="border-color: var(--border);" disabled={!ready || aiState.busy || aiState.envoiPieces} onclick={() => receiptInput?.click()} title="Photo ou PDF d'un ticket : Claude retrouve l'opération et propose note, tags et catégorie">
							🧾 Ticket de caisse
						</button>
					</div>
				</div>
			{/if}

			{#each aiState.messages as m (m.id)}
				{#if m.role === 'user'}
					<div class="flex justify-end">
						<div class="max-w-[85%] rounded-xl px-3 py-2 text-[13px]" style="background-color: var(--surface-2);">
							{#if m.mode === 'report'}<span class="chip chip-accent mr-1">Rapport</span>{/if}{m.text}
						</div>
					</div>
				{:else}
					<div class="max-w-full text-[13px]">
						{#if m.text}
							<div class="md" class:md-error={m.error}>{@html mdToHtml(m.text)}</div>
						{:else if aiState.busy}
							<div class="md text-secondary">
								{#if aiState.live}{@html mdToHtml(aiState.live)}{/if}
								<p class="meta-xs mt-1 flex items-center gap-2"><span class="dot-pulse" aria-hidden="true"></span>{aiState.status || 'Réflexion…'}</p>
							</div>
						{/if}

						{#if reportOf(m.reportId)}
							{@const r = reportOf(m.reportId)!}
							<button type="button" class="press mt-2 flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left hover:border-[var(--text-2)]" style="border-color: var(--border);" onclick={() => (viewer = r)}>
								<span class="min-w-0"><span class="block truncate font-medium">📄 {r.title}</span><span class="meta-xs">Ouvrir le rapport</span></span>
								<span class="text-secondary" aria-hidden="true">→</span>
							</button>
						{/if}

						{#if m.actions?.length}
							<div class="mt-2 space-y-1.5" aria-label="Modifications proposées">
								<p class="label-xs">Modifications proposées</p>
								{#each m.actions as p (p.id)}
									{@const keys = actionKeys(p.action)}
									<div class="rounded-lg border px-3 py-2" style="border-color: {p.state === 'pending' ? 'var(--accent)' : 'var(--border)'}; opacity: {p.state === 'dismissed' || p.state === 'undone' ? 0.6 : 1};">
										<div class="flex flex-wrap items-start justify-between gap-2">
											<div class="min-w-0 flex-1">
												<p class="font-medium">{describeAction(p.action, catLabel, assetName)}</p>
												{#if p.action.why}<p class="meta-xs">{p.action.why}</p>{/if}
												{#if keys.length}
													<ul class="meta-xs mt-1">
														{#each preview(keys) as t, i (i)}
															<li class="tabular">{formatDate(t.date)} · {t.label} · {formatEUR(t.amount)}</li>
														{/each}
														{#if keys.length > 3}<li>… et {keys.length - 3} autre{keys.length - 3 > 1 ? 's' : ''}</li>{/if}
													</ul>
												{/if}
												{#if p.state === 'failed'}<p class="meta-xs" style="color: var(--amber);">Échec : {p.error}</p>{/if}
											</div>
											<div class="flex shrink-0 items-center gap-1.5">
												{#if p.state === 'pending'}
													<button type="button" class="btn btn-primary btn-sm" onclick={() => confirmAction(m.id, p.id)}>Confirmer</button>
													<button type="button" class="btn btn-secondary btn-sm" onclick={() => dismissAction(m.id, p.id)}>Ignorer</button>
												{:else if p.state === 'applied'}
													<span class="chip chip-accent">Appliqué</span>
													{#if canUndo(p.id)}<button type="button" class="btn btn-secondary btn-sm" onclick={() => undoAction(m.id, p.id)}>Annuler</button>{/if}
												{:else if p.state === 'undone'}
													<span class="chip chip-muted">Annulé</span>
												{:else if p.state === 'dismissed'}
													<span class="chip chip-muted">Ignoré</span>
												{/if}
											</div>
										</div>
									</div>
								{/each}
								{#if m.actions.filter((p) => p.state === 'pending').length > 1}
									<button
										type="button"
										class="btn btn-secondary btn-sm"
										onclick={() => m.actions?.filter((p) => p.state === 'pending').forEach((p) => confirmAction(m.id, p.id))}>Tout confirmer</button
									>
								{/if}
							</div>
						{/if}
						{#if m.rejected?.length}
							<p class="meta-xs mt-1">{m.rejected.length} proposition{m.rejected.length > 1 ? 's' : ''} écartée{m.rejected.length > 1 ? 's' : ''} (invalide{m.rejected.length > 1 ? 's' : ''}) : {m.rejected.join(' · ')}</p>
						{/if}
					</div>
				{/if}
			{/each}
		</div>

		<div class="border-t p-3" style="border-color: var(--border-subtle);">
			{#if aiState.pieces.length}
				<ul class="mb-2 flex flex-wrap items-center gap-1.5" aria-label="Pièces jointes">
					{#each aiState.pieces as p (p.nom)}
						<li
							class="chip {aiState.piecesNouvelles.includes(p.nom) ? 'chip-accent' : 'chip-muted'} gap-1 py-0 text-[11px]"
							title="{formatSize(p.taille)} · gardée sur ce PC dans .ia/workspace/pieces{aiState.piecesNouvelles.includes(p.nom) ? ' · citée dans ta prochaine question' : ''}"
						>
							<span class="max-w-48 truncate">{p.nom}</span>
							<button type="button" class="cursor-pointer px-0.5 hover:text-[var(--text)]" aria-label="Retirer {p.nom}" onclick={() => removeAttachment(p.nom)}>×</button>
						</li>
					{/each}
				</ul>
			{/if}
			<textarea
				bind:this={inputEl}
				bind:value={input}
				onkeydown={onKeydown}
				rows="2"
				class="input-surface w-full resize-y py-1.5 text-[13px]"
				placeholder={ready ? 'Ex. : « Pourquoi septembre est si haut ? », « Mets Uber Eats en Alimentation », « Rapport sur mes loisirs 2025 »' : 'Connecte le relais pour commencer'}
				disabled={!ready}
				aria-label="Question"
			></textarea>
			<div class="mt-1.5 flex flex-wrap items-center justify-between gap-2">
				<p class="meta-xs"><kbd class="kbd">Entrée</kbd> envoyer · <kbd class="kbd">Ctrl</kbd>+<kbd class="kbd">Entrée</kbd> rapport · <kbd class="kbd">Maj</kbd>+<kbd class="kbd">Entrée</kbd> ligne</p>
				<div class="flex gap-1.5">
					{#if aiState.busy}
						<button type="button" class="btn btn-secondary btn-sm" onclick={stop}>Arrêter</button>
					{:else}
						<button
							type="button"
							class="btn btn-secondary btn-sm"
							class:depot-ticket={receiptDragOver}
							onclick={() => receiptInput?.click()}
							ondragover={(e) => {
								if (!ready || !hasFiles(e)) return;
								e.preventDefault();
								e.stopPropagation();
								receiptDragOver = true;
							}}
							ondragleave={() => (receiptDragOver = false)}
							ondrop={(e) => {
								if (!ready) return;
								e.preventDefault();
								e.stopPropagation();
								receiptDragOver = false;
								depot = false;
								void importReceipt(e.dataTransfer?.files);
							}}
							disabled={!ready || aiState.envoiPieces}
							title="Photo ou PDF d'un ticket de caisse (ou glisse-le sur ce bouton) : Claude retrouve l'opération bancaire et propose une note détaillée, des tags et, si besoin, la catégorie. Ce que tu as tapé sert de précision."
						>
							🧾 Analyser un ticket
						</button>
						<input
							bind:this={receiptInput}
							type="file"
							multiple
							accept={RECEIPT_ACCEPT}
							class="hidden"
							aria-label="Choisir un ticket de caisse (photo ou PDF)"
							onchange={(e) => {
								void importReceipt((e.target as HTMLInputElement).files);
								(e.target as HTMLInputElement).value = '';
							}}
						/>
						<button type="button" class="btn btn-secondary btn-sm" onclick={() => attachmentInput?.click()} disabled={!ready || aiState.envoiPieces} title="PDF ou image : facture, carte grise, contrôle technique… (ou glisse-les ici)">
							{aiState.envoiPieces ? 'Envoi…' : 'Joindre'}
						</button>
						<input
							bind:this={attachmentInput}
							type="file"
							multiple
							accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.txt,.csv"
							class="hidden"
							aria-label="Joindre des fichiers (PDF, images)"
							onchange={(e) => {
								void attach((e.target as HTMLInputElement).files);
								(e.target as HTMLInputElement).value = '';
							}}
						/>
						<button type="button" class="btn btn-secondary btn-sm" onclick={() => send('report')} disabled={!ready || !input.trim()}>Faire un rapport</button>
						<button type="button" class="btn btn-primary btn-sm" onclick={() => send('chat')} disabled={!ready || !input.trim()}>Envoyer</button>
					{/if}
				</div>
			</div>
		</div>
	</section>

	<aside class="space-y-3 lg:col-span-4">
		<section class="card p-4" aria-label="Rapports">
			<h2 class="label-xs mb-2">Rapports</h2>
			{#if aiState.reports.length === 0}
				<p class="meta-xs">Aucun rapport pour l'instant. Demande « Rapport du mois » ou écris ta demande puis « Faire un rapport ».</p>
			{:else}
				<ul class="space-y-1.5">
					{#each aiState.reports as r (r.id)}
						<li class="flex items-center justify-between gap-2 text-[13px]">
							<button type="button" class="min-w-0 flex-1 truncate text-left hover:underline" onclick={() => (viewer = r)} title={r.prompt}>{r.title}</button>
							<span class="meta-xs shrink-0 tabular">{formatDate(r.createdAt.slice(0, 10))}</span>
							<button type="button" class="text-secondary shrink-0 px-1 hover:text-[var(--text)]" onclick={() => download(r)} aria-label="Télécharger {r.title}" title="Télécharger">↓</button>
							<button type="button" class="text-secondary shrink-0 px-1 hover:text-[var(--text)]" onclick={() => removeReport(r.id)} aria-label="Supprimer {r.title}" title="Supprimer">×</button>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
		<section class="card p-4 text-[12px]" aria-label="Comment ça marche">
			<h2 class="label-xs mb-2">Comment ça marche</h2>
			<ul class="text-secondary list-disc space-y-1 pl-4">
				<li>Le relais local lance Claude Code sur ton PC, avec ton abonnement : pas de clé API.</li>
				<li>À chaque question, il reçoit un instantané de tes données, effacé quand tu arrêtes le relais.</li>
				<li>Claude ne modifie rien lui-même : chaque modification attend ton « Confirmer » et reste annulable pendant la session.</li>
				<li>La conversation garde le contexte ; « Nouvelle conversation » repart de zéro.</li>
				<li>Pièces jointes (PDF, images) : gardées sur ce PC dans <code>.ia/workspace/pieces</code> jusqu'à ce que tu les retires (×) ; Claude les lit quand ta question en parle. Photos réduites à 2 000 px, sans métadonnées.</li>
				<li>« Analyser un ticket » : Claude retrouve l'opération (montant, date d'achat du libellé carte) et propose note, tags et, si besoin, catégorie.</li>
			</ul>
		</section>
	</aside>
</div>

{#if viewer}
	{@const r = viewer}
	<div
		class="palette-backdrop fixed inset-0 z-50 flex items-stretch justify-center p-3 sm:p-6"
		role="presentation"
		onclick={(e) => {
			if (e.target === e.currentTarget) viewer = null;
		}}
	>
		<div
			class="flex w-full max-w-5xl flex-col overflow-hidden rounded-2xl border"
			style="border-color: var(--border); background-color: var(--surface);"
			role="dialog"
			aria-modal="true"
			aria-label={r.title}
			tabindex="-1"
			use:modal={{ onEscape: () => (viewer = null) }}
		>
			<div class="flex items-center justify-between gap-3 border-b px-4 py-2" style="border-color: var(--border-subtle);">
				<h2 class="min-w-0 truncate text-[13px] font-medium">{r.title}</h2>
				<div class="flex shrink-0 gap-1.5">
					<button type="button" class="btn btn-secondary btn-sm" onclick={() => frame?.contentWindow?.print()}>Imprimer / PDF</button>
					<button type="button" class="btn btn-secondary btn-sm" onclick={() => download(r)}>Télécharger</button>
					<button type="button" class="btn btn-primary btn-sm" data-autofocus onclick={() => (viewer = null)}>Fermer</button>
				</div>
			</div>
			<!-- sandbox without allow-scripts: no report script runs; same-origin for printing -->
			<iframe bind:this={frame} title={r.title} srcdoc={r.html} sandbox="allow-same-origin allow-popups allow-modals" class="w-full flex-1" style="background: white; min-height: 70vh;"></iframe>
		</div>
	</div>
{/if}

<style>
	.depot {
		outline: 2px dashed var(--accent);
		outline-offset: 4px;
	}
	.depot-ticket {
		outline: 2px dashed var(--accent);
		outline-offset: 2px;
	}
	.md :global(p) {
		margin: 0.35em 0;
	}
	.md :global(h3),
	.md :global(h4),
	.md :global(h5),
	.md :global(h6) {
		margin: 0.8em 0 0.3em;
		font-weight: 600;
		font-size: 13px;
	}
	.md :global(h3) {
		font-size: 14px;
	}
	.md :global(ul),
	.md :global(ol) {
		margin: 0.35em 0;
		padding-left: 1.3em;
	}
	.md :global(ul) {
		list-style: disc;
	}
	.md :global(ol) {
		list-style: decimal;
	}
	.md :global(li) {
		margin: 0.15em 0;
	}
	.md :global(code) {
		font-family: ui-monospace, monospace;
		font-size: 12px;
		background-color: var(--surface-2);
		border-radius: 4px;
		padding: 0 4px;
	}
	.md :global(pre) {
		background-color: var(--surface-2);
		border-radius: 6px;
		padding: 8px;
		overflow-x: auto;
		font-size: 12px;
	}
	.md :global(.md-table) {
		overflow-x: auto;
		margin: 0.5em 0;
	}
	.md :global(table) {
		border-collapse: collapse;
		font-variant-numeric: tabular-nums;
		font-size: 12px;
	}
	.md :global(th),
	.md :global(td) {
		border-bottom: 1px solid var(--border-subtle);
		padding: 3px 8px;
		text-align: left;
	}
	.md :global(th) {
		color: var(--text-2);
		font-weight: 600;
	}
	.md :global(.num) {
		text-align: right;
		white-space: nowrap;
	}
	.md :global(a) {
		color: var(--accent);
		text-decoration: underline;
	}
	.md :global(hr) {
		border: 0;
		border-top: 1px solid var(--border-subtle);
		margin: 0.6em 0;
	}
	.md-error {
		color: var(--amber);
	}
	.dot-pulse {
		width: 6px;
		height: 6px;
		border-radius: 9999px;
		background-color: var(--accent);
		animation: pulse 1s ease-in-out infinite;
	}
	@keyframes pulse {
		50% {
			opacity: 0.3;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.dot-pulse {
			animation: none;
		}
	}
</style>

<!-- Actions of the « ⚙ Analyse IA » panel: new conversation and model -->
{#snippet aiActions()}
	<button type="button" class="btn btn-secondary btn-sm" onclick={resetConversation} disabled={aiState.busy || aiState.messages.length === 0}>Nouvelle conversation</button>
	<div class="mt-3 flex items-center justify-between gap-3">
		<span id="ai-model-label" class="text-secondary">Modèle</span>
		<div class="flex overflow-hidden rounded-md border text-[12px]" style="border-color: var(--border);" role="group" aria-labelledby="ai-model-label">
			{#each [['opus', 'Opus · approfondi'], ['sonnet', 'Sonnet · rapide']] as [id, label] (id)}
				<button
					type="button"
					class="px-2 py-0.5 {aiState.model === id ? 'font-medium' : 'text-secondary'}"
					style={aiState.model === id ? 'background-color: var(--surface-2); color: var(--text);' : ''}
					aria-pressed={aiState.model === id}
					onclick={() => setModel(id as AiModel)}>{label}</button
				>
			{/each}
		</div>
	</div>
{/snippet}
