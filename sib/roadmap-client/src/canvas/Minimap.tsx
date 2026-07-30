// Minimap.tsx — bottom-right overview: node rects colored by SIB layer,
// current viewport outline, click/drag to jump.

import { useCallback, useRef } from 'react';
import { useStore } from '../state/store.js';
import { NODE_COLORS } from '../utils/colors.js';
import { NODE_W, NODE_H } from '../utils/geometry.js';

const MM_W = 180;
const MM_H = 120;
const PAD = 40;

export function Minimap(): JSX.Element | null {
  const map = useStore(s => s.map);
  const camera = useStore(s => s.camera);
  const setCamera = useStore(s => s.setCamera);
  const svgRef = useRef<SVGSVGElement>(null);

  if (!map || map.nodes.length === 0) return null;

  const minX = Math.min(...map.nodes.map(n => n.x)) - PAD;
  const minY = Math.min(...map.nodes.map(n => n.y)) - PAD;
  const maxX = Math.max(...map.nodes.map(n => n.x)) + NODE_W + PAD;
  const maxY = Math.max(...map.nodes.map(n => n.y)) + NODE_H + PAD;
  const scale = Math.min(MM_W / (maxX - minX), MM_H / (maxY - minY));
  const ox = (MM_W - (maxX - minX) * scale) / 2;
  const oy = (MM_H - (maxY - minY) * scale) / 2;

  const toMini = (wx: number, wy: number) => ({ x: ox + (wx - minX) * scale, y: oy + (wy - minY) * scale });

  // Viewport rectangle in minimap coordinates.
  const vp0 = toMini(-camera.x / camera.scale, -camera.y / camera.scale);
  const vpW = (window.innerWidth / camera.scale) * scale;
  const vpH = (window.innerHeight / camera.scale) * scale;

  const jump = useCallback((e: React.PointerEvent) => {
    const rect = svgRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    // Minimap point → world point → center viewport there.
    const wx = minX + (mx - ox) / scale;
    const wy = minY + (my - oy) / scale;
    setCamera({
      scale: camera.scale,
      x: window.innerWidth / 2 - wx * camera.scale,
      y: window.innerHeight / 2 - wy * camera.scale,
    });
  }, [minX, minY, ox, oy, scale, camera.scale, setCamera]);

  return (
    <svg
      ref={svgRef}
      className="minimap"
      width={MM_W} height={MM_H}
      onPointerDown={e => { e.stopPropagation(); jump(e); }}
      onPointerMove={e => { if (e.buttons === 1) jump(e); }}
    >
      <rect width={MM_W} height={MM_H} rx={8} fill="rgba(255,255,255,0.92)" stroke="#e2e8f0" />
      {(map.lanes ?? []).map((l, i) => {
        const a = toMini(l.x, minY);
        return (
          <rect key={l.id} x={a.x} y={0} width={l.width * scale} height={MM_H}
                fill={i % 2 === 0 ? 'rgba(47,111,237,0.05)' : 'rgba(100,116,139,0.05)'} />
        );
      })}
      {map.nodes.map(n => {
        const p = toMini(n.x, n.y);
        return (
          <rect key={n.id} x={p.x} y={p.y}
                width={Math.max(3, NODE_W * scale)} height={Math.max(2, NODE_H * scale)}
                rx={1.5} fill={NODE_COLORS[n.type] ?? NODE_COLORS.generic} opacity={0.8} />
        );
      })}
      <rect x={vp0.x} y={vp0.y} width={vpW} height={vpH}
            fill="none" stroke="#2f6fed" strokeWidth={1.5} rx={2} />
    </svg>
  );
}
