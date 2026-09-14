// compass.js — SIB Compass: one persistent, spatial navigator on every SIB web
// surface (home, portal, platform, catalogue, roadmap, wireframe).
//
// Why: each surface grew its own way home (⌂, ⚡, "SIB home", nothing). The
// Compass gives every page the same three things — where am I, where can I
// go, what's happening — without touching any page's own layout.
//
//   • Button, bottom-right (brand hex). Click / `?`-style shortcut `g g` opens.
//     A dot on the button = a guide run is live right now.
//   • Map: radial graph — SIB in the centre, six surfaces around it, their
//     stops fanning out. Current node lit, path from centre drawn. Any node is
//     one click, leaf to leaf. Live counts from /stats ride on the nodes.
//   • Breadcrumb line: SIB › Portal › Admin › Device Logs — clickable.
//   • "Where next?" — up to three chips from the same getting-started logic
//     the portal uses (needs configs → guides → placement → today's log).
//   • Recents — last three places (localStorage), one tap back.
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
      { id: 'portal', label: 'Portal', href: '/portal#home', color: '#4f8ef7', key: 'p', hint: 'Chambers, tags, guides, sessions',
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
      { id: 'admin', label: 'Admin', href: '/portal#admin/uam', color: '#f59e0b', key: 'a', hint: 'Users, configs, logs, backups',
        children: [
          { id: 'uam',     label: 'User Access',     href: '/portal#admin/uam' },
          { id: 'configs', label: 'Chamber Configs', href: '/portal#admin/configs' },
          { id: 'logs',    label: 'Device Logs',     href: '/portal#admin/logs' },
          { id: 'ops',     label: 'Ops Log',         href: '/portal#admin/ops' },
          { id: 'backup',  label: 'Backups',         href: '/portal#admin/backup' },
        ] },
      { id: 'platform', label: 'Platform', href: '/platform', color: '#5eead4', key: 'm', hint: 'The Chamber — what SIB is',
        children: [
          { id: 'assess', label: 'Assessment',   href: '/platform#assess' },
          { id: 'long',   label: 'Long version', href: '/platform/long' },
        ] },
      { id: 'roadmap', label: 'Roadmap', href: '/roadmap', color: '#f5c96b', key: 'r', hint: 'Roadmaps & Procedure Designer',
        children: [
          { id: 'designer', label: 'Procedure Designer', href: '/roadmap' },
        ] },
      { id: 'catalog', label: 'Catalogue', href: '/catalog', color: '#c4b5fd', key: 'c', hint: 'Every feature, documented',
        children: [
          { id: 'ask', label: 'Ask SIB', href: '/catalog#ask' },
        ] },
      { id: 'wireframe', label: 'Wireframe', href: '/wireframe', color: '#fb7185', key: 'w', hint: 'The app, flow by flow', children: [] },
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
  .sibc-btn{position:fixed;right:18px;bottom:18px;z-index:9400;width:48px;height:48px;padding:0;margin:0;line-height:0;border-radius:14px;border:1px solid rgba(255,255,255,.14);
    background:rgba(12,16,28,.82);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);cursor:pointer;display:grid;place-items:center;
    box-shadow:0 8px 28px rgba(0,0,0,.35);transition:transform .15s,box-shadow .15s;font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif}
  .sibc-btn:hover{transform:translateY(-2px);box-shadow:0 12px 32px rgba(79,142,247,.35)}
  .sibc-btn svg{width:26px;height:26px;display:block}
  .sibc-btn .dot{position:absolute;top:-3px;right:-3px;width:11px;height:11px;border-radius:50%;background:#22c55e;border:2px solid #0c101c;display:none}
  .sibc-btn.live .dot{display:block;animation:sibc-pulse 1.6s ease-in-out infinite}
  @keyframes sibc-pulse{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.35);opacity:.6}}
  .sibc-crumb{position:fixed;left:14px;bottom:22px;z-index:9390;font:12px/1 -apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif;
    color:#aab1d6;background:rgba(12,16,28,.72);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,.1);
    border-radius:999px;padding:8px 12px;display:flex;gap:6px;align-items:center;max-width:60vw;overflow:hidden;white-space:nowrap}
  .sibc-crumb a{color:#aab1d6;text-decoration:none}.sibc-crumb a:hover{color:#fff}.sibc-crumb b{color:#fff;font-weight:600}.sibc-crumb i{opacity:.45;font-style:normal}
  .sibc-veil{position:fixed;inset:0;z-index:9500;background:rgba(6,8,16,.62);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);display:none;align-items:center;justify-content:center}
  .sibc-veil.open{display:flex}
  .sibc-map{position:relative;width:min(1180px,96vw);height:min(780px,88vh);color:#e5e9f2;font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif}
  .sibc-map svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
  .sibc-node{position:absolute;transform:translate(-50%,-50%);text-decoration:none;color:#e5e9f2;text-align:center;opacity:0;
    transition:opacity .25s,transform .35s cubic-bezier(.2,.9,.3,1.3)}
  .sibc-map.settled .sibc-node{opacity:1}
  .sibc-node .pill{display:inline-flex;align-items:center;gap:6px;padding:7px 12px;border-radius:999px;border:1px solid rgba(255,255,255,.14);
    background:rgba(20,26,44,.92);font-size:13px;font-weight:600;white-space:nowrap;box-shadow:0 4px 14px rgba(0,0,0,.3);transition:transform .15s,border-color .15s}
  .sibc-node:hover .pill{transform:scale(1.06);border-color:rgba(255,255,255,.4)}
  .sibc-node.leaf .pill{font-size:11.5px;font-weight:500;padding:5px 9px;background:rgba(20,26,44,.8)}
  .sibc-node.here .pill{border-color:#fff;box-shadow:0 0 0 3px rgba(255,255,255,.18),0 6px 18px rgba(0,0,0,.4)}
  .sibc-node.centre .pill{font-size:15px;padding:10px 16px;border-color:#4f8ef7;background:rgba(79,142,247,.18)}
  .sibc-node .n{font-size:10px;font-weight:700;padding:1px 6px;border-radius:999px;background:rgba(255,255,255,.14)}
  .sibc-node .live{width:7px;height:7px;border-radius:50%;background:#22c55e;animation:sibc-pulse 1.6s ease-in-out infinite}
  .sibc-node .hint{display:block;font-size:10.5px;color:#aab1d6;margin-top:3px;font-weight:400}
  .sibc-foot{position:absolute;left:0;right:0;bottom:0;display:flex;flex-direction:column;gap:8px;align-items:center}
  .sibc-row{display:flex;gap:8px;flex-wrap:wrap;justify-content:center;align-items:center;font-size:11.5px;color:#aab1d6}
  .sibc-row .chip{color:#e5e9f2;text-decoration:none;border:1px solid rgba(255,255,255,.14);background:rgba(20,26,44,.85);border-radius:999px;padding:5px 10px;font-weight:600}
  .sibc-row .chip:hover{border-color:#fff}.sibc-row .chip.next{border-color:rgba(94,234,212,.6);color:#5eead4}
  .sibc-keys{position:absolute;top:0;left:34px;font-size:10.5px;color:#7c86ad;font-family:ui-monospace,Menlo,monospace}
  .sibc-close{position:absolute;top:-8px;left:0;background:none;border:none;color:#aab1d6;font-size:20px;cursor:pointer}
  @media (prefers-reduced-motion: reduce){.sibc-node,.sibc-btn,.sibc-node .pill{transition:none}.sibc-btn.live .dot,.sibc-node .live{animation:none}}
  @media (max-width:640px){.sibc-crumb{display:none}.sibc-node .hint{display:none}.sibc-node.leaf{display:none}}
  `;

  // ── Build ─────────────────────────────────────────────────────────────────
  let veil, mapEl, btn, stats = null;

  function build() {
    const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);

    btn = document.createElement('button');
    btn.className = 'sibc-btn'; btn.title = 'SIB Compass — where am I, where next (g g)';
    btn.setAttribute('aria-label', 'Open SIB Compass');
    btn.innerHTML = `<svg viewBox="0 0 28 28" fill="none"><path d="M14 3L24 9V19L14 25L4 19V9L14 3Z" stroke="#4f8ef7" stroke-width="1.6"/>
      <path d="M14 8l3.5 6L14 20l-3.5-6z" fill="#4f8ef7" fill-opacity=".85"/><circle cx="14" cy="14" r="1.6" fill="#0c101c"/></svg><span class="dot"></span>`;
    btn.onclick = toggle;
    document.body.appendChild(btn);
    // The roadmap canvas keeps a hint bar along the bottom — sit above it.
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
      btn.title = (stats.liveRuns || 0) > 0 ? `SIB Compass — ${stats.liveRuns} guide run${stats.liveRuns === 1 ? '' : 's'} live now` : 'SIB Compass — where am I, where next (g g)';
      if (veil.classList.contains('open')) renderMap();
    } catch { /* offline / locked — the map still works without numbers */ }
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

  // "Where next?" — the portal's getting-started ladder, condensed.
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
    // high. Radii use the WIDTH — a laptop is wide, use it.
    const cx = W / 2, cy = (H - 90) / 2 + 10;
    const rx1 = W * 0.26, ry1 = (H - 90) * 0.28;
    const rx2 = W * 0.47, ry2 = (H - 90) * 0.48;
    const hubs = TREE.children;
    const pos = { sib: [cx, cy] };
    // Each hub owns an angular SECTOR sized by how many stops it has, so
    // Portal (7) gets the wide top arc and Wireframe (0) a sliver — leaves of
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
        pos[id][1] = Math.min(H - 120, Math.max(PAD, pos[id][1]));
      }
    }

    // Edges
    let svg = `<svg viewBox="0 0 ${W} ${H}">`;
    const onPath = (a, b) => path.includes(a) && path.includes(b);
    for (const h of hubs) {
      svg += line(pos.sib, pos[h.id], onPath('sib', h.id) ? h.color : 'rgba(255,255,255,.14)', onPath('sib', h.id) ? 2.5 : 1.2);
      for (const k of h.children || []) svg += line(pos[h.id], pos[k.id], onPath(h.id, k.id) ? h.color : 'rgba(255,255,255,.08)', onPath(h.id, k.id) ? 2 : 1);
    }
    svg += '</svg>';

    // Nodes
    let html = svg;
    html += node(TREE, pos.sib, 'centre', path);
    for (const h of hubs) {
      html += node(h, pos[h.id], 'hub', path, h.color);
      for (const k of h.children || []) html += node(k, pos[k.id], 'leaf', path, h.color);
    }

    // Foot: where next + recents
    const next = whereNext();
    const rec = recents().filter(r => r.href !== location.pathname + location.hash).slice(0, 3);
    html += `<div class="sibc-foot">
      ${next.length ? `<div class="sibc-row">Where next?${next.map(n => `<a class="chip next" href="${n.href}">${n.label}</a>`).join('')}</div>` : ''}
      ${rec.length ? `<div class="sibc-row">Recent${rec.map(r => `<a class="chip" href="${r.href}">${r.label}</a>`).join('')}</div>` : ''}
    </div>
    <div class="sibc-keys">g h · g p · g m · g r · g c · g w · g a &nbsp; esc</div>
    <button class="sibc-close" aria-label="Close">✕</button>`;
    mapEl.innerHTML = html;
    mapEl.querySelector('.sibc-close').onclick = close;
    mapEl.querySelectorAll('a.sibc-node, a.chip').forEach(a => a.addEventListener('click', () => {
      // Same-page hash links don't reload — close so the page is visible.
      if (a.getAttribute('href').split('#')[0] === location.pathname) setTimeout(close, 60);
    }));
    mapEl.classList.remove('settled');
    requestAnimationFrame(() => requestAnimationFrame(() => mapEl.classList.add('settled')));
  }
  function line([x1, y1], [x2, y2], stroke, w) {
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${w}" stroke-linecap="round"/>`;
  }
  function node(n, [x, y], kind, path, color) {
    const here = path[path.length - 1] === n.id;
    const b = badge(n.id);
    const bHtml = b ? `<span class="n" title="${b[1]}">${b[0]}</span>${b[2] ? '<span class="live"></span>' : ''}` : '';
    const swatch = kind === 'hub' ? `<span style="width:8px;height:8px;border-radius:50%;background:${color}"></span>` : '';
    const hint = kind !== 'leaf' && n.hint ? `<span class="hint">${here ? 'You are here' : n.hint}</span>` : '';
    return `<a class="sibc-node ${kind}${here ? ' here' : ''}" href="${n.href}" style="left:${x}px;top:${y}px" title="${n.hint || n.label}">
      <span class="pill">${swatch}${n.label}${bHtml}</span>${hint}</a>`;
  }

  function open()  { veil.classList.add('open'); renderMap(); }
  function close() { veil.classList.remove('open'); }
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
