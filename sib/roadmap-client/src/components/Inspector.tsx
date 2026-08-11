// Inspector.tsx — right-hand panel for whatever is selected:
//   node → text, layer type, status, milestone, notes, SIB link
//   edge → label, direction toggle
//   lane → name, width, remove
// Renders nothing when the selection is empty (canvas stays clutter-free).

import { useState, useEffect } from 'react';
import type { MindmapNodeStatus, MindmapNodeReview, MindmapNodeShape, Model3D } from '@spatial/shared';
import { useStore } from '../state/store.js';
import { mindmapApi, fetchStepImageUrl } from '../api/mindmap-api.js';
import {
  NODE_COLORS, NODE_TYPE_LABELS, NODE_TYPES,
  STATUS_LABELS, NODE_STATUSES,
} from '../utils/colors.js';
import { ICON_PATHS, ICON_NAMES } from '../utils/icons.js';
import { matchGlossary } from '../utils/glossary.js';
import { renderInline } from './GlossaryPanel.js';

const SHAPES: Array<{ value: MindmapNodeShape; label: string }> = [
  { value: 'rounded', label: 'Rounded' },
  { value: 'rect', label: 'Rect' },
  { value: 'pill', label: 'Pill' },
  { value: 'diamond', label: 'Diamond' },
  { value: 'hexagon', label: 'Hexagon' },
];

const REVIEW_OPTIONS: Array<{ value: MindmapNodeReview; label: string; cls: string }> = [
  { value: 'approved', label: '✓ Approve', cls: 'review-approve' },
  { value: 'rejected', label: '✗ Reject', cls: 'review-reject' },
  { value: 'needs-validation', label: '? Validate', cls: 'review-validate' },
];

export function Inspector(): JSX.Element | null {
  const map = useStore(s => s.map);
  const selectedNodeIds = useStore(s => s.selectedNodeIds);
  const selectedEdgeId = useStore(s => s.selectedEdgeId);
  const selectedLaneId = useStore(s => s.selectedLaneId);

  if (!map) return null;

  const node = selectedNodeIds.length === 1 ? map.nodes.find(n => n.id === selectedNodeIds[0]) : undefined;
  const edge = selectedEdgeId ? map.edges.find(e => e.id === selectedEdgeId) : undefined;
  const lane = selectedLaneId ? map.lanes?.find(l => l.id === selectedLaneId) : undefined;

  if (node) return <NodePanel key={node.id} nodeId={node.id} />;
  if (edge) return <EdgePanel key={edge.id} edgeId={edge.id} />;
  if (lane) return <LanePanel key={lane.id} laneId={lane.id} />;
  if (selectedNodeIds.length > 1) {
    return (
      <aside className="inspector">
        <h3>{selectedNodeIds.length} nodes selected</h3>
        <p className="inspector-hint">Drag to move together · ⌘C copy · ⌘D duplicate · Del remove</p>
        <BulkTypeRow />
        <GroupCreateRow />
      </aside>
    );
  }
  return null;
}

function GroupCreateRow(): JSX.Element {
  const createGroupFromSelection = useStore(s => s.createGroupFromSelection);
  const [name, setName] = useState('');
  return (
    <label className="inspector-field">Group selection
      <div className="group-create">
        <input
          value={name}
          placeholder="Group name…"
          onChange={e => setName(e.target.value)}
          onKeyDown={e => {
            e.stopPropagation();
            if (e.key === 'Enter' && name.trim()) { createGroupFromSelection(name); setName(''); }
          }}
        />
        <button
          className="btn primary"
          disabled={!name.trim()}
          onClick={() => { createGroupFromSelection(name); setName(''); }}
        >Group</button>
      </div>
    </label>
  );
}

