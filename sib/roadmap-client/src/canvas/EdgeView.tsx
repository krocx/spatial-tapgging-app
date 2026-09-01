// EdgeView.tsx — one edge. Honors map-level style settings:
//   edgeColor 'parent' (default): edge + arrowhead take the SOURCE node's
//   layer color — the flow visually carries its origin's story.
//   edgeStyle 'curved': cubic bezier with controls along the dominant axis.
// Wide invisible hit area; double-click toggles direction.

import type { MindmapEdge, MindmapNode } from '@spatial/shared';
import { useStore } from '../state/store.js';
import { nodeCenter, borderPoint, portPoint, portNormal, type Point } from '../utils/geometry.js';
import { NODE_COLORS } from '../utils/colors.js';

/** Cubic control points. A pinned port makes the curve LEAVE perpendicular
 *  to that side (the "drawn by hand" look); free ends use the dominant axis. */
function controls(p1: Point, p2: Point, fromPort?: string, toPort?: string): { c1: Point; c2: Point } {
  const dx = Math.abs(p2.x - p1.x), dy = Math.abs(p2.y - p1.y);
  const off = Math.min(160, Math.max(40, (dx >= dy ? dx : dy) * 0.4));
  const c1 = fromPort
    ? { x: p1.x + portNormal(fromPort).x * off, y: p1.y + portNormal(fromPort).y * off }
    : dx >= dy ? { x: p1.x + Math.sign(p2.x - p1.x) * off, y: p1.y } : { x: p1.x, y: p1.y + Math.sign(p2.y - p1.y) * off };
  const c2 = toPort
    ? { x: p2.x + portNormal(toPort).x * off, y: p2.y + portNormal(toPort).y * off }
    : dx >= dy ? { x: p2.x - Math.sign(p2.x - p1.x) * off, y: p2.y } : { x: p2.x, y: p2.y - Math.sign(p2.y - p1.y) * off };
  return { c1, c2 };
}

/** Shared with CanvasStage defs + export: path for an edge under a style. */
export function edgePath(p1: Point, p2: Point, curved: boolean, fromPort?: string, toPort?: string): string {
  if (!curved) return `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y}`;
  const { c1, c2 } = controls(p1, p2, fromPort, toPort);
  return `M ${p1.x} ${p1.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${p2.x} ${p2.y}`;
}

