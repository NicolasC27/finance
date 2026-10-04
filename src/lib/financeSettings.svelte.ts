import type { CategoryId } from './types';
import { persistJson } from './storage';
import { readIndexation, type Indexation } from './indexation';
import { budgetState, setBudget } from './budget.svelte';

/**
 * Settings of the 'real finances' cards (persisted, encrypted database):
 * - `budget:rendements`: typed rate of a placement (in-house savings account, LEP…);
 * - `budget:credits-couts`: corrected rate, payment or capital of a loan;
 * - `budget:projection`: assumptions of the net-worth projection;
 * - `budget:indexation`: last indexation of the envelopes (undoable).
 * Everything is optional: without input, values come from the statements.
 */

export interface LoanSetting {
	taux?: number;
	echeance?: number;
	capital?: number;
}

export interface ProjectionSetting {
	epargne?: number;
	reel?: number;
	cible?: number;
	annees?: 5 | 10 | 20;
}

const canStore = typeof localStorage !== 'undefined';

function readSetting<T>(key: string, validate: (v: unknown) => T | null, fallback: T): T {
	if (!canStore) return fallback;
	try {
		return validate(JSON.parse(localStorage.getItem(key) ?? 'null')) ?? fallback;
	} catch {
		return fallback;
	}
}

/** Object of finite numbers (invalid values ignored). */
function numbers(v: unknown): Record<string, number> | null {
	if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
	return Object.fromEntries(Object.entries(v).filter(([, x]) => typeof x === 'number' && Number.isFinite(x))) as Record<string, number>;
}

function credits(v: unknown): Record<string, LoanSetting> | null {
	if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
	const out: Record<string, LoanSetting> = {};
	for (const [id, r] of Object.entries(v)) {
		const n = numbers(r);
		if (n) out[id] = { ...(n.taux !== undefined ? { taux: n.taux } : {}), ...(n.echeance !== undefined ? { echeance: n.echeance } : {}), ...(n.capital !== undefined ? { capital: n.capital } : {}) };
	}
	return out;
}

function projection(v: unknown): ProjectionSetting | null {
	const n = numbers(v);
	if (!n) return null;
	return { ...n, ...(n.annees !== undefined && ![5, 10, 20].includes(n.annees) ? { annees: 10 } : {}) } as ProjectionSetting;
}

export const financeSettings = $state({
	rendements: readSetting('budget:rendements', numbers, {} as Record<string, number>),
	credits: readSetting('budget:credits-couts', credits, {} as Record<string, LoanSetting>),
	projection: readSetting('budget:projection', projection, {} as ProjectionSetting),
	indexation: readSetting('budget:indexation', readIndexation, null as Indexation | null)
});

/** Typed rate of a placement (null: back to the rate found automatically). */
export function setInvestmentRate(id: string, rate: number | null): void {
	const next = { ...financeSettings.rendements };
	if (rate === null || !Number.isFinite(rate)) delete next[id];
	else next[id] = Math.round(rate * 100) / 100;
	financeSettings.rendements = next;
	persistJson('budget:rendements', next);
}

/** Corrects (or hands back to the statements, with undefined) the rate, payment or capital of a loan. */
export function setLoanSetting(id: string, patch: LoanSetting): void {
	const r: LoanSetting = { ...financeSettings.credits[id], ...patch };
	for (const k of Object.keys(r) as (keyof LoanSetting)[]) if (r[k] === undefined || !Number.isFinite(r[k]!) || r[k]! <= 0) delete r[k];
	const next = { ...financeSettings.credits, [id]: r };
	if (!Object.keys(r).length) delete next[id];
	financeSettings.credits = next;
	persistJson('budget:credits-couts', next);
}

export function setProjectionSetting(patch: ProjectionSetting): void {
	const r: ProjectionSetting = { ...financeSettings.projection, ...patch };
	for (const k of Object.keys(r) as (keyof ProjectionSetting)[]) if (r[k] === undefined || !Number.isFinite(r[k]!)) delete r[k];
	financeSettings.projection = r;
	persistJson('budget:projection', r);
}

/** Applies indexed envelopes and remembers the indexation (to undo it). */
export function applyIndexation(ix: Indexation): void {
	for (const [cat, amount] of Object.entries(ix.apres) as [CategoryId, number][]) if (budgetState.budgets[cat] !== amount) setBudget(cat, amount);
	financeSettings.indexation = ix;
	persistJson('budget:indexation', ix);
}

/** Undoes the last indexation: previous envelopes restored. */
export function undoIndexation(): void {
	const ix = financeSettings.indexation;
	if (!ix) return;
	for (const [cat, amount] of Object.entries(ix.avant) as [CategoryId, number][]) setBudget(cat, amount);
	financeSettings.indexation = null;
	persistJson('budget:indexation', null);
}
