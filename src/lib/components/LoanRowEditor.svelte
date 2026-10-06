<script lang="ts">
	import { formatEUR } from '$lib/sensitiveFormat';
	import { resolveLoan, suggestInsuranceRate, marketRate, type InsuranceMode, type LoanAnalysis, type LoanKind } from '$lib/loanStudy';
	import type { Change } from '$lib/whatIf';

	/**
	 * Inputs of a loan row in the simulator: type, amount (or price and down payment for a mortgage),
	 * rate and duration next to the market rate, borrower insurance (rate suggested by age), fees
	 * (empty = usual value), mortgage flags, and a one-line summary of the real cost.
	 */
	let { change = $bindable(), analysis, age, endLabel }: { change: Change; analysis: LoanAnalysis | undefined; age: number; endLabel: (months: number) => string } = $props();

	const KINDS: { id: LoanKind; label: string }[] = [
		{ id: 'mortgage', label: 'Immobilier' },
		{ id: 'car', label: 'Auto' },
		{ id: 'personal', label: 'Perso' }
	];
	const MODES: { id: InsuranceMode; label: string }[] = [
		{ id: 'none', label: 'Sans assurance' },
		{ id: 'initial', label: 'Assurance sur capital initial (contrat de la banque)' },
		{ id: 'crd', label: 'Assurance sur capital restant (délégation)' }
	];

	const kind = $derived(change.kind ?? 'personal');
	const mode = $derived(change.insurance?.mode ?? 'none');
	const resolved = $derived(resolveLoan(change, age));
	const market = $derived(marketRate(kind, change.months ?? 0));
	const suggested = $derived(suggestInsuranceRate(kind, mode, age));
	let showFees = $state(false);

	const parse = (v: string): number | null => {
		const n = Number(v.replace(/[\s  €%]/g, '').replace(',', '.'));
		return v.trim() === '' || !Number.isFinite(n) ? null : n;
	};
	const fmt = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n));
	const pct = (n: number) => `${n.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} %`;

	function setKind(k: LoanKind) {
		change.kind = k;
		if (k === 'mortgage') {
			change.months = Math.max(change.months ?? 0, 180);
			change.insurance = change.insurance && change.insurance.mode !== 'none' ? change.insurance : { mode: 'crd', rate: null };
		}
	}
	function setMode(m: InsuranceMode) {
		change.insurance = { mode: m, rate: null };
	}
</script>

