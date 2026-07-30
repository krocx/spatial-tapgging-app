// Toolbar.tsx — top bar of the editor: back, map name, node-type palette,
// layout / undo / redo / export / versions / save, presence + connection dot.

import { useState } from 'react';
import { useStore } from '../state/store.js';
import { NODE_COLORS, NODE_TYPE_LABELS, NODE_TYPES, peerColor } from '../utils/colors.js';
import { exportJson, exportPng, exportSvg } from '../utils/export.js';
import { downloadServerExport } from '../api/mindmap-api.js';
import { VersionsPanel } from './VersionsPanel.js';

async function downloadSibDraft(mapId: string): Promise<void> {
  try { await downloadServerExport(mapId, 'sib-json'); }
  catch (err) { useStore.setState({ error: (err as Error).message }); }
}

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

  const searchQuery = useStore(s => s.searchQuery);
  const setSearchQuery = useStore(s => s.setSearchQuery);
  const jumpToNode = useStore(s => s.jumpToNode);
  const addLanePreset = useStore(s => s.addLanePreset);
  const addLane = useStore(s => s.addLane);
  const setLanes = useStore(s => s.setLanes);
  const importFromSib = useStore(s => s.importFromSib);

  const [showExport, setShowExport] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const [showLayout, setShowLayout] = useState(false);
  const [showLanes, setShowLanes] = useState(false);
  const [showSib, setShowSib] = useState(false);

  const closeMenus = () => {
    setShowExport(false); setShowVersions(false); setShowLayout(false);
    setShowLanes(false); setShowSib(false);
  };

  if (!map) return null;

  const matches = searchQuery.trim()
    ? map.nodes.filter(n => n.text.toLowerCase().includes(searchQuery.trim().toLowerCase())).slice(0, 8)
    : [];

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

      <div className="search-wrap">
        <input
          className="search-input"
          value={searchQuery}
          placeholder="Search nodes…"
          onChange={e => setSearchQuery(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && matches.length > 0) jumpToNode(matches[0].id);
            if (e.key === 'Escape') setSearchQuery('');
          }}
        />
        {matches.length > 0 && (
          <div className="menu search-results">
            {matches.map(n => (
              <button key={n.id} onClick={() => jumpToNode(n.id)}>
                <span className="swatch-dot" style={{ background: NODE_COLORS[n.type] }} />
                {n.text.length > 32 ? n.text.slice(0, 31) + '…' : n.text}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="spacer" />

      <div className="menu-wrap">
        <button className="btn" onClick={() => { const v = showLanes; closeMenus(); setShowLanes(!v); }}>
          Lanes ▾
        </button>
        {showLanes && (
          <div className="menu">
            <button onClick={() => { addLanePreset(); setShowLanes(false); }}>Now / Next / Later</button>
            <button onClick={() => { addLane(); setShowLanes(false); }}>Add lane</button>
            <button onClick={() => { setLanes([]); setShowLanes(false); }}>Clear lanes</button>
          </div>
        )}
      </div>

      <div className="menu-wrap">
        <button className="btn" onClick={() => { const v = showLayout; closeMenus(); setShowLayout(!v); }}>
          Layout ▾
        </button>
        {showLayout && (
          <div className="menu">
            <button onClick={() => { applyAutoLayout('hierarchical'); setShowLayout(false); }}>Hierarchical</button>
            <button onClick={() => { applyAutoLayout('grid'); setShowLayout(false); }}>Grid</button>
          </div>
        )}
      </div>

      <div className="menu-wrap">
        <button className="btn" onClick={() => { const v = showSib; closeMenus(); setShowSib(!v); }}>
          SIB ▾
        </button>
        {showSib && (
          <div className="menu">
            <button onClick={() => { void importFromSib(); setShowSib(false); }}>Import anchors + tags</button>
            <button onClick={() => { void downloadSibDraft(map.id); setShowSib(false); }}>Export SIB draft (JSON)</button>
          </div>
        )}
      </div>

      <button className="btn" disabled={undoStack.length === 0} onClick={undo} title="Ctrl+Z">↶ Undo</button>
      <button className="btn" disabled={redoStack.length === 0} onClick={redo} title="Ctrl+Y">↷ Redo</button>

      <div className="menu-wrap">
        <button className="btn" onClick={() => { const v = showExport; closeMenus(); setShowExport(!v); }}>
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
        <button className="btn" onClick={() => { const v = showVersions; closeMenus(); setShowVersions(!v); }}>
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
