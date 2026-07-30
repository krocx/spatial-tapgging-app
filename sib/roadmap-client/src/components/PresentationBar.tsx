// PresentationBar.tsx — minimal chrome during presentation mode: step title,
// progress dots, prev/next, exit. Arrow keys / Esc are handled by the
// keyboard hook; this bar mirrors them for mouse/touch use.

import { useStore } from '../state/store.js';

export function PresentationBar(): JSX.Element | null {
  const presentation = useStore(s => s.presentation);
  const presentationGoto = useStore(s => s.presentationGoto);
  const exitPresentation = useStore(s => s.exitPresentation);

  if (!presentation.active) return null;

  const { step, steps } = presentation;
  const current = steps[step];

  return (
    <div className="present-bar">
      <div className="present-title">
        <span className="present-step-name">{current?.name ?? ''}</span>
        <span className="present-progress">{step + 1} / {steps.length}</span>
      </div>
      <div className="present-dots">
        {steps.map((s, i) => (
          <button
            key={i}
            className={`present-dot ${i === step ? 'active' : ''}`}
            title={s.name}
            onClick={() => presentationGoto(i)}
          />
        ))}
      </div>
      <div className="present-controls">
        <button className="btn" disabled={step === 0} onClick={() => presentationGoto(step - 1)}>←</button>
        <button className="btn" disabled={step >= steps.length - 1} onClick={() => presentationGoto(step + 1)}>→</button>
        <button className="btn" onClick={exitPresentation} title="Esc">Exit</button>
      </div>
    </div>
  );
}
