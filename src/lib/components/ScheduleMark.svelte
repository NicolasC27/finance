<script lang="ts">
	import { merchantLogo } from '$lib/merchantLogos';
	import { groupColor, groupLabel, type ScheduleGroup } from '$lib/schedule';
	import { uiState } from '$lib/ui.svelte';
	import AccountIcon from './AccountIcon.svelte';
	import BrandMark from './BrandMark.svelte';
	import CategoryIcon from './CategoryIcon.svelte';
	import Mark from './Mark.svelte';

	/**
	 * Mark of a deadline: the logo of its brand when `label` (given for detected direct debits only:
	 * loan, goal and vehicle names are the user's words) names a known one and « Logos des marques »
	 * is on, otherwise the mark of its group. Budget categories keep their category icon;
	 * loans and employee savings take the icons of their account types, goals a flag of the same hand.
	 */
	let { group, size = 24, label = '' }: { group: ScheduleGroup; size?: number; label?: string } = $props();

	const iconSize = $derived(Math.round(size * 0.62));
	const logo = $derived(label && uiState.brandLogos ? merchantLogo(label) : null);
</script>

{#if logo}
	<BrandMark {logo} color={groupColor(group)} {size} title />
{:else}
	<Mark color={groupColor(group)} {size} title={groupLabel(group)}>
		{#if group === 'loan'}
			<AccountIcon kind="pret" size={iconSize} />
		{:else if group === 'savings'}
			<AccountIcon kind="livret" size={iconSize} />
		{:else if group === 'goal'}
			<svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
				<!-- Flag -->
				<path d="M6 20.5v-16" />
				<path d="M6 5h12l-2.6 3.75L18 12.5H6" />
			</svg>
		{:else}
			<CategoryIcon id={group} size={iconSize} />
		{/if}
	</Mark>
{/if}
