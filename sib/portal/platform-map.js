// platform-map.js - the platform in one picture, as one SVG builder.
//
// Used full-size on /platform and compact in the home page hero, so the two
// never drift. Tokens only (colours via CSS variables; the page's tokens.css
// resolves them). No canvas, no scroll choreography: it renders the same on a
// GPU-less Windows laptop, in Reader mode and in print.
//
//   platformMapSvg({ compact, stats })  → SVG markup
//     compact: true for the hero - a 640-wide composition: the core, the four
//              products, the four device classes. No lanes, no governance.
//     stats:   { anchors, guidedRuns, validatedSteps, peopleNow } from /stats (optional)
//
// The drawing: SIB in the centre (the backbone, with the live numbers inside
// it), the four products around it, the content lanes feeding into the core
// from the left, governance on the right, the devices fanning out below. Every
// element carries a data-go so a click lands on the surface that owns it.

(function () {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const PRODUCTS = [
    { id: 'tags',   name: 'Spatial Inspection', sub: 'tags · training · verdicts',    color: 'var(--ax-p-tags)',   go: '/portal#anchors' },
    { id: 'guides', name: 'AR OMS',             sub: 'work instructions on the tool', color: 'var(--ax-p-guides)', go: '/portal#content/guides' },
    { id: 'gemba',  name: 'Walks',              sub: 'Gemba · placed, signed off',    color: 'var(--ax-p-gemba)',  go: '/portal#gemba/walks' },
    { id: 'iloto',  name: 'iLOTO',              sub: 'locks · tags · certification',  color: 'var(--ax-p-iloto)',  go: '/portal#iloto' },
  ];
  const SOURCES = [
    { name: '3D OMS publication', go: '/explain/lifecycle' },
    { name: 'Excel · JSON',       go: '/explain/lifecycle' },
    { name: 'Procedure Designer', go: '/roadmap' },
    { name: 'MES · live',         go: '/explain/lifecycle', horizon: true },
  ];
  const DEVICES = [ // grouped by eye class, the gallery's order (/devices/gallery)
    { name: 'iPad',        form: 'app',     cls: 'handheld',          go: '/devices/gallery#ipad' },
    { name: 'Quest 3',     form: 'full',    cls: 'binocular-headset', go: '/devices/gallery#quest-3' },
    { name: 'HoloLens 2',  form: 'full',    cls: 'binocular-headset', go: '/devices/gallery#hololens-2' },
    { name: 'Vision Pro',  form: 'full',    cls: 'binocular-headset', go: '/devices/gallery#vision-pro' },
    { name: 'RayNeo X3',   form: 'reduced', cls: 'binocular-glasses', go: '/devices/gallery#rayneo-x3-pro' },
    { name: 'Even G2',     form: 'text',    cls: 'binocular-glasses', go: '/devices/gallery#even-g2' },
    { name: 'RealWear',    form: 'text',    cls: 'monocular',         go: '/devices/gallery#realwear-hmt-1' },
    { name: 'Oakley',      form: 'spoken',  cls: 'no-display',        go: '/devices/gallery#oakley-vanguard' },
  ];
  const CLASS_LABEL = { handheld: 'Handheld', 'binocular-headset': 'Binocular · headset', 'binocular-glasses': 'Binocular · glasses', monocular: 'Monocular', 'no-display': 'No display' };
  const CLASSES = [ // the compact drawing shows the eye classes, not the devices
    { name: 'Handheld',    form: 'app',     go: '/devices/gallery#handheld' },
    { name: 'Headsets',    form: 'full',    go: '/devices/gallery#binocular-headset' },
    { name: 'Glasses',     form: 'reduced', go: '/devices/gallery#binocular-glasses' },
    { name: 'Monocular',   form: 'text',    go: '/devices/gallery#monocular' },
    { name: 'No display',  form: 'spoken',  go: '/devices/gallery#no-display' },
  ];
  const GOVERN = [
    { name: 'Feature Catalogue', go: '/catalog' },
    { name: 'Readiness Scorecard', go: '/scorecard' },
    { name: 'POC Portfolio', go: '/portfolio' },
    { name: 'Architecture', go: '/architecture' },
  ];
  const FORM_LABEL = { app: 'the reference', full: 'full model', reduced: 'reduced model', text: 'text pages', spoken: 'spoken' };

  function pill(cls, go, x, y, w, h, label) {
    return `<g data-go="${go}" class="${cls}"><rect x="${x}" y="${y - h / 2}" width="${w}" height="${h}" rx="${h / 2}"/><text x="${x + w / 2}" y="${y + 4}" text-anchor="middle">${esc(label)}</text></g>`;
  }
  function core(cx, cy, w, h, st, compact) {
    const nums = [[st.anchors, 'chambers'], [st.guidedRuns, 'guided runs'], [st.validatedSteps, 'steps validated'], [st.peopleNow, 'on tools now']].filter(x => x[0] !== undefined && x[0] !== null);
    let s = `<g data-go="/explain/spatial-intelligence" class="pm-core"><rect x="${cx - w / 2}" y="${cy - h / 2}" width="${w}" height="${h}" rx="18"/>
      <text class="pm-core-t" x="${cx}" y="${cy - h / 2 + 34}" text-anchor="middle">SIB</text>
      <text class="pm-core-s" x="${cx}" y="${cy - h / 2 + 54}" text-anchor="middle">Spatial Intelligence Backbone</text>`;
    if (!compact) s += `<text class="pm-core-s2" x="${cx}" y="${cy - h / 2 + 72}" text-anchor="middle">one origin per chamber · perception · evidence</text>`;
    if (nums.length) {
      const step = (w - 20) / nums.length, nx = cx - w / 2 + 10;
      nums.forEach(([v, l], i) => { const x = nx + step * i + step / 2; s += `<text class="pm-num${Number(v) === 0 ? ' pm-zero' : ''}" x="${x}" y="${cy + h / 2 - 26}" text-anchor="middle">${esc(v)}</text><text class="pm-num-l" x="${x}" y="${cy + h / 2 - 12}" text-anchor="middle">${esc(l)}</text>`; });
    }
    return s + '</g>';
  }
  function pad(p, x, y, w, h, cx, cy, coreW, coreH) {
    const left = x < cx, above = y < cy;
    let link;
    if (coreH) { // the pad sits above/below the core, so the link drops vertically onto its edge
      const ex = left ? x + w / 2 - 30 : x - w / 2 + 30, ey = above ? y + h / 2 : y - h / 2, kx = left ? cx - coreW / 2 + 40 : cx + coreW / 2 - 40, ky = above ? cy - coreH / 2 : cy + coreH / 2;
      link = `M ${ex} ${ey} C ${ex} ${(ey + ky) / 2}, ${kx} ${(ey + ky) / 2}, ${kx} ${ky}`;
    } else {
      const ex = left ? x + w / 2 : x - w / 2, kx = left ? cx - coreW / 2 : cx + coreW / 2, ky = above ? cy - 30 : cy + 30;
      link = `M ${ex} ${y} C ${(ex + kx) / 2} ${y}, ${(ex + kx) / 2} ${ky}, ${kx} ${ky}`;
    }
    return `<path class="pm-link" d="${link}" style="stroke:${p.color}"/>
      <g data-go="${p.go}" class="pm-pad"><rect x="${x - w / 2}" y="${y - h / 2}" width="${w}" height="${h}" rx="14" style="stroke:${p.color}"/>
        <circle cx="${x - w / 2 + 18}" cy="${y}" r="5" style="fill:${p.color}"/>
        <text class="pm-pad-t" x="${x - w / 2 + 32}" y="${y - 6}">${esc(p.name)}</text>
        <text class="pm-pad-s" x="${x - w / 2 + 32}" y="${y + 14}">${esc(p.sub)}</text></g>`;
  }

  function fullSvg(st) {
    const W = 960, H = 640, cx = 480, cy = 250, coreW = 320, coreH = 150;
    let s = `<svg class="pm" viewBox="0 0 ${W} ${H}" role="img" aria-label="The platform in one picture: SIB in the centre, four products around it, content lanes feeding in, devices fanning out, governance alongside">`;
    // sources (left lanes into the core)
    const sx = 40, sy0 = cy - 51;
    s += `<text class="pm-lane-h" x="${sx}" y="${sy0 - 30}">Content comes from</text>`;
    SOURCES.forEach((src, i) => {
      const y = sy0 + i * 34;
      s += `<path class="pm-flow${src.horizon ? ' pm-hz' : ''}" d="M ${sx + 140} ${y} C ${sx + 200} ${y}, ${cx - coreW / 2 - 60} ${cy + 20}, ${cx - coreW / 2} ${cy + 20}"/>`;
      s += pill('pm-src' + (src.horizon ? ' pm-hz' : ''), src.go, sx, y, 140, 24, src.name);
    });
    // governance (right column)
    const gx = W - 180;
    s += `<text class="pm-lane-h" x="${gx}" y="${sy0 - 30}">Governed by</text>`;
    GOVERN.forEach((g, i) => { s += pill('pm-gov', g.go, gx, sy0 + i * 34, 140, 24, g.name); });
    // the core, then the four pads
    s += core(cx, cy, coreW, coreH, st, false);
    const pw = 210, ph = 64, pads = [[cx - 250, cy - 160], [cx + 250, cy - 160], [cx - 250, cy + 160], [cx + 250, cy + 160]];
    PRODUCTS.forEach((p, i) => { s += pad(p, pads[i][0], pads[i][1], pw, ph, cx, cy, coreW, coreH); });
    // devices (fan below)
    const dy = H - 70, dw = (W - 80) / DEVICES.length;
    s += `<text class="pm-lane-h" x="40" y="${dy - 68}">Delivered on</text>`;
    // eye-class brackets over each run of devices
    let gi = 0;
    while (gi < DEVICES.length) {
      let gj = gi; while (gj + 1 < DEVICES.length && DEVICES[gj + 1].cls === DEVICES[gi].cls) gj++;
      const x0 = 40 + dw * gi + 8, x1 = 40 + dw * (gj + 1) - 8, xm = (x0 + x1) / 2;
      s += `<g data-go="/devices/gallery#${DEVICES[gi].cls}" class="pm-cls"><path class="pm-bracket" d="M ${x0} ${dy - 24} L ${x0} ${dy - 30} L ${x1} ${dy - 30} L ${x1} ${dy - 24}"/><text x="${xm}" y="${dy - 36}" text-anchor="middle">${esc(CLASS_LABEL[DEVICES[gi].cls])}</text></g>`;
      gi = gj + 1;
    }
    DEVICES.forEach((d, i) => {
      const x = 40 + dw * i + dw / 2;
      s += `<path class="pm-fan" d="M ${cx} ${cy + coreH / 2} C ${cx} ${cy + coreH / 2 + 90}, ${x} ${dy - 100}, ${x} ${dy - 32}"/>`;
      s += pill('pm-dev pm-' + d.form, d.go, x - dw / 2 + 6, dy, dw - 12, 28, d.name);
      s += `<text class="pm-dev-s" x="${x}" y="${dy + 34}" text-anchor="middle">${FORM_LABEL[d.form]}</text>`;
    });
    s += `<text class="pm-foot" x="${W / 2}" y="${H - 10}" text-anchor="middle">Every piece that matters is written in-house. The hardware is a choice; the chamber origins, pins, validations and learnings stay where they are when the device changes.</text>`;
    return s + '</svg>';
  }

  function compactSvg(st) {
    const W = 640, H = 400, cx = 320, cy = 190, coreW = 300, coreH = 120;
    let s = `<svg class="pm pm-compact" viewBox="0 0 ${W} ${H}" role="img" aria-label="The platform in one picture: SIB in the centre, four products around it, four device classes below">`;
    s += core(cx, cy, coreW, coreH, st, true);
    const pw = 200, ph = 56, pads = [[cx - 210, cy - 112], [cx + 210, cy - 112], [cx - 210, cy + 112], [cx + 210, cy + 112]];
    PRODUCTS.forEach((p, i) => { s += pad(p, pads[i][0], pads[i][1], pw, ph, cx, cy, coreW, coreH); });
    const dy = H - 28, dw = (W - 40) / CLASSES.length;
    CLASSES.forEach((d, i) => {
      const x = 20 + dw * i + dw / 2;
      s += `<path class="pm-fan" d="M ${cx} ${cy + coreH / 2} C ${cx} ${cy + coreH / 2 + 50}, ${x} ${dy - 50}, ${x} ${dy - 14}"/>`;
      s += pill('pm-dev pm-' + d.form, d.go, x - dw / 2 + 8, dy, dw - 16, 28, d.name);
    });
    return s + '</svg>';
  }

  function platformMapSvg(opts) {
    const o = opts || {}; const st = o.stats || {};
    return o.compact ? compactSvg(st) : fullSvg(st);
  }

  const CSS = `
    .pm { display:block; width:100%; height:auto; font-family:var(--ax-font); }
    .pm text { fill:var(--ax-ink); }
    .pm .pm-core rect { fill:var(--ax-paper); stroke:var(--ax-green); stroke-width:1.5; }
    .pm .pm-core-t { font-size:26px; font-weight:600; letter-spacing:.02em; }
    .pm .pm-core-s { font-size:12px; fill:var(--ax-ink-2); }
    .pm .pm-core-s2 { font-size:10px; fill:var(--ax-ink-3); }
    .pm .pm-pad rect { fill:var(--ax-paper); stroke-width:1.5; }
    .pm .pm-pad-t { font-size:14px; font-weight:600; }
    .pm .pm-pad-s { font-size:10.5px; fill:var(--ax-ink-3); }
    .pm .pm-link { fill:none; stroke-width:2; opacity:.7; }
    .pm .pm-lane-h { font-size:10px; letter-spacing:.08em; text-transform:uppercase; fill:var(--ax-ink-3); }
    .pm .pm-src rect, .pm .pm-gov rect, .pm .pm-dev rect { fill:var(--ax-paper); stroke:var(--ax-rule); }
    .pm .pm-src text, .pm .pm-gov text, .pm .pm-dev text { font-size:11px; fill:var(--ax-ink-2); }
    .pm .pm-hz rect { stroke-dasharray:4 3; } .pm .pm-hz text { fill:var(--ax-ink-3); }
    .pm .pm-flow { fill:none; stroke:var(--ax-p-guides); stroke-width:1.5; opacity:.5; }
    .pm .pm-flow.pm-hz { stroke-dasharray:3 5; opacity:.4; }
    .pm .pm-fan { fill:none; stroke:var(--ax-rule); stroke-width:1; }
    .pm .pm-dev.pm-app rect { stroke:var(--ax-blue); } .pm .pm-dev.pm-full rect { stroke:var(--ax-green); } .pm .pm-dev.pm-reduced rect { stroke:var(--ax-teal); } .pm .pm-dev.pm-text rect { stroke:var(--ax-orange); } .pm .pm-dev.pm-spoken rect { stroke:var(--ax-purple); }
    .pm .pm-dev-s { font-size:9.5px; fill:var(--ax-ink-3); }
    .pm .pm-bracket { fill:none; stroke:var(--ax-rule); stroke-width:1; }
    .pm .pm-cls text { font-size:9.5px; letter-spacing:.04em; text-transform:uppercase; fill:var(--ax-ink-3); }
    .pm .pm-cls:hover text { fill:var(--ax-ink); }
    .pm .pm-num { font:600 18px var(--ax-mono); fill:var(--ax-ink); }
    .pm .pm-num-l { font-size:9.5px; fill:var(--ax-ink-3); }
    .pm .pm-num.pm-zero { fill:var(--ax-ink-4); }  /* a zero is 'none yet', not a fault */
    .pm .pm-foot { font-size:11px; fill:var(--ax-ink-3); }
    .pm [data-go] { cursor:pointer; }
    .pm [data-go]:hover rect { fill:var(--ax-paper-3); }
    .pm-compact .pm-core-t { font-size:30px; } .pm-compact .pm-core-s { font-size:13px; }
    .pm-compact .pm-pad-t { font-size:15px; } .pm-compact .pm-pad-s { font-size:10px; }
    .pm-compact .pm-dev text { font-size:13px; }
    .pm-compact .pm-num { font-size:20px; } .pm-compact .pm-num-l { font-size:9px; }
  `;
  function mountPlatformMap(el, opts) {
    if (!document.getElementById('pm-css')) { const st = document.createElement('style'); st.id = 'pm-css'; st.textContent = CSS; document.head.appendChild(st); }
    el.innerHTML = platformMapSvg(opts);
    el.querySelectorAll('[data-go]').forEach(g => g.addEventListener('click', () => { location.href = g.getAttribute('data-go'); }));
  }
  window.platformMapSvg = platformMapSvg;
  window.mountPlatformMap = mountPlatformMap;
})();
