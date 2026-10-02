// NeedsSection.tsx - what a step needs from a device, as chips the author can correct.
//
// The readiness matrix (docs/ar-ojt/DEVICE-ADAPTIVE-INSTRUCTIONS.md) derives
// each step's needs from its data: text, a place on the tool (spatial), motion,
// parts to find (part-id), an image (media), hands busy. Here the author sees
// that derivation and can override it (metadata.step.needs); the compiler
// carries the override into GuideStep.needs and readiness.ts honours it.
// The derivation below mirrors sib/src/guides/readiness.ts stepNeeds().

import { useMemo, type JSX } from 'react';
import { useStore } from '../state/store.js';

const NEEDS = ['text', 'spatial', 'motion', 'part-id', 'media', 'hands-busy'] as const;
type Need = (typeof NEEDS)[number];
const LABEL: Record<Need, string> = { text: 'Text', spatial: 'Place on the tool', motion: 'Motion', 'part-id': 'Find parts', media: 'Image', 'hands-busy': 'Hands busy' };
const WHY: Record<Need, string> = {
  text: 'Any display or spoken form carries it.',
  spatial: 'Needs an overlay or words for where (a pin or a view on this step).',
  motion: 'Needs a model that moves; text and spoken forms describe it instead.',
  'part-id': 'Needs the part shown or named so the technician can find it.',
  media: 'An image is attached; small displays shrink it, text forms skip it.',
  'hands-busy': 'The step reads like both hands are occupied: voice or a ring beats a touchpad.',
};
const HANDS_BUSY = /\b(torque|hold(?:ing)?|while (?:hold|press|insert)|press and hold|both hands|tighten|keep pressing|thread|screw in|insert while)\b/i;

export function derivedNeeds(title: string, step: Record<string, unknown>): Need[] {
  const out = new Set<Need>();
  const text = `${title} ${(step.ttsText as string) ?? ''}`.trim();
  if (text) out.add('text');
  if (step.cadPosition || step.view) out.add('spatial');
  const nodes = (Array.isArray(step.nodes) ? step.nodes : []) as Array<Record<string, unknown>>;
  if (nodes.some(n => n.animate || (n.from && n.to) || (n.rotationFrom && n.rotationTo) || /#s\d+f\d+$/.test(String(n.node)))) out.add('motion');
  if (nodes.some(n => n.show === 'solid' || n.animate === 'insert' || n.color) || (Array.isArray(step.parts) && step.parts.length)) out.add('part-id');
  if (step.imageFile) out.add('media');
  if (HANDS_BUSY.test(text)) out.add('hands-busy');
  return NEEDS.filter(n => out.has(n));
}

export function NeedsSection({ nodeId }: { nodeId: string }): JSX.Element | null {
  const node = useStore(s => s.map?.nodes.find(n => n.id === nodeId));
  const isProcedure = useStore(s => s.map?.kind === 'procedure');
  const patchStepMeta = useStore(s => s.patchStepMeta);
  const step = (node?.metadata?.step ?? {}) as Record<string, unknown>;
  const derived = useMemo(() => derivedNeeds(node?.text ?? '', step), [node?.text, step]);
  if (!isProcedure || !node) return null;
  const override = Array.isArray(step.needs) ? (step.needs as string[]).filter((n): n is Need => (NEEDS as readonly string[]).includes(n)) : null;
  const active = new Set<Need>(override ?? derived);
  const toggle = (n: Need) => {
    const next = new Set(active); if (next.has(n)) next.delete(n); else next.add(n);
    const list = NEEDS.filter(x => next.has(x));
    // Back to the derivation when the author's list equals it; else store the override.
    const same = list.length === derived.length && list.every((x, i) => x === derived[i]);
    patchStepMeta(nodeId, { needs: same ? null : list });
  };
  return (
    <div className="needs-section">
      <div className="inspector-field">What this step needs from a device
        <span className="step-check-hint"> - {override ? 'set by you' : 'read from the step'}; drives Device readiness</span>
      </div>
      <div className="needs-chips">
        {NEEDS.map(n => (
          <button key={n} className={`needs-chip${active.has(n) ? ' on' : ''}${derived.includes(n) !== active.has(n) ? ' changed' : ''}`} onClick={() => toggle(n)} title={WHY[n]}>{LABEL[n]}</button>
        ))}
        {override && <button className="btn ghost needs-reset" onClick={() => patchStepMeta(nodeId, { needs: null })} title="Back to what the step data says">reset</button>}
      </div>
    </div>
  );
}
