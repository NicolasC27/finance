import type { Transaction } from './types';
import {
	detectAccountKind,
	normalizeHeader,
	parseDateFr,
	parseDateIso,
	parseDateFlexible,
	parseAmountFr,
	resolveDirection,
	type ImportedAccount
} from './csvCore';

/**
 * Generic column-mapping engine — core shared by the Crédit Mutuel CSV parser,
 * the XLSX import and the interactive remapper (modal). One row logic only:
 * multi-format dates, French amounts, separate debit/credit or signed amount,
 * metadata (note, balance, tags…).
 */

export type FieldKey =
	| 'ignore'
	| 'date'
	| 'valueDate'
	| 'analysisDate'
	| 'label'
	| 'note'
	| 'debit'
	| 'credit'
	| 'amount'
	| 'balance'
	| 'account'
	| 'checked'
	| 'tags'
	| 'category'
	| 'subcategory';

export type DateFmt = 'auto' | 'fr' | 'iso' | 'excel';

export interface MappingOptions {
	/** Column index → assigned field. */
	mapping: FieldKey[];
	/** Date format: auto = fr when '/', iso when '-', excel for a number in 20000-60000. */
	dateFormat: DateFmt;
	/** Rows skipped BEFORE the header (the header is rows[skipRows]). */
	skipRows: number;
	/** Target account of the produced transactions. */
	account: string;
	source: Transaction['source'];
	/**
	 * Rows skipped ON PURPOSE (workbook presentation rows: « Solde au … »,
	 * repeated title): counted in `skipped`, never an error. Error line numbers
	 * stay those of the file.
	 */
	skipRow?: (row: string[]) => boolean;
}

export interface CsvImportResult {
	transactions: Transaction[];
	/**
	 * UNREADABLE rows rejected (missing label, unreadable amount or date): each one
	 * has its message in `errors`. Empty rows are no longer counted here (a
	 * trailing empty row no longer triggers "1 unreadable").
	 */
	ignored: number;
	errors: string[];
	/** Accounts found through an « Compte » column (auto-registration, default []). */
	accounts: ImportedAccount[];
	/** Empty rows met (no error, not in `ignored`). */
	blank?: number;
	/** Rows skipped on purpose (presentation, not transactions) — no error. */
	skipped?: number;
}

/** Recognised headers (normalised form → field). Table extended in v8. */
export const HEADER_MAP: Record<string, FieldKey> = {
	date: 'date',
	'date d operation': 'date',
	'date operation': 'date',
	'date comptable': 'date',
	'date de valeur': 'valueDate',
	'date valeur': 'valueDate',
	valeur: 'valueDate',
	'date d analyse': 'analysisDate',
	'date analyse': 'analysisDate',
	libelle: 'label',
	'libelle operation': 'label',
	operation: 'label',
	details: 'label',
	'note personnelle': 'note',
	note: 'note',
	debit: 'debit',
	credit: 'credit',
	'credit debit': 'ignore', // combined indicator column: unused
	montant: 'amount',
	'montant signe': 'amount',
	categorie: 'category',
	'sous categorie': 'subcategory',
	solde: 'balance',
	compte: 'account',
	'nom du compte': 'account',
	'numero de compte': 'account',
	account: 'account',
	'operation pointee': 'checked',
	pointee: 'checked',
	'tags associes': 'tags',
	tags: 'tags',
	devise: 'ignore',
	dev: 'ignore'
};

/** French field labels (remapper selects). */
export const FIELD_LABELS: Record<FieldKey, string> = {
	ignore: 'Ignorer',
	date: 'Date',
	valueDate: 'Date de valeur',
	analysisDate: "Date d'analyse",
	label: 'Libellé',
	note: 'Note',
	debit: 'Débit',
	credit: 'Crédit',
	amount: 'Montant',
	balance: 'Solde',
	account: 'Compte',
	checked: 'Opération pointée',
	tags: 'Tags',
	category: 'Catégorie',
	subcategory: 'Sous-catégorie'
};

