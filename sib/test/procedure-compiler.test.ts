// procedure-compiler.test.ts — unit tests for the Procedure Designer compiler.
// Run: npm run test:sib   (node:test via tsx)
//
// The compiler is pure, so these tests need no stores, server or temp data dir.
//
// Several cases below are deliberately the graph shapes that broke the Guide
// Library graph renderer: a failure branch whose target is also the sequential
// tail, nested forks, and a retry loop back to step 1. That last one is the
// reason start detection ignores incoming `failure` edges — treating them as
// disqualifying reported a perfectly ordinary procedure as having no entry.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Mindmap, MindmapNode, MindmapEdge, MindmapEdgeRole } from '@spatial/shared';
import { compileProcedure } from '../src/procedure/compiler.js';

// ── Builders ────────────────────────────────────────────────────────────────

function N(id: string, x: number, y: number, text: string, notes = ''): MindmapNode {
  return { id, x, y, text, notes, type: 'generic', metadata: {}, updatedAt: 1 };
}

function E(from: string, to: string, role: MindmapEdgeRole): MindmapEdge {
  return { id: `${from}->${to}:${role}`, from, to, role, type: 'directed', updatedAt: 1 };
}

function M(nodes: MindmapNode[], edges: MindmapEdge[], name = 'Test procedure'): Mindmap {
  return { id: 'map-1', name, createdAt: 1, updatedAt: 1, kind: 'procedure', nodes, edges };
}

const codes = (r: ReturnType<typeof compileProcedure>, level: 'error' | 'warning') =>
  r.issues.filter(i => i.level === level).map(i => i.code).sort();

// ── Happy paths ─────────────────────────────────────────────────────────────

test('linear procedure numbers steps in order', () => {
  const r = compileProcedure(M(
    [N('a', 0, 0, 'Check', 'do it'), N('b', 100, 0, 'Inspect', 'look'), N('c', 200, 0, 'Done', 'finish')],
    [E('a', 'b', 'next'), E('b', 'c', 'next')],
  ));
  assert.equal(r.ok, true);
  assert.equal(r.census.lanes, 1);
  assert.deepEqual(r.guide?.steps.map(s => s.sequenceNumber), [1, 2, 3]);
  assert.deepEqual(r.guide?.steps.map(s => s.title), ['Check', 'Inspect', 'Done']);
});

test('success skips ahead while failure detours — the shape that collapsed the portal graph', () => {
  const r = compileProcedure(M(
    [N('a', 0, 0, 'Check oil', 'x'), N('b', 200, 0, 'Inspect hoses', 'x'),
     N('c', 100, 120, 'Top up oil', 'x'), N('d', 300, 0, 'Warm up', 'x')],
    [E('a', 'b', 'next'), E('a', 'c', 'failure'), E('c', 'b', 'next'), E('b', 'd', 'next')],
  ));
  assert.equal(r.ok, true);
  assert.equal(r.census.lanes, 2, 'the recovery step must occupy its own lane');
  const byTitle = Object.fromEntries(r.guide!.steps.map(s => [s.title, s]));
  assert.equal(byTitle['Check oil'].nextOnFailureSeq, byTitle['Top up oil'].sequenceNumber);
  assert.equal(byTitle['Check oil'].nextOnSuccessSeq, byTitle['Inspect hoses'].sequenceNumber);
});

test('nested forks produce one lane each', () => {
  const r = compileProcedure(M(
    [N('a', 0, 0, 'S1', 'x'), N('b', 100, 0, 'S2', 'x'), N('c', 200, 0, 'S3', 'x'),
     N('d', 100, 120, 'R1', 'x'), N('e', 200, 120, 'R2', 'x'), N('f', 200, 240, 'R3', 'x')],
    [E('a', 'b', 'next'), E('b', 'c', 'next'),
     E('a', 'd', 'failure'), E('d', 'e', 'next'), E('d', 'f', 'failure')],
  ));
  assert.equal(r.ok, true);
  assert.equal(r.census.lanes, 3);
});

test('retry loop back to the first step is valid and opens no lane', () => {
  const r = compileProcedure(M(
    [N('a', 0, 0, 'S1', 'x'), N('b', 100, 0, 'S2', 'x'), N('c', 200, 0, 'S3', 'x')],
    [E('a', 'b', 'next'), E('b', 'c', 'next'), E('c', 'a', 'failure')],
  ));
  assert.equal(r.ok, true, 'an incoming failure edge must not disqualify the start step');
  assert.equal(r.census.lanes, 1);
});

test('a prerequisite earlier in the flow compiles to precondition', () => {
  const r = compileProcedure(M(
    [N('a', 0, 0, 'S1', 'x'), N('b', 100, 0, 'S2', 'x'), N('c', 200, 0, 'S3', 'x')],
    [E('a', 'b', 'next'), E('b', 'c', 'next'), E('a', 'c', 'requires')],
  ));
  assert.equal(r.ok, true);
  assert.equal(r.guide?.steps.find(s => s.title === 'S3')?.preconditionSeq, 1);
});

