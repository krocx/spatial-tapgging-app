// ImageImportPreview.tsx — modal shown after a whiteboard/screenshot has been
// parsed by the local vision model: rendered graph preview, extraction stats,
// warnings, editable name → "Create draft" or discard.

import { useMemo, useState } from 'react';
import type { Mindmap } from '@spatial/shared';
import { useStore } from '../state/store.js';
import { buildSvg } from '../utils/export.js';

export function ImageImportPreview(): JSX.Element | null {
  const preview = useStore(s => s.imagePreview);
  const discardImagePreview = useStore(s => s.discardImagePreview);
  const createFromImagePreview = useStore(s => s.createFromImagePreview);
  const [name, setName] = useState('');

  const svgDataUrl = useMemo(() => {
    if (!preview) return '';
    const fake: Mindmap = {
      id: 'preview', name: preview.name, createdAt: 0, updatedAt: 0,
      nodes: preview.nodes, edges: preview.edges, lanes: preview.lanes,
    };
    return `data:image/svg+xml;utf8,${encodeURIComponent(buildSvg(fake))}`;
  }, [preview]);

  if (!preview) return null;

  return (
    <div className="modal-backdrop" onClick={discardImagePreview}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3>Preview — extracted by {preview.model}</h3>
        <p className="modal-stats">
          {preview.nodes.length} nodes · {preview.edges.length} edges
          {preview.lanes.length > 0 ? ` · ${preview.lanes.length} lanes` : ''}
        </p>

        <div className="preview-frame">
          <img src={svgDataUrl} alt="Extracted mind-map preview" />
        </div>

        {preview.warnings.length > 0 && (
          <ul className="preview-warnings">
            {preview.warnings.slice(0, 5).map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        )}

        <label className="inspector-field">Map name
          <input
            value={name}
            placeholder={preview.name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') void createFromImagePreview(name); }}
          />
        </label>

        <div className="modal-actions">
          <button className="btn" onClick={discardImagePreview}>Discard</button>
          <button className="btn primary" onClick={() => void createFromImagePreview(name)}>
            Create draft
          </button>
        </div>
        <p className="modal-hint">
          Creates a private draft — tidy it up (Layout, Style, lanes), then publish when ready.
        </p>
      </div>
    </div>
  );
}
