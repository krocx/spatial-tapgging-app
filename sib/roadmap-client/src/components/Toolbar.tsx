// Toolbar.tsx — top bar of the editor: back, map name, node-type palette,
// layout / undo / redo / export / versions / save, presence + connection dot.

import { useState } from 'react';
import { useStore } from '../state/store.js';
import { NODE_COLORS, NODE_TYPE_LABELS, NODE_TYPES, peerColor } from '../utils/colors.js';
import { exportJson, exportPng, exportSvg } from '../utils/export.js';
import { downloadServerExport, getDraftKey } from '../api/mindmap-api.js';
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
  const addRowLanePreset = useStore(s => s.addRowLanePreset);
  const addLane = useStore(s => s.addLane);
  const setLanes = useStore(s => s.setLanes);
  const importFromSib = useStore(s => s.importFromSib);
  const layoutMode = useStore(s => s.layoutMode);
  const fitView = useStore(s => s.fitView);
  const filters = useStore(s => s.filters);
  const showFilterPanel = useStore(s => s.showFilterPanel);
  const setShowFilterPanel = useStore(s => s.setShowFilterPanel);
  const startPresentation = useStore(s => s.startPresentation);
  const canvasTheme = useStore(s => s.canvasTheme);
  const toggleCanvasTheme = useStore(s => s.toggleCanvasTheme);
  const updateSettings = useStore(s => s.updateSettings);
  const publishMap = useStore(s => s.publishMap);
  const unpublishMap = useStore(s => s.unpublishMap);
  const holdsDraftKey = useStore(s => s.holdsDraftKey);
  const showGlossary = useStore(s => s.showGlossary);
  const openGlossary = useStore(s => s.openGlossary);
  const closeGlossary = useStore(s => s.closeGlossary);
  const [showStyle, setShowStyle] = useState(false);

  const [showExport, setShowExport] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const [showLayout, setShowLayout] = useState(false);
  const [showLanes, setShowLanes] = useState(false);
  const [showSib, setShowSib] = useState(false);

  const closeMenus = () => {
    setShowExport(false); setShowVersions(false); setShowLayout(false);
    setShowLanes(false); setShowSib(false); setShowStyle(false);
  };

  if (!map) return null;

  const matches = searchQuery.trim()
    ? map.nodes.filter(n => n.text.toLowerCase().includes(searchQuery.trim().toLowerCase())).slice(0, 8)
    : [];
  const filterCount = filters.types.length + filters.statuses.length + filters.groupIds.length;

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

      {/* Publish state chip — click to toggle (draft-key holders only) */}
      {map.published === false ? (
        <button
          className="pub-chip draft"
          title="Draft — only draft-key holders can see this map. Click to publish for everyone."
          onClick={() => { if (confirm('Publish this map? Everyone will be able to view and edit it.')) void publishMap(); }}
        >Draft 🔒</button>
      ) : null}
      {map.published === false && holdsDraftKey() ? (
        <button
          className="btn ghost share-key"
          title="Copy this map's draft key — share it so a teammate can unlock the draft"
          onClick={() => {
            const key = getDraftKey(map.id);
            if (key) void navigator.clipboard.writeText(key);
          }}
        >Copy key</button>
      ) : null}
      {map.published !== false && holdsDraftKey() ? (
        <button
          className="pub-chip published"
          title="Published — visible to everyone. Click to unpublish (back to draft)."
          onClick={() => { if (confirm('Unpublish? Only draft-key holders will see it again.')) void unpublishMap(); }}
        >Published</button>
      ) : null}

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

      <button
        className="btn"
        onClick={toggleCanvasTheme}
        title={canvasTheme === 'night'
          ? 'Switch canvas to day background'
          : 'Switch canvas to night background'}
      >
        {canvasTheme === 'night' ? '☀ Day' : '☾ Night'}
      </button>

      <div className="menu-wrap">
        <button className="btn" onClick={() => { const v = showLanes; closeMenus(); setShowLanes(!v); }}>
          Lanes ▾
        </button>
        {showLanes && (
          <div className="menu">
            <button onClick={() => { addLanePreset(); setShowLanes(false); }}>Now / Next / Later (columns)</button>
            <button onClick={() => { addRowLanePreset(); setShowLanes(false); }}>Why / What / How (rows)</button>
            <button onClick={() => { addLane(); setShowLanes(false); }}>Add column lane</button>
            <button onClick={() => { setLanes([]); setShowLanes(false); }}>Clear lanes</button>
          </div>
        )}
      </div>

      <div className="menu-wrap">
        <button className="btn" onClick={() => { const v = showStyle; closeMenus(); setShowStyle(!v); }}>
          Style ▾
        </button>
        {showStyle && (
          <div className="menu">
            <div className="menu-note">Edge color</div>
            <button onClick={() => updateSettings({ edgeColor: 'parent' })}>
              {map.settings?.edgeColor !== 'neutral' ? '✓ ' : ''}Parent node color
            </button>
            <button onClick={() => updateSettings({ edgeColor: 'neutral' })}>
              {map.settings?.edgeColor === 'neutral' ? '✓ ' : ''}Neutral grey
            </button>
            <div className="menu-note">Routes</div>
            <button onClick={() => updateSettings({ edgeStyle: 'straight' })}>
              {map.settings?.edgeStyle !== 'curved' ? '✓ ' : ''}Straight
            </button>
            <button onClick={() => updateSettings({ edgeStyle: 'curved' })}>
              {map.settings?.edgeStyle === 'curved' ? '✓ ' : ''}Curved
            </button>
          </div>
        )}
      </div>

      <div className="menu-wrap">
        <button className="btn" onClick={() => { const v = showLayout; closeMenus(); setShowLayout(!v); }}
                title="Current layout mode — resets to Freeform when you move a node by hand">
          Layout: {layoutMode === 'hierarchical' ? 'Hierarchical' : layoutMode === 'grid' ? 'Grid' : 'Freeform'} ▾
        </button>
        {showLayout && (
          <div className="menu">
            <button onClick={() => { applyAutoLayout('hierarchical'); setShowLayout(false); }}>
              {layoutMode === 'hierarchical' ? '✓ ' : ''}Hierarchical
            </button>
            <button onClick={() => { applyAutoLayout('grid'); setShowLayout(false); }}>
              {layoutMode === 'grid' ? '✓ ' : ''}Grid
            </button>
          </div>
        )}
      </div>

      <button className="btn" onClick={fitView} title="Zoom to fit the whole map">Fit</button>

      <button
        className={`btn ${showFilterPanel || filterCount > 0 ? 'btn-active' : ''}`}
        onClick={() => setShowFilterPanel(!showFilterPanel)}
        title="View filters: highlight by layer, status, or group"
      >
        Filters{filterCount > 0 ? ` (${filterCount})` : ''}
      </button>

      <button className="btn" onClick={startPresentation}
              title="Walk through the map lane by lane (→ / ← / Esc)">
        ▶ Present
      </button>

      <button
        className={`btn ${showGlossary ? 'btn-active' : ''}`}
        onClick={() => showGlossary ? closeGlossary() : openGlossary()}
        title="Roadmap dictionary — every capability on the roadmap, defined"
      >📖</button>

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
