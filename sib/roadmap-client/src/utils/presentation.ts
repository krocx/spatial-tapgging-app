// presentation.ts — computes the step sequence for presentation mode (pure).
// Steps: column lanes (left→right), then row lanes (top→bottom). Maps without
// lanes fall back to groups; without groups, a single whole-map step.

import type { Mindmap } from '@spatial/shared';
import { NODE_W, NODE_H } from './geometry.js';

export interface PresentationStep {
  name: string;
  /** Node ids in focus this step — empty means "everything". */
  nodeIds: string[];
}

export function computeSteps(map: Mindmap): PresentationStep[] {
  const steps: PresentationStep[] = [];
  const lanes = map.lanes ?? [];

  const columns = lanes.filter(l => l.orientation !== 'row').sort((a, b) => a.x - b.x);
  const rows = lanes.filter(l => l.orientation === 'row').sort((a, b) => a.x - b.x);

  for (const lane of columns) {
    const ids = map.nodes
      .filter(n => {
        const cx = n.x + NODE_W / 2;
        return cx >= lane.x && cx < lane.x + lane.width;
      })
      .map(n => n.id);
    if (ids.length > 0) steps.push({ name: lane.name, nodeIds: ids });
  }
  for (const lane of rows) {
    const ids = map.nodes
      .filter(n => {
        const cy = n.y + NODE_H / 2;
        return cy >= lane.x && cy < lane.x + lane.width;   // rows: x=top, width=height
      })
      .map(n => n.id);
    if (ids.length > 0) steps.push({ name: lane.name, nodeIds: ids });
  }

  if (steps.length === 0) {
    for (const g of map.groups ?? []) {
      if (g.nodeIds.length > 0) steps.push({ name: g.name, nodeIds: [...g.nodeIds] });
    }
  }
  if (steps.length === 0) {
    steps.push({ name: map.name, nodeIds: [] });
  }
  // Always end on the whole map so the walkthrough closes with the big picture.
  if (steps.length > 1) steps.push({ name: 'Overview', nodeIds: [] });
  return steps;
}

export function stepBounds(map: Mindmap, step: PresentationStep) {
  const nodes = step.nodeIds.length > 0
    ? map.nodes.filter(n => step.nodeIds.includes(n.id))
    : map.nodes;
  if (nodes.length === 0) return null;
  return {
    minX: Math.min(...nodes.map(n => n.x)),
    minY: Math.min(...nodes.map(n => n.y)),
    maxX: Math.max(...nodes.map(n => n.x)) + NODE_W,
    maxY: Math.max(...nodes.map(n => n.y)) + NODE_H,
  };
}
