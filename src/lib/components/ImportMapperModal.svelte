<script lang="ts">
	import type { Transaction } from '$lib/types';
	import {
		FIELD_LABELS,
		findPresetInRows,
		guessMapping,
		headerSignature,
		loadPreset,
		mappingError,
		parseRowsWithMapping,
		type CsvImportResult,
		type DateFmt,
		type FieldKey,
		type ImportPreset
	} from '$lib/importMapper';
	import { decodeCsv, detectDelimiter, tokenize } from '$lib/csvCore';
	import { formatDate, formatEUR, truncateLabel } from '$lib/format';
	import { accountLabel } from '$lib/accounts.svelte';
	import { modal } from '$lib/actions/modal';

	/**
	 * 'Remapper les colonnes' modal: file preview, field selects per column, options (rows to skip,
	 * date format, delimiter and encoding for CSV), live preview of the first 5 operations and import.
	 * The applied mapping is offered as a preset for the next identical file.
	 */

	/** File source: CSV buffer (adjustable delimiter/encoding) or matrix (XLSX). */
	export type MapperSource =
		| { kind: 'csv'; buffer: ArrayBuffer }
		| { kind: 'rows'; rows: string[][] };

	interface Props {
		fileName: string;
		sourceData: MapperSource;
		account: string;
		txSource: Transaction['source'];
		onCancel: () => void;
		onImport: (result: CsvImportResult, preset: ImportPreset, signature: string) => void;
	}

	let { fileName, sourceData, account, txSource, onCancel, onImport }: Props = $props();

	const FIELD_KEYS = Object.keys(FIELD_LABELS) as FieldKey[];

	// ---- Adjustable options ----
	let skipRows = $state(0);
	let dateFormat = $state<DateFmt>('auto');
	let delimiter = $state<'auto' | ';' | ',' | '\t'>('auto');
	let encoding = $state<'auto' | 'utf-8' | 'latin-1'>('auto');
	let mapping = $state<FieldKey[]>([]);

	/** Text decoded with the chosen encoding (CSV only). */
	const text = $derived.by((): string => {
		if (sourceData.kind !== 'csv') return '';
		if (encoding === 'utf-8') return new TextDecoder('utf-8').decode(sourceData.buffer);
		if (encoding === 'latin-1') return new TextDecoder('windows-1252').decode(sourceData.buffer);
		return decodeCsv(sourceData.buffer);
	});

	/** Tokenised rows (chosen delimiter, or detected on the first row). */
	const rows = $derived.by((): string[][] => {
		if (sourceData.kind === 'rows') return sourceData.rows;
		const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
		const delim = delimiter === 'auto' ? detectDelimiter(firstLine) : delimiter;
		return tokenize(text, delim);
	});

	/** Current header (after the skipped rows). */
	const header = $derived(rows[skipRows] ?? []);
	const signature = $derived(headerSignature(header));
	/** Saved preset for this header signature. */
	const preset = $derived(loadPreset(signature));

	/** Number of displayed columns (max of the header / first 6 data rows). */
	const previewRows = $derived(rows.slice(skipRows + 1, skipRows + 7));
	const colCount = $derived(Math.max(header.length, ...previewRows.map((r) => r.length), 1));

	/** (Re)guesses the mapping from the current header. */
	function reguess() {
		const h = rows[skipRows] ?? [];
		mapping = guessMapping(h) ?? Array.from({ length: Math.max(h.length, 1) }, () => 'ignore' as FieldKey);
	}

	/** True when a saved preset was applied automatically (meta line). */
	let presetAutoApplied = $state(false);

	// File (re)loaded: a saved preset is first looked up among the signatures of the first 10 rows
	// (files with a preamble). If one matches, skipRows + mapping + date format are applied at once
	// (the user can still change them). Otherwise the mapping is guessed from the header.
	$effect(() => {
		const found = findPresetInRows(rows);
		if (found) {
			skipRows = found.skipRows;
			dateFormat = found.preset.dateFormat;
			mapping = [...found.preset.mapping];
			presetAutoApplied = true;
		} else {
			presetAutoApplied = false;
			reguess();
		}
	});

	/**
	 * Header shift: ±1 row, then the mapping is guessed again (a manual change drops the preset meta
	 * line).
	 */
	function bumpSkip(delta: number) {
		skipRows = Math.max(0, Math.min(10, skipRows + delta));
		presetAutoApplied = false;
		reguess();
	}

	function setMapping(col: number, field: FieldKey) {
		const next = [...mapping];
		while (next.length <= col) next.push('ignore');
		next[col] = field;
		mapping = next;
		presetAutoApplied = false;
	}

	/** Applies the saved preset (mapping + date format + skipped rows). */
	function applyPreset() {
		const p = preset;
		if (!p) return;
		skipRows = p.skipRows;
		dateFormat = p.dateFormat;
		mapping = [...p.mapping];
		presetAutoApplied = true;
	}

	/** Live parse: recomputed on every mapping/option change. */
	const liveResult = $derived.by((): CsvImportResult => {
		if (mapping.length === 0) return { transactions: [], ignored: 0, errors: [], accounts: [] };
		return parseRowsWithMapping(rows, { mapping, dateFormat, skipRows, account, source: txSource });
	});

	const invalidMessage = $derived(mappingError(mapping));
	/** Several 'Libellé' columns: concatenated in order (flagged under the preview). */
	const labelColumns = $derived(mapping.filter((f) => f === 'label').length);

	function submit() {
		if (invalidMessage) return;
		onImport(liveResult, { mapping: [...mapping], dateFormat, skipRows }, signature);
	}

	/** Signed amount of a preview transaction. */
	function previewAmount(tx: Transaction): number {
		const v = Number(tx.transaction_amount.amount);
		return tx.credit_debit_indicator === 'CRDT' ? v : -v;
	}

	const dateOptions: { id: DateFmt; label: string }[] = [
		{ id: 'auto', label: 'Auto' },
		{ id: 'fr', label: 'JJ-MM-AAAA' },
		{ id: 'iso', label: 'AAAA-MM-JJ' },
		{ id: 'excel', label: 'Sériel Excel' }
	];
	const delimiterOptions = [
		{ id: 'auto', label: 'Auto' },
		{ id: ';', label: ';' },
		{ id: ',', label: ',' },
		{ id: '\t', label: 'Tab' }
	] as const;
	const encodingOptions = [
		{ id: 'auto', label: 'Auto' },
		{ id: 'utf-8', label: 'UTF-8' },
		{ id: 'latin-1', label: 'Latin-1' }
	] as const;
