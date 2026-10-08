<script lang="ts">
	import { formatDate, formatEUR, formatMonth, formatPct } from '$lib/sensitiveFormat';
	import { invoiceFlow } from '$lib/portageFlow';
	import type { ActivityMonth, ActivityStatement, Payslip } from '$lib/portage';

	/**
	 * Header tile of the portage page: who you work for and at what rate, the last net salary in
	 * large with its month, the net of each month as small bars, and the flow of the month's
	 * invoice from the revenue to your pocket (one bar, one segment per part, what stays yours in
	 * the accent colour, the tax in amber). The page gives the newest month with a known net.
	 */
	let {
		statement,
		row,
		rows,
		show
	}: {
		statement: ActivityStatement | undefined;
		/** The month shown: its statement line and payslip when they exist. */
		row: { mois: string; a?: ActivityMonth; p?: Payslip };
		/** Net salary of each month with one, oldest first. */
		rows: { mois: string; net: number }[];
		show: (id: string) => boolean;
	} = $props();

	const flow = $derived(invoiceFlow(row.a, row.p));
	const net = $derived(row.p?.netPaye ?? row.a?.netApresImpot ?? 0);
	const identity = $derived([statement?.client ? `${statement.client}${statement.clientFinal ? ` → ${statement.clientFinal}` : ''}` : '', row.p?.emploi ?? ''].filter(Boolean).join(' · '));
	const terms = $derived([statement?.tjm ? `TJM ${formatEUR(statement.tjm)}` : '', statement?.fraisGestionPct ? `${formatPct(statement.fraisGestionPct, 0)} de frais de gestion` : '', statement?.dateEntree ? `depuis le ${formatDate(statement.dateEntree)}` : ''].filter(Boolean).join(' · '));
	const when = $derived([row.a?.jours ? `${row.a.jours} jour${row.a.jours > 1 ? 's' : ''} facturé${row.a.jours > 1 ? 's' : ''}` : '', row.p?.datePaiement ? `versé le ${formatDate(row.p.datePaiement)}` : '', row.p?.rembFrais ? `dont ${formatEUR(row.p.rembFrais)} de frais remboursés` : ''].filter(Boolean).join(' · '));
	const taxRate = $derived(row.p?.pas?.taux);

	const bars = $derived(rows.slice(-12));
	const maxNet = $derived(Math.max(1, ...bars.map((r) => r.net)));
	const BAR_H = 34;
	const BAR_W = 14;
	const GAP = 4;
</script>

