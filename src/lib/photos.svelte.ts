import { fetchLocal, LOCAL_HEADERS } from './localApi';
import { isPhotoFile, type Photo, type PhotoWidth } from './photo';

/**
 * Destination photos, app side: for each query the server's answer (a Commons file, or none),
 * for each file and width the image as a blob URL, fetched through the local server with its
 * access header (an <img src> could not send it) and kept for the session. A failed lookup or
 * download is remembered five minutes, then tried again. Raw state, replaced on change.
 */

const RETRY_MS = 5 * 60_000;

export interface PhotoView {
	/** Blob URL of the image. */
	url: string;
	file: string;
	kind: Photo['kind'];
}

class PhotosState {
	/** Query → photo found (null = none); a query not asked yet is absent. */
	lookups = $state.raw<Record<string, Photo | null>>({});
	/** « width:file » → blob URL once downloaded. */
	images = $state.raw<Record<string, string>>({});
}

export const photosState = new PhotosState();

const inflight = new Map<string, Promise<unknown>>();
const failedAt = new Map<string, number>();

const isPhoto = (v: unknown): v is Photo => isPhotoFile((v as Photo | null)?.file) && ((v as Photo).kind === 'banner' || (v as Photo).kind === 'image');

const recentlyFailed = (key: string) => Date.now() - (failedAt.get(key) ?? -Infinity) < RETRY_MS;

/** Runs the job once for its key while it is pending. */
function once<T>(key: string, job: () => Promise<T>): Promise<T> {
	const running = inflight.get(key) as Promise<T> | undefined;
	if (running) return running;
	const p = job().finally(() => inflight.delete(key));
	inflight.set(key, p);
	return p;
}

async function lookup(query: string): Promise<Photo | null> {
	const known = photosState.lookups[query];
	if (known !== undefined) return known;
	if (recentlyFailed(`q:${query}`)) return null;
	return once(`q:${query}`, async () => {
		try {
			const body = await fetchLocal<{ photo?: unknown }>(`/__photo?q=${encodeURIComponent(query)}`);
			const photo = isPhoto(body.photo) ? body.photo : null;
			photosState.lookups = { ...photosState.lookups, [query]: photo };
			return photo;
		} catch {
			failedAt.set(`q:${query}`, Date.now());
			return null;
		}
	});
}

async function download(file: string, width: PhotoWidth): Promise<void> {
	const key = `${width}:${file}`;
	if (photosState.images[key] || recentlyFailed(key)) return;
	await once(key, async () => {
		try {
			const res = await fetch(`/__photo/file?f=${encodeURIComponent(file)}&w=${width}`, { headers: LOCAL_HEADERS });
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const url = URL.createObjectURL(await res.blob());
			photosState.images = { ...photosState.images, [key]: url };
		} catch {
			failedAt.set(key, Date.now());
		}
	});
}

/** Makes sure the first query with a photo has its image at that width; the page reads `photoFor` meanwhile. */
export async function ensurePhoto(queries: readonly string[], width: PhotoWidth): Promise<void> {
	for (const q of queries) {
		const photo = await lookup(q);
		if (photo) return download(photo.file, width);
	}
}

/** The photo to show for these queries at that width: undefined while unknown or loading, null when none, the image once there. */
export function photoFor(queries: readonly string[], width: PhotoWidth): PhotoView | null | undefined {
	for (const q of queries) {
		const photo = photosState.lookups[q];
		if (photo === undefined) return undefined;
		if (photo === null) continue;
		const url = photosState.images[`${width}:${photo.file}`];
		return url ? { url, file: photo.file, kind: photo.kind } : undefined;
	}
	return null;
}
