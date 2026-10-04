/**
 * Savings goals (`budget:goals`): reactive store + pure functions.
 * Full CRUD, quick adjustment, required monthly pace.
 */

import { persistJson } from './storage';

export interface Goal {
	id: string;
	name: string;
	targetAmount: number;
	currentAmount: number;
	targetDate?: string; // ISO "YYYY-MM-DD", optional
	color?: string;
	createdAt: number;
}

export const GOALS_KEY = 'budget:goals';

/** Cyclic goal palette (design system tones). */
export const GOAL_COLORS = ['#c9a86c', '#8f9a7e', '#cd9b1f', '#b08d97', '#c97e5a', '#7fa08a'];

const canStore = typeof localStorage !== 'undefined';

function loadGoals(): Goal[] {
	if (!canStore) return [];
	try {
		const parsed = JSON.parse(localStorage.getItem(GOALS_KEY) ?? '[]') as Goal[];
		return Array.isArray(parsed)
			? parsed.filter((g) => g && typeof g.id === 'string' && typeof g.targetAmount === 'number')
			: [];
	} catch {
		return [];
	}
}

function persist(): void {
	if (!canStore) return;
	persistJson(GOALS_KEY, goalsState.goals);
}

export const goalsState = $state({
	goals: loadGoals()
});

/** Creates a goal (cyclic colour when missing) and returns it. */
export function addGoal(input: { name: string; targetAmount: number; targetDate?: string; color?: string; currentAmount?: number }): Goal {
	const goal: Goal = {
		id: `g-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4).toString(36)}`,
		name: input.name.trim(),
		targetAmount: Math.max(1, Math.round(input.targetAmount * 100) / 100),
		currentAmount: Math.max(0, Math.round((input.currentAmount ?? 0) * 100) / 100),
		targetDate: input.targetDate || undefined,
		color: input.color ?? GOAL_COLORS[goalsState.goals.length % GOAL_COLORS.length],
		createdAt: Date.now()
	};
	goalsState.goals = [...goalsState.goals, goal];
	persist();
	return goal;
}

/** Updates a goal (editing). */
export function updateGoal(id: string, patch: Partial<Omit<Goal, 'id' | 'createdAt'>>): void {
	goalsState.goals = goalsState.goals.map((g) => (g.id === id ? { ...g, ...patch } : g));
	persist();
}

/** Quick adjustment of the saved amount (+/−), bounded to [0, target × 2]. */
export function adjustGoal(id: string, delta: number): void {
	goalsState.goals = goalsState.goals.map((g) =>
		g.id === id
			? { ...g, currentAmount: Math.round(Math.min(Math.max(g.currentAmount + delta, 0), g.targetAmount * 2) * 100) / 100 }
			: g
	);
	persist();
}

/** Deletes a goal. */
export function removeGoal(id: string): void {
	goalsState.goals = goalsState.goals.filter((g) => g.id !== id);
	persist();
}

/**
 * Pace needed in €/month to reach the target by the target date: remainder ÷
 * remaining calendar months (rounded up, at least 1 month). null without a
 * date.
 */
export function monthlyNeeded(goal: Goal, from: Date = new Date()): number | null {
	if (!goal.targetDate) return null;
	const remaining = goal.targetAmount - goal.currentAmount;
	if (remaining <= 0) return 0;
	const end = new Date(`${goal.targetDate}T12:00:00`);
	const months = Math.max(1, (end.getFullYear() - from.getFullYear()) * 12 + (end.getMonth() - from.getMonth()));
	return Math.ceil(remaining / months);
}

/** Suggested pace without a target date: spread the remainder over 12 months. */
export function monthlySuggested(goal: Goal): number {
	return Math.max(1, Math.ceil((goal.targetAmount - goal.currentAmount) / 12));
}
