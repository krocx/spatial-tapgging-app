// layout.ts - auto-layout algorithms (pure functions: graph in → positions out).
//
// hierarchical: layered left-to-right BFS from root nodes (in-degree 0 over
//               directed edges). Disconnected components stack vertically.
// grid:         tidy grid for freeform maps with no meaningful hierarchy.

import type { Mindmap, MindmapNode, MindmapLane } from '@spatial/shared';
import { NODE_W, nodeHeight } from './geometry.js';
import { groupIntoSections, SECTION_WRAP } from '../../../src/procedure/sections.js';

const H_GAP = 100;
const V_GAP = 36;

export type LayoutMode = 'hierarchical' | 'grid' | 'sections';

/** Returns a new node array with updated x/y (updatedAt bumped by caller). */
export function autoLayout(map: Mindmap, mode: LayoutMode): MindmapNode[] {
  return mode === 'hierarchical' ? layeredLayout(map) : mode === 'sections' ? sectionsLayout(map).nodes : gridLayout(map.nodes);
}

// ── Sections (2026.4.50) ──────────────────────────────────────────────────────
// A long procedure folded into rows: the success spine (start → next → …) is
// grouped by section (sib/src/procedure/sections.ts - title index, explicit
// section, or chunks of 10), one band per section with the steps wrapping
// every 10, read left to right then top to bottom. A failure branch sits in a sub-row under the step it leaves.
// Mirrors the server's reverse compiler so a re-flowed map looks like a fresh
// one. Order is edges only - this never changes what compiles.
const SEC_COL_W = 240, SEC_LANE_H = 170, SEC_X0 = 140, SEC_Y0 = 220, SEC_ROW_PAD = 50;

export function sectionsLayout(map: Mindmap): { nodes: MindmapNode[]; lanes: MindmapLane[] } {
  const nodes = map.nodes;
  const byId = new Map(nodes.map(n => [n.id, n]));
  const nextOf = new Map<string, string>(); const failOf = new Map<string, string>();
  const incoming = new Set<string>();
  for (const e of map.edges) {
    if (!byId.has(e.from) || !byId.has(e.to)) continue;
    if (e.role === 'next' && !nextOf.has(e.from)) nextOf.set(e.from, e.to);
    if (e.role === 'failure' && !failOf.has(e.from)) failOf.set(e.from, e.to);
    if (e.role === 'next' || e.role === 'failure') incoming.add(e.to);
  }
  const stepNodes = nodes.filter(n => !!(n.metadata as { guide?: unknown } | undefined)?.guide || nextOf.has(n.id) || incoming.has(n.id));
  if (stepNodes.length === 0) return { nodes, lanes: map.lanes ?? [] };
  const start = stepNodes.find(n => !incoming.has(n.id)) ?? [...stepNodes].sort((a, b) => a.x - b.x || a.y - b.y)[0];

  const pos = new Map<string, { col: number; lane: number }>();
  const spine: string[] = [];
  { let id: string | undefined = start.id; const seen = new Set<string>();
    while (id && byId.has(id) && !seen.has(id)) { seen.add(id); spine.push(id); id = nextOf.get(id); } }

  const sectionOfNode = (n: MindmapNode) => ({ title: n.text, section: (n.metadata as { step?: { section?: string } } | undefined)?.step?.section });
  const sections = groupIntoSections(spine.map(id => sectionOfNode(byId.get(id)!)));
  const rows: { name: string; lane: number; lanes: number }[] = [];
  const rowOfNode = new Map<string, number>();
  let lane = 0;
  sections.forEach((sec, r) => {
    const wrapRows = Math.max(1, Math.ceil(sec.members.length / SECTION_WRAP));
    rows.push({ name: sec.name, lane, lanes: wrapRows });
    sec.members.forEach((m, i) => { pos.set(spine[m], { col: i % SECTION_WRAP, lane: lane + Math.floor(i / SECTION_WRAP) }); rowOfNode.set(spine[m], r); });
    lane += wrapRows;
  });
  const walk = (startId: string, atLane: number) => {
    let id: string | undefined = startId; let col = 0;
    while (id && byId.has(id) && !pos.has(id)) { pos.set(id, { col, lane: atLane }); id = nextOf.get(id); col++; }
  };
  const placeBranch = (target: string, from: string) => {
    if (pos.has(target)) return;
    const r = rowOfNode.get(from) ?? rows.length - 1;
    const row = rows[r]; const newLane = row.lane + row.lanes; row.lanes++;
    for (const p of pos.values()) if (p.lane >= newLane) p.lane++;
    for (let k = r + 1; k < rows.length; k++) rows[k].lane++;
    walk(target, newLane);
    for (const [id, p] of pos) if (p.lane === newLane) rowOfNode.set(id, r);
  };
  for (const [from, to] of failOf) placeBranch(to, from);
  for (const n of stepNodes) if (!pos.has(n.id)) {
    const top = rows.length ? rows[rows.length - 1].lane + rows[rows.length - 1].lanes : 0;
    rows.push({ name: 'Unreached', lane: top, lanes: 1 }); walk(n.id, top);
  }
  // Existing row lanes keep their (possibly renamed) names by position.
  const oldRows = (map.lanes ?? []).filter(l => l.orientation === 'row');
  const lanes: MindmapLane[] = rows.map((r, i) => ({
    id: oldRows[i]?.id ?? crypto.randomUUID(),
    name: oldRows[i] && oldRows.length === rows.length ? oldRows[i].name : r.name,
    orientation: 'row' as const,
    x: SEC_Y0 + r.lane * SEC_LANE_H - SEC_ROW_PAD, width: r.lanes * SEC_LANE_H,
  }));
  const columns = (map.lanes ?? []).filter(l => l.orientation !== 'row');
  const laid = nodes.map(n => {
    const p = pos.get(n.id); if (!p) return n;   // annotations stay where they are
    return { ...n, x: SEC_X0 + p.col * SEC_COL_W, y: SEC_Y0 + p.lane * SEC_LANE_H };
  });
  return { nodes: laid, lanes: [...columns, ...lanes] };
}

