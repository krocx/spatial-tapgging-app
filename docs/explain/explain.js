// explain.js - shared chrome for the explain pages (/explain/*, /containers).
//
//   • Nav: Learn · the four pages, current one lit - injected into
//     `<nav data-explain-nav>` so every page offers the same quick access.
//   • Reader mode: a "Reader" toggle (header) switches the page to a paper,
//     monochrome view - the Kindle test for the articles to come. Colour
//     meaning survives through the left-border weight and the legend, which
//     greys with the page so it still says what each cell is. Persisted
//     per browser (localStorage `sib.explain.reader`).
//   • Ask SIB: the same catalogue-grounded assistant the Catalogue has
//     (POST /ask), as a drawer bottom-left; sources open the feature in the
//     Catalogue. The grounding is the catalogue only, so nothing on these
//     pages that is confidential can leak through an answer.
//   • Legend guard: a page without a `.legend` gets a console warning so the
//     rule "every page says what its colours mean" holds.
//
// Vanilla, tokens only (docs/BRAND.md). brand.js is loaded by each page for
// the wordmark and the Compass.

(function () {
  const PAGES = [
    { href: '/learn',                        label: 'Learn', home: true },
    { href: '/containers',                   label: 'Containers' },
    { href: '/explain/spatial-intelligence', label: 'Spatial Intelligence' },
    { href: '/explain/lifecycle',            label: 'Lifecycle' },
    { href: '/explain/readiness',            label: 'Readiness' },
  ];
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const here = location.pathname.replace(/\/+$/, '');

  // ── Nav ────────────────────────────────────────────────────────────────────
  for (const nav of document.querySelectorAll('[data-explain-nav]')) {
    nav.innerHTML = PAGES.map(p => `<a href="${p.href}" class="${p.href === here ? 'on' : ''}${p.home ? ' home' : ''}">${p.home ? '‹ ' : ''}${esc(p.label)}</a>`).join('')
      + (here === '/explain' ? '' : `<a href="/explain" title="All explain pages">All</a>`);
  }

  // ── Reader mode ────────────────────────────────────────────────────────────
  const KEY = 'sib.explain.reader';
  const root = document.documentElement;
  const setReader = on => { root.toggleAttribute('data-reader', on); try { localStorage.setItem(KEY, on ? '1' : '0'); } catch {} for (const b of document.querySelectorAll('[data-reader-toggle]')) { b.setAttribute('aria-pressed', String(on)); b.textContent = on ? 'Colour' : 'Reader'; } };
  let on = false; try { on = localStorage.getItem(KEY) === '1'; } catch {}
  const header = document.querySelector('header');
  if (header) {
    const b = document.createElement('button');
    b.className = 'ex-reader'; b.type = 'button'; b.setAttribute('data-reader-toggle', '');
    b.title = 'Reader mode: paper, monochrome, for reading. Colour meaning stays in the border weight and the legend.';
    b.addEventListener('click', () => setReader(!root.hasAttribute('data-reader')));
    const conf = header.querySelector('.conf');
    if (conf) header.insertBefore(b, conf); else header.appendChild(b);
  }
  setReader(on);
  window.addEventListener('keydown', e => { if (e.key === 'r' && !e.metaKey && !e.ctrlKey && !e.altKey && !/INPUT|TEXTAREA/.test(document.activeElement?.tagName || '')) setReader(!root.hasAttribute('data-reader')); });

  // ── Legend guard ───────────────────────────────────────────────────────────
  if (!document.querySelector('.legend')) console.warn('[explain] this page has no .legend - every explain page says what its colours mean');

  // ── Ask SIB ────────────────────────────────────────────────────────────────
  const fab = document.createElement('button');
  fab.className = 'ex-ask-fab'; fab.type = 'button'; fab.title = 'Ask SIB - answers grounded in the Feature Catalogue';
  fab.innerHTML = `<svg class="ax-icon"><use href="/portal/brand/icons.svg#i-sparkles"/></svg><span>Ask SIB</span>`;
  const drawer = document.createElement('aside');
  drawer.className = 'ex-ask'; drawer.setAttribute('aria-label', 'Ask SIB');
  drawer.innerHTML = `
    <div class="ex-ask-top"><b>Ask SIB</b><span class="ex-ask-tier" id="exAskTier">docs search</span><button type="button" class="ex-ask-x" aria-label="Close"><svg class="ax-icon"><use href="/portal/brand/icons.svg#i-close"/></svg></button></div>
    <div class="ex-ask-body" id="exAskBody">
      <div class="ex-ask-hint">Ask about anything on this page - the answer comes from the Feature Catalogue, every source one click away.</div>
      <div class="ex-ask-presets">${['What is a sealed world map?', 'How does a hint retire?', 'What does the Guide Bundle carry?', 'Which devices are ready for pilot?'].map(q => `<button type="button" class="ax-chip" data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div>
    </div>
    <form class="ex-ask-form" id="exAskForm"><input class="ax-input" id="exAskInput" placeholder="Ask…" autocomplete="off"><button class="ax-btn ax-btn--primary" type="submit">Ask</button></form>`;
  // The Compass owns the bottom corners (button right, breadcrumb left), so
  // Ask lives in the header next to Reader and opens as a right-hand panel.
  const readerBtn = document.querySelector('[data-reader-toggle]');
  if (readerBtn) readerBtn.insertAdjacentElement('afterend', fab); else (header || document.body).appendChild(fab);
  document.body.append(drawer);
  const open = () => { drawer.classList.add('open'); document.getElementById('exAskInput').focus(); };
  const close = () => drawer.classList.remove('open');
  fab.addEventListener('click', () => drawer.classList.contains('open') ? close() : open());
  drawer.querySelector('.ex-ask-x').addEventListener('click', close);
  window.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  fetch('/ask/config').then(r => r.json()).then(c => { document.getElementById('exAskTier').textContent = c.generation ? `model: ${c.model}` : 'docs search'; }).catch(() => {});
  drawer.querySelectorAll('[data-q]').forEach(b => b.addEventListener('click', () => { document.getElementById('exAskInput').value = b.dataset.q; submit(); }));
  document.getElementById('exAskForm').addEventListener('submit', e => { e.preventDefault(); submit(); });
  const chips = sources => sources.length ? `<div class="ex-ask-src">${sources.map(s => `<a class="ax-chip" href="/catalog#${encodeURIComponent(s.id)}">${esc(s.name)}</a>`).join('')}</div>` : '';
  async function submit() {
    const input = document.getElementById('exAskInput'); const q = input.value.trim(); if (!q) return; input.value = '';
    const body = document.getElementById('exAskBody');
    body.insertAdjacentHTML('beforeend', `<div class="ex-q">You asked</div><div class="ex-a">${esc(q)}</div><div class="ex-q">Ask SIB</div><div class="ex-a" id="exAskPending">Thinking…</div>`);
    body.scrollTop = body.scrollHeight;
    try {
      const r = await fetch('/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: q }) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error || r.statusText);
      const box = document.getElementById('exAskPending'); box.removeAttribute('id');
      if (j.tier === 'generation' && j.answer) box.innerHTML = `<div class="ex-md">${esc(j.answer).replace(/\n\n+/g, '</p><p>').replace(/\n/g, '<br>')}</div>` + chips(j.sources || []);
      else if ((j.sources || []).length) box.innerHTML = `<div class="ex-ask-hint">Best matches from the docs:</div>` + j.sources.map(s => `<div class="ex-hit"><a class="ax-chip" href="/catalog#${encodeURIComponent(s.id)}">${esc(s.name)}</a><div>${esc(s.excerpt || '')}</div></div>`).join('') + ((j.glossary || []).length ? `<div class="ex-ask-hint">Dictionary:</div>` + j.glossary.map(g => `<div class="ex-hit"><b>${esc(g.term)}</b> - ${esc(g.definition)}</div>`).join('') : '');
      else box.textContent = "That's not in the Catalogue yet. Try naming a feature, an area or a dictionary term.";
    } catch (e) { const box = document.getElementById('exAskPending'); if (box) { box.removeAttribute('id'); box.innerHTML = `<span class="ex-err">${esc(e.message)}</span>`; } }
    body.scrollTop = body.scrollHeight;
  }
})();