/**
 * Guesses the mapping from normalised headers. null when there is no label
 * column (the remapper then opens). Only one label column is guessed (the
 * first): concatenating several columns stays an explicit remapper choice —
 * otherwise an export with both « Opération » AND « Libellé » would change the
 * keys of already imported transactions (deduplication).
 */
export function guessMapping(headerFields: string[]): FieldKey[] | null {
	let labelSeen = false;
	const mapping = headerFields.map((h): FieldKey => {
		const key = HEADER_MAP[normalizeHeader(h)] ?? 'ignore';
		if (key !== 'label') return key;
		if (labelSeen) return 'ignore';
		labelSeen = true;
		return key;
	});
	return labelSeen ? mapping : null;
}

/** Mapping validation message (null when complete). */
export function mappingError(mapping: FieldKey[]): string | null {
	if (!mapping.includes('date')) return 'Il manque une colonne Date';
	if (!mapping.includes('label')) return 'Il manque une colonne Libellé';
	if (!mapping.includes('debit') && !mapping.includes('credit') && !mapping.includes('amount'))
		return 'Il manque une colonne Débit, Crédit ou Montant';
	return null;
}

/**
 * Excel serial → ISO "YYYY-MM-DD" (epoch 1899-12-30 UTC, 1900 bug included).
 * The fractional part is the TIME: it is truncated (46237.5 = 03/08 at noon,
 * not 04/08), with an epsilon against floats just below the integer.
 */
export function excelSerialToDate(serial: number): string | null {
	if (!Number.isFinite(serial) || serial < 20000 || serial > 60000) return null;
	const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial + 1e-9) * 86_400_000);
	const y = d.getUTCFullYear();
	const m = String(d.getUTCMonth() + 1).padStart(2, '0');
	const day = String(d.getUTCDate()).padStart(2, '0');
	return `${y}-${m}-${day}`;
}

/** Date in the chosen format (any time ignored): "" when empty, null when invalid. A plain number in the Excel serial range is read as an Excel date. */
export function parseDateByFormat(raw: string, fmt: DateFmt): string | null {
	const s = raw.trim();
	switch (fmt) {
		case 'fr':
			return parseDateFr(s);
		case 'iso':
			return parseDateIso(s);
		case 'excel': {
			if (!s) return '';
			const n = Number(s.replace(',', '.'));
			if (!Number.isFinite(n)) return null;
			return excelSerialToDate(n);
		}
		case 'auto': {
			if (!s) return '';
			const n = Number(s.replace(',', '.'));
			if (Number.isFinite(n) && n >= 20000 && n <= 60000) return excelSerialToDate(n);
			return parseDateFlexible(s);
		}
	}
}

/** Checked (pointed) transaction: any non-empty value (except "non"/"0") → true. */
function parseChecked(raw: string): boolean {
	const s = raw.trim().toLowerCase();
	return s !== '' && s !== 'non' && s !== '0';
}

/**
 * Account id from an « Compte » column value: an 11-digit block →
 * 'cm-<number>', otherwise a stable slug 'cm-' + normalizeHeader(value)
 * (« Livret A » → 'cm-livret-a'). Returns '' when the value is unusable (the
 * default account applies).
 */
export function accountIdFromValue(value: string): string {
	const m = /\d{11}/.exec(value);
	if (m) return `cm-${m[0]}`;
	const slug = normalizeHeader(value).replace(/ /g, '-');
	return slug ? `cm-${slug}` : '';
}

/**
 * Account found through an « Compte » column: label = cleaned raw value,
 * detected kind, last4 = last 4 digits when present.
 */
function discoveredAccount(raw: string, id: string): ImportedAccount {
	const label = raw.replace(/\s+/g, ' ').trim();
	const digits = raw.replace(/\D/g, '');
	return {
		id,
		label,
		last4: digits.length >= 4 ? digits.slice(-4) : '••••',
		kind: detectAccountKind(label, id)
	};
}

/** Associated tags: separated by "," or ";" depending on the export's quoting. */
function parseTags(raw: string): string[] {
	return raw
		.split(/[;,]/)
		.map((t) => t.trim())
		.filter((t) => t.length > 0);
}

