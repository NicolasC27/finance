/**
 * Receipt → AI analysis (pure module, testable with tsx): accepted formats
 * and the question sent with the photo or PDF. The method (reading the
 * receipt, matching it to the card payment, proposed actions) lives in the
 * relay prompt (scripts/ia-relay.ts).
 */

/** File picker filter: HEIC is included so the refusal can be explained. */
export const RECEIPT_ACCEPT = '.jpg,.jpeg,.png,.webp,.pdf,.heic,.heif';

const RECEIPT_OK = /\.(jpe?g|png|webp|pdf)$/i;
const HEIC = /\.hei[cf]$/i;

/** iPhone photo in HEIC format: Claude can't read it. */
export const HEIC_MESSAGE = 'photo HEIC (iPhone) illisible par Claude : convertis-la en JPG (sur l’iPhone : Réglages › Appareil photo › Formats › « Le plus compatible »)';

export function isHeic(name: string): boolean {
	return HEIC.test(name);
}

/** Reason a receipt file is refused, or null when it is accepted. */
export function receiptRefusal(name: string): string | null {
	if (isHeic(name)) return HEIC_MESSAGE;
	if (!RECEIPT_OK.test(name)) return 'format non pris en charge pour un ticket (photo JPG, PNG, WebP ou PDF)';
	return null;
}

/** Question sent with the receipt(s); `details` is what the user had typed in the input. */
export function receiptQuestion(count: number, details = ''): string {
	const p = details.replace(/\s+/g, ' ').trim();
	const subject = count > 1 ? `ces ${count} tickets de caisse` : 'ce ticket de caisse';
	return `🧾 Analyse ${subject} : retrouve l'opération bancaire qui correspond, puis propose une note qui détaille les achats, des tags et, seulement si c'est évident, une autre catégorie.${p ? ` Précision : ${p}` : ''}`;
}
