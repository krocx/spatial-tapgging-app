// compass.js - SIB Compass: one persistent, spatial navigator on every SIB web
// surface (home, portal, platform, catalogue, roadmap, wireframe).
//
// Why: each surface grew its own way home (a house icon, a bolt, "SIB home", nothing). The
// Compass gives every page the same three things - where am I, where can I
// go, what's happening - without touching any page's own layout.
//
//   • Button, bottom-right (brand hex). Click / `?`-style shortcut `g g` opens.
//     A dot on the button = a guide run is live right now.
//   • Map: radial graph - SIB in the centre, six surfaces around it, their
//     stops fanning out. Current node lit, path from centre drawn. Any node is
//     one click, leaf to leaf. Live counts from /stats ride on the nodes.
//   • Breadcrumb line: SIB › Portal › Admin › Device Logs - clickable.
//   • "Where next?" - up to three chips from the same getting-started logic
//     the portal uses (needs configs → guides → placement → today's log).
//   • Recents - last three places (localStorage), one tap back.
//   • Keys: g h home · g p portal · g m platform · g r roadmap · g c catalogue
//     · g w wireframe · g a admin · Esc closes.
//
// Injected by brand.js (which every surface already loads); roadmap and
// wireframe include brand.js directly. Vanilla, no dependencies, ~zero cost
// until opened. Respects prefers-reduced-motion.

