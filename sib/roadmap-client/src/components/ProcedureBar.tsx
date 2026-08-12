// ProcedureBar.tsx — pre-flight strip and the send action for procedure maps.
//
// The census fields mirror the Guide Library graph header exactly (steps, next,
// on failure, requires, lanes) so the same numbers mean the same thing in both
// places. A single-lane graph is ambiguous on its own — it can mean "no
// branches drawn" or "the layout is wrong" — and these counts settle it.
//
// Sending never publishes: every new step arrives unplaced, and placement only
// happens on device. See docs/PROCEDURE-DESIGNER.md.

import { useState } from 'react';
import { useStore } from '../state/store.js';
import { ROLE_COLORS } from '../canvas/EdgeView.js';

export function ProcedureBar(): JSX.Element | null {
  const map        = useStore(s => s.map);
  const procedure  = useStore(s => s.procedure);
  const busy       = useStore(s => s.procedureBusy);
  const sent       = useStore(s => s.procedureSent);
  const conflict   = useStore(s => s.procedurePublishedConflict);
  const validate   = useStore(s => s.validateProcedure);
  const send       = useStore(s => s.sendToGuideLibrary);
  const dismiss    = useStore(s => s.dismissProcedureSent);
  const select     = useStore(s => s.select);

  const startPreview = useStore(s => s.startPreview);
  const previewing   = useStore(s => !!s.preview);

  const [anchorId, setAnchorId] = useState('');
  const [showHelp, setShowHelp] = useState(false);

  if (!map || map.kind !== 'procedure') return null;

  const author  = localStorage.getItem('roadmap-name') ?? 'Anonymous';
  const errors  = procedure?.issues.filter(i => i.level === 'error')   ?? [];
  const warns   = procedure?.issues.filter(i => i.level === 'warning') ?? [];
  const c       = procedure?.census;
  const canSend = !!procedure?.ok && !busy && (!!map.anchorId || !!anchorId.trim());

  const doSend = (confirmUnpublish = false) =>
    void send({ anchorId: anchorId.trim() || undefined, createdBy: author, confirmUnpublish });

  return (
    <div className="procedure-bar">
      <div className="procedure-census">
        <span className="pc-badge">Procedure</span>
        {c && (
          <>
            <span className="pc-stat">steps <b>{c.steps}</b></span>
            {/* Line swatches double as the canvas legend: solid green/red for
                the two paths, dashed amber for the gate — same rendering as
                the edges themselves and the portal graph. */}
            <span className="pc-stat" style={{ color: ROLE_COLORS.next }}>
              <span className="pc-line" style={{ background: ROLE_COLORS.next }} />next <b>{c.next}</b>
            </span>
            <span className="pc-stat" style={{ color: ROLE_COLORS.failure }}>
              <span className="pc-line" style={{ background: ROLE_COLORS.failure }} />on failure <b>{c.failure}</b>
            </span>
            <span className="pc-stat" style={{ color: ROLE_COLORS.requires }}>
              <span className="pc-line dashed" style={{ color: ROLE_COLORS.requires }} />requires <b>{c.requires}</b>
            </span>
            <span className="pc-stat">lanes <b>{c.lanes}</b></span>
            <button
              className="pc-help"
              title="What do the connection types mean?"
              onClick={() => setShowHelp(v => !v)}
            >?</button>
          </>
        )}
        {busy && <span className="pc-stat pc-muted">checking…</span>}

        <span className="procedure-actions">
          {!map.anchorId && (
            <input
              className="pc-anchor"
              placeholder="Anchor id"
              value={anchorId}
              onChange={e => setAnchorId(e.target.value)}
              title="Which anchor this procedure belongs to"
            />
          )}
          <button onClick={() => void validate()} disabled={busy}>Re-check</button>
          <button
            onClick={startPreview}
            disabled={previewing || !procedure?.order || Object.keys(procedure.order).length === 0}
            title="Walk through the procedure as the operator will experience it — nothing is saved or sent"
          >▶ Preview</button>
          <button
            className="primary"
            onClick={() => doSend(false)}
            disabled={!canSend}
            title={
              procedure?.ok
                ? 'Create or update a draft guide in the Guide Library'
                : 'Fix the blocking problems first'
            }
          >
            Send to Guide Library
          </button>
        </span>
      </div>

      {showHelp && (
        <div className="pc-help-panel" onClick={() => setShowHelp(false)}>
          <p><b style={{ color: ROLE_COLORS.next }}>Next step</b> — the operator's path: where they
            go after completing a step. Every step (except the last) has exactly one.</p>
          <p><b style={{ color: ROLE_COLORS.failure }}>On failure</b> — a recovery path, taken only
            if the step fails. Optional; can loop back to an earlier step.</p>
          <p><b style={{ color: ROLE_COLORS.requires }}>Requires</b> — a rule, not a path. The step
            it points at cannot start until the step it comes from is done. Nobody travels along
            it — use it only when the dependency isn't already enforced by the Next chain.</p>
          <p className="pc-help-dismiss">Click to dismiss</p>
        </div>
      )}

      {errors.length > 0 && (
        <ul className="procedure-issues errors">
          {errors.map((i, n) => (
            <li key={n} onClick={() => i.nodeId && select(i.nodeId)}>
              <span className="pi-dot error" /> {i.message}
            </li>
          ))}
        </ul>
      )}

      {errors.length === 0 && warns.length > 0 && (
        <ul className="procedure-issues warnings">
          {warns.map((i, n) => (
            <li key={n} onClick={() => i.nodeId && select(i.nodeId)}>
              <span className="pi-dot warning" /> {i.message}
            </li>
          ))}
        </ul>
      )}

      {conflict && (
        <div className="procedure-conflict">
          <p>{conflict}</p>
          <div>
            <button onClick={() => { dismiss(); doSend(true); }}>Unpublish and update</button>
            <button onClick={dismiss}>Cancel</button>
          </div>
        </div>
      )}

      {sent && (
        <div className="procedure-sent">
          <p>
            <b>{sent.guideName}</b> updated — {sent.stepsCreated} created, {sent.stepsUpdated} updated
            {sent.stepsRemoved > 0 && `, ${sent.stepsRemoved} removed`}.
          </p>
          {sent.stepsUnplaced > 0 && (
            <p className="ps-next">
              Next: open the guide on iOS to place {sent.stepsUnplaced} step
              {sent.stepsUnplaced === 1 ? '' : 's'} in AR, then publish it.
            </p>
          )}
          <button onClick={dismiss}>Dismiss</button>
        </div>
      )}
    </div>
  );
}
