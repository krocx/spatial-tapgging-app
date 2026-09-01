// MapList.tsx — the home screen, redesigned (S5c, approved happy-path design).
//
// Structure:
//   HERO     — "What will you build today?" + the two doors: Roadmap (gold)
//              and Procedure (teal). Clicking a door reveals its name field.
//   GALLERY  — maps as cards with kind badge, counts and updated time.
//   ⋯ MENU   — Import JSON / From image / Unlock draft, tucked away.
//   IDENTITY — corner chip (display name + API key when required) instead of
//              a form as the opening act.
//
// All previous functionality is preserved — only the arrangement changed.

import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store.js';
import { fetchAuthRequired, getApiKey, setApiKey } from '../api/mindmap-api.js';
import { ImageImportPreview } from './ImageImportPreview.js';

type Door = 'roadmap' | 'procedure';

export function MapList(): JSX.Element {
  const maps = useStore(s => s.maps);
  const error = useStore(s => s.error);
  const refreshList = useStore(s => s.refreshList);
  const createMap = useStore(s => s.createMap);
  const openMap = useStore(s => s.openMap);
  const deleteMap = useStore(s => s.deleteMap);
  const importMapFromJson = useStore(s => s.importMapFromJson);
  const unlockDraft = useStore(s => s.unlockDraft);
  const importFromImage = useStore(s => s.importFromImage);
  const importingImage = useStore(s => s.importingImage);
  const statusMessage = useStore(s => s.statusMessage);
  const fileRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);

  const [door, setDoor] = useState<Door | null>(null);
  const [name, setName] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [identityOpen, setIdentityOpen] = useState(false);
  const [userName, setUserName] = useState(localStorage.getItem('roadmap-name') ?? '');
  const [authRequired, setAuthRequired] = useState(false);
  const [key, setKey] = useState(getApiKey());

  useEffect(() => {
    void fetchAuthRequired().then(setAuthRequired);
    void refreshList();
  }, []);

  const saveIdentity = () => {
    localStorage.setItem('roadmap-name', userName.trim() || 'Anonymous');
    if (authRequired) { setApiKey(key); void refreshList(); }
  };

  const create = () => {
    if (!name.trim() || !door) return;
    void createMap(name.trim(), door === 'procedure' ? 'procedure' : undefined);
    setName(''); setDoor(null);
  };

  const fmtWhen = (t: number) => {
    const d = Date.now() - t;
    if (d < 3600e3)  return `${Math.max(1, Math.round(d / 60e3))} min ago`;
    if (d < 86400e3) return `${Math.round(d / 3600e3)} h ago`;
    if (d < 7 * 86400e3) return `${Math.round(d / 86400e3)} d ago`;
    return new Date(t).toLocaleDateString();
  };

  return (
    <div className="map-list home-v2">

      {/* ── Identity chip + ⋯ menu (top-right) ── */}
      <div className="home-corner">
        <button className="home-chip" onClick={() => { setIdentityOpen(v => !v); setMenuOpen(false); }}>
          👤 {userName.trim() || 'Set your name'}
        </button>
        <button className="home-chip" title="Import & more" onClick={() => { setMenuOpen(v => !v); setIdentityOpen(false); }}>⋯</button>

        {identityOpen && (
          <div className="home-popover">
            <label>Display name
              <input value={userName} placeholder="Shown to collaborators"
                     onChange={e => setUserName(e.target.value)} onBlur={saveIdentity} />
            </label>
            {authRequired && (
              <label>API key
                <input type="password" value={key} placeholder="X-API-Key"
                       onChange={e => setKey(e.target.value)} onBlur={saveIdentity} />
              </label>
            )}
          </div>
        )}
        {menuOpen && (
          <div className="home-popover home-menu">
            <button onClick={() => { setMenuOpen(false); fileRef.current?.click(); }}>📄 Import JSON</button>
            <button disabled={importingImage}
                    onClick={() => { setMenuOpen(false); imageRef.current?.click(); }}>
              {importingImage ? 'Reading image…' : '📷 From whiteboard photo'}
            </button>
            <button onClick={() => {
              setMenuOpen(false);
              const k = prompt('Enter the draft key you were given:');
              if (k?.trim()) void unlockDraft(k);
            }}>🔑 Unlock a shared draft</button>
          </div>
        )}
      </div>

      {/* ── Hero + the two doors ── */}
      <header className="home-hero">
        <h1>What will you build today?</h1>
        <p>Plans that people follow. Procedures that technicians run in AR. Both start here.</p>
      </header>

      <section className="home-doors">
        <div className={`home-door door-roadmap ${door === 'roadmap' ? 'active' : ''}`}
             onClick={() => { setDoor('roadmap'); }}>
          <div className="door-icon">🗺</div>
          <h2>Roadmap</h2>
          <p className="door-tag">Shape the plan</p>
          <p className="door-desc">Collaborative canvas with live cursors, swimlanes, reviews and presentation mode.</p>
          <p className="door-path">plan together → review &amp; decide → present the story</p>
          {door === 'roadmap' && (
            <form className="door-create" onClick={e => e.stopPropagation()}
                  onSubmit={e => { e.preventDefault(); create(); }}>
              <input autoFocus value={name} placeholder="Name your roadmap…"
                     onChange={e => setName(e.target.value)} />
              <button className="btn primary" type="submit" disabled={!name.trim()}>Create</button>
            </form>
          )}
        </div>

        <div className={`home-door door-procedure ${door === 'procedure' ? 'active' : ''}`}
             onClick={() => { setDoor('procedure'); }}>
          <div className="door-icon">🧩</div>
          <h2>Procedure</h2>
          <p className="door-tag">Author the work</p>
          <p className="door-desc">Draw steps with next / on-failure / requires — compile straight into an AR work-instruction guide.</p>
          <p className="door-path">draw the steps → check &amp; preview → send to the floor</p>
          {door === 'procedure' && (
            <form className="door-create" onClick={e => e.stopPropagation()}
                  onSubmit={e => { e.preventDefault(); create(); }}>
              <input autoFocus value={name} placeholder="Name your procedure…"
                     onChange={e => setName(e.target.value)} />
              <button className="btn primary" type="submit" disabled={!name.trim()}>Create</button>
            </form>
          )}
        </div>
      </section>

      {statusMessage && <p className="import-status">{statusMessage}</p>}
      {error && <div className="error-banner">{error}</div>}

      {/* ── Map gallery ── */}
      <section className="home-gallery">
        {maps.length > 0 && <h3 className="gallery-title">Your maps</h3>}
        {maps.length === 0 && (
          <p className="menu-note">No maps yet — pick a door above and give it a name. Your work will appear here.</p>
        )}
        <div className="gallery-grid">
          {maps.map(m => (
            <div key={m.id} className={`gallery-card ${m.kind === 'procedure' ? 'kind-procedure' : 'kind-roadmap'}`}>
              <button className="gallery-open" onClick={() => void openMap(m.id, userName.trim() || 'Anonymous')}>
                <div className="gallery-top">
                  <span className={`kind-badge ${m.kind === 'procedure' ? 'procedure' : 'roadmap'}`}>
                    {m.kind === 'procedure' ? '🧩 Procedure' : '🗺 Roadmap'}
                  </span>
                  {m.published === false && (
                    <span className="draft-badge" title="Draft — visible only to draft-key holders">Draft 🔒</span>
                  )}
                </div>
                <span className="map-title">{m.name}</span>
                <span className="map-meta">
                  {m.nodeCount} nodes · {m.edgeCount} edges · {fmtWhen(m.updatedAt)}
                </span>
              </button>
              <button
                className="btn ghost danger gallery-delete"
                title="Delete map"
                onClick={() => { if (confirm(`Delete "${m.name}" and its version history?`)) void deleteMap(m.id); }}
              >✕</button>
            </div>
          ))}
        </div>
      </section>

      <footer className="list-footer">
        Hosted on SIB · data in <code>.sib-data/</code> · no external services
      </footer>

      {/* hidden inputs for the ⋯ menu */}
      <input ref={fileRef} type="file" accept=".json,application/json" hidden
             onChange={e => {
               const file = e.target.files?.[0];
               if (file) void file.text().then(text => importMapFromJson(text));
               e.target.value = '';
             }} />
      <input ref={imageRef} type="file" accept="image/png,image/jpeg,image/webp" hidden
             onChange={e => {
               const file = e.target.files?.[0];
               if (file) void importFromImage(file);
               e.target.value = '';
             }} />

      <ImageImportPreview />
    </div>
  );
}
