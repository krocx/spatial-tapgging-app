// g2-pages.test.ts - a step as one page of green text for the Even G2
// (sib/g2-client/src/pages.ts), and the portal codes behind it (device-link.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composePage, whereWords, stepParts, PAGE_BUDGET, composeEnd } from '../g2-client/src/pages.js';
import { mintDeviceCode, redeemDeviceCode, deviceTokenFor, deviceTokenAllows, normaliseCode, formatCode, outstandingDeviceCodes } from '../src/middleware/device-link.js';

const bounds = { min: [0, 0, 0], max: [1, 1, 1] };

test('a page carries the step number, title, text, where and parts', () => {
  const p = composePage({ id: 's1', title: 'Fit the O-ring', text: 'Slide the O-ring over the shaft until it seats.', cadPosition: [0.1, 0.9, 0.5], nodes: [{ node: 'cmp:O_RING', show: true }, { node: 'cmp:SHAFT', effect: 'flash' }] }, 2, 12, bounds);
  assert.ok(p.text.startsWith('3/12  Fit the O-ring\n\nSlide the O-ring'));
  assert.ok(p.text.includes('Where: left side, upper part'));
  assert.ok(p.text.includes('Parts: O RING'), p.text);
  assert.ok(!p.text.includes('SHAFT'), 'a bare flash is not a part');
  assert.equal(p.overflow, false);
});

test('curly quotes and dashes become glyphs the firmware font has; long steps are flagged', () => {
  const p = composePage({ id: 's', title: 'Tighten – “by hand”', text: 'x'.repeat(PAGE_BUDGET) }, 0, 1);
  assert.ok(p.text.includes('Tighten - "by hand"'));
  assert.equal(p.overflow, true);
});

test('where-words need a pin and bounds; a validation step says how to answer', () => {
  assert.equal(whereWords({ id: 's' }, bounds), '');
  assert.deepEqual(stepParts({ id: 's', nodes: [{ node: 'a', color: 'red' }, { node: 'b', effect: 'flash' }] }), ['a']);
  const p = composePage({ id: 's', title: 'Check', validation: { required: true } }, 0, 1);
  assert.ok(p.text.includes('Check: Pass / Fail from the menu'));
  assert.ok(composeEnd(3, 4, 1).includes('3/4 steps, 1 failed check'));
});

test('a code is six look-alike-free characters, redeems once into a scoped token', () => {
  const c = mintDeviceCode('g1', 'karthik@example.com', 'Karthik');
  assert.match(c.code, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
  assert.equal(formatCode(c.code).length, 7);
  assert.equal(normaliseCode(' abc-123 '), 'ABC123');
  assert.equal(redeemDeviceCode('ZZZZZZ'), null);
  const t = redeemDeviceCode(formatCode(c.code).toLowerCase());
  assert.ok(t && t.guideId === 'g1' && t.operator === 'Karthik');
  assert.equal(redeemDeviceCode(c.code), null, 'second use');
  assert.equal(outstandingDeviceCodes(), 0);
  assert.ok(deviceTokenFor(t!.token));
  assert.equal(deviceTokenAllows(t!, 'GET', '/guides/g1/bundle'), true);
  assert.equal(deviceTokenAllows(t!, 'POST', '/guide-sessions/live'), true);
  assert.equal(deviceTokenAllows(t!, 'GET', '/guides/g2/bundle'), false, 'another guide');
  assert.equal(deviceTokenAllows(t!, 'GET', '/anchors'), false, 'anything else');
});