/** Bezier midpoint (t=0.5) so labels sit on the curve, not the chord. */
export function edgeMidpoint(p1: Point, p2: Point, curved: boolean, fromPort?: string, toPort?: string): Point {
  if (!curved) return { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
  const { c1, c2 } = controls(p1, p2, fromPort, toPort);
  return {
    x: (p1.x + 3 * c1.x + 3 * c2.x + p2.x) / 8,
    y: (p1.y + 3 * c1.y + 3 * c2.y + p2.y) / 8,
  };
}

/** Self-loop: leaves one port, arcs outside the card, re-enters another.
 *  Rendered curved regardless of the map's edge style — a straight self-loop
 *  has zero length. Exported for the SVG export. */
export function selfLoopGeometry(n: MindmapNode, fromPort?: string, toPort?: string): { d: string; mid: Point; p1: Point; p2: Point } {
  const fp = fromPort ?? 'right';
  const tp = toPort && toPort !== fp ? toPort : (fp === 'top' ? 'right' : 'top');
  const p1 = portPoint(n, fp);
  const p2 = portPoint(n, tp);
  const R = 64;
  const c1 = { x: p1.x + portNormal(fp).x * R, y: p1.y + portNormal(fp).y * R };
  const c2 = { x: p2.x + portNormal(tp).x * R, y: p2.y + portNormal(tp).y * R };
  return {
    d: `M ${p1.x} ${p1.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${p2.x} ${p2.y}`,
    mid: { x: (p1.x + 3 * c1.x + 3 * c2.x + p2.x) / 8, y: (p1.y + 3 * c1.y + 3 * c2.y + p2.y) / 8 },
    p1, p2,
  };
}

/**
 * Procedure edge palette. Deliberately identical to the Guide Library graph
 * view in the portal, so what an author draws here is what a reviewer sees
 * there — same colour, same meaning, no translation step.
 */
export const ROLE_COLORS: Record<string, string> = {
  next:     '#4ade80',   // green  — success path
  failure:  '#f87171',   // red    — recovery path
  requires: '#fbbf24',   // amber  — prerequisite
};

export const ROLE_LABELS: Record<string, string> = {
  next:     'next',
  failure:  'on failure',
  requires: 'requires',
};

export function edgeColorFor(source: MindmapNode | undefined, neutral: boolean): string {
  if (neutral || !source) return '#94a3b8';
  return NODE_COLORS[source.type] ?? '#94a3b8';
}

export function EdgeView({ edge, dimmed = false }: { edge: MindmapEdge; dimmed?: boolean }): JSX.Element | null {
  const map = useStore(s => s.map);
  const selected = useStore(s => s.selectedEdgeId === edge.id);
  const selectEdge = useStore(s => s.selectEdge);
  const toggleEdgeType = useStore(s => s.toggleEdgeType);

  const a = map?.nodes.find(n => n.id === edge.from);
  const b = map?.nodes.find(n => n.id === edge.to);
  if (!a || !b) return null;

  const neutral = map?.settings?.edgeColor === 'neutral';
  const curved = map?.settings?.edgeStyle !== 'straight';   // default = curved (2026.4.45)

  // On procedure maps the relationship carries the meaning, so it wins over
  // the source node's layer colour.
  const role = edge.role;
  const color = selected
    ? '#2f6fed'
    : role ? ROLE_COLORS[role] : edgeColorFor(a, neutral);
  const markerId = selected
    ? 'arrow-selected'
    : role ? `arrow-role-${role}` : neutral ? 'arrow' : `arrow-${a.type}`;

  // Endpoints: a pinned port wins; a free end aims at the peer's pinned
  //   port (or center) and slides along the shape outline as nodes move.
  let d: string, mid: Point;
  if (a.id === b.id) {
    ({ d, mid } = selfLoopGeometry(a, edge.fromPort, edge.toPort));
  } else {
    const p1 = edge.fromPort ? portPoint(a, edge.fromPort) : borderPoint(a, edge.toPort ? portPoint(b, edge.toPort) : nodeCenter(b));
    const p2 = edge.toPort ? portPoint(b, edge.toPort) : borderPoint(b, edge.fromPort ? portPoint(a, edge.fromPort) : nodeCenter(a));
    d = edgePath(p1, p2, curved, edge.fromPort, edge.toPort);
    mid = edgeMidpoint(p1, p2, curved, edge.fromPort, edge.toPort);
  }
  const marker = edge.type === 'directed' ? `url(#${markerId})` : undefined;
  // Prerequisites are a gate rather than a flow — dashed, as in the portal graph.
  const dash = role === 'requires' ? '6,4' : undefined;

  return (
    <g
      onPointerDown={e => { e.stopPropagation(); selectEdge(edge.id); }}
      onDoubleClick={e => { e.stopPropagation(); toggleEdgeType(edge.id); }}
      opacity={dimmed ? 0.1 : 1}
      style={{ cursor: 'pointer', transition: 'opacity .18s' }}
    >
      {/* invisible fat hit area */}
      <path d={d} fill="none" stroke="transparent" strokeWidth={14} />
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeOpacity={selected || neutral || role ? 1 : 0.75}
        strokeWidth={selected ? 2.5 : role ? 2 : 1.5}
        strokeDasharray={dash}
        markerEnd={marker}
      />
      {role && !edge.label && (
        <text
          x={mid.x} y={mid.y - 6}
          textAnchor="middle"
          className="edge-label"
          fill={color}
          style={{ paintOrder: 'stroke', fontSize: 10 }}
        >
          {ROLE_LABELS[role]}
        </text>
      )}
      {edge.label && (
        <text
          x={mid.x} y={mid.y - 6}
          textAnchor="middle"
          className="edge-label"
          style={{ paintOrder: 'stroke' }}
        >
          {edge.label}
        </text>
      )}
    </g>
  );
}
