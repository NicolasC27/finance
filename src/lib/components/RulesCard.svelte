<script lang="ts">
	import { rulesState, removeRule } from '$lib/rules.svelte';
	import { getCategory, ruleFor, txKey } from '$lib/categories';
	import { getTransactions } from '$lib/store.svelte';
	import { budgetState } from '$lib/budget.svelte';
	import { merchantLabel } from '$lib/merchant';

	/**
	 * Collapsible 'Règles apprises' panel: merchant label → category, count of affected operations,
	 * deletion.
	 */

	let open = $state(false);
	const rules = $derived(rulesState.rules);

	/**
	 * Number of operations where this rule is EFFECTIVE: no manual override and no more specific rule
	 * winning (same arbitration as categorize).
	 */
	function applyCount(keyword: string): number {
		let n = 0;
		for (const tx of getTransactions()) {
			if (budgetState.overrides[txKey(tx)]) continue;
			if (ruleFor(tx, rulesState.rules)?.keyword === keyword) n++;
		}
		return n;
	}
</script>

{#if rules.length > 0}
	<section class="card fade-slide mb-4 p-4" style="--stagger: 40ms;">
		<button
			type="button"
			class="press flex w-full cursor-pointer items-center justify-between gap-3 text-left"
			aria-expanded={open}
			onclick={() => (open = !open)}
		>
			<span class="label-xs">Règles apprises</span>
			<span class="flex items-center gap-2 text-xs text-secondary">
				<span class="tabular">{rules.length} règle{rules.length > 1 ? 's' : ''}</span>
				<svg
					width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"
					style="transform: rotate({open ? 180 : 0}deg); transition: transform 200ms ease;"
					aria-hidden="true"
				>
					<path d="m6 9 6 6 6-6" />
				</svg>
			</span>
		</button>
		{#if open}
			<ul class="mt-3 divide-y divide-[var(--border-subtle)]">
				{#each rules as rule (rule.keyword)}
					{@const cat = getCategory(rule.categoryId)}
					{@const count = applyCount(rule.keyword)}
					<li class="flex items-center gap-3 py-2 text-sm">
						<span class="min-w-0 flex-1">
							<span class="block truncate font-medium">« {merchantLabel([rule.keyword])} »</span>
							<span class="meta-xs tabular">
								s'applique à {count} opération{count > 1 ? 's' : ''}
							</span>
						</span>
						<span class="flex shrink-0 items-center gap-1.5 text-xs" style="color: {cat.color};">
							<span class="h-2 w-2 rounded-full" style="background-color: {cat.color};" aria-hidden="true"></span>
							{cat.label}
						</span>
						<button
							type="button"
							class="press cursor-pointer p-1 text-secondary transition-colors hover:text-[var(--amber)]"
							title="Supprimer cette règle"
							aria-label="Supprimer la règle {rule.keyword}"
							onclick={() => removeRule(rule.keyword)}
						>
							✕
						</button>
					</li>
				{/each}
			</ul>
			<p class="meta-xs mt-2">Appliquées automatiquement, y compris aux prochains imports CSV/XLSX.</p>
		{/if}
	</section>
{/if}
