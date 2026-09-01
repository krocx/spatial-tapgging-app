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

// ── Shape geometry ─────────────────────────────────────────────────────────
// Single source of truth for node OUTLINES: the same math answers
// "is this point inside the shape?" (edge attachment), "where does a ray
// exit?" (borderPoint/portPoint) and "what do I draw?" (shapePathD, used by
// NodeView AND the SVG export). Change a shape here and everything agrees.

type Shape = MindmapNode['shape'];

/** Circle renders as an ellipse padded past the card box so text clears it. */
const CIRCLE_PAD_X = 8;
const CIRCLE_PAD_Y = 14;
/** Horizontal slant of the parallelogram, in px. */
const PGRAM_SLANT = 14;
/** Vertical radius of the cylinder's rim ellipses. */
const CYL_RY = 9;
/** Diamond overshoot beyond the card box (matches the classic rendering). */
const DIA_OVER_Y = 6;
const DIA_OVER_X = 10;
/** Hexagon end-cap depth. */
const HEX_CAP = 14;

/** Is (x, y) — in LOCAL coords, origin at the shape's center — inside? */
function insideShape(shape: Shape, hw: number, hh: number, x: number, y: number): boolean {
  switch (shape) {
    case 'diamond':
      return Math.abs(x) / (hw + DIA_OVER_X) + Math.abs(y) / (hh + DIA_OVER_Y) <= 1;
    case 'hexagon': {
      if (Math.abs(y) > hh) return false;
      const cap = hw - HEX_CAP;
      if (Math.abs(x) <= cap) return true;
      return Math.abs(y) <= hh * ((hw - Math.abs(x)) / HEX_CAP);
    }
    case 'circle': {
      const rx = hw + CIRCLE_PAD_X, ry = hh + CIRCLE_PAD_Y;
      return (x * x) / (rx * rx) + (y * y) / (ry * ry) <= 1;
    }
    case 'parallelogram': {
      if (Math.abs(y) > hh) return false;
      const u = (y + hh) / (2 * hh);                 // 0 at top, 1 at bottom
      return x >= -hw + PGRAM_SLANT * (1 - u) && x <= hw - PGRAM_SLANT * u;
    }
    case 'pill': {
      const r = Math.min(NODE_H / 2, hh);
      if (Math.abs(x) > hw || Math.abs(y) > hh) return false;
      const ox = Math.abs(x) - (hw - r), oy = Math.abs(y) - (hh - r);
      return ox <= 0 || oy <= 0 || ox * ox + oy * oy <= r * r;
    }
    default:   // rounded / rect / cylinder ≈ their bounding box
      return Math.abs(x) <= hw && Math.abs(y) <= hh;
  }
}

/**
 * Point on the border of node `n` along the ray from its center toward
 * `toward`, plus a 4px margin so arrowheads sit just off the outline.
 * Shape-aware: a diamond's edge attaches to the diamond, not its bounding
 * box (the old rectangle-only math left visible gaps on polygon shapes).
 * Implemented as a bisection on insideShape — one code path for all shapes.
 */
export function borderPoint(n: MindmapNode, toward: Point): Point {
  const c = nodeCenter(n);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (dx === 0 && dy === 0) return c;
  const hw = NODE_W / 2;
  const hh = nodeHeight(n) / 2;
  const len = Math.hypot(dx, dy);
  const ux = dx / len, uy = dy / len;
  // Bisect between center (inside) and a point safely past every overshoot.
  let lo = 0;
  let hi = Math.hypot(hw + CIRCLE_PAD_X + DIA_OVER_X, hh + CIRCLE_PAD_Y) + 2;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (insideShape(n.shape, hw, hh, ux * mid, uy * mid)) lo = mid; else hi = mid;
  }
  const t = lo + 4;   // margin
  return { x: c.x + ux * t, y: c.y + uy * t };
}

export const EDGE_PORTS = ['top', 'right', 'bottom', 'left'] as const;

const PORT_DIR: Record<string, Point> = {
  top: { x: 0, y: -1 }, right: { x: 1, y: 0 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 },
};

/** Outward unit normal of a port — used to shape curves leaving that side. */
export function portNormal(port: string): Point {
  return PORT_DIR[port] ?? { x: 1, y: 0 };
}

/** World position of an anchor port: where the port's ray exits the outline. */
export function portPoint(n: MindmapNode, port: string): Point {
  const c = nodeCenter(n);
  const d = portNormal(port);
  return borderPoint(n, { x: c.x + d.x * 1000, y: c.y + d.y * 1000 });
}

/** Rounded-rect path helper. */
function rrect(w: number, h: number, r: number): string {
  return `M ${r} 0 H ${w - r} A ${r} ${r} 0 0 1 ${w} ${r} V ${h - r} A ${r} ${r} 0 0 1 ${w - r} ${h} H ${r} A ${r} ${r} 0 0 1 0 ${h - r} V ${r} A ${r} ${r} 0 0 1 ${r} 0 Z`;
}

/**
 * SVG path for a node outline in LOCAL coords (origin = card top-left).
 * Used by NodeView and by the SVG export, so canvas and export can't drift.
 */
export function shapePathD(shape: Shape, h: number): string {
  const W = NODE_W;
  switch (shape) {
    case 'rect':    return rrect(W, h, 2);
    case 'pill':    return rrect(W, h, Math.min(NODE_H / 2, h / 2));
    case 'diamond':
      return `M ${W / 2} ${-DIA_OVER_Y} L ${W + DIA_OVER_X} ${h / 2} L ${W / 2} ${h + DIA_OVER_Y} L ${-DIA_OVER_X} ${h / 2} Z`;
    case 'hexagon':
      return `M ${HEX_CAP} 0 H ${W - HEX_CAP} L ${W} ${h / 2} L ${W - HEX_CAP} ${h} H ${HEX_CAP} L 0 ${h / 2} Z`;
    case 'circle': {
      const rx = W / 2 + CIRCLE_PAD_X, ry = h / 2 + CIRCLE_PAD_Y;
      return `M ${W / 2 - rx} ${h / 2} a ${rx} ${ry} 0 1 0 ${rx * 2} 0 a ${rx} ${ry} 0 1 0 ${-rx * 2} 0 Z`;
    }
    case 'parallelogram':
      return `M ${PGRAM_SLANT} 0 H ${W} L ${W - PGRAM_SLANT} ${h} H 0 Z`;
    case 'cylinder':
      // Body with bulged top/bottom + the rim's lower arc as a subpath.
      return `M 0 ${CYL_RY} A ${W / 2} ${CYL_RY} 0 0 1 ${W} ${CYL_RY} V ${h - CYL_RY} A ${W / 2} ${CYL_RY} 0 0 1 0 ${h - CYL_RY} Z M 0 ${CYL_RY} A ${W / 2} ${CYL_RY} 0 0 0 ${W} ${CYL_RY}`;
    default:        return rrect(W, h, 10);   // rounded
  }
}

/** Screen → world coordinates for a camera {x, y, scale}. */
export function toWorld(sx: number, sy: number, cam: { x: number; y: number; scale: number }): Point {
  return { x: (sx - cam.x) / cam.scale, y: (sy - cam.y) / cam.scale };
}
