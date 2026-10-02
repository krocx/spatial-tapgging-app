// ColoursPanel.tsx - colour a grey export from inside the 3D Studio.
//
// The same service the portal's Models page uses (models/colour.ts): the
// export is analysed into part families, each family gets a stable colour,
// the author overrides any of them, Apply writes the colour into the GLB and
// the preview reloads. Reset puts the original export back.

import { useEffect, useState, type JSX } from 'react';
import { mindmapApi, type ModelColours } from '../api/mindmap-api.js';

type RGB = [number, number, number];
const toHex = (c: RGB) => '#' + c.map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
const fromHex = (h: string): RGB => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255) as RGB;
const KIND = { fastener: 'fastener', seal: 'seal / hose', body: 'body' } as const;

export function ColoursPanel({ modelId, onApplied }: { modelId: string; onApplied: () => void }): JSX.Element {
  const [data, setData] = useState<ModelColours | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, RGB>>({});

  const load = () => { setErr(null); mindmapApi.modelColours(modelId).then(d => { setData(d); setOverrides({}); }).catch(e => setErr((e as Error).message)); };
  useEffect(load, [modelId]);

  if (err) return <div className="ax-card pt-card"><div className="pt-card-title">Colours</div><span className="step-check-hint">{err}</span></div>;
  if (!data) return <div className="ax-card pt-card"><div className="pt-card-title">Colours</div><span className="step-check-hint">Reading materials…</span></div>;

  const colourOf = (f: ModelColours['families'][number]): RGB => overrides[f.family] ?? f.applied ?? f.suggested;
  const apply = async () => {
    setBusy(true);
    try {
      const byFamily: Record<string, RGB> = {};
      for (const f of data.families) if (f.applied) byFamily[f.family] = f.applied;
      Object.assign(byFamily, overrides);
      await mindmapApi.applyModelColours(modelId, byFamily);
      onApplied(); load();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const reset = async () => {
    if (!window.confirm('Put the original export back?')) return;
    setBusy(true);
    try { await mindmapApi.resetModelColours(modelId); onApplied(); load(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const note = data.applied
    ? `Coloured ${new Date(data.applied.appliedAt).toLocaleDateString()} · ${data.applied.parts} parts`
    : data.greyscale ? `Grey export: ${data.greyMaterials} of ${data.materials} materials have no colour. Auto colour tells the families apart.`
    : data.textured ? 'Textured model - colouring is for grey exports.' : `Already coloured (${data.materials - data.greyMaterials} of ${data.materials} materials). You can still recolour by family.`;

  return (
    <div className="ax-card pt-card pt-colours">
      <div className="pt-card-title">Colours <span className="pt-card-sub">{data.families.length} families · {data.parts} parts</span></div>
      <div className={`pt-note${data.greyscale && !data.applied ? ' warn' : ''}`}>{note}</div>
      <div className="pt-fam-list">
        {data.families.map(f => (
          <label key={f.family} className="pt-fam" title={`${f.parts} part${f.parts === 1 ? '' : 's'} · ${KIND[f.kind]}`}>
            <input type="color" value={toHex(colourOf(f))} onChange={e => setOverrides(o => ({ ...o, [f.family]: fromHex(e.target.value) }))} />
            <span className="pt-fam-name">{f.family}</span>
            <span className="pt-fam-meta">{f.parts}{overrides[f.family] ? ' · changed' : f.applied ? '' : ` · ${KIND[f.kind]}`}</span>
          </label>
        ))}
      </div>
      <div className="pt-card-acts">
        {data.hasOriginal && <button className="btn ghost" onClick={reset} disabled={busy}>Reset to export</button>}
        <button className="btn primary" onClick={apply} disabled={busy}>{busy ? 'Colouring…' : data.applied ? 'Apply changes' : 'Auto colour'}</button>
      </div>
      <span className="step-check-hint">Written into the model: the app, the XR kit and this preview show it. Reduced copies rebuild in the background.</span>
    </div>
  );
}
