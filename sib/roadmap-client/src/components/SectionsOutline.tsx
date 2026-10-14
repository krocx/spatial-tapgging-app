// SectionsOutline.tsx - the left-hand outline of a long procedure (2026.4.50).
//
// One line per section (row lane) with its step count. Click centres the
// row on the canvas; the row holding the selected step is highlighted; the
// pencil renames the section (a lane name - nothing on the floor reads it).
// Shown only on procedure maps that have row lanes, i.e. maps the reverse
// compiler laid out in sections or that were re-flowed with Layout › Sections.

import { useState } from 'react';
import { useStore } from '../state/store.js';
import { nodeHeight } from '../utils/geometry.js';

export function SectionsOutline(): JSX.Element | null {
  const map = useStore(s => s.map);
  const selectedNodeIds = useStore(s => s.selectedNodeIds);
  const centreOnLane = useStore(s => s.centreOnLane);
  const updateLane = useStore(s => s.updateLane);
  const [open, setOpen] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  if (!map || map.kind !== 'procedure') return null;
  const rows = (map.lanes ?? []).filter(l => l.orientation === 'row').sort((a, b) => a.x - b.x);
  if (rows.length === 0) return null;

  const inRow = (lane: { x: number; width: number }, n: { y: number }) => n.y >= lane.x && n.y < lane.x + lane.width;
  const isStep = (n: { metadata?: unknown }) => !!(n.metadata as { guide?: unknown } | undefined)?.guide;
  const counts = rows.map(l => map.nodes.filter(n => isStep(n) && inRow(l, n)).length);
  const sel = selectedNodeIds.length ? map.nodes.find(n => n.id === selectedNodeIds[0]) : undefined;
  const currentId = sel ? rows.find(l => inRow(l, { y: sel.y + nodeHeight(sel) / 2 }))?.id : undefined;
  const total = counts.reduce((a, b) => a + b, 0);

  const commit = (id: string) => { const v = draft.trim(); if (v) updateLane(id, { name: v }); setEditing(null); };

  return (
    <aside className={`sections-outline ${open ? '' : 'collapsed'}`}>
      <div className="sections-head">
        <button className="btn ghost" title={open ? 'Collapse the outline' : 'Show the outline'} onClick={() => setOpen(!open)}>{open ? '‹' : '›'}</button>
        {open && <h3>Outline <span className="sections-total">{rows.length} sections · {total} steps</span></h3>}
      </div>
      {open && (
        <ol className="sections-list">
          {rows.map((l, i) => (
            <li key={l.id} className={l.id === currentId ? 'current' : ''}>
              {editing === l.id ? (
                <input autoFocus value={draft} onChange={e => setDraft(e.target.value)}
                       onBlur={() => commit(l.id)}
                       onKeyDown={e => { if (e.key === 'Enter') commit(l.id); if (e.key === 'Escape') setEditing(null); }} />
              ) : (
                <>
                  <button className="sections-jump" onClick={() => centreOnLane(l.id)} title="Scroll to this section">
                    <span className="sections-name">{l.name}</span>
                    <span className="sections-count">{counts[i]}</span>
                  </button>
                  <button className="btn ghost sections-rename" title="Rename section"
                          onClick={() => { setDraft(l.name); setEditing(l.id); }}>✎</button>
                </>
              )}
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}
