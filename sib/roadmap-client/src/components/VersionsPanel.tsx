// VersionsPanel.tsx — dropdown listing version snapshots with one-click restore.

import { useEffect, useState } from 'react';
import type { MindmapVersion } from '@spatial/shared';
import { mindmapApi } from '../api/mindmap-api.js';
import { useStore } from '../state/store.js';

type VersionMeta = Omit<MindmapVersion, 'snapshot'>;

export function VersionsPanel({ onClose }: { onClose: () => void }): JSX.Element {
  const map = useStore(s => s.map);
  const restoreVersion = useStore(s => s.restoreVersion);
  const setError = useStore(s => s.setError);
  const [versions, setVersions] = useState<VersionMeta[] | null>(null);

  useEffect(() => {
    if (!map) return;
    mindmapApi.versions(map.id)
      .then(setVersions)
      .catch(err => setError((err as Error).message));
  }, [map?.id]);

  return (
    <div className="menu versions-menu">
      {versions === null && <div className="menu-note">Loading…</div>}
      {versions?.length === 0 && <div className="menu-note">No versions yet</div>}
      {versions?.map(v => (
        <button
          key={v.id}
          onClick={() => {
            if (confirm(`Restore "${v.label}" from ${new Date(v.createdAt).toLocaleString()}? Current state is snapshotted first.`)) {
              void restoreVersion(v.id);
              onClose();
            }
          }}
        >
          <span className="version-label">{v.label}</span>
          <span className="version-date">{new Date(v.createdAt).toLocaleString()}</span>
        </button>
      ))}
    </div>
  );
}
