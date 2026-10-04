import type { Transaction } from './types';

/** Real date of a CM card operation (pure module, testable with tsx). */

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Real date of the operation: the DDMM of the CM card label when present, else booking_date. If
 * the deduced date is after the booking (e.g. '2812' booked on 02/01), it belongs to the previous
 * year.
 */
export function effectiveDate(tx: Transaction): string {
	const booking = tx.booking_date;
	if (!booking) return booking;
	const raw = tx.remittance_information.join(' ');
	const m = /\b(?:PAIEMENTS?(?:\s+(?:CB|PSC))?|RETRAITS?(?:\s+DAB)?)\s+(\d{2})(\d{2})\b/i.exec(raw);
	if (!m) return booking;
	const day = Number(m[1]);
	const month = Number(m[2]);
	if (month < 1 || month > 12 || day < 1 || day > 31) return booking;
	let year = Number(booking.slice(0, 4));
	const iso = (y: number) => `${y}-${pad(month)}-${pad(day)}`;
	if (iso(year) > booking) year -= 1;
	return iso(year);
}

