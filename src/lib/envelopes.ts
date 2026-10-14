/** Envelope gauge of a category mark: how much of the month's budget is already spent (pure). */

export interface EnvelopeGauge {
	/** Spent share of the envelope, 0..1 (capped: the mark cannot fill past full). */
	fill: number;
	/** Spent share in whole percent, uncapped (« 112 % »). */
	pct: number;
	/** Spending past the envelope. */
	over: boolean;
}

/** Gauge of an envelope; null without a positive budget. Refunds above the spending read as empty. */
export function envelopeGauge(spent: number, budget: number | undefined): EnvelopeGauge | null {
	if (!budget || budget <= 0) return null;
	const share = Math.max(0, spent) / budget;
	return { fill: Math.min(1, share), pct: Math.round(share * 100), over: share > 1 };
}

/** Tooltip of a gauged mark: « Alimentation · 74 % de l'enveloppe ». */
export function gaugeTitle(label: string, gauge: EnvelopeGauge): string {
	return `${label} · ${gauge.pct} % de l'enveloppe${gauge.over ? ' (dépassée)' : ''}`;
}
