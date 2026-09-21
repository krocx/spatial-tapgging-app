// brand.js — logo strip for every SIB web surface (portal, home, /platform, catalogue).
//
// Applied Materials logo + the AppliedX team mark, top-right, on every page —
// the same convention as our decks and the app. The image files are NOT in
// the repo (brand assets stay deployment-local, like the deck template):
//
//   DATA_DIR/platform/media/logo-amat.png       → Applied Materials
//   DATA_DIR/platform/media/logo-appliedx.png   → AppliedX
//
// They're served at /platform-media/logo-*.png (deployment override first,
// bundled sib/portal/platform-media/ second). Until a file exists the slot
// shows a quiet dashed placeholder so nobody forgets — hover tells you where
// to drop it. Pages opt in with an element carrying `data-brand-slot`; if a
// page has none, the strip floats top-right.
(function () {
  const LOGOS = [
    { file: 'logo-amat.png',     label: 'Applied Materials', h: 22 },
    { file: 'logo-appliedx.png', label: 'AppliedX',          h: 26 },
  ];
  // The platform wordmark — "appliedx Connected Worker AR OMS Platform":
  // "applied" in AppliedX blue, "x" in AppliedX green, Roboto Regular (400),
  // exactly as the team writes it in decks. Any element carrying
  // `data-ax-wordmark` is rendered as the full name; add `data-short` for
  // just "appliedx". Roboto is fetched from Google Fonts when reachable and
  // falls back to the system sans on the LAN — the colours carry the mark.
  const AX_BLUE = '#66b3ff', AX_GREEN = '#35c635';
  const css = `
    .ax-wordmark { font-family:Roboto,-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif; font-weight:400; letter-spacing:-.01em; white-space:nowrap; }
    .ax-wordmark .ax-a { color:${AX_BLUE}; }
    .ax-wordmark .ax-x { color:${AX_GREEN}; }
    .ax-wordmark .ax-rest { margin-left:.28em; }
  `;
  const stripCss = `
    .ax-brand { display:flex; align-items:center; gap:14px; }
    .ax-brand.float { position:fixed; top:10px; right:16px; z-index:50; }
    .ax-brand img { display:block; width:auto; object-fit:contain; opacity:.95; }
    .ax-brand .ax-ph { display:inline-flex; align-items:center; justify-content:center; height:24px; min-width:96px; padding:0 8px;
      border:1px dashed rgba(148,163,184,.45); border-radius:6px; color:rgba(148,163,184,.75); font:600 10px/1 -apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif;
      letter-spacing:.06em; text-transform:uppercase; white-space:nowrap; cursor:help; }
  `;
  function renderWordmarks() {
    for (const el of document.querySelectorAll('[data-ax-wordmark]:not([data-ax-done])')) {
      el.setAttribute('data-ax-done', '1');
      el.classList.add('ax-wordmark');
      const short = el.hasAttribute('data-short');
      el.innerHTML = `<span class="ax-a">applied</span><span class="ax-x">x</span>` +
        (short ? '' : `<span class="ax-rest">Connected Worker AR OMS Platform</span>`);
    }
  }
  function build() {
    // Pages on the design system (html.ax) already carry the wordmark styles
    // from brand/components.css and never load a web font; only the legacy
    // pages get the inline CSS and the Roboto link until they migrate.
    const onSystem = document.documentElement.classList.contains('ax');
    const style = document.createElement('style'); style.textContent = (onSystem ? '' : css) + stripCss; document.head.appendChild(style);
    if (!onSystem && !document.querySelector('link[href*="fonts.googleapis.com/css2?family=Roboto"]')) {
      const l = document.createElement('link'); l.rel = 'stylesheet';
      l.href = 'https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap';
      document.head.appendChild(l);
    }
    renderWordmarks();
    const strip = document.createElement('div'); strip.className = 'ax-brand';
    for (const l of LOGOS) {
      const img = document.createElement('img');
      img.src = '/platform-media/' + l.file; img.alt = l.label; img.style.height = l.h + 'px';
      img.onerror = () => {
        const ph = document.createElement('span'); ph.className = 'ax-ph'; ph.textContent = l.label + ' logo';
        ph.title = `Drop ${l.file} into DATA_DIR/platform/media/ on the server — it appears here on every page.`;
        img.replaceWith(ph);
      };
      strip.appendChild(img);
    }
    // Dock into a slot when one exists, float otherwise — and keep watching:
    // SPA surfaces (the roadmap) mount and unmount their slots as routes change.
    const place = () => {
      const slot = document.querySelector('[data-brand-slot]');
      if (slot) { if (strip.parentElement !== slot) { strip.classList.remove('float'); slot.appendChild(strip); } }
      else if (!strip.classList.contains('float')) { strip.classList.add('float'); document.body.appendChild(strip); }
    };
    place();
    new MutationObserver(() => { place(); renderWordmarks(); }).observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();

  // SIB Compass — the shared navigator rides in with the brand strip so every
  // surface gets it from this one include (see compass.js).
  if (!document.querySelector('script[src="/portal/compass.js"]')) {
    const s = document.createElement('script'); s.src = '/portal/compass.js'; s.defer = true; document.head.appendChild(s);
  }
})();
