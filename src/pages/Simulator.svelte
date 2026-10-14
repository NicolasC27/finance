<script lang="ts">
	import PageTitle from '$lib/components/PageTitle.svelte';
	import { formatEUR, formatEURCompact } from '$lib/sensitiveFormat';
	import { goalsState } from '$lib/goals.svelte';
	import { getBudgetAverages } from '$lib/projectionBase.svelte';
	import { getBaseline, getStudyDefaults, profileState, removeScenario, saveScenario, scenariosState, setProfile } from '$lib/whatIf.svelte';
	import { goalReach, simulate, type Change, type ChangeType, type Scenario, type StudySettings } from '$lib/whatIf';
	import LoanRowEditor from '$lib/components/LoanRowEditor.svelte';
	import LoanStudyPanel from '$lib/components/LoanStudyPanel.svelte';
	import { showSuccess } from '$lib/ui.svelte';
	import { tripActuals, tripsState } from '$lib/trips.svelte';
	import { monthsUntil } from '$lib/tripEstimates';
	import { plannedTotal } from '$lib/trips';
	import { pageSnapshot } from '$lib/router.svelte';

	/**
	 * What-if simulator: a scenario of monthly and one-off changes edited on the left, compared side
	 * by side with today's situation (monthly budget, savings rate, net worth at 5 / 10 / 20 years,
	 * savings goals) and on a 20-year chart; new loans get a full study (real cost, bank acceptance,
	 * borrowing capacity). A one-off change can be dated (in N months); each coming trip with a
	 * budget is offered as an example. Only saved scenarios are stored; the real data never changes.
	 */

	const TYPES: { id: ChangeType; label: string; hint: string }[] = [
		{ id: 'income', label: 'Revenu', hint: '€/mois en plus (négatif = baisse)' },
		{ id: 'expense', label: 'Dépense', hint: '€/mois en plus (négatif = en moins)' },
		{ id: 'loan', label: 'Crédit', hint: 'montant emprunté' },
		{ id: 'oneoff', label: 'Ponctuel', hint: '€ dépensés une fois (négatif = reçus)' }
	];
	const PRESETS: { label: string; changes: Omit<Change, 'id'>[] }[] = [
		{ label: 'Achat immobilier', changes: [{ type: 'loan', label: 'Prêt immobilier', amount: 0, kind: 'mortgage', price: 250000, downPayment: 25000, rate: 3.4, months: 240, insurance: { mode: 'crd', rate: null }, replacesRent: true, mainResidence: true, firstTime: true }, { type: 'expense', label: 'Taxe foncière et charges', amount: 150 }] },
		{ label: 'Voiture à crédit', changes: [{ type: 'loan', label: 'Crédit auto', amount: 20000, kind: 'car', rate: 4.2, months: 60, insurance: { mode: 'none', rate: null } }, { type: 'expense', label: 'Assurance et entretien', amount: 90 }] },
		{ label: 'Déménagement', changes: [{ type: 'expense', label: 'Loyer en plus', amount: 250 }, { type: 'oneoff', label: 'Frais de déménagement', amount: 1500 }] },
		{ label: 'Baisse de revenu', changes: [{ type: 'income', label: 'Revenu en moins', amount: -300 }] },
		{ label: 'Abonnement', changes: [{ type: 'expense', label: 'Nouvel abonnement', amount: 15 }] }
	];
	const SHORT_MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
	const YEARS = 20;
	const now = new Date();

	const newId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2));
	const blank = (): Scenario => ({ id: newId(), name: '', changes: [] });

	let draft = $state<Scenario>(blank());
	const saved = $derived(scenariosState.list.find((s) => s.id === draft.id) ?? null);
	const dirty = $derived(!saved || JSON.stringify(saved) !== JSON.stringify($state.snapshot(draft)));

	const base = $derived(getBaseline());
	const months = $derived(getBudgetAverages().months);
	const todayIso = new Date().toISOString().slice(0, 10);
	/** The trips to come with a budget: what is still to pay, spent at the departure. */
	const tripPresets = $derived(
		tripsState.trips
			.filter((t) => t.start > todayIso && plannedTotal(t) > 0)
			.map((t) => {
				const spent = Object.values(tripActuals(t)).reduce((s, v) => s + v, 0);
				return { label: `Voyage : ${t.name}`, changes: [{ type: 'oneoff' as const, label: `Voyage ${t.name}`, amount: Math.max(0, Math.round((plannedTotal(t) - spent) * 100) / 100), month: monthsUntil(todayIso, t.start) }] };
			})
	);
	const defaults = $derived(getStudyDefaults());
	const study = $derived(profileState.study);
	const today = $derived(simulate(base, [], YEARS * 12));
	const withScenario = $derived(simulate(base, draft.changes, YEARS * 12, { age: study.age, rent: study.rent ?? defaults.rent, today: todayIso }));

	function setStudy(patch: Partial<StudySettings>) {
		setProfile(patch);
	}

	function add(type: ChangeType) {
		draft.changes.push({ id: newId(), type, label: '', amount: type === 'loan' ? 10000 : 0, ...(type === 'loan' ? { kind: 'personal' as const, rate: 5, months: 48, insurance: { mode: 'none' as const, rate: null } } : {}) });
	}
	function applyPreset(p: (typeof PRESETS)[number]) {
		draft.changes.push(...p.changes.map((c) => ({ ...c, id: newId() })));
		if (!draft.name) draft.name = p.label;
	}
	function remove(id: string) {
		draft.changes = draft.changes.filter((c) => c.id !== id);
	}
	function save() {
		if (!draft.name.trim()) draft.name = `Scénario ${scenariosState.list.length + 1}`;
		saveScenario($state.snapshot(draft));
		showSuccess('Scénario enregistré');
	}
	function load(s: Scenario) {
		draft = JSON.parse(JSON.stringify(s));
	}
	function drop() {
		removeScenario(draft.id);
		draft = blank();
	}

	/** Back, Forward and a reload reopen the saved scenario on screen (unsaved edits are not kept). */
	pageSnapshot(
		'simulator',
		() => ({ scenario: saved?.id ?? null }),
		(snap) => {
			const s = scenariosState.list.find((x) => x.id === snap.scenario);
			if (s) load(s);
		}
	);

	function dateIn(m: number): string {
		const d = new Date(now.getFullYear(), now.getMonth() + m, 15);
		return `${SHORT_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
	}
	const money = (n: number, compact = false) => (compact ? formatEURCompact(n) : formatEUR(n));
	const signed = (n: number, compact = false) => (n > 0 ? `+${money(n, compact)}` : money(n, compact));
	const pct = (n: number | null) => (n === null ? '—' : `${n.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`);

	const rows = $derived([
		{ label: 'Revenus / mois', a: today.income, b: withScenario.income, good: 1, compact: false },
		{ label: 'Dépenses / mois', a: today.expenses, b: withScenario.expenses, good: -1, compact: false },
		{ label: 'Nouvelles mensualités', a: 0, b: withScenario.loanPayments, good: -1, compact: false },
		...(withScenario.rentSaved ? [{ label: 'Loyer qui disparaît', a: 0, b: withScenario.rentSaved, good: 1, compact: false }] : []),
		{ label: 'Épargne / mois', a: today.savings, b: withScenario.savings, good: 1, compact: false, strong: true },
		...[5, 10, 20].map((y) => ({ label: `Patrimoine dans ${y} ans`, a: today.path[y * 12]!, b: withScenario.path[y * 12]!, good: 1, compact: true }))
	]);

	const goals = $derived(
		goalsState.goals
			.filter((g) => g.targetAmount > g.currentAmount)
			.slice(0, 4)
			.map((g) => ({ g, a: goalReach(g.currentAmount, g.targetAmount, today.schedule, base.realRate), b: goalReach(g.currentAmount, g.targetAmount, withScenario.schedule, base.realRate) }))
	);

	// ---------- Chart (one point per year) ----------
	let width = $state(0);
	const H = 190;
	const PAD = { top: 10, right: 12, bottom: 20, left: 58 };
	let hover = $state<number | null>(null);
	const yearly = (path: number[]) => Array.from({ length: YEARS + 1 }, (_, y) => path[y * 12]!);
	const seriesA = $derived(yearly(today.path));
	const seriesB = $derived(yearly(withScenario.path));

	const geo = $derived.by(() => {
		if (width < 160) return null;
		const values = [...seriesA, ...seriesB];
		const min = Math.min(0, ...values);
		const max = Math.max(1, ...values);
		const iw = width - PAD.left - PAD.right;
		const ih = H - PAD.top - PAD.bottom;
		const x = (i: number) => PAD.left + (i / YEARS) * iw;
		const y = (v: number) => PAD.top + (1 - (v - min) / (max - min || 1)) * ih;
		const line = (s: number[]) => s.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
		const raw = (max - min) / 4;
		const p = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1))));
		const r = raw / p;
		const step = (r <= 1 ? 1 : r <= 2 ? 2 : r <= 5 ? 5 : 10) * p;
		const grid: number[] = [];
		for (let v = Math.ceil(min / step) * step; v <= max; v += step) grid.push(v);
		return { x, y, a: line(seriesA), b: line(seriesB), grid, zero: min < 0 ? y(0) : null };
	});

	function onMove(e: MouseEvent) {
		const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
		hover = Math.max(0, Math.min(YEARS, Math.round(((e.clientX - r.left - PAD.left) / (width - PAD.left - PAD.right)) * YEARS)));
	}
</script>

<header class="mb-3 flex flex-wrap items-end justify-between gap-3">
	<PageTitle title="Simulateur" />
	<div class="flex flex-wrap items-center gap-1.5" role="group" aria-label="Scénarios enregistrés">
		{#each scenariosState.list as s (s.id)}
			<button type="button" class="chip cursor-pointer {s.id === draft.id ? 'chip-accent' : 'chip-outline'}" aria-pressed={s.id === draft.id} onclick={() => load(s)}>{s.name}</button>
		{/each}
		<button type="button" class="btn btn-secondary btn-sm" onclick={() => (draft = blank())}>Nouveau scénario</button>
	</div>
</header>

<p class="meta-xs mb-3">
	Base : moyenne de {months} mois complets ({formatEUR(base.income)} de revenus, {formatEUR(base.expenses)} de dépenses), patrimoine {formatEUR(base.netWorth)}, rendement réel {base.realRate.toLocaleString('fr-FR')} %/an, en euros d'aujourd'hui. Une voiture ou un achat ponctuel est compté comme dépensé ; un logement acheté reste dans le patrimoine à son prix (seuls notaire et frais sont perdus). Rien n'est modifié dans tes données : seuls les scénarios enregistrés sont gardés.
</p>

<div class="grid grid-cols-[minmax(0,1fr)] items-start gap-3 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
	<section class="card p-4" aria-label="Scénario">
		<div class="flex items-center gap-1.5">
			<input type="text" class="input-surface min-w-0 flex-1" placeholder="Nom du scénario" maxlength="60" bind:value={draft.name} aria-label="Nom du scénario" />
			<button type="button" class="btn btn-primary btn-sm shrink-0" disabled={!dirty || !draft.changes.length} onclick={save}>{saved ? 'Mettre à jour' : 'Enregistrer'}</button>
			{#if saved}<button type="button" class="btn btn-secondary btn-sm shrink-0" onclick={drop} title="Supprimer ce scénario enregistré">Supprimer</button>{/if}
		</div>

		<div class="mt-2 flex flex-wrap items-center gap-1.5">
			<span class="meta-xs">Exemples :</span>
			{#each [...PRESETS, ...tripPresets] as p (p.label)}
				<button type="button" class="chip chip-outline cursor-pointer" onclick={() => applyPreset(p)}>{p.label}</button>
			{/each}
		</div>

		{#if draft.changes.length === 0}
			<p class="meta-xs mt-3">Ajoute un changement : revenu, dépense, crédit ou montant ponctuel.</p>
		{:else}
			<ul class="mt-3 space-y-2 text-[12px]">
				{#each draft.changes as c, i (c.id)}
					{@const t = TYPES.find((x) => x.id === c.type)!}
					<li class="rounded-md p-2" style="background-color: var(--surface-2);">
						<div class="flex items-center gap-1.5">
							<span class="chip chip-muted shrink-0">{t.label}</span>
							<input type="text" class="input-surface min-w-0 flex-1 !py-0.5 text-xs" placeholder="Libellé" maxlength="60" bind:value={c.label} aria-label="Libellé" />
							<button type="button" class="meta-xs shrink-0 cursor-pointer px-1 hover:text-[var(--text)]" onclick={() => remove(c.id)} aria-label="Retirer ce changement">×</button>
						</div>
						{#if c.type === 'loan'}
							<LoanRowEditor bind:change={draft.changes[i]!} analysis={withScenario.loans.find((x) => x.loan.id === c.id)} age={study.age} endLabel={dateIn} />
						{:else}
							<div class="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
								<label class="flex items-center gap-1" title={t.hint}>
									<input type="number" step="any" class="input-surface tabular w-24 !px-1.5 !py-0.5 text-right text-xs" bind:value={c.amount} aria-label="Montant ({t.hint})" />
									{c.type === 'income' || c.type === 'expense' ? '€/mois' : '€'}
								</label>
								{#if c.type === 'oneoff'}
									<label class="flex items-center gap-1" title="Dans combien de mois l’argent part (vide = maintenant)">
										dans <input type="number" min="0" max="240" class="input-surface tabular w-14 !px-1.5 !py-0.5 text-right text-xs" bind:value={c.month} aria-label="Dans combien de mois" /> mois
									</label>
								{/if}
							</div>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}

		<div class="mt-3 flex flex-wrap gap-1.5">
			{#each TYPES as t (t.id)}
				<button type="button" class="btn btn-secondary btn-sm" title={t.hint} onclick={() => add(t.id)}>+ {t.label}</button>
			{/each}
		</div>
	</section>

	<div class="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3">
		<section class="card overflow-x-auto p-4" aria-label="Comparaison">
			<table class="w-full text-[12px]">
				<thead>
					<tr class="meta-xs text-left">
						<th class="pb-1.5 font-normal"></th>
						<th class="pb-1.5 pl-3 text-right font-normal">Aujourd'hui</th>
						<th class="pb-1.5 pl-3 text-right font-normal">Avec le scénario</th>
						<th class="pb-1.5 pl-3 text-right font-normal">Écart</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-[var(--border-subtle)]">
					{#each rows as r (r.label)}
						{@const d = Math.round((r.b - r.a) * 100) / 100}
						<tr class:font-medium={r.strong}>
							<td class="py-1">{r.label}</td>
							<td class="tabular py-1 pl-3 text-right text-secondary">{money(r.a, r.compact)}</td>
							<td class="tabular py-1 pl-3 text-right">{money(r.b, r.compact)}</td>
							<td class="tabular py-1 pl-3 text-right" style={d === 0 ? 'color: var(--text-secondary);' : `color: ${d * r.good > 0 ? 'var(--accent)' : 'var(--amber)'};`}>{d === 0 ? '—' : signed(d, r.compact)}</td>
						</tr>
					{/each}
					<tr>
						<td class="py-1">Taux d'épargne</td>
						<td class="tabular py-1 pl-3 text-right text-secondary">{pct(today.savingsRate)}</td>
						<td class="tabular py-1 pl-3 text-right">{pct(withScenario.savingsRate)}</td>
						<td class="tabular py-1 pl-3 text-right text-secondary">{today.savingsRate !== null && withScenario.savingsRate !== null && withScenario.savingsRate !== today.savingsRate ? `${(withScenario.savingsRate - today.savingsRate).toLocaleString('fr-FR', { maximumFractionDigits: 1, signDisplay: 'always' }).replace('-', '−')} pt` : '—'}</td>
					</tr>
					{#if withScenario.oneOff}
						<tr>
							<td class="py-1">Ponctuel (une fois)</td>
							<td class="tabular py-1 pl-3 text-right text-secondary">—</td>
							<td class="tabular py-1 pl-3 text-right">{withScenario.oneOff > 0 ? formatEUR(-withScenario.oneOff) : signed(-withScenario.oneOff)}</td>
							<td></td>
						</tr>
					{/if}
				</tbody>
			</table>
			{#if goals.length}
				<h2 class="label-xs mt-3 mb-1">Objectifs d'épargne <span class="meta-xs normal-case">(toute l'épargne du mois dedans)</span></h2>
				<ul class="space-y-0.5 text-[12px]">
					{#each goals as o (o.g.id)}
						<li class="flex flex-wrap items-baseline gap-x-2">
							<span>{o.g.name}</span>
							<span class="meta-xs">{formatEURCompact(o.g.targetAmount)}</span>
							<span class="ml-auto tabular text-secondary">{o.a === null ? 'jamais à ce rythme' : dateIn(o.a)}</span>
							<span aria-hidden="true" class="meta-xs">→</span>
							<span class="tabular" style={o.a !== o.b ? `color: ${o.b === null || (o.a !== null && o.b > o.a) ? 'var(--amber)' : 'var(--accent)'};` : ''}>{o.b === null ? 'jamais à ce rythme' : dateIn(o.b)}</span>
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		<section class="card p-4" aria-label="Patrimoine projeté">
			<div class="mb-1 flex flex-wrap items-baseline justify-between gap-2">
				<h2 class="label-xs">Patrimoine projeté sur {YEARS} ans</h2>
				<div class="meta-xs flex items-center gap-3">
					<span class="flex items-center gap-1"><svg width="16" height="6" aria-hidden="true"><line x1="0" x2="16" y1="3" y2="3" stroke="var(--text-secondary)" stroke-width="2" stroke-dasharray="4 3" /></svg>Aujourd'hui</span>
					<span class="flex items-center gap-1"><svg width="16" height="6" aria-hidden="true"><line x1="0" x2="16" y1="3" y2="3" stroke="var(--accent)" stroke-width="2" /></svg>Avec le scénario</span>
				</div>
			</div>
			<div class="relative" bind:clientWidth={width} style="height: {H}px;">
				{#if geo}
					<svg {width} height={H} class="block" role="img" aria-label="Dans {YEARS} ans : {formatEUR(seriesA[YEARS]!)} aujourd'hui, {formatEUR(seriesB[YEARS]!)} avec le scénario" onmousemove={onMove} onmouseleave={() => (hover = null)}>
						{#each geo.grid as v (v)}
							<line x1={PAD.left} x2={width - PAD.right} y1={geo.y(v)} y2={geo.y(v)} stroke="var(--text)" opacity={v === 0 ? 0.18 : 0.06} />
							<text x={PAD.left - 6} y={geo.y(v) + 3.5} text-anchor="end" font-size="10" fill="var(--text-secondary)">{formatEURCompact(v)}</text>
						{/each}
						{#each Array.from({ length: YEARS / 5 + 1 }, (_, i) => i * 5) as y (y)}
							<text x={geo.x(y)} y={H - 6} text-anchor="middle" font-size="10" fill="var(--text-secondary)">{now.getFullYear() + y}</text>
						{/each}
						<path d={geo.a} fill="none" stroke="var(--text-secondary)" stroke-width="2" stroke-dasharray="4 3" stroke-linejoin="round" />
						<path d={geo.b} fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
						{#if hover !== null}
							<line x1={geo.x(hover)} x2={geo.x(hover)} y1={PAD.top} y2={H - PAD.bottom} stroke="var(--text-secondary)" stroke-dasharray="3 3" opacity="0.6" />
							<circle cx={geo.x(hover)} cy={geo.y(seriesA[hover]!)} r="4" fill="var(--text-secondary)" stroke="var(--surface)" stroke-width="2" />
							<circle cx={geo.x(hover)} cy={geo.y(seriesB[hover]!)} r="4" fill="var(--accent)" stroke="var(--surface)" stroke-width="2" />
						{/if}
					</svg>
					{#if hover !== null}
						<div class="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-lg border px-2.5 py-1.5 text-xs" style="left: {Math.min(Math.max(geo.x(hover), 90), width - 90)}px; border-color: var(--border); background-color: var(--surface);">
							<p class="text-secondary">{now.getFullYear() + hover}{hover ? ` · dans ${hover} an${hover > 1 ? 's' : ''}` : ''}</p>
							<p class="tabular">Aujourd'hui {formatEURCompact(seriesA[hover]!)}</p>
							<p class="tabular font-medium">Scénario {formatEURCompact(seriesB[hover]!)}</p>
							<p class="meta-xs tabular">Écart {signed(seriesB[hover]! - seriesA[hover]!, true)}</p>
						</div>
					{/if}
				{/if}
			</div>
		</section>
	</div>
</div>

{#if withScenario.loans.length}
	<div class="mt-3">
		<LoanStudyPanel loans={withScenario.loans} {study} {defaults} oneOff={withScenario.oneOff} today={todayIso} onChange={setStudy} />
	</div>
{/if}
