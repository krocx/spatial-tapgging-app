// visibility.ts — collapsible-branch engine (pure).
//
// Fixpoint rule: a node is HIDDEN iff it has at least one incoming directed
// edge AND every directed parent is collapsed-with-hidden-children or itself
// hidden. Consequences:
//   - alternate visible paths keep a node visible (diamond graphs behave)
//   - cycles not fed by a collapsed node stay visible
//   - undirected edges never hide anything

import type { Mindmap } from '@spatial/shared';

export interface VisibilityResult {
  /** Ids of nodes currently hidden by collapsed ancestors. */
  hidden: Set<string>;
  /** collapsed node id → number of nodes it is currently hiding beneath it. */
  hiddenCounts: Map<string, number>;
}

export function computeVisibility(map: Mindmap): VisibilityResult {
  const hidden = new Set<string>();
  const hiddenCounts = new Map<string, number>();

  const anyCollapsed = map.nodes.some(n => n.collapsed);
  if (!anyCollapsed) return { hidden, hiddenCounts };

  const collapsed = new Set(map.nodes.filter(n => n.collapsed).map(n => n.id));
  const parents = new Map<string, string[]>();   // node → directed parents
  const children = new Map<string, string[]>();  // node → directed children
  for (const e of map.edges) {
    if (e.type !== 'directed') continue;
    if (!parents.has(e.to)) parents.set(e.to, []);
    parents.get(e.to)!.push(e.from);
    if (!children.has(e.from)) children.set(e.from, []);
    children.get(e.from)!.push(e.to);
  }

  // Fixpoint: repeatedly hide nodes whose every directed parent is collapsed or hidden.
  let changed = true;
  while (changed) {
    changed = false;
    for (const n of map.nodes) {
      if (hidden.has(n.id)) continue;
      const ps = parents.get(n.id);
      if (!ps || ps.length === 0) continue;                    // roots stay visible
      if (ps.every(p => collapsed.has(p) || hidden.has(p))) {
        hidden.add(n.id);
        changed = true;
      }
    }
  }

  // Badge counts: hidden nodes reachable beneath each collapsed (visible) node.
  for (const id of collapsed) {
    if (hidden.has(id)) continue;
    let count = 0;
    const seen = new Set<string>([id]);
    const queue = [...(children.get(id) ?? [])];
    while (queue.length > 0) {
      const next = queue.shift()!;
      if (seen.has(next)) continue;
      seen.add(next);
      if (hidden.has(next)) {
        count++;
        queue.push(...(children.get(next) ?? []));
      }
    }
    hiddenCounts.set(id, count);
  }

  return { hidden, hiddenCounts };
}

/** Does this node have outgoing directed edges (i.e. is it collapsible)? */
export function hasDirectedChildren(map: Mindmap, nodeId: string): boolean {
  return map.edges.some(e => e.type === 'directed' && e.from === nodeId);
}
