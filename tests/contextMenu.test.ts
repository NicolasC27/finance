import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SEPARATOR, clampToViewport, cleanItems, composeMenu, isMenuKey, isSeparator, isSubmenu, isTextField, placeSubmenu, stepIndex, typeAhead, type MenuAction, type MenuItem, type MenuSeparator } from '../src/lib/contextMenuModel';

const noop = () => {};
const labels = (items: readonly MenuItem[]) => items.map((i) => (isSeparator(i) ? '—' : i.label));

test('entries: falsy ones dropped, separators only between entries', () => {
	const flag = false;
	const items = cleanItems([SEPARATOR, { label: 'Voir', onSelect: noop }, flag && { label: 'Caché', onSelect: noop }, null, SEPARATOR, SEPARATOR, { label: 'Modifier', onSelect: noop }, undefined, SEPARATOR]);
	assert.deepEqual(labels(items), ['Voir', '—', 'Modifier']);
	assert.deepEqual(cleanItems([SEPARATOR, false, SEPARATOR]), []);
});

test('submenu: kept with its own tidy entries, removed when nothing is left to pick', () => {
	const items = cleanItems([
		{ label: 'Classer dans', items: [SEPARATOR, { label: 'Courses', onSelect: noop }, false, SEPARATOR] },
		{ label: 'Vide', items: [SEPARATOR, null] }
	]);
	assert.equal(items.length, 1);
	const sub = items[0]!;
	assert.ok(isSubmenu(sub));
	assert.deepEqual(labels(sub.items.filter((s): s is MenuAction | MenuSeparator => !!s)), ['Courses']);
});

test('nested elements: nearest entries first, one separator between groups, empty groups skipped', () => {
	const menu = composeMenu([[{ label: 'Ligne', onSelect: noop }], [], [false, null], [{ label: 'Rapport', onSelect: noop }, { label: 'Tout replier', onSelect: noop }]]);
	assert.deepEqual(labels(menu), ['Ligne', '—', 'Rapport', 'Tout replier']);
	assert.deepEqual(composeMenu([]), []);
	assert.deepEqual(composeMenu([[SEPARATOR], [false]]), []);
});

test('position: opens right and down of the pointer, flips when the window is too small, never leaves it', () => {
	assert.deepEqual(clampToViewport(100, 100, 200, 150, 1000, 800), { left: 100, top: 100 });
	assert.deepEqual(clampToViewport(900, 100, 200, 150, 1000, 800), { left: 700, top: 100 }, 'à gauche du pointeur près du bord droit');
	assert.deepEqual(clampToViewport(100, 750, 200, 150, 1000, 800), { left: 100, top: 600 }, 'au-dessus du pointeur près du bas');
	assert.deepEqual(clampToViewport(50, 60, 200, 150, 220, 180), { left: 8, top: 8 }, 'fenêtre trop petite : collé en haut à gauche');
	const tall = clampToViewport(300, 400, 200, 900, 1000, 800);
	assert.equal(tall.top, 8, 'menu plus haut que la fenêtre : il part du haut (et défile)');
});

test('submenu position: beside its entry, on the left when there is no room on the right, inside the window', () => {
	assert.deepEqual(placeSubmenu({ left: 100, right: 300, top: 200 }, 180, 240, 1000, 800), { left: 302, top: 194 });
	assert.deepEqual(placeSubmenu({ left: 700, right: 900, top: 200 }, 180, 240, 1000, 800), { left: 518, top: 194 });
	assert.deepEqual(placeSubmenu({ left: 700, right: 900, top: 700 }, 180, 240, 1000, 800), { left: 518, top: 552 }, 'remonté pour tenir dans la fenêtre');
	assert.deepEqual(placeSubmenu({ left: 4, right: 190, top: 0 }, 180, 240, 200, 800), { left: 8, top: 8 });
});

test('keyboard: arrows wrap, Home and End reach the ends, other keys do nothing', () => {
	assert.equal(stepIndex(4, -1, 'ArrowDown'), 0);
	assert.equal(stepIndex(4, -1, 'ArrowUp'), 3);
	assert.equal(stepIndex(4, 3, 'ArrowDown'), 0);
	assert.equal(stepIndex(4, 0, 'ArrowUp'), 3);
	assert.equal(stepIndex(4, 1, 'Home'), 0);
	assert.equal(stepIndex(4, 1, 'End'), 3);
	assert.equal(stepIndex(4, 1, 'a'), null);
	assert.equal(stepIndex(0, -1, 'ArrowDown'), null);
});

test('type-ahead: next label starting with the letters, accents and case ignored, same letter cycles', () => {
	const list = ['Voir les opérations', 'Modifier', 'Égaliser', 'Masquer du budget', 'Garder en « Autre »'];
	assert.equal(typeAhead(list, -1, 'm'), 1);
	assert.equal(typeAhead(list, 1, 'm'), 3, 'la même lettre passe à l’entrée suivante');
	assert.equal(typeAhead(list, 3, 'm'), 1, 'et repart du début');
	assert.equal(typeAhead(list, 3, 'mm'), 1, 'une lettre répétée cycle aussi');
	assert.equal(typeAhead(list, 1, 'mo'), 1, 'plusieurs lettres : l’entrée courante reste si elle convient');
	assert.equal(typeAhead(list, 1, 'ma'), 3);
	assert.equal(typeAhead(list, -1, 'e'), 2, '« e » trouve « Égaliser »');
	assert.equal(typeAhead(list, -1, 'x'), -1);
	assert.equal(typeAhead(list, -1, ' '), -1);
});

test('menu key: the Menu key or Shift + F10, not with another modifier', () => {
	assert.ok(isMenuKey({ key: 'ContextMenu', shiftKey: false }));
	assert.ok(isMenuKey({ key: 'F10', shiftKey: true }));
	assert.ok(!isMenuKey({ key: 'F10', shiftKey: false }));
	assert.ok(!isMenuKey({ key: 'F10', shiftKey: true, ctrlKey: true }));
	assert.ok(!isMenuKey({ key: 'Enter', shiftKey: true }));
});

test('text fields keep the browser menu: text inputs, textareas, editable content; not buttons, boxes or sliders', () => {
	assert.ok(isTextField({ tagName: 'INPUT', type: 'text' }));
	assert.ok(isTextField({ tagName: 'INPUT', type: 'search' }));
	assert.ok(isTextField({ tagName: 'INPUT', type: 'number' }));
	assert.ok(isTextField({ tagName: 'INPUT' }), 'sans type : texte');
	assert.ok(isTextField({ tagName: 'TEXTAREA' }));
	assert.ok(isTextField({ tagName: 'DIV', isContentEditable: true }));
	assert.ok(!isTextField({ tagName: 'INPUT', type: 'checkbox' }));
	assert.ok(!isTextField({ tagName: 'INPUT', type: 'range' }));
	assert.ok(!isTextField({ tagName: 'BUTTON', isContentEditable: false }));
	assert.ok(!isTextField({ tagName: 'SELECT' }));
	assert.ok(!isTextField({ tagName: 'path' }));
});
