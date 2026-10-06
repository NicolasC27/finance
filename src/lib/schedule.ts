/**
 * Single schedule (pure, testable): every dated deadline the app knows — recurring direct debits,
 * loan instalments and end dates, tax balances, car milestones and insurance anniversary, employee
 * savings releases, savings goals — merged into one chronological list without duplicates.
 */

export type ScheduleKind = 'debit' | 'loan' | 'tax' | 'car' | 'savings' | 'goal';

export interface ScheduleItem {
	/** Stable id (source + date): duplicates of one source collapse on it. */
	id: string;
	/** ISO date (AAAA-MM-JJ). */
	date: string;
	kind: ScheduleKind;
	label: string;
	detail?: string;
	/** Expected amount (€, positive) when known. */
	amount?: number;
	/** Page that shows the source. */
	href: string;
	/** Amount masked in privacy mode (wealth, loans). */
	sensitive?: boolean;
	/** Reliability of a detected recurrence. */
	confidence?: 'haute' | 'moyenne' | 'faible';
}

export const KIND_LABELS: Readonly<Record<ScheduleKind, string>> = {
	debit: 'Prélèvements',
	loan: 'Crédits',
	tax: 'Impôts',
	car: 'Voiture',
	savings: 'Épargne salariale',
	goal: 'Objectifs'
};

/** Marker colour of each kind (always shown next to its label). */
export const KIND_COLORS: Readonly<Record<ScheduleKind, string>> = {
	debit: 'var(--text-secondary)',
	loan: 'var(--debit)',
	tax: 'var(--amber)',
	car: 'var(--olive)',
	savings: 'var(--accent)',
	goal: 'var(--beige)'
};

const KIND_ORDER: readonly ScheduleKind[] = ['tax', 'loan', 'debit', 'car', 'savings', 'goal'];

const DAY = 86_400_000;
const utc = (d: string) => Date.parse(`${d}T00:00:00Z`);
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

export function addDays(date: string, n: number): string {
	return iso(utc(date) + n * DAY);
}

/** Same day `n` months later, clamped to the month's last day (31 jan + 1 → 28/29 feb). */
export function addMonths(date: string, n: number): string {
	const [y, m, d] = date.split('-').map(Number) as [number, number, number];
	const total = y * 12 + (m - 1) + n;
	const year = Math.floor(total / 12);
	const month = total % 12;
	const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
	return `${year}-${String(month + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

/** Day `day` of a month (AAAA-MM), clamped to its last day. */
export function dayOfMonth(month: string, day: number): string {
	const [y, m] = month.split('-').map(Number) as [number, number];
	const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
	return `${month}-${String(Math.min(day, last)).padStart(2, '0')}`;
}

export function daysBetween(from: string, to: string): number {
	return Math.round((utc(to) - utc(from)) / DAY);
}

export interface RecurringSource {
	key: string;
	label: string;
	amount: number;
	cadence: 'hebdomadaire' | 'mensuelle' | 'trimestrielle';
	nextDate: string;
	confidence: 'haute' | 'moyenne' | 'faible';
	/** Tax direct debit (withholding tax, instalments) rather than a plain one. */
	tax?: boolean;
}

/** Every occurrence of the recurring direct debits between `from` and `to` (both included). */
export function recurringItems(sources: readonly RecurringSource[], from: string, to: string): ScheduleItem[] {
	const out: ScheduleItem[] = [];
	for (const r of sources) {
		const step = (date: string, k: number) => (r.cadence === 'hebdomadaire' ? addDays(date, 7 * k) : addMonths(date, (r.cadence === 'trimestrielle' ? 3 : 1) * k));
		for (let k = 0; k < 60; k++) {
			const date = step(r.nextDate, k);
			if (date > to) break;
			if (date < from) continue;
			out.push({ id: `debit:${r.key}:${date}`, date, kind: r.tax ? 'tax' : 'debit', label: r.label, detail: r.cadence, amount: r.amount, href: '/budget', confidence: r.confidence });
		}
	}
	return out;
}

export interface LoanSource {
	accountId: string;
	label: string;
	/** Monthly instalment (€). */
	payment: number;
	/** Date of the last instalment seen on the statements (its day of month repeats). */
	lastPaymentDate: string | null;
	/** Month of the last instalment (AAAA-MM). */
	endMonth: string | null;
}

/** Monthly instalments up to the loan's last one, plus the last instalment itself. */
export function loanItems(loans: readonly LoanSource[], from: string, to: string): ScheduleItem[] {
	const out: ScheduleItem[] = [];
	for (const l of loans) {
		const lastDay = l.endMonth ? dayOfMonth(l.endMonth, Number(l.lastPaymentDate?.slice(8, 10) ?? 5)) : null;
		if (l.lastPaymentDate && l.payment > 0) {
			for (let k = 1; k < 600; k++) {
				const date = addMonths(l.lastPaymentDate, k);
				if (date > to || (lastDay && date > lastDay)) break;
				if (date < from) continue;
				const final = lastDay !== null && date.slice(0, 7) === l.endMonth;
				out.push({ id: `loan:${l.accountId}:${date}`, date, kind: 'loan', label: final ? `Dernière échéance · ${l.label}` : `Échéance · ${l.label}`, amount: l.payment, href: '/patrimoine', sensitive: true });
			}
		}
		if (lastDay && lastDay >= from && lastDay <= to && !out.some((i) => i.id === `loan:${l.accountId}:${lastDay}`)) {
			out.push({ id: `loan:${l.accountId}:${lastDay}`, date: lastDay, kind: 'loan', label: `Dernière échéance · ${l.label}`, detail: 'fin estimée du crédit', ...(l.payment > 0 ? { amount: l.payment } : {}), href: '/patrimoine', sensitive: true });
		}
	}
	return out;
}

export interface TaxSource {
	year: number;
	remaining?: number;
	remainingDueDate?: string;
}

/** Balances left to pay on the tax notices. */
export function taxItems(notices: readonly TaxSource[], from: string, to: string): ScheduleItem[] {
	return notices
		.filter((n) => n.remainingDueDate && n.remaining && n.remaining > 0 && n.remainingDueDate >= from && n.remainingDueDate <= to)
		.map((n) => ({ id: `tax:${n.year}`, date: n.remainingDueDate!, kind: 'tax' as const, label: `Solde de l'impôt sur les revenus ${n.year}`, detail: "avis d'impôt", amount: n.remaining!, href: '/patrimoine' }));
}

