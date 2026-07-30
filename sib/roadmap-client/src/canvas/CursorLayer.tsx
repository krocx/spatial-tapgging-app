// CursorLayer.tsx — live peer cursors (world space). Stale cursors (>6 s
// without movement) fade out so ghosts don't linger after disconnects.

import { useEffect, useState } from 'react';
import { useStore } from '../state/store.js';
import { peerColor } from '../utils/colors.js';

export function CursorLayer(): JSX.Element {
  const peers = useStore(s => s.peers);
  const scale = useStore(s => s.camera.scale);
  const [, tick] = useState(0);

  // Re-render every 2 s so stale cursors drop off without new events.
  useEffect(() => {
    const t = setInterval(() => tick(n => n + 1), 2000);
    return () => clearInterval(t);
  }, []);

  const now = Date.now();
  const size = 14 / scale;   // keep cursors screen-sized

  return (
    <g pointerEvents="none">
      {Object.values(peers)
        .filter(p => now - p.lastSeen < 6000)
        .map(p => {
          const color = peerColor(p.clientId);
          return (
            <g key={p.clientId} transform={`translate(${p.x} ${p.y})`}>
              <path
                d={`M 0 0 L ${size * 0.8} ${size * 0.35} L ${size * 0.35} ${size * 0.45} L ${size * 0.45} ${size} Z`}
                fill={color} stroke="#fff" strokeWidth={1 / scale}
              />
              <text
                x={size} y={size * 1.4}
                fontSize={11 / scale}
                fill={color}
                style={{ fontWeight: 600, userSelect: 'none' }}
              >
                {p.clientName}
              </text>
            </g>
          );
        })}
    </g>
  );
}
