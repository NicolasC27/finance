import type { CategoryId, Transaction } from './types';
import { signedAmount, spendAmount } from './data';
import { flowKind } from './flow';
import { merchantLabel } from './merchant';
import { daysInMonth, isBudgetFlow, type CatOf } from './totals';

/**
 * « Fil du mois » of the home page (pure): one slot per day of a month, what was spent on the days
 * gone by, what is expected on the days to come, and the income of each.
 */

export interface RibbonEntry {
	label: string;
	/** Positive amount. */
	amount: number;
}

export interface RibbonDay {
	iso: string;
	day: number;
	/** Monday = 0 … Sunday = 6. */
	weekday: number;
	/** Day gone by (today included): it shows what happened. */
	past: boolean;
	today: boolean;
	/** Net spending of the day (refunds deducted, never below zero). */
	spent: number;
	/** Spending operations of the day, biggest first. */
	spends: RibbonEntry[];
	/** Income received (past) or expected (future) that day. */
	income: RibbonEntry[];
	/** Debits expected that day (today and the days to come). */
	due: RibbonEntry[];
}

export interface RibbonInput {
	/** 'YYYY-MM'. */
	month: string;
	/** 'YYYY-MM-DD'. */
	today: string;
	txs: readonly Transaction[];
	catOf: CatOf;
	/** Expected debits (schedule). */
	due: readonly { date: string; label: string; amount?: number }[];
	/** Expected income (recurring credits). */
	expectedIncome: readonly { date: string; label: string; amount: number }[];
}

const r2 = (n: number): number => Math.round(n * 100) / 100;
const pad = (n: number): string => String(n).padStart(2, '0');

export function buildRibbon(input: RibbonInput): RibbonDay[] {
	const { month, today } = input;
	const [y, m] = month.split('-').map(Number);
	const days: RibbonDay[] = Array.from({ length: daysInMonth(month) }, (_, i) => {
		const iso = `${month}-${pad(i + 1)}`;
		return {
			iso,
			day: i + 1,
			weekday: (new Date(y!, m! - 1, i + 1).getDay() + 6) % 7,
			past: iso <= today,
			today: iso === today,
			spent: 0,
			spends: [],
			income: [],
			due: []
		};
	});
	const at = (iso: string): RibbonDay | undefined => (iso.slice(0, 7) === month ? days[Number(iso.slice(8, 10)) - 1] : undefined);

	for (const tx of input.txs) {
		if (!isBudgetFlow(tx) || !tx.booking_date) continue;
		const day = at(tx.booking_date);
		if (!day || !day.past) continue;
		const cat: CategoryId = input.catOf(tx);
		const spend = spendAmount(tx, cat);
		if (spend !== null) {
			day.spent += spend;
			if (spend > 0) day.spends.push({ label: merchantLabel(tx.remittance_information), amount: r2(spend) });
		} else if (flowKind(cat) === 'income' && signedAmount(tx) > 0) {
			day.income.push({ label: merchantLabel(tx.remittance_information), amount: r2(signedAmount(tx)) });
		}
	}
	for (const d of input.due) {
		const day = at(d.date);
		if (day && d.date >= today && (d.amount ?? 0) > 0) day.due.push({ label: d.label, amount: r2(d.amount!) });
	}
	for (const d of input.expectedIncome) {
		const day = at(d.date);
		if (day && !day.past) day.income.push({ label: d.label, amount: r2(d.amount) });
	}
	for (const day of days) {
		day.spent = r2(Math.max(0, day.spent));
		day.spends.sort((a, b) => b.amount - a.amount);
	}
	return days;
}

/** Debits expected on a day. */
export function dueTotal(day: RibbonDay): number {
	return day.due.reduce((s, e) => s + e.amount, 0);
}

/** Amount of the tallest tick: the heaviest day, spent then expected (1 when the month is empty). */
export function ribbonScale(days: readonly RibbonDay[]): number {
	return Math.max(1, ...days.map((d) => (d.past ? d.spent : 0) + dueTotal(d)));
}
