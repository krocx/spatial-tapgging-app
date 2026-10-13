// explain.js - shared chrome for the explain pages (/explain/*, /containers).
//
//   • Nav: Learn · the four pages, current one lit - injected into
//     `<nav data-explain-nav>` so every page offers the same quick access.
//   • Reader mode: a "Reader" toggle (header) switches the page to a paper,
//     monochrome view - the Kindle test for the articles to come. Colour
//     meaning survives through the left-border weight and the legend, which
//     greys with the page so it still says what each cell is. Persisted
//     per browser (localStorage `sib.explain.reader`).
//   • Ask SIB: the shared drawer (/portal/ask.js, injected by brand.js on
//     every surface) - facts from live data, the docs, the catalogue.
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

  // Ask SIB: the shared drawer in /portal/ask.js, injected by brand.js on every surface (2026.4.50).
})();