test('a step with a title but no notes compiles, using the title as the instruction', () => {
  const r = compileProcedure(M(
    [N('a', 0, 0, 'Check the gauge', ''), N('b', 100, 0, 'Done', 'x')],
    [E('a', 'b', 'next')],
  ));
  assert.equal(r.ok, true);
  assert.equal(r.guide?.steps[0].text, 'Check the gauge');
  assert.ok(codes(r, 'warning').includes('title-only'));
});

// ── Blocking validation ─────────────────────────────────────────────────────

test('two Next edges from one step is ambiguous and blocks', () => {
  const r = compileProcedure(M(
    [N('a', 0, 0, 'S1', 'x'), N('b', 100, 0, 'S2', 'x'), N('c', 100, 80, 'S3', 'x')],
    [E('a', 'b', 'next'), E('a', 'c', 'next')],
  ));
  assert.equal(r.ok, false);
  assert.ok(codes(r, 'error').includes('dup-next'));
});

test('two On failure edges from one step blocks', () => {
  const r = compileProcedure(M(
    [N('a', 0, 0, 'S1', 'x'), N('b', 100, 0, 'S2', 'x'), N('c', 100, 80, 'S3', 'x')],
    [E('a', 'b', 'failure'), E('a', 'c', 'failure')],
  ));
  assert.equal(r.ok, false);
  assert.ok(codes(r, 'error').includes('dup-failure'));
});

test('an unreachable step blocks', () => {
  const r = compileProcedure(M(
    [N('a', 0, 0, 'S1', 'x'), N('b', 100, 0, 'S2', 'x'), N('z', 400, 300, 'Orphan', 'x')],
    [E('a', 'b', 'next')],
  ));
  assert.equal(r.ok, false);
  assert.deepEqual(codes(r, 'error'), ['unreachable']);
});

test('a closed cycle has no entry point and blocks', () => {
  const r = compileProcedure(M(
    [N('a', 0, 0, 'S1', 'x'), N('b', 100, 0, 'S2', 'x')],
    [E('a', 'b', 'next'), E('b', 'a', 'next')],
  ));
  assert.equal(r.ok, false);
  assert.deepEqual(codes(r, 'error'), ['no-start']);
});

test('a step with no text at all blocks', () => {
  const r = compileProcedure(M(
    [N('a', 0, 0, 'S1', 'x'), N('b', 100, 0, '', '')],
    [E('a', 'b', 'next')],
  ));
  assert.equal(r.ok, false);
  assert.ok(codes(r, 'error').includes('empty-text'));
});

test('a prerequisite that comes later is a deadlock and blocks', () => {
  const r = compileProcedure(M(
    [N('a', 0, 0, 'S1', 'x'), N('b', 100, 0, 'S2', 'x'), N('c', 200, 0, 'S3', 'x')],
    [E('a', 'b', 'next'), E('b', 'c', 'next'), E('c', 'a', 'requires')],
  ));
  assert.equal(r.ok, false);
  assert.ok(codes(r, 'error').includes('requires-after'));
});

test('an empty map blocks', () => {
  const r = compileProcedure(M([], []));
  assert.equal(r.ok, false);
  assert.deepEqual(codes(r, 'error'), ['empty-map']);
});

// ── Warnings that do not block ──────────────────────────────────────────────

test('an edge with no relationship is ignored and warned about', () => {
  const r = compileProcedure(M(
    [N('a', 0, 0, 'S1', 'x'), N('b', 100, 0, 'S2', 'x')],
    [{ id: 'e1', from: 'a', to: 'b', type: 'directed', updatedAt: 1 } as MindmapEdge],
  ));
  assert.ok(codes(r, 'warning').includes('unroled-edge'));
  assert.ok(codes(r, 'error').includes('unreachable'), 'the ignored edge leaves S2 unconnected');
});

test('a second prerequisite warns but still compiles', () => {
  const r = compileProcedure(M(
    [N('a', 0, 0, 'S1', 'x'), N('b', 100, 0, 'S2', 'x'), N('c', 200, 0, 'S3', 'x')],
    [E('a', 'b', 'next'), E('b', 'c', 'next'), E('a', 'c', 'requires'), E('b', 'c', 'requires')],
  ));
  assert.equal(r.ok, true);
  assert.ok(codes(r, 'warning').includes('multi-requires'));
});

// ── Census and derived order ────────────────────────────────────────────────

test('census matches the Guide Library graph header fields', () => {
  const r = compileProcedure(M(
    [N('a', 0, 0, 'S1', 'x'), N('b', 100, 0, 'S2', 'x'), N('c', 100, 120, 'R', 'x')],
    [E('a', 'b', 'next'), E('a', 'c', 'failure'), E('a', 'b', 'requires')],
  ));
  assert.equal(r.census.steps, 3);
  assert.equal(r.census.next, 1);
  assert.equal(r.census.failure, 1);
  assert.equal(r.census.requires, 1);
});

test('order map is returned so the canvas can render the numbers the compiler will emit', () => {
  const r = compileProcedure(M(
    [N('a', 0, 0, 'S1', 'x'), N('b', 100, 0, 'S2', 'x')],
    [E('a', 'b', 'next')],
  ));
  assert.deepEqual(r.order, { a: 1, b: 2 });
});
