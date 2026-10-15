// ResizeHandle.tsx - a drag edge that sizes a side panel (AROMS-329).
//
// The panel's width is a CSS variable on <html> (so CSS grid and flex rules
// read it), clamped between `min` (today's size) and `max`, remembered per
// browser. Double-click puts it back to the minimum. Keyboard: ← → when
// focused. Drawn as a 6 px strip on the panel's inner edge.

import { useEffect, useRef } from 'react';

interface Props {
  /** CSS variable to drive, e.g. '--inspector-w'. */
  cssVar: string;
  storageKey: string;
  min: number;
  max: number;
  /** Which edge of the panel the handle sits on: 'left' for a right-hand panel. */
  edge?: 'left' | 'right';
}

export function applyStoredWidth(cssVar: string, storageKey: string, min: number, max: number): void {
  try {
    const v = Number(localStorage.getItem(storageKey));
    if (v >= min && v <= max) document.documentElement.style.setProperty(cssVar, `${v}px`);
  } catch { /* storage unavailable */ }
}

export function ResizeHandle({ cssVar, storageKey, min, max, edge = 'left' }: Props): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => { applyStoredWidth(cssVar, storageKey, min, max); }, [cssVar, storageKey, min, max]);

  const set = (px: number) => {
    const w = Math.round(Math.min(max, Math.max(min, px)));
    document.documentElement.style.setProperty(cssVar, `${w}px`);
    try { localStorage.setItem(storageKey, String(w)); } catch { /* ignore */ }
    return w;
  };
  const current = () => {
    const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(cssVar));
    return Number.isFinite(v) && v > 0 ? v : min;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX, startW = current();
    const el = ref.current; el?.setPointerCapture(e.pointerId);
    document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none';
    const move = (ev: PointerEvent) => { const dx = ev.clientX - startX; set(edge === 'left' ? startW - dx : startW + dx); };
    const up = () => { document.body.style.cursor = ''; document.body.style.userSelect = ''; window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };

  return (
    <div ref={ref} className={`resize-handle resize-handle--${edge}`} role="separator" aria-orientation="vertical" tabIndex={0}
         title="Drag to resize · double-click to reset"
         onPointerDown={onPointerDown}
         onDoubleClick={() => set(min)}
         onKeyDown={e => { if (e.key === 'ArrowLeft') set(current() + (edge === 'left' ? 16 : -16)); if (e.key === 'ArrowRight') set(current() + (edge === 'left' ? -16 : 16)); }} />
  );
}
