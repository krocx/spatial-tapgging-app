// ask.js - Ask SIB on every SIB web surface (2026.4.50).
//
// One drawer, injected by brand.js next to the Compass, so every page offers
// the same assistant with the same behaviour. The button sits above the
// Compass button (bottom-right); `/` focuses the question from anywhere; Esc
// closes. Presets change with the page, because leadership taps more than it
// types. Answers come from POST /ask in three layers: facts (live data,
// exact, server-side), documents (catalogue features, explain pages, device
// profiles, the landscape), and - when a model is configured - a sentence
// written over those. Access follows the reader's cookies; the drawer never
// sees more than the page would. Tokens only; nothing fades or slides.
(function () {
  if (window.sibAsk) return;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const here = location.pathname.replace(/\/+$/, '') || '/';
  const PRESETS = [
    [/^\/portfolio/, ['What is at risk?', 'Which POCs are active?', 'What decisions are waiting on leadership?']],
    [/^\/platform\/chamber/, ['How does the scan give a chamber one origin?', 'How is a step validated?', 'What does presence let the ME do?']],
    [/^\/platform/, ['Which glasses fit our requirements?', 'How many chambers are mapped right now?', 'What is the status of the POCs?']],
    [/^\/devices\/fit/, ['Which device category delivers in-context validation?', 'Which devices are ready for pilot?', 'What does the market signal mean for us?']],
    [/^\/devices\/landscape/, ['What is the latest on SENZ™?', 'Which makers have exited enterprise AR?', 'Which glasses are candidates for the cleanroom?']],
    [/^\/devices/, ['Which devices are ready for pilot?', 'What can the RayNeo X3 Pro deliver?', 'Which glasses fit our requirements?']],
    [/^\/scorecard/, ['Which devices are ready for pilot?', 'What blocks the glasses transition?', 'How is readiness scored?']],
    [/^\/catalog/, ['How does LOTO removal get enforced?', 'What happens when I import an xlsx guide?', 'How are 3D models converted for AR?']],
    [/^\/(explain|learn|containers)/, ['What is a sealed world map?', 'How does a hint retire?', 'What does the Guide Bundle carry?']],
    [/^\/portal/, ['How many guided runs this week?', 'Which POCs use this chamber?', 'How does a Walk get signed off?']],
    [/.*/, ['What is the status of the POCs?', 'How does AR OMS work?', 'Which glasses fit our requirements?']],
  ];
  const presets = (PRESETS.find(([re]) => re.test(here)) || PRESETS[PRESETS.length - 1])[1];

  const css = `
    .sib-ask-btn{position:fixed;right:18px;bottom:76px;z-index:9400;display:inline-flex;align-items:center;gap:6px;height:40px;padding:0 14px;border-radius:14px;border:var(--ax-hair);background:var(--ax-solid);color:var(--ax-ink);font:var(--ax-label-s);cursor:pointer}
    .sib-ask-btn .ax-icon{width:16px;height:16px;color:var(--ax-blue)}
    .sib-ask-btn:hover{background:var(--ax-paper-3)}
    .sib-ask{position:fixed;top:0;right:0;bottom:0;width:min(460px,96vw);z-index:9450;background:var(--ax-solid);border-left:var(--ax-hair);display:none;flex-direction:column}
    .sib-ask.open{display:flex}
    .sib-ask-top{display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:var(--ax-hair)}
    .sib-ask-top b{font:var(--ax-label);flex:1}
    .sib-ask-top .tier{font:var(--ax-label-s);color:var(--ax-ink-3)}
    .sib-ask-x{background:none;border:0;color:var(--ax-ink-2);cursor:pointer;padding:4px}
    .sib-ask-body{flex:1;overflow-y:auto;padding:14px 16px;font:var(--ax-label-r)}
    .sib-ask-hint{color:var(--ax-ink-3);font:var(--ax-label-s);margin-bottom:10px}
    .sib-ask-presets{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px}
    .sib-ask-presets .ax-chip{cursor:pointer;text-transform:none;letter-spacing:0;font:var(--ax-label-s);background:var(--ax-paper);color:var(--ax-ink-2);border:1px solid transparent}
    .sib-ask-presets .ax-chip:hover{border-color:var(--ax-blue);color:var(--ax-ink)}
    .sib-ask-q{color:var(--ax-ink-3);font:var(--ax-label-s);margin:14px 0 4px}
    .sib-ask-a{background:var(--ax-paper);border:var(--ax-hair);border-radius:var(--ax-r-field);padding:10px 12px}
    .sib-ask-fact{border-left:3px solid var(--ax-blue);padding:8px 12px;margin:8px 0;background:var(--ax-paper)}
    .sib-ask-fact h4{margin:0 0 6px;font:var(--ax-label)}
    .sib-ask-fact ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:5px}
    .sib-ask-fact li{display:flex;gap:8px;align-items:baseline;font:var(--ax-label-s)}
    .sib-ask-fact li a{color:var(--ax-ink)}
    .sib-ask-fact .tag{flex:none;font:600 10px/16px var(--ax-mono);padding:0 6px;border-radius:6px;border:1px solid var(--ax-rule);color:var(--ax-ink-2)}
    .sib-ask-fact .tag.green{color:var(--ax-green);border-color:var(--ax-green)} .sib-ask-fact .tag.amber{color:var(--ax-orange);border-color:var(--ax-orange)} .sib-ask-fact .tag.red{color:var(--ax-red);border-color:var(--ax-red)} .sib-ask-fact .tag.blue{color:var(--ax-blue);border-color:var(--ax-blue)}
    .sib-ask-fact .go{display:inline-block;margin-top:6px;font:var(--ax-label-s);color:var(--ax-blue)}
    .sib-ask-fact .note{font:var(--ax-label-s);color:var(--ax-ink-3);margin-top:6px}
    .sib-ask-src{margin-top:8px;display:flex;flex-wrap:wrap;gap:6px}
    .sib-ask-src a.ax-chip{text-transform:none;letter-spacing:0;font:var(--ax-label-s);background:var(--ax-paper-2);color:var(--ax-ink);border:1px solid var(--ax-rule);text-decoration:none}
    .sib-ask-doc{margin:8px 0 0;font:var(--ax-label-s)} .sib-ask-doc a{color:var(--ax-ink)} .sib-ask-doc div{color:var(--ax-ink-3)}
    .sib-ask-gl{margin-top:8px;font:var(--ax-label-s)} .sib-ask-gl b{color:var(--ax-cyan)}
    .sib-ask-note{font:var(--ax-label-s);color:var(--ax-orange);margin-top:6px}
    .sib-ask-form{display:flex;gap:8px;padding:12px 16px;border-top:var(--ax-hair)}
    .sib-ask-form input{flex:1}
    @media print{.sib-ask-btn,.sib-ask{display:none !important}}`;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  const btn = document.createElement('button'); btn.className = 'sib-ask-btn'; btn.type = 'button'; btn.title = 'Ask SIB (/)';
  btn.innerHTML = `<svg class="ax-icon"><use href="/portal/brand/icons.svg#i-sparkles"/></svg><span>Ask SIB</span>`;
  // The roadmap canvas keeps a hint bar along the bottom and the Compass sits 40px higher there (compass.js) - keep the same gap above it.
  if (here.startsWith('/roadmap')) btn.style.bottom = '116px';
  const drawer = document.createElement('aside'); drawer.className = 'sib-ask'; drawer.setAttribute('aria-label', 'Ask SIB');
  drawer.innerHTML = `
    <div class="sib-ask-top"><svg class="ax-icon" style="width:16px;height:16px;color:var(--ax-blue)"><use href="/portal/brand/icons.svg#i-sparkles"/></svg><b>Ask SIB</b><span class="tier" id="sibAskTier">live data + docs</span><button type="button" class="sib-ask-x" aria-label="Close"><svg class="ax-icon"><use href="/portal/brand/icons.svg#i-close"/></svg></button></div>
    <div class="sib-ask-body" id="sibAskBody">
      <div class="sib-ask-hint">Ask about the POCs, the devices, the platform or any feature. Numbers come from this server; everything else from the catalogue and the explain pages, with the source one click away.</div>
      <div class="sib-ask-presets">${presets.map(q => `<button type="button" class="ax-chip" data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div>
    </div>
    <form class="sib-ask-form" id="sibAskForm"><input class="ax-input" id="sibAskInput" maxlength="500" placeholder="Ask…" autocomplete="off"><button class="ax-btn ax-btn--primary" type="submit">Ask</button></form>`;
  document.body.append(btn, drawer);
  const body = drawer.querySelector('#sibAskBody'), input = drawer.querySelector('#sibAskInput');
  const open = () => { drawer.classList.add('open'); input.focus(); };
  const close = () => drawer.classList.remove('open');
  btn.addEventListener('click', () => drawer.classList.contains('open') ? close() : open());
  drawer.querySelector('.sib-ask-x').addEventListener('click', close);
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape' && drawer.classList.contains('open')) close();
    if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '') && !document.activeElement?.isContentEditable) { e.preventDefault(); open(); }
  });
  fetch('/ask/config').then(r => r.json()).then(c => { drawer.querySelector('#sibAskTier').textContent = c.generation ? `model: ${c.model}` : 'live data + docs'; }).catch(() => {});

  const tagHtml = l => l.tag ? `<span class="tag ${esc(l.tone || 'grey')}">${esc(l.tag)}</span>` : '';
  function factHtml(f) {
    return `<div class="sib-ask-fact"><h4>${esc(f.title)}</h4>${f.lines.length ? `<ul>${f.lines.map(l => `<li>${tagHtml(l)}<span>${l.href ? `<a href="${esc(l.href)}">${esc(l.text)}</a>` : esc(l.text)}</span></li>`).join('')}</ul>` : ''}${f.href ? `<a class="go" href="${esc(f.href)}">${esc(f.hrefLabel || 'Open')} ›</a>` : ''}${f.note ? `<div class="note">${esc(f.note)}</div>` : ''}</div>`;
  }
  function paragraphs(t) { return esc(t).split(/\n{2,}/).map(p => `<p style="margin:0 0 8px">${p.replace(/\n/g, '<br>')}</p>`).join(''); }
  async function ask(q) {
    q = (q || '').trim(); if (!q) return;
    input.value = '';
    body.insertAdjacentHTML('beforeend', `<div class="sib-ask-q">You asked</div><div class="sib-ask-a">${esc(q)}</div><div class="sib-ask-q">Ask SIB</div><div class="sib-ask-a" id="sibAskPending">Looking…</div>`);
    body.scrollTop = body.scrollHeight;
    const box = () => drawer.querySelector('#sibAskPending');
    try {
      const r = await fetch('/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: q, page: here }) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error || r.statusText);
      const el = box(); el.removeAttribute('id');
      const facts = (j.facts || []).map(factHtml).join('');
      const answer = j.tier === 'generation' && j.answer ? paragraphs(j.answer) : '';
      const srcs = (j.sources || []).length ? `<div class="sib-ask-src">${j.sources.map(s => `<a class="ax-chip" href="${esc(s.href || '/catalog#' + s.id)}">${esc(s.name)}</a>`).join('')}</div>` : '';
      const docs = (j.docs || []).map(d => `<div class="sib-ask-doc"><a href="${esc(d.href)}">${esc(d.title)}</a><div>${esc(d.excerpt)}</div></div>`).join('');
      const gl = (j.glossary || []).length ? `<div class="sib-ask-gl">${j.glossary.map(g => `<div><b>${esc(g.term)}</b> - ${esc(g.definition)}</div>`).join('')}</div>` : '';
      const note = j.note ? `<div class="sib-ask-note">${esc(j.note)}</div>` : '';
      if (!facts && !answer && !srcs && !docs) el.innerHTML = 'That is not something I can find. Try naming a POC, a device, a feature or a page - or open the Compass to browse.';
      else el.innerHTML = `${answer}${facts}${srcs || docs ? `<div class="sib-ask-q" style="margin-top:10px">From the docs</div>` : ''}${srcs}${docs}${gl}${note}`;
      // a link into the current page should land, not reload
      el.querySelectorAll('a[href^="/"]').forEach(a => a.addEventListener('click', e => { const u = new URL(a.href); if (u.pathname === location.pathname && u.hash) { e.preventDefault(); location.hash = u.hash; window.dispatchEvent(new HashChangeEvent('hashchange')); close(); } }));
    } catch (e) { const el = box(); if (el) { el.removeAttribute('id'); el.innerHTML = `<span style="color:var(--ax-red)">${esc(e.message)}</span>`; } }
    body.scrollTop = body.scrollHeight;
  }
  drawer.querySelector('#sibAskForm').addEventListener('submit', e => { e.preventDefault(); ask(input.value); });
  body.addEventListener('click', e => { const b = e.target.closest('[data-q]'); if (b) ask(b.dataset.q); });
  window.sibAsk = { open, close, ask };
  if (location.hash === '#ask') open();
  window.addEventListener('hashchange', () => { if (location.hash === '#ask') open(); });
})();
