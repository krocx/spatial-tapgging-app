// MapList.tsx — home screen: your name (for presence), API key when required,
// create map, and the list of existing maps.

import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store.js';
import { fetchAuthRequired, getApiKey, setApiKey } from '../api/mindmap-api.js';
import { ImageImportPreview } from './ImageImportPreview.js';

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

  const [name, setName] = useState('');
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

  return (
    <div className="map-list">
      <header className="list-header">
        <h1>SIB Roadmap · Mind Mapper</h1>
        <p className="subtitle">Secure, collaborative mind-mapping on the Spatial Intelligence Backend</p>
      </header>

      <section className="identity card">
        <label>
          Display name
          <input value={userName} placeholder="Shown to collaborators"
                 onChange={e => setUserName(e.target.value)} onBlur={saveIdentity} />
        </label>
        {authRequired && (
          <label>
            API key
            <input type="password" value={key} placeholder="X-API-Key"
                   onChange={e => setKey(e.target.value)} onBlur={saveIdentity} />
          </label>
        )}
      </section>

      <section className="card">
        <form
          className="create-row"
          onSubmit={e => {
            e.preventDefault();
            if (name.trim()) { void createMap(name.trim()); setName(''); }
          }}
        >
          <input value={name} placeholder="New map name…" onChange={e => setName(e.target.value)} />
          <button className="btn primary" type="submit" disabled={!name.trim()}>Create roadmap</button>
          <button
            className="btn" type="button"
            disabled={!name.trim()}
            title="A procedure map compiles into an AR work instruction guide. Its kind cannot be changed later."
            onClick={() => { if (name.trim()) { void createMap(name.trim(), 'procedure'); setName(''); } }}
          >Create procedure</button>
          <button
            className="btn" type="button"
            title="Import a mind-map exported as JSON (e.g. from the Render instance)"
            onClick={() => fileRef.current?.click()}
          >Import JSON</button>
          <button
            className="btn" type="button"
            disabled={importingImage}
            title="Photograph a whiteboard or upload a screenshot — the local vision model turns it into a roadmap draft"
            onClick={() => imageRef.current?.click()}
          >{importingImage ? 'Reading image…' : 'From image 📷'}</button>
          <input
            ref={imageRef} type="file" accept="image/png,image/jpeg,image/webp" hidden
            onChange={e => {
              const file = e.target.files?.[0];
              if (file) void importFromImage(file);
              e.target.value = '';
            }}
          />
          <button
            className="btn" type="button"
            title="A teammate shared a draft key with you? Enter it to see their draft."
            onClick={() => {
              const key = prompt('Enter the draft key you were given:');
              if (key?.trim()) void unlockDraft(key);
            }}
          >Unlock draft</button>
          <input
            ref={fileRef} type="file" accept=".json,application/json" hidden
            onChange={e => {
              const file = e.target.files?.[0];
              if (file) {
                void file.text().then(text => importMapFromJson(text));
              }
              e.target.value = '';   // allow re-importing the same file
            }}
          />
        </form>
        {statusMessage && <p className="import-status">{statusMessage}</p>}
      </section>

      {error && <div className="error-banner">{error}</div>}

      <section className="card maps">
        {maps.length === 0 && <p className="menu-note">No maps yet — create your first one above.</p>}
        {maps.map(m => (
          <div key={m.id} className="map-row">
            <button className="map-open" onClick={() => void openMap(m.id, userName.trim() || 'Anonymous')}>
              <span className="map-title">
                {m.name}
                {m.published === false && <span className="draft-badge" title="Draft — visible only to draft-key holders">Draft 🔒</span>}
              </span>
              <span className="map-meta">
                {m.nodeCount} nodes · {m.edgeCount} edges · updated {new Date(m.updatedAt).toLocaleString()}
              </span>
            </button>
            <button
              className="btn ghost danger"
              title="Delete map"
              onClick={() => { if (confirm(`Delete "${m.name}" and its version history?`)) void deleteMap(m.id); }}
            >✕</button>
          </div>
        ))}
      </section>

      <footer className="list-footer">
        Hosted on SIB · data in <code>.sib-data/</code> · no external services
      </footer>

      <ImageImportPreview />
    </div>
  );
}
