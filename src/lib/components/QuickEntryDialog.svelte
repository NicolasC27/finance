<script lang="ts">
	import { untrack } from 'svelte';
	import type { CategoryId } from '$lib/types';
	import { uiState, showSuccess } from '$lib/ui.svelte';
	import { modal } from '$lib/actions/modal';
	import { segmented } from '$lib/actions/segmented';
	import { parseQuickEntry, type QuickDraft } from '$lib/quickEntry';
	import { askRelay, defaultPayment, QUICK_CATEGORIES, QUICK_SUBCATEGORIES, quickAccounts, relayConfig, saveQuickPayment, suggestCategory, voucherAvailable, voucherOptions } from '$lib/quickEntry.svelte';
	import { splitVoucherPayment, type QuickPayment } from '$lib/quickEntry';
	import { formatEUR, formatDate } from '$lib/format';
	import { todayIso } from '$lib/forecast';
	import DateField from './DateField.svelte';

	/**
	 * Quick expense entry: one field (« leboncoin 20,25 € », « restaurant hier 34 € »), read as you
	 * type by the local parser; Enter asks the AI relay when it is set (then Enter again saves). The
	 * preview stays editable (label, amount, direction, category, date, account). The operation is
	 * counted at once and replaced by the bank operation when the statement is imported.
	 */

	const today = todayIso;
	let text = $state('');
	let aiDraft = $state<QuickDraft | null>(null);
	let aiFor = $state('');
	let asking = $state(false);
	let aiFailed = $state(false);
	let edits = $state<{ label?: string; amount?: string; credit?: boolean; categoryId?: CategoryId; subId?: string | null; date?: string; payment?: QuickPayment }>({});
	let account = $state('');
	let saveBtn = $state<HTMLButtonElement | null>(null);

	const hasRelay = $derived(uiState.quickEntryOpen && relayConfig() !== null);
	const local = $derived(parseQuickEntry(text, today()));
	const base = $derived(aiDraft && aiFor === text ? aiDraft : 'error' in local ? null : local);
	const accounts = $derived(uiState.quickEntryOpen ? quickAccounts() : []);
	const label = $derived(edits.label ?? base?.label ?? '');
	const amount = $derived(edits.amount !== undefined ? Number(edits.amount.replace(/\s/g, '').replace(',', '.')) : (base?.amount ?? 0));
	const credit = $derived(edits.credit ?? base?.credit ?? false);
	const date = $derived(edits.date ?? base?.date ?? today());
	const suggestion = $derived(suggestCategory(label, credit));
	const fromAi = $derived(!!base?.categoryId && aiFor === text);
	const categoryId = $derived(edits.categoryId ?? base?.categoryId ?? suggestion.categoryId);
	const subs = $derived(QUICK_SUBCATEGORIES.filter((s) => s.categoryId === categoryId));
	const autoSub = $derived(base?.categoryId === categoryId && base?.subId ? base.subId : suggestion.categoryId === categoryId ? suggestion.subId : null);
	const subId = $derived(edits.subId !== undefined ? edits.subId : subs.some((s) => s.id === autoSub) ? autoSub : null);
	const SOURCES = { memory: 'appris de tes saisies', rules: 'règles et commerçants connus', keyword: 'mot-clé du libellé', none: 'rien de reconnu : choisis' } as const;
	const sourceText = $derived(edits.categoryId || edits.subId !== undefined ? 'ton choix, retenu pour la suite' : fromAi ? "proposé par l'IA, retenu pour la suite" : SOURCES[suggestion.source]);
	const options = $derived(uiState.quickEntryOpen ? voucherOptions() : { swile: false, culture: false });
	const named = $derived('error' in local ? undefined : local.payment);
	const payment = $derived<QuickPayment>(credit ? 'card' : (edits.payment ?? defaultPayment(named)));
	const split = $derived(payment === 'card' ? null : splitVoucherPayment(amount, voucherAvailable(payment, date)));
	const ready = $derived(!!base && label.trim().length > 0 && amount > 0 && amount < 1_000_000);

	$effect(() => {
		if (!uiState.quickEntryOpen) return;
		text = untrack(() => uiState.quickEntryText);
		uiState.quickEntryText = '';
		aiDraft = null;
		aiFor = '';
		aiFailed = false;
		edits = {};
		account = untrack(() => quickAccounts()[0]?.id ?? 'cm');
	});

	/** Closes the dialog; `keep` hands the typed sentence back to whoever opened it (the row), when nothing was saved. */
	function close(keep = false) {
		if (keep) uiState.quickEntryText = text;
		uiState.quickEntryOpen = false;
	}

	async function understand() {
		if (!hasRelay || asking || !text.trim()) return;
		asking = true;
		aiFailed = false;
		const asked = text;
		const d = await askRelay(asked, today());
		asking = false;
		if (text !== asked) return;
		if (d) {
			aiDraft = d;
			aiFor = asked;
			edits = {};
			saveBtn?.focus();
		} else aiFailed = true;
	}

	function save() {
		if (!ready) return;
		const draft: QuickDraft = { label: label.trim(), amount: Math.round(amount * 100) / 100, credit, date };
		const r = saveQuickPayment(draft, account, categoryId, subId, payment);
		close();
		showSuccess(`${credit ? 'Rentrée' : 'Dépense'} ajoutée : ${draft.label} ${credit ? '+' : '−'}${formatEUR(draft.amount)}, ${r.summary}`, 'Annuler', r.undo);
	}

	function onFieldKey(e: KeyboardEvent) {
		if (e.key !== 'Enter') return;
		e.preventDefault();
		if (hasRelay && aiFor !== text && !aiFailed) void understand();
		else save();
	}
