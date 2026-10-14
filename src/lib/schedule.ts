/**
 * Single schedule (pure, testable): every dated deadline the app knows — recurring direct debits,
 * payments in several times, loan instalments and end dates, tax balances, car milestones and insurance anniversary, employee
 * savings releases, savings goals — merged into one chronological list without duplicates.
 */

import { CATEGORIES, getCategory } from './categories';
import type { CategoryId } from './types';

export type ScheduleKind = 'debit' | 'loan' | 'tax' | 'car' | 'savings' | 'goal' | 'trip';

export interface ScheduleItem {
	/** Stable id (source + date): duplicates of one source collapse on it. */
	id: string;
	/** ISO date (AAAA-MM-JJ). */
	date: string;
	kind: ScheduleKind;
	/** Budget category of a direct debit or of the rent: its group on the page. */
	categoryId?: CategoryId;
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

/** Source of a deadline, in the plural: what the total of a list covers. */
export const KIND_LABELS: Readonly<Record<ScheduleKind, string>> = {
	debit: 'Prélèvements',
	loan: 'Crédits',
	tax: 'Impôts',
	car: 'Voiture',
	savings: 'Épargne salariale',
	goal: 'Objectifs',
	trip: 'Vacances'
};

/**
 * Group of a deadline, one icon and one colour wherever it is shown: the budget category for direct
 * debits and rent, taxes and the car under their own category, and three groups outside the budget.
 */
export type ScheduleGroup = CategoryId | 'loan' | 'savings' | 'goal';

/**
 * Groups outside the budget categories. Crédits takes the free hue farthest from the 13 category
 * colours (OKLab ΔE ≥ 12.8, ≥ 8.2 with colour blindness, ≥ 3.7:1 on the five theme surfaces;
 * checked on 2026-10-06), Épargne salariale the colour of the savings category (never a deadline
 * itself), Objectifs the champagne of the goal rings.
 */
const OWN_GROUPS: Readonly<Record<'loan' | 'savings' | 'goal', { label: string; color: string }>> = {
	loan: { label: KIND_LABELS.loan, color: '#8966e9' },
	savings: { label: KIND_LABELS.savings, color: getCategory('epargne').color },
	goal: { label: KIND_LABELS.goal, color: '#c9a86c' }
};

/** Order of the groups in filters and legends: budget categories first, « Autre » last. */
export const GROUP_ORDER: readonly ScheduleGroup[] = [...CATEGORIES.map((c) => c.id).filter((id) => id !== 'autre'), 'loan', 'savings', 'goal', 'autre'];

export function scheduleGroup(item: ScheduleItem): ScheduleGroup {
	if (item.kind === 'loan' || item.kind === 'savings' || item.kind === 'goal') return item.kind;
	if (item.kind === 'tax') return 'impots';
	if (item.kind === 'car') return 'voiture';
	if (item.kind === 'trip') return 'vacances';
	return item.categoryId ?? 'autre';
}

function isOwnGroup(group: ScheduleGroup): group is keyof typeof OWN_GROUPS {
	return Object.hasOwn(OWN_GROUPS, group);
}

export function groupLabel(group: ScheduleGroup): string {
	return isOwnGroup(group) ? OWN_GROUPS[group].label : getCategory(group).label;
}

/** Mark colour of a group (always shown next to its label or its icon). */
export function groupColor(group: ScheduleGroup): string {
	return isOwnGroup(group) ? OWN_GROUPS[group].color : getCategory(group).color;
}

const KIND_ORDER: readonly ScheduleKind[] = ['tax', 'loan', 'debit', 'car', 'savings', 'goal', 'trip'];

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
	/** Loan instalment debited from the current account (no loan account in the app). */
	loan?: boolean;
	/** Budget category of the debit. */
	categoryId?: CategoryId;
}

const LOAN_LABEL = /\b(PRET|ECH(EANCE)?S?( DE)? (PRET|CREDIT)|CREDIT (AUTO|CONSO|IMMO)|PASSEPORT CREDIT|COFIDIS|CETELEM|SOFINCO|FRANFINANCE|ONEY|YOUNITED|FLOA|CREDIPAR|DIAC|MENSUALITE)\b/;

