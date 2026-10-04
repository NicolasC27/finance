/**
 * Krak card: monthly summary from imported Kraken statements
 * (`budget:krak-card`) — spending, refunds and cashback received (EUR value on
 * the payout day). Answers "how much does the card earn me?" without
 * recounting budget lines.
 */

export interface KrakMonth {
	spendEur: number;
	refundEur: number;
	cashbackEur: number;
	payments: number;
}

const KEY = 'budget:krak-card';

function load(): Record<string, KrakMonth> {
	if (typeof localStorage === 'undefined') return {};
	try {
		const parsed = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, KrakMonth>;
		return parsed && typeof parsed === 'object' ? parsed : {};
	} catch {
		return {};
	}
}

export const krakCardState = $state({
	months: load()
});

/** Stores (or replaces) the summary of one statement month. Unavailable storage is ignored. */
export function saveKrakMonth(month: string, data: KrakMonth): void {
	if (!month) return;
	krakCardState.months = { ...krakCardState.months, [month]: data };
	try {
		localStorage.setItem(KEY, JSON.stringify(krakCardState.months));
	} catch {
	}
}

export interface KrakSummary {
	months: { month: string; data: KrakMonth; rate: number | null }[];
	spendEur: number;
	cashbackEur: number;
	/** Cashback / spending, in % (null without spending). */
	rate: number | null;
	/** Average cashback per active month. */
	avgPerMonth: number;
}

export function getKrakSummary(): KrakSummary {
	const entries = Object.entries(krakCardState.months).sort(([a], [b]) => a.localeCompare(b));
	let spendEur = 0;
	let cashbackEur = 0;
	let active = 0;
	const months = entries.map(([month, data]) => {
		spendEur += data.spendEur;
		cashbackEur += data.cashbackEur;
		if (data.payments > 0) active++;
		return { month, data, rate: data.spendEur > 0 ? Math.round((data.cashbackEur / data.spendEur) * 1000) / 10 : null };
	});
	return {
		months,
		spendEur: Math.round(spendEur * 100) / 100,
		cashbackEur: Math.round(cashbackEur * 100) / 100,
		rate: spendEur > 0 ? Math.round((cashbackEur / spendEur) * 1000) / 10 : null,
		avgPerMonth: active > 0 ? Math.round((cashbackEur / active) * 100) / 100 : 0
	};
}
