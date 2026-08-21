// App.tsx — shell: map list ⇄ editor. All state lives in the store.

import { useState, useEffect } from 'react';
import { useStore } from './state/store.js';
import { MapList } from './components/MapList.js';
import { Toolbar } from './components/Toolbar.js';
import { Inspector } from './components/Inspector.js';
import { FilterPanel } from './components/FilterPanel.js';
import { PresentationBar } from './components/PresentationBar.js';
import { GlossaryPanel } from './components/GlossaryPanel.js';
import { ProcedureBar } from './components/ProcedureBar.js';
import { PreviewPanel } from './components/PreviewPanel.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';
import { CanvasStage } from './canvas/CanvasStage.js';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts.js';

export default function App(): JSX.Element {
  const view = useStore(s => s.view);
  const error = useStore(s => s.error);
  const setError = useStore(s => s.setError);
  const presenting = useStore(s => s.presentation.active);
  const previewing = useStore(s => !!s.preview);
  useKeyboardShortcuts();

  // Deep link: /roadmap?map=<id> opens straight into that map — the portal's
  // "Edit in Designer" button lands here. Runs once; a bad id surfaces through
  // the store's normal error banner on the list view.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('map');
    if (id) {
      void useStore.getState().openMap(id, localStorage.getItem('roadmap-name') ?? 'Anonymous');
    }
  }, []);

  if (view === 'list') return <ErrorBoundary><MapList /></ErrorBoundary>;

  return (
    <ErrorBoundary>
    <div className="editor">
      {!presenting && <Toolbar />}
      {!presenting && <ProcedureBar />}
      {error && (
        <div className="error-banner floating" onClick={() => setError(null)}>
          {error} <span className="dismiss">✕</span>
        </div>
      )}
      <div className="editor-body">
        {!presenting && <FilterPanel />}
        <CanvasStage />
        {!presenting && <GlossaryPanel />}
        {/* Preview replaces the Inspector on the right while active — the
            walkthrough IS the selection during a rehearsal. */}
        {!presenting && !previewing && <Inspector />}
        {!presenting && <PreviewPanel />}
      </div>
      <PresentationBar />
      {!presenting && (
        <div className="hint-bar">
          double-click: add node · drag ring: connect · drag: marquee select · space+drag: pan ·
          scroll: zoom · enter: edit · del: remove · ⌘S save · ⌘Z undo · ⌘C/⌘V copy/paste · ⌘D duplicate
          <PlatformVersion />
        </div>
      )}
    </div>
    </ErrorBoundary>
  );
}

/** Platform version from /config — the single source of truth is
 *  PLATFORM_VERSION in sib/src/version.ts (see docs/VERSIONING.md). */
function PlatformVersion(): JSX.Element | null {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    fetch('/config').then(r => r.json())
      .then(cfg => { if (cfg.platformVersion) setVersion(cfg.platformVersion); })
      .catch(() => { /* footer stays version-less offline */ });
  }, []);
  if (!version) return null;
  return <span style={{ marginLeft: 12, opacity: 0.55 }}>v{version}</span>;
}