</script>

<!-- Overlay: dimmed background, centred panel 880 px max, 200 ms entrance -->
<div
	class="mapper-overlay fixed inset-0 z-50 flex items-center justify-center p-4"
	role="presentation"
	onclick={(e) => {
		if (e.target === e.currentTarget) onCancel();
	}}
>
	<!-- use:modal: focus on open, Escape = Cancel, Tab loops, focus restored on close -->
	<div
		class="mapper-panel flex max-h-[90vh] w-full max-w-[880px] flex-col overflow-hidden rounded-lg border"
		style="border-color: var(--hairline); background-color: var(--surface);"
		role="dialog"
		aria-modal="true"
		aria-label="Remapper les colonnes"
		use:modal={{ onEscape: onCancel }}
	>
		<!-- Header -->
		<header class="shrink-0 border-b px-6 py-4" style="border-color: var(--border-subtle);">
			<h2 class="serif text-2xl">Remapper les colonnes</h2>
			<p class="meta-xs mt-1 truncate">{fileName} · compte cible : {accountLabel(account)}</p>
			{#if presetAutoApplied}
				<p class="meta-xs mt-1" style="color: var(--text-2);">Mapping enregistré appliqué</p>
			{/if}
		</header>

		<div class="min-h-0 flex-1 overflow-y-auto px-6 py-5">
			<!-- Options -->
			<div class="flex flex-wrap items-end gap-x-6 gap-y-4">
				<!-- Skipped rows -->
				<div>
					<p class="label-plain mb-1.5">Ignorer les premières lignes</p>
					<div class="flex items-center gap-1">
						<button
							type="button"
							class="press flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border disabled:opacity-30"
							style="border-color: var(--hairline);"
							disabled={skipRows <= 0}
							aria-label="Une ligne de moins"
							onclick={() => bumpSkip(-1)}
						>
							−
						</button>
						<span class="tabular w-6 text-center text-sm">{skipRows}</span>
						<button
							type="button"
							class="press flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border disabled:opacity-30"
							style="border-color: var(--hairline);"
							disabled={skipRows >= 10}
							aria-label="Une ligne de plus"
							onclick={() => bumpSkip(1)}
						>
							+
						</button>
					</div>
				</div>

				<!-- Date format -->
				<div>
					<p class="label-plain mb-1.5">Format de date</p>
					{@render segmented(dateOptions, dateFormat, (v) => {
						dateFormat = v as DateFmt;
						presetAutoApplied = false; // retouche manuelle : la méta preset ne s'applique plus
					}, 'Format de date')}
				</div>

				{#if sourceData.kind === 'csv'}
					<div>
						<p class="label-plain mb-1.5">Délimiteur</p>
						{@render segmented([...delimiterOptions], delimiter, (v) => (delimiter = v as typeof delimiter), 'Délimiteur')}
					</div>
					<div>
						<p class="label-plain mb-1.5">Encodage</p>
						{@render segmented([...encodingOptions], encoding, (v) => (encoding = v as typeof encoding), 'Encodage')}
					</div>
				{/if}
			</div>

			<!-- Saved preset available for this signature -->
			{#if preset}
				<button
					type="button"
					class="press mt-4 cursor-pointer rounded-full border px-3 py-1.5 text-xs font-medium transition-colors"
					style="border-color: var(--accent); color: var(--accent);"
					onclick={applyPreset}
				>
					Utiliser le mapping enregistré
				</button>
			{/if}

			<!-- Preview table: field select above each column -->
			<div class="mt-5 overflow-x-auto rounded-lg border" style="border-color: var(--border-subtle);">
				<table class="w-full border-collapse text-xs">
					<thead>
						<tr>
							{#each Array.from({ length: colCount }) as _, col (col)}
								<th class="border-b px-2 py-2 text-left" style="border-color: var(--border-subtle); background-color: var(--bg);">
									<select
										class="mapper-select w-full min-w-24 cursor-pointer"
										value={mapping[col] ?? 'ignore'}
										onchange={(e) => setMapping(col, (e.target as HTMLSelectElement).value as FieldKey)}
										aria-label="Champ de la colonne {col + 1}"
									>
										{#each FIELD_KEYS as field (field)}
											<option value={field}>{FIELD_LABELS[field]}</option>
										{/each}
									</select>
								</th>
							{/each}
						</tr>
						<tr>
							{#each Array.from({ length: colCount }) as _, col (col)}
								<th class="label-plain border-b px-2 pt-2 pb-1.5 text-left font-normal normal-case" style="border-color: var(--border-subtle); letter-spacing: 0.04em;">
									<span class="truncate">{header[col] ?? ''}</span>
								</th>
							{/each}
						</tr>
					</thead>
					<tbody>
						{#each previewRows as row, r (r)}
							<tr>
								{#each Array.from({ length: colCount }) as _, col (col)}
									<td class="max-w-44 truncate px-2 py-1.5 text-secondary" style="border-top: 1px solid var(--border-subtle);">
										{row[col] ?? ''}
									</td>
								{/each}
							</tr>
						{:else}
							<tr>
								<td colspan={colCount} class="px-2 py-4 text-center text-secondary">Aucune ligne de données après l'en-tête.</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>

			<!-- Live preview: first 5 parsed operations -->
			<div class="mt-4">
				<p class="label-plain mb-1.5">Aperçu</p>
				{#if invalidMessage}
					<p class="text-xs" style="color: var(--amber);">{invalidMessage}</p>
				{:else if liveResult.transactions.length === 0}
					<p class="text-xs text-secondary">Aucune opération lisible avec ce mapping.</p>
				{:else}
					<ul class="divide-y text-sm" style="border-color: var(--border-subtle);">
						{#each liveResult.transactions.slice(0, 5) as tx, i (i)}
							{@const amount = previewAmount(tx)}
							<li class="flex items-baseline gap-3 py-1.5" style="border-color: var(--border-subtle);">
								<span class="tabular w-24 shrink-0 text-secondary">{tx.booking_date ? formatDate(tx.booking_date) : '—'}</span>
								<span class="min-w-0 flex-1 truncate">{truncateLabel(tx.remittance_information[0] ?? '', 48)}</span>
								<span class="tabular shrink-0 font-medium {amount >= 0 ? 'text-accent' : 'text-debit'}">
									{amount >= 0 ? '+' : '−'}{formatEUR(Math.abs(amount))}
								</span>
							</li>
						{/each}
					</ul>
				{/if}
				{#if labelColumns > 1 && !invalidMessage}
					<p class="meta-xs mt-1.5">Libellé : {labelColumns} colonnes concaténées dans l'ordre</p>
				{/if}
				{#if !invalidMessage && (liveResult.ignored > 0 || (liveResult.blank ?? 0) > 0)}
					<p class="meta-xs mt-1.5">
						{#if liveResult.ignored > 0}{liveResult.ignored} ligne{liveResult.ignored > 1 ? 's' : ''} illisible{liveResult.ignored > 1 ? 's' : ''} non importée{liveResult.ignored > 1 ? 's' : ''}{/if}{#if liveResult.ignored > 0 && (liveResult.blank ?? 0) > 0}&nbsp;·{' '}{/if}{#if (liveResult.blank ?? 0) > 0}{liveResult.blank} ligne{(liveResult.blank ?? 0) > 1 ? 's' : ''} vide{(liveResult.blank ?? 0) > 1 ? 's' : ''}{/if}
					</p>
				{/if}
				<!-- Errors BEFORE import: the first 3, to fix the mapping or the date format -->
				{#if !invalidMessage && liveResult.errors.length > 0}
					<ul class="mt-1.5 space-y-0.5 text-xs" style="color: var(--amber);">
						{#each liveResult.errors.slice(0, 3) as err, i (i)}
							<li>{err}</li>
						{/each}
						{#if liveResult.errors.length > 3}
							<li class="meta-xs">… et {liveResult.errors.length - 3} autre{liveResult.errors.length - 3 > 1 ? 's' : ''}</li>
						{/if}
					</ul>
				{/if}
			</div>
		</div>

		<!-- Footer: cancel / import -->
		<footer class="flex shrink-0 flex-wrap items-center justify-end gap-3 border-t px-6 py-4" style="border-color: var(--border-subtle);">
			{#if invalidMessage}
				<p class="mr-auto text-xs" style="color: var(--amber);">{invalidMessage}</p>
			{/if}
			<button type="button" class="btn btn-secondary" data-autofocus onclick={onCancel}>Annuler</button>
			<button type="button" class="btn btn-primary" disabled={invalidMessage !== null || liveResult.transactions.length === 0} onclick={submit}>
				Importer {liveResult.transactions.length} opération{liveResult.transactions.length > 1 ? 's' : ''}
			</button>
		</footer>
	</div>
</div>

<!-- Segmented group (options): outlined pills, active = accent -->
{#snippet segmented<T extends string>(options: readonly { id: T; label: string }[], value: T, onPick: (id: T) => void, ariaLabel: string)}
	<div class="flex overflow-hidden rounded-full border" style="border-color: var(--hairline);" role="group" aria-label={ariaLabel}>
		{#each options as opt (opt.id)}
			<button
				type="button"
				class="press cursor-pointer px-3 py-1.5 text-xs font-medium transition-colors duration-150"
				style={opt.id === value
					? 'background-color: var(--accent-soft); color: var(--accent);'
					: 'color: var(--text-2);'}
				aria-pressed={opt.id === value}
				onclick={() => onPick(opt.id)}
			>
				{opt.label}
			</button>
		{/each}
	</div>
{/snippet}

<style>
	.mapper-overlay {
		background-color: rgba(0, 0, 0, 0.5);
		animation: mapper-fade 200ms ease-out backwards;
	}

	.mapper-panel {
		animation: mapper-pop 200ms cubic-bezier(0.2, 0.6, 0.2, 1) backwards;
		box-shadow: var(--shadow-soft);
	}

	/* Column selects: custom tokens, never the native style */
	.mapper-select {
		background-color: var(--surface-2);
		border: 1px solid var(--hairline);
		border-radius: 6px;
		color: var(--text);
		font-size: 12px;
		padding: 4px 6px;
		outline: none;
		transition: border-color 200ms ease;
	}

	.mapper-select:focus {
		border-color: var(--accent);
	}

	@keyframes mapper-fade {
		from {
			opacity: 0;
		}
	}

	@keyframes mapper-pop {
		from {
			opacity: 0;
			transform: translateY(6px);
		}
	}
</style>
