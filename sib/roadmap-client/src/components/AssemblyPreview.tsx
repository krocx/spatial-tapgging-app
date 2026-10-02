// AssemblyPreview.tsx - the assembly as the operator will see it at this step.
//
// Runs entirely in the browser: three.js (the copy vendored for the portal,
// resolved through the import map in index.html) loads the model's GLB. For
// an imported guide the parts are shown, hidden, ghosted and POSED by the
// same rule the AR runtime uses (utils/assembly-state.ts: initial state plus
// every step's deltas in order), and a step can be played on its own
// timeline. On top of that, every part is tinted by its authoring state at
// the selected step:
//   this    parts this step installs - accent, the thing the author is editing
//   before  installed on earlier steps - the model's own look
//   after   not yet installed - hidden (or ghosted with the toggle)
//   base    never mentioned by any step - the model's own look
// Clicking a part toggles it on the current step, so cryptic CAD names never
// have to be read to pick a bracket.
//
// The GPU here is the author's laptop - nothing renders on the server.

import { useEffect, useRef, useState } from 'react';
import { fetchModelGlbUrl } from '../api/mindmap-api.js';
import { stateAt, timeline, type PartStateMap } from '../utils/assembly-state.js';
import type { GuideStepNode } from '@spatial/shared';

export type PartState = 'this' | 'before' | 'after' | 'base';

interface Props {
  modelId: string;
  /** Every part name the picker knows (from GET /models/:id/nodes). */
  partNames: Set<string>;
  /** Part → state at the selected step. Unlisted parts inherit their group's state, else `base`. */
  states: Map<string, PartState>;
  /** name → parent name (from the part tree) - unused here beyond typing parity; the
   *  scene graph itself carries the hierarchy. */
  parents?: Map<string, string>;
  /** State of parts no step and no initial entry mentions: 'after' (hidden - build-up) or 'base'. */
  unmentioned?: PartState;
  /** The step's operator context: how "later" parts render. Undefined = the local toggle decides. */
  context?: 'installed' | 'ghost' | 'solid';
  /** Runtime state after the selected step (imported guides): show + pose per part. Wins over `states` for visibility. */
  poses?: PartStateMap;
  /** This step on its own clock: the state it starts from and its deltas. Enables Play. */
  play?: { base: PartStateMap; deltas: GuideStepNode[] };
  onPick?: (name: string) => void;
  /** Identify: a single click names the part (the Studio's focus card); double click = onPick. */
  onFocus?: (name: string) => void;
  /** The focused part: lit orange, camera turned to it, and described through onFocusInfo. */
  focus?: string | null;
  /** Show only the focused part (and its children). */
  isolate?: boolean;
  onFocusInfo?: (info: { name: string; where: string; sizeMm: [number, number, number]; visible: boolean } | null) => void;
  height?: number;
  /** Fill the parent instead of a fixed height (expanded view). */
  fill?: boolean;
  onExpand?: () => void;
}

// Bare specifiers resolved by the import map - hidden from Vite's resolver.
const THREE_SPEC  = 'three';
const GLTF_SPEC   = 'three/addons/loaders/GLTFLoader.js';
const ORBIT_SPEC  = 'three/addons/controls/OrbitControls.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Three = any;

interface Scene3 {
  THREE: Three; renderer: any; scene: any; camera: any; controls: any; root: any | null;
  raycaster: any; pointer: any; frame: number; disposed: boolean;
  /** Mesh → its own material (cloned once) so tints never leak between parts. */
  own: Map<any, any>;
  /** Node → its rest transform (position, quaternion) so a pose can be replaced and restored. */
  rest: Map<any, { p: any; q: any }>;
  /** Playback clock, if a step is playing. */
  playing: { start: number; raf: number } | null;
}

/** GLTFLoader sanitises node names (drops `:` `.` `/`), keeping the original in userData.name. */
const partName = (o: any): string | undefined => (o?.userData?.name as string | undefined) ?? o?.name;

