<script lang="ts">
	import PageTitle from './PageTitle.svelte';
	import { formatEURCompact } from '$lib/format';
	import type { EditorialSummary } from '$lib/report';

	/**
	 * Editorial hero of the Accueil page (SPEC-DA, Volet A §1): today's date as an italic serif
	 * dateline, the displayed month as the page title, and the computed one-sentence summary
	 * promoted to the hero line (serif lede, the variation in coloured italics).
	 */
	let { title, summary }: { title: string; summary: EditorialSummary | null } = $props();

	/** Magazine dateline (« mardi 14 octobre »), computed once per page mount. */
	const dateline = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
</script>

<div class="glance-hero">
	<p class="kicker glance-dateline">{dateline}</p>
	<PageTitle {title} />
	{#if summary}
		<p class="serif hero-line" aria-live="off">
			{#if summary.sober}
				Mois en cours — {summary.count} opération{summary.count > 1 ? 's' : ''}.
			{:else}
				<!-- Current month: comparison at the same day of the previous month (before: '−94 %' on the 3rd) -->
				{formatEURCompact(summary.expenses)} dépensés {summary.cutoffDay ? `au ${summary.cutoffDay}` : 'ce mois'}{#if summary.variation}{' — '}<span
						class="hero-var"
						style="color: {summary.variation.down ? 'var(--accent)' : 'var(--debit)'};"
						>{summary.variation.pct} % de {summary.variation.down ? 'moins' : 'plus'} {summary.cutoffDay
							? `qu'au ${summary.cutoffDay} ${summary.variation.prevMonthName}`
							: `qu'en ${summary.variation.prevMonthName}`}</span
					>{/if}{#if summary.savings !== null}{' ; '}épargne de {formatEURCompact(summary.savings)}{/if}.
			{/if}
		</p>
	{/if}
</div>

<style>
	.glance-hero {
		min-width: 0;
	}

	.glance-dateline {
		margin: 0 0 2px;
	}

	/* Hero line: the month in one sentence, a magazine lede under the title */
	.hero-line {
		margin: 8px 0 0;
		max-width: 64ch;
		font-size: clamp(18px, 2vw, 22px);
		line-height: 1.35;
		color: var(--text);
		text-wrap: pretty;
}

	/* The variation stands out in italics: the single signal colour when down, debit when up */
	.hero-var {
		font-style: italic;
	}
</style>
