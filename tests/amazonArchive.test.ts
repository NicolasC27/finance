import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { parseAmazonShoppingHistory } from '../src/lib/amazonOrders';
import { isAmazonArchive, readAmazonArchive } from '../src/lib/amazonArchive';
import { isZip, listZip, readZipText } from '../src/lib/unzip';

/** Builds a ZIP in memory (deflated entries) to test the reader. */
function zip(files: Record<string, string>): ArrayBuffer {
	const locals: Buffer[] = [];
	const central: Buffer[] = [];
	let offset = 0;
	for (const [name, content] of Object.entries(files)) {
		const nameBuf = Buffer.from(name);
		const raw = Buffer.from(content);
		const data = deflateRawSync(raw);
		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(8, 8);
		local.writeUInt32LE(data.length, 18);
		local.writeUInt32LE(raw.length, 22);
		local.writeUInt16LE(nameBuf.length, 26);
		locals.push(local, nameBuf, data);
		const c = Buffer.alloc(46);
		c.writeUInt32LE(0x02014b50, 0);
		c.writeUInt16LE(8, 10);
		c.writeUInt32LE(data.length, 20);
		c.writeUInt32LE(raw.length, 24);
		c.writeUInt16LE(nameBuf.length, 28);
		c.writeUInt32LE(offset, 42);
		central.push(c, nameBuf);
		offset += 30 + nameBuf.length + data.length;
	}
	const cd = Buffer.concat(central);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(Object.keys(files).length, 8);
	end.writeUInt16LE(Object.keys(files).length, 10);
	end.writeUInt32LE(cd.length, 12);
	end.writeUInt32LE(offset, 16);
	const all = Buffer.concat([...locals, cd, end]);
	return all.buffer.slice(all.byteOffset, all.byteOffset + all.byteLength);
}

const PHYSICAL = [
	{ orderId: '111-0000001', orderDate: '2026-09-01T10:00:00Z', productName: 'Câble USB-C  1 m', totalOwed: 9.99, quantity: 1, website: 'Amazon.fr' },
	{ orderId: '111-0000001', orderDate: '2026-09-01T10:00:00Z', productName: 'Piles AA', totalOwed: 6.5, quantity: 2, website: 'Amazon.fr' },
	{ orderId: '111-0000002', orderDate: '2026-09-03T08:00:00Z', productName: 'Échantillon gratuit', totalOwed: 0, quantity: 1, website: 'Amazon.fr' }
];

test('parseAmazonShoppingHistory: items grouped by order, free rows skipped, digital items priced', () => {
	const r = parseAmazonShoppingHistory({
		physical: PHYSICAL,
		digitalItems: [{ digitalOrderItemId: 'D1', title: 'Livre numérique', eventDate: '2026-08-20T12:00:00Z' }],
		digitalMonetary: [
			{ digitalOrderItemId: 'D1', transactionAmount: 4.17, monetaryComponentTypeCode: 'Price Amount' },
			{ digitalOrderItemId: 'D1', transactionAmount: 0.82, monetaryComponentTypeCode: 'Tax' }
		]
	});
	assert.deepEqual(r.errors, []);
	assert.equal(r.orders.length, 2);
	const o = r.orders.find((x) => x.id === '111-0000001')!;
	assert.equal(o.total, 16.49);
	assert.equal(o.orderDate, '2026-09-01');
	assert.deepEqual(o.items.map((i) => i.name), ['Câble USB-C 1 m', 'Piles AA']);
	assert.equal(r.orders.find((x) => x.id === 'D1')!.total, 4.99);
});

test('unzip and readAmazonArchive: JSON export read from the ZIP', async () => {
	const buf = zip({ 'Orders.OrderHistory.2.json': JSON.stringify(PHYSICAL), 'Orders.OrderHistory.2.schema.json': '{}', 'SearchHistory.Queries.json': '[]' });
	assert.equal(isZip(buf), true);
	assert.deepEqual(listZip(buf).map((e) => e.name), ['Orders.OrderHistory.2.json', 'Orders.OrderHistory.2.schema.json', 'SearchHistory.Queries.json']);
	assert.equal(await readZipText(buf, listZip(buf)[2]!), '[]');
	assert.equal(isAmazonArchive(buf), true);
	const r = await readAmazonArchive(buf);
	assert.equal(r.orders.length, 1);
	assert.equal(r.orders[0]!.total, 16.49);
	assert.equal(isAmazonArchive(zip({ 'photo.json': '[]' })), false);
});

test('readAmazonArchive: legacy CSV inside the ZIP', async () => {
	const csv = 'Order ID,Order Date,Product Name,Total Owed,Quantity\n222-1,2024-02-01,Lampe,19.90,1\n';
	const r = await readAmazonArchive(zip({ 'Retail.OrderHistory.1/Retail.OrderHistory.1.csv': csv }));
	assert.equal(r.orders.length, 1);
	assert.equal(r.orders[0]!.total, 19.9);
});
