// PartsSection.tsx — "Parts on this step" for procedure maps (2026.4.46).
//
// The author thinks additively: which parts does THIS step install? The
// section stores just that list (metadata.step.parts); the cumulative state
// — installed earlier / this step / not yet — is derived from the compiled
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
import { mindmapApi, type GlbPartNode, type GlbPartTree } from '../api/mindmap-api.js';
import { AssemblyPreview, type PartState } from './AssemblyPreview.js';

// One tree per model per session — the picker opens on every step.
const treeCache = new Map<string, Promise<GlbPartTree>>();
function loadTree(modelId: string): Promise<GlbPartTree> {
  let p = treeCache.get(modelId);
  if (!p) { p = mindmapApi.modelNodes(modelId); treeCache.set(modelId, p); p.catch(() => treeCache.delete(modelId)); }
  return p;
}

/** Parts a step lists — `parts` when edited here, else the imported non-hidden nodes. */
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

  const modelId = assembly?.modelId;
  useEffect(() => {
    if (!modelId) { setTree(null); return; }
    let live = true;
    setTree(null); setTreeErr(null);
    loadTree(modelId).then(t => { if (live) setTree(t); }).catch(e => { if (live) setTreeErr((e as Error).message); });
    return () => { live = false; };
  }, [modelId]);

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

  const write = (next: string[]) => { if (nodeId) patchStepMeta(nodeId, { parts: next }); };
  const toggle = (name: string) => write(partSet.has(name) ? parts.filter(p => p !== name) : [...parts, name]);
  const toggleOpen = (name: string) => setOpen(prev => { const n = new Set(prev); if (n.has(name)) n.delete(name); else n.add(name); return n; });

  const q = query.trim().toLowerCase();
  const matches = (n: GlbPartNode): boolean => !q || n.name.toLowerCase().includes(q) || n.children.some(matches);
  const verb = assembly?.start === 'complete' ? 'removes' : 'installs';

  const renderNode = (n: GlbPartNode, depth: number): JSX.Element | null => {
    if (!matches(n)) return null;
    const isOpen = open.has(n.name) || !!q;
    const own = partSet.has(n.name);
    const eff = effectiveState(n.name, states, parents);
    const viaParent = !own && eff === 'this';
    const cls = eff === 'this' ? 'is-this' : eff === 'before' ? 'is-before' : eff === 'after' ? 'is-after' : '';
    return (
      <div key={`${n.index}-${n.name}`} className="pt-node">
        <div className={`pt-row ${cls}${viaParent ? ' via-parent' : ''}`} style={{ paddingLeft: 6 + depth * 12 }}>
          {n.children.length > 0
            ? <button className="pt-twisty" onClick={() => toggleOpen(n.name)} title={isOpen ? 'Collapse' : 'Expand'}>{isOpen ? '▾' : '▸'}</button>
            : <span className="pt-twisty pt-leaf">·</span>}
          <label className="pt-label" title={viaParent ? `${n.name} — included with its group` : n.name}>
            <input type="checkbox" checked={own || viaParent} onChange={() => toggle(n.name)} />
            <span className="pt-name">{n.name}</span>
          </label>
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
        <span key={p} className="pt-chip" title={p}>
          <span className="pt-chip-name">{p}</span>
          <button onClick={() => toggle(p)} title="Remove from this step">✕</button>
        </span>
      ))}
    </div>
  ) : null;
  const treeBlock = (
    <>
      {treeErr && <span className="step-check-hint">Couldn't read the model's parts: {treeErr}</span>}
      {!tree && !treeErr && modelId && <span className="step-check-hint">Reading parts…</span>}
      {tree && (
        <div className="pt-tree">
          {tree.roots.map(r => renderNode(r, 0))}
          {tree.nodeCount === 0 && <span className="step-check-hint">This model has no named parts.</span>}
        </div>
      )}
    </>
  );
  const search = <input className="pt-search" placeholder="Find a part…" value={query} onChange={e => setQuery(e.target.value)} />;
  const summary = assembly ? (
    <span className="step-check-hint"> — {parts.length} chosen · {earlier.size} {assembly.start === 'complete' ? 'removed' : 'installed'} earlier</span>
  ) : null;

  return { assembly, modelId, tree, parts, earlier, states, partNames, parents, toggle, verb, chips, treeBlock, search, summary };
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
          <span className="step-check-hint"> — choose the assembly model in the procedure bar first.</span>
        </div>
      </div>
    );
  }
  const { modelId, tree, partNames, states, parents, toggle, verb, chips, treeBlock, search, summary } = pk;

  return (
    <div className="parts-section">
      <div className="inspector-field">Parts this step {verb}{summary}</div>
      {chips}
      {showPreview && modelId && tree && !studioOpen && (
        <AssemblyPreview modelId={modelId} partNames={partNames} states={states} parents={parents} onPick={toggle} onExpand={() => openStudio(nodeId)} />
      )}
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
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowLeft') prev();
      else if (e.key === 'ArrowRight') next();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!nodeId || !pk.assembly || !pk.modelId) return null;
  const cur = steps[idx];
  const title = cur ? `Step ${cur.seq} · ${cur.title}` : (mapNodes?.find(n => n.id === nodeId)?.text ?? 'Step');

  return (
    <div className="pt-modal" role="dialog" aria-label="Parts studio">
      <div className="pt-modal-head">
        <div className="pt-nav">
          <button className="btn" onClick={prev} disabled={idx <= 0} title="Previous step (←)">◀</button>
          <div className="pt-modal-title"><b>{title}</b> — parts this step {pk.verb}{pk.summary}</div>
          <button className="btn" onClick={next} disabled={idx < 0 || idx >= steps.length - 1} title="Next step (→)">▶</button>
        </div>
        <button className="btn" onClick={close}>Close ✕</button>
      </div>
      <div className="pt-modal-body">
        <div className="pt-modal-main">
          <div className="pt-modal-3d">
            {pk.tree && (
              <AssemblyPreview modelId={pk.modelId} partNames={pk.partNames} states={pk.states} parents={pk.parents} onPick={pk.toggle} fill />
            )}
          </div>
          {/* Step strip: every step, its part count, click to jump. */}
          <div className="pt-strip">
            {steps.map(s => (
              <button key={s.id} className={`pt-step${s.id === nodeId ? ' on' : ''}${s.parts === 0 ? ' empty' : ''}`}
                onClick={() => goTo(s.id)} title={`${s.title} — ${s.parts} part${s.parts === 1 ? '' : 's'}`}>
                <span className="pt-step-n">{s.seq}</span>
                <span className="pt-step-t">{s.title}</span>
                <span className="pt-step-c">{s.parts}</span>
              </button>
            ))}
            {steps.length === 0 && <span className="step-check-hint">Connect the steps with Next edges to walk them here.</span>}
          </div>
        </div>
        <div className="pt-modal-side">
          {pk.chips}
          {pk.search}
          {pk.treeBlock}
        </div>
      </div>
    </div>
  );
}