export interface CarSource {
	id: string;
	name: string;
	milestones: readonly { id: string; label: string; date: string | null; detail: string }[];
	/** First car insurance payment seen: the contract's anniversary repeats each year. */
	insuranceSince: string | null;
}

/** Roadworthiness test, mileage milestones, warranty end and the insurance anniversary. */
export function carItems(cars: readonly CarSource[], from: string, to: string): ScheduleItem[] {
	const out: ScheduleItem[] = [];
	for (const c of cars) {
		for (const m of c.milestones) {
			if (!m.date || m.date < from || m.date > to) continue;
			out.push({ id: `car:${c.id}:${m.id}`, date: m.date, kind: 'car', label: `${m.label} · ${c.name}`, detail: m.detail, href: '/voiture' });
		}
		if (c.insuranceSince) {
			let date = c.insuranceSince;
			for (let k = 1; date < from && k < 100; k++) date = addMonths(c.insuranceSince, 12 * k);
			if (date !== c.insuranceSince && date <= to) {
				out.push({ id: `car:${c.id}:assurance`, date, kind: 'car', label: `Anniversaire de l'assurance · ${c.name}`, detail: 'résiliable à tout moment après un an (loi Hamon) : bon moment pour comparer', href: '/voiture' });
			}
		}
	}
	return out;
}

export interface SavingsSource {
	fund: string;
	/** ISO date, 'retraite' or 'inconnue'. */
	availableAt: string;
	amount: number;
}

/** Employee savings becoming available, one item per release date. */
export function savingsItems(holdings: readonly SavingsSource[], from: string, to: string): ScheduleItem[] {
	const byDate = new Map<string, { amount: number; funds: string[] }>();
	for (const h of holdings) {
		if (!/^\d{4}-\d{2}-\d{2}$/.test(h.availableAt) || h.availableAt < from || h.availableAt > to) continue;
		const g = byDate.get(h.availableAt) ?? { amount: 0, funds: [] };
		g.amount += h.amount;
		g.funds.push(h.fund);
		byDate.set(h.availableAt, g);
	}
	return [...byDate].map(([date, g]) => ({ id: `savings:${date}`, date, kind: 'savings' as const, label: 'Épargne salariale disponible', detail: g.funds.join(', '), amount: Math.round(g.amount * 100) / 100, href: '/patrimoine', sensitive: true }));
}

export interface GoalSource {
	id: string;
	name: string;
	targetDate?: string;
	targetAmount: number;
	currentAmount: number;
}

/** Target dates of the savings goals not reached yet. */
export function goalItems(goals: readonly GoalSource[], from: string, to: string): ScheduleItem[] {
	return goals
		.filter((g) => g.targetDate && g.targetDate >= from && g.targetDate <= to && g.currentAmount < g.targetAmount)
		.map((g) => ({ id: `goal:${g.id}`, date: g.targetDate!, kind: 'goal' as const, label: `Objectif · ${g.name}`, detail: 'date visée', amount: Math.round((g.targetAmount - g.currentAmount) * 100) / 100, href: '/budget', sensitive: true }));
}

/** Same payment seen twice: a detected direct debit that is really a loan instalment or a tax payment. */
function sameAmountNearDate(a: ScheduleItem, b: ScheduleItem): boolean {
	if (a.amount === undefined || b.amount === undefined) return false;
	return Math.abs(a.amount - b.amount) <= Math.max(1, 0.02 * b.amount) && Math.abs(daysBetween(a.date, b.date)) <= 4;
}

/**
 * Merged schedule between `from` and `to`: one item per id, a detected direct debit dropped when a
 * more precise source (loan instalment, tax balance) has the same amount within 4 days; sorted by
 * date, then kind, then label.
 */
export function buildSchedule(parts: readonly (readonly ScheduleItem[])[], from: string, to: string): ScheduleItem[] {
	const byId = new Map<string, ScheduleItem>();
	for (const item of parts.flat()) if (item.date >= from && item.date <= to && !byId.has(item.id)) byId.set(item.id, item);
	const all = [...byId.values()];
	const precise = all.filter((i) => i.kind === 'loan' || (i.kind === 'tax' && !i.id.startsWith('debit:')));
	const kept = all.filter((i) => !i.id.startsWith('debit:') || !precise.some((p) => sameAmountNearDate(i, p)));
	return kept.sort((a, b) => a.date.localeCompare(b.date) || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.label.localeCompare(b.label, 'fr'));
}

/** Total of the known amounts of a list. */
export function scheduleTotal(items: readonly ScheduleItem[]): number {
	return Math.round(items.reduce((s, i) => s + (i.amount ?? 0), 0) * 100) / 100;
}
