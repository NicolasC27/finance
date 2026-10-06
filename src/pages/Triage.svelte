<script lang="ts">
	import { onMount } from 'svelte';
	import type { CategoryId, Transaction } from '$lib/types';
	import { CATEGORIES, categorize, getCategory, txKey, type CatRule } from '$lib/categories';
	import { subcategorize, subcategoriesFor, getSubcategory } from '$lib/subcategories';
	import { budgetState, setOverride, clearOverride, setSubOverride } from '$lib/budget.svelte';
	import { setOverrideAndRule, restoreRule, ruleImpact } from '$lib/rules.svelte';
	import { getMerchantCategoryMap, updateImported } from '$lib/store.svelte';
	import { excludeKeys, includeKeys, isExcluded } from '$lib/transfers.svelte';
	import { getSortQueue, keepInOther, unkeep } from '$lib/sortQueue.svelte';
	import { vacationFor, assignVacation } from '$lib/vacations.svelte';
	import { signedAmount } from '$lib/data';
	import { formatDate, formatEUR } from '$lib/format';
	import { merchantLabel } from '$lib/merchant';
	import { accountLabel } from '$lib/accounts.svelte';
	import { showToast, uiState, showSuccess } from '$lib/ui.svelte';
	import { navigate } from '$lib/router.svelte';
	import PageTitle from '$lib/components/PageTitle.svelte';
	import CategoryMark from '$lib/components/CategoryMark.svelte';

	/**
	 * Sorting inbox: operations still in 'Autre' (wealth movements and hidden operations excluded),
	 * one by one, with the keyboard.
	 * 1-9, 0, E: category; S: subcategory; N: note
	 * Enter / →: skip; ←: back; M: hide from the budget
	 * V: holidays (period of the date); G: keep in 'Autre'; R: 'always' rule on/off
	 */

	const CATS = CATEGORIES.filter((c) => c.id !== 'autre');
	const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', 'e'];

	/** Operations to sort (queue shared with the Sidebar badge: sortQueue.svelte.ts). */
	const queue = $derived(getSortQueue());
	/** Keys skipped (Enter) during this session: reviewed at the end of the queue. */
	let skipped = $state<string[]>([]);
	const pending = $derived(queue.filter((tx) => !skipped.includes(txKey(tx))));
	const current = $derived<Transaction | null>(pending[0] ?? queue.find((tx) => skipped.includes(txKey(tx))) ?? null);

	let done = $state(0);
	const totalAtStart = $derived(queue.length + done);
	/** 'Always' rule: unchecked by default (one key must not reclassify a whole merchant). */
	let alwaysRule = $state(false);
	let noteDraft = $state('');
	let noteEl = $state<HTMLInputElement | null>(null);
	let subEl = $state<HTMLSelectElement | null>(null);
	/** Last action (for 'undo'): previous override and the rule it may have created. */
	let last = $state<{
		tx: Transaction;
		label: string;
		kind: 'category' | 'mask' | 'keep';
		prevOverride?: CategoryId;
		rule?: { keyword: string; previous?: CatRule } | null;
	} | null>(null);

	/** Impact of a rule on the current merchant (number of operations, discouraged rule?). */
	const impact = $derived(current ? ruleImpact(current) : null);
	const canRule = $derived(!!impact && !impact.generic);
	let flash = $state<CategoryId | null>(null);

	$effect(() => {
		noteDraft = current?.note ?? '';
	});

	/** Never a 'Vacances' rule (it depends on a period) nor a discouraged rule. */
	function apply(categoryId: CategoryId) {
		const tx = current;
		if (!tx) return;
		const label = merchantLabel(tx.remittance_information) || 'cette opération';
		const prevOverride = budgetState.overrides[txKey(tx)];
		const withRule = alwaysRule && canRule && categoryId !== 'vacances';
		const rule = withRule ? setOverrideAndRule(tx, categoryId) : (setOverride(txKey(tx), categoryId), null);
		done++;
		last = { tx, label, kind: 'category', ...(prevOverride ? { prevOverride } : {}), rule };
		flash = categoryId;
		window.setTimeout(() => (flash = null), 350);
		const scope = rule && impact ? ` (règle : ${impact.count} opération${impact.count > 1 ? 's' : ''})` : '';
		showToast(`${label} → ${getCategory(categoryId).label}${scope}`, 'Annuler', () => undo());
	}

	/** Really undoes the last action: the override (persisted) AND the rule it created. */
	function undo() {
		if (!last) return;
		const key = txKey(last.tx);
		if (last.kind === 'category') {
			if (last.prevOverride) setOverride(key, last.prevOverride);
			else clearOverride(key);
			if (last.rule) restoreRule(last.rule.keyword, last.rule.previous);
		} else if (last.kind === 'mask') includeKeys([key]);
		else unkeep(last.tx);
		done = Math.max(0, done - 1);
		last = null;
	}

	function skip() {
		if (!current) return;
		const key = txKey(current);
		skipped = skipped.includes(key) ? [...skipped.filter((k) => k !== key), key] : [...skipped, key];
	}
	function back() {
		if (skipped.length === 0) return;
		skipped = skipped.slice(0, -1);
	}
	function mask() {
		const tx = current;
		if (!tx) return;
		excludeKeys([txKey(tx)]);
		done++;
		last = { tx, label: merchantLabel(tx.remittance_information) || 'cette opération', kind: 'mask' };
		showToast('Opération masquée du budget', 'Annuler', () => undo());
	}
	/** 'Garder en Autre': a genuine miscellaneous expense leaves the queue (decision remembered). */
	function keep() {
		const tx = current;
		if (!tx) return;
		keepInOther(tx);
		done++;
		last = { tx, label: merchantLabel(tx.remittance_information) || 'cette opération', kind: 'keep' };
		showToast('Gardée en « Autre »', 'Annuler', () => undo());
	}
	function toVacation() {
		const tx = current;
		if (!tx) return;
		const p = vacationFor(tx);
		if (p) {
			assignVacation(tx, p.id);
			done++;
			showToast(`Rattachée aux vacances « ${p.label} »`);
		} else {
			apply('vacances');
		}
	}
	function saveNote() {
		const tx = current;
		if (!tx) return;
		if ((tx.note ?? '') === noteDraft) return;
		if (updateImported(txKey(tx), { note: noteDraft })) showSuccess('Note enregistrée');
	}
	function onSubChange(e: Event) {
		const tx = current;
		if (!tx) return;
		const v = (e.target as HTMLSelectElement).value;
		setSubOverride(tx, v || null, alwaysRule ? 'merchant' : 'tx');
	}

	/** Enter on a focused button or link lets that element act instead of skipping. */
	function onKey(e: KeyboardEvent) {
		if (uiState.paletteOpen || uiState.shortcutsOpen || uiState.dialogDepth > 0) return;
		const t = e.target as HTMLElement;
		const typing = t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT';
		if (typing) {
			if (e.key === 'Escape') (t as HTMLInputElement).blur();
			return;
		}
		if (e.key === 'Enter' && t.closest('button, a')) return;
		if (e.metaKey || e.ctrlKey || e.altKey) return;
		const k = e.key.toLowerCase();
		const idx = KEYS.indexOf(k);
		if (idx >= 0 && CATS[idx]) {
			e.preventDefault();
			apply(CATS[idx]!.id);
		} else if (e.key === 'Enter' || e.key === 'ArrowRight') {
			e.preventDefault();
			skip();
		} else if (e.key === 'ArrowLeft') {
			e.preventDefault();
			back();
		} else if (k === 'm') mask();
		else if (k === 'v') toVacation();
		else if (k === 'g') keep();
		else if (k === 'r' && canRule) alwaysRule = !alwaysRule;
		else if (k === 'n') {
			e.preventDefault();
			noteEl?.focus();
		} else if (k === 's') {
			e.preventDefault();
			subEl?.focus();
		} else if (k === 'z' && last) undo();
	}

	onMount(() => {
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	});

	const currentCat = $derived(current ? categorize(current, budgetState.overrides, undefined, getMerchantCategoryMap()) : null);
	const currentSub = $derived(current ? subcategorize(current, budgetState.overrides, undefined, getMerchantCategoryMap()) : null);
	const progressPct = $derived(totalAtStart > 0 ? Math.round((done / totalAtStart) * 100) : 100);
