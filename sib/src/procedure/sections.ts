/**
 * Procedure sections (2026.4.50): how a long procedure is folded into rows.
 *
 * A section is a run of consecutive steps that belong together. Three
 * sources, in order:
 *   1. an explicit `section` on the step (xlsx / JSON column, or set later);
 *   2. the leading top-level index in the title, as the Cortona importer
 *      writes it: "3. Lift the lid - Remove the four bolts" → section 3,
 *      named "3. Lift the lid";
 *   3. nothing: steps are chunked by SECTION_CHUNK and named "Steps 1-10".
 *
 * Inside a section the steps wrap every SECTION_WRAP, so a 30-step section
 * is three rows under one band, not one long line.
 *
 * Used by the reverse compiler (new maps) and the designer's "Sections"
 * layout (existing maps; the roadmap client imports this file relatively -
 * @spatial/shared stays types-only at runtime, see sib/Dockerfile).
 * Layout only - the compiler never reads sections.
 */

export const SECTION_CHUNK = 10;
/** Steps per row inside a section; longer sections wrap under the same band. */
export const SECTION_WRAP = 10;

export interface SectionSource { title?: string; section?: string }
export interface Section { name: string; /** indexes into the input array */ members: number[] }

const TITLE_INDEX = /^\s*(\d+)\.\s+(.*)$/;
const LEADING_INDICES = /^(\d+\.\s+)+/;

/** The section key and display name a step declares, or null. The key is
 *  the heading text (a Cortona heading may carry its own "1." inside the
 *  title's "1. " prefix, and the same heading can come back under another
 *  index), so "1. 1. Top Fuselage" and "2. 1. Top Fuselage" are one name. */
export function sectionOf(s: SectionSource): { key: string; name: string } | null {
  const explicit = s.section?.trim();
  if (explicit) return { key: `s:${explicit.toLowerCase()}`, name: explicit };
  const m = (s.title ?? '').match(TITLE_INDEX);
  if (!m) return null;
  const head = m[2].split(' - ')[0].trim().replace(LEADING_INDICES, '').trim();
  if (!head) return { key: `n:${m[1]}`, name: `Section ${m[1]}` };
  return { key: `h:${head.toLowerCase()}`, name: `${m[1]}. ${head}` };
}

/** Fold an ordered list of steps into sections. Steps without a key join the
 *  open section when one exists; a list with no keys at all is chunked. */
export function groupIntoSections(steps: SectionSource[], chunk = SECTION_CHUNK): Section[] {
  const keyed = steps.map(sectionOf);
  if (keyed.every(k => k === null)) {
    const out: Section[] = [];
    for (let i = 0; i < steps.length; i += chunk) {
      const end = Math.min(i + chunk, steps.length);
      out.push({ name: `Steps ${i + 1}-${end}`, members: Array.from({ length: end - i }, (_, j) => i + j) });
    }
    return out;
  }
  const out: Section[] = [];
  let open: Section | null = null; let openKey: string | null = null;
  const seenNames = new Set<string>();
  keyed.forEach((k, i) => {
    if (k && k.key !== openKey) {
      // The same heading returning later in the procedure is a continuation.
      const name = seenNames.has(k.key) ? `${k.name} (cont.)` : k.name;
      seenNames.add(k.key);
      open = { name, members: [] }; openKey = k.key; out.push(open);
    }
    if (!open) { open = { name: 'Start', members: [] }; openKey = null; out.push(open); }
    open.members.push(i);
  });
  return out;
}
