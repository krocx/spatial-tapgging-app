// PartsSection.tsx - "Parts on this step" for procedure maps (2026.4.46).
//
// The author thinks additively: which parts does THIS step install? The
// section stores just that list (metadata.step.parts); the cumulative state
// - installed earlier / this step / not yet - is derived from the compiled
// order and shown in the tree and the 3D preview, so the author sees the
// assembly grow while clicking through steps. See docs/PROCEDURE-DESIGNER.md.
//
// Two surfaces share one hook (`usePartsPicker`):
//   PartsSection  the Inspector block for the selected step
//   PartsStudio   full-screen: model large, parts on the right, and step
//                 navigation (◀ ▶ / step strip) so a whole procedure can be
//                 authored without leaving the view. Lives at App level so the
//                 model stays loaded while the step changes.
//
// Parent / child: a selected group covers all its descendants; a selected
// child overrides its group. The 3D preview, the tree and the compiler agree
// on that rule (iOS applies parents first, children after).
//
// Hooks are unconditional; the bail-out sits below them (React #310 lesson).

import { useEffect, useMemo, useState, type JSX } from 'react';
import { useStore } from '../state/store.js';
import { mindmapApi, type GlbPartNode, type GlbPartTree, type ModelColours } from '../api/mindmap-api.js';
import { AssemblyPreview, type PartState } from './AssemblyPreview.js';
import { ColoursPanel } from './ColoursPanel.js';
import { stateAfter, deltasOf, type PartStateMap } from '../utils/assembly-state.js';
import type { GuideStepNode } from '@spatial/shared';

/** The app's hues (sRGB 0..1) - one meaning each; a part colour is a signal, not decoration. */
const SWATCHES: Array<[string, [number, number, number]]> = [
  ['blue', [0.04, 0.52, 1]], ['cyan', [0.39, 0.82, 1]], ['green', [0.19, 0.82, 0.35]], ['orange', [1, 0.62, 0.04]],
  ['red', [1, 0.27, 0.23]], ['yellow', [1, 0.84, 0.04]], ['indigo', [0.37, 0.36, 0.9]], ['purple', [0.75, 0.35, 0.95]], ['grey', [0.56, 0.56, 0.58]],
];

// One tree per model per session - the picker opens on every step.
const treeCache = new Map<string, Promise<GlbPartTree>>();
function loadTree(modelId: string): Promise<GlbPartTree> {
  let p = treeCache.get(modelId);
  if (!p) { p = mindmapApi.modelNodes(modelId); treeCache.set(modelId, p); p.catch(() => treeCache.delete(modelId)); }
  return p;
}

/** Parts a step lists - `parts` when edited here, else the imported non-hidden nodes. */
export function partsOfStep(step: Record<string, unknown> | undefined): string[] {
  if (!step) return [];
  if (Array.isArray(step.parts)) return step.parts.filter((p): p is string => typeof p === 'string');
  if (Array.isArray(step.nodes)) {
    return (step.nodes as Array<{ node?: string; show?: string }>)
      .filter(n => typeof n?.node === 'string' && n.show !== 'hidden').map(n => n.node as string);
  }
  return [];
}

/** name → parent name, from the part tree (for inherited selection). */
function parentMapOf(tree: GlbPartTree | null): Map<string, string> {
  const m = new Map<string, string>();
  const walk = (n: GlbPartNode, parent?: string) => {
    if (parent) m.set(n.name, parent);
    n.children.forEach(c => walk(c, n.name));
  };
  tree?.roots.forEach(r => walk(r));
  return m;
}

/** Nearest ancestor-or-self with an explicit state (child overrides group). */
export function effectiveState(name: string, states: Map<string, PartState>, parents: Map<string, string>): PartState | undefined {
  let n: string | undefined = name;
  while (n) {
    const s = states.get(n);
    if (s) return s;
    n = parents.get(n);
  }
  return undefined;
}

