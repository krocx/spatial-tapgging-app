// Inspector.tsx — right-hand panel for whatever is selected:
//   node → text, layer type, status, milestone, notes, SIB link
//   edge → label, direction toggle
//   lane → name, width, remove
// Renders nothing when the selection is empty (canvas stays clutter-free).

import { useState } from 'react';
import type { MindmapNodeStatus, MindmapNodeReview } from '@spatial/shared';
import { useStore } from '../state/store.js';
import {
  NODE_COLORS, NODE_TYPE_LABELS, NODE_TYPES,
  STATUS_LABELS, NODE_STATUSES,
} from '../utils/colors.js';

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
      </aside>
    );
  }
  return null;
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

function NodePanel({ nodeId }: { nodeId: string }): JSX.Element | null {
  const node = useStore(s => s.map?.nodes.find(n => n.id === nodeId));
  const setNodeType = useStore(s => s.setNodeType);
  const setNodeStatus = useStore(s => s.setNodeStatus);
  const setNodeReview = useStore(s => s.setNodeReview);
  const toggleMilestone = useStore(s => s.toggleMilestone);
  const setNodeNotes = useStore(s => s.setNodeNotes);
  const updateNodeText = useStore(s => s.updateNodeText);
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

      <CommentsSection nodeId={node.id} />
    </aside>
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
