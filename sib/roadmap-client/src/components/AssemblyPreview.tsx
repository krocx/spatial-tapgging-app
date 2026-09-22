// AssemblyPreview.tsx — the assembly as the operator will see it at this step.
//
// Runs entirely in the browser: three.js (the copy vendored for the portal,
// resolved through the import map in index.html) loads the model's GLB, and
// every part is tinted by its state at the selected step:
//   this    parts this step installs — accent, the thing the author is editing
//   before  installed on earlier steps — the model's own look
//   after   not yet installed — hidden (or ghosted with the toggle)
//   base    never mentioned by any step — the model's own look
// Clicking a part toggles it on the current step, so cryptic CAD names never
// have to be read to pick a bracket.
//
// The GPU here is the author's laptop — nothing renders on the server.

import { useEffect, useRef, useState } from 'react';
import { fetchModelGlbUrl } from '../api/mindmap-api.js';

export type PartState = 'this' | 'before' | 'after' | 'base';

interface Props {
  modelId: string;
  /** Every part name the picker knows (from GET /models/:id/nodes). */
  partNames: Set<string>;
  /** Part → state at the selected step. Unlisted parts are `base`. */
  states: Map<string, PartState>;
  onPick?: (name: string) => void;
  height?: number;
}

// Bare specifiers resolved by the import map — hidden from Vite's resolver.
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
}

export function AssemblyPreview({ modelId, partNames, states, onPick, height = 220 }: Props): JSX.Element {
  const hostRef  = useRef<HTMLDivElement | null>(null);
  const s3       = useRef<Scene3 | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError]   = useState<string | null>(null);
  const [ghostAfter, setGhostAfter] = useState(false);
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
        renderer.setSize(host.clientWidth, height);
        host.appendChild(renderer.domElement);

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(40, host.clientWidth / height, 0.01, 1000);
        scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.1));
        const key = new THREE.DirectionalLight(0xffffff, 1.4); key.position.set(3, 5, 4); scene.add(key);
        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;

        const st: Scene3 = {
          THREE, renderer, scene, camera, controls, root: null,
          raycaster: new THREE.Raycaster(), pointer: new THREE.Vector2(), frame: 0, disposed: false, own: new Map(),
        };
        s3.current = st;

        blobUrl = await fetchModelGlbUrl(modelId);
        if (cancelled) return;
        const gltf: any = await new Promise((res, rej) => new GLTFLoader().load(blobUrl!, res, undefined, rej));
        if (cancelled) return;
        const root = gltf.scene;
        root.traverse((o: any) => {
          if (o.isMesh) {
            const mats = Array.isArray(o.material) ? o.material : [o.material];
            const cloned = mats.map((m: any) => m.clone());
            o.material = Array.isArray(o.material) ? cloned : cloned[0];
            st.own.set(o, cloned.map((m: any) => ({ color: m.color?.clone(), opacity: m.opacity, transparent: m.transparent, emissive: m.emissive?.clone() })));
          }
        });
        scene.add(root);
        st.root = root;

        // Frame the whole assembly.
        const box = new THREE.Box3().setFromObject(root);
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
      st.renderer.setSize(host.clientWidth, height);
      st.camera.aspect = host.clientWidth / height; st.camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', onResize);

    return () => {
      cancelled = true;
      window.removeEventListener('resize', onResize);
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
  }, [modelId, height]);

  // ── Tint by state whenever the selection changes ───────────────────────
  useEffect(() => {
    const st = s3.current;
    if (!st?.root || status !== 'ready') return;
    const { THREE } = st;
    const ACCENT = new THREE.Color(0x2f6fed);
    const GHOST  = 0.18;

    // Nearest ancestor that is a known part decides a mesh's state.
    const stateOf = (o: any): PartState => {
      let p = o;
      while (p) {
        if (p.name && partNames.has(p.name)) return states.get(p.name) ?? 'base';
        p = p.parent;
      }
      return 'base';
    };

    st.root.traverse((o: any) => {
      if (!o.isMesh) return;
      const base = st.own.get(o) ?? [];
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const state = stateOf(o);
      o.visible = !(state === 'after' && !ghostAfter);
      mats.forEach((m: any, i: number) => {
        const b = base[i];
        if (!m || !b) return;
        if (m.color && b.color) m.color.copy(b.color);
        if (m.emissive && b.emissive) m.emissive.copy(b.emissive);
        m.opacity = b.opacity; m.transparent = b.transparent;
        if (state === 'this') {
          if (m.emissive) { m.emissive.copy(ACCENT); m.emissiveIntensity = 0.55; }
          else if (m.color) m.color.lerp(ACCENT, 0.6);
        } else if (state === 'after') {
          m.transparent = true; m.opacity = GHOST;
        }
        m.needsUpdate = true;
      });
    });
  }, [states, partNames, ghostAfter, status]);

  // ── Click → part name (drag = orbit, so only short clicks pick) ────────
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let down: { x: number; y: number; t: number } | null = null;
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
      while (p && !(p.name && partNames.has(p.name))) p = p.parent;
      if (p?.name) onPickRef.current?.(p.name);
    };
    host.addEventListener('pointerdown', onDown);
    host.addEventListener('pointerup', onUp);
    return () => { host.removeEventListener('pointerdown', onDown); host.removeEventListener('pointerup', onUp); };
  }, [partNames]);

  return (
    <div className="asm-preview">
      <div ref={hostRef} className="asm-preview-canvas" style={{ height }} />
      {status === 'loading' && <div className="asm-preview-note">Loading model…</div>}
      {status === 'error'   && <div className="asm-preview-note asm-preview-err">{error}</div>}
      {status === 'ready' && (
        <div className="asm-preview-bar">
          <span className="asm-legend"><i className="asm-sw asm-sw-this" /> this step</span>
          <span className="asm-legend"><i className="asm-sw asm-sw-before" /> installed earlier</span>
          <label className="asm-legend asm-toggle">
            <input type="checkbox" checked={ghostAfter} onChange={e => setGhostAfter(e.target.checked)} /> show later parts as ghost
          </label>
          <span className="asm-hint">Click a part to add or remove it · drag to orbit</span>
        </div>
      )}
    </div>
  );
}