/** Short raw value for an error message ("…" beyond 24 characters). */
function shown(raw: string): string {
	const s = raw.trim();
	return s.length > 24 ? `${s.slice(0, 23)}…` : s;
}

/**
 * Parses rows with an explicit mapping. rows[skipRows] = header (ignored), data
 * after it. Error line numbers are the file's (index + 1), including for dense
 * XLSX matrices (the row index matches the sheet row). Several columns can
 * carry the same field (remapper): labels are joined in column order, notes
 * joined, tags merged; for other fields the first non-empty value wins.
 * Row rules:
 * - empty row: counted apart, neither an error nor unreadable;
 * - workbook presentation row: skipped on purpose, no error;
 * - no label or no usable amount: invalid row;
 * - amount: the signed column wins, otherwise separate debit/credit (a debit
 *   is always an outflow; a negative credit is an outflow, see
 *   resolveDirection);
 * - unreadable booking date: the row is IGNORED (no longer kept as pending: it
 *   left the budgets and created a duplicate on re-import); empty = pending
 *   (legitimate); any time is ignored;
 * - unreadable secondary dates: the field is dropped (booking date used
 *   instead), the row is kept and reported;
 * - a non-empty « Compte » column overrides the default account for THIS
 *   transaction and feeds auto-registration;
 * - without a value date the booking date is used (otherwise the transaction is
 *   pending and left out of wealth balances);
 * - "A catégoriser" means no bank category.
 */
export function parseRowsWithMapping(rows: string[][], opts: MappingOptions): CsvImportResult {
	const errors: string[] = [];
	const transactions: Transaction[] = [];
	const discovered = new Map<string, ImportedAccount>();
	let ignored = 0;
	let blank = 0;
	let skipped = 0;

	const columns = new Map<FieldKey, number[]>();
	opts.mapping.forEach((key, idx) => {
		const list = columns.get(key);
		if (list) list.push(idx);
		else columns.set(key, [idx]);
	});
	const values = (fields: string[], key: FieldKey): string[] =>
		(columns.get(key) ?? []).map((idx) => (fields[idx] ?? '').trim()).filter((v) => v !== '');
	const get = (fields: string[], key: FieldKey): string => values(fields, key)[0] ?? '';

	for (let r = opts.skipRows + 1; r < rows.length; r++) {
		const fields = rows[r]!;
		if (fields.every((f) => f.trim() === '')) {
			blank++;
			continue;
		}
		if (opts.skipRow?.(fields)) {
			skipped++;
			continue;
		}
		const lineNo = r + 1;

		const label = values(fields, 'label').join(' ');
		const amountRaw = get(fields, 'amount');
		const debitRaw = get(fields, 'debit');
		const creditRaw = get(fields, 'credit');
		const signed = parseAmountFr(amountRaw);
		const debit = parseAmountFr(debitRaw);
		const credit = parseAmountFr(creditRaw);

		if (!label) {
			ignored++;
			errors.push(`Ligne ${lineNo} : libellé manquant, ligne ignorée`);
			continue;
		}
		const amounts: [string, number | null][] = [
			[amountRaw, signed],
			[debitRaw, debit],
			[creditRaw, credit]
		];
		const unreadable = amounts.find(([raw, value]) => raw !== '' && value === null);
		if (unreadable) {
			ignored++;
			errors.push(`Ligne ${lineNo} : montant illisible (« ${shown(unreadable[0])} »), ligne ignorée`);
			continue;
		}

		const direction = resolveDirection(signed, debit, credit);
		if (!direction) {
			ignored++;
			errors.push(`Ligne ${lineNo} : ni débit ni crédit, ligne ignorée`);
			continue;
		}
		const { isCredit, amount } = direction;

		const dateRaw = get(fields, 'date');
		const date = parseDateByFormat(dateRaw, opts.dateFormat);
		if (date === null) {
			ignored++;
			errors.push(`Ligne ${lineNo} : date illisible (« ${shown(dateRaw)} »), ligne ignorée`);
			continue;
		}
		const valueDateRaw = get(fields, 'valueDate');
		const valueDate = parseDateByFormat(valueDateRaw, opts.dateFormat);
		if (valueDate === null) errors.push(`Ligne ${lineNo} : date de valeur illisible (« ${shown(valueDateRaw)} »), date d'opération reprise`);
		const analysisDateRaw = get(fields, 'analysisDate');
		const analysisDate = parseDateByFormat(analysisDateRaw, opts.dateFormat);
		if (analysisDate === null) errors.push(`Ligne ${lineNo} : date d'analyse illisible (« ${shown(analysisDateRaw)} »), ignorée`);

		const category = get(fields, 'category').trim();
		const balance = parseAmountFr(get(fields, 'balance'));

		const accountRaw = get(fields, 'account');
		const accountId = accountRaw.trim() !== '' ? accountIdFromValue(accountRaw) : '';
		if (accountId && !discovered.has(accountId)) {
			discovered.set(accountId, discoveredAccount(accountRaw, accountId));
		}

		const tx: Transaction = {
			transaction_amount: { amount: amount.toFixed(2), currency: 'EUR' },
			booking_date: date,
			value_date: valueDate || date,
			remittance_information: [label],
			credit_debit_indicator: isCredit ? 'CRDT' : 'DBIT',
			source: opts.source,
			account: accountId || opts.account
		};
		const note = values(fields, 'note').join(' · ');
		if (note) tx.note = note;
		if (category && normalizeHeader(category) !== 'a categoriser') tx.bank_category = category;
		const subcategory = get(fields, 'subcategory').trim();
		if (subcategory) tx.bank_subcategory = subcategory;
		if (balance !== null) tx.balance_after = Math.round(balance * 100) / 100;
		if (parseChecked(get(fields, 'checked'))) tx.checked = true;
		const tags = [...new Set(values(fields, 'tags').flatMap(parseTags))];
		if (tags.length > 0) tx.tags = tags;
		if (analysisDate) tx.analysis_date = analysisDate;

		transactions.push(tx);
	}

	return { transactions, ignored, errors, accounts: [...discovered.values()], blank, skipped };
}

