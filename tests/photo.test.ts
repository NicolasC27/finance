import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commonsPageUrl, isPhotoFile, parseEntityPhoto, parseSearchItem, SKIES, skyOf } from '../src/lib/photo';
import { cleanWidth } from '../server/photo';

const claim = (value: string, rank = 'normal') => ({ mainsnak: { datavalue: { value } }, rank });

test('parseEntityPhoto: the Wikivoyage banner first (preferred rank on top), the picture when it is a view, nothing for a missing item', () => {
	assert.deepEqual(parseEntityPhoto({ entities: { Q597: { claims: { P948: [claim('Lisboa banner.jpg')], P18: [claim('Lisboa837.png')] } } } }), { file: 'Lisboa banner.jpg', kind: 'banner' });
	assert.deepEqual(parseEntityPhoto({ entities: { Q1: { claims: { P948: [claim('Old banner.jpg'), claim('New banner.jpg', 'preferred')] } } } }), { file: 'New banner.jpg', kind: 'banner' });
	assert.deepEqual(parseEntityPhoto({ entities: { Q1: { claims: { P18: [claim('Montage de la ville.jpg'), claim('Vieux port.jpg')] } } } }), { file: 'Vieux port.jpg', kind: 'image' });
	assert.equal(parseEntityPhoto({ entities: { Q1: { claims: { P18: [claim('Flag of Japan.svg'), claim('Japan locator map.png'), claim('Carte du pays.png')] } } } }), null);
	assert.equal(parseEntityPhoto({ entities: { Q1: { claims: { P18: [claim('Vieux port.jpg')] } } } }, true), null);
	assert.equal(parseEntityPhoto({ entities: { '-1': { missing: '' } } }), null);
	assert.equal(parseEntityPhoto({ entities: { Q1: { claims: { P948: [claim('../etc/passwd.jpg'), claim('no-extension')] } } } }), null);
	assert.equal(parseEntityPhoto(null), null);
	assert.equal(parseEntityPhoto('x'), null);
});

test('parseSearchItem: the Wikidata item of the first page found', () => {
	assert.equal(parseSearchItem({ query: { pages: [{ pageprops: { wikibase_item: 'Q597' } }] } }), 'Q597');
	assert.equal(parseSearchItem({ query: { pages: [{ pageprops: {} }] } }), null);
	assert.equal(parseSearchItem({ query: { pages: [{ pageprops: { wikibase_item: 'drop table' } }] } }), null);
	assert.equal(parseSearchItem({}), null);
});

test('isPhotoFile and cleanWidth: what the proxy accepts', () => {
	assert.equal(isPhotoFile('Lisboa banner.jpg'), true);
	assert.equal(isPhotoFile('Annecy banner Footbridge over river.JPG'), true);
	assert.equal(isPhotoFile('a/b.jpg'), false);
	assert.equal(isPhotoFile('..hidden.jpg'), false);
	assert.equal(isPhotoFile('.hidden.jpg'), false);
	assert.equal(isPhotoFile('readme.txt'), false);
	assert.equal(isPhotoFile(`${'x'.repeat(200)}.jpg`), false);
	assert.equal(isPhotoFile(42), false);
	assert.equal(cleanWidth('480'), 480);
	assert.equal(cleanWidth('1600'), 1600);
	assert.equal(cleanWidth('1601'), null);
	assert.equal(cleanWidth(null), null);
});

test('commonsPageUrl and skyOf', () => {
	assert.equal(commonsPageUrl('Lisboa banner.jpg'), 'https://commons.wikimedia.org/wiki/File:Lisboa_banner.jpg');
	assert.equal(commonsPageUrl('Marrakech, Bab Agnaou door.JPG'), 'https://commons.wikimedia.org/wiki/File:Marrakech%2C_Bab_Agnaou_door.JPG');
	assert.equal(skyOf('Lisbonne'), skyOf('Lisbonne'));
	assert.ok(SKIES.includes(skyOf('')));
	assert.ok(SKIES.includes(skyOf('Japon')));
	assert.equal(new Set(['Lisbonne', 'Japon', 'Rome', 'Bali', 'Corse', 'Annecy', 'Islande', 'Marrakech'].map((n) => skyOf(n))).size > 2, true);
});
