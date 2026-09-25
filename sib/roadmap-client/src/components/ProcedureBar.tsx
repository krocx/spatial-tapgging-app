// ProcedureBar.tsx - pre-flight strip and the send action for procedure maps.
//
// The census fields mirror the Guide Library graph header exactly (steps, next,
// on failure, requires, lanes) so the same numbers mean the same thing in both
// places. A single-lane graph is ambiguous on its own - it can mean "no
// branches drawn" or "the layout is wrong" - and these counts settle it.
//
// Sending never publishes: every new step arrives unplaced, and placement only
// happens on device. See docs/PROCEDURE-DESIGNER.md.

import { useEffect, useState } from 'react';
import type { Model3D, Anchor, ChamberConfig } from '@spatial/shared';
import { useStore } from '../state/store.js';
import { ROLE_COLORS } from '../canvas/EdgeView.js';
import { mindmapApi } from '../api/mindmap-api.js';
import { Icon } from './Icon.js';

/**
 * 2026.4.46: which chamber the procedure is sent to. A new map has no anchor,
 * and nobody knows anchor ids by heart - list the chambers by name, grouped
 * by configuration, and remember the last choice.
 */
function AnchorPicker({ value, onChange }: { value: string; onChange: (id: string) => void }): JSX.Element {
  const [anchors, setAnchors] = useState<Anchor[] | null>(null);
  const [configs, setConfigs] = useState<ChamberConfig[]>([]);
  useEffect(() => {
    let live = true;
    Promise.all([mindmapApi.listAnchors(), mindmapApi.listChamberConfigs().catch(() => [] as ChamberConfig[])])
      .then(([a, c]) => {
        if (!live) return;
        const chambers = a.filter(x => !x.anchorType || x.anchorType === 'QR')
          .sort((x, y) => (x.assetId ?? '').localeCompare(y.assetId ?? '', undefined, { sensitivity: 'base' }));
        setAnchors(chambers); setConfigs(c);
        const last = localStorage.getItem('procedure-anchor');
        if (!value && last && chambers.some(x => x.id === last)) onChange(last);
      })
      .catch(() => { if (live) setAnchors([]); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cfgName = (id?: string) => configs.find(c => c.id === id);
  const groups = new Map<string, Anchor[]>();
  for (const a of anchors ?? []) {
    const c = cfgName(a.configId);
    const key = c ? `${c.code} · ${c.name}` : 'No configuration';
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(a);
  }

  return (
    <select
      className="pc-anchor"
      value={value}
      disabled={anchors === null}
      onChange={e => { onChange(e.target.value); if (e.target.value) localStorage.setItem('procedure-anchor', e.target.value); }}
      title="Which chamber this procedure belongs to - the guide is created on it"
    >
      <option value="">{anchors === null ? 'loading chambers…' : anchors.length ? 'Send to chamber…' : 'No chambers yet - create one in the portal'}</option>
      {[...groups.entries()].map(([label, list]) => (
        <optgroup key={label} label={label}>
          {list.map(a => <option key={a.id} value={a.id}>{a.assetId || a.id.slice(0, 8)}</option>)}
        </optgroup>
      ))}
    </select>
  );
}

/**
 * 2026.4.46: the assembly this procedure builds up (or takes apart). Chosen
 * once per map; every step then picks its parts in the Inspector. Stored in
 * map settings so every collaborator sees the same model.
 */
function AssemblyPicker(): JSX.Element {
  const assembly       = useStore(s => s.map?.settings?.assembly);
  const updateSettings = useStore(s => s.updateSettings);
  const validate       = useStore(s => s.validateProcedure);
  const [models, setModels] = useState<Model3D[] | null>(null);

  useEffect(() => {
    let live = true;
    mindmapApi.listModels().then(m => { if (live) setModels(m.filter(x => x.hasGLB)); }).catch(() => { if (live) setModels([]); });
    return () => { live = false; };
  }, []);

  const set = (patch: { modelId?: string; start?: 'empty' | 'complete' } | null) => {
    if (patch === null) updateSettings({ assembly: undefined });
    else if (patch.modelId !== undefined && !patch.modelId) updateSettings({ assembly: undefined });
    else updateSettings({ assembly: { modelId: patch.modelId ?? assembly?.modelId ?? '', ...(assembly?.start === 'complete' || patch.start === 'complete' ? { start: patch.start ?? assembly?.start } : {}), ...(assembly?.initialNodes ? { initialNodes: assembly.initialNodes } : {}), ...(assembly?.groups && patch.modelId === undefined ? { groups: assembly.groups } : {}) } });
    void validate();
  };

  return (
    <span className="pc-assembly" title="The 3D assembly whose parts the steps install. Pick parts per step in the Inspector.">
      <Icon name="cube" size={13} /> Assembly
      <select
        value={assembly?.modelId ?? ''}
        disabled={models === null}
        onChange={e => set({ modelId: e.target.value })}
      >
        <option value="">{models === null ? 'loading…' : models.length ? 'none' : 'no models in library'}</option>
        {(models ?? []).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
        {assembly && models && !models.some(m => m.id === assembly.modelId) && (
          <option value={assembly.modelId}>{assembly.modelId} (not in library)</option>
        )}
      </select>
      {assembly && (
        <select value={assembly.start === 'complete' ? 'complete' : 'empty'} onChange={e => set({ start: e.target.value as 'empty' | 'complete' })}
          title="Build up: parts start hidden and each step installs its parts. Take apart: everything starts in place and each step removes its parts.">
          <option value="empty">build up</option>
          <option value="complete">take apart</option>
        </select>
      )}
    </span>
  );
}

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
  // Issues live in a collapsible drawer - 20+ warnings must never bury the
  // canvas. Collapsed by default; the count chip is the always-visible signal.
  const [showIssues, setShowIssues] = useState(false);

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
                the two paths, dashed amber for the gate - same rendering as
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
            <AssemblyPicker />
            <button
              className="pc-help"
              title="What do the connection types mean?"
              onClick={() => setShowHelp(v => !v)}
            >?</button>
          </>
        )}
        {busy && <span className="pc-stat pc-muted">checking…</span>}

        {(errors.length > 0 || warns.length > 0) && (
          <button
            className={`pc-issues-chip ${errors.length ? 'has-errors' : 'has-warns'}`}
            onClick={() => setShowIssues(v => !v)}
            title={showIssues ? 'Hide the issue list' : 'Show the issue list'}
          >
            {errors.length > 0 && <><Icon name="error" size={13} /> {errors.length}</>}
            {errors.length > 0 && warns.length > 0 && ' · '}
            {warns.length > 0 && <><Icon name="warning" size={13} /> {warns.length}</>}
            <span className="pc-chevron">{showIssues ? ' ▾' : ' ▸'}</span>
          </button>
        )}

        <span className="procedure-actions">
          {!map.anchorId && <AnchorPicker value={anchorId} onChange={setAnchorId} />}
          <button onClick={() => void validate()} disabled={busy}>Re-check</button>
          <button
            onClick={startPreview}
            disabled={previewing || !procedure?.order || Object.keys(procedure.order).length === 0}
            title="Walk through the procedure as the operator will experience it - nothing is saved or sent"
          >▶ Preview</button>
          <button
            className="primary"
            onClick={() => doSend(false)}
            disabled={!canSend}
            title={
              !procedure?.ok ? 'Fix the blocking problems first'
              : !map.anchorId && !anchorId.trim() ? 'Choose the chamber to send it to first'
              : 'Create or update a draft guide in the Guide Library'
            }
          >
            Send to Guide Library
          </button>
        </span>
      </div>

      {showHelp && (
        <div className="pc-help-panel" onClick={() => setShowHelp(false)}>
          <p><b style={{ color: ROLE_COLORS.next }}>Next step</b> - the operator's path: where they
            go after completing a step. Every step (except the last) has exactly one.</p>
          <p><b style={{ color: ROLE_COLORS.failure }}>On failure</b> - a recovery path, taken only
            if the step fails. Optional; can loop back to an earlier step.</p>
          <p><b style={{ color: ROLE_COLORS.requires }}>Requires</b> - a rule, not a path. The step
            it points at cannot start until the step it comes from is done. Nobody travels along
            it - use it only when the dependency isn't already enforced by the Next chain.</p>
          <p className="pc-help-dismiss">Click to dismiss</p>
        </div>
      )}

      {showIssues && (errors.length > 0 || warns.length > 0) && (
        <div className="procedure-issues-drawer">
          {errors.length > 0 && (
            <>
              <div className="pid-group-label">Blocking - fix before sending</div>
              <ul className="procedure-issues errors">
                {errors.map((i, n) => (
                  <li key={n} onClick={() => i.nodeId && select(i.nodeId)}>
                    <span className="pi-dot error" /> {i.message}
                  </li>
                ))}
              </ul>
            </>
          )}
          {warns.length > 0 && (
            <>
              <div className="pid-group-label">Warnings - sending still allowed</div>
              <ul className="procedure-issues warnings">
                {warns.map((i, n) => (
                  <li key={n} onClick={() => i.nodeId && select(i.nodeId)}>
                    <span className="pi-dot warning" /> {i.message}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
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
            <b>{sent.guideName}</b> updated - {sent.stepsCreated} created, {sent.stepsUpdated} updated
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
