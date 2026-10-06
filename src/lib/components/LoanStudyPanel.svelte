<script lang="ts">
	import { formatEUR, formatEURCompact } from '$lib/sensitiveFormat';
	import { analyzeLoan, bankStudy, capacityTable, CAPACITY_DURATIONS, maxLoanAmount, suggestInsuranceRate, type JobType, type LoanAnalysis, type Status, type Verdict, type Weight } from '$lib/loanStudy';
	import { USURY } from '$lib/lendingRules';
	import type { StudyDefaults } from '$lib/whatIf.svelte';
	import type { StudySettings } from '$lib/whatIf';

	/**
	 * Loan study of the scenario: real cost of each new loan with and without insurance, the bank's
	 * checklist with a qualitative verdict, the household inputs (prefilled from the app, editable,
	 * never written back), and the borrowing capacity over several durations.
	 */
	let { loans, study, defaults, oneOff, today, onChange }: { loans: LoanAnalysis[]; study: StudySettings; defaults: StudyDefaults; oneOff: number; today: string; onChange: (patch: Partial<StudySettings>) => void } = $props();

	const VERDICT: Record<Verdict, { label: string; color: string }> = {
		high: { label: 'Élevées', color: 'var(--accent)' },
		medium: { label: 'Moyennes', color: 'var(--amber)' },
		low: { label: 'Faibles', color: 'var(--debit)' },
		'very-low': { label: 'Très faibles', color: 'var(--debit)' }
	};
	const ICON: Record<Status, { mark: string; color: string; label: string }> = {
		pass: { mark: '✓', color: 'var(--accent)', label: 'favorable' },
		warn: { mark: '!', color: 'var(--amber)', label: 'à surveiller' },
		fail: { mark: '✕', color: 'var(--debit)', label: 'non tenu' }
	};
	const WEIGHT: Record<Weight, string> = { blocking: 'bloquant', major: 'important', minor: 'secondaire', info: 'info' };
	const JOBS: { id: JobType; label: string }[] = [
		{ id: 'cdi', label: 'CDI' },
		{ id: 'portage', label: 'Portage salarial' },
		{ id: 'cdd', label: 'CDD / indépendant' }
	];

	const existingAuto = $derived(Math.round(defaults.existing.reduce((s, l) => s + l.amount, 0) * 100) / 100);
	const input = $derived({
		incomes: { salary: study.salary ?? defaults.salary, variable: study.variable, rental: study.rental, alimony: study.alimony },
		adults: study.adults,
		children: study.children,
		existingPayments: study.existing ?? existingAuto,
		rent: study.rent ?? defaults.rent,
		job: study.job ?? defaults.job,
		seniorityMonths: study.seniority ?? defaults.seniority,
		age: study.age,
		savings: defaults.savings,
		monthlySpending: defaults.monthlySpending,
		employeeSavings: defaults.employeeSavings,
		oneOff,
		today
	});
	const result = $derived(bankStudy(input, loans));
	const bare = $derived(loans.map((l) => analyzeLoan(l.loan, today, false)));
	const insured = $derived(
		loans.map((l) => {
			if (l.loan.insurance.mode !== 'none') return l;
			const mode = l.loan.kind === 'mortgage' ? 'crd' : 'initial';
			return analyzeLoan({ ...l.loan, insurance: { mode, rate: suggestInsuranceRate(l.loan.kind, mode, study.age) } }, today);
		})
	);
	const main = $derived(loans.find((l) => l.loan.kind === 'mortgage') ?? loans[0]!);
	const capacity = $derived(capacityTable(main.loan, CAPACITY_DURATIONS[main.loan.kind], today, { income: result.income, existingPayments: input.existingPayments, maxMonthly: result.maxMonthly }));
	const maxAmount = $derived(maxLoanAmount(result.maxMonthly, main.loan.rate, main.loan.months, main.loan.insurance.rate));

	const parse = (v: string): number | null => {
		const n = Number(v.replace(/[\s  €%]/g, '').replace(',', '.'));
		return v.trim() === '' || !Number.isFinite(n) ? null : n;
	};
	const pct = (n: number) => (Number.isFinite(n) ? `${n.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %` : '—');
	const pct2 = (n: number) => `${n.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} %`;
	const duration = (m: number) => (m % 12 === 0 && m >= 120 ? `${m / 12} ans` : `${m} mois`);
	const costRows = (a: LoanAnalysis) => [
		{ label: 'Mensualité hors assurance', v: a.payment },
		{ label: 'Assurance / mois', v: a.insuranceFirst, note: a.loan.insurance.mode === 'crd' && a.withInsurance ? `moyenne ${formatEUR(a.insuranceAvg)}` : '' },
		{ label: 'Total par mois', v: a.totalMonthly, strong: true },
		{ label: 'Intérêts', v: a.totalInterest },
		{ label: 'Assurance (total)', v: a.totalInsurance },
		{ label: 'Frais (dossier, garantie, courtage)', v: a.fees },
		{ label: 'Coût total du crédit', v: a.totalCost, strong: true }
	];