export function usePartsPicker(nodeId: string | null) {
  const assembly   = useStore(s => s.map?.settings?.assembly);
  const order      = useStore(s => s.procedure?.order);
  const mapNodes   = useStore(s => s.map?.nodes);
  const patchStepMeta = useStore(s => s.patchStepMeta);
  const stepMeta   = useStore(s => (nodeId ? s.map?.nodes.find(n => n.id === nodeId)?.metadata?.step : undefined) as Record<string, unknown> | undefined);

  const [tree, setTree]     = useState<GlbPartTree | null>(null);
  const [treeErr, setTreeErr] = useState<string | null>(null);
  const [query, setQuery]   = useState('');
  const [open, setOpen]     = useState<Set<string>>(() => new Set());
  // Identify parts: lit in the 3D view with everything else greyed (spotlight), described
  // (where, size, parents) and acted on from one card. Shift-click builds a selection.
  const [focusList, setFocusList] = useState<string[]>([]);
  const focus = focusList[0] ?? null;
  const [isolate, setIsolate] = useState(false);
  const [spotlight, setSpotlight] = useState(true);
  const [focusInfo, setFocusInfo] = useState<{ name: string; where: string; sizeMm: [number, number, number]; visible: boolean; parents: string[] } | null>(null);
  // Families (from the colour analysis): view-time tint and the grouped tree. Labels: readable names.
  const [colours, setColours] = useState<ModelColours | null>(null);
  const [colourByFamily, setColourByFamily] = useState(false);
  const [groupByFamily, setGroupByFamily] = useState(false);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [hover, setHover] = useState<string | null>(null);

  const modelId = assembly?.modelId;
  useEffect(() => {
    if (!modelId) { setTree(null); return; }
    let live = true;
    setTree(null); setTreeErr(null);
    loadTree(modelId).then(t => { if (live) setTree(t); }).catch(e => { if (live) setTreeErr((e as Error).message); });
    mindmapApi.modelColours(modelId).then(c => { if (live) setColours(c); }).catch(() => { /* families optional */ });
    mindmapApi.model(modelId).then(m => { if (live) setLabels(m.partLabels ?? {}); }).catch(() => { /* labels optional */ });
    return () => { live = false; };
  }, [modelId]);
  const label = (n: string) => labels[n] || n.replace(/^cmp:/, '');
  const familyOf = (n: string) => colours?.partFamilies?.[n];
  const familyColour = (f: string): [number, number, number] | undefined => { const fam = colours?.families.find(x => x.family === f); return fam ? (fam.applied ?? fam.suggested) : undefined; };
  const renameLabel = async (name: string) => {
    if (!modelId) return;
    const next = window.prompt(`A name people will read for\n${name}\n(leave empty to go back to the CAD name)`, labels[name] ?? '');
    if (next === null) return;
    try { const m = await mindmapApi.setPartLabels(modelId, { [name]: next.trim() }); setLabels(m.partLabels ?? {}); } catch (e) { window.alert((e as Error).message); }
  };
  const renameFamily = async (fam: string) => {
    if (!modelId || !colours?.partFamilies) return;
    const members = Object.entries(colours.partFamilies).filter(([, f]) => f === fam).map(([n]) => n);
    const next = window.prompt(`A name for all ${members.length} parts of "${fam}"\n(leave empty to clear)`, labels[members[0]] ?? '');
    if (next === null) return;
    const patch: Record<string, string> = {}; for (const n of members) patch[n] = next.trim();
    try { const m = await mindmapApi.setPartLabels(modelId, patch); setLabels(m.partLabels ?? {}); } catch (e) { window.alert((e as Error).message); }
  };

  const parts = useMemo(() => partsOfStep(stepMeta), [stepMeta]);
  const partSet = useMemo(() => new Set(parts), [parts]);
  const parents = useMemo(() => parentMapOf(tree), [tree]);

  // Cumulative state at this step from the compiled order (steps before this
  // one, by sequence number). Parts the imported initial state hides start
  // as "later" too, so an imported bike doesn't show up complete on step 1.
  const { earlier, states, partNames } = useMemo(() => {
    const names = new Set(tree?.names ?? []);
    const earlier = new Set<string>();
    const mySeq = nodeId ? order?.[nodeId] : undefined;
    if (order && mySeq !== undefined && mapNodes) {
      for (const n of mapNodes) {
        const seq = order[n.id];
        if (seq === undefined || seq >= mySeq) continue;
        for (const p of partsOfStep(n.metadata?.step as Record<string, unknown> | undefined)) earlier.add(p);
      }
    }
    const states = new Map<string, PartState>();
    const mentioned = new Set<string>();
    for (const n of assembly?.initialNodes ?? []) if (n.show === 'hidden') mentioned.add(n.node);
    if (mapNodes) for (const n of mapNodes) for (const p of partsOfStep(n.metadata?.step as Record<string, unknown> | undefined)) mentioned.add(p);
    for (const p of mentioned) states.set(p, partSet.has(p) ? 'this' : earlier.has(p) ? 'before' : 'after');
    // Disassembly reads the other way round: earlier steps REMOVED their parts.
    if (assembly?.start === 'complete') {
      for (const [p, st] of states) states.set(p, st === 'before' ? 'after' : st === 'after' ? 'before' : st);
    }
    return { earlier, states, partNames: names };
  }, [tree, order, nodeId, mapNodes, partSet, assembly?.start, assembly?.initialNodes]);

  // Runtime state (imported guides carry deltas): what the operator sees after
  // this step, and this step on its own clock for Play. Authored guides with
  // parts lists only keep the this/before/after view.
  const { poses, play } = useMemo((): { poses?: PartStateMap; play?: { base: PartStateMap; deltas: GuideStepNode[] } } => {
    if (!order || !mapNodes || !nodeId) return {};
    const seqd = mapNodes.filter(n => order[n.id] !== undefined).sort((a, b) => (order[a.id] ?? 0) - (order[b.id] ?? 0));
    const steps = seqd.map(n => deltasOf(n.metadata?.step as Record<string, unknown> | undefined));
    // A guide authored from a parts list may carry colour-only deltas from the Studio: those tint, they do not switch the preview to runtime visibility.
    const real = (d: GuideStepNode) => d.show !== undefined || d.animate !== undefined || d.to !== undefined || d.rotationTo !== undefined || d.effect !== undefined;
    if (!steps.some(d => d.some(real))) return {};
    const idx = seqd.findIndex(n => n.id === nodeId);
    if (idx < 0) return {};
    return { poses: stateAfter(assembly?.initialNodes, steps, idx), play: { base: stateAfter(assembly?.initialNodes, steps, idx - 1), deltas: steps[idx] } };
  }, [order, mapNodes, nodeId, assembly?.initialNodes]);
  /** Colours authored per step (cumulative, last wins - the app's rule), for the preview tint. */
  const stepColours = useMemo(() => {
    const m = new Map<string, [number, number, number]>();
    if (!order || !mapNodes || !nodeId) return m;
    const seqd = mapNodes.filter(n => order[n.id] !== undefined).sort((a, b) => (order[a.id] ?? 0) - (order[b.id] ?? 0));
    const idx = seqd.findIndex(n => n.id === nodeId);
    for (let i = 0; i <= idx; i++) for (const d of deltasOf(seqd[i].metadata?.step as Record<string, unknown> | undefined)) if (d.color && d.color.length === 3) m.set(d.node, [d.color[0], d.color[1], d.color[2]]);
    return m;
  }, [order, mapNodes, nodeId]);
  const colourBy = useMemo(() => {
    const m = new Map<string, [number, number, number]>();
    if (colourByFamily && colours?.partFamilies) for (const [part, fam] of Object.entries(colours.partFamilies)) { const c = familyColour(fam); if (c) m.set(part, c); }
    for (const [part, c] of stepColours) m.set(part, c);
    return m.size ? m : null;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colourByFamily, colours, stepColours]);

  const write = (next: string[]) => { if (nodeId) patchStepMeta(nodeId, { parts: next }); };
  const updateSettings = useStore(s => s.updateSettings);

  // Operator context for this step: what surrounds the parts being installed.
  type Ctx = 'installed' | 'ghost' | 'solid';
  const context: Ctx = stepMeta?.context === 'ghost' || stepMeta?.context === 'solid' ? stepMeta.context : 'installed';
  const setContext = (c: Ctx) => { if (nodeId) patchStepMeta(nodeId, { context: c === 'installed' ? null : c }); };
  const setContextAll = (c: Ctx) => {
    for (const n of mapNodes ?? []) patchStepMeta(n.id, { context: c === 'installed' ? null : c });
  };
  const contextBlock = (
    <div className="pt-context">
      <span className="pt-context-label" title="What the operator sees around this step's parts">Operator sees</span>
      <div className="pt-context-seg" role="radiogroup">
        {([['installed', 'Installed only'], ['ghost', 'Whole · ghost'], ['solid', 'Whole · solid']] as [Ctx, string][]).map(([v, l]) => (
          <button key={v} role="radio" aria-checked={context === v} className={context === v ? 'on' : ''} onClick={() => setContext(v)}
            title={v === 'installed' ? 'Only what has been built so far' : v === 'ghost' ? 'The whole assembly as a faint ghost - orientation without hiding progress' : 'The whole assembly opaque'}>{l}</button>
        ))}
      </div>
      <button className="btn ghost pt-context-all" onClick={() => setContextAll(context)} title="Use this context on every step of the procedure">all steps</button>
    </div>
  );
  const toggle = (name: string) => write(partSet.has(name) ? parts.filter(p => p !== name) : [...parts, name]);

  // Hide / show a part on THIS step. An imported step carries deltas (`nodes`):
  // its visibility is a `show` entry there, so the app, the XR kit and this
  // preview all read the same thing. An authored step lists `parts`: hide is
  // "not on this step", show is "on this step".
  const hasDeltas = Array.isArray(stepMeta?.nodes);
  const setShownMany = (names: string[], shown: boolean) => {
    if (!nodeId) return;
    if (hasDeltas) {
      const nodes = (stepMeta!.nodes as Array<Record<string, unknown>>).map(n => ({ ...n }));
      for (const name of names) { const i = nodes.findIndex(n => n.node === name); if (i >= 0) nodes[i].show = shown ? 'solid' : 'hidden'; else nodes.push({ node: name, show: shown ? 'solid' : 'hidden' }); }
      patchStepMeta(nodeId, { nodes });
    } else write(shown ? [...parts, ...names.filter(n => !partSet.has(n))] : parts.filter(p => !names.includes(p)));
  };
  const setShown = (name: string, shown: boolean) => setShownMany([name], shown);
  const [note, setNote] = useState<string | null>(null);
  const say = (t: string) => { setNote(t); window.clearTimeout((say as unknown as { h?: number }).h); (say as unknown as { h?: number }).h = window.setTimeout(() => setNote(null), 6000); };
  /** Colour from this step on (a `color` delta - the app applies it, last wins). null clears. */
  const colourStep = (names: string[], rgb: [number, number, number] | null) => {
    if (!nodeId) return;
    const nodes = (Array.isArray(stepMeta?.nodes) ? (stepMeta!.nodes as Array<Record<string, unknown>>) : []).map(n => ({ ...n }));
    for (const name of names) {
      const i = nodes.findIndex(n => n.node === name);
      if (rgb) { if (i >= 0) nodes[i].color = rgb; else nodes.push({ node: name, color: rgb }); }
      else if (i >= 0) { delete nodes[i].color; if (Object.keys(nodes[i]).length === 1) nodes.splice(i, 1); }
    }
    patchStepMeta(nodeId, { nodes: nodes.length ? nodes : null });
    say(rgb ? `Coloured from this step on - the operator sees it on this and later steps. ⌘Z undoes.` : 'Step colour cleared.');
  };
  /** Colour in the model itself (every step, every player). null clears. */
  const colourModel = async (names: string[], rgb: [number, number, number] | null) => {
    if (!modelId) return;
    const byPart: Record<string, [number, number, number] | null> = {}; for (const n of names) byPart[n] = rgb;
    try { await mindmapApi.applyModelColours(modelId, {}, byPart); setColours(await mindmapApi.modelColours(modelId)); setModelReload(r => r + 1); say(rgb ? 'Coloured in the model - every step, the app, the XR kit and the glasses. Reduced copies rebuild in the background.' : 'Model colour cleared for the selection.'); }
    catch (e) { window.alert((e as Error).message); }
  };
  const [modelReload, setModelReload] = useState(0);
  /** Hidden for the whole guide: the initial state hides it (and no step shows it unless a step says so). */
  const hiddenAtStart = (name: string) => (assembly?.initialNodes ?? []).some(n => n.node === name && n.show === 'hidden');
  const setHiddenForGuide = (names: string[], hidden: boolean) => {
    if (!assembly) return;
    const initial = (assembly.initialNodes ?? []).filter(n => !(names.includes(n.node) && n.sourceKey === 'studio'));
    for (const name of names) {
      const importHid = (assembly.initialNodes ?? []).some(n => n.node === name && n.show === 'hidden' && n.sourceKey !== 'studio');
      if (hidden) { if (!importHid) initial.push({ node: name, show: 'hidden', sourceKey: 'studio' } as GuideStepNode); }
      else if (importHid) initial.push({ node: name, show: 'solid', sourceKey: 'studio' } as GuideStepNode);
    }
    updateSettings({ assembly: { ...assembly, initialNodes: initial } }, { history: true });
    say(hidden ? 'Hidden for the whole guide - every step starts without it.' : 'Shown for the whole guide.');
  };
  // '' clears, '+name' adds to the selection (shift-click), a name replaces it; a second click on the same part clears.
  const focusOn = (raw: string | null) => {
    if (!raw) { setFocusList([]); return; }
    const add = raw.startsWith('+'); const name = add ? raw.slice(1) : raw;
    setFocusList(prev => add ? (prev.includes(name) ? prev.filter(p => p !== name) : [...prev, name]) : (prev.length === 1 && prev[0] === name ? [] : [name]));
    setOpen(prev => { const n = new Set(prev); let a = parents.get(name); while (a) { n.add(a); a = parents.get(a); } return n; });
    setTimeout(() => document.querySelector(`[data-part="${CSS.escape(name)}"]`)?.scrollIntoView({ block: 'nearest' }), 50);
  };
  const focusFamily = (fam: string) => {
    if (!colours?.partFamilies) return;
    const members = Object.entries(colours.partFamilies).filter(([, f]) => f === fam).map(([n]) => n);
    setFocusList(members);
  };
  const [colourOpen, setColourOpen] = useState(false);
  const [colourScope, setColourScope] = useState<'step' | 'model'>('step');
  const many = focusList.length > 1;
  const allOn = focusList.length > 0 && focusList.every(n => partSet.has(n));
  const focusBlock = focus ? (
    <div className="pt-focus">
      <div className="pt-focus-head">
        <span className="pt-focus-dot" />
        <b className="pt-focus-name" title={focus}>{many ? `${focusList.length} parts` : label(focus)}</b>
        {!many && <button className="pt-focus-rename" onClick={() => renameLabel(focus)} title="Give this part a name people will read">rename</button>}
        <button className="pt-focus-x" onClick={() => { focusOn(null); setIsolate(false); }} title="Clear (Esc)">✕</button>
      </div>
      {!many && labels[focus] && <div className="pt-focus-cad" title="CAD name">{focus.replace(/^cmp:/, '')}</div>}
      {!many && focusInfo && focusInfo.parents.length > 0 && <div className="pt-focus-crumb">{focusInfo.parents.map(p => <button key={p} onClick={() => focusOn(p)} title={p}>{label(p)}</button>)}</div>}
      <div className="pt-focus-meta">
        {!many && focusInfo?.where && <span>{focusInfo.where}</span>}
        {!many && focusInfo && focusInfo.sizeMm.some(v => v) && <span>{focusInfo.sizeMm.join(' × ')} mm</span>}
        {!many && familyOf(focus) && <span className="fam" onClick={() => focusFamily(familyOf(focus)!)} title="Select the whole family">{familyOf(focus)} · {Object.values(colours?.partFamilies ?? {}).filter(f => f === familyOf(focus)).length}</span>}
        {!many && focusInfo && <span className={focusInfo.visible ? 'ok' : 'off'}>{focusInfo.visible ? 'visible on this step' : 'hidden on this step'}</span>}
        {many && <span>{focusList.map(label).slice(0, 4).join(' · ')}{focusList.length > 4 ? ` · +${focusList.length - 4}` : ''}</span>}
      </div>
      <div className="pt-focus-acts">
        <button className="btn ghost" onClick={() => write(allOn ? parts.filter(p => !focusList.includes(p)) : [...parts, ...focusList.filter(p => !partSet.has(p))])}>{allOn ? 'Remove from step' : 'Add to step'}</button>
        <button className="btn ghost" onClick={() => setShownMany(focusList, !(focusInfo?.visible ?? true))} title={hasDeltas ? 'Writes a show / hide for these parts on this step (the app and the XR kit follow it)' : 'Authored step: on or off this step\u2019s parts list'}>{(focusInfo?.visible ?? true) ? 'Hide on this step' : 'Show on this step'}</button>
        <button className="btn ghost" onClick={() => setHiddenForGuide(focusList, !focusList.every(hiddenAtStart))} title="Every step starts without it (the imported initial state)">{focusList.every(hiddenAtStart) ? 'Show in whole guide' : 'Hide in whole guide'}</button>
        <button className={`btn ghost${colourOpen ? ' on' : ''}`} onClick={() => setColourOpen(v => !v)} title="Colour the selection">Colour…</button>
        <button className={`btn ghost${isolate ? ' on' : ''}`} onClick={() => setIsolate(v => !v)} title="Show only the selection (I)">{isolate ? 'Show all' : 'Isolate'}</button>
        <button className={`btn ghost${spotlight ? ' on' : ''}`} onClick={() => setSpotlight(v => !v)} title="Grey out everything else">{spotlight ? 'Spotlight on' : 'Spotlight off'}</button>
      </div>
      {colourOpen && (
        <div className="pt-colour-pop">
          <div className="pt-colour-scope">
            <button className={colourScope === 'step' ? 'on' : ''} onClick={() => setColourScope('step')} title="A colour delta on this step; the operator sees it from here on">From this step on</button>
            <button className={colourScope === 'model' ? 'on' : ''} onClick={() => setColourScope('model')} title="Written into the model: every step, every player">Whole model</button>
          </div>
          <div className="pt-swatches">
            {SWATCHES.map(([name, rgb]) => <button key={name} className="pt-swatch-btn" style={{ background: `rgb(${Math.round(rgb[0] * 255)} ${Math.round(rgb[1] * 255)} ${Math.round(rgb[2] * 255)})` }} title={name} onClick={() => (colourScope === 'step' ? colourStep(focusList, rgb) : colourModel(focusList, rgb))} />)}
            <label className="pt-swatch-btn pt-swatch-custom" title="Any colour"><input type="color" onChange={e => { const h = e.target.value; const rgb: [number, number, number] = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number]; colourScope === 'step' ? colourStep(focusList, rgb) : colourModel(focusList, rgb); }} /></label>
            <button className="btn ghost" onClick={() => (colourScope === 'step' ? colourStep(focusList, null) : colourModel(focusList, null))}>Clear</button>
          </div>
        </div>
      )}
      {note && <div className="pt-note ok">{note}</div>}
    </div>
  ) : null;

  // Named groups (map-level): apply adds the group's parts; save captures this step's list.
  const groups = assembly?.groups ?? [];
  const writeGroups = (next: { name: string; parts: string[] }[]) => {
    if (!assembly) return;
    updateSettings({ assembly: { ...assembly, ...(next.length ? { groups: next } : { groups: undefined }) } });
  };
  const applyGroup = (g: { name: string; parts: string[] }) => {
    const all = g.parts.every(p => partSet.has(p));
    write(all ? parts.filter(p => !g.parts.includes(p)) : [...parts, ...g.parts.filter(p => !partSet.has(p))]);
  };
  const saveGroup = () => {
    if (!parts.length) return;
    const name = window.prompt('Name this part set (e.g. "Bolt set A"):', '')?.trim();
    if (!name) return;
    writeGroups([...groups.filter(g => g.name !== name), { name, parts: [...parts] }]);
  };
  const removeGroup = (name: string) => { if (window.confirm(`Delete part set "${name}"?`)) writeGroups(groups.filter(g => g.name !== name)); };
  const groupsBlock = (
    <div className="pt-groups">
      {groups.map(g => {
        const all = g.parts.every(p => partSet.has(p));
        return (
          <span key={g.name} className={`pt-group${all ? ' on' : ''}`} title={`${g.parts.length} part${g.parts.length === 1 ? '' : 's'} - click to ${all ? 'remove from' : 'add to'} this step`}>
            <button className="pt-group-apply" onClick={() => applyGroup(g)}>{g.name} <small>{g.parts.length}</small></button>
            <button className="pt-group-x" onClick={() => removeGroup(g.name)} title="Delete this part set">✕</button>
          </span>
        );
      })}
      <button className="btn ghost pt-group-save" onClick={saveGroup} disabled={!parts.length} title="Save this step's parts as a reusable set">+ Save as set</button>
    </div>
  );
  const toggleOpen = (name: string) => setOpen(prev => { const n = new Set(prev); if (n.has(name)) n.delete(name); else n.add(name); return n; });

  const q = query.trim().toLowerCase();
  const matches = (n: GlbPartNode): boolean => !q || n.name.toLowerCase().includes(q) || (labels[n.name] || '').toLowerCase().includes(q) || n.children.some(matches);
  const verb = assembly?.start === 'complete' ? 'removes' : 'installs';
  // Build-up starts empty: a part no step installs is simply not there yet.
  const buildUp = !!assembly && assembly.start !== 'complete';

  const renderNode = (n: GlbPartNode, depth: number): JSX.Element | null => {
    if (!matches(n)) return null;
    const isOpen = open.has(n.name) || !!q;
    const own = partSet.has(n.name);
    const eff = effectiveState(n.name, states, parents) ?? (buildUp ? 'after' : undefined);
    const viaParent = !own && eff === 'this';
    const cls = eff === 'this' ? 'is-this' : eff === 'before' ? 'is-before' : eff === 'after' ? 'is-after' : '';
    return (
      <div key={`${n.index}-${n.name}`} className="pt-node">
        <div className={`pt-row ${cls}${viaParent ? ' via-parent' : ''}`} style={{ paddingLeft: 6 + depth * 12 }}>
          {n.children.length > 0
            ? <button className="pt-twisty" onClick={() => toggleOpen(n.name)} title={isOpen ? 'Collapse' : 'Expand'}>{isOpen ? '▾' : '▸'}</button>
            : <span className="pt-twisty pt-leaf">·</span>}
          <label className="pt-label" title={viaParent ? `${n.name} - included with its group` : n.name}>
            <input type="checkbox" checked={own || viaParent} onChange={() => toggle(n.name)} />
          </label>
          <span className={`pt-name pt-name-btn${focusList.includes(n.name) ? ' is-focus' : ''}${hover === n.name ? ' is-hover' : ''}`} data-part={n.name} title={labels[n.name] ? `${labels[n.name]} - ${n.name} - click to find it` : 'Click to find this part in the 3D view · shift-click adds to the selection'} onClick={e => focusOn((e.shiftKey ? '+' : '') + n.name)}>{label(n.name)}</span>
          {n.children.length > 0 && own && <span className="pt-tag pt-tag-group">group</span>}
          {eff === 'before' && <span className="pt-tag">earlier</span>}
          {eff === 'after'  && <span className="pt-tag pt-tag-after">later</span>}
        </div>
        {isOpen && n.children.map(c => renderNode(c, depth + 1))}
      </div>
    );
  };

  const chips = parts.length > 0 ? (
    <div className="pt-chips">
      {parts.map(p => (
        <span key={p} className={`pt-chip${focusList.includes(p) ? ' is-focus' : ''}`} title={p} onClick={e => focusOn((e.shiftKey ? '+' : '') + p)}>
          <span className="pt-chip-name">{label(p)}</span>
          <button onClick={e => { e.stopPropagation(); toggle(p); }} title="Remove from this step">✕</button>
        </span>
      ))}
    </div>
  ) : <span className="step-check-hint">No parts on this step yet - double-click one in the 3D view, or tick it in the tree.</span>;
  const familyBlock = colours?.partFamilies ? (() => {
    const groups = new Map<string, string[]>();
    for (const [part, fam] of Object.entries(colours.partFamilies)) { if (q && !part.toLowerCase().includes(q) && !fam.includes(q) && !(labels[part] || '').toLowerCase().includes(q)) continue; (groups.get(fam) ?? groups.set(fam, []).get(fam)!).push(part); }
    const rows = [...groups.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
    return (
      <div className="pt-tree pt-fams">
        {rows.map(([fam, members]) => {
          const c = familyColour(fam); const isOpen = open.has('fam:' + fam) || !!q;
          const on = members.every(m => partSet.has(m)); const anyFocus = members.some(m => focusList.includes(m));
          return (
            <div key={fam} className="pt-node">
              <div className={`pt-row pt-fam-row${anyFocus ? ' is-this' : ''}`}>
                <button className="pt-twisty" onClick={() => toggleOpen('fam:' + fam)}>{isOpen ? '▾' : '▸'}</button>
                <span className="pt-swatch" style={c ? { background: `rgb(${Math.round(c[0] * 255)} ${Math.round(c[1] * 255)} ${Math.round(c[2] * 255)})` } : undefined} />
                <span className="pt-name pt-name-btn" onClick={() => focusFamily(fam)} title="Select every part of this family">{labels[members[0]] && members.every(m => labels[m] === labels[members[0]]) ? labels[members[0]] : fam}</span>
                <span className="pt-tag">{members.length}</span>
                <button className="pt-mini" onClick={() => renameFamily(fam)} title="Name the whole family">name</button>
                <button className="pt-mini" onClick={() => write(on ? parts.filter(p => !members.includes(p)) : [...parts, ...members.filter(m => !partSet.has(m))])} title={on ? 'Remove all from this step' : 'Add all to this step'}>{on ? 'remove all' : 'add all'}</button>
              </div>
              {isOpen && members.map(m => (
                <div key={m} className={`pt-row${partSet.has(m) ? ' is-this' : ''}`} style={{ paddingLeft: 26 }}>
                  <label className="pt-label"><input type="checkbox" checked={partSet.has(m) || effectiveState(m, states, parents) === 'this'} onChange={() => toggle(m)} /></label>
                  <span className={`pt-name pt-name-btn${focusList.includes(m) ? ' is-focus' : ''}${hover === m ? ' is-hover' : ''}`} data-part={m} title={m} onClick={e => focusOn((e.shiftKey ? '+' : '') + m)}>{label(m)}</span>
                </div>
              ))}
            </div>
          );
        })}
        {rows.length === 0 && <span className="step-check-hint">No part matches.</span>}
      </div>
    );
  })() : null;
  const treeBlock = (
    <>
      {treeErr && <span className="step-check-hint">Couldn't read the model's parts: {treeErr}</span>}
      {!tree && !treeErr && modelId && <span className="step-check-hint">Reading parts…</span>}
      {tree && groupByFamily && familyBlock}
      {tree && !groupByFamily && (
        <div className="pt-tree">
          {tree.roots.map(r => renderNode(r, 0))}
          {tree.nodeCount === 0 && <span className="step-check-hint">This model has no named parts.</span>}
        </div>
      )}
    </>
  );
  const viewControls = (
    <div className="pt-view">
      <button className={`btn ghost${groupByFamily ? ' on' : ''}`} onClick={() => setGroupByFamily(v => !v)} disabled={!colours?.partFamilies} title="List parts by family (BOLT_M6_01 and _02 together) instead of the CAD tree">By family</button>
      <button className={`btn ghost${colourByFamily ? ' on' : ''}`} onClick={() => setColourByFamily(v => !v)} disabled={!colours?.partFamilies} title="Tint each family in the view only - the model is not changed">Colour by family</button>
    </div>
  );
  const search = <input className="pt-search" placeholder="Find a part…" value={query} onChange={e => setQuery(e.target.value)} />;
  const summary = assembly ? (
    <span className="step-check-hint"> - {parts.length} chosen · {earlier.size} {assembly.start === 'complete' ? 'removed' : 'installed'} earlier</span>
  ) : null;

  return { assembly, modelId, tree, parts, earlier, states, partNames, parents, toggle, verb, chips, treeBlock, search, summary, groupsBlock, buildUp, contextBlock, context, poses, play,
    focus, focusList, isolate, setIsolate, spotlight, focusOn, setFocusInfo, focusBlock, viewControls, colourBy, labels, setHover, focusLabel: focus ? label(focus) : undefined, modelReload, note, hasDeltas, stepColours,
    toggleShown: () => { if (focusList.length) setShownMany(focusList, !(focusInfo?.visible ?? true)); } };
}

