/**
 * Import log (`budget:imports-log`): for each source, the date of the last
 * import, the file and the period covered. Feeds the « Derniers imports » line
 * and the reminders (CM export older than 35 days, missing Krak statement for
 * the previous month).
 */

export type ImportSource = 'cm' | 'krak' | 'natixis' | 'impots' | 'amazon' | 'kraken-csv' | 'releves' | 'portage' | 'vehicule' | 'france-travail';

export interface ImportEntry {
	at: string; // ISO
	fileName: string;
	/** Period covered: "YYYY-MM" (monthly statement) or "YYYY-MM-DD" (last transaction). */
	period?: string;
}

const KEY = 'budget:imports-log';

function load(): Partial<Record<ImportSource, ImportEntry>> {
	if (typeof localStorage === 'undefined') return {};
	try {
		const p = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Record<ImportSource, ImportEntry>>;
		return p && typeof p === 'object' ? p : {};
	} catch {
		return {};
	}
}

export const importsState = $state({ log: load() });

export const SOURCE_LABELS: Record<ImportSource, string> = {
	cm: 'Crédit Mutuel',
	krak: 'Relevés Krak',
	natixis: 'Natixis',
	impots: 'Impôts',
	amazon: 'Amazon',
	'kraken-csv': 'Ledger Kraken',
	releves: 'Relevés OFX/QIF/CAMT',
	portage: 'InfoPortage',
	vehicule: 'Documents véhicule',
	'france-travail': 'Relevés France Travail'
};

/** Records an import; the period is only replaced when it moves forward. Unavailable storage is ignored. */
export function recordImport(source: ImportSource, fileName: string, period?: string): void {
	const prev = importsState.log[source];
	const nextPeriod = period && (!prev?.period || period > prev.period) ? period : prev?.period;
	importsState.log = { ...importsState.log, [source]: { at: new Date().toISOString(), fileName, ...(nextPeriod ? { period: nextPeriod } : {}) } };
	try {
		localStorage.setItem(KEY, JSON.stringify(importsState.log));
	} catch {
	}
}

export interface ImportReminder {
	source: ImportSource;
	text: string;
}

function monthKey(d: Date): string {
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Age of an entry's data, in days: since the last covered transaction (period
 * "YYYY-MM-DD") when known, otherwise since the import date. Re-importing an OLD
 * file therefore no longer resets the reminder: the period only moves forward
 * when the file is newer (see recordImport).
 */
export function dataAgeDays(entry: ImportEntry, now = new Date()): number {
	const ref = entry.period && /^\d{4}-\d{2}-\d{2}$/.test(entry.period) ? new Date(`${entry.period}T12:00:00`) : new Date(entry.at);
	return Math.floor((now.getTime() - ref.getTime()) / 86_400_000);
}

/** Reminders: CM data too old, previous month's Krak statement missing. */
export function getImportReminders(now = new Date()): ImportReminder[] {
	const out: ImportReminder[] = [];
	const cm = importsState.log.cm;
	if (cm) {
		const days = dataAgeDays(cm, now);
		if (days > 35) out.push({ source: 'cm', text: `Crédit Mutuel : dernière opération importée il y a ${days} jours` });
	}
	const krak = importsState.log.krak;
	if (krak?.period) {
		const prevMonth = monthKey(new Date(now.getFullYear(), now.getMonth() - 1, 1));
		if (krak.period.slice(0, 7) < prevMonth) {
			const [y, m] = prevMonth.split('-');
			const label = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' }).format(new Date(Number(y), Number(m) - 1, 1));
			out.push({ source: 'krak', text: `Relevé Krak de ${label} manquant` });
		}
	}
	return out;
}
