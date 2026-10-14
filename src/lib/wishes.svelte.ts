import { persistJson } from './storage';
import { sanitizeWishes, type Wish, type WishInput } from './wishes';
import { newId } from './trips';

/** Destination wishes (`budget:wishes`): raw state replaced on change. A wish turned into a trip leaves the list (trips.svelte.ts does both). */

const WISHES_KEY = 'budget:wishes';

function load(): Wish[] {
	if (typeof localStorage === 'undefined') return [];
	try {
		return sanitizeWishes(JSON.parse(localStorage.getItem(WISHES_KEY) ?? '[]'));
	} catch {
		return [];
	}
}

class WishesState {
	wishes = $state.raw<Wish[]>(load());
}

export const wishesState = new WishesState();

function persist(): void {
	if (typeof localStorage !== 'undefined') persistJson(WISHES_KEY, wishesState.wishes);
}

export function addWish(input: WishInput): Wish {
	const wish: Wish = { ...input, id: newId('wish'), createdAt: Date.now() };
	wishesState.wishes = [...wishesState.wishes, wish];
	persist();
	return wish;
}

export function updateWish(id: string, patch: Partial<WishInput>): void {
	wishesState.wishes = wishesState.wishes.map((w) => (w.id === id ? { ...w, ...patch } : w));
	persist();
}

export function removeWish(id: string): void {
	wishesState.wishes = wishesState.wishes.filter((w) => w.id !== id);
	persist();
}