// ── Inspector block ──────────────────────────────────────────────────────────

export function PartsSection({ nodeId }: { nodeId: string }): JSX.Element | null {
  const pk = usePartsPicker(nodeId);
  const [showPreview, setShowPreview] = useState(true);
  const openStudio = useStore(s => s.openPartsStudio);
  const studioOpen = useStore(s => s.partsStudioNodeId !== null);

  if (!pk.assembly) {
    return (
      <div className="parts-section">
        <div className="inspector-field">Parts on this step
          <span className="step-check-hint"> - choose the assembly model in the procedure bar first.</span>
        </div>
      </div>
    );
  }
  const { modelId, tree, partNames, states, parents, toggle, verb, chips, treeBlock, search, summary, groupsBlock } = pk;

  return (
    <div className="parts-section">
      <div className="inspector-field">Parts this step {verb}{summary}</div>
      {chips}
      {groupsBlock}
      {pk.contextBlock}
      {showPreview && modelId && tree && !studioOpen && (
        <AssemblyPreview modelId={modelId} partNames={partNames} states={states} parents={parents} unmentioned={pk.buildUp ? 'after' : 'base'} context={pk.context} poses={pk.poses} play={pk.play} onPick={toggle} onFocus={pk.focusOn} focus={pk.focusList} spotlight={pk.spotlight} isolate={pk.isolate} focusLabel={pk.focusLabel} colourBy={pk.colourBy} onHover={pk.setHover} onFocusInfo={pk.setFocusInfo} onExpand={() => openStudio(nodeId)} />
      )}
      {pk.focusBlock}
      <div className="pt-toolbar">
        {search}
        <button className="btn ghost" onClick={() => setShowPreview(v => !v)}>{showPreview ? 'Hide 3D' : 'Show 3D'}</button>
        {modelId && tree && <button className="btn ghost" onClick={() => openStudio(nodeId)} title="Open the model large with step navigation">⤢ Studio</button>}
      </div>
      {treeBlock}
    </div>
  );
}

