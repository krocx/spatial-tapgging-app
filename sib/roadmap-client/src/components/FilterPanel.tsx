// FilterPanel.tsx — left overlay with view filters: SIB layers, statuses,
// and custom groups. Chips toggle on/off (multi-select); matching nodes stay
// full-strength, everything else fades. Filters are per-viewer only.

import { useStore } from '../state/store.js';
import {
  NODE_COLORS, NODE_TYPE_LABELS, NODE_TYPES,
  STATUS_COLORS, STATUS_LABELS, NODE_STATUSES,
} from '../utils/colors.js';

export function FilterPanel(): JSX.Element | null {
  const map = useStore(s => s.map);
  const show = useStore(s => s.showFilterPanel);
  const filters = useStore(s => s.filters);
  const toggleTypeFilter = useStore(s => s.toggleTypeFilter);
  const toggleStatusFilter = useStore(s => s.toggleStatusFilter);
  const toggleGroupFilter = useStore(s => s.toggleGroupFilter);
  const clearFilters = useStore(s => s.clearFilters);
  const setShowFilterPanel = useStore(s => s.setShowFilterPanel);
  const renameGroup = useStore(s => s.renameGroup);
  const deleteGroup = useStore(s => s.deleteGroup);

  if (!map || !show) return null;

  const active = filters.types.length + filters.statuses.length + filters.groupIds.length;
  const typeCount = (t: string) => map.nodes.filter(n => n.type === t).length;
  const statusCount = (st: string) => map.nodes.filter(n => (n.status ?? 'none') === st).length;

  return (
    <aside className="filter-panel">
      <div className="filter-head">
        <h3>View filters</h3>
        {active > 0 && <button className="btn ghost filter-clear" onClick={clearFilters}>Clear ({active})</button>}
        <button className="btn ghost" title="Close" onClick={() => setShowFilterPanel(false)}>✕</button>
      </div>

      <section>
        <h4>Layers</h4>
        <div className="chip-col">
          {NODE_TYPES.map(t => (
            <button
              key={t}
              className={`chip ${filters.types.includes(t) ? 'active' : ''}`}
              onClick={() => toggleTypeFilter(t)}
            >
              <span className="swatch-dot" style={{ background: NODE_COLORS[t] }} />
              {NODE_TYPE_LABELS[t]}
              <span className="chip-count">{typeCount(t)}</span>
            </button>
          ))}
        </div>
      </section>

      <section>
        <h4>Status</h4>
        <div className="chip-col">
          {NODE_STATUSES.map(st => (
            <button
              key={st}
              className={`chip ${filters.statuses.includes(st) ? 'active' : ''}`}
              onClick={() => toggleStatusFilter(st)}
            >
              <span className="swatch-dot" style={{ background: STATUS_COLORS[st] }} />
              {STATUS_LABELS[st]}
              <span className="chip-count">{statusCount(st)}</span>
            </button>
          ))}
          <button
            className={`chip ${filters.statuses.includes('none') ? 'active' : ''}`}
            onClick={() => toggleStatusFilter('none')}
          >
            <span className="swatch-dot" style={{ background: '#e2e8f0' }} />
            No status
            <span className="chip-count">{statusCount('none')}</span>
          </button>
        </div>
      </section>

      <section>
        <h4>Groups</h4>
        {(map.groups ?? []).length === 0 && (
          <p className="filter-hint">Select nodes, then "Group selection" in the panel on the right.</p>
        )}
        <div className="chip-col">
          {(map.groups ?? []).map(g => (
            <div key={g.id} className="chip-row">
              <button
                className={`chip ${filters.groupIds.includes(g.id) ? 'active' : ''}`}
                onClick={() => toggleGroupFilter(g.id)}
                onDoubleClick={() => {
                  const name = prompt('Rename group', g.name);
                  if (name?.trim()) renameGroup(g.id, name);
                }}
                title="Click to filter · double-click to rename"
              >
                <span className="swatch-dot" style={{ background: '#0891b2' }} />
                {g.name}
                <span className="chip-count">{g.nodeIds.length}</span>
              </button>
              <button
                className="chip-delete"
                title="Delete group (nodes stay)"
                onClick={() => { if (confirm(`Delete group "${g.name}"? Nodes are not removed.`)) deleteGroup(g.id); }}
              >✕</button>
            </div>
          ))}
        </div>
      </section>

      <p className="filter-hint">
        Within a section filters combine with OR; across sections with AND.
      </p>
    </aside>
  );
}
