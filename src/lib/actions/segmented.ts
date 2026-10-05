/**
 * Action `use:segmented` for single-choice button groups (chips, view switches): a pill slides
 * behind the active button (`aria-pressed="true"`) instead of the background jumping from one
 * button to the next. The active button's own background is made transparent by the `.seg-host`
 * CSS so the pill shows through. Re-inserts the pill if a keyed block clears the container.
 */
export function segmented(node: HTMLElement): { destroy(): void } {
	node.classList.add('seg-host');
	const pill = document.createElement('span');
	pill.className = 'seg-pill';
	pill.setAttribute('aria-hidden', 'true');
	let placed = false;

	const place = () => {
		if (!pill.isConnected) node.prepend(pill);
		const active = node.querySelector<HTMLElement>(':scope > [aria-pressed="true"]');
		if (!active) {
			pill.style.opacity = '0';
			return;
		}
		pill.classList.toggle('seg-pill-instant', !placed);
		pill.style.opacity = '1';
		pill.style.width = `${active.offsetWidth}px`;
		pill.style.height = `${active.offsetHeight}px`;
		pill.style.transform = `translate(${active.offsetLeft}px, ${active.offsetTop}px)`;
		placed = true;
	};

	const mutations = new MutationObserver(place);
	mutations.observe(node, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-pressed', 'class'] });
	const resize = new ResizeObserver(place);
	resize.observe(node);
	place();

	return {
		destroy() {
			mutations.disconnect();
			resize.disconnect();
			pill.remove();
			node.classList.remove('seg-host');
		}
	};
}
