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
  const css = `
    .ax-brand { display:flex; align-items:center; gap:14px; }
    .ax-brand.float { position:fixed; top:10px; right:16px; z-index:50; }
    .ax-brand img { display:block; width:auto; object-fit:contain; opacity:.95; }
    .ax-brand .ax-ph { display:inline-flex; align-items:center; justify-content:center; height:24px; min-width:96px; padding:0 8px;
      border:1px dashed rgba(148,163,184,.45); border-radius:6px; color:rgba(148,163,184,.75); font:600 10px/1 -apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif;
      letter-spacing:.06em; text-transform:uppercase; white-space:nowrap; cursor:help; }
  `;
  function build() {
    const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);
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
    const slot = document.querySelector('[data-brand-slot]');
    if (slot) slot.appendChild(strip); else { strip.classList.add('float'); document.body.appendChild(strip); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
})();
