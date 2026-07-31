// CanvasStage.tsx — infinite SVG canvas.
//   Pan:     space+drag, middle mouse, or two-finger drag (touch)
//   Zoom:    wheel (to cursor), pinch (touch)
//   Select:  background drag → marquee; shift extends
//   Create:  double-click empty canvas; long-press on touch
// Pure interaction layer — graph mutations go through store actions.

import { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import { useStore, noteMouseWorld, computeHighlight } from '../state/store.js';
import { toWorld, nodeCenter, NODE_W, NODE_H } from '../utils/geometry.js';
import { NodeView } from './NodeView.js';
import { EdgeView } from './EdgeView.js';
import { CursorLayer } from './CursorLayer.js';
import { LaneLayer } from './LaneLayer.js';
import { Minimap } from './Minimap.js';
import { computeVisibility, hasDirectedChildren } from '../utils/visibility.js';
import { NODE_COLORS } from '../utils/colors.js';

const MIN_SCALE = 0.15;
const MAX_SCALE = 3;
const LONG_PRESS_MS = 500;

interface Rect { x0: number; y0: number; x1: number; y1: number; }

export function CanvasStage(): JSX.Element {
  const svgRef = useRef<SVGSVGElement>(null);
  const map = useStore(s => s.map);
  const camera = useStore(s => s.camera);
  const setCamera = useStore(s => s.setCamera);
  const addNode = useStore(s => s.addNode);
  const select = useStore(s => s.select);
  const selectEdge = useStore(s => s.selectEdge);
  const selectLane = useStore(s => s.selectLane);
  const setEditing = useStore(s => s.setEditing);
  const sendCursor = useStore(s => s.sendCursor);
  const pendingEdgeFrom = useStore(s => s.pendingEdgeFrom);
  const setPendingEdgeFrom = useStore(s => s.setPendingEdgeFrom);
  const addEdge = useStore(s => s.addEdge);

  const [spaceDown, setSpaceDown] = useState(false);
  const [panning, setPanning] = useState(false);
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const [mouseWorld, setMouseWorld] = useState({ x: 0, y: 0 });

  const panStart = useRef({ mx: 0, my: 0, cx: 0, cy: 0 });
  const marqueeStart = useRef({ x: 0, y: 0 });
  // Active pointers for pinch (touch). Map pointerId → screen point.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchBase = useRef<{ dist: number; scale: number; mid: { x: number; y: number } } | null>(null);
  const longPress = useRef<number | null>(null);

  // Space key → pan mode (ignore when typing in inputs)
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        setSpaceDown(true);
      }
    };
    const up = (e: KeyboardEvent) => { if (e.code === 'Space') setSpaceDown(false); };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []);

  const screenPoint = useCallback((e: { clientX: number; clientY: number }) => {
    const rect = svgRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  const cancelLongPress = useCallback(() => {
    if (longPress.current !== null) { clearTimeout(longPress.current); longPress.current = null; }
  }, []);

  const onWheel = useCallback((e: React.WheelEvent) => {
    const p = screenPoint(e);
    const factor = Math.exp(-e.deltaY * 0.0015);
    const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, camera.scale * factor));
    const wx = (p.x - camera.x) / camera.scale;
    const wy = (p.y - camera.y) / camera.scale;
    setCamera({ x: p.x - wx * scale, y: p.y - wy * scale, scale });
  }, [camera, setCamera, screenPoint]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    const p = screenPoint(e);
    pointers.current.set(e.pointerId, p);

    // Second touch → switch to pinch, cancel marquee/pan/long-press.
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinchBase.current = {
        dist: Math.hypot(b.x - a.x, b.y - a.y),
        scale: camera.scale,
        mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      };
      setMarquee(null);
      setPanning(false);
      cancelLongPress();
      return;
    }

    const onBackground = e.target === svgRef.current || (e.target as Element).classList?.contains('lane-band');
    if (!onBackground && e.button !== 1) return;

    const presenting = useStore.getState().presentation.active;
    if (e.button === 1 || spaceDown || e.pointerType === 'touch' || presenting) {
      // Middle mouse / space / single-finger touch on background → pan.
      panStart.current = { mx: p.x, my: p.y, cx: camera.x, cy: camera.y };
      setPanning(true);
      (e.currentTarget as Element).setPointerCapture(e.pointerId);

      // Touch: long-press on empty canvas creates a node (no dblclick on iPad).
      if (e.pointerType === 'touch' && !presenting) {
        const world = toWorld(p.x, p.y, camera);
        longPress.current = window.setTimeout(() => {
          setPanning(false);
          addNode(world.x, world.y);
          longPress.current = null;
        }, LONG_PRESS_MS);
      }
    } else if (e.button === 0) {
      // Mouse background drag → marquee selection.
      if (!e.shiftKey) { select(null); selectEdge(null); selectLane(null); setEditing(null); }
      const world = toWorld(p.x, p.y, camera);
      marqueeStart.current = world;
      setMarquee({ x0: world.x, y0: world.y, x1: world.x, y1: world.y });
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    }
  }, [spaceDown, camera, select, selectEdge, selectLane, setEditing, screenPoint, addNode, cancelLongPress]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const p = screenPoint(e);
    const prev = pointers.current.get(e.pointerId);
    if (prev && Math.hypot(p.x - prev.x, p.y - prev.y) > 8) cancelLongPress();
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, p);

    // Pinch zoom (two active touches).
    if (pinchBase.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      if (dist > 0 && pinchBase.current.dist > 0) {
        const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, pinchBase.current.scale * (dist / pinchBase.current.dist)));
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const wx = (mid.x - camera.x) / camera.scale;
        const wy = (mid.y - camera.y) / camera.scale;
        setCamera({ x: mid.x - wx * scale, y: mid.y - wy * scale, scale });
      }
      return;
    }

    const world = toWorld(p.x, p.y, camera);
    setMouseWorld(world);
    noteMouseWorld(world.x, world.y);
    sendCursor(world.x, world.y);

    if (panning) {
      setCamera({
        x: panStart.current.cx + (p.x - panStart.current.mx),
        y: panStart.current.cy + (p.y - panStart.current.my),
        scale: camera.scale,
      });
    } else if (marquee) {
      setMarquee({ x0: marqueeStart.current.x, y0: marqueeStart.current.y, x1: world.x, y1: world.y });
    }
  }, [panning, marquee, camera, setCamera, sendCursor, screenPoint, cancelLongPress]);

  const finishMarquee = useCallback((additive: boolean) => {
    if (!marquee || !map) return;
    const minX = Math.min(marquee.x0, marquee.x1);
    const maxX = Math.max(marquee.x0, marquee.x1);
    const minY = Math.min(marquee.y0, marquee.y1);
    const maxY = Math.max(marquee.y0, marquee.y1);
    // Tiny drag = click → already deselected on pointerdown.
    if (maxX - minX > 4 || maxY - minY > 4) {
      const hit = map.nodes
        .filter(n => n.x + NODE_W > minX && n.x < maxX && n.y + NODE_H > minY && n.y < maxY)
        .map(n => n.id);
      const current = additive ? useStore.getState().selectedNodeIds : [];
      useStore.setState({ selectedNodeIds: [...new Set([...current, ...hit])], selectedEdgeId: null });
    }
    setMarquee(null);
  }, [marquee, map]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchBase.current = null;
    cancelLongPress();
    setPanning(false);
    finishMarquee(e.shiftKey);
    if (pendingEdgeFrom) setPendingEdgeFrom(null);   // dropped a connection on empty space
  }, [pendingEdgeFrom, setPendingEdgeFrom, finishMarquee, cancelLongPress]);

  const onDoubleClick = useCallback((e: React.MouseEvent) => {
    if (useStore.getState().presentation.active) return;
    const onBackground = e.target === svgRef.current || (e.target as Element).classList?.contains('lane-band');
    if (!onBackground) return;
    const p = screenPoint(e);
    const world = toWorld(p.x, p.y, camera);
    addNode(world.x, world.y);
  }, [camera, addNode, screenPoint]);

  const filters = useStore(s => s.filters);
  const presentation = useStore(s => s.presentation);

  // null = no filters active → everything full-strength. During presentation,
  // the current step's node set takes over as the highlight source.
  const highlight = useMemo(() => {
    if (!map) return null;
    if (presentation.active) {
      const step = presentation.steps[presentation.step];
      return step && step.nodeIds.length > 0 ? new Set(step.nodeIds) : null;
    }
    return computeHighlight(map, filters);
  }, [map, filters, presentation]);

  // Collapsible branches: hidden nodes/edges are not rendered at all.
  const visibility = useMemo(
    () => (map ? computeVisibility(map) : { hidden: new Set<string>(), hiddenCounts: new Map<string, number>() }),
    [map],
  );

  if (!map) return <div className="canvas-empty">No map loaded</div>;

  const pendingSource = pendingEdgeFrom ? map.nodes.find(n => n.id === pendingEdgeFrom) : null;
  const gridSize = 24 * camera.scale;

  return (
    <div className="canvas-wrap">
      <svg
        ref={svgRef}
        className="canvas-stage"
        style={{ cursor: panning ? 'grabbing' : spaceDown ? 'grab' : marquee ? 'crosshair' : 'default' }}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
      >
        <defs>
          <pattern id="dot-grid" width={gridSize} height={gridSize} patternUnits="userSpaceOnUse"
                   x={camera.x % gridSize} y={camera.y % gridSize}>
            <circle cx={1} cy={1} r={1} fill="#d3dce6" />
          </pattern>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7"
                  orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#94a3b8" />
          </marker>
          <marker id="arrow-selected" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7"
                  orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#2f6fed" />
          </marker>
          {/* Parent-colored arrowheads — one marker per SIB layer color */}
          {Object.entries(NODE_COLORS).map(([type, color]) => (
            <marker key={type} id={`arrow-${type}`} viewBox="0 0 10 10" refX="9" refY="5"
                    markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill={color} fillOpacity={0.85} />
            </marker>
          ))}
        </defs>

        {/* Dot grid backdrop (screen space, so it never runs out) */}
        <rect className="grid-backdrop" width="100%" height="100%" fill="url(#dot-grid)" pointerEvents="none" />

        <g transform={`translate(${camera.x} ${camera.y}) scale(${camera.scale})`}>
          <LaneLayer />
          {map.edges
            .filter(e => !visibility.hidden.has(e.from) && !visibility.hidden.has(e.to))
            .map(e => (
              <EdgeView
                key={e.id} edge={e}
                dimmed={highlight !== null && !(highlight.has(e.from) && highlight.has(e.to))}
              />
            ))}

          {/* Live connection preview while dragging from a node handle */}
          {pendingSource && (
            <line
              x1={nodeCenter(pendingSource).x} y1={nodeCenter(pendingSource).y}
              x2={mouseWorld.x} y2={mouseWorld.y}
              stroke="#2f6fed" strokeWidth={1.5} strokeDasharray="6 4" pointerEvents="none"
            />
          )}

          {map.nodes
            .filter(n => !visibility.hidden.has(n.id))
            .map(n => (
              <NodeView
                key={n.id} node={n} onConnectDrop={addEdge}
                dimmed={highlight !== null && !highlight.has(n.id)}
                collapsible={hasDirectedChildren(map, n.id)}
                hiddenCount={visibility.hiddenCounts.get(n.id) ?? 0}
              />
            ))}

          {/* Marquee rectangle */}
          {marquee && (
            <rect
              x={Math.min(marquee.x0, marquee.x1)} y={Math.min(marquee.y0, marquee.y1)}
              width={Math.abs(marquee.x1 - marquee.x0)} height={Math.abs(marquee.y1 - marquee.y0)}
              fill="rgba(47,111,237,0.08)" stroke="#2f6fed" strokeWidth={1 / camera.scale}
              strokeDasharray={`${4 / camera.scale} ${3 / camera.scale}`} pointerEvents="none"
            />
          )}

          <CursorLayer />
        </g>
      </svg>
      <Minimap />
    </div>
  );
}
