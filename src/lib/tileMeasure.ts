/**
 * Tile measurements shared by Block and TileCanvas: what a tile adds around its content (padding and
 * border), the outer height reported for a content height, and whether a press hit a real scrollbar.
 * The DOM helpers read computed styles; `pressOnScrollbar` is pure (testable with tsx).
 */

/** Vertical padding plus border of an element, in px. */
export function verticalChrome(el: Element): number {
	const cs = getComputedStyle(el);
	return parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
}

/** Outer height of a tile whose content measures `content` px (plus 1 px against rounding). */
export function tileOuterHeight(tile: Element, content: number): number {
	return content + verticalChrome(tile) + 1;
}

/** What `pressOnScrollbar` needs to know about the pressed element. */
export interface ScrollBox {
	overflowX: string;
	overflowY: string;
	clientWidth: number;
	clientHeight: number;
	scrollWidth: number;
	scrollHeight: number;
}

const SCROLLS = /^(auto|scroll|overlay)$/;

/**
 * A press lands on a scrollbar only when the element really scrolls on that axis (overflow auto or
 * scroll and content larger than the box) and the press is past its client area. Inline text has a
 * client size of 0 and never scrolls: a press on it is never a scrollbar press.
 */
export function pressOnScrollbar(box: ScrollBox, offsetX: number, offsetY: number): boolean {
	const scrollsY = SCROLLS.test(box.overflowY) && box.scrollHeight > box.clientHeight;
	const scrollsX = SCROLLS.test(box.overflowX) && box.scrollWidth > box.clientWidth;
	return (scrollsY && offsetX > box.clientWidth) || (scrollsX && offsetY > box.clientHeight);
}

/** `pressOnScrollbar` for a pointer event on an element. */
export function pressedScrollbar(el: HTMLElement, offsetX: number, offsetY: number): boolean {
	const cs = getComputedStyle(el);
	return pressOnScrollbar({ overflowX: cs.overflowX, overflowY: cs.overflowY, clientWidth: el.clientWidth, clientHeight: el.clientHeight, scrollWidth: el.scrollWidth, scrollHeight: el.scrollHeight }, offsetX, offsetY);
}
