import type { FundHolding, NatixisNotice, NatixisHoldings, AvailabilitySegment, NatixisPayment } from './pdfNatixis';

/**
 * Store of the Natixis employee savings (SPEC v14 §F.2) — `budget:natixis-holdings`.
 *
 * A transaction notice is a FULL SNAPSHOT of the holdings: the latest import
 * REPLACES the previous one (never merged, never duplicated). Annual
 * performances (scheme PDF) live apart (`budget:natixis-perfs`) and are applied
 * to the holdings on every notice import — so the import order of the two PDFs
 * doesn't matter.
 *
 * Reminder (honesty): FCPE funds are not quoted continuously — the total is the
 * value on the notice's valuation day, « avant frais et prélèvements sociaux »,
 * without any live revaluation.
 */

const HOLDINGS_KEY = 'budget:natixis-holdings';
const PERFS_KEY = 'budget:natixis-perfs';
const PAYMENTS_KEY = 'budget:natixis-payments';
const SNAPSHOT_KEY = 'budget:natixis-snapshot';

/** Position read on the Natixis website: total of the day and cumulated payments (origin of the savings). */
export interface NatixisSnapshot {
	date: string;
	total: number;
	/** Σ payments (employee savings + voluntary payments), as shown by Natixis. */
	invested: number;
}

function loadSnapshot(): NatixisSnapshot | null {
	if (typeof localStorage === 'undefined') return null;
	try {
		const p = JSON.parse(localStorage.getItem(SNAPSHOT_KEY) ?? 'null') as NatixisSnapshot | null;
		return p && typeof p.total === 'number' && typeof p.date === 'string' ? p : null;
	} catch {
		return null;
	}
}

interface StoredHoldings extends NatixisHoldings {
	availability: AvailabilitySegment[];
	valuedAt: string;
	lastPayment?: NatixisNotice['lastPayment'];
}

