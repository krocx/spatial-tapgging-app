// pages.ts - a work-instruction step as one page of green text.
//
// The Even G2 shows a 576 x 288 canvas; one full-screen text container holds
// roughly 400 to 500 characters and scrolls in firmware past that. A page is:
//
//   3/12  Fit the O-ring
//   <instruction>
//   Where: left side, upper part
//   Parts: O-ring · Seal housing
//
// Pure functions, no SDK, so the composer is unit-tested on the server side
// (sib/test/g2-pages.test.ts) and shared with the phone mirror.
// Proprietary & Confidential · Applied Materials.

export interface PageStep {
  id: string;
  title?: string;
  text?: string;
  cadPosition?: [number, number, number] | number[];
  nodes?: { node: string; effect?: string; show?: boolean; color?: string; position?: unknown; rotation?: unknown; path?: unknown }[];
  validation?: { required?: boolean; mode?: string };
}
export interface Bounds { min: number[]; max: number[] }

/** Glasses budget: keep a page under this so a step reads without scrolling where it can. */
export const PAGE_BUDGET = 420;

/** Where a step happens, in words, from its pin against the assembly bounds. */
export function whereWords(step: PageStep, bounds?: Bounds | null): string {
  const p = step.cadPosition; const b = bounds;
  if (!p || !b || p.length < 3) return '';
  const rel = (a: number) => (p[a] - b.min[a]) / Math.max(1e-6, b.max[a] - b.min[a]);
  const x = rel(0), y = rel(1), z = rel(2);
  const w: string[] = [];
  w.push(x < 0.33 ? 'left side' : x > 0.67 ? 'right side' : 'centre');
  if (z < 0.33) w.push('towards the back'); else if (z > 0.67) w.push('towards the front');
  w.push(y > 0.67 ? 'upper part' : y < 0.33 ? 'lower part' : 'mid height');
  return w.join(', ');
}

/** The parts a step is about: nodes it moves, shows, hides or colours (a bare flash is not a part). */
export function stepParts(step: PageStep): string[] {
  const seen = new Set<string>();
  for (const d of step.nodes || []) {
    const hasMotion = d.position !== undefined || d.rotation !== undefined || d.path !== undefined;
    if (d.effect === 'flash' && d.show === undefined && !hasMotion && !d.color) continue;
    seen.add(d.node);
  }
  return [...seen];
}

export const partLabel = (n: string): string => n.replace(/^cmp:/, '').replace(/[_-]+/g, ' ').trim();

/** Collapse whitespace and drop glyphs the firmware font will not have. */
function clean(s: string): string {
  return s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, '...').replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();
}

export interface Page { text: string; overflow: boolean }

/** One step → one page. `index` is 0-based; `total` the step count. */
export function composePage(step: PageStep, index: number, total: number, bounds?: Bounds | null): Page {
  const head = `${index + 1}/${total}  ${clean(step.title || `Step ${index + 1}`)}`;
  const body = clean(step.text || '');
  const where = whereWords(step, bounds);
  const parts = stepParts(step).slice(0, 6).map(partLabel);
  const tail: string[] = [];
  if (where) tail.push(`Where: ${where}`);
  if (parts.length) tail.push(`Parts: ${parts.join(' - ')}`);
  if (step.validation?.required) tail.push('Check: Pass / Fail from the menu');
  const lines = [head, '', body, ...(tail.length ? ['', ...tail] : [])];
  const text = lines.join('\n');
  return { text, overflow: text.length > PAGE_BUDGET };
}

/** The end page after the last step. */
export function composeEnd(completed: number, total: number, failed: number): string {
  return `Done  ${completed}/${total} steps${failed ? `, ${failed} failed check` : ''}\n\nPress to sign off on the phone.\nDouble press to go back to the last step.`;
}

/** What the glasses show before a guide is loaded. */
export function composeIdle(serverSet: boolean): string {
  return serverSet
    ? 'SIB on G2\n\nEnter the code from the portal on the phone.'
    : 'SIB on G2\n\nOn the phone: enter your SIB server, then the code from the portal.';
}