(function () {
  if (window.__sibCompass) return; window.__sibCompass = true;

  // ── The map of SIB ────────────────────────────────────────────────────────
  const TREE = {
    id: 'sib', label: 'SIB', href: '/', hint: 'Spatial Intelligence Backend',
    children: [
      { id: 'portal', label: 'Portal', href: '/portal#home', color: 'var(--ax-p-portal)', key: 'p', hint: 'Chambers, tags, guides, sessions',
        children: [
          { id: 'anchors',   label: 'Chambers',        href: '/portal#anchors' },
          { id: 'ar-guides', label: 'AR Guides',       href: '/portal#ar-guides' },
          { id: 'content',   label: 'Guide Library',   href: '/portal#content/guides' },
          { id: 'models',    label: '3D Models',       href: '/portal#content/models' },
          { id: 'sessions',  label: 'Inspections',     href: '/portal#sessions' },
          { id: 'iloto',     label: 'iLOTO',           href: '/portal#iloto' },
          { id: 'gemba',     label: 'Gemba',           href: '/portal#gemba/walks' },
          { id: 'gemba-library', label: 'Audit Library', href: '/portal#gemba/library' },
        ] },
      { id: 'admin', label: 'Admin', href: '/portal#admin/uam', color: 'var(--ax-orange)', key: 'a', hint: 'Users, configs, logs, backups',
        children: [
          { id: 'uam',     label: 'User Access',     href: '/portal#admin/uam' },
          { id: 'configs', label: 'Chamber Configs', href: '/portal#admin/configs' },
          { id: 'logs',    label: 'Device Logs',     href: '/portal#admin/logs' },
          { id: 'ops',     label: 'Ops Log',         href: '/portal#admin/ops' },
          { id: 'backup',  label: 'Backups',         href: '/portal#admin/backup' },
        ] },
      { id: 'platform', label: 'Platform', href: '/platform', color: 'var(--ax-p-platform)', key: 'm', hint: 'The Chamber - what SIB is',
        children: [
          { id: 'assess', label: 'Assessment',   href: '/platform#assess' },
          { id: 'long',   label: 'Long version', href: '/platform/long' },
        ] },
      { id: 'roadmap', label: 'Roadmap', href: '/roadmap', color: 'var(--ax-p-designer)', key: 'r', hint: 'Roadmaps & Procedure Designer',
        children: [
          { id: 'designer', label: 'Procedure Designer', href: '/roadmap' },
        ] },
      { id: 'catalog', label: 'Catalogue', href: '/catalog', color: 'var(--ax-teal)', key: 'c', hint: 'Every feature, documented',
        children: [
          { id: 'learn', label: 'Learn', href: '/learn' },
          { id: 'ask', label: 'Ask SIB', href: '/catalog#ask' },
        ] },
      { id: 'wireframe', label: 'Wireframe', href: '/wireframe', color: 'var(--ax-p-tags)', key: 'w', hint: 'The app, flow by flow', children: [] },
    ],
  };

  // ── Where am I? ───────────────────────────────────────────────────────────
  function locate() {
    const p = location.pathname.replace(/\/+$/, '') || '/';
    const h = location.hash.replace(/^#/, '');
    if (p === '/') return ['sib'];
    if (p.startsWith('/platform/long')) return ['sib', 'platform', 'long'];
    if (p.startsWith('/platform')) return h.startsWith('assess') ? ['sib', 'platform', 'assess'] : ['sib', 'platform'];
    if (p.startsWith('/roadmap')) return ['sib', 'roadmap'];
    if (p.startsWith('/learn')) return ['sib', 'catalog', 'learn'];
    if (p.startsWith('/catalog')) return h.startsWith('ask') ? ['sib', 'catalog', 'ask'] : ['sib', 'catalog'];
    if (p.startsWith('/wireframe')) return ['sib', 'wireframe'];
    if (p.startsWith('/portal')) {
      const [sec, sub] = h.split('/');
      if (sec === 'admin') return ['sib', 'admin', sub || 'uam'];
      if (sec === 'content') return ['sib', 'portal', sub === 'models' ? 'models' : 'content'];
      if (sec === 'gemba')   return ['sib', 'portal', sub === 'library' ? 'gemba-library' : 'gemba'];
      if (sec && sec !== 'home') return ['sib', 'portal', sec];
      return ['sib', 'portal'];
    }
    return ['sib'];
  }
  function find(id, node = TREE) {
    if (node.id === id) return node;
    for (const c of node.children || []) { const r = find(id, c); if (r) return r; }
    return null;
  }
  function labelOf(id) { return find(id)?.label || id; }

  // ── Recents (localStorage) ────────────────────────────────────────────────
  const RKEY = 'sib-compass-recents';
  function recents() { try { return JSON.parse(localStorage.getItem(RKEY) || '[]'); } catch { return []; } }
  function remember() {
    const path = locate();
    const here = { id: path[path.length - 1], href: location.pathname + location.hash, label: path.slice(1).map(labelOf).join(' › ') || 'SIB' };
    if (here.id === 'sib') return;
    const list = [here, ...recents().filter(r => r.href !== here.href)].slice(0, 6);
    try { localStorage.setItem(RKEY, JSON.stringify(list)); } catch {}
  }

  // ── Styles ────────────────────────────────────────────────────────────────
  const css = `
  /* Brand system only (docs/BRAND.md): tokens, no glass, no drop shadows, Open Sans. */
  .sibc-btn{position:fixed;right:18px;bottom:18px;z-index:9400;width:48px;height:48px;padding:0;margin:0;line-height:0;border-radius:14px;border:var(--ax-hair);
    background:var(--ax-solid);cursor:pointer;display:grid;place-items:center;transition:transform .15s,border-color .15s;font-family:var(--ax-font)}
  .sibc-btn:hover{transform:translateY(-2px);border-color:var(--ax-blue)}
  .sibc-btn svg{width:26px;height:26px;display:block}
  .sibc-btn .dot{position:absolute;top:-3px;right:-3px;width:11px;height:11px;border-radius:50%;background:var(--ax-green);border:2px solid var(--ax-solid);display:none}
  .sibc-btn.live .dot{display:block;animation:sibc-pulse 1.6s ease-in-out infinite}
  @keyframes sibc-pulse{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.35);opacity:.6}}
  .sibc-crumb{position:fixed;left:14px;bottom:22px;z-index:9390;font:var(--ax-label-s);font-size:12px;line-height:1;
    color:var(--ax-ink-2);background:var(--ax-solid);border:var(--ax-hair);
    border-radius:999px;padding:8px 12px;display:flex;gap:6px;align-items:center;max-width:60vw;overflow:hidden;white-space:nowrap}
  .sibc-crumb a{color:var(--ax-ink-2);text-decoration:none}.sibc-crumb a:hover{color:var(--ax-ink)}.sibc-crumb b{color:var(--ax-ink);font-weight:600}.sibc-crumb i{opacity:.45;font-style:normal}
  /* The map is its own place: an opaque charcoal page over the app, never a
     see-through layer that fights the page underneath. It unfolds from the
     Compass button (bottom right) and folds back into it. */
  .sibc-veil{position:fixed;inset:0;z-index:9500;background:var(--ax-page);display:none;align-items:center;justify-content:center;opacity:0;transition:opacity .18s ease-out}
  .sibc-veil.open{display:flex}
  .sibc-veil.shown{opacity:1}
  .sibc-map{position:relative;width:min(1180px,96vw);height:min(780px,88vh);color:var(--ax-ink);font-family:var(--ax-font);
    transform-origin:100% 100%;transform:perspective(1400px) rotateX(-14deg) rotateY(6deg) scale(.92);opacity:0;
    transition:transform .42s cubic-bezier(.2,.9,.25,1.15),opacity .25s ease-out}
  .sibc-veil.shown .sibc-map{transform:none;opacity:1}
  .sibc-veil.folding .sibc-map{transform:perspective(1400px) rotateX(-14deg) rotateY(6deg) scale(.9);opacity:0;transition-duration:.22s,.16s}
  .sibc-veil.folding{opacity:0}
  .sibc-title{position:absolute;top:0;left:50%;transform:translateX(-50%);text-align:center;white-space:nowrap;z-index:1}
  .sibc-title .eyebrow{font:var(--ax-eyebrow);letter-spacing:.08em;text-transform:uppercase;color:var(--ax-ink-3)}
  .sibc-title .where{font:var(--ax-h3);color:var(--ax-ink);margin-top:2px}
  .sibc-title .where b{color:var(--ax-ink)}
  .sibc-title .where i{font-style:normal;color:var(--ax-ink-3);margin:0 6px}
  .sibc-title .sub{font:var(--ax-label-s);color:var(--ax-ink-3);margin-top:2px}
  .sibc-map svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
  .sibc-node{position:absolute;transform:translate(-50%,-50%) scale(.85);text-decoration:none;color:var(--ax-ink);text-align:center;opacity:0;
    transition:opacity .25s,transform .35s cubic-bezier(.2,.9,.3,1.3);transition-delay:var(--d,0s)}
  .sibc-map.settled .sibc-node{opacity:1;transform:translate(-50%,-50%) scale(1)}
  .sibc-map.settled .sibc-node.leaf.away{opacity:.55}
  .sibc-map.settled .sibc-node.leaf.away:hover{opacity:1}
  .sibc-node .youare{display:block;font:var(--ax-eyebrow);letter-spacing:.08em;text-transform:uppercase;color:var(--c,var(--ax-blue));margin-bottom:5px}
  .sibc-node.here .pill{border:2px solid var(--c,var(--ax-blue));background:var(--c,var(--ax-blue));color:var(--ax-on-accent);font-size:15px;font-weight:700;padding:9px 16px}
  .sibc-node.here .pill .n{background:var(--ax-scrim)}
  .sibc-node.here .pill .ax-mark{color:var(--ax-on-accent)}
  .sibc-node.here .youare{font-size:12px}
  .sibc-node.here .pill .ax-mark{font-size:10px;margin-right:2px}
  .sibc-node .pill{display:inline-flex;align-items:center;gap:6px;padding:7px 12px;border-radius:999px;border:var(--ax-hair);
    background:var(--ax-solid);font-size:13px;font-weight:600;white-space:nowrap;transition:transform .15s,border-color .15s}
  .sibc-node:hover .pill{transform:scale(1.06);border-color:var(--ax-ink-3)}
  .sibc-node.leaf .pill{font-size:11.5px;font-weight:500;padding:5px 9px}
  .sibc-node.centre .pill{font-size:15px;padding:10px 16px;border-color:var(--ax-blue);background:var(--ax-blue-fill)}
  .sibc-node .n{font-size:10px;font-weight:700;padding:1px 6px;border-radius:999px;background:var(--ax-paper-3)}
  .sibc-node .sw{width:8px;height:8px;border-radius:50%;display:inline-block}
  .sibc-node kbd{font:600 9.5px/1 var(--ax-mono);color:var(--ax-ink-3);border:1px solid var(--ax-rule);border-radius:4px;padding:2px 4px;margin-left:4px}
  .sibc-node.here kbd{color:var(--ax-ink-2);border-color:var(--c,var(--ax-blue))}
  .sibc-map.hubarmed .sibc-node.hub.armed .pill{border-color:var(--c);background:var(--ax-blue-fill)}
  .sibc-node .live{width:7px;height:7px;border-radius:50%;background:var(--ax-green);animation:sibc-pulse 1.6s ease-in-out infinite}
  .sibc-node .hint{display:block;font-size:10.5px;color:var(--ax-ink-2);margin-top:3px;font-weight:400}
  .sibc-foot{position:absolute;left:0;right:0;bottom:0;display:flex;flex-direction:column;gap:8px;align-items:center}
  .sibc-row{display:flex;gap:8px;flex-wrap:wrap;justify-content:center;align-items:center;font-size:11.5px;color:var(--ax-ink-2)}
  .sibc-row .chip{color:var(--ax-ink);text-decoration:none;border:var(--ax-hair);background:var(--ax-solid);border-radius:999px;padding:5px 10px;font-weight:600}
  .sibc-row .chip:hover{border-color:var(--ax-ink)}.sibc-row .chip.next{border-color:var(--ax-green);color:var(--ax-green)}
  .sibc-keys{position:absolute;top:2px;left:34px;font-size:10.5px;color:var(--ax-ink-3);font-family:var(--ax-mono);max-width:38vw}
  .sibc-close{position:absolute;top:-8px;left:0;background:none;border:none;color:var(--ax-ink-2);font-size:20px;cursor:pointer}
  @media (prefers-reduced-motion: reduce){.sibc-node,.sibc-btn,.sibc-node .pill,.sibc-map,.sibc-veil{transition:none;transform:none}.sibc-btn.live .dot,.sibc-node .live{animation:none}}
  @media (max-width:640px){.sibc-crumb{display:none}.sibc-node .hint{display:none}.sibc-node.leaf{display:none}}
  `;


  // ── Build ─────────────────────────────────────────────────────────────────
  let veil, mapEl, btn, stats = null;

  function build() {
    // The Compass is drawn from the brand tokens and components on every
    // surface. Pages not yet on the system (html without class "ax") don't
    // load brand.css themselves - link it here so the map looks the same
    // everywhere (tokens are :root variables and .ax-* classes; nothing in
    // it restyles a legacy page).
    if (!document.documentElement.classList.contains('ax') && !document.querySelector('link[href="/portal/brand/brand.css"]')) {
      const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = '/portal/brand/brand.css'; document.head.appendChild(l);
    }
    const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);

    btn = document.createElement('button');
    btn.className = 'sibc-btn'; btn.title = 'SIB Compass - where am I, where next (g g)';
    btn.setAttribute('aria-label', 'Open SIB Compass');
    btn.innerHTML = `<svg viewBox="0 0 28 28" fill="none"><path d="M14 3L24 9V19L14 25L4 19V9L14 3Z" stroke="var(--ax-blue)" stroke-width="1.6"/>
      <path d="M14 8l3.5 6L14 20l-3.5-6z" fill="var(--ax-blue)" fill-opacity=".85"/><circle cx="14" cy="14" r="1.6" fill="var(--ax-solid)"/></svg><span class="dot"></span>`;
    btn.onclick = toggle;
    document.body.appendChild(btn);
    // The roadmap canvas keeps a hint bar along the bottom - sit above it.
    if (location.pathname.startsWith('/roadmap')) { btn.style.bottom = '58px'; }

    const crumb = document.createElement('div'); crumb.className = 'sibc-crumb'; crumb.id = 'sibc-crumb';
    if (location.pathname.startsWith('/roadmap')) { crumb.style.bottom = '62px'; }
    document.body.appendChild(crumb);
    renderCrumb();

    veil = document.createElement('div'); veil.className = 'sibc-veil';
    veil.addEventListener('click', e => { if (e.target === veil) close(); });
    mapEl = document.createElement('div'); mapEl.className = 'sibc-map';
    veil.appendChild(mapEl); document.body.appendChild(veil);

    document.addEventListener('keydown', onKey);
    window.addEventListener('hashchange', () => { renderCrumb(); remember(); if (veil.classList.contains('open')) renderMap(); });
    remember();
    refreshStats();
    setInterval(refreshStats, 30000);
  }

  function renderCrumb() {
    const el = document.getElementById('sibc-crumb'); if (!el) return;
    const path = locate();
    el.innerHTML = path.map((id, i) => {
      const n = find(id); const last = i === path.length - 1;
      const text = last ? `<b>${n?.label || id}</b>` : `<a href="${n?.href || '/'}">${n?.label || id}</a>`;
      return (i ? '<i>›</i>' : '') + text;
    }).join('');
  }

  async function refreshStats() {
    try {
      const r = await fetch('/stats', { cache: 'no-store' });
      if (!r.ok) return;
      stats = await r.json();
      btn.classList.toggle('live', (stats.liveRuns || 0) > 0);
      btn.title = (stats.liveRuns || 0) > 0 ? `SIB Compass - ${stats.liveRuns} guide run${stats.liveRuns === 1 ? '' : 's'} live now` : 'SIB Compass - where am I, where next (g g)';
      if (veil.classList.contains('open')) renderMap();
    } catch { /* offline / locked - the map still works without numbers */ }
  }

  // Live badges per node id: [count, tooltip, isLive]
  function badge(id) {
    if (!stats) return null;
    const s = stats;
    switch (id) {
      case 'portal':    return s.anchors ? [s.anchors, 'chambers'] : null;
      case 'anchors':   return s.presenceNow ? [s.presenceNow, 'people on tools now', true] : null;
      case 'ar-guides': return s.liveRuns ? [s.liveRuns, 'runs live now', true] : (s.sessionsToday ? [s.sessionsToday, 'runs today'] : null);
      case 'content':   return s.guides ? [s.guides, `guides · ${s.placedGuides || 0} placed`] : null;
      case 'gemba':     return s.openGembaFindings ? [s.openGembaFindings, 'open findings'] : null;
      case 'iloto':     return s.activeLotoLocks ? [s.activeLotoLocks, 'active locks'] : null;
      case 'configs':   return s.chamberConfigs ? [s.chamberConfigs, 'configurations'] : null;
      case 'logs':      return s.qaDevices ? [s.qaDevices, 'devices in QA Mode', true] : null;
      case 'admin':     return s.qaDevices ? [s.qaDevices, 'QA', true] : null;
      case 'platform':  return s.validatedSteps ? [s.validatedSteps, 'steps validated'] : null;
      default: return null;
    }
  }

  // "Where next?" - the portal's getting-started ladder, condensed.
  function whereNext() {
    if (!stats) return [];
    const out = [];
    if (!stats.chamberConfigs)            out.push({ label: 'Add a chamber configuration', href: '/portal#admin/configs' });
    else if (!stats.anchors)              out.push({ label: 'Create the first chamber', href: '/portal#anchors' });
    else if (!stats.guides)               out.push({ label: 'Write a guide', href: '/roadmap' });
    else if ((stats.placedGuides || 0) < stats.guides) out.push({ label: 'Place steps on the iPad', href: '/portal#content/guides' });
    if (stats.liveRuns)                   out.push({ label: `Watch ${stats.liveRuns} live run${stats.liveRuns === 1 ? '' : 's'}`, href: '/portal#ar-guides' });
    else if (stats.sessionsToday)         out.push({ label: `Today's completion log (${stats.sessionsToday})`, href: '/portal#ar-guides/usage' });
    if (stats.qaDevices)                  out.push({ label: 'Read QA device logs', href: '/portal#admin/logs' });
    if (stats.openGembaFindings)          out.push({ label: `${stats.openGembaFindings} open Gemba findings`, href: '/portal#gemba' });
    return out.slice(0, 3);
  }

  // ── The hexagon ───────────────────────────────────────────────────────────
  // The Compass icon is a hexagon with a dot in the middle: the dot is SIB
  // Home, the six corners are the six surfaces. The map draws exactly that.
  // Each corner's stops sit outside the hexagon on its own side - a row above
  // the top corner, a row below the bottom one, columns beside the side ones
  // - so nothing overlaps and every connector is short and ends on a pill.
  const HEX_ORDER = ['portal', 'platform', 'roadmap', 'admin', 'wireframe', 'catalog'];   // top, then clockwise
  const HEX_ANGLES = [-90, -30, 30, 90, 150, 210];
  const KEY_OF = { portal: 'p', platform: 'm', roadmap: 'r', admin: 'a', wireframe: 'w', catalog: 'c' };

  function renderMap() {
    const path = locate();
    const W = mapEl.clientWidth, H = mapEl.clientHeight;
    const cx = W / 2, cy = H / 2 - 10;
    const R = Math.max(150, Math.min(W * 0.20, (H - 260) * 0.36));
    const pos = { sib: [cx, cy] };
    const hubs = HEX_ORDER.map(id => find(id)).filter(Boolean);
    const vertex = {};
    hubs.forEach((h, i) => {
      const a = HEX_ANGLES[i] * Math.PI / 180;
      vertex[h.id] = [cx + R * Math.cos(a), cy + R * Math.sin(a)];
      pos[h.id] = vertex[h.id];
    });
    // Stops per corner. Distances scale with the hexagon so a laptop still fits.
    const rowGap = Math.min(180, Math.max(120, W / 7)), colGap = 54, out = Math.max(120, R * 0.62), side = Math.max(210, R * 1.05);
    hubs.forEach((h, i) => {
      const kids = h.children || []; if (!kids.length) return;
      const [vx, vy] = vertex[h.id];
      const dir = HEX_ORDER[i];
      if (dir === 'portal' || dir === 'admin') {
        // Row(s) above / below: at most 5 per row, extra rows further out.
        const per = Math.min(5, kids.length);
        const rows = Math.ceil(kids.length / per);
        kids.forEach((k, j) => {
          const row = Math.floor(j / per), inRow = row === rows - 1 ? kids.length - row * per : per;
          const col = j - row * per;
          const x = vx + (col - (inRow - 1) / 2) * rowGap;
          const y = dir === 'portal' ? vy - out - row * 70 : vy + out + row * 70;
          pos[k.id] = [x, y];
        });
      } else {
        // Column beside the corner, centred on it, pushed outward.
        const right = dir === 'platform' || dir === 'roadmap';
        kids.forEach((k, j) => {
          pos[k.id] = [vx + (right ? side : -side), vy + (j - (kids.length - 1) / 2) * colGap];
        });
      }
    });
    // Keep everything on the map.
    for (const id in pos) { pos[id][0] = Math.min(W - 90, Math.max(90, pos[id][0])); pos[id][1] = Math.min(H - 130, Math.max(118, pos[id][1])); }

    // Title: where you are, in the same words as every page's breadcrumb.
    const words = path.map((id, i) => i === 0 ? 'SIB Home' : (find(id)?.label || id));
    let html = `<svg id="sibc-edges"></svg><div class="sibc-title"><div class="eyebrow">SIB Compass</div>
      <div class="where">${words.map((w, i) => (i ? '<i>›</i>' : '') + (i === words.length - 1 ? `<b>${w}</b>` : w)).join('')}</div>
      <div class="sub">The dot is SIB Home; the six corners are its surfaces; their stops sit outside. Click any place, or type its key.</div></div>`;
    html += node(TREE, pos.sib, 'centre', path, 'var(--ax-blue)', true, 'g h');
    hubs.forEach((h, i) => {
      const inHub = path.includes(h.id);
      html += node(h, pos[h.id], 'hub', path, h.color, inHub, `g ${KEY_OF[h.id]}`);
      (h.children || []).forEach((k, j) => html += node(k, pos[k.id], 'leaf', path, h.color, inHub, `${KEY_OF[h.id]}${j + 1}`));
    });

    const next = whereNext();
    const rec = recents().filter(r => r.href !== location.pathname + location.hash).slice(0, 3);
    html += `<div class="sibc-foot">
      ${next.length ? `<div class="sibc-row">Where next?${next.map(n => `<a class="chip next" href="${n.href}">${n.label}</a>`).join('')}</div>` : ''}
      ${rec.length ? `<div class="sibc-row">Recent${rec.map(r => `<a class="chip" href="${r.href}">${r.label}</a>`).join('')}</div>` : ''}
    </div>
    <div class="sibc-keys">g then a letter opens a surface · a letter then a number opens its stop · esc closes</div>
    <button class="sibc-close" aria-label="Close"><svg class="ax-icon" style="width:18px;height:18px"><use href="/portal/brand/icons.svg#i-close"/></svg></button>`;
    mapEl.innerHTML = html;
    mapEl.querySelector('.sibc-close').onclick = close;
    mapEl.querySelectorAll('a.sibc-node, a.chip').forEach(a => a.addEventListener('click', () => {
      if (a.getAttribute('href').split('#')[0] === location.pathname) setTimeout(close, 60);
    }));
    drawEdges(hubs, path);
    mapEl.classList.remove('settled');
    requestAnimationFrame(() => requestAnimationFrame(() => mapEl.classList.add('settled')));
  }

  /** Connectors measured against the rendered pills, so every line starts and
   *  ends ON a pill's border - never through it, never short of it. */
  function drawEdges(hubs, path) {
    const svg = mapEl.querySelector('#sibc-edges'); if (!svg) return;
    const W = mapEl.clientWidth, H = mapEl.clientHeight;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const mr = mapEl.getBoundingClientRect();
    const box = {};
    mapEl.querySelectorAll('a.sibc-node').forEach(a => {
      const r = a.querySelector('.pill').getBoundingClientRect();
      box[a.dataset.id] = { l: r.left - mr.left, t: r.top - mr.top, r: r.right - mr.left, b: r.bottom - mr.top };
    });
    const centre = b => [(b.l + b.r) / 2, (b.t + b.b) / 2];
    // Point where the segment centre(a)→centre(b) leaves box a, padded 4 px.
    const exit = (a, b) => {
      const [ax, ay] = centre(a), [bx, by] = centre(b);
      const dx = bx - ax, dy = by - ay; if (!dx && !dy) return [ax, ay];
      const hw = (a.r - a.l) / 2 + 4, hh = (a.b - a.t) / 2 + 4;
      const t = Math.min(dx ? hw / Math.abs(dx) : Infinity, dy ? hh / Math.abs(dy) : Infinity);
      return [ax + dx * t, ay + dy * t];
    };
    const seg = (idA, idB, stroke, w, opacity) => {
      const a = box[idA], b = box[idB]; if (!a || !b) return '';
      const [x1, y1] = exit(a, b), [x2, y2] = exit(b, a);
      return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${stroke}" stroke-width="${w}" stroke-linecap="round"${opacity ? ` stroke-opacity="${opacity}"` : ''}/>`;
    };
    const onPath = (a, b) => path.includes(a) && path.includes(b);
    let out = '';
    // The hexagon itself: corner to corner, quiet.
    for (let i = 0; i < hubs.length; i++) out += seg(hubs[i].id, hubs[(i + 1) % hubs.length].id, 'var(--ax-ink-4)', 1, .6);
    // Spokes and stops; the path you are on is lit in the surface's colour.
    for (const h of hubs) {
      const hp = onPath('sib', h.id);
      if (hp) out += seg('sib', h.id, h.color, 10, .18);
      out += seg('sib', h.id, hp ? h.color : 'var(--ax-ink-4)', hp ? 3 : 1.2);
      for (const k of h.children || []) {
        const kp = onPath(h.id, k.id);
        if (kp) out += seg(h.id, k.id, h.color, 10, .18);
        out += seg(h.id, k.id, kp ? h.color : 'var(--ax-ink-4)', kp ? 3 : 1);
      }
    }
    svg.innerHTML = out;
  }

  function node(n, [x, y], kind, path, color, inHub, key) {
    const here = path[path.length - 1] === n.id;
    const b = badge(n.id);
    const bHtml = b ? `<span class="n" title="${b[1]}">${b[0]}</span>${b[2] ? '<span class="live"></span>' : ''}` : '';
    const swatch = kind === 'hub' ? `<span class="sw" style="background:${color}"></span>` : '';
    const hint = kind !== 'leaf' && n.hint && !here ? `<span class="hint">${n.hint}</span>` : '';
    const youare = here ? `<span class="youare">You are here</span>` : '';
    const mark = here ? `<span class="ax-mark is-green"><i></i><em></em></span>` : '';
    const away = kind === 'leaf' && !inHub && !here ? ' away' : '';
    const delay = kind === 'centre' ? 0 : kind === 'hub' ? .08 : .16;
    const label = kind === 'centre' ? 'SIB Home' : n.label;
    return `<a class="sibc-node ${kind}${here ? ' here' : ''}${away}" data-id="${n.id}" href="${n.href}" style="left:${x}px;top:${y}px;--d:${delay}s;--c:${color || 'var(--ax-blue)'}" title="${n.hint || n.label}">
      ${youare}<span class="pill">${mark}${swatch}${label}${bHtml}<kbd>${key}</kbd></span>${hint}</a>`;
  }

  let closing = null;
  function open() {
    if (closing) { clearTimeout(closing); closing = null; }
    veil.classList.remove('folding');
    veil.classList.add('open'); renderMap();
    requestAnimationFrame(() => requestAnimationFrame(() => veil.classList.add('shown')));
  }
  function close() {
    if (!veil.classList.contains('open')) return;
    veil.classList.add('folding'); veil.classList.remove('shown');
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    closing = setTimeout(() => { veil.classList.remove('open', 'folding'); closing = null; }, reduce ? 0 : 230);
  }
  function toggle() { veil.classList.contains('open') ? close() : open(); }

  // Keys. Anywhere: `g` then a letter opens a surface (`g g` the map).
  // With the map open: a surface letter then a number opens that stop
  // (`p 3` = the third stop of Portal, as printed on the pills); the letter
  // alone opens the surface after a beat. Esc closes. Ignored while typing.
  let gArmed = 0, hubArmed = null, hubTimer = null;
  const HUB_HREF = { h: '/', p: '/portal#home', m: '/platform', r: '/roadmap', c: '/catalog', w: '/wireframe', a: '/portal#admin/uam' };
  const HUB_ID = { p: 'portal', m: 'platform', r: 'roadmap', c: 'catalog', w: 'wireframe', a: 'admin' };
  function onKey(e) {
    const t = e.target; const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable || t.tagName === 'SELECT');
    if (e.key === 'Escape' && veil.classList.contains('open')) { close(); return; }
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    const now = Date.now();
    const isOpen = veil.classList.contains('open');
    if (isOpen && hubArmed && /^[1-9]$/.test(e.key)) {
      clearTimeout(hubTimer); const hub = find(HUB_ID[hubArmed]); hubArmed = null; mapEl.classList.remove('hubarmed');
      const stop = hub?.children?.[Number(e.key) - 1]; if (stop) location.href = stop.href; return;
    }
    if (isOpen && e.key in HUB_ID && !gArmed) {
      clearTimeout(hubTimer); hubArmed = e.key;
      mapEl.querySelectorAll('.sibc-node.hub').forEach(a => a.classList.toggle('armed', a.dataset.id === HUB_ID[e.key]));
      mapEl.classList.add('hubarmed');
      hubTimer = setTimeout(() => { if (hubArmed) { location.href = HUB_HREF[hubArmed]; hubArmed = null; } }, 900);
      return;
    }
    if (gArmed && now - gArmed < 1200) {
      gArmed = 0;
      if (e.key === 'g') { toggle(); return; }
      if (e.key in HUB_HREF) { location.href = HUB_HREF[e.key]; return; }
    }
    if (e.key === 'g') { gArmed = now; }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
})();
