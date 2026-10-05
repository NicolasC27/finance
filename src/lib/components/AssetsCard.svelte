<script module lang="ts">
	import type { BlockElement, BlockShow } from '$lib/layoutModel';

	/** Optional parts of the card, hideable from its Patrimoine block. */
	export const ASSETS_ELEMENTS: BlockElement[] = [
		{ id: 'totaux', label: 'Valeur estimée et prix payé' },
		{ id: 'global', label: 'Patrimoine total, biens compris' },
		{ id: 'liste', label: 'Liste des biens' },
		{ id: 'type', label: 'Type de chaque bien' },
		{ id: 'date', label: "Date d'achat" }
	];
</script>

<script lang="ts">
	import { assetsState, removeAsset, restoreAsset, detachTx, getAssetTotals } from '$lib/assets.svelte';
	import { assetTypeLabel, shortValueSource, valueSourceOf, valueNeedsConfirmation, assetValue, type Asset } from '$lib/assets';
	import { getNetWorth } from '$lib/wealth.svelte';
	import { getTransactions } from '$lib/store.svelte';
	import { txKey } from '$lib/categories';
	import { signedAmount } from '$lib/data';
	import { merchantLabel } from '$lib/merchant';
	import { cleanLabel, formatDate, formatEUR } from '$lib/sensitiveFormat';
	import { showToast } from '$lib/ui.svelte';
	import AssetForm from './AssetForm.svelte';
	import SidePanel from './SidePanel.svelte';
	import { modulesState } from '$lib/modules.svelte';

	/**
	 * 'Biens' block (Patrimoine page): purchased objects (car, instruments, hi-fi…) tracked SEPARATELY
	 * from financial wealth, which does not change. Total paid, total estimated, and total wealth
	 * including possessions, shown separately. A vehicle has its full sheet on the Voiture page.
	 */

	/** `show` comes from the block: parts the user unticked are not rendered. */
	let { show = () => true }: { show?: BlockShow } = $props();

	const assets = $derived([...assetsState.biens].sort((a, b) => b.purchaseDate.localeCompare(a.purchaseDate)));
	const totals = $derived(getAssetTotals());
	const txByKey = $derived(new Map(getTransactions().map((t) => [txKey(t), t])));

	let formOpen = $state(false);
	let editing = $state<Asset | undefined>(undefined);
	let openId = $state<string | null>(null);

	function openForm(b?: Asset) {
		editing = b;
		formOpen = true;
	}

	function remove(b: Asset) {
		const old = removeAsset(b.id);
		if (old) showToast(`Bien « ${old.name} » supprimé`, 'Annuler', () => restoreAsset(old));
	}
</script>

<div class="flex items-center justify-between gap-2">
	<h2 class="label-xs">Biens</h2>
	<button type="button" class="btn btn-secondary btn-sm" onclick={() => openForm()} aria-haspopup="dialog">+ Ajouter</button>
</div>

