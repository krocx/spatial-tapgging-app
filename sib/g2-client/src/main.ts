// main.ts - SIB on G2: the runner.
//
// Three screens on the phone: Connect (server + code), Run (the glasses page
// mirrored, Next / Back / Repeat, Pass / Fail on a validation step), Sign off.
// The glasses show one page per step; the runner is the single source of
// truth and both surfaces follow it. Session recording matches the XR kit.
// Proprietary & Confidential · Applied Materials.

import { composeEnd, composeIdle, composePage, type PageStep } from './pages.js';
import { Glasses, MENU, type GlassesStatus, type MenuId, type Verb } from './glasses.js';
import { fetchBundle, loadServer, loadSession, redeem, saveServer, saveSession, recent, openLive, event, submit, type Bundle, type Session, type Live, type Completion } from './api.js';

const app = document.getElementById('app')!;
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
function toast(msg: string, ms = 2500) { let t = document.querySelector<HTMLElement>('.toast'); if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); } t.textContent = msg; t.style.display = ''; clearTimeout((t as unknown as { _h?: number })._h); (t as unknown as { _h?: number })._h = window.setTimeout(() => (t!.style.display = 'none'), ms); }

const glasses = new Glasses();
let status: GlassesStatus = { connected: false };
glasses.onStatus = s => { status = s; renderStatus(); };
glasses.onDebug = renderStatus;

// ── Run state ────────────────────────────────────────────────────────────────
let session: Session | null = loadSession();
let bundle: Bundle | null = null;
let steps: PageStep[] = [];
let idx = -1;
let live: Live | null = null;
let startedAt = '';
let enteredAt = 0;
const completions: Completion[] = [];
const verdicts: Record<string, 'pass' | 'fail'> = {};
let ended = false;
let operator = '';

const bounds = () => bundle?.guide.assembly?.bounds ?? null;
const checkRequired = (st: PageStep) => !!st.validation?.required;

function renderStatus() {
  const el = document.getElementById('g2-status'); if (!el) return;
  el.innerHTML = `<span class="dot ${status.connected ? 'on' : ''}"></span>${status.connected ? `Glasses connected${status.model ? ' · ' + esc(status.model) : ''}${status.battery !== undefined ? ` · ${status.battery} %` : ''}${status.wearing === false ? ' · not worn' : ''}${glasses.debug.page ? ' · ' + esc(glasses.debug.page) : ''}${glasses.debug.event ? `<br><span class="muted">last event: ${esc(glasses.debug.event)}</span>` : ''}` : 'Glasses not connected - open this page from the Even app; the phone can still drive the run'}`;
}

// ── Screen 1: connect ────────────────────────────────────────────────────────
// A QR from the portal lands here as /g2/?server=<origin>&code=ABC-123.
const scanned = (() => { const q = new URLSearchParams(location.search); const server = (q.get('server') || '').replace(/\/+$/, ''); const code = (q.get('code') || '').toUpperCase(); return server && code ? { server, code } : null; })();
if (scanned) saveServer(scanned.server);

function renderConnect(err = '') {
  const server = loadServer();
  const rec = recent();
  app.innerHTML = `
    <h1>SIB on G2 <small>work instructions on the glasses</small></h1>
    <div class="status" id="g2-status"></div>
    <div class="card">
      <div class="label">SIB server</div>
      <input id="server" inputmode="url" autocapitalize="none" autocorrect="off" placeholder="https://sib.example.com" value="${esc(server)}">
      <div class="muted" style="margin-top:6px">The address you use for the portal. Saved on this phone.</div>
    </div>
    <div class="card">
      <div class="label">Code from the portal</div>
      <input id="code" class="code" inputmode="latin" autocapitalize="characters" autocorrect="off" maxlength="7" placeholder="ABC-123" value="${esc(scanned?.code || '')}">
      <div class="muted" style="margin-top:6px">${scanned ? 'Scanned from the portal - tap Open the guide.' : 'Portal → guide → Open on a headset → Even Realities G2. One use, ten minutes.'}</div>
      <div class="err" id="err">${esc(err)}</div>
      <button class="primary" id="go" style="width:100%">Open the guide</button>
    </div>
    ${rec.length ? `<div class="card recent"><div class="label">Recent on this phone</div>${rec.map(r => `<button class="ghost" disabled>${esc(r.guideName)}<small>${new Date(r.at).toLocaleString()} - ask the portal for a new code</small></button>`).join('')}</div>` : ''}
    <div class="foot"><span>appliedx · SIB</span><a href="#" id="about">How this works</a></div>`;
  renderStatus();
  glasses.show(composeIdle(!!server));
  const codeEl = document.getElementById('code') as HTMLInputElement;
  codeEl.addEventListener('input', () => { const v = codeEl.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6); codeEl.value = v.length > 3 ? `${v.slice(0, 3)}-${v.slice(3)}` : v; });
  document.getElementById('go')!.onclick = async () => {
    const s = (document.getElementById('server') as HTMLInputElement).value.trim().replace(/\/+$/, '');
    const code = codeEl.value.trim();
    if (!/^https?:\/\//.test(s)) { renderConnect('Enter the server address with https://'); return; }
    if (code.replace(/-/g, '').length !== 6) { renderConnect('The code is six characters'); return; }
    saveServer(s);
    try { session = await redeem(s, code); await startRun(); } catch (e) { renderConnect((e as Error).message); }
  };
  document.getElementById('about')!.onclick = e => { e.preventDefault(); toast('Each step is one page on the glasses. Press: next. Double press: back. Long press: repeat. Swipe: scroll. Tap then hold for the menu (Pass / Fail / End).', 6000); };
}

