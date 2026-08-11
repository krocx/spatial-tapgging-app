// NodeView.tsx — one mind-map node: SIB-layer coloring, status badge,
// milestone diamond, notes indicator, drag-to-move (moves the whole selection),
// connection handle, inline text editing. Long-press edits on touch.

import { useRef, useCallback } from 'react';
import type { MindmapNode } from '@spatial/shared';
import { useStore } from '../state/store.js';
import { NODE_COLORS, STATUS_COLORS } from '../utils/colors.js';
import { NODE_W, NODE_H } from '../utils/geometry.js';
import { ICON_PATHS } from '../utils/icons.js';

interface Props {
  node: MindmapNode;
  onConnectDrop: (from: string, to: string) => void;
  /** View-filter fade: node stays interactive but recedes visually. */
  dimmed?: boolean;
  /** Node has outgoing directed edges → show the collapse chevron. */
  collapsible?: boolean;
  /** Number of nodes hidden beneath this collapsed node (badge). */
  hiddenCount?: number;
}

/** Shape outline for the node body. Diamond/hexagon are polygons. */
function ShapeOutline({ shape, stroke, strokeWidth, filter }: {
  shape: MindmapNode['shape']; stroke: string; strokeWidth: number; filter: string;
}): JSX.Element {
  const common = { fill: '#ffffff', stroke, strokeWidth, style: { filter } };
  switch (shape) {
    case 'rect':
      return <rect width={NODE_W} height={NODE_H} rx={2} {...common} />;
    case 'pill':
      return <rect width={NODE_W} height={NODE_H} rx={NODE_H / 2} {...common} />;
    case 'diamond':
      return <polygon points={`${NODE_W / 2},-6 ${NODE_W + 10},${NODE_H / 2} ${NODE_W / 2},${NODE_H + 6} -10,${NODE_H / 2}`} {...common} />;
    case 'hexagon':
      return <polygon points={`14,0 ${NODE_W - 14},0 ${NODE_W},${NODE_H / 2} ${NODE_W - 14},${NODE_H} 14,${NODE_H} 0,${NODE_H / 2}`} {...common} />;
    default:
      return <rect width={NODE_W} height={NODE_H} rx={10} {...common} />;
  }
}

const LONG_PRESS_MS = 500;

