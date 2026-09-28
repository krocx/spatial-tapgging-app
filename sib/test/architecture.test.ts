// architecture.test.ts - docs/ARCHITECTURE.md splits into sections the
// /architecture page can render, and the generated level 4 is present and
// well-formed. Runs against dist/ (`npm run build` first).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const distReady = fs.existsSync(new URL('../dist/routes/architecture.js', import.meta.url));
const docs = path.join(path.dirname(new URL(import.meta.url).pathname), '../../docs');

test('ARCHITECTURE.md: every C4 level is a section with one mermaid diagram', { skip: !distReady && 'run npm run build first' }, async () => {
  const { splitArchitecture } = await import('../dist/routes/architecture.js');
  const src = fs.readFileSync(path.join(docs, 'ARCHITECTURE.md'), 'utf8');
  const { intro, sections } = splitArchitecture(src);
  assert.ok(intro.includes('C4'), 'intro names the model');
  assert.ok(!/—/.test(src), 'no em dashes');
  const titles = sections.map(s => s.title);
  for (const want of ['Level 1', 'Level 2', 'Level 3', 'Level 4', 'Decisions']) assert.ok(titles.some(t => t.startsWith(want)), `has a ${want} section`);
  for (const s of sections) {
    if (s.title.startsWith('Level 1') || s.title.startsWith('Level 2') || s.title.startsWith('Level 3')) {
      assert.ok(s.mermaid && /^flowchart/.test(s.mermaid), `${s.title} has a flowchart`);
      assert.ok(!s.md.includes('```'), `${s.title} prose has no leftover fence`);
      assert.ok(!/#[0-9a-fA-F]{6}\b/.test(s.mermaid), `${s.title} diagram has no hex colour (the page themes it from tokens)`);
    }
    assert.ok(/^[a-z0-9-]+$/.test(s.id), `id ${s.id} is url-safe`);
  }
  const ids = new Set(sections.map(s => s.id)); assert.equal(ids.size, sections.length, 'ids unique');
});

test('generated level 4 is committed and parses', () => {
  const gen = path.join(docs, 'architecture');
  const deps = JSON.parse(fs.readFileSync(path.join(gen, 'deps.json'), 'utf8'));
  assert.ok(Object.keys(deps.sib).length > 50 && Object.keys(deps.app).length > 50);
  assert.ok(deps.sib['routes/models.ts'].includes('models/variants.ts'), 'models route imports variants');
  for (const f of ['deps-sib.mmd', 'deps-app.mmd']) {
    const m = fs.readFileSync(path.join(gen, f), 'utf8');
    assert.ok(m.startsWith('%% generated') && m.includes('flowchart LR'), f);
  }
});