</script>

{#snippet field(label: string, value: number | null, placeholder: number | string, set: (v: number | null) => void, title = '', width = 'w-20')}
	<label class="flex items-center justify-between gap-2" {title}>
		<span class="text-secondary">{label}</span>
		<input type="text" inputmode="decimal" class="input-surface tabular {width} !px-1.5 !py-0.5 text-right text-xs" placeholder={String(placeholder).replace('.', ',')} value={value === null ? '' : String(value).replace('.', ',')} aria-label={label} onchange={(e) => set(parse((e.target as HTMLInputElement).value))} />
	</label>
{/snippet}

<section class="card p-4" aria-label="Étude du crédit">
	<div class="mb-3 flex flex-wrap items-baseline justify-between gap-2">
		<h2 class="label-xs">Étude du crédit</h2>
		<p class="meta-xs">Indicatif : chaque banque a sa grille. Taux d'usure {USURY.quarter}, taux du marché d'octobre 2026.</p>
	</div>
	<div class="grid grid-cols-[minmax(0,1fr)] gap-x-6 gap-y-4 xl:grid-cols-3">
		<div class="min-w-0">
			<h3 class="label-plain mb-1.5">Coût réel</h3>
			{#each insured as a, i (a.loan.id)}
				{@const chosen = loans[i]!.loan.insurance.mode !== 'none'}
				<table class="mb-2 w-full text-[12px]">
					<thead>
						<tr class="meta-xs">
							<th class="pb-1 text-left font-normal">{a.loan.label || 'Crédit'} · {formatEURCompact(a.loan.principal)} sur {duration(a.loan.months)} à {pct2(a.loan.rate)}</th>
							<th class="pb-1 pl-2 text-right font-normal" class:font-semibold={!chosen}>Sans assurance</th>
							<th class="pb-1 pl-2 text-right font-normal" class:font-semibold={chosen} title={chosen ? 'Assurance choisie' : 'Assurance au taux habituel pour ton âge'}>Avec{chosen ? '' : ' (suggérée)'} · {pct2(a.loan.insurance.rate)}</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-[var(--border-subtle)]">
						{#each costRows(a) as r, k (r.label)}
							{@const b = costRows(bare[i]!)[k]!}
							<tr class:font-medium={r.strong}>
								<td class="py-0.5">{r.label}{#if r.note}<span class="meta-xs"> · {r.note}</span>{/if}</td>
								<td class="tabular py-0.5 pl-2 text-right text-secondary">{formatEUR(b.v)}</td>
								<td class="tabular py-0.5 pl-2 text-right">{formatEUR(r.v)}</td>
							</tr>
						{/each}
						<tr>
							<td class="py-0.5">TAEG{#if !a.insuranceInTaeg}<span class="meta-xs"> · assurance facultative non comprise</span>{/if}</td>
							<td class="tabular py-0.5 pl-2 text-right text-secondary">{pct2(bare[i]!.taeg)}</td>
							<td class="tabular py-0.5 pl-2 text-right">{pct2(a.taeg)}</td>
						</tr>
					</tbody>
				</table>
				<p class="meta-xs mb-3">
					Usure {pct2(a.usury.ceiling)} ({a.usury.category}) : <span style="color: {a.usury.ok ? 'var(--accent)' : 'var(--debit)'};">{a.usury.ok ? 'respecté' : 'dépassé, la banque ne peut pas prêter'}</span>{#if a.usury.stale} · table à mettre à jour{/if}.
					Marché ≈ {pct2(a.market.central)} ({a.market.low.toLocaleString('fr-FR')}–{pct2(a.market.high)}){#if a.loan.rate > a.market.high}<span style="color: var(--amber);"> : ton taux est au-dessus, à renégocier ou comparer</span>{:else if a.loan.rate < a.market.low}<span> : sous le marché, à confirmer avec la banque</span>{/if}.
					{#if a.loan.kind !== 'mortgage'}Assurance facultative pour un crédit {a.loan.kind === 'car' ? 'auto' : 'perso'}.{:else}Assurance exigée en pratique ; changeable à tout moment (loi Lemoine).{/if}
				</p>
			{/each}
		</div>

		<div class="min-w-0">
			<div class="mb-2 flex items-baseline justify-between gap-2">
				<h3 class="label-plain">Chances d'acceptation</h3>
				<span class="text-[13px] font-medium" style="color: {VERDICT[result.verdict].color};">{VERDICT[result.verdict].label}</span>
			</div>
			<p class="meta-xs mb-2">
				Endettement (crédits) <span class="tabular">{pct(result.debtBefore)}</span> → <b class="tabular">{pct(result.debtAfter)}</b> (max 35 %){#if result.rentKept} · avec le loyer <span class="tabular">{pct(result.effortWithRent)}</span>{/if} · reste à vivre <span class="tabular">{formatEUR(result.remainingIncome)}</span>
			</p>
			<p class="meta-xs mb-2">Un critère bloquant non tenu suffit à faire refuser ; chaque point important à surveiller baisse le niveau d'un cran, deux points secondaires aussi ; deux atouts compensent un point important à surveiller.</p>
			{#if result.strengths.length}
				<p class="mb-2 text-[12px]"><span class="font-medium" style="color: var(--accent);">Atouts</span> <span class="text-secondary">{result.strengths.join(' · ')}{result.offset ? ` : compensent ${result.offset > 1 ? `${result.offset} points` : 'un point'} à surveiller.` : '.'}</span></p>
			{/if}
			<ul class="space-y-1.5 text-[12px]">
				{#each result.criteria as c, i (c.id + i)}
					<li class="flex gap-2">
						<span class="w-3 shrink-0 text-center font-semibold" style="color: {ICON[c.status].color};" aria-label={ICON[c.status].label} title={ICON[c.status].label}>{ICON[c.status].mark}</span>
						<span class="min-w-0"><span class="font-medium">{c.label}</span> <span class="meta-xs">{WEIGHT[c.weight]}</span> <span class="text-secondary">{c.reason}</span></span>
					</li>
				{/each}
			</ul>
		</div>

		<div class="min-w-0 text-[12px]">
			<h3 class="label-plain mb-1.5">Ta situation <span class="meta-xs normal-case">(vide = lu dans tes données)</span></h3>
			<div class="grid grid-cols-2 gap-x-4 gap-y-1">
				{@render field('Salaire net avant impôt', study.salary, defaults.salary, (v) => onChange({ salary: v }), `€/mois, compté à 100 % ; vide = ${defaults.salarySource}`)}
				{@render field('Variable (moy. 3 ans)', study.variable || null, 0, (v) => onChange({ variable: v ?? 0 }), '€/mois, compté à 70 %')}
				{@render field('Revenus locatifs nets', study.rental || null, 0, (v) => onChange({ rental: v ?? 0 }), '€/mois, comptés à 70 %')}
				{@render field('Pension (jugement)', study.alimony || null, 0, (v) => onChange({ alimony: v ?? 0 }), '€/mois, comptée à 100 % avec un jugement')}
				{@render field('Crédits en cours', study.existing, existingAuto, (v) => onChange({ existing: v }), defaults.existing.length ? defaults.existing.map((l) => `${l.label} : ${l.amount} €`).join(' · ') : 'aucun crédit trouvé dans tes comptes')}
				{@render field('Loyer actuel', study.rent, defaults.rent, (v) => onChange({ rent: v }), '€/mois ; vide = moyenne « Loyer & charges » des 3 derniers mois')}
				{@render field('Âge', study.age, 35, (v) => onChange({ age: v ?? 35 }), 'Taux d’assurance suggéré et règle Lemoine (fin avant 60 ans)', 'w-12')}
				{@render field('Adultes', study.adults, 1, (v) => onChange({ adults: Math.max(1, v ?? 1) }), 'Reste à vivre : ≈ 800 € seul, 1 300 € en couple', 'w-12')}
				{@render field('Enfants', study.children || null, 0, (v) => onChange({ children: Math.max(0, v ?? 0) }), 'Reste à vivre : ≈ 350 € par enfant', 'w-12')}
				<label class="flex items-center justify-between gap-2">
					<span class="text-secondary">Emploi</span>
					<select class="input-surface w-28 min-w-0 cursor-pointer !py-0.5 text-xs" value={study.job ?? ''} onchange={(e) => onChange({ job: ((e.target as HTMLSelectElement).value || null) as JobType | null })} aria-label="Type d'emploi">
						<option value="">{JOBS.find((j) => j.id === defaults.job)!.label} (auto)</option>
						{#each JOBS as j (j.id)}<option value={j.id}>{j.label}</option>{/each}
					</select>
				</label>
				{@render field('Ancienneté (mois)', study.seniority, defaults.seniority, (v) => onChange({ seniority: v }), defaults.job === 'portage' ? 'Vide = mois depuis la première fiche de paie de portage' : 'Mois dans l’emploi actuel', 'w-12')}
			</div>
			<p class="meta-xs mt-1">Revenus comptés par la banque : <b class="tabular">{formatEUR(result.income)}</b>/mois{#if result.rentKept} · loyer gardé {formatEUR(result.rentKept)}{/if}</p>

			<h3 class="label-plain mt-3 mb-1">Capacité d'emprunt</h3>
			<p class="meta-xs">
				Mensualité max (35 %, assurance comprise) <b class="tabular">{formatEUR(result.maxMonthly)}</b> · montant max à {pct2(main.loan.rate)} sur {duration(main.loan.months)} <b class="tabular">{formatEURCompact(maxAmount)}</b>
			</p>
			<table class="mt-1 w-full">
				<thead>
					<tr class="meta-xs">
						<th class="pb-1 text-left font-normal">Durée</th>
						<th class="pb-1 pl-2 text-right font-normal">Par mois</th>
						<th class="pb-1 pl-2 text-right font-normal">Coût total</th>
						<th class="pb-1 pl-2 text-right font-normal">Endettement</th>
						<th class="pb-1 pl-2 text-right font-normal">Montant max</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-[var(--border-subtle)]">
					{#each capacity as row (row.months)}
						<tr class:font-medium={row.months === main.loan.months}>
							<td class="py-0.5">{duration(row.months)}</td>
							<td class="tabular py-0.5 pl-2 text-right">{formatEUR(row.monthly)}</td>
							<td class="tabular py-0.5 pl-2 text-right">{formatEURCompact(row.totalCost)}</td>
							<td class="tabular py-0.5 pl-2 text-right" style="color: {row.debtRatio <= 35 ? 'var(--text)' : row.debtRatio <= 40 ? 'var(--amber)' : 'var(--debit)'};">{pct(row.debtRatio)}</td>
							<td class="tabular py-0.5 pl-2 text-right">{formatEURCompact(row.maxAmount)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
			<p class="meta-xs mt-1">Même montant et même taux que « {main.loan.label || 'le crédit'} », assurance comprise.</p>
		</div>
	</div>
</section>
