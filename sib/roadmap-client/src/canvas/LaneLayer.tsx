// LaneLayer.tsx — swimlane bands (Now / Next / Later …) rendered behind the
// graph in world space. Band backgrounds double as canvas (double-click still
// creates nodes via the `lane-band` class check in CanvasStage); the header
// pill is clickable and selects the lane for editing in the inspector.

import { useStore } from '../state/store.js';

const BAND_TOP = -100_000;
const BAND_H = 200_000;

export function LaneLayer(): JSX.Element | null {
  const lanes = useStore(s => s.map?.lanes);
  const camera = useStore(s => s.camera);
  const selectedLaneId = useStore(s => s.selectedLaneId);
  const selectLane = useStore(s => s.selectLane);

  if (!lanes || lanes.length === 0) return null;

  // Keep headers pinned near the top of the visible viewport (world coords).
  const headerY = (12 - camera.y) / camera.scale + 28 / camera.scale;
  const fontSize = 14 / camera.scale;

  return (
    <g>
      {lanes.map((lane, i) => (
        <g key={lane.id}>
          <rect
            className="lane-band"
            x={lane.x} y={BAND_TOP} width={lane.width} height={BAND_H}
            fill={i % 2 === 0 ? 'rgba(47,111,237,0.045)' : 'rgba(100,116,139,0.045)'}
          />
          <line x1={lane.x} y1={BAND_TOP} x2={lane.x} y2={BAND_TOP + BAND_H}
                stroke="#dbe3ec" strokeWidth={1.5 / camera.scale} />
          {i === lanes.length - 1 && (
            <line x1={lane.x + lane.width} y1={BAND_TOP} x2={lane.x + lane.width} y2={BAND_TOP + BAND_H}
                  stroke="#dbe3ec" strokeWidth={1.5 / camera.scale} />
          )}
          <text
            x={lane.x + lane.width / 2} y={headerY}
            textAnchor="middle"
            fontSize={fontSize}
            fontWeight={600}
            fill={selectedLaneId === lane.id ? '#2f6fed' : '#94a3b8'}
            style={{ cursor: 'pointer', userSelect: 'none' }}
            onPointerDown={e => { e.stopPropagation(); selectLane(lane.id); }}
          >
            {lane.name}
          </text>
        </g>
      ))}
    </g>
  );
}
