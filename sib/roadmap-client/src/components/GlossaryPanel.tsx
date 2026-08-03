// GlossaryPanel.tsx — the in-app roadmap dictionary (📖): right-side panel
// grouped by section with search; can be opened focused on a specific term
// (from the inspector's "Read more"), which scrolls to and highlights it.

import { useEffect, useMemo, useRef, useState, Fragment } from 'react';
import { useStore } from '../state/store.js';

/** Minimal inline-markdown renderer: **bold**, *italic*, `code`, [text](url) → text. */
export function renderInline(text: string): JSX.Element {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g);
  return (
    <>
      {parts.map((p, i) => {
        if (p.startsWith('**') && p.endsWith('**')) return <strong key={i}>{p.slice(2, -2)}</strong>;
        if (p.startsWith('*') && p.endsWith('*')) return <em key={i}>{p.slice(1, -1)}</em>;
        if (p.startsWith('`') && p.endsWith('`')) return <code key={i}>{p.slice(1, -1)}</code>;
        const link = /^\[([^\]]+)\]\([^)]+\)$/.exec(p);
        if (link) return <Fragment key={i}>{link[1]}</Fragment>;
        return <Fragment key={i}>{p}</Fragment>;
      })}
    </>
  );
}

export function GlossaryPanel(): JSX.Element | null {
  const glossary = useStore(s => s.glossary);
  const show = useStore(s => s.showGlossary);
  const focusTerm = useStore(s => s.glossaryFocusTerm);
  const closeGlossary = useStore(s => s.closeGlossary);
  const [query, setQuery] = useState('');
  const focusRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (show && focusTerm && focusRef.current) {
      focusRef.current.scrollIntoView({ block: 'center' });
    }
  }, [show, focusTerm, glossary]);

  if (!show) return null;

  const q = query.trim().toLowerCase();
  const sections = (glossary?.sections ?? [])
    .map(s => ({
      ...s,
      entries: q
        ? s.entries.filter(e =>
            e.term.toLowerCase().includes(q) || e.definition.toLowerCase().includes(q))
        : s.entries,
    }))
    .filter(s => s.entries.length > 0);

  return (
    <aside className="glossary-panel">
      <div className="glossary-head">
        <h3>📖 Dictionary</h3>
        <button className="btn ghost" title="Close" onClick={closeGlossary}>✕</button>
      </div>
      <input
        className="glossary-search"
        placeholder="Search terms…"
        value={query}
        autoFocus={!focusTerm}
        onChange={e => setQuery(e.target.value)}
        onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); closeGlossary(); } }}
      />

      {!glossary && <p className="menu-note">Loading dictionary…</p>}
      {glossary && sections.length === 0 && <p className="menu-note">No matching terms.</p>}

      {sections.map(section => (
        <section key={section.title} className="glossary-section">
          <h4>{section.title}</h4>
          {section.entries.map(entry => {
            const focused = focusTerm === entry.term;
            return (
              <div
                key={entry.term}
                ref={focused ? focusRef : undefined}
                className={`glossary-entry ${focused ? 'focused' : ''}`}
              >
                <div className="glossary-term">{renderInline(entry.term)}</div>
                <div className="glossary-def">{renderInline(entry.definition)}</div>
              </div>
            );
          })}
        </section>
      ))}
    </aside>
  );
}
