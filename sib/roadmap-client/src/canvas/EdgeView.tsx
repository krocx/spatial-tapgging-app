// EdgeView.tsx — one edge: border-to-border line with optional arrowhead,
// wide invisible hit area for easy selection, double-click toggles direction.

import type { MindmapEdge } from '@spatial/shared';
import { useStore } from '../state/store.js';
import { nodeCenter, borderPoint } from '../utils/geometry.js';

export function EdgeView({ edge }: { edge: MindmapEdge }): JSX.Element | null {
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
      style={{ cursor: 'pointer' }}
    >
      {/* invisible fat hit area */}
      <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke="transparent" strokeWidth={14} />
      <line
        x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}
        stroke={selected ? '#2f6fed' : '#94a3b8'}
        strokeWidth={selected ? 2.5 : 1.5}
        markerEnd={marker}
      />
    </g>
  );
}
