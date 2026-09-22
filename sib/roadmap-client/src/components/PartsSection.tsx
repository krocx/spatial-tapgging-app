// PartsSection.tsx — "Parts on this step" for procedure maps (2026.4.46).
//
// The author thinks additively: which parts does THIS step install? The
// section stores just that list (metadata.step.parts); the cumulative state
// — installed earlier / this step / not yet — is derived from the compiled
// order and shown in the tree and the 3D preview, so the author sees the
// assembly grow while clicking through steps. See docs/PROCEDURE-DESIGNER.md.
//
// Hooks are unconditional; the bail-out sits below them (React #310 lesson).

import { useEffect, useMemo, useState } from 'react';
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

export function PartsSection({ nodeId }: { nodeId: string }): JSX.Element | null {
  const assembly   = useStore(s => s.map?.settings?.assembly);
  const order      = useStore(s => s.procedure?.order);
  const mapNodes   = useStore(s => s.map?.nodes);
  const patchStepMeta = useStore(s => s.patchStepMeta);
  const stepMeta   = useStore(s => s.map?.nodes.find(n => n.id === nodeId)?.metadata?.step as Record<string, unknown> | undefined);

  const [tree, setTree]     = useState<GlbPartTree | null>(null);
  const [treeErr, setTreeErr] = useState<string | null>(null);
  const [query, setQuery]   = useState('');
  const [open, setOpen]     = useState<Set<string>>(() => new Set());
  const [showPreview, setShowPreview] = useState(true);

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

  // Cumulative state at this step from the compiled order (steps before this
  // one, by sequence number). Without an order (map not yet validated) only
  // "this step" is known.
  const { earlier, states, partNames } = useMemo(() => {
    const names = new Set(tree?.names ?? []);
    const earlier = new Set<string>();
    const mySeq = order?.[nodeId];
    if (order && mySeq !== undefined && mapNodes) {
      for (const n of mapNodes) {
        const seq = order[n.id];
        if (seq === undefined || seq >= mySeq) continue;
        for (const p of partsOfStep(n.metadata?.step as Record<string, unknown> | undefined)) earlier.add(p);
      }
    }
    const states = new Map<string, PartState>();
    const mentioned = new Set<string>();
    if (mapNodes) for (const n of mapNodes) for (const p of partsOfStep(n.metadata?.step as Record<string, unknown> | undefined)) mentioned.add(p);
    for (const p of mentioned) states.set(p, partSet.has(p) ? 'this' : earlier.has(p) ? 'before' : 'after');
    // Disassembly reads the other way round: earlier steps REMOVED their parts.
    if (assembly?.start === 'complete') {
      for (const [p, st] of states) states.set(p, st === 'before' ? 'after' : st === 'after' ? 'before' : st);
    }
    return { earlier, states, partNames: names };
  }, [tree, order, nodeId, mapNodes, partSet, assembly?.start]);

  if (!assembly) {
    return (
      <div className="parts-section">
        <div className="inspector-field">Parts on this step
          <span className="step-check-hint"> — choose the assembly model in the procedure bar first.</span>
        </div>
      </div>
    );
  }

  const write = (next: string[]) => patchStepMeta(nodeId, { parts: next });
  const toggle = (name: string) => write(partSet.has(name) ? parts.filter(p => p !== name) : [...parts, name]);
  const toggleOpen = (name: string) => setOpen(prev => { const n = new Set(prev); if (n.has(name)) n.delete(name); else n.add(name); return n; });

  const q = query.trim().toLowerCase();
  const matches = (n: GlbPartNode): boolean => !q || n.name.toLowerCase().includes(q) || n.children.some(matches);
  const verb = assembly.start === 'complete' ? 'removes' : 'installs';

  const renderNode = (n: GlbPartNode, depth: number): JSX.Element | null => {
    if (!matches(n)) return null;
    const isOpen = open.has(n.name) || !!q;
    const state = states.get(n.name);
    const cls = state === 'this' ? 'is-this' : state === 'before' ? 'is-before' : state === 'after' ? 'is-after' : '';
    return (
      <div key={`${n.index}-${n.name}`} className="pt-node">
        <div className={`pt-row ${cls}`} style={{ paddingLeft: 6 + depth * 12 }}>
          {n.children.length > 0
            ? <button className="pt-twisty" onClick={() => toggleOpen(n.name)} title={isOpen ? 'Collapse' : 'Expand'}>{isOpen ? '▾' : '▸'}</button>
            : <span className="pt-twisty pt-leaf">·</span>}
          <label className="pt-label" title={n.name}>
            <input type="checkbox" checked={partSet.has(n.name)} onChange={() => toggle(n.name)} />
            <span className="pt-name">{n.name}</span>
          </label>
          {state === 'before' && <span className="pt-tag">earlier</span>}
          {state === 'after'  && <span className="pt-tag pt-tag-after">later</span>}
        </div>
        {isOpen && n.children.map(c => renderNode(c, depth + 1))}
      </div>
    );
  };

  return (
    <div className="parts-section">
      <div className="inspector-field">
        Parts this step {verb}
        <span className="step-check-hint"> — {parts.length} chosen · {earlier.size} {assembly.start === 'complete' ? 'removed' : 'installed'} earlier</span>
      </div>

      {parts.length > 0 && (
        <div className="pt-chips">
          {parts.map(p => (
            <span key={p} className="pt-chip" title={p}>
              <span className="pt-chip-name">{p}</span>
              <button onClick={() => toggle(p)} title="Remove from this step">✕</button>
            </span>
          ))}
        </div>
      )}

      {showPreview && modelId && tree && (
        <AssemblyPreview modelId={modelId} partNames={partNames} states={states} onPick={toggle} />
      )}

      <div className="pt-toolbar">
        <input className="pt-search" placeholder="Find a part…" value={query} onChange={e => setQuery(e.target.value)} />
        <button className="btn ghost" onClick={() => setShowPreview(v => !v)}>{showPreview ? 'Hide 3D' : 'Show 3D'}</button>
      </div>

      {treeErr && <span className="step-check-hint">Couldn't read the model's parts: {treeErr}</span>}
      {!tree && !treeErr && <span className="step-check-hint">Reading parts…</span>}
      {tree && (
        <div className="pt-tree">
          {tree.roots.map(r => renderNode(r, 0))}
          {tree.nodeCount === 0 && <span className="step-check-hint">This model has no named parts.</span>}
        </div>
      )}
    </div>
  );
}
