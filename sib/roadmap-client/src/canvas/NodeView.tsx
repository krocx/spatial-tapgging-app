// NodeView.tsx — one mind-map node: SIB-layer coloring, status badge,
// milestone diamond, notes indicator, drag-to-move (moves the whole selection),
// connection handle, inline text editing. Long-press edits on touch.

import { useRef, useCallback } from 'react';
import type { MindmapNode } from '@spatial/shared';
import { useStore } from '../state/store.js';
import { NODE_COLORS, STATUS_COLORS } from '../utils/colors.js';
import { NODE_W, NODE_H } from '../utils/geometry.js';

interface Props {
  node: MindmapNode;
  onConnectDrop: (from: string, to: string) => void;
}

const LONG_PRESS_MS = 500;

export function NodeView({ node, onConnectDrop }: Props): JSX.Element {
  const selected = useStore(s => s.selectedNodeIds.includes(node.id));
  const editing = useStore(s => s.editingNodeId === node.id);
  const pendingEdgeFrom = useStore(s => s.pendingEdgeFrom);
  const camera = useStore(s => s.camera);
  const select = useStore(s => s.select);
  const setEditing = useStore(s => s.setEditing);
  const moveNodes = useStore(s => s.moveNodes);
  const updateNodeText = useStore(s => s.updateNodeText);
  const setPendingEdgeFrom = useStore(s => s.setPendingEdgeFrom);
  const sendCursor = useStore(s => s.sendCursor);

  // Baseline positions of every node that moves with this drag.
  const drag = useRef<{
    startX: number; startY: number; moved: boolean;
    baseline: Array<{ id: string; x: number; y: number }>;
  } | null>(null);
  const longPress = useRef<number | null>(null);

  const color = NODE_COLORS[node.type] ?? NODE_COLORS.generic;

  const cancelLongPress = () => {
    if (longPress.current !== null) { clearTimeout(longPress.current); longPress.current = null; }
  };

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    select(node.id, e.shiftKey);
    // Snapshot the (possibly multi-) selection as the drag baseline.
    const s = useStore.getState();
    const ids = s.selectedNodeIds.includes(node.id) ? s.selectedNodeIds : [node.id];
    const baseline = (s.map?.nodes ?? [])
      .filter(n => ids.includes(n.id))
      .map(n => ({ id: n.id, x: n.x, y: n.y }));
    drag.current = { startX: e.clientX, startY: e.clientY, moved: false, baseline };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);

    // Touch: long-press (without moving) opens the text editor.
    if (e.pointerType === 'touch') {
      longPress.current = window.setTimeout(() => {
        drag.current = null;
        setEditing(node.id);
        longPress.current = null;
      }, LONG_PRESS_MS);
    }
  }, [node.id, select, setEditing]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!drag.current) return;
    const dx = (e.clientX - drag.current.startX) / camera.scale;
    const dy = (e.clientY - drag.current.startY) / camera.scale;
    if (!drag.current.moved && Math.hypot(dx, dy) < 3 / camera.scale) return;
    drag.current.moved = true;
    cancelLongPress();
    moveNodes(drag.current.baseline.map(b => ({ id: b.id, x: b.x + dx, y: b.y + dy })), true);
    sendCursor(node.x + NODE_W / 2, node.y + NODE_H / 2, node.id);
  }, [node.id, node.x, node.y, camera.scale, moveNodes, sendCursor]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    cancelLongPress();
    if (drag.current?.moved) {
      const dx = (e.clientX - drag.current.startX) / camera.scale;
      const dy = (e.clientY - drag.current.startY) / camera.scale;
      // Final, unthrottled positions for all dragged nodes.
      moveNodes(drag.current.baseline.map(b => ({ id: b.id, x: b.x + dx, y: b.y + dy })), false);
    }
    drag.current = null;
    // Complete a pending connection dropped onto this node.
    if (pendingEdgeFrom && pendingEdgeFrom !== node.id) {
      onConnectDrop(pendingEdgeFrom, node.id);
      setPendingEdgeFrom(null);
    }
  }, [node.id, camera.scale, moveNodes, pendingEdgeFrom, onConnectDrop, setPendingEdgeFrom]);

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
      onPointerCancel={onPointerUp}
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

      {/* Status badge — top-right */}
      {node.status && (
        <circle cx={NODE_W - 10} cy={10} r={5}
                fill={STATUS_COLORS[node.status]} stroke="#ffffff" strokeWidth={1.5}>
          <title>{node.status}</title>
        </circle>
      )}

      {/* Milestone diamond — floats above the top-left corner */}
      {node.milestone && (
        <path d={`M 16 -8 l 7 8 l -7 8 l -7 -8 z`} fill="#eab308" stroke="#ffffff" strokeWidth={1.5}>
          <title>Milestone</title>
        </path>
      )}

      {/* Notes indicator — bottom-right corner */}
      {node.notes && (
        <g transform={`translate(${NODE_W - 16} ${NODE_H - 14})`} opacity={0.55} pointerEvents="none">
          <rect width={9} height={10} rx={1.5} fill="none" stroke="#475569" strokeWidth={1.2} />
          <line x1={2} y1={3} x2={7} y2={3} stroke="#475569" strokeWidth={1.2} />
          <line x1={2} y1={5.5} x2={7} y2={5.5} stroke="#475569" strokeWidth={1.2} />
        </g>
      )}

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
