import { listZip, readZipText } from './unzip';
import { parseAmazonOrders, parseAmazonShoppingHistory, type AmazonOrder } from './amazonOrders';

/**
 * Amazon data export as a ZIP: the « Your Shopping History » JSON files (since 2025) or the older
 * Retail.OrderHistory.N.csv, read in the browser without unpacking anything on disk.
 */

const PHYSICAL = /(^|\/)Orders\.OrderHistory\.\d+\.json$/;
const DIGITAL_ITEMS = /(^|\/)DigitalOrders\.DigitalItems\.\d+\.json$/;
const DIGITAL_MONETARY = /(^|\/)DigitalOrders\.DigitalOrdersMonetary\.\d+\.json$/;
const LEGACY_CSV = /(^|\/)Retail\.OrderHistory\.\d+\.csv$/;

/** Does the archive hold Amazon orders? */
export function isAmazonArchive(buffer: ArrayBuffer): boolean {
	return listZip(buffer).some((e) => PHYSICAL.test(e.name) || LEGACY_CSV.test(e.name));
}

/** Orders of every order file in the archive. */
export async function readAmazonArchive(buffer: ArrayBuffer): Promise<{ orders: AmazonOrder[]; errors: string[] }> {
	const entries = listZip(buffer);
	const json = async (re: RegExp) => {
		const all: unknown[] = [];
		for (const e of entries.filter((x) => re.test(x.name))) {
			const v = JSON.parse(await readZipText(buffer, e)) as unknown;
			if (Array.isArray(v)) all.push(...v);
		}
		return all;
	};
	if (entries.some((e) => PHYSICAL.test(e.name))) {
		return parseAmazonShoppingHistory({ physical: await json(PHYSICAL), digitalItems: await json(DIGITAL_ITEMS), digitalMonetary: await json(DIGITAL_MONETARY) });
	}
	const orders: AmazonOrder[] = [];
	const errors: string[] = [];
	for (const e of entries.filter((x) => LEGACY_CSV.test(x.name))) {
		const r = parseAmazonOrders(await readZipText(buffer, e));
		orders.push(...r.orders);
		errors.push(...r.errors);
	}
	return { orders, errors };
}
