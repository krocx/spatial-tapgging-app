// EdgeView.tsx — one edge. Honors map-level style settings:
//   edgeColor 'parent' (default): edge + arrowhead take the SOURCE node's
//   layer color — the flow visually carries its origin's story.
//   edgeStyle 'curved': cubic bezier with controls along the dominant axis.
// Wide invisible hit area; double-click toggles direction.

import type { MindmapEdge, MindmapNode } from '@spatial/shared';
import { useStore } from '../state/store.js';
import { nodeCenter, borderPoint, type Point } from '../utils/geometry.js';
import { NODE_COLORS } from '../utils/colors.js';

/** Shared with CanvasStage defs + export: path for an edge under a style. */
export function edgePath(p1: Point, p2: Point, curved: boolean): string {
  if (!curved) return `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y}`;
  const dx = Math.abs(p2.x - p1.x), dy = Math.abs(p2.y - p1.y);
  const off = Math.min(160, Math.max(40, (dx >= dy ? dx : dy) * 0.4));
  return dx >= dy
    ? `M ${p1.x} ${p1.y} C ${p1.x + Math.sign(p2.x - p1.x) * off} ${p1.y}, ${p2.x - Math.sign(p2.x - p1.x) * off} ${p2.y}, ${p2.x} ${p2.y}`
    : `M ${p1.x} ${p1.y} C ${p1.x} ${p1.y + Math.sign(p2.y - p1.y) * off}, ${p2.x} ${p2.y - Math.sign(p2.y - p1.y) * off}, ${p2.x} ${p2.y}`;
}

/** Bezier midpoint (t=0.5) so labels sit on the curve, not the chord. */
export function edgeMidpoint(p1: Point, p2: Point, curved: boolean): Point {
  if (!curved) return { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
  const dx = Math.abs(p2.x - p1.x), dy = Math.abs(p2.y - p1.y);
  const off = Math.min(160, Math.max(40, (dx >= dy ? dx : dy) * 0.4));
  const c1 = dx >= dy ? { x: p1.x + Math.sign(p2.x - p1.x) * off, y: p1.y } : { x: p1.x, y: p1.y + Math.sign(p2.y - p1.y) * off };
  const c2 = dx >= dy ? { x: p2.x - Math.sign(p2.x - p1.x) * off, y: p2.y } : { x: p2.x, y: p2.y - Math.sign(p2.y - p1.y) * off };
  return {
    x: (p1.x + 3 * c1.x + 3 * c2.x + p2.x) / 8,
    y: (p1.y + 3 * c1.y + 3 * c2.y + p2.y) / 8,
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
  const curved = map?.settings?.edgeStyle === 'curved';

  // On procedure maps the relationship carries the meaning, so it wins over
  // the source node's layer colour.
  const role = edge.role;
  const color = selected
    ? '#2f6fed'
    : role ? ROLE_COLORS[role] : edgeColorFor(a, neutral);
  const markerId = selected
    ? 'arrow-selected'
    : role ? `arrow-role-${role}` : neutral ? 'arrow' : `arrow-${a.type}`;

  const p1 = borderPoint(a, nodeCenter(b));
  const p2 = borderPoint(b, nodeCenter(a));
  const d = edgePath(p1, p2, curved);
  const mid = edgeMidpoint(p1, p2, curved);
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
