<script lang="ts">
	import type { CategoryId } from '$lib/types';
	import { formatDateShort, isPrivate, sensitiveEUR } from '$lib/format';
	import { getCategory } from '$lib/categories';
	import { elsewhereLabel, fileTarget, historyCountLabel, priceChangeLabel, type MerchantHistory } from '$lib/operationDetail';

	/**
	 * One line of an operation's detail about its merchant: a strip of the last amounts (the open
	 * operation darker), how many operations since when (a link to all of them), the last change of a
	 * fixed price and where the other operations are filed. When most of them are in another
	 * category, that hint files this one there too.
	 */
	let {
		history,
		color,
		onShowAll,
		onFile
	}: {
		history: MerchantHistory;
		/** Colour of the open operation's category. */
		color: string;
		onShowAll?: () => void;
		/** Files the open operation in a category; absent when its category is fixed. */
		onFile?: (id: CategoryId) => void;
	} = $props();

	const BAR = 3;
	const GAP = 2;
	const HEIGHT = 14;

	const masked = $derived(isPrivate());
	const peak = $derived(Math.max(...history.bars.map((b) => b.amount), 0.01));
	const width = $derived(history.bars.length * (BAR + GAP) - GAP);
	const elsewhere = $derived(history.elsewhere);
	const fileable = $derived(!!onFile && fileTarget(history) !== null);

	/** Height of a bar, at least 2 px so a small amount still shows. */
	function barHeight(amount: number): number {
		return Math.max(2, Math.round((amount / peak) * HEIGHT));
	}
</script>

<div class="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px]" style="color: var(--text-2);">
	<svg class="mr-0.5 shrink-0" {width} height={HEIGHT} viewBox="0 0 {width} {HEIGHT}" aria-hidden="true">
		{#each history.bars as b, i (b.key)}
			{@const h = barHeight(b.amount)}
			<rect x={i * (BAR + GAP)} y={HEIGHT - h} width={BAR} height={h} rx="1" fill={color} fill-opacity={b.current ? 0.95 : 0.32}>
				<title>{b.date ? formatDateShort(b.date) : 'En cours'} : {sensitiveEUR(b.amount)}</title>
			</rect>
		{/each}
	</svg>
	{#if onShowAll}
		<button
			type="button"
			class="hist-link"
			title="Toutes les opérations de ce marchand"
			onclick={(e) => {
				e.stopPropagation();
				onShowAll();
			}}>{historyCountLabel(history)}</button
		>
	{:else}
		<span>{historyCountLabel(history)}</span>
	{/if}
	{#if history.change}
		<span aria-hidden="true">·</span>
		<span class="tabular" title={history.credit ? "Dernier changement d'un montant fixe" : "Dernier changement d'un prix fixe"}>{priceChangeLabel(history.change, masked, history.credit)}</span>
	{/if}
	{#if elsewhere}
		{@const target = elsewhere.categoryId}
		<span aria-hidden="true">·</span>
		{#if fileable && onFile}
			<button
				type="button"
				class="hist-link"
				title="Classer celle-ci en {getCategory(target).label}, comme les autres"
				onclick={(e) => {
					e.stopPropagation();
					onFile(target);
				}}>{elsewhereLabel(elsewhere)}</button
			>
		{:else}
			<span>{elsewhereLabel(elsewhere)}</span>
		{/if}
	{/if}
</div>

<style>
	.hist-link {
		cursor: pointer;
		color: inherit;
		text-decoration: underline dotted;
		text-decoration-color: var(--hairline);
		text-underline-offset: 3px;
		transition: color var(--motion-base) ease;
	}
	.hist-link:hover {
		color: var(--text);
		text-decoration-color: currentColor;
	}
</style>
