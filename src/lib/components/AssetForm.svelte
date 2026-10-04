<script lang="ts">
	import DateField from '$lib/components/DateField.svelte';
	import { untrack } from 'svelte';
	import { assetsState, addAsset, updateAsset } from '$lib/assets.svelte';
	import { ASSET_TYPES, validateAsset, type Asset, type AssetType } from '$lib/assets';
	import { BODY_COLORS } from '$lib/vehicle';

	/**
	 * Form for a possession (add or edit), shown in a right panel on the Patrimoine (Biens block) and
	 * Voiture pages. Vehicle fields (first registration, odometer at purchase, warranty end) only for the
	 * 'Véhicule' type; odometer readings and linked operations are kept. Columns follow the width of
	 * the form (2 in a panel, 3 when wide); `framed` draws its own border (off inside a panel).
	 */
	let { bien: asset, typeParDefaut: defaultType = 'instrument', onDone, framed = true }: { bien?: Asset; typeParDefaut?: AssetType; onDone: (b?: Asset) => void; framed?: boolean } = $props();

	const today = () => new Date().toISOString().slice(0, 10);
	const s = (v: number | undefined) => (v === undefined ? '' : String(v));

	// Initial values (the parent recreates the form with {#key} for another possession)
	const initial = untrack(() => ({ b: asset, type: defaultType }));
	let fName = $state(initial.b?.name ?? '');
	let fType = $state<AssetType>(initial.b?.type ?? initial.type);
	let fDate = $state(initial.b?.purchaseDate ?? today());
	let fPrice = $state(initial.b ? String(initial.b.purchasePrice) : '');
	let fEstimate = $state(s(initial.b?.estimatedValue));
	let fValueDate = $state(initial.b?.valueDate ?? '');
	let fNote = $state(initial.b?.note ?? '');
	let fFirstRegistration = $state(initial.b?.vehicle?.firstRegistration ?? '');
	let fKmAtPurchase = $state(s(initial.b?.vehicle?.kmAtPurchase));
	let fWarrantyEnd = $state(initial.b?.vehicle?.warrantyEnd ?? '');
	let fPlate = $state(initial.b?.vehicle?.plate ?? '');
	let fVersion = $state(initial.b?.vehicle?.version ?? '');
	let fBoughtUsed = $state(initial.b?.vehicle?.boughtUsed ?? false);
	let fColor = $state(initial.b?.vehicle?.color ?? BODY_COLORS[0]!.hex);
	let error = $state('');

	/**
	 * On save: the estimate date is the one entered, otherwise today as soon as a value is given;
	 * odometer readings, photo and valuation are kept (managed on the Voiture page); cleared fields
	 * are removed explicitly, otherwise the merge would keep the old value. A value typed or changed
	 * here is the user's own: retained as « estimation perso », confirmed; an unchanged value keeps
	 * its source and status.
	 */
	function save() {
		const previous = asset ? assetsState.biens.find((b) => b.id === asset.id) : undefined;
		const v = validateAsset({
			name: fName,
			type: fType,
			purchaseDate: fDate,
			purchasePrice: fPrice.replace(/\s/g, ''),
			estimatedValue: fEstimate.replace(/\s/g, ''),
			valueDate: fEstimate.trim() ? fValueDate || today() : '',
			linkedTxKeys: previous?.linkedTxKeys ?? [],
			note: fNote,
			...(fType === 'vehicule'
				? {
						vehicle: {
							...previous?.vehicle,
							firstRegistration: fFirstRegistration,
							kmAtPurchase: fKmAtPurchase,
							warrantyEnd: fWarrantyEnd,
							plate: fPlate,
							version: fVersion,
							boughtUsed: fBoughtUsed,
							color: fColor,
							kmLog: previous?.vehicle?.kmLog ?? []
						}
					}
				: {})
		});
		if (typeof v === 'string') {
			error = v;
			return;
		}
		const status = v.estimatedValue === undefined ? { valueSource: undefined, valueConfirmed: undefined } : { valueSource: 'saisie' as const, valueConfirmed: true };
		if (previous) {
			const changed = v.estimatedValue !== previous.estimatedValue;
			updateAsset(previous.id, { ...v, estimatedValue: v.estimatedValue, valueDate: v.valueDate, note: v.note, vehicle: v.vehicle, ...(changed ? status : {}) });
			onDone(assetsState.biens.find((b) => b.id === previous.id));
		} else {
			onDone(addAsset({ ...v, ...(v.estimatedValue !== undefined ? status : {}) }));
		}
	}
</script>