</script>

{#if uiState.quickEntryOpen}
	<div
		class="dialog-backdrop fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh]"
		role="presentation"
		onclick={(e) => {
			if (e.target === e.currentTarget) close(true);
		}}
	>
		<div class="dialog-panel w-full max-w-lg overflow-hidden rounded-2xl border" style="border-color: var(--border); background-color: var(--surface);" role="dialog" aria-modal="true" aria-label="Saisir une dépense" tabindex="-1" use:modal={{ onEscape: () => close(true) }}>
			<div class="flex items-center gap-2 border-b px-4 py-3" style="border-color: var(--border-subtle);">
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
				<input
					type="text"
					class="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-[var(--text-3)]"
					placeholder="leboncoin 20,25 € · resto hier 34 € swile"
					maxlength="300"
					bind:value={text}
					oninput={() => {
						aiFailed = false;
						edits = {};
					}}
					onkeydown={onFieldKey}
					aria-label="Dépense en une phrase"
					data-autofocus
				/>
				{#if hasRelay}
					<button type="button" class="btn btn-secondary btn-sm shrink-0" disabled={asking || !text.trim() || aiFor === text} onclick={understand} title="Faire lire la phrase par l'IA (relais local)">
						{asking ? 'Lecture…' : aiFor === text && aiDraft ? 'Lu par l’IA' : '✨ IA'}
					</button>
				{/if}
			</div>

			<div class="px-4 py-3 text-[13px]">
				{#if !text.trim()}
					<p class="meta-xs">Une phrase suffit : marchand, montant, et la date si ce n'était pas aujourd'hui (« hier », « samedi », « le 12 »). L'opération compte tout de suite dans ton budget ; à l'import du relevé, l'opération de la banque la remplace.</p>
				{:else if !base}
					<p class="meta-xs" style="color: var(--amber);">{'error' in local ? local.error : ''}</p>
				{:else}
					<div class="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2">
						<span class="meta-xs">Libellé</span>
						<input type="text" class="input-surface w-full" value={label} maxlength="80" aria-label="Libellé" oninput={(e) => (edits = { ...edits, label: (e.target as HTMLInputElement).value })} />
						<span class="meta-xs">Montant</span>
						<div class="flex flex-wrap items-center gap-2">
							<input type="text" inputmode="decimal" class="input-surface tabular w-24 text-right" value={edits.amount ?? String(base.amount).replace('.', ',')} aria-label="Montant (€)" oninput={(e) => (edits = { ...edits, amount: (e.target as HTMLInputElement).value })} />
							<span class="meta-xs">€</span>
							<div class="flex gap-1" role="group" aria-label="Sens" use:segmented>
								<button type="button" class="chip cursor-pointer {!credit ? 'chip-accent' : 'chip-muted'}" aria-pressed={!credit} onclick={() => (edits = { ...edits, credit: false })}>Dépense</button>
								<button type="button" class="chip cursor-pointer {credit ? 'chip-accent' : 'chip-muted'}" aria-pressed={credit} onclick={() => (edits = { ...edits, credit: true })}>Rentrée</button>
							</div>
						</div>
						<span class="meta-xs">Catégorie</span>
						<div class="flex flex-wrap items-center gap-2">
							<select class="input-surface min-w-0 flex-1" value={categoryId} aria-label="Catégorie" onchange={(e) => (edits = { ...edits, categoryId: (e.target as HTMLSelectElement).value as CategoryId, subId: undefined })}>
								{#each QUICK_CATEGORIES as c (c.id)}
									<option value={c.id}>{c.label}</option>
								{/each}
							</select>
							{#if subs.length}
								<select class="input-surface min-w-0 flex-1" value={subId ?? ''} aria-label="Sous-catégorie" onchange={(e) => (edits = { ...edits, subId: (e.target as HTMLSelectElement).value || null })}>
									<option value="">Sans sous-catégorie</option>
									{#each subs as s (s.id)}
										<option value={s.id}>{s.label}</option>
									{/each}
								</select>
							{/if}
						</div>
						<span></span>
						<span class="meta-xs -mt-1">{sourceText}</span>
						<span class="meta-xs">Date</span>
						<div class="flex items-center gap-2">
							<DateField label="Date de la dépense" bind:value={() => date, (v) => (edits = { ...edits, date: v || today() })} max={today()} clearable={false} />
							<span class="meta-xs">{date === today() ? "aujourd'hui" : formatDate(date)}</span>
						</div>
						{#if !credit && (options.swile || options.culture)}
							<span class="meta-xs">Payé avec</span>
							<div class="flex flex-wrap items-center gap-2">
								<div class="flex gap-1" role="group" aria-label="Moyen de paiement" use:segmented>
									<button type="button" class="chip cursor-pointer {payment === 'card' ? 'chip-accent' : 'chip-muted'}" aria-pressed={payment === 'card'} onclick={() => (edits = { ...edits, payment: 'card' })}>Carte</button>
									{#if options.swile}<button type="button" class="chip cursor-pointer {payment === 'swile' ? 'chip-accent' : 'chip-muted'}" aria-pressed={payment === 'swile'} onclick={() => (edits = { ...edits, payment: 'swile' })}>Swile</button>{/if}
									{#if options.culture}<button type="button" class="chip cursor-pointer {payment === 'culture' ? 'chip-accent' : 'chip-muted'}" aria-pressed={payment === 'culture'} onclick={() => (edits = { ...edits, payment: 'culture' })}>Chèques culture</button>{/if}
								</div>
								{#if split}
									<span class="meta-xs">
										{#if split.voucher === 0}<span style="color: var(--amber);">{payment === 'swile' ? 'plafond Swile du jour atteint' : 'plus de chèques culture'} : tout sur ta carte</span>{:else if split.card > 0}{formatEUR(split.voucher)} en {payment === 'swile' ? 'Swile' : 'chèques'} + <span style="color: var(--accent);">{formatEUR(split.card)} sur ta carte</span>{payment === 'swile' ? ' (plafond du jour)' : ''}{:else}tout en {payment === 'swile' ? 'Swile' : 'chèques culture'}{/if}
									</span>
								{/if}
							</div>
						{/if}
						{#if accounts.length > 1}
							<span class="meta-xs">Compte</span>
							<select class="input-surface w-full" bind:value={account} aria-label="Compte">
								{#each accounts as a (a.id)}
									<option value={a.id}>{a.label}</option>
								{/each}
							</select>
						{/if}
					</div>
					{#if aiFailed}<p class="meta-xs mt-2">L'IA n'a pas répondu : lecture locale conservée.</p>{/if}
				{/if}
			</div>

			<div class="flex items-center gap-2 border-t px-4 py-2.5" style="border-color: var(--border-subtle);">
				<span class="meta-xs flex-1">{hasRelay ? 'Entrée : lire avec l’IA, puis Entrée : enregistrer' : 'Entrée : enregistrer'} · Échap : fermer</span>
				<button type="button" class="btn btn-secondary btn-sm" onclick={() => close(true)}>Annuler</button>
				<button bind:this={saveBtn} type="button" class="btn btn-primary btn-sm" disabled={!ready} onclick={save}>Enregistrer</button>
			</div>
		</div>
	</div>
{/if}
