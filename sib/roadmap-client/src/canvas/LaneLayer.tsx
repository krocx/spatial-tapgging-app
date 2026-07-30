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

  // Headers pin to the visible viewport edge: columns near the top, rows near the left.
  const headerY = (12 - camera.y) / camera.scale + 28 / camera.scale;
  const headerX = (12 - camera.x) / camera.scale + 8 / camera.scale;
  const fontSize = 14 / camera.scale;
  const columns = lanes.filter(l => l.orientation !== 'row');
  const rows = lanes.filter(l => l.orientation === 'row');

  return (
    <g>
      {columns.map((lane, i) => (
        <g key={lane.id}>
          <rect
            className="lane-band"
            x={lane.x} y={BAND_TOP} width={lane.width} height={BAND_H}
            fill={i % 2 === 0 ? 'rgba(47,111,237,0.045)' : 'rgba(100,116,139,0.045)'}
          />
          <line x1={lane.x} y1={BAND_TOP} x2={lane.x} y2={BAND_TOP + BAND_H}
                stroke="#dbe3ec" strokeWidth={1.5 / camera.scale} />
          {i === columns.length - 1 && (
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

      {/* Row lanes (Why / What / How): x = band top, width = band height */}
      {rows.map((lane, i) => (
        <g key={lane.id}>
          <rect
            className="lane-band"
            x={-BAND_H / 2} y={lane.x} width={BAND_H} height={lane.width}
            fill={i % 2 === 0 ? 'rgba(22,163,74,0.04)' : 'rgba(100,116,139,0.04)'}
          />
          <line x1={-BAND_H / 2} y1={lane.x} x2={BAND_H / 2} y2={lane.x}
                stroke="#dbe3ec" strokeWidth={1.5 / camera.scale} />
          {i === rows.length - 1 && (
            <line x1={-BAND_H / 2} y1={lane.x + lane.width} x2={BAND_H / 2} y2={lane.x + lane.width}
                  stroke="#dbe3ec" strokeWidth={1.5 / camera.scale} />
          )}
          <text
            x={headerX} y={lane.x + lane.width / 2}
            fontSize={fontSize}
            fontWeight={600}
            fill={selectedLaneId === lane.id ? '#16a34a' : '#94a3b8'}
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
