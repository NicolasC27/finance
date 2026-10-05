/**
 * Formatting for sensitive screens (Patrimoine, Crypto, Portage and their cards): same names as
 * format.ts, but euro amounts are masked in privacy mode. A sensitive component only changes its
 * import path from '$lib/format' to '$lib/sensitiveFormat'.
 */
export * from './format';
export { sensitiveEUR as formatEUR, sensitiveEURCompact as formatEURCompact, sensitiveEURNarrowParts as formatEURNarrowParts, sensitiveEURNarrow as formatEURNarrow } from './format';
