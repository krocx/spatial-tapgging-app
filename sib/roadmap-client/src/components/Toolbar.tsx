// Toolbar.tsx — top bar of the editor: back, map name, node-type palette,
// layout / undo / redo / export / versions / save, presence + connection dot.

import { useState } from 'react';
import { useStore } from '../state/store.js';
import { NODE_COLORS, NODE_TYPE_LABELS, NODE_TYPES, peerColor } from '../utils/colors.js';
import { exportJson, exportPng, exportSvg } from '../utils/export.js';
import { VersionsPanel } from './VersionsPanel.js';

export function Toolbar(): JSX.Element | null {
  const map = useStore(s => s.map);
  const dirty = useStore(s => s.dirty);
  const statusMessage = useStore(s => s.statusMessage);
  const collabStatus = useStore(s => s.collabStatus);
  const peers = useStore(s => s.peers);
  const defaultNodeType = useStore(s => s.defaultNodeType);
  const selectedNodeIds = useStore(s => s.selectedNodeIds);
  const setDefaultNodeType = useStore(s => s.setDefaultNodeType);
  const setNodeType = useStore(s => s.setNodeType);
  const undoStack = useStore(s => s.undoStack);
  const redoStack = useStore(s => s.redoStack);
  const undo = useStore(s => s.undo);
  const redo = useStore(s => s.redo);
  const save = useStore(s => s.save);
  const closeMap = useStore(s => s.closeMap);
  const applyAutoLayout = useStore(s => s.applyAutoLayout);

  const [showExport, setShowExport] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const [showLayout, setShowLayout] = useState(false);

  if (!map) return null;

  const pickType = (t: typeof NODE_TYPES[number]) => {
    setDefaultNodeType(t);
    // Palette also retypes the current selection — fast recolor workflow.
    for (const id of selectedNodeIds) setNodeType(id, t);
  };

  return (
    <div className="toolbar">
      <button className="btn ghost" onClick={closeMap} title="Back to map list">←</button>
      <span className="map-name" title={map.name}>{map.name}</span>
      {dirty ? <span className="dirty-dot" title="Unsaved changes">●</span> : null}

      <div className="palette" title="Node type — applies to new nodes and current selection">
        {NODE_TYPES.map(t => (
          <button
            key={t}
            className={`swatch ${defaultNodeType === t ? 'active' : ''}`}
            style={{ background: NODE_COLORS[t] }}
            title={NODE_TYPE_LABELS[t]}
            onClick={() => pickType(t)}
          />
        ))}
      </div>

      <div className="spacer" />

      <div className="menu-wrap">
        <button className="btn" onClick={() => { setShowLayout(v => !v); setShowExport(false); setShowVersions(false); }}>
          Layout ▾
        </button>
        {showLayout && (
          <div className="menu">
            <button onClick={() => { applyAutoLayout('hierarchical'); setShowLayout(false); }}>Hierarchical</button>
            <button onClick={() => { applyAutoLayout('grid'); setShowLayout(false); }}>Grid</button>
          </div>
        )}
      </div>

      <button className="btn" disabled={undoStack.length === 0} onClick={undo} title="Ctrl+Z">↶ Undo</button>
      <button className="btn" disabled={redoStack.length === 0} onClick={redo} title="Ctrl+Y">↷ Redo</button>

      <div className="menu-wrap">
        <button className="btn" onClick={() => { setShowExport(v => !v); setShowLayout(false); setShowVersions(false); }}>
          Export ▾
        </button>
        {showExport && (
          <div className="menu">
            <button onClick={() => { void exportPng(map); setShowExport(false); }}>PNG</button>
            <button onClick={() => { exportSvg(map); setShowExport(false); }}>SVG</button>
            <button onClick={() => { exportJson(map); setShowExport(false); }}>JSON</button>
          </div>
        )}
      </div>

      <div className="menu-wrap">
        <button className="btn" onClick={() => { setShowVersions(v => !v); setShowExport(false); setShowLayout(false); }}>
          History ▾
        </button>
        {showVersions && <VersionsPanel onClose={() => setShowVersions(false)} />}
      </div>

      <button className="btn primary" onClick={() => void save()} title="Ctrl+S">Save</button>

      <div className="presence" title={`Collaboration: ${collabStatus}`}>
        <span className={`conn-dot ${collabStatus}`} />
        {Object.values(peers).slice(0, 5).map(p => (
          <span key={p.clientId} className="peer-chip" style={{ background: peerColor(p.clientId) }}
                title={p.clientName}>
            {p.clientName.slice(0, 1).toUpperCase()}
          </span>
        ))}
      </div>

      {statusMessage ? <span className="status-msg">{statusMessage}</span> : null}
    </div>
  );
}
