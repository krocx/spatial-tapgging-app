// CanvasStage.tsx — infinite SVG canvas: pan (space+drag / background drag /
// middle mouse), zoom-to-cursor (wheel), double-click node creation, dot grid.
// Pure interaction layer — graph mutations go through store actions.

import { useRef, useState, useCallback, useEffect } from 'react';
import { useStore } from '../state/store.js';
import { toWorld, nodeCenter } from '../utils/geometry.js';
import { NodeView } from './NodeView.js';
import { EdgeView } from './EdgeView.js';
import { CursorLayer } from './CursorLayer.js';

const MIN_SCALE = 0.15;
const MAX_SCALE = 3;

export function CanvasStage(): JSX.Element {
  const svgRef = useRef<SVGSVGElement>(null);
  const map = useStore(s => s.map);
  const camera = useStore(s => s.camera);
  const setCamera = useStore(s => s.setCamera);
  const addNode = useStore(s => s.addNode);
  const select = useStore(s => s.select);
  const selectEdge = useStore(s => s.selectEdge);
  const setEditing = useStore(s => s.setEditing);
  const sendCursor = useStore(s => s.sendCursor);
  const pendingEdgeFrom = useStore(s => s.pendingEdgeFrom);
  const setPendingEdgeFrom = useStore(s => s.setPendingEdgeFrom);
  const addEdge = useStore(s => s.addEdge);

  const [spaceDown, setSpaceDown] = useState(false);
  const [panning, setPanning] = useState(false);
  const [mouseWorld, setMouseWorld] = useState({ x: 0, y: 0 });
  const panStart = useRef({ mx: 0, my: 0, cx: 0, cy: 0 });

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

  const onWheel = useCallback((e: React.WheelEvent) => {
    const p = screenPoint(e);
    const factor = Math.exp(-e.deltaY * 0.0015);
    const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, camera.scale * factor));
    // Zoom toward the cursor: keep the world point under the mouse fixed.
    const wx = (p.x - camera.x) / camera.scale;
    const wy = (p.y - camera.y) / camera.scale;
    setCamera({ x: p.x - wx * scale, y: p.y - wy * scale, scale });
  }, [camera, setCamera, screenPoint]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button === 1 || spaceDown || (e.button === 0 && e.target === svgRef.current)) {
      // Background / middle / space → pan. Plain background click also deselects.
      if (e.button === 0 && !spaceDown) { select(null); selectEdge(null); setEditing(null); }
      const p = screenPoint(e);
      panStart.current = { mx: p.x, my: p.y, cx: camera.x, cy: camera.y };
      setPanning(true);
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    }
  }, [spaceDown, camera, select, selectEdge, setEditing, screenPoint]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const p = screenPoint(e);
    const world = toWorld(p.x, p.y, camera);
    setMouseWorld(world);
    sendCursor(world.x, world.y);
    if (panning) {
      setCamera({
        x: panStart.current.cx + (p.x - panStart.current.mx),
        y: panStart.current.cy + (p.y - panStart.current.my),
        scale: camera.scale,
      });
    }
  }, [panning, camera, setCamera, sendCursor, screenPoint]);

  const onPointerUp = useCallback(() => {
    setPanning(false);
    if (pendingEdgeFrom) setPendingEdgeFrom(null);   // dropped a connection on empty space
  }, [pendingEdgeFrom, setPendingEdgeFrom]);

  const onDoubleClick = useCallback((e: React.MouseEvent) => {
    if (e.target !== svgRef.current) return;         // only on empty canvas
    const p = screenPoint(e);
    const world = toWorld(p.x, p.y, camera);
    addNode(world.x, world.y);
  }, [camera, addNode, screenPoint]);

  if (!map) return <div className="canvas-empty">No map loaded</div>;

  const pendingSource = pendingEdgeFrom ? map.nodes.find(n => n.id === pendingEdgeFrom) : null;
  const gridSize = 24 * camera.scale;

  return (
    <svg
      ref={svgRef}
      className="canvas-stage"
      style={{ cursor: panning ? 'grabbing' : spaceDown ? 'grab' : 'default' }}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
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
      </defs>

      {/* Dot grid backdrop (screen space, so it never runs out) */}
      <rect className="grid-backdrop" width="100%" height="100%" fill="url(#dot-grid)" pointerEvents="none" />

      <g transform={`translate(${camera.x} ${camera.y}) scale(${camera.scale})`}>
        {map.edges.map(e => <EdgeView key={e.id} edge={e} />)}

        {/* Live connection preview while dragging from a node handle */}
        {pendingSource && (
          <line
            x1={nodeCenter(pendingSource).x} y1={nodeCenter(pendingSource).y}
            x2={mouseWorld.x} y2={mouseWorld.y}
            stroke="#2f6fed" strokeWidth={1.5} strokeDasharray="6 4" pointerEvents="none"
          />
        )}

        {map.nodes.map(n => <NodeView key={n.id} node={n} onConnectDrop={addEdge} />)}
        <CursorLayer />
      </g>
    </svg>
  );
}
