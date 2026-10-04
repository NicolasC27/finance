import { uiState } from '../ui.svelte';

/**
 * Action `use:modal`: shared keyboard behaviour of dialogs:
 * - focus `[data-autofocus]` (otherwise the first focusable element) on open;
 * - Escape → `onEscape` (close WITHOUT deciding: never a remembered decision);
 * - Tab / Shift+Tab loop inside the dialog (the background stays unreachable);
 * - focus returns to the original element on close;
 * - `uiState.dialogDepth` is incremented so page shortcuts stay quiet.
 * Only the most recent dialog (top of the stack) reacts to the keyboard.
 */

interface ModalOptions {
	onEscape?: () => void;
}

const FOCUSABLE =
	'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const stack: HTMLElement[] = [];

export function modal(node: HTMLElement, initial: ModalOptions = {}) {
	let options = initial;
	const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
	stack.push(node);
	uiState.dialogDepth++;

	const focusables = (): HTMLElement[] =>
		[...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);

	queueMicrotask(() => {
		const target = node.querySelector<HTMLElement>('[data-autofocus]') ?? focusables()[0];
		if (target) target.focus();
		else {
			if (!node.hasAttribute('tabindex')) node.setAttribute('tabindex', '-1');
			node.focus();
		}
	});

	function onKeydown(e: KeyboardEvent) {
		if (stack[stack.length - 1] !== node) return;
		if (e.key === 'Escape') {
			if (!options.onEscape) return;
			e.preventDefault();
			e.stopImmediatePropagation();
			options.onEscape();
			return;
		}
		if (e.key !== 'Tab') return;
		const list = focusables();
		if (list.length === 0) {
			e.preventDefault();
			return;
		}
		const first = list[0]!;
		const last = list[list.length - 1]!;
		const active = document.activeElement;
		if (!node.contains(active)) {
			e.preventDefault();
			first.focus();
		} else if (e.shiftKey && active === first) {
			e.preventDefault();
			last.focus();
		} else if (!e.shiftKey && active === last) {
			e.preventDefault();
			first.focus();
		}
	}
	window.addEventListener('keydown', onKeydown, true);

	return {
		update(next: ModalOptions) {
			options = next;
		},
		destroy() {
			window.removeEventListener('keydown', onKeydown, true);
			const i = stack.lastIndexOf(node);
			if (i !== -1) stack.splice(i, 1);
			uiState.dialogDepth = Math.max(0, uiState.dialogDepth - 1);
			if (previous && document.contains(previous)) previous.focus();
		}
	};
}
