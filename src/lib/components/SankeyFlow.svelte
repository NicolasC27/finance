<script lang="ts">
	import { formatEUR, formatEURCompact, formatPct } from '$lib/format';
	import { layoutSankey, sankeySummary, type PlacedNode, type SankeyFlows, type SankeyNode } from '$lib/sankey';

	/**
	 * 'Where the money goes' Sankey (Rapport › Flux du mois): hand-made SVG, pure layout (sankey.ts)
	 * recomputed at the container width. Hovering a link, node or label highlights the flow and shows
	 * a tooltip (amount, share of income, top 3 details). Filterable items are buttons (keyboard
	 * included): `onSelect` opens their operations. Screen readers: a summary sentence + a table of
	 * flows.
	 */
	let {
		flows,
		monthLabel,
		partial = false,
		onSelect
	}: {
		flows: SankeyFlows;
		/** 'septembre 2026' (summary and table caption). */
		monthLabel: string;
		/** Current month: income may not all have arrived yet. */
		partial?: boolean;
		/** Click on a node carrying a category (Transactions filter). */
		onSelect?: (node: SankeyNode) => void;
	} = $props();

	let width = $state(0);
	const layout = $derived(width > 0 ? layoutSankey(flows, { width }) : null);
	const summary = $derived(sankeySummary(flows, monthLabel));

	/** Hovered or focused node ('center': central node). */
	let hoveredId = $state<string | null>(null);

	function selectable(n: SankeyNode | null): n is SankeyNode {
		return n !== null && onSelect !== undefined && n.categoryId !== undefined;
	}

	/** Hover inside the SVG: the pointed element (link, node, label) carries data-sk. */
	function onSvgMove(e: PointerEvent) {
		const el = e.target instanceof Element ? e.target.closest('[data-sk]') : null;
		hoveredId = el?.getAttribute('data-sk') ?? null;
	}

	/** Half height of a label (clickable area), see the spacing of layoutSankey. */
	const halfLabel = $derived(layout?.compact ? 12 : 7);

	/** Clickable area: label block + node, over the label height. */
	function hitBox(n: PlacedNode): { left: number; top: number; width: number; height: number } {
		const left = n.label.anchor === 'end' ? n.label.x - n.label.w - 2 : n.x - 2;
		const right = n.label.anchor === 'end' ? n.x + n.w + 2 : n.label.x + n.label.w + 2;
		return { left, top: n.label.y - halfLabel, width: right - left, height: halfLabel * 2 };
	}

	const pctOfIncome = (v: number) => (flows.income > 0 ? formatPct((v / flows.income) * 100, v / flows.income < 0.1 ? 1 : 0) : null);

	interface Tip {
		title: string;
		amount: string;
		pct: string | null;
		lines: { label: string; value: string }[];
		more: number;
		note: string | null;
		hint: boolean;
		x: number;
		y: number;
		/**
		 * Horizontal translation of the tooltip (left, right or centre anchor). Narrow screen: centred
		 * tooltip (it would overflow one side or the other); otherwise placed on the other side of the
		 * central node so the highlighted link stays visible.
		 */
		tx: string;
	}

	const tip = $derived.by((): Tip | null => {
		if (!layout || !hoveredId) return null;
		const clampY = (y: number) => Math.min(Math.max(y, 34), layout.height - 34);
		const narrow = layout.compact ? { x: layout.width / 2, tx: '-50%' } : null;
		if (hoveredId === 'center') {
			const c = layout.center;
			const extra = flows.left.filter((n) => n.kind !== 'source');
			return {
				title: 'Entrées',
				amount: formatEUR(flows.income),
				pct: null,
				lines: extra.map((n) => ({ label: `+ ${n.label}`, value: formatEURCompact(n.value) })),
				more: 0,
				note: extra.length > 0 ? `Total réparti : ${formatEUR(flows.total)}` : null,
				hint: false,
				x: narrow?.x ?? c.x + c.w / 2,
				y: clampY(c.y + c.h / 2),
				tx: '-50%'
			};
		}
		const placed = layout.nodes.find((n) => n.id === hoveredId);
		const n = placed?.node;
		if (!placed || !n) return null;
		const notes: Partial<Record<SankeyNode['kind'], string>> = {
			savings: flows.income > 0 ? `Taux d'épargne : ${formatPct((n.value / flows.income) * 100, 0)}` : 'Reste du mois',
			draw: partial ? 'Mois en cours : les revenus ne sont peut-être pas encore arrivés' : 'Les sorties dépassent les entrées du mois',
			refund: 'Remboursements supérieurs aux dépenses du poste',
			reversal: 'Retiré des revenus du mois (frais avancés remboursés, chèque contre-passé…)',
			others: 'Postes de moins de 2 % des sorties'
		};
		const count = n.count > 0 ? `${n.count} opération${n.count > 1 ? 's' : ''}` : null;
		const left = n.side === 'left';
		return {
			title: n.label,
			amount: formatEUR(n.value),
			pct: n.kind === 'draw' ? null : pctOfIncome(n.value),
			lines: n.details.slice(0, 3).map((d) => ({ label: d.label, value: formatEURCompact(d.value) })),
			more: Math.max(0, n.details.length - 3),
			note: [notes[n.kind], count].filter(Boolean).join(' · ') || null,
			hint: selectable(n),
			x: narrow?.x ?? (left ? layout.center.x + layout.center.w + 10 : Math.max(layout.center.x - 10, 240)),
			y: clampY(placed.y + placed.h / 2),
			tx: narrow?.tx ?? (left ? '0' : '-100%')
		};
	});

	/** Links from thickest to thinnest: a thin link overlapping a thick one stays hoverable. */
	const linksByWidth = $derived(layout ? [...layout.links].sort((a, b) => b.width - a.width) : []);

	/** Faded link: another side node is hovered. */
	const dimmed = (id: string) => hoveredId !== null && hoveredId !== 'center' && hoveredId !== id;
