// portfolio.test.ts - the POC Portfolio's gates, order and summary (pure).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { UseCase, Poc } from '@spatial/shared';
import { pocGate, useCaseGate, sortForOverview, summary, currentPoc, seedUseCases, lastActivity, STALE_DAYS } from '../src/portfolio/portfolio-core.js';

const at = '2026-10-01T00:00:00.000Z';
const poc = (over: Partial<Poc> = {}): Poc => ({ id: 'p1', number: 1, name: 'POC-1', stage: 'planned', tracks: ['content-pipeline'], status: [], bottlenecks: [], learnings: [], ...over });
const uc = (over: Partial<UseCase> = {}): UseCase => ({ id: 'u', bu: 'MDP', name: 'x', question: 'q', stage: 'identified', health: 'green', anchorIds: [], guideIds: [], pocs: [], createdAt: at, createdBy: 't', updatedAt: at, updatedBy: 't', ...over });

test('a POC starts only with scope and definition of done', () => {
  assert.equal(pocGate(poc(), 'in-progress', false).ok, false);
  assert.equal(pocGate(poc({ scope: 's' }), 'in-progress', false).ok, false);
  assert.equal(pocGate(poc({ scope: 's', definitionOfDone: 'd' }), 'in-progress', false).ok, true);
});

test('a POC completes only with a learning, an exit and a scorecard entry on its tracks; parking needs a reason', () => {
  const p = poc({ stage: 'in-progress', scope: 's', definitionOfDone: 'd', startedAt: at });
  assert.equal(pocGate(p, 'completed', true).ok, false);
  const withLearning = { ...p, learnings: [{ id: 'l', at, by: 't', text: 'learned' }] };
  assert.equal(pocGate(withLearning, 'completed', true).ok, false);                        // no exit
  assert.equal(pocGate({ ...withLearning, exit: 'next-poc' }, 'completed', false).ok, false); // scorecard untouched
  assert.equal(pocGate({ ...withLearning, exit: 'next-poc' }, 'completed', true).ok, true);
  assert.equal(pocGate({ ...withLearning, exit: 'parked' }, 'completed', true).ok, false);    // no reason
  assert.equal(pocGate({ ...withLearning, exit: 'parked', exitReason: 'no HW' }, 'completed', true).ok, true);
  assert.equal(pocGate({ ...withLearning, tracks: [] , exit: 'pilot' }, 'completed', false).ok, true); // no tracks → no scorecard gate
  assert.equal(pocGate({ ...withLearning, stage: 'completed' }, 'planned', true).ok, false);
});

test('use-case stages follow the POCs', () => {
  assert.equal(useCaseGate(uc(), 'active').ok, false);
  assert.equal(useCaseGate(uc({ pocs: [poc({ stage: 'in-progress' })] }), 'active').ok, true);
  assert.equal(useCaseGate(uc({ pocs: [poc({ stage: 'completed', exit: 'next-poc' })] }), 'pilot').ok, false);
  assert.equal(useCaseGate(uc({ pocs: [poc({ stage: 'completed', exit: 'pilot' })] }), 'pilot').ok, true);
  assert.equal(useCaseGate(uc({ pocs: [poc({ scope: 's', definitionOfDone: 'd' })] }), 'agreed').ok, true);
});

test('overview order: decisions waiting, then red, then the stalest; summary counts', () => {
  const now = new Date('2026-10-20T00:00:00Z');
  const decision = uc({ id: 'dec', health: 'green', pocs: [poc({ bottlenecks: [{ id: 'b', at, by: 't', text: 'x', owner: 'o', severity: 'high', needsLeadership: true }] })] });
  const red = uc({ id: 'red', health: 'red', updatedAt: '2026-10-19T00:00:00Z' });
  const stale = uc({ id: 'stale', health: 'green', updatedAt: '2026-09-01T00:00:00Z' });
  const fresh = uc({ id: 'fresh', health: 'green', updatedAt: '2026-10-19T00:00:00Z' });
  assert.deepEqual(sortForOverview([fresh, stale, red, decision], now).map(u => u.id), ['dec', 'red', 'stale', 'fresh']);
  const s = summary([decision, red, stale, fresh], now);
  assert.equal(s.decisions, 1); assert.equal(s.red, 1); assert.equal(s.stale, 2); assert.ok(s.oldestUpdateDays > STALE_DAYS);
  assert.equal(lastActivity(decision), at);
});

test('current POC is the one in progress, else the next planned, else the last; the seed is complete', () => {
  const u = uc({ pocs: [poc({ id: 'a', number: 1, stage: 'completed' }), poc({ id: 'b', number: 2, stage: 'planned' })] });
  assert.equal(currentPoc(u)?.id, 'b');
  const seed = seedUseCases(at, 'seed');
  assert.equal(seed.length, 3);
  assert.deepEqual([...new Set(seed.map(s => s.bu))].sort(), ['ETCH', 'MDP']);
  for (const s of seed) for (const p of s.pocs) { assert.ok(p.scope && p.definitionOfDone, `${s.id} POC-${p.number} has scope + DoD`); assert.ok(p.tracks.length); }
  assert.equal(seed.flatMap(s => s.pocs).filter(p => p.stage === 'in-progress').length, 2);
});
