// NodeView.tsx — one mind-map node: SIB-layer coloring, drag-to-move,
// connection handle (drag from the ring → drop on another node), inline
// text editing via foreignObject.

import { useRef, useCallback } from 'react';
import type { MindmapNode } from '@spatial/shared';
import { useStore } from '../state/store.js';
import { NODE_COLORS } from '../utils/colors.js';
import { NODE_W, NODE_H } from '../utils/geometry.js';

interface Props {
  node: MindmapNode;
  onConnectDrop: (from: string, to: string) => void;
}

export function NodeView({ node, onConnectDrop }: Props): JSX.Element {
  const selected = useStore(s => s.selectedNodeIds.includes(node.id));
  const editing = useStore(s => s.editingNodeId === node.id);
  const pendingEdgeFrom = useStore(s => s.pendingEdgeFrom);
  const camera = useStore(s => s.camera);
  const select = useStore(s => s.select);
  const setEditing = useStore(s => s.setEditing);
  const moveNode = useStore(s => s.moveNode);
  const updateNodeText = useStore(s => s.updateNodeText);
  const setPendingEdgeFrom = useStore(s => s.setPendingEdgeFrom);
  const sendCursor = useStore(s => s.sendCursor);

  const drag = useRef<{ startX: number; startY: number; nodeX: number; nodeY: number; moved: boolean } | null>(null);
  const color = NODE_COLORS[node.type] ?? NODE_COLORS.generic;

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    select(node.id, e.shiftKey);
    drag.current = { startX: e.clientX, startY: e.clientY, nodeX: node.x, nodeY: node.y, moved: false };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  }, [node, select]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!drag.current) return;
    const dx = (e.clientX - drag.current.startX) / camera.scale;
    const dy = (e.clientY - drag.current.startY) / camera.scale;
    if (!drag.current.moved && Math.hypot(dx, dy) < 3 / camera.scale) return;
    drag.current.moved = true;
    const x = drag.current.nodeX + dx;
    const y = drag.current.nodeY + dy;
    moveNode(node.id, x, y, true);
    sendCursor(x + NODE_W / 2, y + NODE_H / 2, node.id);
  }, [node.id, camera.scale, moveNode, sendCursor]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (drag.current?.moved) {
      const dx = (e.clientX - drag.current.startX) / camera.scale;
      const dy = (e.clientY - drag.current.startY) / camera.scale;
      moveNode(node.id, drag.current.nodeX + dx, drag.current.nodeY + dy, false); // final, unthrottled
    }
    drag.current = null;
    // Complete a pending connection dropped onto this node.
    if (pendingEdgeFrom && pendingEdgeFrom !== node.id) {
      onConnectDrop(pendingEdgeFrom, node.id);
      setPendingEdgeFrom(null);
    }
  }, [node.id, camera.scale, moveNode, pendingEdgeFrom, onConnectDrop, setPendingEdgeFrom]);

  const startConnection = useCallback((e: React.PointerEvent) => {
    e.stopPropagation();
    setPendingEdgeFrom(node.id);
  }, [node.id, setPendingEdgeFrom]);

  const displayText = node.text || '…';

  return (
    <g
      className="node-view"
      transform={`translate(${node.x} ${node.y})`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDoubleClick={e => { e.stopPropagation(); setEditing(node.id); }}
    >
      <rect
        width={NODE_W} height={NODE_H} rx={10}
        fill="#ffffff"
        stroke={selected ? '#1d4ed8' : color}
        strokeWidth={selected ? 3 : 2}
        style={{ filter: selected ? 'drop-shadow(0 2px 6px rgba(29,78,216,.35))' : 'drop-shadow(0 1px 2px rgba(0,0,0,.12))' }}
      />
      <rect width={6} height={NODE_H} rx={3} fill={color} />

      {editing ? (
        <foreignObject x={8} y={4} width={NODE_W - 16} height={NODE_H - 8}>
          <textarea
            autoFocus
            className="node-editor"
            defaultValue={node.text}
            onFocus={e => e.target.select()}
            onBlur={e => { updateNodeText(node.id, e.target.value.trim()); setEditing(null); }}
            onKeyDown={e => {
              e.stopPropagation();
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); (e.target as HTMLTextAreaElement).blur(); }
              if (e.key === 'Escape') { e.preventDefault(); setEditing(null); }
            }}
            onPointerDown={e => e.stopPropagation()}
          />
        </foreignObject>
      ) : (
        <text
          x={NODE_W / 2 + 2} y={NODE_H / 2 + 4}
          textAnchor="middle"
          className="node-label"
          pointerEvents="none"
        >
          {displayText.length > 22 ? displayText.slice(0, 21) + '…' : displayText}
        </text>
      )}

      {/* Connection handle — right edge ring */}
      <circle
        className="connect-handle"
        cx={NODE_W} cy={NODE_H / 2} r={7}
        fill="#ffffff" stroke={color} strokeWidth={2}
        style={{ cursor: 'crosshair', opacity: selected || pendingEdgeFrom ? 1 : undefined }}
        onPointerDown={startConnection}
      />
    </g>
  );
}