function BulkTypeRow(): JSX.Element {
  const selectedNodeIds = useStore(s => s.selectedNodeIds);
  const setNodeType = useStore(s => s.setNodeType);
  const setNodeStatus = useStore(s => s.setNodeStatus);
  return (
    <>
      <label className="inspector-field">Set type
        <div className="type-row">
          {NODE_TYPES.map(t => (
            <button key={t} className="swatch" style={{ background: NODE_COLORS[t] }} title={NODE_TYPE_LABELS[t]}
                    onClick={() => selectedNodeIds.forEach(id => setNodeType(id, t))} />
          ))}
        </div>
      </label>
      <label className="inspector-field">Set status
        <select defaultValue="" onChange={e => {
          const v = e.target.value as MindmapNodeStatus | '';
          selectedNodeIds.forEach(id => setNodeStatus(id, v === '' ? undefined : v));
        }}>
          <option value="">(none)</option>
          {NODE_STATUSES.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
        </select>
      </label>
    </>
  );
}

/** Miniature shape preview for the picker. */
function ShapeGlyph({ shape }: { shape: MindmapNodeShape }): JSX.Element {
  const props = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6 };
  return (
    <svg viewBox="0 0 26 16" width={24} height={15}>
      {shape === 'rounded' && <rect x={2} y={2} width={22} height={12} rx={4} {...props} />}
      {shape === 'rect' && <rect x={2} y={2} width={22} height={12} rx={1} {...props} />}
      {shape === 'pill' && <rect x={2} y={2} width={22} height={12} rx={6} {...props} />}
      {shape === 'diamond' && <polygon points="13,1 25,8 13,15 1,8" {...props} />}
      {shape === 'hexagon' && <polygon points="7,2 19,2 24,8 19,14 7,14 2,8" {...props} />}
    </svg>
  );
}

