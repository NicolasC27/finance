/**
 * Minimal ZIP reader (no dependency): the central directory lists the entries, an entry is
 * inflated with the platform's DecompressionStream ('deflate-raw'), available in browsers and
 * Node 18+. Stored (0) and deflated (8) entries only, no ZIP64, no encryption.
 */

export interface ZipEntry {
	name: string;
	method: number;
	compressedSize: number;
	size: number;
	/** Offset of the local file header. */
	offset: number;
}

const decoder = new TextDecoder();

/** Is the buffer a ZIP archive (« PK\x03\x04 » signature)? */
export function isZip(buffer: ArrayBuffer): boolean {
	const b = new Uint8Array(buffer, 0, Math.min(4, buffer.byteLength));
	return b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
}

/** Entries of the archive, read from its central directory ([] when it cannot be found). */
export function listZip(buffer: ArrayBuffer): ZipEntry[] {
	const view = new DataView(buffer);
	const bytes = new Uint8Array(buffer);
	let eocd = -1;
	for (let i = buffer.byteLength - 22; i >= Math.max(0, buffer.byteLength - 65557); i--) {
		if (view.getUint32(i, true) === 0x06054b50) {
			eocd = i;
			break;
		}
	}
	if (eocd < 0) return [];
	const count = view.getUint16(eocd + 10, true);
	let p = view.getUint32(eocd + 16, true);
	const out: ZipEntry[] = [];
	for (let n = 0; n < count && p + 46 <= buffer.byteLength; n++) {
		if (view.getUint32(p, true) !== 0x02014b50) break;
		const nameLength = view.getUint16(p + 28, true);
		const extraLength = view.getUint16(p + 30, true);
		const commentLength = view.getUint16(p + 32, true);
		out.push({
			name: decoder.decode(bytes.subarray(p + 46, p + 46 + nameLength)),
			method: view.getUint16(p + 10, true),
			compressedSize: view.getUint32(p + 20, true),
			size: view.getUint32(p + 24, true),
			offset: view.getUint32(p + 42, true)
		});
		p += 46 + nameLength + extraLength + commentLength;
	}
	return out;
}

/** Content of an entry as text (UTF-8). */
export async function readZipText(buffer: ArrayBuffer, entry: ZipEntry): Promise<string> {
	const view = new DataView(buffer);
	if (view.getUint32(entry.offset, true) !== 0x04034b50) throw new Error(`entrée ${entry.name} illisible`);
	const start = entry.offset + 30 + view.getUint16(entry.offset + 26, true) + view.getUint16(entry.offset + 28, true);
	const data = new Uint8Array(buffer, start, entry.compressedSize);
	if (entry.method === 0) return decoder.decode(data);
	if (entry.method !== 8) throw new Error(`compression non prise en charge (${entry.method})`);
	const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
	return new Response(stream).text();
}
