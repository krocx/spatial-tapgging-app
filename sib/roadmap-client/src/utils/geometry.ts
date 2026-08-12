// geometry.ts — node dimensions + edge endpoint math (pure, UI-free).
//
// Node HEIGHT is content-derived: the card grows to fit its wrapped title
// (up to MAX_LINES) instead of truncating at 20 characters. Width stays fixed
// so lanes and layouts keep their rhythm. Everything that measures a node —
// edge anchors, minimap, marquee, export — must go through nodeHeight()/
// nodeCenter() rather than the NODE_H constant, or arrows will pin to where
// the node WOULD end at one line, not where it does.
import type { MindmapNode } from '@spatial/shared';

export const NODE_W = 160;
/** Base (minimum) height — a card with a one- or two-line title. */
export const NODE_H = 48;

/** Text layout inside the card: ~13px font in a 160px card with padding. */
const CHARS_PER_LINE = 20;
const MAX_LINES = 4;
export const LINE_HEIGHT = 16;

export interface Point { x: number; y: number; }

/**
 * Greedy word-wrap of a node title into card lines. Deterministic and
 * measurement-free (character count, not canvas metrics) so the server,
 * exports and tests all agree on a node's size without a DOM.
 */
export function wrapNodeText(text: string): { lines: string[]; truncated: boolean } {
  const words = (text || '…').split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (let w of words) {
    // A single word longer than a line is hard-split rather than overflowing.
    while (w.length > CHARS_PER_LINE) {
      if (cur) { lines.push(cur); cur = ''; }
      lines.push(w.slice(0, CHARS_PER_LINE));
      w = w.slice(CHARS_PER_LINE);
    }
    if (!cur) cur = w;
    else if (cur.length + 1 + w.length <= CHARS_PER_LINE) cur += ' ' + w;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  if (lines.length === 0) lines.push('…');
  if (lines.length > MAX_LINES) {
    const kept = lines.slice(0, MAX_LINES);
    kept[MAX_LINES - 1] = kept[MAX_LINES - 1].slice(0, CHARS_PER_LINE - 1) + '…';
    return { lines: kept, truncated: true };
  }
  return { lines, truncated: false };
}

/** Content-derived card height. Two lines fit the base card; more grow it. */
export function nodeHeight(n: { text?: string }): number {
  const count = wrapNodeText(n.text ?? '').lines.length;
  return count <= 2 ? NODE_H : NODE_H + (count - 2) * LINE_HEIGHT;
}

export function nodeCenter(n: { x: number; y: number; text?: string }): Point {
  return { x: n.x + NODE_W / 2, y: n.y + nodeHeight(n) / 2 };
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
  const hh = nodeHeight(n) / 2 + 4;
  const scale = 1 / Math.max(Math.abs(dx) / hw, Math.abs(dy) / hh);
  return { x: c.x + dx * scale, y: c.y + dy * scale };
}

/** Screen → world coordinates for a camera {x, y, scale}. */
export function toWorld(sx: number, sy: number, cam: { x: number; y: number; scale: number }): Point {
  return { x: (sx - cam.x) / cam.scale, y: (sy - cam.y) / cam.scale };
}