// ── Screen 2: run ────────────────────────────────────────────────────────────
async function startRun() {
  if (!session) return;
  try { bundle = await fetchBundle(session); } catch (e) { saveSession(null); session = null; renderConnect('Could not load the guide: ' + (e as Error).message); return; }
  const vmap = new Map((bundle.validation || []).map(v => [v.stepId, v]));
  steps = [...bundle.steps].sort((a, b) => a.sequenceNumber - b.sequenceNumber).map(s => ({ ...(s as PageStep), validation: vmap.get(s.id) ? { required: vmap.get(s.id)!.required, mode: vmap.get(s.id)!.mode } : undefined }));
  if (!steps.length) { renderConnect('This guide has no steps.'); return; }
  operator = session.operator || localStorage.getItem('sib.g2.operator') || '';
  completions.length = 0; for (const k of Object.keys(verdicts)) delete verdicts[k]; ended = false;
  startedAt = new Date().toISOString();
  live = await openLive(session, bundle, operator || 'G2 technician');
  await event(session, live, 'session:started');
  showStep(0);
}

const labels = () => (bundle?.models || []).find(m => m.role === 'assembly')?.partLabels || {};
function pageFor(k: number) { return composePage(steps[k], k, steps.length, bounds(), labels()); }

async function showStep(k: number) {
  if (!session || !bundle) return;
  idx = k; ended = false; enteredAt = performance.now();
  const st = steps[k]; const page = pageFor(k);
  await glasses.show(page.text, checkRequired(st));
  renderRun(page.text, page.overflow);
  void event(session, live, 'step:entered', st.id, k);
}

function renderRun(text: string, overflow: boolean) {
  const st = steps[idx]; const need = checkRequired(st); const v = verdicts[st.id];
  app.innerHTML = `
    <h1>${esc(bundle?.guide.name || 'Guide')} <small>${idx + 1} of ${steps.length}</small></h1>
    <div class="status" id="g2-status"></div>
    <div class="mirror ${overflow ? 'overflow' : ''}">${esc(text)}</div>
    ${need ? `<div class="card"><div class="label">Check this step</div><div class="row"><button id="pass" class="${v === 'pass' ? 'primary' : ''}">Pass</button><button id="fail" class="${v === 'fail' ? 'primary' : ''}" style="${v === 'fail' ? 'background:var(--red);border-color:var(--red)' : ''}">Fail</button></div><div class="muted" style="margin-top:6px">${v ? `Recorded: ${v}` : 'On the glasses: tap then hold for the menu.'}</div></div>` : ''}
    <div class="row">
      <button id="back" ${idx === 0 ? 'disabled' : ''}>Back</button>
      <button id="repeat" class="ghost">Repeat</button>
      <button id="next" class="primary" ${need && !v ? 'disabled' : ''}>${idx === steps.length - 1 ? 'Done' : 'Next'}</button>
    </div>
    <div class="foot"><span>${esc(operator || 'operator not set')} · recorded as a run</span><a href="#" id="end">End guide</a></div>`;
  renderStatus();
  document.getElementById('back')!.onclick = () => verb('back');
  document.getElementById('repeat')!.onclick = () => verb('repeat');
  document.getElementById('next')!.onclick = () => verb('next');
  document.getElementById('pass')?.addEventListener('click', () => menu(MENU.PASS));
  document.getElementById('fail')?.addEventListener('click', () => menu(MENU.FAIL));
  document.getElementById('end')!.onclick = e => { e.preventDefault(); menu(MENU.END); };
}

