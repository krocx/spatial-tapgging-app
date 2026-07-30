// EdgeView.tsx — one edge: border-to-border line with optional arrowhead,
// wide invisible hit area for easy selection, double-click toggles direction.

import type { MindmapEdge } from '@spatial/shared';
import { useStore } from '../state/store.js';
import { nodeCenter, borderPoint } from '../utils/geometry.js';

export function EdgeView({ edge, dimmed = false }: { edge: MindmapEdge; dimmed?: boolean }): JSX.Element | null {
  const map = useStore(s => s.map);
  const selected = useStore(s => s.selectedEdgeId === edge.id);
  const selectEdge = useStore(s => s.selectEdge);
  const toggleEdgeType = useStore(s => s.toggleEdgeType);

  const a = map?.nodes.find(n => n.id === edge.from);
  const b = map?.nodes.find(n => n.id === edge.to);
  if (!a || !b) return null;

  const p1 = borderPoint(a, nodeCenter(b));
  const p2 = borderPoint(b, nodeCenter(a));
  const marker = edge.type === 'directed'
    ? `url(#${selected ? 'arrow-selected' : 'arrow'})`
    : undefined;

  return (
    <g
      onPointerDown={e => { e.stopPropagation(); selectEdge(edge.id); }}
      onDoubleClick={e => { e.stopPropagation(); toggleEdgeType(edge.id); }}
      opacity={dimmed ? 0.1 : 1}
      style={{ cursor: 'pointer', transition: 'opacity .18s' }}
    >
      {/* invisible fat hit area */}
      <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke="transparent" strokeWidth={14} />
      <line
        x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}
        stroke={selected ? '#2f6fed' : '#94a3b8'}
        strokeWidth={selected ? 2.5 : 1.5}
        markerEnd={marker}
      />
      {edge.label && (
        <text
          x={(p1.x + p2.x) / 2} y={(p1.y + p2.y) / 2 - 6}
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