function loadHoldings(): StoredHoldings | null {
	if (typeof localStorage === 'undefined') return null;
	try {
		const raw = localStorage.getItem(HOLDINGS_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as StoredHoldings;
		if (!parsed || !Array.isArray(parsed.holdings) || typeof parsed.total !== 'number') return null;
		return parsed;
	} catch {
		return null;
	}
}

function loadPerfs(): { perfs: Record<string, number>; year: number } | null {
	if (typeof localStorage === 'undefined') return null;
	try {
		const raw = localStorage.getItem(PERFS_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as { perfs: Record<string, number>; year: number };
		return parsed && typeof parsed.perfs === 'object' ? parsed : null;
	} catch {
		return null;
	}
}

/** Persists a key; when the quota is exceeded the data stays in memory for the session. */
function persist(key: string, value: unknown): void {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(key, JSON.stringify(value));
	} catch {
	}
}

function loadPayments(): NatixisPayment[] {
	if (typeof localStorage === 'undefined') return [];
	try {
		const parsed = JSON.parse(localStorage.getItem(PAYMENTS_KEY) ?? '[]') as NatixisPayment[];
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

export const natixisState = $state({
	holdings: loadHoldings() as StoredHoldings | null,
	perfs: loadPerfs(),
	/** Payments seen in the imported notices (deduplicated: kind + fund + date + amount). */
	payments: loadPayments(),
	/** Latest position entered from the Natixis website (total + cumulated payments). */
	snapshot: loadSnapshot()
});

export function saveNatixisSnapshot(snap: NatixisSnapshot): void {
	natixisState.snapshot = snap;
	persist(SNAPSHOT_KEY, snap);
}

/**
 * ESTIMATED value today: each holding extended pro rata of the days elapsed
 * since the notice with its fund's annual performance (imported scheme).
 * Without a known performance: the notice value, unchanged. Shown as an
 * estimate; the certain value stays the notice's.
 */
export interface NatixisEstimate {
	total: number;
	asOf: string;
	/** Days elapsed since the base (notice or entered position). */
	daysSince: number;
	estimated: boolean;
	/** Base used: 'avis' (PDF) or 'snapshot' (entered position, more recent). */
	base: 'avis' | 'snapshot';
	baseDate: string;
	/** Known cumulated payments (entered position) and gain = estimate − payments. */
	invested?: number;
	gain?: number;
	gainPct?: number;
}

/** Today's estimate, using the portfolio's weighted annual performance (notice + scheme), 0 when unknown. */
export function getNatixisEstimate(): NatixisEstimate | null {
	const h = natixisState.holdings;
	const snap = natixisState.snapshot;
	if (!h && !snap) return null;
	const today = new Date();
	const asOf = today.toISOString().slice(0, 10);
	const daysFrom = (iso: string) => Math.max(0, Math.round((today.getTime() - new Date(`${iso}T12:00:00`).getTime()) / 86_400_000));
	let weighted = 0;
	let weightTotal = 0;
	for (const holding of h?.holdings ?? []) {
		if (holding.perfY !== undefined) {
			weighted += holding.amount * holding.perfY;
			weightTotal += holding.amount;
		}
	}
	const avgPerf = weightTotal > 0 ? weighted / weightTotal : 0;

	const useSnap = !!snap && (!h || snap.date >= h.valuedAt);
	const baseDate = useSnap ? snap!.date : h!.valuedAt;
	const days = daysFrom(baseDate);
	let total = 0;
	let estimated = false;
	if (useSnap) {
		total = avgPerf !== 0 && days > 0 ? snap!.total * Math.pow(1 + avgPerf / 100, days / 365) : snap!.total;
		estimated = avgPerf !== 0 && days > 0;
	} else {
		for (const holding of h!.holdings) {
			if (holding.perfY !== undefined && days > 0) {
				total += holding.amount * Math.pow(1 + holding.perfY / 100, days / 365);
				estimated = true;
			} else total += holding.amount;
		}
		if (h!.holdings.length === 0) total = h!.total;
	}
	total = Math.round(total * 100) / 100;
	const invested = snap?.invested;
	const gain = invested !== undefined ? Math.round((total - invested) * 100) / 100 : undefined;
	return {
		total,
		asOf,
		daysSince: days,
		estimated,
		base: useSnap ? 'snapshot' : 'avis',
		baseDate,
		...(invested !== undefined ? { invested } : {}),
		...(gain !== undefined ? { gain, gainPct: invested && invested > 0 ? (gain / invested) * 100 : undefined } : {})
	};
}

/** Prudent long-term assumption per fund type (%/year), used next to the 2025 performance. */
function prudentRate(fund: string): number {
	const f = fund.toUpperCase();
	if (f.includes('MONETAIRE')) return 2;
	if (f.includes('OBLIG') || f.includes('RENDEMENT')) return 2.5;
	if (f.includes('MIXTE') || f.includes('DORVAL') || f.includes('EQUILIBRE')) return 4;
	if (f.includes('ACTIONS') || f.includes('CROISSANCE')) return 6;
	return 3;
}

export interface NatixisProjection {
	years: number;
	/** Without any performance. */
	flat: number;
	/** Each fund's 2025 annual performance extended (optimistic if the year was good). */
	lastYear: number | null;
	/** Prudent long-term assumptions per fund type. */
	prudent: number;
}

/** Savings projection (no new payments) at 1, 3 and 5 years, 3 scenarios, each fund weighted by its share of today's estimate. */
export function getNatixisProjection(): NatixisProjection[] | null {
	const h = natixisState.holdings;
	if (!h || h.holdings.length === 0) return null;
	const base = getNatixisEstimate()?.total ?? h.total;
	const scale = h.total > 0 ? base / h.total : 1;
	const hasPerf = h.holdings.some((x) => x.perfY !== undefined);
	return [1, 3, 5].map((years) => {
		let last = 0;
		let prudent = 0;
		for (const x of h.holdings) {
			const amount = x.amount * scale;
			prudent += amount * Math.pow(1 + prudentRate(x.fund) / 100, years);
			last += amount * Math.pow(1 + (x.perfY ?? prudentRate(x.fund)) / 100, years);
		}
		return { years, flat: Math.round(base * 100) / 100, lastYear: hasPerf ? Math.round(last * 100) / 100 : null, prudent: Math.round(prudent * 100) / 100 };
	});
}

/** Known payments, newest first. */
export function getNatixisPayments(): NatixisPayment[] {
	return [...natixisState.payments].sort((a, b) => b.valuedAt.localeCompare(a.valuedAt));
}

/** Total of the known payments (net of social charges when the notice shows them). */
export function getNatixisPaymentsTotal(): { gross: number; net: number; employer: number; count: number } {
	let gross = 0;
	let net = 0;
	let employer = 0;
	for (const p of natixisState.payments) {
		gross += p.amount;
		net += p.netAmount ?? p.amount;
		if (/abondement|participation|int[ée]ressement/i.test(p.kind)) employer += p.netAmount ?? p.amount;
	}
	return { gross: Math.round(gross * 100) / 100, net: Math.round(net * 100) / 100, employer: Math.round(employer * 100) / 100, count: natixisState.payments.length };
}

export function rememberNatixisPayment(p: NatixisPayment): void {
	rememberPayment(p);
}

function rememberPayment(p: NatixisPayment): void {
	const id = (x: NatixisPayment) => `${x.kind}|${x.fund}|${x.valuedAt}|${x.amount}`;
	if (natixisState.payments.some((x) => id(x) === id(p))) return;
	natixisState.payments = [...natixisState.payments, p];
	persist(PAYMENTS_KEY, natixisState.payments);
}

/** Applies the known performances to a list of holdings. */
function withPerfs(holdings: FundHolding[], perfs: Record<string, number>): FundHolding[] {
	return holdings.map((h) => {
		const perf = perfs[h.fund];
		return perf !== undefined ? { ...h, perfY: perf } : h;
	});
}

/**
 * Stores a transaction notice: it REPLACES the previous snapshot. Already known
 * performances (scheme imported before) are applied.
 */
/**
 * « Mon épargne » statement: no availability dates. Those of the previous
 * snapshot are reused for a fund/plan that had only one; otherwise
 * « unknown » (the timeline shows « Non précisé »).
 */
function carryAvailability(holdings: FundHolding[]): FundHolding[] {
	const prev = natixisState.holdings?.holdings ?? [];
	return holdings.map((h) => {
		if (h.availableAt !== 'inconnue') return h;
		const dates = [...new Set(prev.filter((p) => p.fund === h.fund && p.plan === h.plan && p.availableAt !== 'inconnue').map((p) => p.availableAt))];
		return dates.length === 1 ? { ...h, availableAt: dates[0]! } : h;
	});
}

/** Availability timeline recomputed from the holdings (« Non précisé » for unknown dates). */
function availabilityOf(holdings: FundHolding[]): AvailabilitySegment[] {
	const byKey = new Map<number, AvailabilitySegment>();
	for (const h of holdings) {
		const key = h.availableAt === 'retraite' ? 9999 : h.availableAt === 'inconnue' ? 9998 : Number(h.availableAt.slice(0, 4));
		const label = key === 9999 ? 'Retraite' : key === 9998 ? 'Non précisé' : String(key);
		const seg = byKey.get(key) ?? { label, key, amount: 0 };
		seg.amount = Math.round((seg.amount + h.amount) * 100) / 100;
		byKey.set(key, seg);
	}
	return [...byKey.values()].sort((a, b) => a.key - b.key);
}

export function saveNatixisNotice(notice: NatixisNotice): void {
	const perfs = natixisState.perfs;
	const holdings = carryAvailability(notice.holdings);
	const stored: StoredHoldings = {
		holdings: withPerfs(holdings, perfs?.perfs ?? {}),
		total: notice.total,
		importedAt: Date.now(),
		availability: notice.availability.length > 0 ? notice.availability : availabilityOf(holdings),
		valuedAt: notice.valuedAt,
		...(notice.lastPayment ? { lastPayment: notice.lastPayment } : {})
	};
	natixisState.holdings = stored;
	persist(HOLDINGS_KEY, stored);
	if (notice.lastPayment) rememberPayment(notice.lastPayment);
}

/**
 * Stores the annual performances (scheme) and applies them to the already
 * imported holdings (perf badge of the funds table).
 */
export function saveNatixisPerfs(perfs: Record<string, number>, year: number): void {
	natixisState.perfs = { perfs, year };
	persist(PERFS_KEY, natixisState.perfs);
	if (natixisState.holdings) {
		natixisState.holdings = { ...natixisState.holdings, holdings: withPerfs(natixisState.holdings.holdings, perfs) };
		persist(HOLDINGS_KEY, natixisState.holdings);
	}
}

/** Manual fallback entry (parsing < 50 %): adds a simple holding; the timeline is recomputed from the holdings. */
export function addManualHolding(input: { fund: string; amount: number; availableAt: string }): void {
	const fund = input.fund.trim().toUpperCase();
	if (!fund || !(input.amount > 0)) return;
	const current = natixisState.holdings;
	const valuedAt = current?.valuedAt ?? new Date().toISOString().slice(0, 10);
	const holding: FundHolding = {
		fund,
		availableAt: input.availableAt || 'retraite',
		shareValue: 0,
		shares: 0,
		amount: Math.round(input.amount * 100) / 100,
		valuedAt,
		plan: 'PEI'
	};
	const holdings = withPerfs([...(current?.holdings ?? []), holding], natixisState.perfs?.perfs ?? {});
	const total = Math.round(holdings.reduce((s, h) => s + h.amount, 0) * 100) / 100;
	const byYear = new Map<string, number>();
	for (const h of holdings) {
		const year = h.availableAt === 'retraite' ? 'Retraite' : h.availableAt.slice(0, 4);
		byYear.set(year, (byYear.get(year) ?? 0) + h.amount);
	}
	const availability = [...byYear.entries()]
		.map(([label, amount]) => ({
			label,
			key: label === 'Retraite' ? 9999 : Number(label),
			amount: Math.round(amount * 100) / 100
		}))
		.sort((a, b) => a.key - b.key);
	const stored: StoredHoldings = {
		holdings,
		total,
		importedAt: Date.now(),
		availability,
		valuedAt,
		...(current?.lastPayment ? { lastPayment: current.lastPayment } : {})
	};
	natixisState.holdings = stored;
	persist(HOLDINGS_KEY, stored);
}

/** Resets the employee savings (explicit reset). Unavailable storage is ignored. */
export function resetNatixisHoldings(): void {
	natixisState.holdings = null;
	natixisState.perfs = null;
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.removeItem(HOLDINGS_KEY);
		localStorage.removeItem(PERFS_KEY);
	} catch {
	}
}

/** Total employee savings (0 if never imported). */
/**
 * Applies the result of a parsed Natixis PDF (notice, « Mon épargne » statement
 * or performance table); returns a readable message, or an error.
 */
export function applyNatixisPdfResult(result: import('./pdfNatixis').NatixisPdfResult): { ok: true; message: string } | { ok: false; error: string; lowMatch?: boolean } {
	if (result.kind === 'avis') {
		const current = natixisState.holdings;
		if (current && current.valuedAt > result.avis.valuedAt) {
			if (result.avis.lastPayment) rememberNatixisPayment(result.avis.lastPayment);
			return { ok: true, message: `avis du ${result.avis.valuedAt} plus ancien que celui en place : versement ajouté à l'historique` };
		}
		saveNatixisNotice(result.avis);
		return { ok: true, message: `${result.avis.availability.length > 0 ? 'avis' : 'relevé « Mon épargne »'} importé, ${result.avis.holdings.length} avoirs au ${result.avis.valuedAt}` };
	}
	if (result.kind === 'scheme') {
		saveNatixisPerfs(result.scheme.perfs, result.scheme.year);
		return { ok: true, message: `performances ${result.scheme.year} importées (${Object.keys(result.scheme.perfs).length} fonds)` };
	}
	return { ok: false, error: result.message, lowMatch: result.reason === 'low-match' };
}

export function getNatixisSavingsTotal(): number {
	return natixisState.holdings?.total ?? 0;
}
