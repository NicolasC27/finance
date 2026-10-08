<script lang="ts">
	import PageTitle from '$lib/components/PageTitle.svelte';
	import { formatEUR } from '$lib/sensitiveFormat';
	import { getIncomeTax, setTaxSettings, setYearInputs, taxSettings, type TaxSettings, type YearInputs } from '$lib/incomeTax.svelte';
	import { navigate } from '$lib/router.svelte';
	import { importFiles } from '$lib/importPanelState.svelte';

	/**
	 * Income tax of the current year: taxable income (payslips read and projected, salary before
	 * them, other income), every step of the calculation, and the withholding against it — the
	 * regularisation of next September and the rate that would avoid it. Settings typed here are
	 * the only thing stored.
	 */

	let ftInput = $state<HTMLInputElement | null>(null);
	const v = $derived(getIncomeTax());
	const s = $derived(taxSettings.v);
	const r = $derived(v.result);
	const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
	const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]}`;
	const pct = (n: number) => `${n.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`;
	const eur0 = (n: number) => `${Math.round(n).toLocaleString('fr-FR')} €`;
	const parse = (raw: string): number | null => {
		const n = Number(raw.replace(/[\s  €%]/g, '').replace(',', '.'));
		return raw.trim() === '' || !Number.isFinite(n) || n < 0 ? null : n;
	};
	const set = (patch: Partial<Omit<TaxSettings, 'years'>>) => setTaxSettings(patch);
	const setY = (patch: Partial<YearInputs>) => setYearInputs(v.year, patch);
	const y = $derived(v.inputs);
	const lines = $derived(r.brackets.filter((b) => b.tax > 0 || b.rate === 0));
	const todayIso = new Date().toISOString().slice(0, 10);
	const started = $derived(todayIso >= `${v.year + 1}-09-01`);
	const otherTax = $derived(v.compare ? (v.compare.used === 'bill' ? v.compare.current.netTax : v.compare.bill.netTax) : null);
	const avoidHint = $derived(v.reg.rateToAvoid !== null && v.months.length ? v.months.find((m) => m.projected)?.rate ?? null : null);
</script>

{#snippet field(label: string, value: number | null, placeholder: string, onset: (n: number | null) => void, title = '', width = 'w-24')}
	<label class="flex items-center justify-between gap-2" {title}>
		<span class="text-secondary">{label}</span>
		<input type="text" inputmode="decimal" class="input-surface tabular {width} !px-1.5 !py-0.5 text-right text-xs" {placeholder} value={value === null ? '' : String(value).replace('.', ',')} aria-label={label} onchange={(e) => onset(parse((e.target as HTMLInputElement).value))} />
	</label>
{/snippet}

<header class="mb-3 flex flex-wrap items-end justify-between gap-3">
	<PageTitle title="Impôt sur le revenu" />
	<div class="flex flex-wrap items-center gap-2 text-[12px]">
		<div class="flex overflow-hidden rounded-md border" style="border-color: var(--border);" role="group" aria-label="Année de revenus">
			{#each v.years as yr, i (yr)}
				<button type="button" class="px-2.5 py-1 {i ? 'border-l' : ''} {v.year === yr ? 'font-medium' : 'text-secondary'}" style="border-color: var(--border);{v.year === yr ? ' background-color: var(--surface-2);' : ''}" aria-pressed={v.year === yr} title={yr < v.years[1]! ? `Revenus ${yr} : déclarés en mai ${yr + 1}, régularisés en septembre ${yr + 1}` : `Revenus ${yr} : en cours, régularisés en septembre ${yr + 1}`} onclick={() => set({ year: yr })}>Revenus {yr}</button>
			{/each}
		</div>
		{#if v.compare}
			<div class="flex overflow-hidden rounded-md border" style="border-color: var(--border);" role="group" aria-label="Barème utilisé">
				<button type="button" class="px-2.5 py-1 {v.compare.used === 'bill' ? 'font-medium' : 'text-secondary'}" style={v.compare.used === 'bill' ? 'background-color: var(--surface-2);' : ''} aria-pressed={v.compare.used === 'bill'} title="Tranches relevées de 2,1 % : ce qui s'appliquera si le projet est voté tel quel (fin décembre)" onclick={() => set({ scale: 'bill' })}>Projet de loi {v.year + 1} · {formatEUR(v.compare.bill.netTax)}</button>
				<button type="button" class="border-l px-2.5 py-1 {v.compare.used === 'current' ? 'font-medium' : 'text-secondary'}" style="border-color: var(--border);{v.compare.used === 'current' ? ' background-color: var(--surface-2);' : ''}" aria-pressed={v.compare.used === 'current'} title="Tranches en vigueur aujourd'hui ({v.compare.current.rules.source}) : ce qui s'appliquerait si le projet n'était pas voté à temps" onclick={() => set({ scale: 'current' })}>Loi actuelle · {formatEUR(v.compare.current.netTax)}</button>
			</div>
		{:else}
			<span class="chip {!v.rules.exact ? 'chip-amber' : 'chip-muted'}" title="Barème utilisé">
				Revenus {v.year} · {v.rules.exact ? v.rules.source : `barème ${v.rules.incomeYear} (année ${v.year} pas encore connue)`}
			</span>
		{/if}
	</div>
</header>
{#if v.warning}
	<div class="mb-3 border-l-4 pl-3 text-[13px]" role="alert" style="border-left-color: var(--amber);">
		<p class="font-medium" style="color: var(--amber);">⚠ Barème à mettre à jour</p>
		<p class="meta-xs mt-0.5">{v.warning} Demande à Claude : « mets à jour le barème de l’impôt » (fichier src/lib/incomeTaxRules.ts).</p>
	</div>
{/if}
<p class="meta-xs mb-3">
	{#if v.past}Revenus {v.year} : année terminée, {todayIso >= `${v.year + 1}-06-01` ? 'déclarés' : 'à déclarer'} en mai {v.year + 1}.{:else}Estimation à partir de tes fiches de paie (mois lus, puis projetés jusqu’en décembre au niveau de la dernière) et de tes virements de salaire.{/if}{#if v.auto} Année choisie automatiquement.{/if} Payé par le prélèvement à la source ; l’écart se régularise en septembre {v.year + 1}.
	{#if v.compare}Le barème {v.year} sera fixé par la loi de finances pour {v.year + 1}, votée fin décembre : en attendant, compare le projet (tranches + 2,1 %) et la loi actuelle (tranches de {v.compare.current.rules.source}).{/if}
</p>

<div class="grid grid-cols-[minmax(0,1fr)] gap-3 xl:grid-cols-3">
	<section class="card p-4 text-[12px]" aria-label="Revenus imposables">
		<h2 class="label-xs mb-2">Revenus imposables {v.year}</h2>
		<table class="w-full">
			<thead>
				<tr class="meta-xs text-left"><th class="font-normal">Mois</th><th class="text-right font-normal">Net imposable</th><th class="text-right font-normal">Taux</th><th class="text-right font-normal">Prélevé</th></tr>
			</thead>
			<tbody class="tabular">
				{#if v.before.taxable > 0 || v.months.length === 0}
					<tr class="border-t" style="border-color: var(--border-subtle);" title={v.before.estimated ? `Estimé : ${eur0(v.before.credits)} de virements « Salaire » sur ${v.before.months} mois, divisés par (1 − ${pct(v.before.rate)})` : 'Saisi'}>
						<td class="py-1">{v.months.length ? `Avant ${monthLabel(v.months[0]!.month)}` : `Salaires ${v.year}`} {#if v.before.estimated}<span class="meta-xs">estimé{v.before.rate === 0 && v.before.taxable > 0 ? ', taux à saisir' : ''}</span>{/if}</td>
						<td class="text-right">{formatEUR(v.before.taxable)}</td>
						<td class="text-right">{pct(v.before.rate)}</td>
						<td class="text-right">{formatEUR(v.before.withheld)}</td>
					</tr>
				{/if}
				{#if v.benefits.taxable > 0}
					<tr class="border-t" style="border-color: var(--border-subtle);" title={[v.benefits.statements.length ? `Lu sur ${v.benefits.statements.length} relevé${v.benefits.statements.length > 1 ? 's' : ''} (${v.benefits.statements.map(monthLabel).join(', ')}) : base du prélèvement à la source` : '', v.benefits.estimated ? `Estimé : ${eur0(v.benefits.credits)} de virements France Travail sans relevé sur ${v.benefits.months} mois, divisés par (1 − ${pct(v.before.rate)})` : '', y.benefits !== null ? 'Saisi (attestation fiscale France Travail)' : ''].filter(Boolean).join(' · ')}>
						<td class="py-1">Allocations France Travail <span class="meta-xs">{y.benefits !== null ? 'saisi' : [v.benefits.statements.length ? `${v.benefits.statements.length} relevé${v.benefits.statements.length > 1 ? 's' : ''}` : '', v.benefits.estimated ? 'estimé' : ''].filter(Boolean).join(' + ')}</span></td>
						<td class="text-right">{formatEUR(v.benefits.taxable)}</td>
						<td class="text-right">{pct(v.before.rate)}</td>
						<td class="text-right">{formatEUR(v.benefits.withheld)}</td>
					</tr>
				{/if}
				{#each v.months as m (m.month)}
					<tr class="border-t {m.projected || m.missing ? 'text-secondary italic' : ''}" style="border-color: var(--border-subtle);" title={m.projected ? 'Projeté au niveau de la dernière fiche de paie' : m.missing ? 'Fiche de paie absente : estimé comme le mois d’avant' : 'Lu sur la fiche de paie'}>
						<td class="py-1">{monthLabel(m.month)}{#if m.projected} <span class="meta-xs not-italic">projeté</span>{:else if m.missing} <span class="meta-xs not-italic">fiche manquante</span>{/if}</td>
						<td class="text-right">{formatEUR(m.taxable)}</td>
						<td class="text-right">{pct(m.rate)}</td>
						<td class="text-right">{formatEUR(m.withheld)}</td>
					</tr>
				{/each}
				<tr class="border-t font-medium" style="border-color: var(--border);">
					<td class="py-1">Total</td>
					<td class="text-right">{formatEUR(v.before.taxable + v.benefits.taxable + v.portageTaxable)}</td>
					<td></td>
					<td class="text-right">{formatEUR(v.reg.withheldSoFar + v.reg.withheldToCome - (s.couple ? y.partnerWithheld : 0))}</td>
				</tr>
			</tbody>
		</table>

		<div class="mt-3 flex flex-wrap items-center gap-2">
			<button type="button" class="btn btn-secondary btn-sm" onclick={() => ftInput?.click()}>Importer des relevés France Travail (PDF)</button>
			<input bind:this={ftInput} type="file" accept=".pdf,application/pdf" multiple class="hidden" aria-label="Relevés France Travail (PDF)" onchange={(e) => { void importFiles((e.target as HTMLInputElement).files); (e.target as HTMLInputElement).value = ''; }} />
			<span class="meta-xs">ou glisse-les n'importe où dans l'app</span>
		</div>

		<h3 class="label-plain mt-4 mb-1.5">À compléter <span class="meta-xs normal-case">(vide = lu dans tes données)</span></h3>
		<div class="grid grid-cols-1 gap-y-1">
			{@render field('Net imposable avant', y.before, String(v.before.taxable), (n) => setY({ before: n }), 'Cumul net imposable de ta dernière fiche de paie chez l’ancien employeur (vide = estimé depuis tes virements de salaire)')}
			{@render field('Taux prélevé avant (%)', y.beforeRate, String(v.before.rate).replace('.', ','), (n) => setY({ beforeRate: n }), 'Taux de prélèvement à la source appliqué avant (vide = taux de ta première fiche de l’année)', 'w-16')}
			{@render field('Allocations chômage', y.benefits, String(v.benefits.taxable), (n) => setY({ benefits: n }), 'Net imposable de l’année sur l’attestation fiscale France Travail (espace personnel › Mes attestations) ; vide = estimé depuis tes virements France Travail')}
			{@render field('Autres revenus imposables', y.otherIncome || null, '0', (n) => setY({ otherIncome: n ?? 0 }), 'Revenus nets imposés au barème (fonciers, pensions…) ; les plus-values crypto sont imposées à part (voir Patrimoine)')}
			{@render field('Frais réels', y.actualExpenses, `10 % = ${eur0(r.deduction)}`, (n) => setY({ actualExpenses: n }), 'Vide = abattement forfaitaire de 10 % (les notes de frais du portage ne sont déjà pas imposées)')}
			{@render field('Réductions et crédits', y.reductions || null, '0', (n) => setY({ reductions: n ?? 0 }), 'Dons, emploi à domicile, garde d’enfant… (montant de la réduction, pas de la dépense)')}
			{@render field('Enfants à charge', s.children || null, '0', (n) => set({ children: Math.round(n ?? 0) }), 'Parts du quotient familial', 'w-12')}
			<label class="flex items-center justify-between gap-2">
				<span class="text-secondary">Imposition</span>
				<select class="input-surface w-28 cursor-pointer !py-0.5 text-xs" value={s.couple ? 'couple' : 'seul'} onchange={(e) => set({ couple: (e.target as HTMLSelectElement).value === 'couple' })} aria-label="Imposition">
					<option value="seul">Seul</option>
					<option value="couple">Couple (marié, pacsé)</option>
				</select>
			</label>
			{#if s.couple}
				{@render field('Salaire du conjoint', y.partnerSalary || null, '0', (n) => setY({ partnerSalary: n ?? 0 }), 'Net imposable de l’année du conjoint')}
				{@render field('Prélevé chez le conjoint', y.partnerWithheld || null, '0', (n) => setY({ partnerWithheld: n ?? 0 }), 'Prélèvement à la source sur le salaire du conjoint pour l’année')}
			{/if}
		</div>
	</section>

	<section class="card p-4 text-[12px]" aria-label="Calcul de l'impôt">
		<h2 class="label-xs mb-2">Calcul</h2>
		<dl class="tabular grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1">
			<dt>Salaires et allocations imposables</dt><dd class="text-right">{formatEUR(r.grossSalaries)}</dd>
			<dt class="text-secondary">− {y.actualExpenses === null ? 'abattement de 10 %' : 'frais réels'}</dt><dd class="text-right text-secondary">−{formatEUR(r.deduction)}</dd>
			{#if y.otherIncome > 0}<dt class="text-secondary">+ autres revenus</dt><dd class="text-right text-secondary">+{formatEUR(y.otherIncome)}</dd>{/if}
			<dt class="font-medium">Revenu net imposable</dt><dd class="text-right font-medium">{formatEUR(r.netIncome)}</dd>
			<dt class="text-secondary">÷ {r.parts.toLocaleString('fr-FR')} part{r.parts > 1 ? 's' : ''}</dt><dd class="text-right text-secondary">{formatEUR(r.quotient)} par part</dd>
		</dl>
		<table class="tabular mt-2 w-full">
			<tbody>
				{#each lines as b (b.from)}
					<tr class="border-t" style="border-color: var(--border-subtle);">
						<td class="py-0.5 text-secondary">{eur0(b.from)} → {b.to === null ? '…' : eur0(b.to)}</td>
						<td class="text-right text-secondary">{b.rate} %</td>
						<td class="text-right">{formatEUR(Math.round(b.tax * r.parts))}</td>
					</tr>
				{/each}
			</tbody>
		</table>
		<dl class="tabular mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1">
			<dt>Impôt selon le barème</dt><dd class="text-right">{formatEUR(r.taxWithParts)}</dd>
			{#if r.capped}<dt class="text-secondary">plafonnement du quotient familial</dt><dd class="text-right text-secondary">{formatEUR(r.grossTax)}</dd>{/if}
			{#if r.decote > 0}<dt class="text-secondary">− décote</dt><dd class="text-right text-secondary">−{formatEUR(r.decote)}</dd>{/if}
			{#if r.reductions > 0}<dt class="text-secondary">− réductions et crédits</dt><dd class="text-right text-secondary">−{formatEUR(r.reductions)}</dd>{/if}
			<dt class="border-t pt-1 font-medium" style="border-color: var(--border);">Impôt estimé {v.year}</dt><dd class="border-t pt-1 text-right font-medium" style="border-color: var(--border);">{formatEUR(r.netTax)}</dd>
			<dt class="text-secondary">Tranche marginale · taux moyen</dt><dd class="text-right text-secondary">{r.marginalRate} % · {pct(r.averageRate)}</dd>
			{#if v.compare}<dt class="text-secondary">Avec {v.compare.used === 'bill' ? 'la loi actuelle' : 'le projet de loi'}</dt><dd class="text-right text-secondary">{formatEUR(otherTax!)} ({otherTax! - r.netTax >= 0 ? '+' : '−'}{eur0(Math.abs(otherTax! - r.netTax))})</dd>{/if}
			{#if v.lastYear}<dt class="text-secondary">Avis {v.lastYear.year} (pour comparer)</dt><dd class="text-right text-secondary">{formatEUR(v.lastYear.incomeTax)}</dd>{/if}
		</dl>
		{#if r.netTax === 0 && r.grossTax > 0}<p class="meta-xs mt-2">Sous 61 €, l’impôt n’est pas recouvré.</p>{/if}
	</section>

	<section class="card p-4 text-[12px]" aria-label="Prélèvement à la source">
		<h2 class="label-xs mb-2">Prélèvement à la source</h2>
		<dl class="tabular grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1">
			<dt>Déjà prélevé</dt><dd class="text-right">{formatEUR(v.reg.withheldSoFar)}</dd>
			{#if v.reg.withheldToCome > 0}<dt class="text-secondary">Encore prélevé d’ici décembre (taux actuel)</dt><dd class="text-right text-secondary">{formatEUR(v.reg.withheldToCome)}</dd>{/if}
			<dt>Impôt estimé</dt><dd class="text-right">{formatEUR(r.netTax)}</dd>
			{#if v.notice}<dt class="font-medium">Avis d’impôt {v.year} reçu</dt><dd class="text-right font-medium">{formatEUR(v.notice.incomeTax)}{#if v.notice.remaining !== undefined} · reste {formatEUR(v.notice.remaining)}{/if}</dd>{/if}
		</dl>
		<div class="mt-3 rounded-md p-3" style="background-color: var(--surface-2);">
			{#if started}
				<p class="text-[13px]">Régularisation {v.year} déjà lancée (septembre {v.year + 1}){v.reg.balance > 0 ? ` : ≈ ${eur0(v.reg.balance)} selon cette estimation` : ''}.</p>
				<p class="meta-xs mt-1">{v.notice ? 'Le montant exact est sur ton avis ci-dessus.' : 'Le montant exact est sur ton avis d’impôt : importe-le dans Patrimoine › Impôts pour comparer.'}</p>
			{:else if v.reg.balance > 0}
				<p class="text-[13px]"><b class="tabular" style="color: var(--amber);">{formatEUR(v.reg.balance)}</b> à payer en septembre {v.year + 1}</p>
				<p class="meta-xs mt-1">{v.reg.instalments === 4 ? `Prélevés en 4 fois, de septembre à décembre ${v.year + 1} (≈ ${eur0(v.reg.balance / 4)} par mois).` : `Prélevés en une fois fin septembre ${v.year + 1}.`} Pense à le mettre de côté d’ici là.</p>
			{:else if v.reg.balance < 0}
				<p class="text-[13px]"><b class="tabular" style="color: var(--accent);">{formatEUR(-v.reg.balance)}</b> remboursés à l’été {v.year + 1}</p>
				<p class="meta-xs mt-1">Ton taux actuel prélève un peu plus que l’impôt estimé.</p>
			{:else}
				<p class="text-[13px]">Prélèvements et impôt estimé s’équilibrent.</p>
			{/if}
		</div>
		{#if !started && v.reg.rateToAvoid !== null && v.reg.balance > 0}
			<p class="mt-3">
				Pour l’éviter : taux de <b class="tabular">{pct(v.reg.rateToAvoid)}</b> sur les {v.months.filter((m) => m.projected).length} mois restants{avoidHint !== null ? ` (au lieu de ${pct(avoidHint)})` : ''}.
			</p>
			<p class="meta-xs mt-1">Sur impots.gouv.fr › Gérer mon prélèvement à la source › Actualiser suite à une hausse de revenus. Le nouveau taux s’applique sous 1 à 2 mois.</p>
		{/if}
		<p class="meta-xs mt-3">Les plus-values crypto (flat tax) sont estimées à part dans <button type="button" class="cursor-pointer underline" onclick={() => navigate('/patrimoine')}>Patrimoine</button>. Estimation indicative : la déclaration de mai {v.year + 1} fait foi.</p>
	</section>
</div>
