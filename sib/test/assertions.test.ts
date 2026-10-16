/** AROMS-332: expectations in the ME's form → bounds; readings judged in words. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseExpectation, parseReading, evaluate, withBounds, stepVerdict } from '../src/oms/assertions.js';

test('parseExpectation: ±, percent, range, one-sided, exact, units', () => {
  assert.deepEqual(parseExpectation('80 Ω ±5 %'), { min: 76, max: 84, unit: 'Ω' });
  assert.deepEqual(parseExpectation('80 +/- 4 ohm'), { min: 76, max: 84, unit: 'Ω' });
  assert.deepEqual(parseExpectation('12.0 N·m ± 0.5'), { min: 11.5, max: 12.5, unit: 'N·m' });
  assert.deepEqual(parseExpectation('20-24 psi'), { min: 20, max: 24, unit: 'psi' });
  assert.deepEqual(parseExpectation('20 to 24 psi'), { min: 20, max: 24, unit: 'psi' });
  assert.deepEqual(parseExpectation('≤ 1.0e-9 mbar·l/s'), { max: 1e-9, unit: 'mbar·l/s' });
  assert.deepEqual(parseExpectation('max 5'), { max: 5, unit: undefined });
  assert.deepEqual(parseExpectation('>= 20 psi'), { min: 20, unit: 'psi' });
  assert.deepEqual(parseExpectation('80 Ω'), { min: 80, max: 80, unit: 'Ω' });
  assert.equal(parseExpectation('no number here'), null);
});

test('parseReading: the number on a display', () => {
  assert.equal(parseReading('79.6 Ω'), 79.6);
  assert.equal(parseReading('1.2E-9 mbar l/s'), 1.2e-9);
  assert.equal(parseReading('12,3 Nm'), 12.3);
  assert.equal(parseReading('OL'), null);
});

test('evaluate: readings within and outside, text exact / contains / any-of, verdict and flags', () => {
  const r = withBounds({ id: 'a', kind: 'text-value', expected: '80 Ω ±5 %', onFail: 'block', source: 'author' });
  assert.equal(r.min, 76); assert.equal(r.unit, 'Ω');
  assert.equal(evaluate(r, '79.6 Ω').pass, true);
  assert.equal(evaluate(r, '79.6 Ω').words, 'Read 79.6 Ω - within 80 Ω ±5 %');
  assert.equal(evaluate(r, '90').pass, false);
  assert.equal(evaluate(r, 'OL').pass, false);
  const label = { id: 'b', kind: 'text-match' as const, expected: 'WARNING HOT SURFACE', onFail: 'flag' as const, source: 'author' as const };
  assert.equal(evaluate(label, 'warning  hot surface').pass, true);
  assert.equal(evaluate({ ...label, match: 'contains' }, 'CAUTION WARNING HOT SURFACE INSIDE').pass, true);
  assert.equal(evaluate({ ...label, match: 'any-of', expected: '注意 | WARNING' }, 'WARNING').pass, true);
  const v = stepVerdict([evaluate(r, '90'), evaluate(label, 'nope')]);
  assert.equal(v.pass, false); assert.equal(v.blocked.length, 1); assert.equal(v.flagged.length, 1);
  assert.equal(stepVerdict([evaluate(r, '80'), evaluate(label, 'nope')]).pass, true);
});
