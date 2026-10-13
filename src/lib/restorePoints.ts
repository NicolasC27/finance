/**
 * Restore points (pure, testable on both sides): grandfather-father-son retention and a readable
 * summary of the differences between two snapshots of the data ({ budget:key → JSON text }).
 */

export interface PointInfo {
	id: number;
	/** ISO timestamp. */
	cree_le: string;
	/** Why it was taken (« avant import OFX : 312 opérations », « quotidien », note of the user). */
	raison: string;
	/** Encrypted size (bytes). */
	octets: number;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** ISO week key « AAAA-Www » of a date. */
function weekKey(t: number): string {
	const d = new Date(t);
	const day = (d.getUTCDay() + 6) % 7;
	d.setUTCDate(d.getUTCDate() - day + 3);
	const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
	const week = 1 + Math.round(((d.getTime() - firstThursday.getTime()) / DAY - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
	return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/**
 * Points kept: every point of the last 48 h, the newest of each day for 30 days, of each week for
 * 26 weeks, of each month for 24 months; then the oldest are dropped while the total size exceeds
 * `maxBytes`. The newest point is always kept.
 */
export function pointsToKeep(points: readonly PointInfo[], now: number, maxBytes = 300 * 1024 * 1024): Set<number> {
	const sorted = [...points].sort((a, b) => Date.parse(b.cree_le) - Date.parse(a.cree_le));
	const keep = new Set<number>();
	const seen = { day: new Set<string>(), week: new Set<string>(), month: new Set<string>() };
	for (const p of sorted) {
		const t = Date.parse(p.cree_le);
		const age = now - t;
		const day = p.cree_le.slice(0, 10);
		const month = p.cree_le.slice(0, 7);
		const week = weekKey(t);
		let kept = age <= 48 * HOUR;
		if (age <= 30 * DAY && !seen.day.has(day)) kept = true;
		if (age <= 26 * 7 * DAY && !seen.week.has(week)) kept = true;
		if (age <= 730 * DAY && !seen.month.has(month)) kept = true;
		seen.day.add(day);
		seen.week.add(week);
		seen.month.add(month);
		if (kept) keep.add(p.id);
	}
	if (sorted[0]) keep.add(sorted[0].id);
	let total = sorted.filter((p) => keep.has(p.id)).reduce((s, p) => s + p.octets, 0);
	for (const p of [...sorted].reverse()) {
		if (total <= maxBytes || p.id === sorted[0]?.id) break;
		if (keep.delete(p.id)) total -= p.octets;
	}
	return keep;
}

/** Readable names of the data keys shown in a difference summary. */
const KEY_NAMES: Readonly<Record<string, string>> = {
	'budget:budgets': 'budgets',
	'budget:overrides': 'catégories corrigées',
	'budget:sub-overrides': 'sous-catégories corrigées',
	'budget:rules': 'règles',
	'budget:goals': 'objectifs',
	'budget:biens': 'biens',
	'budget:accounts': 'comptes',
	'budget:vacations': 'vacances',
	'budget:portage': 'portage',
	'budget:cash-wallet': 'porte-monnaie (liquide)',
	'budget:loans': 'crédits',
	'budget:refunds': 'remboursements attendus',
	'budget:layout': 'disposition des pages',
	'budget:deleted-keys': 'opérations supprimées',
	'budget:imports-log': 'journal des imports',
	'budget:quick-memory': 'apprentissage de la saisie rapide',
	'budget:indexation': 'indexation des budgets',
	'budget:notes': 'bloc-notes',
	'budget:scenarios': 'scénarios du simulateur',
	'budget:loan-profile': 'profil emprunteur du simulateur',
	'budget:income-tax': 'réglages de l’estimation d’impôt',
	'budget:france-travail': 'relevés France Travail'
};

/** Identity of an operation inside budget:imported-txs (dates, amount, direction, label, rank). */
function opId(o: Record<string, unknown>): string {
	const amount = (o.transaction_amount as { amount?: string } | undefined)?.amount ?? '';
	const label = Array.isArray(o.remittance_information) ? o.remittance_information.join(' ') : '';
	return [o.booking_date, o.value_date, amount, o.credit_debit_indicator, label, o.dup_index ?? ''].join('|');
}

export interface SnapshotDiff {
	/** Operations present now but not in the point (lost by going back), and the reverse. */
	opsAdded: number;
	opsRemoved: number;
	/** Same operation, other note, tags, check mark… */
	opsChanged: number;
	/** Other data that differs (readable names). */
	changed: string[];
}

/**
 * Differences between a restore point (`point`) and the current data (`current`): what going back
 * would remove (opsAdded, operations added since) or bring back (opsRemoved), and the other data
 * that changed.
 */
export function diffSnapshots(point: Readonly<Record<string, string>>, current: Readonly<Record<string, string>>): SnapshotDiff {
	const parse = (s: string | undefined): Record<string, unknown>[] => {
		try {
			const v = JSON.parse(s ?? '[]') as unknown;
			return Array.isArray(v) ? (v as Record<string, unknown>[]) : [];
		} catch {
			return [];
		}
	};
	const before = new Map(parse(point['budget:imported-txs']).map((o) => [opId(o), JSON.stringify(o)]));
	const after = new Map(parse(current['budget:imported-txs']).map((o) => [opId(o), JSON.stringify(o)]));
	let opsAdded = 0;
	let opsChanged = 0;
	for (const [id, v] of after) {
		const b = before.get(id);
		if (b === undefined) opsAdded++;
		else if (b !== v) opsChanged++;
	}
	const opsRemoved = [...before.keys()].filter((id) => !after.has(id)).length;
	const keys = new Set([...Object.keys(point), ...Object.keys(current)]);
	keys.delete('budget:imported-txs');
	const changed = [...keys]
		.filter((k) => point[k] !== current[k])
		.map((k) => KEY_NAMES[k] ?? k.replace(/^budget:/, ''))
		.sort();
	return { opsAdded, opsRemoved, opsChanged, changed };
}

export type PointKind = 'import' | 'bulk' | 'ai' | 'daily' | 'restore' | 'manual';

/** Kind of a restore point, read from its reason (filters of the history page). */
export function pointKind(reason: string): PointKind {
	if (reason === 'quotidien') return 'daily';
	if (/^avant (retour|restauration)/.test(reason)) return 'restore';
	if (/\bIA\b/.test(reason)) return 'ai';
	if (/^avant modification groupée/.test(reason)) return 'bulk';
	if (/^avant import/.test(reason)) return 'import';
	return 'manual';
}
