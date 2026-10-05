import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatEUR, maskAmounts, sensitiveEUR, sensitiveEURCompact, sensitiveEURNarrowParts, setPrivacySource } from '../src/lib/format';
import * as sensitive from '../src/lib/sensitiveFormat';

test('mode discret : seuls les montants sensibles sont masqués', () => {
	let on = false;
	setPrivacySource(() => on);
	assert.match(sensitiveEUR(1234.5), /1\u00a0234,50/);
	assert.equal(maskAmounts('sur 4 235 € imposables'), 'sur 4 235 € imposables');
	on = true;
	assert.match(formatEUR(63.23), /63,23/, 'les dépenses du quotidien restent lisibles');
	assert.equal(sensitiveEUR(1234.5), '••••\u00a0€');
	assert.equal(sensitiveEURCompact(-80), '••••\u00a0€');
	assert.deepEqual(sensitiveEURNarrowParts(250000), { main: '••••\u00a0€', suffix: '' });
	assert.equal(sensitive.formatEUR(29186.52), '••••\u00a0€', 'les écrans sensibles importent la version masquée');
	assert.match(sensitive.formatDate('2026-10-05'), /oct/, 'le reste du module est le même');
	assert.equal(maskAmounts('sur 4 235 € imposables, ≈ 0,29 €/km, 1,2 k€'), 'sur ••••\u00a0€ imposables, ≈ ••••\u00a0€/km, ••••\u00a0€');
	assert.equal(maskAmounts('18,7 mois et 13,8 %'), '18,7 mois et 13,8 %');
	setPrivacySource(() => false);
});