<div class="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
	<div class="flex overflow-hidden rounded-md border text-[11px]" style="border-color: var(--border);" role="group" aria-label="Type de crédit">
		{#each KINDS as k (k.id)}
			<button type="button" class="cursor-pointer px-2 py-0.5 {kind === k.id ? 'font-medium' : 'text-secondary'}" style={kind === k.id ? 'background-color: var(--surface-hover);' : ''} aria-pressed={kind === k.id} onclick={() => setKind(k.id)}>{k.label}</button>
		{/each}
	</div>
	{#if kind === 'mortgage'}
		<label class="flex items-center gap-1">Prix <input type="number" step="1000" min="0" class="input-surface tabular w-24 !px-1.5 !py-0.5 text-right text-xs" bind:value={change.price} aria-label="Prix du logement (€)" /> €</label>
		<label class="flex items-center gap-1">Apport <input type="number" step="1000" min="0" class="input-surface tabular w-20 !px-1.5 !py-0.5 text-right text-xs" bind:value={change.downPayment} aria-label="Apport (€)" /> €</label>
		<label class="flex items-center gap-1"><input type="checkbox" bind:checked={change.isNew} /> neuf</label>
	{/if}
	{#if kind !== 'mortgage' || !((change.price ?? 0) > 0)}
		<label class="flex items-center gap-1">{kind === 'mortgage' ? 'ou montant' : 'Montant'} <input type="number" step="any" min="0" class="input-surface tabular w-24 !px-1.5 !py-0.5 text-right text-xs" bind:value={change.amount} aria-label="Montant emprunté (€)" /> €</label>
	{/if}
</div>

{#if kind === 'mortgage' && resolved.price > 0}
	<p class="meta-xs mt-1">
		Emprunt <b class="tabular">{formatEUR(resolved.principal)}</b> = prix + notaire {formatEUR(resolved.notary)} ({change.isNew ? 'neuf ≈ 2,5 %' : 'ancien ≈ 7,5 %'}) + frais {formatEUR(resolved.fees.total)} − apport
	</p>
{/if}

<div class="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
	<label class="flex items-center gap-1"><input type="number" step="0.01" min="0" class="input-surface tabular w-16 !px-1.5 !py-0.5 text-right text-xs" bind:value={change.rate} aria-label="Taux nominal annuel (%)" /> %/an</label>
	<label class="flex items-center gap-1"><input type="number" step="1" min="1" max="420" class="input-surface tabular w-16 !px-1.5 !py-0.5 text-right text-xs" bind:value={change.months} aria-label="Durée (mois)" /> mois{#if (change.months ?? 0) >= 24}<span class="meta-xs">({((change.months ?? 0) / 12).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} ans)</span>{/if}</label>
	<span class="meta-xs" title="Taux indicatifs du marché (octobre 2026)">marché ≈ {pct(market.central)} ({market.low.toLocaleString('fr-FR')}–{pct(market.high)})</span>
</div>

<div class="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1.5">
	<select class="input-surface cursor-pointer !py-0.5 text-xs" value={mode} onchange={(e) => setMode((e.target as HTMLSelectElement).value as InsuranceMode)} aria-label="Assurance emprunteur">
		{#each MODES as m (m.id)}<option value={m.id}>{m.label}</option>{/each}
	</select>
	{#if mode !== 'none'}
		<label class="flex items-center gap-1">
			<input type="text" inputmode="decimal" class="input-surface tabular w-14 !px-1.5 !py-0.5 text-right text-xs" placeholder={String(suggested).replace('.', ',')} value={fmt(change.insurance?.rate).replace('.', ',')} aria-label="Taux d'assurance (% du capital par an)" title="Taux annuel en % du capital ; vide = taux habituel à {age} ans ({pct(suggested)})" onchange={(e) => (change.insurance = { mode, rate: parse((e.target as HTMLInputElement).value) })} />
			%/an
		</label>
	{/if}
	<button type="button" class="meta-xs cursor-pointer hover:underline" aria-expanded={showFees} onclick={() => (showFees = !showFees)}>Frais {formatEUR(resolved.fees.total)} {showFees ? '▴' : '▾'}</button>
</div>

{#if showFees}
	<div class="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
		<label class="flex items-center gap-1">dossier <input type="text" inputmode="decimal" class="input-surface tabular w-16 !px-1.5 !py-0.5 text-right text-xs" placeholder={String(resolved.fees.application)} value={fmt(change.application)} aria-label="Frais de dossier (€)" title="Vide = valeur habituelle (≈ 1 % du prêt immobilier, plafonné à 1 500 €)" onchange={(e) => (change.application = parse((e.target as HTMLInputElement).value))} /> €</label>
		<label class="flex items-center gap-1">garantie <input type="text" inputmode="decimal" class="input-surface tabular w-16 !px-1.5 !py-0.5 text-right text-xs" placeholder={String(resolved.fees.guarantee)} value={fmt(change.guarantee)} aria-label="Garantie ou caution (€)" title="Vide = valeur habituelle (caution ≈ 1,2 % du prêt immobilier, en partie rendue à la fin)" onchange={(e) => (change.guarantee = parse((e.target as HTMLInputElement).value))} /> €</label>
		<label class="flex items-center gap-1">courtage <input type="text" inputmode="decimal" class="input-surface tabular w-16 !px-1.5 !py-0.5 text-right text-xs" placeholder="0" value={fmt(change.broker)} aria-label="Frais de courtage (€)" onchange={(e) => (change.broker = parse((e.target as HTMLInputElement).value) ?? undefined)} /> €</label>
	</div>
{/if}

{#if kind === 'mortgage'}
	<div class="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
		<label class="flex items-center gap-1"><input type="checkbox" bind:checked={change.replacesRent} /> remplace mon loyer</label>
		<label class="flex items-center gap-1"><input type="checkbox" bind:checked={change.mainResidence} /> résidence principale</label>
		<label class="flex items-center gap-1"><input type="checkbox" bind:checked={change.firstTime} /> primo-accédant</label>
	</div>
{/if}

<p class="meta-xs mt-1.5">
	{#if analysis}
		Mensualité <b class="tabular">{formatEUR(analysis.payment)}</b>{#if analysis.insuranceFirst}&nbsp;+ assurance <span class="tabular">{formatEUR(analysis.insuranceFirst)}</span>{/if} · coût total <span class="tabular">{formatEUR(analysis.totalCost)}</span> · TAEG <span class="tabular">{pct(analysis.taeg)}</span>
		<span style="color: {analysis.usury.ok ? 'var(--text-secondary)' : 'var(--debit)'};">({analysis.usury.ok ? '≤' : '>'} usure {pct(analysis.usury.ceiling)}{analysis.usury.ok ? '' : ' : refus obligatoire'})</span> · fin {endLabel(analysis.loan.months)}
	{:else}
		{kind === 'mortgage' ? 'Prix (ou montant), taux et durée à renseigner.' : 'Montant, taux et durée à renseigner.'}
	{/if}
</p>