/** Does a debit label look like a loan instalment (« Ech prêt auto », « Cetelem »)? */
export function isLoanLabel(label: string): boolean {
	return LOAN_LABEL.test(label.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
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
			out.push({ id: `debit:${r.key}:${date}`, date, kind: r.tax ? 'tax' : r.loan ? 'loan' : 'debit', ...(r.categoryId ? { categoryId: r.categoryId } : {}), label: r.label, detail: r.cadence, amount: r.amount, href: '/budget', confidence: r.confidence });
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

export interface TripSource {
	id: string;
	name: string;
	/** Departure (ISO), '' without dates. */
	start: string;
	/** Planned total of the envelopes (€). */
	planned: number;
	checklist: readonly { id: string; label: string; date: string; done: boolean }[];
}

/** Open dated checklist items of the trips, and the departure day itself with the planned budget. */
export function tripItems(trips: readonly TripSource[], from: string, to: string): ScheduleItem[] {
	const out: ScheduleItem[] = [];
	for (const t of trips) {
		for (const c of t.checklist) {
			if (c.done || !c.date || c.date < from || c.date > to) continue;
			out.push({ id: `trip:${t.id}:${c.id}`, date: c.date, kind: 'trip', label: `${c.label} · ${t.name}`, detail: 'réservation à faire', href: `/vacances/${t.id}` });
		}
		if (t.start && t.start >= from && t.start <= to) out.push({ id: `trip:${t.id}:depart`, date: t.start, kind: 'trip', label: `Départ · ${t.name}`, detail: 'budget prévu du voyage', ...(t.planned > 0 ? { amount: t.planned } : {}), href: `/vacances/${t.id}` });
	}
	return out;
}

/** Expected instalment of a payment in several times (quick entry waiting for the bank debit). */
export interface InstalmentSource {
	key: string;
	date: string;
	label: string;
	amount: number;
	n: number;
	of: number;
	categoryId: CategoryId;
}

/** Next instalments of the payments in several times, under their budget category. */
export function instalmentItems(list: readonly InstalmentSource[], from: string, to: string): ScheduleItem[] {
	return list
		.filter((i) => i.date >= from && i.date <= to)
		.map((i) => ({ id: `instalment:${i.key}`, date: i.date, kind: 'debit' as const, categoryId: i.categoryId, label: `${i.label} · ${i.n}/${i.of}`, detail: `paiement en ${i.of} fois`, amount: i.amount, href: '/transactions' }));
}

/** Subcategories of variable spending: never a deadline, even when a debit looks regular (toll badge, fuel card…). */
export const VARIABLE_SUBS: ReadonlySet<string> = new Set(['peages-parkings', 'carburant', 'courses', 'restaurants', 'petits-commercants', 'vtc-taxi', 'transports-commun', 'shopping', 'pharmacie']);

export interface RentSource {
	/** Usual monthly rent (€) and day of the month it is paid. */
	amount: number;
	day: number;
}

/**
 * Rent read from the « Loyer & charges » payments of the last three complete months (whatever the
 * label, which often changes every month): the median monthly total and the usual day, when at
 * least two of those months have a payment. Null otherwise.
 */
export function rentSource(payments: readonly { date: string; amount: number }[], today: string): RentSource | null {
	const months = [1, 2, 3].map((k) => addMonths(`${today.slice(0, 7)}-01`, -k).slice(0, 7));
	const byMonth = new Map<string, { total: number; day: number; biggest: number }>();
	for (const p of payments) {
		const m = p.date.slice(0, 7);
		if (!months.includes(m) || !(p.amount > 0)) continue;
		const g = byMonth.get(m) ?? { total: 0, day: 1, biggest: 0 };
		g.total += p.amount;
		if (p.amount > g.biggest) {
			g.biggest = p.amount;
			g.day = Number(p.date.slice(8, 10));
		}
		byMonth.set(m, g);
	}
	if (byMonth.size < 2) return null;
	const med = (v: number[]) => {
		const s = [...v].sort((a, b) => a - b);
		return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
	};
	const groups = [...byMonth.values()];
	return { amount: Math.round(med(groups.map((g) => g.total)) * 100) / 100, day: Math.round(med(groups.map((g) => g.day))) };
}

/** Monthly rent from the next usual day on (the current month only while its day is still ahead). */
export function rentItems(rent: RentSource | null, from: string, to: string): ScheduleItem[] {
	if (!rent) return [];
	const out: ScheduleItem[] = [];
	for (let k = 0; k < 24; k++) {
		const date = dayOfMonth(addMonths(`${from.slice(0, 7)}-01`, k).slice(0, 7), rent.day);
		if (date > to) break;
		if (date < from) continue;
		out.push({ id: `rent:${date}`, date, kind: 'debit', categoryId: 'logement', label: 'Loyer', detail: 'loyer & charges, mensuel', amount: rent.amount, href: '/budget' });
	}
	return out;
}

/** Same payment seen twice: a detected direct debit that is really a loan instalment or a tax payment. */
function sameAmountNearDate(a: ScheduleItem, b: ScheduleItem): boolean {
	if (a.amount === undefined || b.amount === undefined) return false;
	return Math.abs(a.amount - b.amount) <= Math.max(1, 0.02 * b.amount) && Math.abs(daysBetween(a.date, b.date)) <= 4;
}

/**
 * Merged schedule between `from` and `to`: one item per id, a detected direct debit dropped when a
 * more precise source (loan instalment, tax balance, rent, expected instalment of a payment in
 * several times) has the same amount within 4 days; sorted by date, then kind, then label.
 */
export function buildSchedule(parts: readonly (readonly ScheduleItem[])[], from: string, to: string): ScheduleItem[] {
	const lead = addDays(from, -5);
	const byId = new Map<string, ScheduleItem>();
	for (const item of parts.flat()) if (item.date >= lead && item.date <= to && !byId.has(item.id)) byId.set(item.id, item);
	const all = [...byId.values()];
	const precise = all.filter((i) => (i.kind === 'loan' || i.kind === 'tax' || i.id.startsWith('rent:') || i.id.startsWith('instalment:')) && !i.id.startsWith('debit:'));
	const kept: ScheduleItem[] = [];
	for (const i of all) {
		if (!i.id.startsWith('debit:')) {
			if (i.date >= from) kept.push(i);
			continue;
		}
		if (i.date < from) continue;
		const twin = precise.find((p) => sameAmountNearDate(i, p));
		if (!twin) kept.push(i);
		else if (twin.date < from && !kept.some((k) => k.id === twin.id)) kept.push({ ...twin, date: i.date });
	}
	return kept.sort((a, b) => a.date.localeCompare(b.date) || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.label.localeCompare(b.label, 'fr'));
}

/** Total of the known amounts of a list. */
export function scheduleTotal(items: readonly ScheduleItem[]): number {
	return Math.round(items.reduce((s, i) => s + (i.amount ?? 0), 0) * 100) / 100;
}