// ── Parts Studio (full screen, step navigation) ─────────────────────────────

export function PartsStudio(): JSX.Element | null {
  const nodeId   = useStore(s => s.partsStudioNodeId);
  const [tab, setTab] = useState<'parts' | 'chosen' | 'colours'>('parts');
  const [reload, setReload] = useState(0);
  const undo = useStore(s => s.undo); const redo = useStore(s => s.redo);
  const canUndo = useStore(s => s.undoStack.length > 0); const canRedo = useStore(s => s.redoStack.length > 0);
  // The coach: contextual, on by default for the first few visits, toggled by ?.
  const [coach, setCoach] = useState(() => { try { const n = Number(localStorage.getItem('sib.studio.visits') || 0); localStorage.setItem('sib.studio.visits', String(n + 1)); return n < 3; } catch { return true; } });
  const close    = useStore(s => s.closePartsStudio);
  const open     = useStore(s => s.openPartsStudio);
  const select   = useStore(s => s.select);
  const order    = useStore(s => s.procedure?.order);
  const mapNodes = useStore(s => s.map?.nodes);
  const validate = useStore(s => s.validateProcedure);
  const pk = usePartsPicker(nodeId);

  // Steps in compiled order; unsequenced nodes (not yet connected) trail.
  const steps = useMemo(() => {
    if (!mapNodes) return [];
    const seqd = mapNodes.filter(n => order?.[n.id] !== undefined).sort((a, b) => (order![a.id] ?? 0) - (order![b.id] ?? 0));
    return seqd.map(n => ({ id: n.id, seq: order![n.id], title: n.text, parts: partsOfStep(n.metadata?.step as Record<string, unknown> | undefined).length }));
  }, [mapNodes, order]);
  const idx = steps.findIndex(s => s.id === nodeId);
  const goTo = (id: string) => { open(id); select(id); };
  const prev = () => { if (idx > 0) goTo(steps[idx - 1].id); };
  const next = () => { if (idx >= 0 && idx < steps.length - 1) goTo(steps[idx + 1].id); };

  // No order yet (map never validated) → get one so the strip has numbers.
  useEffect(() => { if (nodeId && !order) void validate(); }, [nodeId, order, validate]);

  useEffect(() => {
    if (!nodeId) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if ((e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (e.key === '?') { setCoach(v => !v); return; }
      if (e.key === 'Escape') { if (pk.focusList.length) pk.focusOn(null); else close(); }
      else if (e.key === 'ArrowLeft') prev();
      else if (e.key === 'ArrowRight') next();
      else if ((e.key === 'i' || e.key === 'I') && pk.focus) pk.setIsolate(v => !v);
      else if ((e.key === 'h' || e.key === 'H') && pk.focus) pk.toggleShown();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!nodeId || !pk.assembly || !pk.modelId) return null;
  const cur = steps[idx];
  const title = cur ? `Step ${cur.seq} · ${cur.title}` : (mapNodes?.find(n => n.id === nodeId)?.text ?? 'Step');

  return (
    <div className="pt-modal ax-studio" role="dialog" aria-label="3D Studio">
      <header className="st-head">
        <span className="ax-wordmark"><span className="ax-a">applied</span><span className="ax-x">x</span><span className="ax-rest">3D Studio</span></span>
        <div className="st-nav">
          <button className="ax-btn ax-btn--quiet ax-btn--sm" onClick={prev} disabled={idx <= 0} title="Previous step (←)">◀</button>
          <div className="st-title"><span className="ax-eyebrow">Step {cur ? cur.seq : '·'} of {steps.length || '·'}</span><b>{cur ? cur.title : title}</b><span className="ax-label-s ax-muted">parts this step {pk.verb}{pk.summary}</span></div>
          <button className="ax-btn ax-btn--quiet ax-btn--sm" onClick={next} disabled={idx < 0 || idx >= steps.length - 1} title="Next step (→)">▶</button>
        </div>
        <button className="ax-btn ax-btn--quiet ax-btn--sm" onClick={undo} disabled={!canUndo} title="Undo (⌘Z)">Undo</button>
        <button className="ax-btn ax-btn--quiet ax-btn--sm" onClick={redo} disabled={!canRedo} title="Redo (⇧⌘Z)">Redo</button>
        <button className={`ax-btn ax-btn--sm${coach ? ' ax-btn--tint' : ' ax-btn--quiet'}`} onClick={() => setCoach(v => !v)} title="Coach: what you can do here, right now (?)" aria-label="Coach">?</button>
        <button className="ax-btn ax-btn--sm" onClick={close}>Close</button>
      </header>
      <div className="st-strip">
        {steps.map(s => (
          <button key={s.id} className={`ax-chip ax-chip--text ax-chip--interactive st-step${s.id === nodeId ? ' is-on' : ''}${s.parts === 0 ? ' is-empty' : ''}`}
            onClick={() => goTo(s.id)} title={`${s.title} - ${s.parts} part${s.parts === 1 ? '' : 's'}`}>
            <span className="st-step-n">{s.seq}</span><span className="st-step-t">{s.title}</span><span className="st-step-c">{s.parts}</span>
          </button>
        ))}
        {steps.length === 0 && <span className="ax-label-s ax-muted">Connect the steps with Next edges to walk them here.</span>}
      </div>
      <div className="st-body">
        <div className="st-stage">
          {pk.tree && (
            <AssemblyPreview key={reload + pk.modelReload * 1000} modelId={pk.modelId} partNames={pk.partNames} states={pk.states} parents={pk.parents} unmentioned={pk.buildUp ? 'after' : 'base'} context={pk.context} poses={pk.poses} play={pk.play} onPick={pk.toggle} onFocus={pk.focusOn} focus={pk.focusList} spotlight={pk.spotlight} isolate={pk.isolate} focusLabel={pk.focusLabel} colourBy={pk.colourBy} onHover={pk.setHover} onFocusInfo={pk.setFocusInfo} fill />
          )}
        </div>
        <aside className="st-side">
          {coach && <StudioCoach pk={pk} stepTitle={cur?.title} onClose={() => setCoach(false)} />}
          {pk.focusBlock}
          <div className="ax-seg st-tabs" role="tablist">
            {([['parts', 'Parts'], ['chosen', `Chosen · ${pk.parts.length}`], ['colours', 'Colours']] as const).map(([id, label]) => (
              <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'is-on' : ''} onClick={() => setTab(id)}>{label}</button>
            ))}
          </div>
          {tab === 'parts' && (<>
            <div className="ax-card pt-card pt-card-grow">
              <div className="pt-card-title">All parts <span className="pt-card-sub">click a name to find it · tick to add</span></div>
              {pk.search}
              {pk.viewControls}
              {pk.treeBlock}
            </div>
            <div className="ax-card pt-card">{pk.contextBlock}</div>
          </>)}
          {tab === 'chosen' && (<>
            <div className="ax-card pt-card pt-card-grow">
              <div className="pt-card-title">Parts this step {pk.verb} <span className="pt-card-sub">{pk.parts.length}</span></div>
              <div className="pt-chips-scroll">{pk.chips}</div>
            </div>
            <div className="ax-card pt-card"><div className="pt-card-title">Part sets <span className="pt-card-sub">reusable groups</span></div>{pk.groupsBlock}</div>
          </>)}
          {tab === 'colours' && <ColoursPanel modelId={pk.modelId} onApplied={() => setReload(r => r + 1)} />}
        </aside>
      </div>
    </div>
  );
}


// ── The Studio coach: what you can do here, right now ────────────────────────
// Reads the state (nothing selected · one part · several · a check step) and
// says the next useful thing in one or two lines, with the actions as links.
function StudioCoach({ pk, stepTitle, onClose }: { pk: ReturnType<typeof usePartsPicker>; stepTitle?: string; onClose: () => void }): JSX.Element {
  const n = pk.focusList.length;
  const name = pk.focus ? pk.focusLabel ?? pk.focus : '';
  let title: string, body: JSX.Element;
  if (!pk.parts.length && n === 0) {
    title = `Step ${stepTitle ? `· ${stepTitle}` : ''}`.trim() + ' - nothing chosen yet';
    body = <>Click a part in the view to find it, then <b>Add to step</b>. Or tick parts in the tree. Use <b>By family</b> to pick all bolts at once.</>;
  } else if (n === 0) {
    title = `${pk.parts.length} part${pk.parts.length === 1 ? '' : 's'} on this step`;
    body = <>Click a part to adjust how it appears in AR: colour it, hide it, rename it. Shift-click selects several. <b>Play step</b> shows the operator's view.</>;
  } else if (n === 1) {
    title = `${name} selected`;
    body = <>
      <b>Colour…</b> gives it a colour from this step on, or in the whole model. <b>Hide on this step</b> keeps it out of this step only; <b>Hide in whole guide</b> keeps it out of every step.
      {pk.labels[pk.focus!] ? null : <> Its CAD name is hard to read - <b>rename</b> it so the glasses say something a technician recognises.</>}
      {' '}⌘Z undoes any of it.
    </>;
  } else {
    title = `${n} parts selected`;
    body = <>Every action on the card applies to all of them: colour, hide, add to step. Click one of them again to drop it; Esc clears the selection.</>;
  }
  return (
    <div className="ax-card pt-coach">
      <div className="pt-coach-head"><span className="ax-mark is-cyan"><i></i><em></em></span><b>{title}</b><button className="pt-focus-x" onClick={onClose} title="Hide the coach (?)">✕</button></div>
      <div className="pt-coach-body">{body}</div>
      <div className="pt-coach-keys">← → steps · F fit · Z frame · I isolate · H hide / show · ⌘Z undo · Esc clear</div>
    </div>
  );
}
