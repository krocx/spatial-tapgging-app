// RolePicker.tsx — asks what a new connection MEANS on a procedure map.
//
// Appears the moment a connection is dropped, before the edge exists. Nothing
// is committed until a relationship is chosen: an edge with no role renders as
// a connection but is ignored by the compiler, so silently creating one would
// look like it worked and quietly drop the step from the guide.
//
// Colours match the Guide Library graph view exactly — what you draw here is
// what a reviewer sees there.

import { useEffect } from 'react';
import type { MindmapEdgeRole } from '@spatial/shared';
import { useStore } from '../state/store.js';
import { ROLE_COLORS } from '../canvas/EdgeView.js';

interface Choice {
  role:  MindmapEdgeRole;
  label: string;
  hint:  string;
  key:   string;
}

// Copy rewritten after non-developer feedback ("what's the difference between
// Requires and Next?"). The distinction that landed: Next/On failure are PATHS
// the operator travels; Requires is a RULE that blocks a step until another is
// done — nobody ever walks along a Requires arrow. Next is the default (Enter)
// because it is the right answer ~90% of the time.
const CHOICES: Choice[] = [
  { role: 'next',     label: 'Next step',
    hint: 'Where the operator goes after completing this step', key: '1' },
  { role: 'failure',  label: 'On failure',
    hint: 'Recovery path — only taken if this step fails', key: '2' },
  { role: 'requires', label: 'Requires first',
    hint: 'A rule, not a path: the target can’t start until this step is done. Use only when the dependency isn’t already on the path.', key: '3' },
];

export function RolePicker(): JSX.Element | null {
  const pending  = useStore(s => s.pendingRolePick);
  const confirm  = useStore(s => s.confirmEdgeRole);
  const cancel   = useStore(s => s.cancelEdgeRole);
  const map      = useStore(s => s.map);

  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { cancel(); return; }
      // Enter = Next step, the overwhelmingly common choice.
      if (e.key === 'Enter') { e.preventDefault(); confirm('next'); return; }
      const choice = CHOICES.find(c => c.key === e.key);
      if (choice) { e.preventDefault(); confirm(choice.role); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pending, confirm, cancel]);

  if (!pending || !map) return null;

  const from = map.nodes.find(n => n.id === pending.from);
  const to   = map.nodes.find(n => n.id === pending.to);

  return (
    <div className="role-picker-backdrop" onPointerDown={cancel}>
      <div className="role-picker" onPointerDown={e => e.stopPropagation()}>
        <div className="role-picker-head">
          <span className="role-picker-title">Connect as</span>
          <span className="role-picker-sub">
            {from?.text || 'step'} → {to?.text || 'step'}
          </span>
        </div>
        {CHOICES.map(c => (
          <button
            key={c.role}
            className={`role-picker-option ${c.role === 'requires' ? 'tertiary' : ''}`}
            onClick={() => confirm(c.role)}
          >
            <span className="role-swatch" style={{ background: ROLE_COLORS[c.role] }} />
            <span className="role-picker-labels">
              <span className="role-picker-label">{c.label}</span>
              <span className="role-picker-hint">{c.hint}</span>
            </span>
            <kbd>{c.role === 'next' ? '↵ / 1' : c.key}</kbd>
          </button>
        ))}
        <p className="role-picker-footnote">
          Picked wrong? Select the connection afterwards and change its type in the side panel.
        </p>
        <button className="role-picker-cancel" onClick={cancel}>Cancel (Esc)</button>
      </div>
    </div>
  );
}
