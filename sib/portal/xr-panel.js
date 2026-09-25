// xr-panel.js - the XR kit's step card as an in-world panel (2026.4.46).
//
// Android Chrome shows the HTML overlay inside the AR session (WebXR
// dom-overlay). Headset browsers (Meta Quest) don't: the DOM is simply not
// drawn once the session is immersive, so the operator saw the model and no
// step navigation. This panel is the same card drawn into a canvas texture on
// a plane that lazily follows the head - readable on any WebXR device - with
// hit-testable buttons for controller rays, hand pinches and screen taps.
//
// The DOM stays the source of truth: xr.html mirrors the visible card into
// `setContent()` and clicks the matching DOM button when a panel button is hit,
// so both surfaces run exactly the same logic. Own code on three.js; no UI kit.

export class XRPanel {
  /**
   * @param {typeof import('three')} THREE
   * @param {{ width?: number, px?: number, colors?: Record<string,string> }} opts
   */
  constructor(THREE, opts = {}) {
    this.THREE = THREE;
    this.W = opts.px ?? 1024;
    this.H = Math.round(this.W * 0.72);
    const width = opts.width ?? 0.62;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.W; this.canvas.height = this.H;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, depthTest: false, depthWrite: false });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, width * this.H / this.W), mat);
    this.mesh.name = 'xr-panel';
    this.mesh.renderOrder = 999;
    this.mesh.visible = false;
    this.colors = Object.assign({
      bg: 'rgba(18,22,30,0.92)', text: '#f4f6fa', muted: '#9aa4b2', border: 'rgba(255,255,255,0.18)',
      chip: 'rgba(255,255,255,0.10)', primary: '#3b82f6', pass: '#22c55e', fail: '#ef4444', hover: 'rgba(255,255,255,0.22)',
    }, opts.colors ?? {});
    this.buttons = [];          // [{ id, x, y, w, h }] in canvas px
    this.hovered = null;
    this.content = { title: '', pill: '', frame: '', heading: '', text: '', chips: [], hint: '', rows: [], toast: '' };
    this.dirty = true;
    this._tmpV = new THREE.Vector3(); this._tmpQ = new THREE.Quaternion(); this._fwd = new THREE.Vector3();
    this._target = new THREE.Vector3(); this._first = true;
  }

  setContent(c) { this.content = { ...this.content, ...c }; this.dirty = true; }
  setHovered(id) { if (this.hovered !== id) { this.hovered = id; this.dirty = true; } }

  /** Lazy head-follow: ~1.1 m ahead, a little below eye line, always facing the viewer. */
  follow(camera, dt = 1 / 60) {
    const { THREE } = this;
    const camPos = this._tmpV.setFromMatrixPosition(camera.matrixWorld);
    this._fwd.set(0, 0, -1).applyQuaternion(camera.getWorldQuaternion(this._tmpQ));
    this._fwd.y = Math.max(-0.35, Math.min(0.35, this._fwd.y)); this._fwd.normalize();   // don't dive into the floor when looking down
    this._target.copy(camPos).addScaledVector(this._fwd, 1.1); this._target.y -= 0.22;
    const k = this._first ? 1 : 1 - Math.pow(0.02, dt);   // ~smooth over half a second
    this.mesh.position.lerp(this._target, k);
    this.mesh.lookAt(camPos);
    this._first = false;
    if (this.dirty) this.draw();
  }

  /** Ray (three.js Raycaster) → button id under it, or null. */
  hitTest(raycaster) {
    if (!this.mesh.visible) return null;
    const hit = raycaster.intersectObject(this.mesh, false)[0];
    if (!hit?.uv) return null;
    const x = hit.uv.x * this.W, y = (1 - hit.uv.y) * this.H;
    const b = this.buttons.find(b => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
    return b ? b.id : '__panel__';
  }

  // ── Drawing ──────────────────────────────────────────────────────────────

  draw() {
    const { ctx, W, H, colors: C, content: c } = this;
    ctx.clearRect(0, 0, W, H);
    this.buttons = [];
    const R = 28, pad = 40;
    rr(ctx, 0, 0, W, H, R); ctx.fillStyle = C.bg; ctx.fill();
    ctx.strokeStyle = C.border; ctx.lineWidth = 2; rr(ctx, 1, 1, W - 2, H - 2, R); ctx.stroke();

    // Header: title · pills
    ctx.font = '600 34px Arial'; ctx.fillStyle = C.text; ctx.textBaseline = 'middle';
    ctx.fillText(ellipsis(ctx, c.title, W - pad * 2 - 420), pad, 52);
    let px = W - pad;
    for (const p of [c.frame, c.pill].filter(Boolean)) {
      ctx.font = '24px Arial'; const tw = ctx.measureText(p).width + 36;
      px -= tw; rr(ctx, px, 30, tw, 44, 22); ctx.strokeStyle = C.border; ctx.stroke();
      ctx.fillStyle = C.muted; ctx.fillText(p, px + 18, 52); px -= 14;
    }
    line(ctx, pad, 92, W - pad, 92, C.border);

    let y = 132;
    // Hint (contextual intelligence) - above the step, with its own button.
    if (c.hint) {
      const lines = wrap(ctx, c.hint, '26px Arial', W - pad * 2 - 40);
      const hh = lines.length * 34 + 84;
      rr(ctx, pad, y - 16, W - pad * 2, hh, 18); ctx.fillStyle = 'rgba(250,204,21,0.10)'; ctx.fill(); ctx.strokeStyle = 'rgba(250,204,21,0.45)'; ctx.stroke();
      ctx.fillStyle = C.text; ctx.font = '26px Arial';
      lines.forEach((l, i) => ctx.fillText(l, pad + 20, y + 14 + i * 34));
      this.button('hintOk', 'Got it', W - pad - 180, y + lines.length * 34 + 16, 160, 46, { ghost: true });
      y += hh + 8;
    }

    // Step heading + text
    ctx.font = '600 40px Arial'; ctx.fillStyle = C.text;
    ctx.fillText(ellipsis(ctx, c.heading, W - pad * 2), pad, y + 20); y += 62;
    const body = wrap(ctx, c.text, '30px Arial', W - pad * 2);
    ctx.fillStyle = C.text; ctx.font = '30px Arial';
    const maxLines = c.hint ? 3 : 5;
    body.slice(0, maxLines).forEach((l, i) => ctx.fillText(i === maxLines - 1 && body.length > maxLines ? l.replace(/\s\S*$/, '…') : l, pad, y + 18 + i * 40));
    y += Math.min(body.length, maxLines) * 40 + 20;

    // Chips
    if (c.chips.length) {
      let cx = pad; ctx.font = '24px Arial';
      for (const ch of c.chips) {
        const tw = ctx.measureText(ch).width + 32;
        if (cx + tw > W - pad) break;
        rr(ctx, cx, y, tw, 44, 22); ctx.fillStyle = C.chip; ctx.fill();
        ctx.fillStyle = C.text; ctx.fillText(ch, cx + 16, y + 22); cx += tw + 10;
      }
      y += 60;
    }

    // Button rows - bottom-anchored.
    const rows = c.rows.filter(r => r.buttons.length);
    let by = H - pad - 72;
    for (let r = rows.length - 1; r >= 0; r--) {
      const row = rows[r];
      const gap = 16, avail = W - pad * 2;
      const grow = row.buttons.filter(b => b.grow).length;
      ctx.font = '600 28px Arial';
      const fixed = row.buttons.filter(b => !b.grow).reduce((s, b) => s + ctx.measureText(b.label).width + 48, 0);
      const growW = grow ? Math.max(180, (avail - fixed - gap * (row.buttons.length - 1)) / grow) : 0;
      let bx = pad;
      if (row.label) { ctx.font = '26px Arial'; ctx.fillStyle = C.muted; ctx.fillText(row.label, bx, by + 36); bx += ctx.measureText(row.label).width + 24; ctx.font = '600 28px Arial'; }
      for (const b of row.buttons) {
        const w = b.grow ? growW : ctx.measureText(b.label).width + 48;
        this.button(b.id, b.label, bx, by, w, 72, b);
        bx += w + gap;
      }
      by -= 72 + 18;
    }

    // Toast line (transient)
    if (c.toast) {
      ctx.font = '24px Arial'; const tw = ctx.measureText(c.toast).width + 40;
      rr(ctx, (W - tw) / 2, by + 20, tw, 46, 23); ctx.fillStyle = 'rgba(255,255,255,0.14)'; ctx.fill();
      ctx.fillStyle = C.text; ctx.fillText(c.toast, (W - tw) / 2 + 20, by + 43);
    }

    this.texture.needsUpdate = true;
    this.dirty = false;
  }

  button(id, label, x, y, w, h, o = {}) {
    const { ctx, colors: C } = this;
    const hov = this.hovered === id && !o.disabled;
    rr(ctx, x, y, w, h, 16);
    ctx.fillStyle = o.disabled ? 'rgba(255,255,255,0.05)'
      : o.primary ? (hov ? '#60a5fa' : C.primary) : o.pass ? (hov ? '#4ade80' : C.pass) : o.fail ? (hov ? '#f87171' : C.fail)
      : hov ? C.hover : 'rgba(255,255,255,0.10)';
    ctx.fill();
    if (!o.primary && !o.pass && !o.fail) { ctx.strokeStyle = C.border; ctx.lineWidth = 2; ctx.stroke(); }
    ctx.fillStyle = o.disabled ? C.muted : '#ffffff';
    ctx.font = '600 28px Arial'; ctx.textAlign = 'center';
    ctx.fillText(label, x + w / 2, y + h / 2); ctx.textAlign = 'left';
    if (!o.disabled) this.buttons.push({ id, x, y, w, h });
  }
}

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function line(ctx, x1, y1, x2, y2, color) { ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }
function ellipsis(ctx, s, max) {
  s = String(s ?? ''); if (ctx.measureText(s).width <= max) return s;
  while (s.length > 1 && ctx.measureText(s + '…').width > max) s = s.slice(0, -1);
  return s + '…';
}
function wrap(ctx, text, font, max) {
  ctx.font = font; const out = [];
  for (const para of String(text ?? '').split(/\n/)) {
    let cur = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const t = cur ? cur + ' ' + word : word;
      if (ctx.measureText(t).width > max && cur) { out.push(cur); cur = word; } else cur = t;
    }
    if (cur) out.push(cur);
  }
  return out;
}
