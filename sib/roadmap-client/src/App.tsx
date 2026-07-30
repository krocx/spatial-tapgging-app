// App.tsx — shell: map list ⇄ editor. All state lives in the store.

import { useStore } from './state/store.js';
import { MapList } from './components/MapList.js';
import { Toolbar } from './components/Toolbar.js';
import { Inspector } from './components/Inspector.js';
import { FilterPanel } from './components/FilterPanel.js';
import { PresentationBar } from './components/PresentationBar.js';
import { CanvasStage } from './canvas/CanvasStage.js';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts.js';

export default function App(): JSX.Element {
  const view = useStore(s => s.view);
  const error = useStore(s => s.error);
  const setError = useStore(s => s.setError);
  const presenting = useStore(s => s.presentation.active);
  useKeyboardShortcuts();

  if (view === 'list') return <MapList />;

  return (
    <div className="editor">
      {!presenting && <Toolbar />}
      {error && (
        <div className="error-banner floating" onClick={() => setError(null)}>
          {error} <span className="dismiss">✕</span>
        </div>
      )}
      <div className="editor-body">
        {!presenting && <FilterPanel />}
        <CanvasStage />
        {!presenting && <Inspector />}
      </div>
      <PresentationBar />
      {!presenting && (
        <div className="hint-bar">
          double-click: add node · drag ring: connect · drag: marquee select · space+drag: pan ·
          scroll: zoom · enter: edit · del: remove · ⌘S save · ⌘Z undo · ⌘C/⌘V copy/paste · ⌘D duplicate
        </div>
      )}
    </div>
  );
}
