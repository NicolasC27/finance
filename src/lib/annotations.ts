import type { CategoryId, Transaction } from './types';
import { spendAmount } from './data';
import { formatEUR, monthKeyOf } from './format';
import { median } from './forecast';
import { shiftMonthKey } from './insights';
import { merchantKey } from './merchant';
import { isBudgetFlow, type CatOf } from './totals';

/**
 * Annotated statement of the monthly report: the few operations that made the month, each with a
 * margin note, like a paper statement annotated by hand (pure).
 */

export type NoteKind = 'biggest' | 'unusual' | 'subscription' | 'new';

export interface StatementNote {
	tx: Transaction;
	categoryId: CategoryId;
	/** Spending of the operation (positive). */
	amount: number;
	kind: NoteKind;
	note: string;
}

/** Operations annotated at most. */
export const MAX_NOTES = 5;

/** Months of history a merchant's usual amount is read from. */
const HABIT_MONTHS = 6;

const times = (ratio: number): string => `${(Math.round(ratio * 10) / 10).toLocaleString('fr-FR')}×`;

/**
 * Notes of the month, ranked: the biggest expense, then amounts far above a merchant's habit (at
 * least twice its median of the 6 previous months, 15 € more), subscriptions that start (a merchant
 * first seen last month, debited again for the same amount), then new merchants (never seen before,
 * 20 € or more, only once the history covers two earlier months). One note per operation.
 */
export function annotateMonth(txs: readonly Transaction[], monthKey: string, catOf: CatOf): StatementNote[] {
	const prevKey = shiftMonthKey(monthKey, -1);
	const habitFrom = shiftMonthKey(monthKey, -HABIT_MONTHS);
	const spends: { tx: Transaction; categoryId: CategoryId; amount: number; month: string; merchant: string }[] = [];
	for (const tx of txs) {
		if (!isBudgetFlow(tx) || !tx.booking_date) continue;
		const categoryId = catOf(tx);
		const amount = spendAmount(tx, categoryId);
		if (amount === null || amount <= 0) continue;
		spends.push({ tx, categoryId, amount, month: monthKeyOf(tx.booking_date), merchant: merchantKey(tx.remittance_information) });
	}
	const ofMonth = spends.filter((s) => s.month === monthKey);
	if (ofMonth.length === 0) return [];

	const firstMonth = new Map<string, string>();
	const habit = new Map<string, number[]>();
	const lastMonthAmounts = new Map<string, number[]>();
	for (const s of spends) {
		if (s.month >= monthKey) continue;
		const seen = firstMonth.get(s.merchant);
		if (!seen || s.month < seen) firstMonth.set(s.merchant, s.month);
		if (s.month >= habitFrom) habit.set(s.merchant, [...(habit.get(s.merchant) ?? []), s.amount]);
		if (s.month === prevKey) lastMonthAmounts.set(s.merchant, [...(lastMonthAmounts.get(s.merchant) ?? []), s.amount]);
	}
	const earliest = spends.reduce((min, s) => (s.month < min ? s.month : min), monthKey);
	const historyCovers = earliest <= shiftMonthKey(monthKey, -2);

	const notes: (StatementNote & { rank: number })[] = [];
	const biggest = ofMonth.reduce((a, b) => (b.amount > a.amount ? b : a));
	notes.push({ ...biggest, kind: 'biggest', note: 'plus grosse dépense du mois', rank: 0 });

	for (const s of ofMonth) {
		if (s === biggest) continue;
		const past = habit.get(s.merchant) ?? [];
		const usual = past.length >= 3 ? median(past) : null;
		if (usual !== null && usual > 0 && s.amount >= 2 * usual && s.amount - usual >= 15) {
			notes.push({ ...s, kind: 'unusual', note: `${times(s.amount / usual)} plus que d'habitude (≈ ${formatEUR(usual)})`, rank: 1 + 1 / (s.amount - usual) });
			continue;
		}
		const last = lastMonthAmounts.get(s.merchant);
		if (firstMonth.get(s.merchant) === prevKey && last?.some((a) => Math.abs(a - s.amount) <= s.amount * 0.05)) {
			notes.push({ ...s, kind: 'subscription', note: 'abonnement qui démarre (2ᵉ prélèvement identique)', rank: 2 + 1 / s.amount });
			continue;
		}
		if (historyCovers && !firstMonth.has(s.merchant) && s.amount >= 20) {
			notes.push({ ...s, kind: 'new', note: 'nouveau commerçant', rank: 3 + 1 / s.amount });
		}
	}

	const seenMerchants = new Set<string>();
	return notes
		.sort((a, b) => a.rank - b.rank)
		.filter((n) => {
			if (n.kind === 'biggest') return true;
			const key = `${n.kind}:${merchantKey(n.tx.remittance_information)}`;
			if (seenMerchants.has(key)) return false;
			seenMerchants.add(key);
			return true;
		})
		.slice(0, MAX_NOTES)
		.map(({ tx, categoryId, amount, kind, note }) => ({ tx, categoryId, amount, kind, note }));
}
