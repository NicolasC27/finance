/**
 * Action `use:floating` for popovers: moves the node to <body> (so a tile's `overflow: auto` or a
 * transformed ancestor never clips or shifts it) and keeps it `position: fixed` under its anchor,
 * flipped above when there is no room below, always inside the viewport. It follows scrolling,
 * resizing and size changes of the popover itself.
 */

interface FloatingOptions {
	anchor: HTMLElement | null | undefined;
	/** Align the popover's left edge on the anchor's ('start') or its right edges ('end'). */
	align?: 'start' | 'end';
	/** Gap between the anchor and the popover, in px. */
	gap?: number;
}

const MARGIN = 8;

/** Fixed position of a popover of size `w` × `h` next to `rect`, inside a `vw` × `vh` viewport. */
export function placeNear(rect: { left: number; right: number; top: number; bottom: number }, w: number, h: number, vw: number, vh: number, align: 'start' | 'end' = 'start', gap = 6): { left: number; top: number } {
	const wanted = align === 'end' ? rect.right - w : rect.left;
	const left = Math.max(MARGIN, Math.min(wanted, vw - w - MARGIN));
	const below = rect.bottom + gap;
	const above = rect.top - gap - h;
	const top = below + h > vh - MARGIN && above >= MARGIN ? above : below;
	return { left: Math.round(left), top: Math.round(Math.max(MARGIN, Math.min(top, vh - h - MARGIN))) };
}

export function floating(node: HTMLElement, initial: FloatingOptions) {
	let options = initial;
	document.body.appendChild(node);
	node.style.position = 'fixed';
	node.style.zIndex = '95';

	const place = () => {
		const anchor = options.anchor;
		if (!anchor || !anchor.isConnected) return;
		const pos = placeNear(anchor.getBoundingClientRect(), node.offsetWidth, node.offsetHeight, window.innerWidth, window.innerHeight, options.align, options.gap);
		node.style.left = `${pos.left}px`;
		node.style.top = `${pos.top}px`;
	};
	place();
	const observer = new ResizeObserver(place);
	observer.observe(node);
	window.addEventListener('scroll', place, true);
	window.addEventListener('resize', place);

	return {
		update(next: FloatingOptions) {
			options = next;
			place();
		},
		destroy() {
			observer.disconnect();
			window.removeEventListener('scroll', place, true);
			window.removeEventListener('resize', place);
			node.remove();
		}
	};
}
