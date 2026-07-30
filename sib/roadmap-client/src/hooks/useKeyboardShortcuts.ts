// useKeyboardShortcuts.ts — editor-wide keyboard handling.
//   Delete/Backspace  remove selection        Enter   edit selected node
//   Ctrl/Cmd+S        save                     Escape  deselect / stop editing
//   Ctrl/Cmd+Z        undo                     Ctrl/Cmd+Y or Shift+Z  redo

import { useEffect } from 'react';
import { useStore } from '../state/store.js';

export function useKeyboardShortcuts(): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const s = useStore.getState();
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      const mod = e.metaKey || e.ctrlKey;

      // Presentation mode captures navigation keys.
      if (s.presentation.active) {
        if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') {
          e.preventDefault(); s.presentationGoto(s.presentation.step + 1); return;
        }
        if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
          e.preventDefault(); s.presentationGoto(s.presentation.step - 1); return;
        }
        if (e.key === 'Escape') { e.preventDefault(); s.exitPresentation(); return; }
        return;   // suppress editing shortcuts while presenting
      }

      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void s.save();
        return;
      }
      if (typing) return;

      if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); s.undo(); return; }
      if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) {
        e.preventDefault(); s.redo(); return;
      }
      if (mod && e.key.toLowerCase() === 'c') { e.preventDefault(); s.copySelection(); return; }
      if (mod && e.key.toLowerCase() === 'v') { e.preventDefault(); s.pasteClipboard(); return; }
      if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); s.duplicateSelection(); return; }
      if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        useStore.setState({ selectedNodeIds: (s.map?.nodes ?? []).map(n => n.id), selectedEdgeId: null });
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); s.deleteSelection(); return; }
      if (e.key === 'Enter' && s.selectedNodeIds.length === 1) {
        e.preventDefault();
        s.setEditing(s.selectedNodeIds[0]);
        return;
      }
      if (e.key === 'Escape') {
        s.setEditing(null);
        s.select(null);
        s.selectEdge(null);
        s.selectLane(null);
        s.setPendingEdgeFrom(null);
        s.setSearchQuery('');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
}
