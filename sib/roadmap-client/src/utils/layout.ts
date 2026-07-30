// layout.ts — auto-layout algorithms (pure functions: graph in → positions out).
//
// hierarchical: layered left-to-right BFS from root nodes (in-degree 0 over
//               directed edges). Disconnected components stack vertically.
// grid:         tidy grid for freeform maps with no meaningful hierarchy.

import type { Mindmap, MindmapNode } from '@spatial/shared';
import { NODE_W, NODE_H } from './geometry.js';

const H_GAP = 100;
const V_GAP = 36;

export type LayoutMode = 'hierarchical' | 'grid';

/** Returns a new node array with updated x/y (updatedAt bumped by caller). */
export function autoLayout(map: Mindmap, mode: LayoutMode): MindmapNode[] {
  return mode === 'hierarchical' ? layeredLayout(map) : gridLayout(map.nodes);
}

function gridLayout(nodes: MindmapNode[]): MindmapNode[] {
  const cols = Math.max(1, Math.ceil(Math.sqrt(nodes.length)));
  return nodes.map((n, i) => ({
    ...n,
    x: 80 + (i % cols) * (NODE_W + H_GAP),
    y: 80 + Math.floor(i / cols) * (NODE_H + V_GAP * 2),
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
  const tallest = Math.max(...[...byLayer.values()].map(ids => ids.length));
  for (const [l, ids] of byLayer) {
    const colHeight = ids.length * NODE_H + (ids.length - 1) * V_GAP;
    const startY = 80 + ((tallest * (NODE_H + V_GAP)) - colHeight) / 2;
    ids.forEach((id, row) => {
      pos.set(id, { x: 80 + l * (NODE_W + H_GAP), y: startY + row * (NODE_H + V_GAP) });
    });
  }

  return nodes.map(n => ({ ...n, ...pos.get(n.id)! }));
}
