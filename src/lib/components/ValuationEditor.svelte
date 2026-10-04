<script lang="ts">
	import { untrack } from 'svelte';
	import { updateAsset } from '$lib/assets.svelte';
	import { validateValuation, type Asset } from '$lib/assets';
	import { patchRetainValue } from '$lib/vehicle';

	/**
	 * Hand-entered valuation: trade-in, private sale, dealer price, and comparable ads (add, edit,
	 * remove). Typed by the user, so saving retains the private-sale price as the confirmed value
	 * (source « estimation perso ») and extends the history; nothing is refreshed automatically.
	 * Shown in a right panel on the Voiture page (`framed` off there).
	 */
	let { bien: asset, onDone, framed = true }: { bien: Asset; onDone: () => void; framed?: boolean } = $props();

	const today = new Date().toISOString().slice(0, 10);
	const s = (v: number | undefined) => (v === undefined ? '' : String(v));
	const initial = untrack(() => asset);
	const c = initial.vehicle?.cote;

	let tradeIn = $state(s(c?.reprise));
	let privateSale = $state(s(c?.particulier ?? initial.estimatedValue));
	let dealer = $state(s(c?.pro));
	let ads = $state((c?.annonces ?? []).map((a) => ({ libelle: a.libelle, annee: s(a.annee), km: s(a.km), prix: s(a.prix), source: a.source ?? '', url: a.url ?? '' })));
	let error = $state('');

	const toNumber = (v: string) => (v.trim() ? Number(v.replace(/[\s  €]/g, '').replace(',', '.')) : undefined);

	function addAd() {
		ads = [...ads, { libelle: '', annee: '', km: '', prix: '', source: '', url: '' }];
	}

	function save() {
		const filled = ads.filter((a) => a.libelle.trim() || a.km.trim() || a.prix.trim());
		const valuation = validateValuation({
			date: today,
			reprise: toNumber(tradeIn),
			particulier: toNumber(privateSale),
			pro: toNumber(dealer),
			annonces: filled.map((a) => ({ libelle: a.libelle, annee: toNumber(a.annee), km: toNumber(a.km), prix: toNumber(a.prix), source: a.source, url: a.url.trim() }))
		});
		if (typeof valuation === 'string') return (error = valuation);
		if (valuation.particulier === undefined) return (error = 'le prix entre particuliers est requis (il devient la valeur retenue)');
		if (valuation.annonces.length < filled.length) return (error = 'une annonce est incomplète : libellé, km et prix');
		const vehicle = asset.vehicle ?? { kmLog: [] };
		const history = [...(vehicle.coteHistorique ?? []).filter((h) => h.date !== today), { date: today, valeur: valuation.particulier }];
		updateAsset(asset.id, { ...patchRetainValue(valuation.particulier, 'saisie', today), vehicle: { ...vehicle, cote: valuation, coteHistorique: history } });
		onDone();
	}
</script>

<form
	class={framed ? 'mt-3 rounded-lg border p-3' : ''}
	style="border-color: var(--border);"
	onsubmit={(e) => {
		e.preventDefault();
		save();
	}}
>
	<div class="grid grid-cols-3 gap-2">
		<label>
			<span class="meta-xs">Reprise par un pro (€)</span>
			<input type="text" inputmode="decimal" class="input-surface tabular mt-1 w-full" bind:value={tradeIn} aria-label="Reprise par un pro (€)" />
		</label>
		<label>
			<span class="meta-xs">Entre particuliers (€)</span>
			<input type="text" inputmode="decimal" class="input-surface tabular mt-1 w-full font-medium" bind:value={privateSale} aria-label="Prix entre particuliers (€)" />
		</label>
		<label>
			<span class="meta-xs">Prix chez un pro (€)</span>
			<input type="text" inputmode="decimal" class="input-surface tabular mt-1 w-full" bind:value={dealer} aria-label="Prix chez un pro (€)" />
		</label>
	</div>

	<p class="label-xs mt-3">Annonces comparables</p>
	<div class="mt-1 space-y-1.5">
		{#each ads as a, i (i)}
			<div class="flex flex-wrap items-center gap-1.5 text-[12px]">
				<input type="text" class="input-surface min-w-[180px] flex-1" placeholder="Version, finition, options" maxlength="120" bind:value={a.libelle} aria-label="Libellé de l'annonce {i + 1}" />
				<input type="text" inputmode="numeric" class="input-surface tabular w-16" placeholder="Année" bind:value={a.annee} aria-label="Année de l'annonce {i + 1}" />
				<input type="text" inputmode="numeric" class="input-surface tabular w-24" placeholder="km" bind:value={a.km} aria-label="Kilométrage de l'annonce {i + 1}" />
				<input type="text" inputmode="decimal" class="input-surface tabular w-24" placeholder="Prix €" bind:value={a.prix} aria-label="Prix de l'annonce {i + 1}" />
				<input type="text" class="input-surface w-28" placeholder="Site" maxlength="40" bind:value={a.source} aria-label="Site de l'annonce {i + 1}" />
				<input type="url" class="input-surface w-44" placeholder="https://…" bind:value={a.url} aria-label="Lien de l'annonce {i + 1}" />
				<button type="button" class="text-secondary w-5 cursor-pointer hover:text-[var(--text)]" onclick={() => (ads = ads.filter((_, j) => j !== i))} aria-label="Retirer l'annonce {i + 1}">×</button>
			</div>
		{/each}
	</div>
	<button type="button" class="btn btn-secondary btn-sm mt-2" onclick={addAd}>+ Annonce</button>

	<div class="mt-3 flex flex-wrap items-center gap-3 border-t pt-3" style="border-color: var(--border-subtle);">
		<span class="meta-xs flex-1">Le prix entre particuliers devient ta valeur retenue (estimation perso, validée).</span>
		<button type="submit" class="btn btn-primary btn-sm">Enregistrer</button>
		<button type="button" class="btn btn-secondary btn-sm" onclick={onDone}>Annuler</button>
	</div>
	{#if error}<p class="meta-xs mt-2" style="color: var(--amber);" role="alert">{error}</p>{/if}
</form>
