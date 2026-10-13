// devices-chrome.js - the shared chrome of the three device pages
// (/devices/gallery, /devices/fit, /devices/landscape): the tab bar with
// "Back to the map", the Reader toggle (same switch and key as the explain
// pages: `html[data-reader]`, localStorage `sib.explain.reader`), and the
// "Download" helper that explains a 503 (the docx package not installed)
// instead of failing silently. Tokens only.
(function () {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const TABS = [
    { href: '/devices/gallery',   label: 'The devices' },
    { href: '/devices/fit',       label: 'Fit for the cleanroom', lock: true },
    { href: '/devices/landscape', label: 'AR glasses landscape' },
  ];
  const here = location.pathname.replace(/\/+$/, '');
  for (const nav of document.querySelectorAll('[data-devices-tabs]')) {
    nav.innerHTML = `<a href="/platform#devices" class="dv-back">‹ Back to the map</a>` + TABS.map(t => `<a href="${t.href}" ${t.href === here ? 'aria-current="page"' : ''}>${esc(t.label)}${t.lock ? ' <svg class="ax-icon" style="width:11px;height:11px;vertical-align:-1px"><use href="/portal/brand/icons.svg#i-lock-restricted"/></svg>' : ''}</a>`).join('');
  }
  // Reader mode
  const KEY = 'sib.explain.reader', root = document.documentElement;
  const setReader = on => { root.toggleAttribute('data-reader', on); try { localStorage.setItem(KEY, on ? '1' : '0'); } catch {} for (const b of document.querySelectorAll('[data-reader-toggle]')) { b.setAttribute('aria-pressed', String(on)); b.textContent = on ? 'Colour' : 'Reader'; } };
  let on = false; try { on = localStorage.getItem(KEY) === '1'; } catch {}
  for (const b of document.querySelectorAll('[data-reader-toggle]')) b.addEventListener('click', () => setReader(!root.hasAttribute('data-reader')));
  setReader(on);
  window.addEventListener('keydown', e => { if (e.key === 'r' && !e.metaKey && !e.ctrlKey && !e.altKey && !/INPUT|TEXTAREA/.test(document.activeElement?.tagName || '')) setReader(!root.hasAttribute('data-reader')); });
  // Download: a Word file from the server, with the two logos, the generated date and the footnote
  window.devicesDownload = async function (url, btn) {
    const was = btn ? btn.textContent : ''; if (btn) { btn.disabled = true; btn.textContent = 'Preparing…'; }
    try {
      const r = await fetch(url);
      if (r.status === 503) { alert('Word export needs the docx package on this server. Ask the appliedx team to run npm install; until then use Print to PDF from the browser.'); return; }
      if (!r.ok) { alert('The download did not work (' + r.status + ').'); return; }
      const blob = await r.blob(); const name = (r.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/)?.[1] || 'export.docx';
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } finally { if (btn) { btn.disabled = false; btn.textContent = was; } }
  };
})();
