import type { ActivityMonth, Payslip } from './portage';

/**
 * Where an invoice goes (pure, testable): the month's revenue split into what the umbrella
 * company keeps (management fee, activity charges), what is set aside for you (financial reserve,
 * provision, culture vouchers), the employer and employee contributions, the withholding tax,
 * your half of the meal vouchers, the expenses paid back, and the net salary. Built from the
 * activity statement and the payslip of the month. The statement prints its deductions with a
 * minus sign and the parser keeps it: every row is taken as an absolute value here. The employer
 * contributions are what remains once everything else is known, unless the statement gives them
 * (then the rest, if any, is « autres retenues »). When the documents do not add up, `gap` says
 * by how much and the shares stay fractions of the revenue.
 */

export type FlowId = 'gestion' | 'activite' | 'cheques' | 'provision' | 'reserve' | 'patronales' | 'autres' | 'cotisations' | 'impot' | 'titres' | 'frais' | 'net';

export interface FlowSegment {
	id: FlowId;
	label: string;
	amount: number;
	/** Part of the revenue, 0 to 1. */
	share: number;
	/** Whole percent of the revenue; the parts sum to 100 when the documents add up. */
	percent: number;
}

export interface InvoiceFlow {
	/** Revenue excluding VAT. */
	total: number;
	/** From the invoice to your pocket, left to right; empty parts left out. */
	segments: FlowSegment[];
	/** Net salary (expenses paid back excluded) over the revenue. */
	netShare: number;
	/** What the parts add up to beyond the revenue (0 when the documents agree, negative when something is missing). */
	gap: number;
}

const LABELS: Record<FlowId, string> = {
	gestion: 'Frais de gestion',
	activite: 'Charges d’activité',
	cheques: 'Chèques culture',
	provision: 'Provision',
	reserve: 'Réserve financière',
	patronales: 'Charges patronales',
	autres: 'Autres retenues',
	cotisations: 'Cotisations salariales',
	impot: 'Impôt à la source',
	titres: 'Titres-restaurant, ta part',
	frais: 'Frais remboursés',
	net: 'Salaire net'
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const abs = (v: number | undefined): number => Math.abs(v ?? 0);

/** Whole percents that add up to `target`, the largest remainders rounded up first. */
export function roundPercents(values: readonly number[], target = 100): number[] {
	const sum = values.reduce((s, v) => s + v, 0);
	if (sum <= 0) return values.map(() => 0);
	const exact = values.map((v) => (v / sum) * target);
	const out = exact.map((v) => Math.floor(v));
	let left = target - out.reduce((s, v) => s + v, 0);
	const order = exact.map((v, i) => ({ i, rest: v - Math.floor(v) })).sort((a, b) => b.rest - a.rest || a.i - b.i);
	for (const { i } of order) {
		if (left <= 0) break;
		out[i]!++;
		left--;
	}
	return out;
}

/** The month's flow, null without a revenue figure. */
export function invoiceFlow(activity: ActivityMonth | undefined, payslip: Payslip | undefined): InvoiceFlow | null {
	const total = activity?.ca;
	if (!activity || !total || total <= 0) return null;
	const gestion = abs(activity.fraisGestion);
	const activite = abs(activity.chargesActivite);
	const cheques = abs(activity.cheques);
	const provision = abs(activity.provision);
	const reserve = abs(activity.reserve);
	const frais = abs(payslip?.rembFrais ?? activity.rembFrais);
	const brut = abs(payslip?.brut ?? activity.brut);
	const impot = abs(payslip?.pas?.montant ?? activity.impot);
	const titres = abs(payslip?.titresRestaurant?.partSalariale);
	const net = Math.max(0, abs(payslip?.netPaye ?? activity.netApresImpot) - frais);
	const betweenGrossAndNet = Math.max(0, brut - impot - titres - net);
	const cotisationsKnown = activity.chargesSalariales === undefined ? undefined : abs(activity.chargesSalariales);
	const cotisations = cotisationsKnown !== undefined && cotisationsKnown <= betweenGrossAndNet ? cotisationsKnown : betweenGrossAndNet;
	const residual = Math.max(0, total - gestion - activite - cheques - provision - reserve - frais - brut);
	const patronalesKnown = activity.chargesPatronales === undefined ? undefined : abs(activity.chargesPatronales);
	const patronales = patronalesKnown !== undefined && patronalesKnown <= residual ? patronalesKnown : residual;
	const autres = residual - patronales + (betweenGrossAndNet - cotisations);
	const raw: [FlowId, number][] = [
		['gestion', gestion],
		['activite', activite],
		['cheques', cheques],
		['provision', provision],
		['reserve', reserve],
		['patronales', patronales],
		['autres', autres],
		['cotisations', cotisations],
		['impot', impot],
		['titres', titres],
		['frais', frais],
		['net', net]
	];
	const kept = raw.filter(([, v]) => v > 0.005);
	const sum = kept.reduce((s, [, v]) => s + v, 0);
	const percents = roundPercents(
		kept.map(([, v]) => v),
		Math.round((sum / total) * 100)
	);
	return {
		total,
		segments: kept.map(([id, v], i) => ({ id, label: LABELS[id], amount: r2(v), share: v / total, percent: percents[i]! })),
		netShare: net / total,
		gap: r2(sum - total)
	};
}