export function NodeView({ node, onConnectDrop, dimmed = false, collapsible = false, hiddenCount = 0 }: Props): JSX.Element {
  const toggleCollapse = useStore(s => s.toggleCollapse);
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
  // Server-derived step order (procedure maps only). Deriving it here as well
  // would let the number on the card drift from the number in the guide.
  const stepNumber = useStore(s => s.procedure?.order?.[node.id]);

  return (
    <g
      className="node-view"
      opacity={dimmed ? 0.15 : 1}
      style={{ transition: 'opacity .18s' }}
      transform={`translate(${node.x} ${node.y})`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={e => { e.stopPropagation(); setEditing(node.id); }}
    >
      <ShapeOutline
        shape={node.shape}
        stroke={selected ? '#1d4ed8' : color}
        strokeWidth={selected ? 3 : 2}
        filter={selected ? 'drop-shadow(0 2px 6px rgba(29,78,216,.35))' : 'drop-shadow(0 1px 2px rgba(0,0,0,.12))'}
      />
      {/* Layer color: bar for boxy shapes, dot for polygon/pill shapes */}
      {(!node.shape || node.shape === 'rect') ? (
        <rect width={6} height={NODE_H} rx={3} fill={color} />
      ) : (
        <circle cx={node.shape === 'pill' ? 16 : node.shape === 'hexagon' ? 12 : NODE_W / 2} cy={node.shape === 'diamond' ? 6 : NODE_H / 2} r={4} fill={color} />
      )}

      {/* Icon — left of the text */}
      {node.icon && ICON_PATHS[node.icon] && (
        <g transform={`translate(${node.shape === 'diamond' ? NODE_W / 2 - 7 : 12} ${node.shape === 'diamond' ? NODE_H - 22 : NODE_H / 2 - 7}) scale(0.58)`} pointerEvents="none">
          <path d={ICON_PATHS[node.icon]} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        </g>
      )}

      {/* Collapse chevron — bottom edge, only when there are directed children */}
      {collapsible && (
        <g
          transform={`translate(${NODE_W / 2} ${NODE_H + (node.shape === 'diamond' ? 14 : 8)})`}
          style={{ cursor: 'pointer' }}
          onPointerDown={e => e.stopPropagation()}
          onClick={e => { e.stopPropagation(); toggleCollapse(node.id); }}
        >
          <circle r={8} fill="#ffffff" stroke="#cbd5e1" strokeWidth={1.2} />
          <path
            d={node.collapsed ? 'M -3 -1 L 0 2.5 L 3 -1' : 'M -3 1.5 L 0 -2 L 3 1.5'}
            fill="none" stroke="#475569" strokeWidth={1.6} strokeLinecap="round"
          />
          {node.collapsed && hiddenCount > 0 && (
            <g transform="translate(13 0)">
              <rect x={-3} y={-7} width={hiddenCount > 9 ? 26 : 20} height={14} rx={7} fill="#2f6fed" />
              <text x={hiddenCount > 9 ? 10 : 7} y={3.5} textAnchor="middle" style={{ fontSize: 9, fontWeight: 700 }} fill="#fff">
                +{hiddenCount}
              </text>
            </g>
          )}
          <title>{node.collapsed ? `Expand (${hiddenCount} hidden)` : 'Collapse branch'}</title>
        </g>
      )}

      {/* Link — opens in a new tab */}
      {node.link && (
        <g
          transform={`translate(${NODE_W - (node.status ? 26 : 12)} 10)`}
          style={{ cursor: 'pointer' }}
          onPointerDown={e => e.stopPropagation()}
          onClick={e => { e.stopPropagation(); window.open(node.link, '_blank', 'noopener'); }}
        >
          <circle r={7} fill="#eef2f7" stroke="#cbd5e1" strokeWidth={0.8} />
          <path d="M -2 2 L 2 -2 M 0 -2 L 2 -2 L 2 0" fill="none" stroke="#2f6fed" strokeWidth={1.4} strokeLinecap="round" />
          <title>{node.link}</title>
        </g>
      )}

      {/* Status badge — top-right */}
      {node.status && (
        <circle cx={NODE_W - 10} cy={10} r={5}
                fill={STATUS_COLORS[node.status]} stroke="#ffffff" strokeWidth={1.5}>
          <title>{node.status}</title>
        </circle>
      )}

      {/* Step number on a procedure map — DERIVED from the graph by the server,
          never typed. Absent means the step is not reachable from the start. */}
      {stepNumber !== undefined && (
        <g transform="translate(-9 -9)" pointerEvents="none">
          <circle cx={0} cy={0} r={11} fill="#4f46e5" stroke="#ffffff" strokeWidth={2} />
          <text x={0} y={4} textAnchor="middle" style={{ fontSize: 11, fontWeight: 700 }} fill="#ffffff">
            {stepNumber}
          </text>
        </g>
      )}

      {/* Milestone diamond — floats above the top-left corner */}
      {node.milestone && (
        <path d={`M 16 -8 l 7 8 l -7 8 l -7 -8 z`} fill="#eab308" stroke="#ffffff" strokeWidth={1.5}>
          <title>Milestone</title>
        </path>
      )}

      {/* Review verdict — top-left inside the node */}
      {node.review && (
        <text x={14} y={15} textAnchor="middle" pointerEvents="none"
              style={{ fontSize: 11, fontWeight: 700 }}
              fill={node.review === 'approved' ? '#16a34a' : node.review === 'rejected' ? '#dc2626' : '#f59e0b'}>
          {node.review === 'approved' ? '✓' : node.review === 'rejected' ? '✗' : '?'}
          <title>{node.review}</title>
        </text>
      )}

      {/* Comment count — bottom-left bubble */}
      {(node.comments?.length ?? 0) > 0 && (
        <g transform={`translate(12 ${NODE_H - 9})`} pointerEvents="none">
          <rect x={-7} y={-8} width={20} height={13} rx={6.5} fill="#eef2f7" stroke="#cbd5e1" strokeWidth={0.8} />
          <text x={3} y={2.5} textAnchor="middle" style={{ fontSize: 9, fontWeight: 600 }} fill="#475569">
            {node.comments!.length > 99 ? '99' : node.comments!.length}
          </text>
        </g>
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
          x={NODE_W / 2 + (node.icon && node.shape !== 'diamond' ? 9 : 2)} y={NODE_H / 2 + 4}
          textAnchor="middle"
          className="node-label"
          pointerEvents="none"
        >
          {displayText.length > 20 ? displayText.slice(0, 19) + '…' : displayText}
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
