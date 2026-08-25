/**
 * Feature Catalogue core tests — parser contract + graph integrity rules.
 * Pure fixtures only; the live docs/catalog/ files are exercised by the
 * drift checker and the boot e2e, not here.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseFrontmatter,
  parseTrails,
  parseGlossary,
  resolveTerm,
  buildCatalog,
  slugifyHeading,
  extractSection,
  CatalogParseError,
} from '../src/catalog/catalog-core.js';

const feature = (id: string, extra = '') => ({
  name: `${id}.md`,
  content: `---
id: ${id}
name: Feature ${id}
area: tags
status: shipped
version: baseline
depends: []
terms: []
spec: APP-FEATURES.md
${extra}---
A body long enough to look like a real catalogue entry for testing purposes.`,
});

const GLOSS = `# Dictionary
## Platform Foundations
- **Anchor** ✅ — a fixed spatial origin on a physical asset.
- **Tag / Spatial Tagging** ✅ — an inspection checkpoint pinned in 3D space.
## Acronym Quick Reference
| Acronym | Expansion |
|---|---|
| OCR | Optical Character Recognition |
| GLB / USDZ | AR-ready 3D file formats |
`;

test('parseFrontmatter: scalars, arrays, block literals, body', () => {
  const p = parseFrontmatter(`---
id: x
depends: [a, b]
flow: |
  flowchart LR
    A --> B
name: The X
---
Body here.`);
  assert.ok(p);
  assert.equal(p!.fm.id, 'x');
  assert.deepEqual(p!.fm.depends, ['a', 'b']);
  assert.equal(p!.fm.flow, 'flowchart LR\n  A --> B');
  assert.equal(p!.fm.name, 'The X');
  assert.equal(p!.body, 'Body here.');
});

test('parseFrontmatter: empty inline array and quoted scalars', () => {
  const p = parseFrontmatter('---\nid: y\ndepends: []\ncolor: "#fff"\n---\nB');
  assert.deepEqual(p!.fm.depends, []);
  assert.equal(p!.fm.color, '#fff');
});

test('parseFrontmatter: returns null without frontmatter', () => {
  assert.equal(parseFrontmatter('# just markdown'), null);
});

test('parseTrails: extracts ordered trails', () => {
  const trails = parseTrails(`---
kind: trails
trails:
  - id: operator
    name: "Run procedures"
    blurb: "The day."
    steps: [a, b, c]
  - id: ehs
    name: "Review safety"
    blurb: "iLOTO."
    steps: [d]
---
Body.`);
  assert.equal(trails.length, 2);
  assert.deepEqual(trails[0], { id: 'operator', name: 'Run procedures', blurb: 'The day.', steps: ['a', 'b', 'c'] });
  assert.deepEqual(trails[1].steps, ['d']);
});

test('parseGlossary: terms with sections + acronyms, headers excluded', () => {
  const { terms, acronyms } = parseGlossary(GLOSS);
  assert.equal(terms.length, 2);
  assert.equal(terms[0].term, 'Anchor');
  assert.equal(terms[0].section, 'Platform Foundations');
  assert.match(terms[0].definition, /^a fixed spatial origin/);
  assert.equal(acronyms.length, 2);
  assert.equal(acronyms[0].acronym, 'OCR');
});

test('resolveTerm: exact, prefix, and acronym-part matching', () => {
  const { terms, acronyms } = parseGlossary(GLOSS);
  assert.equal((resolveTerm('Anchor', terms, acronyms) as any).term, 'Anchor');
  assert.equal((resolveTerm('Tag', terms, acronyms) as any).term, 'Tag / Spatial Tagging');
  assert.equal((resolveTerm('USDZ', terms, acronyms) as any).acronym, 'GLB / USDZ');
  assert.equal(resolveTerm('Nonexistent', terms, acronyms), undefined);
});

test('buildCatalog: edges derived from depends, prerequisite → dependant', () => {
  const cat = buildCatalog(
    [feature('a'), feature('b', 'depends: [a]\n')],
    GLOSS, '2026.4.42',
  );
  // NOTE: later `depends:` line overrides the template's empty one in fixture b.
  assert.equal(cat.features.length, 2);
  assert.deepEqual(cat.edges, [{ from: 'a', to: 'b' }]);
  assert.equal(cat.platformVersion, '2026.4.42');
});

test('buildCatalog: dangling depends fails loudly with the offender named', () => {
  assert.throws(
    () => buildCatalog([feature('a', 'depends: [ghost]\n')], GLOSS, 'v'),
    (e: unknown) => e instanceof CatalogParseError && /dangling depends → ghost/.test((e as Error).message),
  );
});

test('buildCatalog: duplicate ids rejected', () => {
  assert.throws(
    () => buildCatalog([feature('a'), { ...feature('a'), name: 'a2.md' }], GLOSS, 'v'),
    /duplicate feature id/,
  );
});

test('buildCatalog: invalid status and area rejected', () => {
  const bad = { name: 'bad.md', content: feature('bad').content.replace('status: shipped', 'status: wip') };
  assert.throws(() => buildCatalog([bad], GLOSS, 'v'), /invalid status "wip"/);
  const badArea = { name: 'bad2.md', content: feature('bad2').content.replace('area: tags', 'area: misc') };
  assert.throws(() => buildCatalog([badArea], GLOSS, 'v'), /invalid area "misc"/);
});

test('buildCatalog: trails with unknown steps rejected; valid trails kept', () => {
  const trailsFile = (steps: string) => ({
    name: 'trails.md',
    content: `---\nkind: trails\ntrails:\n  - id: t\n    name: "T"\n    blurb: "B"\n    steps: [${steps}]\n---\nx`,
  });
  assert.throws(() => buildCatalog([feature('a'), trailsFile('a, ghost')], GLOSS, 'v'), /unknown step → ghost/);
  const ok = buildCatalog([feature('a'), trailsFile('a')], GLOSS, 'v');
  assert.equal(ok.trails.length, 1);
});

test('buildCatalog: areas sorted by order, README ignored', () => {
  const area = (id: string, order: number) => ({
    name: `area-${id}.md`,
    content: `---\nid: ${id}\nkind: area\nname: A${id}\ncolor: "#000"\norder: ${order}\nflow: |\n  flowchart LR\n    A --> B\n---\nArea body.`,
  });
  const cat = buildCatalog(
    [area('z', 2), area('y', 1), { name: 'README.md', content: '# not parsed' }, feature('a')],
    GLOSS, 'v',
  );
  assert.deepEqual(cat.areas.map(a => a.id), ['y', 'z']);
  assert.equal(cat.areas[0].flow, 'flowchart LR\n  A --> B');
});

test('buildCatalog: api block splits to trimmed lines; absent api stays undefined', () => {
  const withApi = {
    name: 'a.md',
    content: feature('a').content.replace(
      '---\nA body',
      'api: |\n  GET /x — one (app · API key)\n  POST /x — two (portal · admin key)\n---\nA body',
    ),
  };
  const cat = buildCatalog([withApi, feature('b')], GLOSS, 'v');
  assert.deepEqual(cat.features.find(f => f.id === 'a')!.api, [
    'GET /x — one (app · API key)',
    'POST /x — two (portal · admin key)',
  ]);
  assert.equal(cat.features.find(f => f.id === 'b')!.api, undefined);
});

test('slugifyHeading: GitHub-style slugs incl. parens, backticks, digits', () => {
  assert.equal(slugifyHeading('3D Model Library'), '3d-model-library');
  assert.equal(slugifyHeading('AR Work Instructions (AR OMS)'), 'ar-work-instructions-ar-oms');
  assert.equal(slugifyHeading('Anchor Portal (`/portal`)'), 'anchor-portal-portal');
  assert.equal(slugifyHeading('What It Does'), 'what-it-does');
});

const SPEC_MD = `# Title
Intro text.
## Alpha
Alpha body.
### Alpha Sub
Sub body.
\`\`\`
# not a heading (code fence)
\`\`\`
## Beta (Two)
Beta body.
`;

test('extractSection: heading through next same-level heading, subsections kept', () => {
  const s = extractSection(SPEC_MD, 'alpha')!;
  assert.match(s, /^## Alpha/);
  assert.match(s, /Alpha Sub/);          // deeper heading stays inside
  assert.doesNotMatch(s, /Beta body/);   // sibling heading ends the section
});

test('extractSection: last section runs to EOF; fenced # ignored; miss → null', () => {
  const beta = extractSection(SPEC_MD, 'beta-two')!;
  assert.match(beta, /^## Beta \(Two\)/);
  assert.match(beta, /Beta body\./);
  // The fenced "# not a heading" must neither match nor terminate a section
  assert.equal(extractSection(SPEC_MD, 'not-a-heading-code-fence'), null);
  assert.match(extractSection(SPEC_MD, 'alpha')!, /not a heading/);
  assert.equal(extractSection(SPEC_MD, 'ghost'), null);
});

test('buildCatalog: arch block passes through; absent arch stays undefined', () => {
  const withArch = {
    name: 'a.md',
    content: feature('a').content.replace('---\nA body', 'arch: |\n  sequenceDiagram\n    A->>B: POST /x\n---\nA body'),
  };
  const cat = buildCatalog([withArch, feature('b')], GLOSS, 'v');
  const a = cat.features.find(f => f.id === 'a')!;
  assert.equal(a.arch, 'sequenceDiagram\n  A->>B: POST /x');
  assert.equal(cat.features.find(f => f.id === 'b')!.arch, undefined);
});
