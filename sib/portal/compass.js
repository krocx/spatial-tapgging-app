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
  .sibc-title{position:absolute;top:0;left:50%;transform:translateX(-50%);text-align:center;white-space:nowrap}
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
  .sibc-node.here .pill{border:2px solid var(--c,var(--ax-blue));background:var(--ax-blue-fill);font-size:14px;padding:8px 14px}
  .sibc-node.here .pill .ax-mark{font-size:10px;margin-right:2px}
  .sibc-node .pill{display:inline-flex;align-items:center;gap:6px;padding:7px 12px;border-radius:999px;border:var(--ax-hair);
    background:var(--ax-solid);font-size:13px;font-weight:600;white-space:nowrap;transition:transform .15s,border-color .15s}
  .sibc-node:hover .pill{transform:scale(1.06);border-color:var(--ax-ink-3)}
  .sibc-node.leaf .pill{font-size:11.5px;font-weight:500;padding:5px 9px}
  .sibc-node.centre .pill{font-size:15px;padding:10px 16px;border-color:var(--ax-blue);background:var(--ax-blue-fill)}
  .sibc-node .n{font-size:10px;font-weight:700;padding:1px 6px;border-radius:999px;background:var(--ax-paper-3)}
  .sibc-node .live{width:7px;height:7px;border-radius:50%;background:var(--ax-green);animation:sibc-pulse 1.6s ease-in-out infinite}
  .sibc-node .hint{display:block;font-size:10.5px;color:var(--ax-ink-2);margin-top:3px;font-weight:400}
  .sibc-foot{position:absolute;left:0;right:0;bottom:0;display:flex;flex-direction:column;gap:8px;align-items:center}
  .sibc-row{display:flex;gap:8px;flex-wrap:wrap;justify-content:center;align-items:center;font-size:11.5px;color:var(--ax-ink-2)}
  .sibc-row .chip{color:var(--ax-ink);text-decoration:none;border:var(--ax-hair);background:var(--ax-solid);border-radius:999px;padding:5px 10px;font-weight:600}
  .sibc-row .chip:hover{border-color:var(--ax-ink)}.sibc-row .chip.next{border-color:var(--ax-green);color:var(--ax-green)}
  .sibc-keys{position:absolute;top:0;left:34px;font-size:10.5px;color:var(--ax-ink-3);font-family:var(--ax-mono)}
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

  function renderMap() {
    const path = locate();
    const W = mapEl.clientWidth, H = mapEl.clientHeight;
    // Two ellipses: hubs on the inner one, their stops on the outer one. The
    // foot (where-next / recents) needs ~90 px, so the centre sits a little
    // high. Radii use the WIDTH - a laptop is wide, use it.
    const cx = W / 2, cy = (H - 90) / 2 + 10;
    const rx1 = W * 0.26, ry1 = (H - 90) * 0.28;
    const rx2 = W * 0.47, ry2 = (H - 90) * 0.48;
    const hubs = TREE.children;
    const pos = { sib: [cx, cy] };
    // Each hub owns an angular SECTOR sized by how many stops it has, so
    // Portal (7) gets the wide top arc and Wireframe (0) a sliver - leaves of
    // neighbouring hubs can never land on each other. Portal is centred at 12
    // o'clock; the rest follow clockwise.
    const weights = hubs.map(h => Math.max((h.children || []).length, 2.5));
    const total = weights.reduce((a, b) => a + b, 0);
    let start = -Math.PI / 2 - (weights[0] / total) * Math.PI;   // Portal's sector straddles the top
    hubs.forEach((h, i) => {
      const sector = (weights[i] / total) * Math.PI * 2;
      const a = start + sector / 2;
      pos[h.id] = [cx + rx1 * Math.cos(a), cy + ry1 * Math.sin(a)];
      const kids = h.children || [];
      const spread = kids.length <= 1 ? 0 : sector * 0.82;
      kids.forEach((k, j) => {
        const b = a + (kids.length === 1 ? 0 : (-spread / 2 + (j / (kids.length - 1)) * spread));
        pos[k.id] = [cx + rx2 * Math.cos(b), cy + ry2 * Math.sin(b)];
      });
      start += sector;
    });

    // Relax: the ring puts 16 stops on one ellipse, which is tight on a
    // laptop. A few hundred cheap push-apart passes guarantee no two nodes
    // sit closer than MIN px (hubs move a third as much, so the ring shape
    // survives); everything stays inside the map with a margin.
    const MIN = 150, PAD = 70;
    const ids = Object.keys(pos).filter(id => id !== 'sib');
    const isHub = new Set(hubs.map(h => h.id));
    for (let it = 0; it < 300; it++) {
      for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
        const a = pos[ids[i]], b = pos[ids[j]];
        let dx = b[0] - a[0], dy = b[1] - a[1];
        const d = Math.hypot(dx, dy) || 1;
        if (d >= MIN) continue;
        const push = (MIN - d) / 4; dx /= d; dy /= d;
        const wa = isHub.has(ids[i]) ? 0.3 : 1, wb = isHub.has(ids[j]) ? 0.3 : 1;
        a[0] -= dx * push * wa; a[1] -= dy * push * wa;
        b[0] += dx * push * wb; b[1] += dy * push * wb;
      }
      for (const id of ids) {
        pos[id][0] = Math.min(W - PAD, Math.max(PAD, pos[id][0]));
        pos[id][1] = Math.min(H - 120, Math.max(PAD + 40, pos[id][1]));   // +40: the title line sits at the top
      }
    }

    // Edges
    let svg = `<svg viewBox="0 0 ${W} ${H}">`;
    const onPath = (a, b) => path.includes(a) && path.includes(b);
    for (const h of hubs) {
      const hp = onPath('sib', h.id);
      if (hp) svg += line(pos.sib, pos[h.id], h.color, 10, .18);
      svg += line(pos.sib, pos[h.id], hp ? h.color : 'var(--ax-ink-4)', hp ? 3 : 1.2);
      for (const k of h.children || []) {
        const kp = onPath(h.id, k.id);
        if (kp) svg += line(pos[h.id], pos[k.id], h.color, 10, .18);
        svg += line(pos[h.id], pos[k.id], kp ? h.color : 'var(--ax-ink-4)', kp ? 3 : 1);
      }
    }
    svg += '</svg>';

    // Nodes
    let html = svg;
    // Title: where you are, in words, before the map has to be read.
    const words = path.map(id => find(id)?.label || id);
    html += `<div class="sibc-title"><div class="eyebrow">SIB Compass</div>
      <div class="where">You are in ${words.map((w, i) => (i ? '<i>›</i>' : '') + (i === words.length - 1 ? `<b>${w}</b>` : w)).join('')}</div>
      <div class="sub">Every place in SIB, one click away · the lit path is where you are</div></div>`;
    html += node(TREE, pos.sib, 'centre', path);
    for (const h of hubs) {
      const inHub = path.includes(h.id);
      html += node(h, pos[h.id], 'hub', path, h.color, inHub);
      for (const k of h.children || []) html += node(k, pos[k.id], 'leaf', path, h.color, inHub);
    }

    // Foot: where next + recents
    const next = whereNext();
    const rec = recents().filter(r => r.href !== location.pathname + location.hash).slice(0, 3);
    html += `<div class="sibc-foot">
      ${next.length ? `<div class="sibc-row">Where next?${next.map(n => `<a class="chip next" href="${n.href}">${n.label}</a>`).join('')}</div>` : ''}
      ${rec.length ? `<div class="sibc-row">Recent${rec.map(r => `<a class="chip" href="${r.href}">${r.label}</a>`).join('')}</div>` : ''}
    </div>
    <div class="sibc-keys">g h · g p · g m · g r · g c · g w · g a &nbsp; esc</div>
    <button class="sibc-close" aria-label="Close"><svg class="ax-icon" style="width:18px;height:18px"><use href="/portal/brand/icons.svg#i-close"/></svg></button>`;
    mapEl.innerHTML = html;
    mapEl.querySelector('.sibc-close').onclick = close;
    mapEl.querySelectorAll('a.sibc-node, a.chip').forEach(a => a.addEventListener('click', () => {
      // Same-page hash links don't reload - close so the page is visible.
      if (a.getAttribute('href').split('#')[0] === location.pathname) setTimeout(close, 60);
    }));
    mapEl.classList.remove('settled');
    requestAnimationFrame(() => requestAnimationFrame(() => mapEl.classList.add('settled')));
  }
  function line([x1, y1], [x2, y2], stroke, w, opacity) {
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${w}" stroke-linecap="round"${opacity ? ` stroke-opacity="${opacity}"` : ''}/>`;
  }
  function node(n, [x, y], kind, path, color, inHub) {
    const here = path[path.length - 1] === n.id;
    const b = badge(n.id);
    const bHtml = b ? `<span class="n" title="${b[1]}">${b[0]}</span>${b[2] ? '<span class="live"></span>' : ''}` : '';
    const swatch = kind === 'hub' ? `<span style="width:8px;height:8px;border-radius:50%;background:${color}"></span>` : '';
    const hint = kind !== 'leaf' && n.hint && !here ? `<span class="hint">${n.hint}</span>` : '';
    // "You are here": an eyebrow in the hub colour above the lit pill, with
    // the registration mark - the one thing the map must make obvious.
    const youare = here ? `<span class="youare">You are here</span>` : '';
    const mark = here ? `<span class="ax-mark is-green"><i></i><em></em></span>` : '';
    const away = kind === 'leaf' && !inHub && !here ? ' away' : '';
    const delay = kind === 'centre' ? 0 : kind === 'hub' ? .08 : .16;
    return `<a class="sibc-node ${kind}${here ? ' here' : ''}${away}" href="${n.href}" style="left:${x}px;top:${y}px;--d:${delay}s;--c:${color || 'var(--ax-blue)'}" title="${n.hint || n.label}">
      ${youare}<span class="pill">${mark}${swatch}${n.label}${bHtml}</span>${hint}</a>`;
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

  // Keys: `g` then a letter; Esc closes. Ignored while typing.
  let gArmed = 0;
  function onKey(e) {
    const t = e.target; const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable || t.tagName === 'SELECT');
    if (e.key === 'Escape' && veil.classList.contains('open')) { close(); return; }
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    const now = Date.now();
    if (gArmed && now - gArmed < 1200) {
      gArmed = 0;
      if (e.key === 'g') { toggle(); return; }
      const map = { h: '/', p: '/portal#home', m: '/platform', r: '/roadmap', c: '/catalog', w: '/wireframe', a: '/portal#admin/uam' };
      if (e.key in map) { location.href = map[e.key]; return; }
    }
    if (e.key === 'g') { gArmed = now; }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
})();
