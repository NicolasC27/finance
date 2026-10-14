<script lang="ts">
	import { getCategory } from '$lib/categories';
	import { visitWhen } from '$lib/sinceVisit';
	import { dismissVisit, visitState } from '$lib/sinceVisit.svelte';

	/**
	 * « Depuis ta dernière visite » line of the home page: what changed since the previous visit
	 * (operations added, envelopes crossed, deadlines that came), each part a link to where it is.
	 * Nothing when nothing changed; « × » hides it for the visit.
	 */

	const diff = $derived(visitState.dismissed ? null : visitState.diff);

	const list = (names: string[]): string => (names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} et ${names.at(-1)}`);
	const plural = (n: number, word: string): string => `${n} ${word}${n > 1 ? 's' : ''}`;
</script>

{#if diff}
	<p class="visit-line" aria-live="polite">
		<span class="visit-since">Depuis ta visite {visitWhen(diff.since, new Date())} :</span>
		{#if diff.added > 0}
			<a href="/transactions" class="visit-part">{plural(diff.added, 'opération')} ajoutée{diff.added > 1 ? 's' : ''}</a>
		{/if}
		{#if diff.crossed.length > 0}
			{#if diff.added > 0}<span class="visit-sep" aria-hidden="true">·</span>{/if}
			<a href="/budget" class="visit-part visit-alert">{list(diff.crossed.map((id) => getCategory(id).label))} {diff.crossed.length > 1 ? 'ont dépassé leur enveloppe' : 'a dépassé son enveloppe'}</a>
		{/if}
		{#if diff.arrived.length > 0}
			{#if diff.added > 0 || diff.crossed.length > 0}<span class="visit-sep" aria-hidden="true">·</span>{/if}
			<a href="/echeancier" class="visit-part">{list(diff.arrived.slice(0, 3).map((d) => d.label))}{diff.arrived.length > 3 ? ` et ${diff.arrived.length - 3} autres` : ''} arrivé{diff.arrived.length > 1 ? 's' : ''} à échéance</a>
		{/if}
		<button type="button" class="visit-close" onclick={dismissVisit} aria-label="Masquer jusqu'à la prochaine visite" title="Masquer jusqu'à la prochaine visite">×</button>
	</p>
{/if}

<style>
	.visit-line {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 2px 6px;
		margin-top: 6px;
		font-size: 12.5px;
		color: var(--text-2);
	}

	.visit-since {
		color: var(--text-3);
	}

	.visit-part {
		color: var(--text);
		text-decoration: underline;
		text-decoration-color: color-mix(in srgb, var(--accent) 45%, transparent);
		text-underline-offset: 3px;
	}

	.visit-part:hover {
		text-decoration-color: var(--accent);
	}

	.visit-alert {
		color: var(--accent-2);
	}

	.visit-sep {
		color: var(--text-3);
	}

	.visit-close {
		margin-left: 2px;
		padding: 0 4px;
		border-radius: 4px;
		color: var(--text-3);
		cursor: pointer;
	}

	.visit-close:hover {
		color: var(--text);
	}
</style>