<div class="@container">
<form
	class="grid grid-cols-2 gap-x-3 gap-y-2 @min-[34rem]:grid-cols-3 {framed ? 'rounded-lg border p-3' : ''}"
	style="border-color: var(--border);"
	onsubmit={(e) => {
		e.preventDefault();
		save();
	}}
>
	<label class="col-span-2">
		<span class="meta-xs">Nom</span>
		<input type="text" class="input-surface mt-1 w-full" placeholder={fType === 'vehicule' ? 'Toyota C-HR' : 'Piano'} maxlength="80" bind:value={fName} aria-label="Nom du bien" />
	</label>
	<label>
		<span class="meta-xs">Type</span>
		<select class="input-surface mt-1 w-full cursor-pointer" bind:value={fType} aria-label="Type de bien">
			{#each ASSET_TYPES as c (c.id)}
				<option value={c.id}>{c.label}</option>
			{/each}
		</select>
	</label>
	<label>
		<span class="meta-xs">Date d'achat</span>
		<DateField bind:value={fDate} label="Date d'achat" class="mt-1 w-full" />
	</label>
	<label>
		<span class="meta-xs">Prix payé (€)</span>
		<input type="text" inputmode="decimal" class="input-surface tabular mt-1 w-full" placeholder="2 300" bind:value={fPrice} aria-label="Prix payé (€)" />
	</label>
	<label>
		<span class="meta-xs">Valeur estimée (optionnel)</span>
		<input type="text" inputmode="decimal" class="input-surface tabular mt-1 w-full" placeholder="—" bind:value={fEstimate} aria-label="Valeur estimée (€)" />
	</label>
	{#if fEstimate.trim()}
		<label>
			<span class="meta-xs">Estimée le</span>
			<DateField bind:value={fValueDate} label="Date de l'estimation" class="mt-1 w-full" />
		</label>
	{/if}
	{#if fType === 'vehicule'}
		<label>
			<span class="meta-xs">1re mise en circulation</span>
			<DateField bind:value={fFirstRegistration} label="Date de 1re mise en circulation" class="mt-1 w-full" />
		</label>
		<label>
			<span class="meta-xs">Compteur à l'achat (km)</span>
			<input type="text" inputmode="numeric" class="input-surface tabular mt-1 w-full" placeholder="20 000" bind:value={fKmAtPurchase} aria-label="Kilométrage à l'achat" />
		</label>
		<label>
			<span class="meta-xs">Fin de garantie (optionnel)</span>
			<DateField bind:value={fWarrantyEnd} label="Fin de garantie" class="mt-1 w-full" />
		</label>
		<label class="col-span-2">
			<span class="meta-xs">Version (moteur, finition, boîte)</span>
			<input type="text" class="input-surface mt-1 w-full" placeholder="2.0 Hybride 180 ch Design BVA" maxlength="80" bind:value={fVersion} aria-label="Version" />
		</label>
		<label>
			<span class="meta-xs">Plaque (reste sur ce PC)</span>
			<input type="text" class="input-surface tabular mt-1 w-full uppercase" placeholder="AB-123-CD" maxlength="12" bind:value={fPlate} aria-label="Plaque d'immatriculation" />
		</label>
		<label>
			<span class="meta-xs">Couleur</span>
			<select class="input-surface mt-1 w-full cursor-pointer" bind:value={fColor} aria-label="Couleur de carrosserie">
				{#each BODY_COLORS as c (c.id)}<option value={c.hex}>{c.label}</option>{/each}
				{#if !BODY_COLORS.some((c) => c.hex === fColor)}<option value={fColor}>Personnalisée</option>{/if}
			</select>
		</label>
		<label class="flex cursor-pointer items-center gap-2 self-end pb-1.5 text-[13px]">
			<input type="checkbox" bind:checked={fBoughtUsed} aria-label="Achetée d'occasion" />
			Achetée d'occasion
		</label>
	{/if}
	<label class="col-span-2 @min-[34rem]:col-span-3">
		<span class="meta-xs">Note (optionnel)</span>
		<input type="text" class="input-surface mt-1 w-full" maxlength="500" bind:value={fNote} aria-label="Note" />
	</label>
	<div class="col-span-2 flex flex-wrap items-center gap-2 @min-[34rem]:col-span-3">
		<button type="submit" class="btn btn-primary btn-sm">{asset ? 'Enregistrer' : 'Ajouter'}</button>
		<button type="button" class="btn btn-secondary btn-sm" onclick={() => onDone()}>Annuler</button>
		{#if error}<span class="meta-xs" style="color: var(--amber);" role="alert">{error}</span>{/if}
	</div>
</form>
</div>