{#if assets.length > 0 && show('totaux')}
	<div class="mt-2.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
		<p class="amount-md tabular">{formatEUR(totals.estime)}</p>
		<p class="meta-xs">
			estimé · payé <span class="tabular">{formatEUR(totals.paye)}</span>
			{#if totals.sansEstimation > 0}· prix payé retenu pour {totals.sansEstimation} bien{totals.sansEstimation > 1 ? 's' : ''} sans estimation{/if}
		</p>
	</div>
{/if}
{#if assets.length > 0 && show('global')}
	<p class="meta-xs mt-1">
		Hors patrimoine financier · patrimoine total, biens compris :
		<span class="tabular font-medium" style="color: var(--text);">{formatEUR(getNetWorth() + totals.estime)}</span>
	</p>
{/if}

<SidePanel
	open={formOpen}
	title={editing ? `Modifier · ${editing.name}` : 'Nouveau bien'}
	onClose={() => {
		formOpen = false;
		editing = undefined;
	}}
	width={480}
>
	{#if formOpen}
		{#key editing?.id ?? 'nouveau'}
			<AssetForm
				bien={editing}
				framed={false}
				onDone={() => {
					formOpen = false;
					editing = undefined;
				}}
			/>
		{/key}
	{/if}
</SidePanel>

{#if assets.length === 0}
	<p class="meta-xs mt-2">
		Voiture, instruments, hi-fi… suivis à part du patrimoine financier. Ajoute un bien, ou rattache une opération depuis Transactions (détail → « Rattacher à un bien »).
	</p>
{:else if show('liste')}
	<ul class="mt-3 divide-y divide-[var(--border-subtle)] text-[13px]">
		{#each assets as b (b.id)}
			<li class="py-1.5">
				<button
					type="button"
					class="flex w-full cursor-pointer items-center gap-3 text-left"
					onclick={() => (openId = openId === b.id ? null : b.id)}
					aria-expanded={openId === b.id}
				>
					<span class="min-w-0 flex-1 truncate font-medium">{b.name}</span>
					{#if show('type')}<span class="chip chip-muted px-1.5 py-0 text-[10px]">{assetTypeLabel(b.type)}</span>{/if}
					{#if show('date')}<span class="meta-xs hidden tabular @md:inline">{formatDate(b.purchaseDate)}</span>{/if}
					{#if valueNeedsConfirmation(b, modulesState.car.confirmValue)}<span class="chip chip-amber px-1.5 py-0 text-[10px]" title="Valeur retenue à confirmer sur la page Voiture">à confirmer</span>{/if}
					<span class="tabular w-24 text-right font-medium" title={b.estimatedValue !== undefined ? `Valeur retenue (${shortValueSource(valueSourceOf(b))}) · payé ${formatEUR(b.purchasePrice)}` : 'Prix payé (pas d’estimation)'}>{formatEUR(assetValue(b))}</span>
				</button>
				{#if openId === b.id}
					<div class="mt-1.5 rounded-md p-2.5" style="background-color: var(--surface-2);">
						<p class="meta-xs">
							Payé {formatEUR(b.purchasePrice)} le {formatDate(b.purchaseDate)} · {b.estimatedValue !== undefined ? `valeur retenue ${formatEUR(b.estimatedValue)} (${shortValueSource(valueSourceOf(b))}${b.valueDate ? ` du ${formatDate(b.valueDate)}` : ''}${valueNeedsConfirmation(b, modulesState.car.confirmValue) ? ', à confirmer' : ''})` : 'pas d’estimation (prix payé retenu)'}
						</p>
						{#if b.note}<p class="meta-xs mt-1">{b.note}</p>{/if}
						{#if b.linkedTxKeys.length > 0}
							<ul class="mt-1.5 space-y-0.5">
								{#each b.linkedTxKeys as k (k)}
									{@const t = txByKey.get(k)}
									<li class="flex items-center gap-2 text-[12px]">
										<span class="tabular text-secondary">{t ? formatDate(t.booking_date) : '—'}</span>
										<span class="min-w-0 flex-1 truncate">{t ? merchantLabel(t.remittance_information) || cleanLabel(t.remittance_information) : `opération introuvable (${k})`}</span>
										{#if t}<span class="tabular">{formatEUR(signedAmount(t))}</span>{/if}
										<button type="button" class="cursor-pointer text-secondary hover:underline" onclick={() => detachTx(k)}>détacher</button>
									</li>
								{/each}
							</ul>
						{:else}
							<p class="meta-xs mt-1">Aucune opération rattachée.</p>
						{/if}
						<div class="mt-2 flex gap-2">
							{#if b.type === 'vehicule'}<a href="/voiture" class="btn btn-accent btn-sm">Fiche véhicule</a>{/if}
							<button type="button" class="btn btn-secondary btn-sm" onclick={() => openForm(b)}>Modifier</button>
							<button type="button" class="btn btn-secondary btn-sm" style="color: var(--amber);" onclick={() => remove(b)}>Supprimer</button>
						</div>
					</div>
				{/if}
			</li>
		{/each}
	</ul>
{/if}