function completeStep() {
  if (!session) return;
  const st = steps[idx]; const dur = Math.round((performance.now() - enteredAt) / 1000);
  completions.push({ stepId: st.id, enteredAt: new Date(Date.now() - dur * 1000).toISOString(), completedAt: new Date().toISOString(), durationSeconds: dur });
  void event(session, live, 'step:completed', st.id, idx, { durationSeconds: dur });
  if (idx < steps.length - 1) void showStep(idx + 1); else void showEnd();
}

function verb(v: Verb) {
  if (ended) { if (v === 'next') renderSignoff(); else if (v === 'back') void showStep(steps.length - 1); return; }
  if (idx < 0) return;
  const st = steps[idx];
  if (v === 'next') { if (checkRequired(st) && !verdicts[st.id]) { toast('Pass or Fail first - menu on the glasses, buttons here'); return; } completeStep(); }
  else if (v === 'back') { if (idx > 0) void showStep(idx - 1); }
  else if (v === 'repeat') { void showStep(idx); }
}
glasses.onVerb = verb;

function menu(id: MenuId) {
  if (!session) return;
  if (id === MENU.PASS || id === MENU.FAIL) {
    if (idx < 0 || ended) return;
    const st = steps[idx]; const result = id === MENU.PASS ? 'pass' : 'fail';
    verdicts[st.id] = result;
    void event(session, live, 'perception:result', st.id, idx, { payload: { mode: 'manual', result, client: 'even-g2' } });
    toast(result === 'pass' ? 'Recorded: pass' : 'Recorded: fail - you may continue');
    const page = pageFor(idx); renderRun(page.text, page.overflow);
  } else if (id === MENU.FIRST) { void showStep(0); }
  else if (id === MENU.END) { void showEnd(); }
}
glasses.onMenu = menu;

// ── Screen 3: end and sign-off ───────────────────────────────────────────────
async function showEnd() {
  ended = true;
  const failed = Object.values(verdicts).filter(v => v === 'fail').length;
  await glasses.show(composeEnd(completions.length, steps.length, failed), false);
  renderSignoff();
}
function renderSignoff(err = '') {
  const failed = Object.values(verdicts).filter(v => v === 'fail').length;
  app.innerHTML = `
    <h1>${esc(bundle?.guide.name || 'Guide')} <small>sign off</small></h1>
    <div class="status" id="g2-status"></div>
    <div class="card"><div class="step-big">${completions.length} of ${steps.length} steps completed${failed ? `, ${failed} failed a check` : ''}.</div></div>
    <div class="card">
      <div class="label">Your name</div>
      <input id="name" value="${esc(operator)}" placeholder="Name or employee ID">
      <div class="err">${esc(err)}</div>
      <div class="row"><button id="again" class="ghost">Back to the steps</button><button id="submit" class="primary">Sign and submit</button></div>
    </div>
    <div class="foot"><span>The run lands in the portal's Analytics like any other.</span></div>`;
  renderStatus();
  document.getElementById('again')!.onclick = () => void showStep(steps.length - 1);
  document.getElementById('submit')!.onclick = async () => {
    const name = (document.getElementById('name') as HTMLInputElement).value.trim();
    if (!name) { renderSignoff('Enter a name'); return; }
    localStorage.setItem('sib.g2.operator', name);
    try {
      await submit(session!, bundle!, live, name, startedAt, completions);
      toast('Session recorded - thank you', 3000);
      saveSession(null); session = null; bundle = null; idx = -1;
      await glasses.show('Recorded.\n\nThank you.');
      setTimeout(() => renderConnect(), 1500);
    } catch (e) { renderSignoff('Sign-off failed: ' + (e as Error).message); }
  };
}

// ── Boot ─────────────────────────────────────────────────────────────────────
(async () => {
  renderConnect();
  const ok = await glasses.connect();
  if (!ok) toast('No glasses bridge - running phone-only', 3000);
  if (session) { toast(`Reopening ${session.guideName}`); await startRun(); }
  else await glasses.show(composeIdle(!!loadServer()));
  window.addEventListener('keydown', e => { if (e.key === 'ArrowRight' || e.key === ' ') verb('next'); else if (e.key === 'ArrowLeft') verb('back'); else if (e.key.toLowerCase() === 'r') verb('repeat'); });
})();