// ---------- Mapping presets (`budget:import-presets`) ----------

export interface ImportPreset {
	mapping: FieldKey[];
	dateFormat: DateFmt;
	skipRows: number;
}

const PRESETS_KEY = 'budget:import-presets';

/** Signature of a format: normalised headers joined with "|". */
export function headerSignature(headerFields: string[]): string {
	return headerFields.map((h) => normalizeHeader(h)).join('|');
}

function loadPresets(): Record<string, ImportPreset> {
	if (typeof localStorage === 'undefined') return {};
	try {
		const parsed = JSON.parse(localStorage.getItem(PRESETS_KEY) ?? '{}') as Record<string, ImportPreset>;
		return parsed && typeof parsed === 'object' ? parsed : {};
	} catch {
		return {};
	}
}

/** Preset matching a header signature (null when missing). */
export function loadPreset(signature: string): ImportPreset | null {
	return loadPresets()[signature] ?? null;
}

/**
 * Looks for a stored preset among the signatures of the first `maxScan` rows
 * (empty rows skipped) — covers files with a preamble whose real header row is
 * not rows[0]. The first match (highest row) wins; the returned index becomes
 * the skipRows to apply.
 */
export function findPresetInRows(rows: string[][], maxScan = 10): { skipRows: number; preset: ImportPreset } | null {
	for (let k = 0; k < Math.min(rows.length, maxScan); k++) {
		const row = rows[k]!;
		if (row.every((f) => f.trim() === '')) continue;
		const preset = loadPreset(headerSignature(row));
		if (preset) return { skipRows: k, preset };
	}
	return null;
}

/** Stores a preset after the mapping was applied by hand. If storage is unavailable the preset is lost (the import is already done). */
export function savePreset(signature: string, preset: ImportPreset): void {
	if (typeof localStorage === 'undefined') return;
	try {
		const presets = loadPresets();
		presets[signature] = preset;
		localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
	} catch {
	}
}
