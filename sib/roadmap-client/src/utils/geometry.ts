// geometry.ts — node dimensions + edge endpoint math (pure, UI-free).
import type { MindmapNode } from '@spatial/shared';

export const NODE_W = 160;
export const NODE_H = 48;

export interface Point { x: number; y: number; }

export function nodeCenter(n: { x: number; y: number }): Point {
  return { x: n.x + NODE_W / 2, y: n.y + NODE_H / 2 };
}

/**
 * Point on the border of node `n` along the line from its center to `toward`.
 * Keeps edge arrowheads outside the node rectangle.
 */
export function borderPoint(n: MindmapNode, toward: Point): Point {
  const c = nodeCenter(n);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (dx === 0 && dy === 0) return c;
  const hw = NODE_W / 2 + 4;
  const hh = NODE_H / 2 + 4;
  const scale = 1 / Math.max(Math.abs(dx) / hw, Math.abs(dy) / hh);
  return { x: c.x + dx * scale, y: c.y + dy * scale };
}

/** Screen → world coordinates for a camera {x, y, scale}. */
export function toWorld(sx: number, sy: number, cam: { x: number; y: number; scale: number }): Point {
  return { x: (sx - cam.x) / cam.scale, y: (sy - cam.y) / cam.scale };
}