export function AssemblyPreview({ modelId, partNames, states, onPick, onFocus, focus = null, isolate = false, onFocusInfo, height = 220, fill = false, onExpand, unmentioned = 'base', context, poses, play }: Props): JSX.Element {
  const hostRef  = useRef<HTMLDivElement | null>(null);
  const s3       = useRef<Scene3 | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError]   = useState<string | null>(null);
  const [ghostAfter, setGhostAfter] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [clock, setClock] = useState<{ t: number; length: number } | null>(null);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;

  // ── Boot the scene + load the GLB (once per model) ─────────────────────
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    let blobUrl: string | null = null;

    (async () => {
      try {
        const THREE = await import(/* @vite-ignore */ THREE_SPEC);
        const { GLTFLoader } = await import(/* @vite-ignore */ GLTF_SPEC);
        const { OrbitControls } = await import(/* @vite-ignore */ ORBIT_SPEC);
        if (cancelled) return;

        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
        const H = () => (fill ? host.clientHeight : height);
        renderer.setSize(host.clientWidth, H());
        host.appendChild(renderer.domElement);

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(40, host.clientWidth / H(), 0.01, 1000);
        scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.1));
        const key = new THREE.DirectionalLight(0xffffff, 1.4); key.position.set(3, 5, 4); scene.add(key);
        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;

        const st: Scene3 = {
          THREE, renderer, scene, camera, controls, root: null,
          raycaster: new THREE.Raycaster(), pointer: new THREE.Vector2(), frame: 0, disposed: false, own: new Map(), rest: new Map(), playing: null,
        };
        s3.current = st;

        blobUrl = await fetchModelGlbUrl(modelId);
        if (cancelled) return;
        const gltf: any = await new Promise((res, rej) => new GLTFLoader().load(blobUrl!, res, undefined, rej));
        if (cancelled) return;
        const root = gltf.scene;
        root.traverse((o: any) => {
          if (partName(o)) st.rest.set(o, { p: o.position.clone(), q: o.quaternion.clone() });
          if (o.isMesh) {
            const mats = Array.isArray(o.material) ? o.material : [o.material];
            const cloned = mats.map((m: any) => m.clone());
            o.material = Array.isArray(o.material) ? cloned : cloned[0];
            st.own.set(o, cloned.map((m: any) => ({ color: m.color?.clone(), opacity: m.opacity, transparent: m.transparent, emissive: m.emissive?.clone() })));
          }
        });
        scene.add(root);
        st.root = root;

        // Frame the whole assembly (drawn geometry only: not the baked hose frames).
        root.traverse((o: any) => { const n = partName(o); if (n && /#s\d+f\d+$/.test(n)) o.visible = false; });
        const box = new THREE.Box3();
        root.updateWorldMatrix(true, true);
        root.traverse((o: any) => {
          if (!o.isMesh || !o.geometry) return;
          for (let p = o; p; p = p.parent) if (p.visible === false) return;
          if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
          box.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld));
        });
        if (box.isEmpty()) box.setFromObject(root);
        const size = box.getSize(new THREE.Vector3()).length() || 1;
        const centre = box.getCenter(new THREE.Vector3());
        controls.target.copy(centre);
        camera.position.copy(centre).add(new THREE.Vector3(size * 0.6, size * 0.45, size * 0.9));
        camera.near = size / 200; camera.far = size * 20; camera.updateProjectionMatrix();

        const loop = () => {
          if (st.disposed) return;
          controls.update();
          renderer.render(scene, camera);
          st.frame = requestAnimationFrame(loop);
        };
        loop();
        setStatus('ready');
      } catch (err) {
        if (!cancelled) { setError((err as Error).message || 'Preview unavailable'); setStatus('error'); }
      }
    })();

    const onResize = () => {
      const st = s3.current; if (!st || !host) return;
      const h = fill ? host.clientHeight : height;
      st.renderer.setSize(host.clientWidth, h);
      st.camera.aspect = host.clientWidth / h; st.camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', onResize);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(onResize) : null;
    ro?.observe(host);

    return () => {
      cancelled = true;
      window.removeEventListener('resize', onResize);
      ro?.disconnect();
      const st = s3.current;
      if (st) {
        st.disposed = true;
        cancelAnimationFrame(st.frame);
        st.controls?.dispose?.();
        st.renderer?.dispose?.();
        st.renderer?.domElement?.remove?.();
      }
      s3.current = null;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [modelId, height, fill]);

  // ── Render a state: visibility, pose, tint ─────────────────────────────
  // `poseMap` (runtime state) decides show/hide/ghost and transforms when the
  // guide has deltas; otherwise the authoring states decide visibility as
  // before. Tints always come from the authoring states.
  const laterMode: 'hidden' | 'ghost' | 'solid' = context === 'ghost' ? 'ghost' : context === 'solid' ? 'solid' : context === 'installed' ? 'hidden' : (ghostAfter ? 'ghost' : 'hidden');
  const renderState = (poseMap: PartStateMap | undefined) => {
    const st = s3.current;
    if (!st?.root || status !== 'ready') return;
    const { THREE } = st;
    const ACCENT = new THREE.Color(0x2f6fed);
    const GHOST  = 0.18;
    const stateOf = (o: any): PartState => {
      let p = o;
      while (p) { const n = partName(p); if (n && partNames.has(n)) { const s = states.get(n); if (s) return s; } p = p.parent; }
      return unmentioned;
    };
    const playbackOnly = (o: any): boolean => { for (let p = o; p; p = p.parent) { const n = partName(p); if (n && /#s\d+f\d+$/.test(n)) return true; } return false; };
    const startsHidden = (o: any): boolean => { for (let p = o; p; p = p.parent) if (p.userData?.visible === false) return true; return false; };
    // Nearest ancestor-or-self with a runtime pose: a part's visibility is its
    // own (the app's rule; the importer carries a hose owner's show/hide onto
    // its tubes, so nothing needs the parent to hide the child).
    const poseOf = (o: any) => {
      if (!poseMap) return undefined;
      for (let p = o; p; p = p.parent) { const n = partName(p); if (!n) continue; const ps = poseMap.get(n); if (ps) return ps; }
      return undefined;
    };

    // Transforms: every named node takes its runtime pose or its rest.
    if (poseMap) {
      for (const [o, r] of st.rest) {
        const n = partName(o); const ps = n ? poseMap.get(n) : undefined;
        if (ps?.position) o.position.set(ps.position[0], ps.position[1], ps.position[2]); else o.position.copy(r.p);
        if (ps?.rotation) { const [x, y, z, a] = ps.rotation; const l = Math.hypot(x, y, z); o.quaternion.setFromAxisAngle(new THREE.Vector3(l ? x / l : 0, l ? y / l : 0, l ? z / l : 1), a); }
        else o.quaternion.copy(r.q);
      }
    }

    const thisBox = new THREE.Box3();
    let anyThis = false;
    const FOCUS = new THREE.Color(0xff9f0a);
    const inFocus = (o: any): boolean => { if (!focus) return false; for (let p = o; p; p = p.parent) if (partName(p) === focus) return true; return false; };
    const focusBox = new THREE.Box3(); let focusVisible = false, focusAny = false;
    st.root.traverse((o: any) => {
      if (!o.isMesh) return;
      const base = st.own.get(o) ?? [];
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const state = stateOf(o);
      const ps = poseOf(o);
      let show: 'solid' | 'ghost' | 'hidden';
      let ghostOpacity = GHOST;
      if (ps) {
        show = ps.show as typeof show;
        if (show === 'ghost') ghostOpacity = ps.opacity;
        // A hidden part in "whole assembly" context is drawn as the context asks.
        if (show === 'hidden' && laterMode !== 'hidden' && !playbackOnly(o)) show = laterMode === 'ghost' ? 'ghost' : 'solid';
      } else if (poseMap) {
        // No runtime state at all: the model's own look, unless it starts hidden or is a frame.
        show = playbackOnly(o) || (startsHidden(o)) ? (laterMode === 'hidden' || playbackOnly(o) ? 'hidden' : laterMode === 'ghost' ? 'ghost' : 'solid') : 'solid';
      } else {
        show = state === 'after' ? (laterMode === 'hidden' ? 'hidden' : laterMode === 'ghost' ? 'ghost' : 'solid') : 'solid';
        if (playbackOnly(o) || (startsHidden(o) && !states.has(partName(o) ?? ''))) show = 'hidden';
      }
      const focused = inFocus(o);
      if (isolate && focus && !focused) show = 'hidden';
      if (focused) { focusAny = true; focusBox.expandByObject(o); if (show !== 'hidden') focusVisible = true; if (isolate && show === 'hidden') show = 'ghost'; }
      o.visible = show !== 'hidden';
      if (o.visible && state === 'this') { thisBox.expandByObject(o); anyThis = true; }
      mats.forEach((m: any, i: number) => {
        const b = base[i];
        if (!m || !b) return;
        if (m.color && b.color) m.color.copy(b.color);
        if (m.emissive && b.emissive) m.emissive.copy(b.emissive);
        m.opacity = b.opacity; m.transparent = b.transparent;
        if (ps?.color && m.color) m.color.setRGB(ps.color[0], ps.color[1], ps.color[2]);
        if (state === 'this') {
          if (m.emissive) { m.emissive.copy(ACCENT); m.emissiveIntensity = 0.55; }
          else if (m.color) m.color.lerp(ACCENT, 0.6);
        }
        if (show === 'ghost') { m.transparent = true; m.opacity = ghostOpacity; }
        if (focused) { if (m.emissive) { m.emissive.copy(FOCUS); m.emissiveIntensity = 0.9; } else if (m.color) m.color.lerp(FOCUS, 0.7); }
        m.needsUpdate = true;
      });
    });
    // Describe the focused part: where it sits against the whole, and its size.
    if (onFocusInfo) {
      if (focus && focusAny && !focusBox.isEmpty()) {
        const all = new THREE.Box3().setFromObject(st.root);
        const c = focusBox.getCenter(new THREE.Vector3()); const sz = focusBox.getSize(new THREE.Vector3());
        const rel = (v: number, lo: number, hi: number) => (v - lo) / Math.max(1e-9, hi - lo);
        const x = rel(c.x, all.min.x, all.max.x), y = rel(c.y, all.min.y, all.max.y), z = rel(c.z, all.min.z, all.max.z);
        const w: string[] = [x < 0.33 ? 'left side' : x > 0.67 ? 'right side' : 'centre'];
        if (z < 0.33) w.push('towards the back'); else if (z > 0.67) w.push('towards the front');
        w.push(y > 0.67 ? 'upper part' : y < 0.33 ? 'lower part' : 'mid height');
        onFocusInfo({ name: focus, where: w.join(', '), sizeMm: [Math.round(sz.x * 1000), Math.round(sz.y * 1000), Math.round(sz.z * 1000)], visible: focusVisible });
      } else onFocusInfo(focus ? { name: focus, where: '', sizeMm: [0, 0, 0], visible: false } : null);
    }
    return { thisBox, anyThis, focusBox: focusAny ? focusBox : null };
  };

  // Settled state whenever the selection changes (and when playback ends).
  useEffect(() => {
    const st = s3.current;
    if (!st?.root || status !== 'ready') return;
    if (st.playing) { cancelAnimationFrame(st.playing.raf); st.playing = null; setPlaying(false); setClock(null); }
    const r = renderState(poses);
    // The camera turns to the focused part when there is one, else to this step's parts.
    const box = r?.focusBox && !r.focusBox.isEmpty() ? r.focusBox : (r?.anyThis && !r.thisBox.isEmpty() ? r.thisBox : null);
    if (box) {
      const { THREE } = st;
      const c = box.getCenter(new THREE.Vector3());
      const offset = st.camera.position.clone().sub(st.controls.target);
      st.controls.target.copy(c);
      st.camera.position.copy(c).add(offset);
      st.controls.update();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [states, partNames, ghostAfter, status, unmentioned, context, poses, focus, isolate]);

  // ── Play this step on its own clock ────────────────────────────────────
  const stop = () => {
    const st = s3.current;
    if (st?.playing) { cancelAnimationFrame(st.playing.raf); st.playing = null; }
    setPlaying(false); setClock(null);
    renderState(poses);
  };
  const start = () => {
    const st = s3.current;
    if (!st?.root || !play) return;
    if (st.playing) cancelAnimationFrame(st.playing.raf);
    const tl = timeline(play.deltas);
    const length = Math.max(tl.length, 0.3);
    const t0 = performance.now();
    setPlaying(true);
    const tick = () => {
      const now = performance.now();
      const t = ((now - t0) / 1000) * speed;
      renderState(stateAt(play.base, tl, Math.min(t, length)));
      setClock({ t: Math.min(t, length), length });
      if (t >= length + 0.6 / speed) { st.playing = null; setPlaying(false); setClock(null); renderState(poses); return; }
      st.playing = { start: t0, raf: requestAnimationFrame(tick) };
    };
    st.playing = { start: t0, raf: requestAnimationFrame(tick) };
  };
  useEffect(() => () => { const st = s3.current; if (st?.playing) cancelAnimationFrame(st.playing.raf); }, []);

  // ── Click → identify the part; double click → add / remove (drag = orbit) ──
  const onFocusRef = useRef(onFocus); onFocusRef.current = onFocus;
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let down: { x: number; y: number; t: number } | null = null;
    let lastUp: { name: string; t: number } | null = null;
    const onDown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY, t: Date.now() }; };
    const onUp = (e: PointerEvent) => {
      const st = s3.current;
      if (!st?.root || !down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      const quick = Date.now() - down.t < 400;
      down = null;
      if (moved > 5 || !quick) return;
      const r = st.renderer.domElement.getBoundingClientRect();
      st.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      st.raycaster.setFromCamera(st.pointer, st.camera);
      const hits = st.raycaster.intersectObject(st.root, true).filter((h: any) => h.object.visible);
      const hit = hits[0]?.object;
      if (!hit) return;
      let p = hit;
      while (p && !(partName(p) && partNames.has(partName(p)!))) p = p.parent;
      const n = p ? partName(p) : undefined;
      if (!n) return;
      const now = Date.now();
      if (lastUp && lastUp.name === n && now - lastUp.t < 350) { lastUp = null; onPickRef.current?.(n); return; }
      lastUp = { name: n, t: now };
      if (onFocusRef.current) onFocusRef.current(n); else onPickRef.current?.(n);
    };
    host.addEventListener('pointerdown', onDown);
    host.addEventListener('pointerup', onUp);
    return () => { host.removeEventListener('pointerdown', onDown); host.removeEventListener('pointerup', onUp); };
  }, [partNames]);

  return (
    <div className={`asm-preview${fill ? ' asm-preview-fill' : ''}`}>
      <div ref={hostRef} className="asm-preview-canvas" style={fill ? undefined : { height }} />
      {onExpand && status === 'ready' && (
        <button className="asm-expand" onClick={onExpand} title="Open large">⤢</button>
      )}
      {status === 'loading' && <div className="asm-preview-note">Loading model…</div>}
      {status === 'error'   && <div className="asm-preview-note asm-preview-err">{error}</div>}
      {status === 'ready' && (
        <div className="asm-preview-bar">
          <span className="asm-legend"><i className="asm-sw asm-sw-this" /> this step</span>
          <span className="asm-legend"><i className="asm-sw asm-sw-before" /> installed earlier</span>
          {context
            ? <span className="asm-legend asm-ctx">Step context: {context === 'installed' ? 'installed only' : context === 'ghost' ? 'whole assembly, ghost' : 'whole assembly, solid'}</span>
            : <button className={`asm-toggle-btn${ghostAfter ? ' on' : ''}`} onClick={() => setGhostAfter(v => !v)}>
                {ghostAfter ? 'Later parts: ghost' : 'Later parts: hidden'}
              </button>}
          {play && play.deltas.length > 0 && (
            <span className="asm-play">
              <button className={`asm-toggle-btn${playing ? ' on' : ''}`} onClick={playing ? stop : start} title="Play this step as the operator sees it">{playing ? '■ Stop' : '▶ Play step'}</button>
              <select className="asm-speed" value={speed} onChange={e => setSpeed(Number(e.target.value))} title="Playback speed">
                <option value={0.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option>
              </select>
              {clock && <span className="asm-clock">{clock.t.toFixed(1)} / {clock.length.toFixed(1)} s</span>}
            </span>
          )}
          <span className="asm-hint">{onFocus ? 'Click a part to identify it · double-click to add or remove it · drag to orbit' : 'Click a part to add or remove it · drag to orbit'}</span>
        </div>
      )}
    </div>
  );
}
