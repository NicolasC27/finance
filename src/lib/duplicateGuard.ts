import type { Transaction } from './types';
import { assignDupIndexes, txKey } from './categories';
import { signedAmount } from './data';

/**
 * Cross-format duplicate guard (pure module). The same movement read from an
 * OFX/QIF/CAMT statement and from the Crédit Mutuel CSV/XLSX export carries
 * two different labels, hence two txKeys: addImported would add it twice.
 */

/** « Standard statement » sources (OFX/QFX, QIF, CAMT). */
export function isStatementSource(tx: Transaction): boolean {
	return tx.source === 'ofx' || tx.source === 'qif' || tx.source === 'camt';
}

/**
 * Account used by the guard. A CSV without an account number ('cm') and a
 * statement of account 'cm-…' describe the same account when a single
 * numbered Crédit Mutuel account appears in the app and the batch: 'cm' is
 * then attached to it.
 */
function accountAlias(txs: readonly Transaction[]): (tx: Transaction) => string {
	const numbered = new Set(txs.map((tx) => tx.account ?? 'cm').filter((a) => a.startsWith('cm-')));
	const unique = numbered.size === 1 ? [...numbered][0]! : null;
	return (tx) => {
		const account = tx.account ?? 'cm';
		return account === 'cm' && unique ? unique : account;
	};
}

/**
 * Per (account, booking date, signed amount in cents), counts the movements
 * already known and only adds the surplus (two coffees on the same day in the
 * batch, one known → one added). STRICT duplicates (same txKey: re-imported
 * file) are left to addImported, which counts them as such; they take their
 * slot. Demo and Portage entries are excluded.
 * `seulementSi` restricts the known movements (e.g. statements only, for a
 * CSV/XLSX import: the guard then never gets in the way of two CSV exports).
 */
export function skipKnownMovements(
	existing: readonly Transaction[],
	incoming: Transaction[],
	options: { seulementSi?: (tx: Transaction) => boolean } = {}
): { kept: Transaction[]; skipped: number } {
	const realTxs = existing.filter((tx) => tx.source && tx.source !== 'demo' && tx.source !== 'portage' && (!options.seulementSi || options.seulementSi(tx)));
	const accountOf = accountAlias([...realTxs, ...incoming]);
	const slotOf = (tx: Transaction): string | null => (tx.booking_date ? `${accountOf(tx)}|${tx.booking_date}|${Math.round(signedAmount(tx) * 100)}` : null);
	const known = new Map<string, number>();
	const keys = new Set<string>();
	for (const tx of realTxs) {
		keys.add(txKey(tx));
		const slot = slotOf(tx);
		if (slot) known.set(slot, (known.get(slot) ?? 0) + 1);
	}
	const batch = assignDupIndexes(incoming);
	const strict = batch.map((tx) => keys.has(txKey(tx)));
	batch.forEach((tx, i) => {
		const slot = slotOf(tx);
		if (strict[i] && slot) known.set(slot, Math.max(0, (known.get(slot) ?? 0) - 1));
	});
	const kept: Transaction[] = [];
	let skipped = 0;
	batch.forEach((tx, i) => {
		const slot = slotOf(tx);
		const left = slot && !strict[i] ? (known.get(slot) ?? 0) : 0;
		if (left > 0) {
			known.set(slot!, left - 1);
			skipped++;
		} else {
			kept.push(tx);
		}
	});
	return { kept, skipped };
}