</script>

<div class="sankey relative" bind:clientWidth={width}>
	{#if layout}
		<svg
			width={layout.width}
			height={layout.height}
			viewBox="0 0 {layout.width} {layout.height}"
			role="img"
			aria-label={summary}
			class="block"
			onpointermove={onSvgMove}
			onpointerleave={() => (hoveredId = null)}
		>
			<g>
				{#each linksByWidth as link, i (link.id)}
					<path
						data-sk={link.id}
						d={link.d}
						fill={link.color}
						class="sk-link"
						class:sk-on={hoveredId === link.id}
						class:sk-off={dimmed(link.id)}
						style="animation-delay: {i * 35}ms;"
					/>
				{/each}
			</g>
			{#each layout.nodes as n (n.id)}
				<rect data-sk={n.id} x={n.x} y={n.y} width={n.w} height={n.h} rx="1.5" fill={n.color} class="sk-node" class:sk-off={dimmed(n.id)} />
			{/each}
			<rect data-sk="center" x={layout.center.x} y={layout.center.y} width={layout.center.w} height={layout.center.h} rx="1.5" fill={layout.center.color} class="sk-node" />
			{#each [...layout.nodes, layout.center] as n (n.id)}
				{#if n.label.twoLines}
					<text data-sk={n.id} x={n.label.x} y={n.label.y - 6} text-anchor={n.label.anchor} dominant-baseline="middle" class="sk-label sk-name" class:sk-off={dimmed(n.id)}>{n.label.name}</text>
					<text data-sk={n.id} x={n.label.x} y={n.label.y + 7} text-anchor={n.label.anchor} dominant-baseline="middle" class="sk-label sk-amount" class:sk-off={dimmed(n.id)}>{n.label.amount}</text>
				{:else}
					<text data-sk={n.id} x={n.label.x} y={n.label.y} text-anchor={n.label.anchor} dominant-baseline="middle" class="sk-label" class:sk-halo={n.id === 'center'} class:sk-off={n.id !== 'center' && dimmed(n.id)}>
						<tspan class="sk-name" class:sk-center={n.id === 'center'}>{n.label.name}</tspan><tspan class="sk-amount" dx="5">{n.label.amount}</tspan>
					</text>
				{/if}
			{/each}
		</svg>

		<!-- Filterable items: transparent buttons over the label (mouse, keyboard, touch) -->
		{#each layout.nodes as n (n.id)}
			{#if selectable(n.node)}
				{@const node = n.node}
				{@const box = hitBox(n)}
				<button
					type="button"
					class="sk-hit no-print"
					style="left: {box.left}px; top: {box.top}px; width: {box.width}px; height: {box.height}px;"
					aria-label="{node.label} : {formatEUR(node.value)} — voir les opérations du mois"
					onclick={() => onSelect?.(node)}
					onpointerenter={() => (hoveredId = n.id)}
					onpointerleave={() => (hoveredId = null)}
					onfocus={() => (hoveredId = n.id)}
					onblur={() => (hoveredId = null)}
				></button>
			{/if}
		{/each}

		{#if tip}
			<div
				class="sk-tip no-print pointer-events-none absolute z-10 max-w-[230px] rounded-lg border px-3 py-2 text-xs"
				style="left: {tip.x}px; top: {tip.y}px; transform: translate({tip.tx}, -50%); border-color: var(--border); background-color: var(--surface);"
			>
				<p class="font-medium" style="color: var(--text);">{tip.title}</p>
				<p class="tabular mt-0.5 whitespace-nowrap">
					<span class="font-semibold" style="color: var(--text);">{tip.amount}</span>
					{#if tip.pct}<span class="text-secondary"> · {tip.pct} des entrées</span>{/if}
				</p>
				{#if tip.lines.length > 0}
					<ul class="mt-1.5 space-y-0.5">
						{#each tip.lines as l (l.label)}
							<li class="flex items-baseline justify-between gap-3">
								<span class="truncate text-secondary">{l.label}</span>
								<span class="tabular whitespace-nowrap" style="color: var(--text);">{l.value}</span>
							</li>
						{/each}
						{#if tip.more > 0}
							<li class="meta-xs">+ {tip.more} autre{tip.more > 1 ? 's' : ''}</li>
						{/if}
					</ul>
				{/if}
				{#if tip.note}<p class="meta-xs mt-1.5">{tip.note}</p>{/if}
				{#if tip.hint}<p class="meta-xs mt-0.5" style="color: var(--accent);">Clic : voir les opérations</p>{/if}
			</div>
		{/if}
	{/if}

	<!-- Screen readers: full flows (the chart only exposes its summary) -->
	<table class="sr-only">
		<caption>Flux de {monthLabel}, en euros</caption>
		<thead>
			<tr><th scope="col">De</th><th scope="col">Vers</th><th scope="col">Montant</th></tr>
		</thead>
		<tbody>
			{#each flows.left as n (n.id)}
				<tr><td>{n.label}</td><td>Entrées</td><td>{formatEUR(n.value)}</td></tr>
			{/each}
			{#each flows.right as n (n.id)}
				<tr><td>Entrées</td><td>{n.label}</td><td>{formatEUR(n.value)}</td></tr>
			{/each}
		</tbody>
	</table>
</div>

<style>
	.sk-link {
		fill-opacity: 0.3;
		transition: fill-opacity 160ms ease;
		animation: sk-fade 520ms ease both;
	}

	.sk-link.sk-on {
		fill-opacity: 0.6;
	}

	.sk-link.sk-off {
		fill-opacity: 0.1;
	}

	.sk-node {
		transition: opacity 160ms ease;
	}

	.sk-node.sk-off {
		opacity: 0.35;
	}

	.sk-label {
		font-size: 11px;
		fill: var(--text);
		transition: opacity 160ms ease;
	}

	.sk-label.sk-off {
		opacity: 0.45;
	}

	.sk-amount {
		fill: var(--text-2);
		font-variant-numeric: tabular-nums;
	}

	.sk-center {
		font-weight: 600;
	}

	/* Central label readable over the links: card-coloured outline; transparent on hover (the links
	   below stay hoverable) */
	.sk-halo {
		pointer-events: none;
		paint-order: stroke;
		stroke: var(--surface);
		stroke-width: 4px;
		stroke-linejoin: round;
	}

	.sk-hit {
		position: absolute;
		cursor: pointer;
		border-radius: 4px;
		background: transparent;
	}

	@keyframes sk-fade {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.sk-link,
		.sk-node,
		.sk-label {
			transition: none;
			animation: none;
		}
	}

	/* Printing: dark ink on paper, whatever the on-screen theme */
	@media print {
		.sk-link {
			fill-opacity: 0.35 !important;
			animation: none;
		}

		.sk-node,
		.sk-label {
			opacity: 1 !important;
		}

		.sk-label {
			fill: #1c1c1c;
		}

		.sk-halo {
			stroke: #ffffff;
		}

		.sk-amount {
			fill: #6b6b66;
		}
	}
</style>