function NodePanel({ nodeId }: { nodeId: string }): JSX.Element | null {
  const node = useStore(s => s.map?.nodes.find(n => n.id === nodeId));
  const setNodeType = useStore(s => s.setNodeType);
  const setNodeStatus = useStore(s => s.setNodeStatus);
  const setNodeReview = useStore(s => s.setNodeReview);
  const toggleMilestone = useStore(s => s.toggleMilestone);
  const setNodeNotes = useStore(s => s.setNodeNotes);
  const updateNodeText = useStore(s => s.updateNodeText);
  const setNodeShape = useStore(s => s.setNodeShape);
  const setNodeIcon = useStore(s => s.setNodeIcon);
  const setNodeLink = useStore(s => s.setNodeLink);
  if (!node) return null;

  const sib = node.metadata?.sib as { kind?: string; id?: string } | undefined;

  return (
    <aside className="inspector">
      <h3>Node</h3>

      <label className="inspector-field">Text
        <input defaultValue={node.text} onBlur={e => {
          if (e.target.value.trim() !== node.text) updateNodeText(node.id, e.target.value.trim());
        }} />
      </label>

      <label className="inspector-field">Layer type
        <div className="type-row">
          {NODE_TYPES.map(t => (
            <button
              key={t}
              className={`swatch ${node.type === t ? 'active' : ''}`}
              style={{ background: NODE_COLORS[t] }}
              title={NODE_TYPE_LABELS[t]}
              onClick={() => setNodeType(node.id, t)}
            />
          ))}
        </div>
      </label>

      <label className="inspector-field">Status
        <select
          value={node.status ?? ''}
          onChange={e => setNodeStatus(node.id, (e.target.value || undefined) as MindmapNodeStatus | undefined)}
        >
          <option value="">(none)</option>
          {NODE_STATUSES.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
        </select>
      </label>

      <label className="inspector-check">
        <input type="checkbox" checked={!!node.milestone} onChange={() => toggleMilestone(node.id)} />
        Milestone
      </label>

      <label className="inspector-field">Review
        <div className="review-row">
          {REVIEW_OPTIONS.map(o => (
            <button
              key={o.value}
              className={`review-btn ${o.cls} ${node.review === o.value ? 'active' : ''}`}
              title={o.value === node.review ? 'Click to clear' : o.value}
              onClick={() => setNodeReview(node.id, node.review === o.value ? undefined : o.value)}
            >
              {o.label}
            </button>
          ))}
        </div>
      </label>

      <label className="inspector-field">Shape
        <div className="shape-row">
          {SHAPES.map(s => (
            <button
              key={s.value}
              className={`shape-btn ${(node.shape ?? 'rounded') === s.value ? 'active' : ''}`}
              title={s.label}
              onClick={() => setNodeShape(node.id, s.value)}
            >
              <ShapeGlyph shape={s.value} />
            </button>
          ))}
        </div>
      </label>

      <label className="inspector-field">Icon
        <div className="icon-grid">
          <button
            className={`icon-btn ${!node.icon ? 'active' : ''}`}
            title="No icon"
            onClick={() => setNodeIcon(node.id, undefined)}
          >∅</button>
          {ICON_NAMES.map(name => (
            <button
              key={name}
              className={`icon-btn ${node.icon === name ? 'active' : ''}`}
              title={name}
              onClick={() => setNodeIcon(node.id, name)}
            >
              <svg viewBox="0 0 24 24" width={15} height={15}>
                <path d={ICON_PATHS[name]} fill="none" stroke="currentColor" strokeWidth={2}
                      strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          ))}
        </div>
      </label>

      <label className="inspector-field">Link
        <input
          defaultValue={node.link ?? ''}
          placeholder="https://…"
          onBlur={e => { if (e.target.value.trim() !== (node.link ?? '')) setNodeLink(node.id, e.target.value); }}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        />
      </label>

      <label className="inspector-field">Notes
        <textarea
          defaultValue={node.notes ?? ''}
          rows={5}
          placeholder="Free-form notes…"
          onBlur={e => { if (e.target.value !== (node.notes ?? '')) setNodeNotes(node.id, e.target.value); }}
        />
      </label>

      {sib?.id && (
        <div className="sib-link" title={sib.id}>
          Linked to SIB {sib.kind}: <code>{sib.id.slice(0, 12)}…</code>
        </div>
      )}

      <StepSection nodeId={node.id} />

      <DictionaryBlock nodeText={node.text} />

      <CommentsSection nodeId={node.id} />
    </aside>
  );
}

/**
 * Procedure-map step fields: voice script, optional toggle, reference image
 * and 3D model assignment. Renders only on `kind: 'procedure'` maps; writes to
 * node.metadata.step, which the compiler reads at export.
 *
 * Hooks are unconditional and the bail-out sits below them — the exact
 * pattern whose violation in Minimap blanked the app (React #310).
 */
function StepSection({ nodeId }: { nodeId: string }): JSX.Element | null {
  const isProcedure = useStore(s => s.map?.kind === 'procedure');
  const step = useStore(s =>
    (s.map?.nodes.find(n => n.id === nodeId)?.metadata?.step ?? {}) as {
      ttsText?: string; optional?: boolean; imageFile?: string;
      modelId?: string; modelScale?: number;
    });
  const patchStepMeta = useStore(s => s.patchStepMeta);

  const [models, setModels]     = useState<Model3D[] | null>(null);
  const [preview, setPreview]   = useState<string | null>(null);
  const [busy, setBusy]         = useState<string | null>(null);

  // Model list: once per panel mount, only on procedure maps.
  useEffect(() => {
    if (!isProcedure || models !== null) return;
    mindmapApi.listModels()
      .then(setModels)
      .catch(() => setModels([]));   // picker degrades to "unavailable"
  }, [isProcedure, models]);

  // Image preview: fetched with auth → blob URL (an <img src> can't send keys).
  useEffect(() => {
    if (!step.imageFile) { setPreview(null); return; }
    let url: string | null = null;
    let cancelled = false;
    fetchStepImageUrl(step.imageFile)
      .then(u => { if (cancelled) URL.revokeObjectURL(u); else { url = u; setPreview(u); } })
      .catch(() => setPreview(null));
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [step.imageFile]);

  if (!isProcedure) return null;

  /** Downscale to ≤1024px JPEG before upload — keeps the store and AR panels light. */
  const attachImage = (file: File) => {
    setBusy('image');
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 1024 / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width  = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(img.src);
      const base64 = canvas.toDataURL('image/jpeg', 0.82).split(',')[1];
      mindmapApi.uploadStepImage(base64)
        .then(r => patchStepMeta(nodeId, { imageFile: r.filename }))
        .catch(err => useStore.getState().setError((err as Error).message))
        .finally(() => setBusy(null));
    };
    img.onerror = () => { URL.revokeObjectURL(img.src); setBusy(null); };
    img.src = URL.createObjectURL(file);
  };

  const selectedModel = models?.find(m => m.id === step.modelId);

  return (
    <div className="step-section">
      <h3>Step (procedure)</h3>

      <label className="inspector-field">Voice script
        <textarea
          rows={2}
          placeholder="Spoken instruction — defaults to the step text"
          defaultValue={step.ttsText ?? ''}
          key={`tts-${nodeId}`}
          onBlur={e => patchStepMeta(nodeId, { ttsText: e.target.value.trim() || null })}
        />
      </label>

      <label className="step-check">
        <input
          type="checkbox"
          checked={step.optional === true}
          onChange={e => patchStepMeta(nodeId, { optional: e.target.checked ? true : null })}
        />
        Optional step <span className="step-check-hint">— operator may skip it</span>
      </label>

      <div className="inspector-field">Reference image
        {preview && <img className="step-image-preview" src={preview} alt="Step reference" />}
        <div className="step-row">
          <label className="btn file-btn">
            {busy === 'image' ? 'Uploading…' : step.imageFile ? 'Replace…' : 'Attach…'}
            <input
              type="file" accept="image/*" hidden
              disabled={busy === 'image'}
              onChange={e => { const f = e.target.files?.[0]; if (f) attachImage(f); e.target.value = ''; }}
            />
          </label>
          {step.imageFile && (
            <button className="btn" onClick={() => patchStepMeta(nodeId, { imageFile: null })}>Remove</button>
          )}
        </div>
      </div>

      <label className="inspector-field">3D model
        <select
          value={step.modelId ?? ''}
          disabled={models === null}
          onChange={e => {
            const id = e.target.value;
            if (!id) { patchStepMeta(nodeId, { modelId: null, modelScale: null }); return; }
            const m = models?.find(x => x.id === id);
            // Assignment only — offsets/rotation are placed in AR on device.
            patchStepMeta(nodeId, { modelId: id, modelScale: m?.defaultScale ?? 1 });
          }}
        >
          <option value="">— none —</option>
          {(models ?? []).map(m => (
            <option key={m.id} value={m.id}>
              {m.name}{m.usdzStatus && m.usdzStatus !== 'ready' ? ' (USDZ pending)' : ''}
            </option>
          ))}
        </select>
      </label>

      {selectedModel && (
        <label className="inspector-field">Model scale
          <input
            type="number" min={0.01} step={0.05}
            defaultValue={step.modelScale ?? selectedModel.defaultScale ?? 1}
            key={`scale-${nodeId}-${step.modelId}`}
            onBlur={e => {
              const v = parseFloat(e.target.value);
              if (isFinite(v) && v > 0) patchStepMeta(nodeId, { modelScale: v });
            }}
          />
        </label>
      )}

      <p className="step-note">
        Position in AR (pin + model placement) is done on device after sending
        to the Guide Library — never from the canvas.
      </p>
    </div>
  );
}

/** Contextual dictionary lookup — shows the glossary entry matching the node. */
function DictionaryBlock({ nodeText }: { nodeText: string }): JSX.Element | null {
  const glossary = useStore(s => s.glossary);
  const openGlossary = useStore(s => s.openGlossary);
  if (!glossary) return null;

  const entry = matchGlossary(nodeText, glossary);
  if (!entry) return null;

  return (
    <div className="dict-block">
      <div className="dict-head">
        <span className="dict-term">📖 {renderInline(entry.term)}</span>
      </div>
      <p className="dict-def">{renderInline(entry.definition)}</p>
      <button className="btn ghost dict-more" onClick={() => openGlossary(entry.term)}>
        Read in dictionary →
      </button>
    </div>
  );
}

function CommentsSection({ nodeId }: { nodeId: string }): JSX.Element {
  const comments = useStore(s => s.map?.nodes.find(n => n.id === nodeId)?.comments) ?? [];
  const addComment = useStore(s => s.addComment);
  const deleteComment = useStore(s => s.deleteComment);
  const [draft, setDraft] = useState('');

  const submit = () => {
    if (draft.trim()) { addComment(nodeId, draft); setDraft(''); }
  };

  return (
    <div className="comments">
      <h4>Comments {comments.length > 0 && <span className="comment-count">({comments.length})</span>}</h4>
      {comments.map(c => (
        <div key={c.id} className="comment">
          <div className="comment-head">
            <span className="comment-author">{c.author}</span>
            <span className="comment-date">{new Date(c.createdAt).toLocaleString()}</span>
            <button className="comment-delete" title="Delete comment"
                    onClick={() => deleteComment(nodeId, c.id)}>✕</button>
          </div>
          <div className="comment-text">{c.text}</div>
        </div>
      ))}
      <div className="comment-compose">
        <textarea
          rows={2}
          value={draft}
          placeholder="Add a comment…"
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); }
            e.stopPropagation();
          }}
        />
        <button className="btn primary comment-send" disabled={!draft.trim()} onClick={submit}>
          Comment
        </button>
      </div>
    </div>
  );
}

