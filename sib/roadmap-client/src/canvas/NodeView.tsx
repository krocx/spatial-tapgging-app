// NodeView.tsx — one mind-map node: SIB-layer coloring, status badge,
// milestone diamond, notes indicator, drag-to-move (moves the whole selection),
// connection handle, inline text editing. Long-press edits on touch.

import { useRef, useCallback } from 'react';
import type { MindmapEdgePort, MindmapNode } from '@spatial/shared';
import { useStore } from '../state/store.js';
import { NODE_COLORS, NODE_FILL_COLORS, STATUS_COLORS } from '../utils/colors.js';
import { NODE_W, NODE_H, LINE_HEIGHT, nodeHeight, wrapNodeText, shapePathD, portPoint, EDGE_PORTS } from '../utils/geometry.js';
import { ICON_PATHS } from '../utils/icons.js';

interface Props {
  node: MindmapNode;
  onConnectDrop: (from: string, to: string, fromPort?: MindmapEdgePort, toPort?: MindmapEdgePort) => void;
  /** View-filter fade: node stays interactive but recedes visually. */
  dimmed?: boolean;
  /** Node has outgoing directed edges → show the collapse chevron. */
  collapsible?: boolean;
  /** Number of nodes hidden beneath this collapsed node (badge). */
  hiddenCount?: number;
}

/** Shape body for the node — one path per shape from shapePathD (geometry.ts),
 *  the same source the SVG export draws from, so canvas and export agree.
 *  `h` is the content-derived card height (nodeHeight), not the constant.
 *  Cards are SOLID-FILLED in the layer's dark fill color (NODE_FILL_COLORS) —
 *  see the doctrine note in colors.ts. */
function ShapeOutline({ shape, h, fill, stroke, strokeWidth, filter }: {
  shape: MindmapNode['shape']; h: number; fill: string; stroke: string; strokeWidth: number; filter: string;
}): JSX.Element {
  return <path d={shapePathD(shape, h)} fill={fill} stroke={stroke} strokeWidth={strokeWidth} style={{ filter }} />;
}

const LONG_PRESS_MS = 500;