function gridLayout(nodes: MindmapNode[]): MindmapNode[] {
  const cols = Math.max(1, Math.ceil(Math.sqrt(nodes.length)));
  // Rows advance by the tallest card in the previous row - nodes auto-size
  // to their text, so a fixed row pitch would overlap under long titles.
  const rowH: number[] = [];
  nodes.forEach((n, i) => {
    const row = Math.floor(i / cols);
    rowH[row] = Math.max(rowH[row] ?? 0, nodeHeight(n));
  });
  const rowY: number[] = [];
  let y = 80;
  rowH.forEach((hh, r) => { rowY[r] = y; y += hh + V_GAP * 2; });
  return nodes.map((n, i) => ({
    ...n,
    x: 80 + (i % cols) * (NODE_W + H_GAP),
    y: rowY[Math.floor(i / cols)],
  }));
}

function layeredLayout(map: Mindmap): MindmapNode[] {
  const nodes = map.nodes;
  if (nodes.length === 0) return nodes;

  const out = new Map<string, string[]>();   // from → to[]
  const inDegree = new Map<string, number>();
  nodes.forEach(n => { out.set(n.id, []); inDegree.set(n.id, 0); });
  for (const e of map.edges) {
    if (!out.has(e.from) || !inDegree.has(e.to)) continue;
    out.get(e.from)!.push(e.to);
    inDegree.set(e.to, (inDegree.get(e.to) ?? 0) + 1);
  }

  // Layer assignment: BFS from all roots; cycles fall back to first-visit depth.
  const layer = new Map<string, number>();
  const roots = nodes.filter(n => (inDegree.get(n.id) ?? 0) === 0).map(n => n.id);
  const queue: string[] = roots.length > 0 ? [...roots] : [nodes[0].id];
  queue.forEach(id => layer.set(id, 0));
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const next of out.get(id) ?? []) {
      if (!layer.has(next)) {
        layer.set(next, (layer.get(id) ?? 0) + 1);
        queue.push(next);
      }
    }
  }
  // Anything unreached (disconnected / pure cycles) → its own trailing layer.
  let maxLayer = Math.max(0, ...layer.values());
  for (const n of nodes) {
    if (!layer.has(n.id)) layer.set(n.id, ++maxLayer);
  }

  // Position: columns per layer, rows stacked within a column.
  const byLayer = new Map<number, string[]>();
  for (const n of nodes) {
    const l = layer.get(n.id)!;
    if (!byLayer.has(l)) byLayer.set(l, []);
    byLayer.get(l)!.push(n.id);
  }

  const pos = new Map<string, { x: number; y: number }>();
  const heightOf = new Map(nodes.map(n => [n.id, nodeHeight(n)]));
  // Column height sums real card heights (auto-sized), not a constant.
  const colHeights = new Map<number, number>();
  for (const [l, ids] of byLayer) {
    colHeights.set(l, ids.reduce((s, id) => s + heightOf.get(id)!, 0) + (ids.length - 1) * V_GAP);
  }
  const tallestPx = Math.max(...colHeights.values());
  for (const [l, ids] of byLayer) {
    let cy = 80 + (tallestPx - colHeights.get(l)!) / 2;
    ids.forEach(id => {
      pos.set(id, { x: 80 + l * (NODE_W + H_GAP), y: cy });
      cy += heightOf.get(id)! + V_GAP;
    });
  }

  return nodes.map(n => ({ ...n, ...pos.get(n.id)! }));
}
