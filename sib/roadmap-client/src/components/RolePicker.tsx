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

const CHOICES: Choice[] = [
  { role: 'next',     label: 'Next step',     hint: 'Continue here when the step succeeds', key: '1' },
  { role: 'failure',  label: 'On failure',    hint: 'Recovery path when the step fails',    key: '2' },
  { role: 'requires', label: 'Requires first', hint: 'Target cannot start until this is done', key: '3' },
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
            className="role-picker-option"
            onClick={() => confirm(c.role)}
          >
            <span className="role-swatch" style={{ background: ROLE_COLORS[c.role] }} />
            <span className="role-picker-labels">
              <span className="role-picker-label">{c.label}</span>
              <span className="role-picker-hint">{c.hint}</span>
            </span>
            <kbd>{c.key}</kbd>
          </button>
        ))}
        <button className="role-picker-cancel" onClick={cancel}>Cancel (Esc)</button>
      </div>
    </div>
  );
}