export function NodeView({ node, onConnectDrop, dimmed = false, collapsible = false, hiddenCount = 0 }: Props): JSX.Element {
  const toggleCollapse = useStore(s => s.toggleCollapse);
  const selected = useStore(s => s.selectedNodeIds.includes(node.id));
  const editing = useStore(s => s.editingNodeId === node.id);
  /** Debounce handle for autosave-while-typing in the inline editor. */
  const textSaveTimer = useRef<number | undefined>(undefined);
  const pendingEdgeFrom = useStore(s => s.pendingEdgeFrom);
  const camera = useStore(s => s.camera);
  const select = useStore(s => s.select);
  const setEditing = useStore(s => s.setEditing);
  const moveNodes = useStore(s => s.moveNodes);
  const updateNodeText = useStore(s => s.updateNodeText);
  const setPendingEdgeFrom = useStore(s => s.setPendingEdgeFrom);
  const sendCursor = useStore(s => s.sendCursor);
  // Preview walkthrough: the step the simulated operator is standing on gets
  // an indigo ring so the phone frame and the canvas agree on "you are here".
  const previewCurrent = useStore(s => s.preview?.currentId === node.id);

  // Baseline positions of every node that moves with this drag.
  const drag = useRef<{
    startX: number; startY: number; moved: boolean;
    baseline: Array<{ id: string; x: number; y: number }>;
  } | null>(null);
  const longPress = useRef<number | null>(null);

  const color = NODE_COLORS[node.type] ?? NODE_COLORS.generic;
  const fill = NODE_FILL_COLORS[node.type] ?? NODE_FILL_COLORS.generic;
  // Content-derived card height — see geometry.ts. Everything positioned
  // against the bottom edge uses `h`, not NODE_H.
  const h = nodeHeight(node);

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
    sendCursor(node.x + NODE_W / 2, node.y + nodeHeight(node) / 2, node.id);
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
    // Complete a pending connection dropped onto this node. Dropping on the
    // SOURCE node itself creates a self-loop (allowed since 2026.4.45).
    if (pendingEdgeFrom) {
      const fromPort = useStore.getState().pendingEdgeFromPort ?? undefined;
      onConnectDrop(pendingEdgeFrom, node.id, fromPort, undefined);
      setPendingEdgeFrom(null);
    }
  }, [node.id, camera.scale, moveNodes, pendingEdgeFrom, onConnectDrop, setPendingEdgeFrom]);

  /** Complete a pending connection precisely on one of this node's ports. */
  const dropOnPort = useCallback((e: React.PointerEvent, port: MindmapEdgePort) => {
    if (!pendingEdgeFrom) return;
    e.stopPropagation();
    const fromPort = useStore.getState().pendingEdgeFromPort ?? undefined;
    onConnectDrop(pendingEdgeFrom, node.id, fromPort, port);
    setPendingEdgeFrom(null);
  }, [node.id, pendingEdgeFrom, onConnectDrop, setPendingEdgeFrom]);

  const startConnection = useCallback((e: React.PointerEvent) => {
    e.stopPropagation();
    setPendingEdgeFrom(node.id);
  }, [node.id, setPendingEdgeFrom]);

  /** Start a connection pinned to a specific port. */
  const startPortConnection = useCallback((e: React.PointerEvent, port: MindmapEdgePort) => {
    e.stopPropagation();
    setPendingEdgeFrom(node.id, port);
  }, [node.id, setPendingEdgeFrom]);

  const displayText = node.text || '…';
  // Wrapped title lines; card height (h) is derived from the same wrap.
  const { lines: labelLines, truncated: labelTruncated } = wrapNodeText(displayText);
  // Server-derived step order (procedure maps only). Deriving it here as well
  // would let the number on the card drift from the number in the guide.
  const stepNumber = useStore(s => s.procedure?.order?.[node.id]);
  // Step content glyphs — attached voice / image / model, so an authored step
  // is distinguishable from a bare one at a glance.
  const stepMeta = node.metadata?.step as
    { ttsText?: string; imageFile?: string; modelId?: string } | undefined;
  const stepGlyphs = [
    stepMeta?.ttsText   ? '🔊' : null,
    stepMeta?.imageFile ? '🖼' : null,
    stepMeta?.modelId   ? '⬢'  : null,
  ].filter((g): g is string => g !== null);

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
      {/* Native tooltip with the full title — only when the label truncated
          (>4 wrapped lines), and on the root g because the label itself has
          pointerEvents="none". */}
      {labelTruncated && <title>{node.text}</title>}
      {/* Solid-fill card. Selection can't be a stroke-color change any more
          (a blue stroke vanishes on a blue fill), so selected/preview states
          use a light stroke + glow ring that reads on EVERY fill and on both
          canvas themes. */}
      <ShapeOutline
        shape={node.shape}
        h={h}
        fill={fill}
        stroke={previewCurrent ? '#a5b4fc' : selected ? '#93c5fd' : 'rgba(255,255,255,0.22)'}
        strokeWidth={previewCurrent ? 3.5 : selected ? 3 : 1}
        filter={previewCurrent
          ? 'drop-shadow(0 0 10px rgba(99,102,241,.7))'
          : selected ? 'drop-shadow(0 0 8px rgba(147,197,253,.65))' : 'drop-shadow(0 2px 5px rgba(0,0,0,.25))'}
      />

      {/* Icon — left of the text, sized up from 0.58 after field feedback that
          it was unreadable at normal zoom */}
      {node.icon && ICON_PATHS[node.icon] && (
        <g transform={`translate(${node.shape === 'diamond' ? NODE_W / 2 - 9 : 10} ${node.shape === 'diamond' ? h - 24 : h / 2 - 9}) scale(0.75)`} pointerEvents="none">
          <path d={ICON_PATHS[node.icon]} fill="none" stroke="rgba(255,255,255,0.92)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        </g>
      )}

      {/* Collapse chevron — bottom edge, only when there are directed children */}
      {collapsible && (
        <g
          transform={`translate(${NODE_W / 2} ${h + (node.shape === 'diamond' ? 14 : 8)})`}
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
          <circle r={7} fill="rgba(255,255,255,0.2)" stroke="rgba(255,255,255,0.5)" strokeWidth={0.8} />
          <path d="M -2 2 L 2 -2 M 0 -2 L 2 -2 L 2 0" fill="none" stroke="#ffffff" strokeWidth={1.4} strokeLinecap="round" />
          <title>{node.link}</title>
        </g>
      )}

      {/* Status badge — top-right. White ring, NOT the card fill: the dot's
          own color can match the fill (done-green on a semantic card), so the
          ring is what keeps it legible on every fill. */}
      {node.status && (
        <circle cx={NODE_W - 10} cy={10} r={5}
                fill={STATUS_COLORS[node.status]} stroke="rgba(255,255,255,0.95)" strokeWidth={1.5}>
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

      {/* Step content glyphs — voice / image / model, on a white pill riding
          the bottom edge. The pill matters on the night canvas: bare glyph
          text below the card sat on the dark background, tiny AND low-contrast
          — the exact combination users reported as "icons too small to see".
          Shifts left when a collapse chevron shares the bottom edge. */}
      {stepGlyphs.length > 0 && (() => {
        const pillW = stepGlyphs.length * 19 + 12;
        const cx = collapsible ? NODE_W / 2 - 44 : NODE_W / 2;
        return (
          <g transform={`translate(${cx} ${h - 2})`} pointerEvents="none">
            <rect x={-pillW / 2} y={-4} width={pillW} height={21} rx={10.5}
                  fill="#ffffff" stroke="#cbd5e1" strokeWidth={1} />
            <text x={0} y={12} textAnchor="middle" style={{ fontSize: 13 }}>
              {stepGlyphs.join(' ')}
            </text>
          </g>
        );
      })()}

      {/* Milestone diamond — floats above the top-left corner. Ringed in the
          card fill so it separates from the card on one side and gold stays
          gold against both canvas themes on the other. */}
      {node.milestone && (
        <path d={`M 16 -8 l 7 8 l -7 8 l -7 -8 z`} fill="#eab308" stroke={fill} strokeWidth={1.5}>
          <title>Milestone</title>
        </path>
      )}

      {/* Review verdict — top-left inside the node, on a white chip so the
          verdict color survives every card fill (red-on-blue etc. is mud). */}
      {node.review && (
        <g transform="translate(14 11)" pointerEvents="none">
          <circle r={8} fill="rgba(255,255,255,0.95)" />
          <text y={4} textAnchor="middle" style={{ fontSize: 11, fontWeight: 700 }}
                fill={node.review === 'approved' ? '#16a34a' : node.review === 'rejected' ? '#dc2626' : '#d97706'}>
            {node.review === 'approved' ? '✓' : node.review === 'rejected' ? '✗' : '?'}
          </text>
          <title>{node.review}</title>
        </g>
      )}

      {/* Comment count — bottom-left bubble */}
      {(node.comments?.length ?? 0) > 0 && (
        <g transform={`translate(12 ${h - 9})`} pointerEvents="none">
          <rect x={-7} y={-8} width={20} height={13} rx={6.5} fill="#eef2f7" stroke="#cbd5e1" strokeWidth={0.8} />
          <text x={3} y={2.5} textAnchor="middle" style={{ fontSize: 9, fontWeight: 600 }} fill="#475569">
            {node.comments!.length > 99 ? '99' : node.comments!.length}
          </text>
        </g>
      )}

      {/* Notes indicator — bottom-right corner */}
      {node.notes && (
        <g transform={`translate(${NODE_W - 16} ${h - 14})`} opacity={0.75} pointerEvents="none">
          <rect width={9} height={10} rx={1.5} fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth={1.2} />
          <line x1={2} y1={3} x2={7} y2={3} stroke="rgba(255,255,255,0.85)" strokeWidth={1.2} />
          <line x1={2} y1={5.5} x2={7} y2={5.5} stroke="rgba(255,255,255,0.85)" strokeWidth={1.2} />
        </g>
      )}

      {editing ? (
        <foreignObject x={8} y={4} width={NODE_W - 16} height={h - 8}>
          <textarea
            autoFocus
            className="node-editor"
            defaultValue={node.text}
            onFocus={e => e.target.select()}
            onChange={e => {
              // Autosave while typing (debounced) — no Enter required. The
              // editor stays open; blur/Enter merely close it. Matches how
              // people expect canvas tools to behave.
              const value = e.target.value;
              if (textSaveTimer.current !== undefined) window.clearTimeout(textSaveTimer.current);
              textSaveTimer.current = window.setTimeout(() => {
                updateNodeText(node.id, value.trim());
                textSaveTimer.current = undefined;
              }, 500);
            }}
            onBlur={e => {
              if (textSaveTimer.current !== undefined) {
                window.clearTimeout(textSaveTimer.current);
                textSaveTimer.current = undefined;
              }
              updateNodeText(node.id, e.target.value.trim());
              setEditing(null);
            }}
            onKeyDown={e => {
              e.stopPropagation();
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); (e.target as HTMLTextAreaElement).blur(); }
              // Escape closes the editor; typed text is already autosaved.
              if (e.key === 'Escape') { e.preventDefault(); (e.target as HTMLTextAreaElement).blur(); }
            }}
            onPointerDown={e => e.stopPropagation()}
          />
        </foreignObject>
      ) : (() => {
        // Wrapped title: card height (h) already accounts for the line count,
        // so the block is simply centred.
        const cx = NODE_W / 2 + (node.icon && node.shape !== 'diamond' ? 9 : 0);
        const firstY = h / 2 + 4 - ((labelLines.length - 1) * LINE_HEIGHT) / 2;
        return (
          <text x={cx} y={firstY} textAnchor="middle" className="node-label" pointerEvents="none">
            {labelLines.map((ln, i) => (
              <tspan key={i} x={cx} dy={i === 0 ? 0 : LINE_HEIGHT}>{ln}</tspan>
            ))}
          </text>
        );
      })()}

      {/* Connection handle — right edge ring (auto endpoints, legacy flow) */}
      <circle
        className="connect-handle"
        cx={NODE_W} cy={h / 2} r={7}
        fill="#ffffff" stroke={color} strokeWidth={2}
        style={{ cursor: 'crosshair', opacity: selected || pendingEdgeFrom ? 1 : undefined }}
        onPointerDown={startConnection}
      />

      {/* Anchor ports — N/E/S/W points ON the shape outline. Dragging from
          one pins the edge's source side; dropping on one pins the target
          side. Shown on hover/selection, and always while a connection is
          being dragged (they are the drop targets). */}
      {EDGE_PORTS.map(port => {
        const p = portPoint(node, port);
        const lx = p.x - node.x, ly = p.y - node.y;
        return (
          <g
            key={port}
            className={`node-port${pendingEdgeFrom ? ' port-active' : ''}`}
            transform={`translate(${lx} ${ly})`}
            style={{ cursor: 'crosshair' }}
            onPointerDown={e => startPortConnection(e, port)}
            onPointerUp={e => dropOnPort(e, port)}
          >
            <circle r={9} fill="transparent" />
            <circle className="node-port-dot" r={4.5} fill="#ffffff" stroke={color} strokeWidth={2} />
            <title>{`Connect from ${port}`}</title>
          </g>
        );
      })}
    </g>
  );
}
