// PreviewPanel.tsx — the "run it before you ship it" walkthrough.
//
// A phone-frame panel that simulates the operator's AR session step by step:
// title, instruction body, reference image, voice playback (browser speech
// synthesis — same text the device will speak), and Complete/Failed buttons
// that traverse the REAL edge graph. The canvas behind highlights the current
// node (NodeView reads store.preview) and the camera follows the walk.
//
// Nothing here saves, sends or publishes — it is a rehearsal. Traversal rules
// live in store.previewGo and mirror the compiler + iOS runtime; this file is
// presentation only.

import { useState, useEffect } from 'react';
import { useStore } from '../state/store.js';
import { fetchStepImageUrl } from '../api/mindmap-api.js';

export function PreviewPanel(): JSX.Element | null {
  const map        = useStore(s => s.map);
  const preview    = useStore(s => s.preview);
  const procedure  = useStore(s => s.procedure);
  const exit       = useStore(s => s.exitPreview);
  const restart    = useStore(s => s.startPreview);
  const go         = useStore(s => s.previewGo);
  const jumpToReq  = useStore(s => s.previewJumpToRequired);

  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);

  const node = map?.nodes.find(n => n.id === preview?.currentId);
  const step = (node?.metadata?.step ?? {}) as {
    ttsText?: string; imageFile?: string; linkUrl?: string; optional?: boolean;
  };

  // Reference image → authenticated fetch → blob URL (as in the Inspector).
  useEffect(() => {
    if (!step.imageFile) { setImageUrl(null); return; }
    let url: string | null = null;
    let cancelled = false;
    fetchStepImageUrl(step.imageFile)
      .then(u => { if (cancelled) URL.revokeObjectURL(u); else { url = u; setImageUrl(u); } })
      .catch(() => setImageUrl(null));
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [step.imageFile]);

  // Stop any speech when the step changes or the panel closes.
  useEffect(() => () => { window.speechSynthesis?.cancel(); setSpeaking(false); }, [preview?.currentId]);

  if (!map || !preview) return null;

  const order   = procedure?.order ?? {};
  const total   = Object.keys(order).length;
  const seq     = node ? order[node.id] : undefined;
  const body    = (node?.notes ?? '').trim() || (node?.text ?? '');
  const nextEdge = map.edges.find(e => e.from === preview.currentId && e.role === 'next');
  const failEdge = map.edges.find(e => e.from === preview.currentId && e.role === 'failure');
  const nameOf = (id: string | undefined) =>
    map.nodes.find(n => n.id === id)?.text || 'step';
  const blockedByName = preview.blockedBy ? nameOf(preview.blockedBy) : null;

  const speak = () => {
    const synth = window.speechSynthesis;
    if (!synth) return;
    if (speaking) { synth.cancel(); setSpeaking(false); return; }
    // Exactly what the device speaks: the voice script, else the body text.
    const u = new SpeechSynthesisUtterance(step.ttsText?.trim() || body);
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    synth.cancel();
    synth.speak(u);
    setSpeaking(true);
  };

  // ── Finished: coverage summary ─────────────────────────────────────────────
  if (preview.done) {
    const visitedSet = new Set(preview.visited);
    const unvisited = Object.entries(order)
      .filter(([id]) => !visitedSet.has(id))
      .sort((a, b) => a[1] - b[1]);
    return (
      <aside className="preview-panel">
        <div className="preview-head">
          <span className="preview-title">Preview — complete</span>
          <button className="preview-exit" onClick={exit}>✕</button>
        </div>
        <div className="preview-phone">
          <div className="preview-screen preview-summary">
            <p className="preview-done-mark">✓</p>
            <p><b>{preview.visited.length}</b> of <b>{total}</b> steps walked.</p>
            {unvisited.length > 0 ? (
              <>
                <p className="preview-warn">Never visited on this run:</p>
                <ul>
                  {unvisited.map(([id, s]) => <li key={id}>Step {s} — {nameOf(id)}</li>)}
                </ul>
                <p className="preview-hint-text">
                  Steps on failure branches only appear when you press ✗ — run
                  again and fail the branching step to rehearse the recovery path.
                </p>
              </>
            ) : (
              <p className="preview-hint-text">Every step was covered. Nice.</p>
            )}
          </div>
        </div>
        <div className="preview-actions">
          <button onClick={restart}>↺ Run again</button>
          <button className="primary" onClick={exit}>Done</button>
        </div>
      </aside>
    );
  }

  // ── Blocked by an unmet prerequisite ───────────────────────────────────────
  const blocked = !!preview.blockedBy;

  return (
    <aside className="preview-panel">
      <div className="preview-head">
        <span className="preview-title">Preview</span>
        <span className="preview-progress">{seq ?? '–'} / {total}</span>
        <button className="preview-exit" title="Exit preview" onClick={exit}>✕</button>
      </div>

      <div className="preview-phone">
        <div className="preview-screen">
          <div className="preview-step-head">
            {seq !== undefined && <span className="preview-seq">{seq}</span>}
            <span className="preview-step-title">{node?.text || 'Step'}</span>
          </div>

          {blocked ? (
            <div className="preview-blocked">
              <p>⛔ This step requires <b>{blockedByName}</b> to be completed first.</p>
              <p className="preview-hint-text">
                On device the operator is redirected to the prerequisite — same here.
              </p>
              <button className="primary" onClick={jumpToReq}>Go to “{blockedByName}”</button>
            </div>
          ) : (
            <>
              {imageUrl && <img className="preview-image" src={imageUrl} alt="Step reference" />}
              <p className="preview-body">{body || <i>No instruction text.</i>}</p>
              <div className="preview-chips">
                {'speechSynthesis' in window && (
                  <button className="preview-chip" onClick={speak}>
                    {speaking ? '⏹ Stop voice' : '▶ Play voice'}
                  </button>
                )}
                {step.linkUrl && (
                  <a className="preview-chip" href={step.linkUrl} target="_blank" rel="noopener noreferrer">
                    📎 Reference
                  </a>
                )}
                {step.optional && <span className="preview-chip muted">Optional step</span>}
              </div>
            </>
          )}
        </div>
      </div>

      {!blocked && (
        <div className="preview-actions column">
          <button className="preview-complete" onClick={() => go('next')}>
            Complete ✓ {nextEdge ? `→ ${nameOf(nextEdge.to)}` : '→ Finish'}
          </button>
          {failEdge && (
            <button className="preview-fail" onClick={() => go('failure')}>
              Failed ✗ → {nameOf(failEdge.to)}
            </button>
          )}
        </div>
      )}
      <p className="preview-footnote">Rehearsal only — nothing is saved or sent.</p>
    </aside>
  );
}