function EdgePanel({ edgeId }: { edgeId: string }): JSX.Element | null {
  const edge = useStore(s => s.map?.edges.find(e => e.id === edgeId));
  const setEdgeLabel = useStore(s => s.setEdgeLabel);
  const toggleEdgeType = useStore(s => s.toggleEdgeType);
  if (!edge) return null;

  return (
    <aside className="inspector">
      <h3>Edge</h3>
      <label className="inspector-field">Label
        <input
          defaultValue={edge.label ?? ''}
          placeholder="e.g. depends on"
          onBlur={e => { if (e.target.value.trim() !== (edge.label ?? '')) setEdgeLabel(edge.id, e.target.value); }}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        />
      </label>
      <label className="inspector-field">Direction
        <button className="btn" onClick={() => toggleEdgeType(edge.id)}>
          {edge.type === 'directed' ? '→ Directed' : '— Undirected'}
        </button>
      </label>
      <p className="inspector-hint">Tip: double-click an edge on the canvas to flip its direction.</p>
    </aside>
  );
}

function LanePanel({ laneId }: { laneId: string }): JSX.Element | null {
  const lane = useStore(s => s.map?.lanes?.find(l => l.id === laneId));
  const updateLane = useStore(s => s.updateLane);
  const removeLane = useStore(s => s.removeLane);
  if (!lane) return null;

  return (
    <aside className="inspector">
      <h3>Lane</h3>
      <label className="inspector-field">Name
        <input defaultValue={lane.name}
               onBlur={e => { if (e.target.value.trim() && e.target.value.trim() !== lane.name) updateLane(lane.id, { name: e.target.value.trim() }); }}
               onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
      </label>
      <label className="inspector-field">Width
        <input type="number" min={80} step={40} defaultValue={lane.width}
               onBlur={e => { const w = Number(e.target.value); if (w >= 80 && w !== lane.width) updateLane(lane.id, { width: w }); }} />
      </label>
      <button className="btn danger" onClick={() => removeLane(lane.id)}>Remove lane</button>
    </aside>
  );
}
