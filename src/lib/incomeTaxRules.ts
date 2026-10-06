/**
 * French income tax rules by income year — constants only.
 *
 * Sources:
 * - Income 2025 (paid 2026): loi de finances pour 2026, scale indexed by 0.9 %
 *   (https://www.impots.gouv.fr/particulier/calcul-de-limpot-sur-le-revenu).
 * - Income 2026 (paid 2027): projet de loi de finances pour 2027, filed on 1 October 2026, scale
 *   indexed by 2.1 % — PROVISIONAL until the law passes (late December): update then.
 * - Décote, family quotient cap, 10 % deduction floor and cap: same texts.
 * - Withholding regularisation: balance over 300 € taken in four instalments, September to December.
 *
 * To update: each December when the finance law passes (new income year, provisional → final).
 */

export interface TaxYearRules {
	incomeYear: number;
	/** Text the figures come from. */
	source: string;
	/** Bill not voted yet: figures may still change. */
	provisional: boolean;
	/** Progressive scale per part: rate (%) up to `upTo` (€), the last bracket open. */
	brackets: readonly { upTo: number | null; rate: number }[];
	/** Flat 10 % deduction for professional expenses, per person. */
	deduction: { rate: number; floor: number; cap: number };
	/** Family quotient cap per extra half part, and for the first child of a single parent. */
	qfCapPerHalfPart: number;
	qfCapSingleParent: number;
	/** Décote: forfait − rate × gross tax, for a single person and a couple. */
	decote: { single: number; couple: number; rate: number };
}

/** Net tax under this amount is not collected (€). */
export const COLLECTION_THRESHOLD = 61;
/** A regularisation over this amount is split in four monthly instalments (€). */
export const INSTALMENT_THRESHOLD = 300;

export const TAX_RULES: Readonly<Record<number, TaxYearRules>> = {
	2025: {
		incomeYear: 2025,
		source: 'loi de finances pour 2026',
		provisional: false,
		brackets: [
			{ upTo: 11600, rate: 0 },
			{ upTo: 29579, rate: 11 },
			{ upTo: 84577, rate: 30 },
			{ upTo: 181917, rate: 41 },
			{ upTo: null, rate: 45 }
		],
		deduction: { rate: 10, floor: 509, cap: 14555 },
		qfCapPerHalfPart: 1807,
		qfCapSingleParent: 4262,
		decote: { single: 897, couple: 1483, rate: 45.25 }
	},
	2026: {
		incomeYear: 2026,
		source: 'projet de loi de finances pour 2027 (non voté)',
		provisional: true,
		brackets: [
			{ upTo: 11844, rate: 0 },
			{ upTo: 30200, rate: 11 },
			{ upTo: 86353, rate: 30 },
			{ upTo: 185737, rate: 41 },
			{ upTo: null, rate: 45 }
		],
		deduction: { rate: 10, floor: 520, cap: 14861 },
		qfCapPerHalfPart: 1845,
		qfCapSingleParent: 4352,
		decote: { single: 915, couple: 1513, rate: 45.25 }
	}
};

/**
 * Scale in force today for an income year whose rules are still a bill: the last voted year before
 * it (what applies if the bill is not voted in time). Null when the year's rules are final.
 */
export function currentLawFor(year: number): TaxYearRules | null {
	const own = rulesFor(year);
	if (!own.provisional) return null;
	const voted = Object.values(TAX_RULES)
		.filter((r) => !r.provisional && r.incomeYear < own.incomeYear)
		.sort((a, b) => b.incomeYear - a.incomeYear)[0];
	return voted ?? null;
}

/**
 * Why the rules of an income year need updating on `today` (YYYY-MM-DD), else null: the year is
 * missing from the table (an older scale is used), or it is still a bill after 1 January of the
 * next year, when the finance law has normally been voted.
 */
export function rulesWarning(year: number, today: string): string | null {
	const r = rulesFor(year);
	const prev = TAX_RULES[year - 1];
	const stalePrev = prev?.provisional && today >= `${year}-01-01` ? ` Le barème des revenus ${year - 1} (déclarés en mai ${year}) vient aussi encore du projet : à mettre à jour.` : '';
	if (!r.exact) return `Le barème des revenus ${year} n’est pas encore dans l’app : le calcul utilise celui des revenus ${r.incomeYear}. Il faut l’ajouter (loi de finances pour ${year + 1}, déposée début octobre ${year}).${stalePrev}`;
	if (r.provisional && today >= `${year + 1}-01-01`) return `Le barème des revenus ${year} vient encore du projet (${r.source}) : la loi de finances pour ${year + 1} a normalement été votée fin décembre. Il faut le mettre à jour avec les chiffres votés.`;
	return null;
}

/** Rules of an income year: the closest known year when it is not in the table. */
export function rulesFor(year: number): TaxYearRules & { exact: boolean } {
	const years = Object.keys(TAX_RULES).map(Number).sort((a, b) => a - b);
	const known = TAX_RULES[year];
	if (known) return { ...known, exact: true };
	const closest = year > years.at(-1)! ? years.at(-1)! : years[0]!;
	return { ...TAX_RULES[closest]!, exact: false };
}