<section class="card portage-hero" aria-label="Le dernier mois en portage">
	<div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
		<p class="meta-xs min-w-0 truncate">InfoPortage{identity ? ` · ${identity}` : ''}</p>
		{#if terms}<p class="meta-xs">{terms}</p>{/if}
	</div>

	<div class="portage-hero-main">
		<div class="min-w-0">
			<p class="display-amount">{formatEUR(net)}</p>
			<p class="text-[13px]">
				<span class="font-medium">net versé · {formatMonth(row.mois)}</span>
				{#if flow}<span class="meta-xs ml-1.5 whitespace-nowrap">salaire net {formatPct(flow.netShare * 100, 0)} du chiffre d’affaires</span>{/if}
			</p>
			{#if show('versement') && when}<p class="meta-xs mt-0.5">{when}</p>{/if}
		</div>
		{#if show('barres') && bars.length > 1}
			<figure class="portage-hero-bars">
				<svg width={bars.length * (BAR_W + GAP) - GAP} height={BAR_H} role="img" aria-label="Net versé par mois : {bars.map((r) => `${formatMonth(r.mois)} ${formatEUR(r.net)}`).join(', ')}">
					{#each bars as r, i (r.mois)}
						{@const h = Math.max(2, Math.round((r.net / maxNet) * (BAR_H - 2)))}
						<rect x={i * (BAR_W + GAP)} y={BAR_H - h} width={BAR_W} height={h} rx="2" class={r.mois === row.mois ? 'is-current' : ''}><title>{formatMonth(r.mois)} · {formatEUR(r.net)}</title></rect>
					{/each}
				</svg>
				<figcaption class="meta-xs">net par mois</figcaption>
			</figure>
		{/if}
	</div>

	{#if show('flux') && flow}
		<!-- Where the invoice goes: one segment per part, 2 px of surface between them -->
		<div class="portage-flow" role="img" aria-label="Chiffre d’affaires {formatEUR(flow.total)} : {flow.segments.map((s) => `${s.label} ${formatEUR(s.amount)} (${formatPct(s.percent, 0)})`).join(', ')}">
			{#each flow.segments as s (s.id)}
				<i class="portage-flow-seg is-{s.id}" style="flex-grow: {s.amount};" title="{s.label} · {formatEUR(s.amount)} · {formatPct(s.percent, 0)}"></i>
			{/each}
		</div>
		<ul class="portage-flow-key" aria-hidden="true">
			<li><span class="meta-xs">Chiffre d’affaires</span> <span class="tabular font-medium">{formatEUR(flow.total)}</span></li>
			{#each flow.segments as s (s.id)}
				<li>
					<i class="portage-flow-swatch is-{s.id}"></i>
					<span class="meta-xs">{s.label}</span>
					<span class="tabular">{formatEUR(s.amount)}</span>
					<span class="meta-xs tabular">· {formatPct(s.percent, 0)}{s.id === 'impot' && taxRate !== undefined ? ` · taux ${formatPct(taxRate, 1)}` : ''}</span>
				</li>
			{/each}
		</ul>
		{#if Math.abs(flow.gap) >= 1}
			<p class="meta-xs mt-1.5" style="color: var(--amber);">Les documents ne se recoupent pas : les parts font {formatEUR(flow.total + flow.gap)} pour {formatEUR(flow.total)} de chiffre d’affaires.</p>
		{/if}
	{/if}
</section>

<style>
	.portage-hero {
		padding: 0.875rem 1rem 0.75rem;
	}
	.portage-hero-main {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		justify-content: space-between;
		gap: 0.75rem 1rem;
		margin-top: 0.5rem;
	}
	.portage-hero-bars {
		flex: none;
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 3px;
	}
	.portage-hero-bars rect {
		fill: color-mix(in srgb, var(--text) 22%, transparent);
	}
	.portage-hero-bars rect.is-current {
		fill: var(--accent);
	}
	.portage-flow {
		display: flex;
		gap: 2px;
		height: 14px;
		margin-top: 0.75rem;
		border-radius: 4px;
		overflow: hidden;
	}
	.portage-flow-seg {
		display: block;
		flex-basis: 0;
		min-width: 2px;
		border-radius: 2px;
	}
	.portage-flow-key {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.25rem 0.875rem;
		margin-top: 0.5rem;
		font-size: 12px;
	}
	.portage-flow-key li {
		display: inline-flex;
		align-items: center;
		gap: 5px;
	}
	.portage-flow-swatch {
		display: inline-block;
		width: 10px;
		height: 10px;
		border-radius: 2px;
	}
	/* What leaves: greys from the company's fee to the employee contributions; the tax in amber; what stays yours in the accent */
	.is-gestion {
		background: color-mix(in srgb, var(--text) 14%, transparent);
	}
	.is-activite {
		background: color-mix(in srgb, var(--text) 18%, transparent);
	}
	.is-patronales {
		background: color-mix(in srgb, var(--text) 26%, transparent);
	}
	.is-autres {
		background: color-mix(in srgb, var(--text) 20%, transparent);
	}
	.is-cotisations {
		background: color-mix(in srgb, var(--text) 40%, transparent);
	}
	.is-impot {
		background: var(--amber);
	}
	.is-reserve,
	.is-provision {
		background: repeating-linear-gradient(45deg, var(--accent) 0 2px, var(--accent-soft) 2px 6px);
	}
	.is-cheques,
	.is-titres {
		background: color-mix(in srgb, var(--accent) 55%, var(--surface));
	}
	.is-frais {
		background: color-mix(in srgb, var(--accent) 40%, var(--surface));
	}
	.is-net {
		background: var(--accent);
	}
</style>