</script>

<header class="mb-4 flex flex-wrap items-end justify-between gap-3">
	<!-- Capital 'À' badly drawn in DM Serif (misplaced accent): title in accented lowercase -->
	<PageTitle title="Opérations à trier" />
	<p class="meta-xs">{queue.length} à classer · {done} traitée{done > 1 ? 's' : ''} cette session</p>
</header>

<div class="mb-3 h-1 w-full overflow-hidden rounded-full" style="background-color: var(--surface-2);" aria-hidden="true">
	<div class="h-full rounded-full transition-[width] duration-300" style="width: {progressPct}%; background-color: var(--accent);"></div>
</div>

{#if !current}
	<section class="card p-6 text-center">
		<p class="serif text-lg">Tout est trié.</p>
		<p class="meta-xs mt-1">Plus rien à classer. Les échéances de crédit et les frais bancaires restent en « Autre » sans passer par ici.</p>
		<button type="button" class="btn btn-secondary btn-sm mt-3" onclick={() => navigate('/transactions')}>Voir les transactions</button>
	</section>
{:else}
	{@const tx = current}
	{@const amount = signedAmount(tx)}
	{@const label = merchantLabel(tx.remittance_information)}
	<div class="grid grid-cols-1 gap-3 lg:grid-cols-12">
		<section class="card card-lift p-4 lg:col-span-7" style={flash ? `border-color: ${getCategory(flash).color};` : ''}>
			<div class="flex items-start justify-between gap-4">
				<div class="min-w-0">
					<p class="serif truncate text-xl">{label || tx.remittance_information[0]}</p>
					<p class="meta-xs mt-0.5 break-words">{tx.remittance_information.join(' ')}</p>
				</div>
				<p class="tabular shrink-0 text-xl font-semibold {amount >= 0 ? 'text-accent' : 'text-debit'}">{amount >= 0 ? '+' : '−'}{formatEUR(Math.abs(amount))}</p>
			</div>
			<p class="meta-xs mt-2">
				{formatDate(tx.booking_date)}{#if tx.account} · {accountLabel(tx.account)}{/if}
				{#if tx.bank_category} · banque : {tx.bank_category}{#if tx.bank_subcategory} / {tx.bank_subcategory}{/if}{/if}
				{#if isExcluded(txKey(tx))} · masquée{/if}
			</p>

			<!-- Categories: keys 1-9, 0 -->
			<div class="mt-4 grid grid-cols-2 gap-1.5 sm:grid-cols-3" role="group" aria-label="Catégorie">
				{#each CATS as c, i (c.id)}
					<button
						type="button"
						class="press flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-[13px] transition-colors hover:border-[var(--text-2)]"
						style="border-color: var(--hairline); background-color: var(--surface);"
						onclick={() => apply(c.id)}
					>
						<kbd class="kbd">{KEYS[i]}</kbd>
						<CategoryMark id={c.id} size={20} />
						<span class="truncate">{c.label}</span>
					</button>
				{/each}
			</div>

			<div class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px]">
				<label class="flex items-center gap-1.5 {canRule ? 'cursor-pointer' : 'opacity-60'}" title={impact?.generic ? `Règle déconseillée : ${impact.reason}` : undefined}>
					<input type="checkbox" bind:checked={alwaysRule} disabled={!canRule} />
					Toujours pour « {label || 'ce libellé'} »
					{#if impact}
						<span class="meta-xs">
							{#if impact.generic}— déconseillé : {impact.reason}{:else}— {impact.count} opération{impact.count > 1 ? 's' : ''}{/if}
						</span>
					{/if}
					<kbd class="kbd">R</kbd>
				</label>
				<label class="flex items-center gap-1.5">
					<span class="text-secondary">Sous-catégorie</span>
					<select bind:this={subEl} class="input-surface cursor-pointer" value={currentSub ?? ''} onchange={onSubChange} aria-label="Sous-catégorie" disabled={!currentCat || currentCat === 'autre' ? subcategoriesFor('autre').length === 0 : false}>
						<option value="">—</option>
						{#each subcategoriesFor(currentCat ?? 'autre') as s (s.id)}
							<option value={s.id}>{s.label}</option>
						{/each}
					</select>
					<kbd class="kbd">S</kbd>
				</label>
			</div>

			<label class="mt-3 block">
				<span class="meta-xs">Note <kbd class="kbd">N</kbd></span>
				<input bind:this={noteEl} type="text" class="input-surface mt-1 w-full" placeholder="ex. cadeau neveu, remboursé par Morgan…" bind:value={noteDraft} onblur={saveNote} onkeydown={(e) => { if (e.key === 'Enter') { saveNote(); (e.target as HTMLInputElement).blur(); } }} />
			</label>

			<div class="mt-4 flex flex-wrap items-center gap-2">
				<button type="button" class="btn btn-secondary btn-sm" onclick={skip}>Passer <kbd class="kbd ml-1">Entrée</kbd></button>
				<button type="button" class="btn btn-secondary btn-sm" disabled={skipped.length === 0} onclick={back}>← Revenir</button>
				<button type="button" class="btn btn-secondary btn-sm" onclick={mask}>Masquer du budget <kbd class="kbd ml-1">M</kbd></button>
				<button type="button" class="btn btn-secondary btn-sm" onclick={toVacation}>Vacances <kbd class="kbd ml-1">V</kbd></button>
				<button type="button" class="btn btn-secondary btn-sm" onclick={keep}>Garder en « Autre » <kbd class="kbd ml-1">G</kbd></button>
				{#if last}<button type="button" class="btn btn-secondary btn-sm" onclick={undo}>Annuler « {last.label} » <kbd class="kbd ml-1">Z</kbd></button>{/if}
			</div>
		</section>

		<aside class="card p-4 lg:col-span-5">
			<h2 class="label-xs">Suivantes</h2>
			<ul class="mt-2 divide-y divide-[var(--border-subtle)] text-[13px]">
				{#each pending.slice(1, 9) as n (txKey(n))}
					{@const a = signedAmount(n)}
					<li class="flex items-baseline justify-between gap-3 py-1">
						<span class="min-w-0 truncate">{merchantLabel(n.remittance_information) || n.remittance_information[0]}</span>
						<span class="tabular shrink-0 text-secondary">{formatDate(n.booking_date)} · {a >= 0 ? '+' : '−'}{formatEUR(Math.abs(a))}</span>
					</li>
				{:else}
					<li class="py-1 text-secondary">Rien d'autre en attente.</li>
				{/each}
			</ul>
			{#if skipped.length > 0}
				<p class="meta-xs mt-2">{skipped.length} passée{skipped.length > 1 ? 's' : ''}, revues en fin de file.</p>
			{/if}
			<p class="meta-xs mt-3">Une vraie dépense diverse (avocat, coiffeur, virement à un proche) ? « Garder en Autre » (G) la sort de la file pour de bon.</p>
		</aside>
	</div>
{/if}
