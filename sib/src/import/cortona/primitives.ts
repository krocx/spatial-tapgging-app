// primitives.ts - Cortona3D parametric geometry PROTOs (PGVMRepHandler.*).
//
// Published scenes use a small library of geometry PROTOs whose mesh is built
// at runtime by an embedded Script from a few parameters (the PROTO body is an
// empty IndexedFaceSet/Extrusion). We regenerate the same shapes here so the
// GLB is complete. Conventions follow the Script bodies seen in real files:
//   BOX      scale = full size (points ±size/2)
//   SPHERE   D = diameter (icosphere in the original; UV sphere here)
//   CYLNDR   D = diameter, H = height along +Y from the origin
//   TORUS    D = major diameter (XZ plane), d = tube diameter
//   WASHER   D = outer, d = inner diameter, H = thickness along +Y
//   BOXDUMMY invisible placeholder (the Script hides its parent at runtime)

export const PRIMITIVE_TYPES = new Set(['BOX', 'SPHERE', 'CYLNDR', 'TORUS', 'WASHER', 'BOXDUMMY']);

export interface PrimMesh { positions: number[]; indices: number[] }

export function buildPrimitive(type: string, f: (name: string, fallback: number[]) => number[]): PrimMesh | null {
  switch (type) {
    case 'BOX':      { const s = f('scale', [0.1, 0.1, 0.1]); return box(s[0], s[1], s[2]); }
    case 'SPHERE':   { const d = f('D', [0.1])[0]; return sphere(d / 2, 24, 16); }
    case 'CYLNDR':   { const d = f('D', [0.06])[0], h = f('H', [0.1])[0]; return cylinder(d / 2, h, Math.max(8, Math.min(64, f('quality', [32])[0] | 0))); }
    case 'TORUS':    { const D = f('D', [0.05])[0], d = f('d', [0.012])[0]; return torus(D / 2, d / 2, Math.max(8, Math.min(64, f('quality', [32])[0] | 0)), Math.max(6, Math.min(32, f('cross_quality', [16])[0] | 0))); }
    case 'WASHER':   { const D = f('D', [0.016])[0], d = f('d', [0.0084])[0], h = f('H', [0.0016])[0]; return washer(D / 2, d / 2, h, Math.max(8, Math.min(64, f('quality', [32])[0] | 0))); }
    case 'BOXDUMMY': return null;
    default:         return null;
  }
}

function box(sx: number, sy: number, sz: number): PrimMesh {
  const x = sx / 2, y = sy / 2, z = sz / 2;
  const p = [x, y, z, -x, y, z, -x, y, -z, x, y, -z, x, -y, z, -x, -y, z, -x, -y, -z, x, -y, -z];
  const faces = [[1, 0, 3, 2], [6, 7, 4, 5], [5, 4, 0, 1], [4, 7, 3, 0], [7, 6, 2, 3], [6, 5, 1, 2]];
  const idx: number[] = [];
  for (const q of faces) idx.push(q[0], q[1], q[2], q[0], q[2], q[3]);
  return { positions: p, indices: idx };
}

function sphere(r: number, seg: number, rings: number): PrimMesh {
  const p: number[] = []; const idx: number[] = [];
  for (let i = 0; i <= rings; i++) {
    const v = i / rings, phi = v * Math.PI;
    for (let j = 0; j <= seg; j++) {
      const u = j / seg, th = u * 2 * Math.PI;
      p.push(r * Math.sin(phi) * Math.cos(th), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(th));
    }
  }
  for (let i = 0; i < rings; i++) for (let j = 0; j < seg; j++) {
    const a = i * (seg + 1) + j, b = a + seg + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  return { positions: p, indices: idx };
}

function cylinder(r: number, h: number, n: number): PrimMesh {
  const p: number[] = []; const idx: number[] = [];
  for (let i = 0; i < n; i++) { const a = i * 2 * Math.PI / n; p.push(r * Math.sin(a), 0, r * Math.cos(a)); }
  for (let i = 0; i < n; i++) { const a = i * 2 * Math.PI / n; p.push(r * Math.sin(a), h, r * Math.cos(a)); }
  p.push(0, 0, 0, 0, h, 0);
  const cb = 2 * n, ct = 2 * n + 1;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    idx.push(i, i + n, j, j, i + n, j + n);      // side
    idx.push(cb, j, i);                          // bottom cap
    idx.push(ct, i + n, j + n);                  // top cap
  }
  return { positions: p, indices: idx };
}

function torus(R: number, r: number, n: number, m: number): PrimMesh {
  const p: number[] = []; const idx: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = i * 2 * Math.PI / n, cx = R * Math.cos(a), cz = -R * Math.sin(a);
    for (let j = 0; j < m; j++) {
      const b = j * 2 * Math.PI / m, rr = R + r * Math.cos(b);
      p.push(rr * Math.cos(a), r * Math.sin(b), -rr * Math.sin(a));
      void cx; void cz;
    }
  }
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) {
    const a = i * m + j, b = ((i + 1) % n) * m + j, a2 = i * m + (j + 1) % m, b2 = ((i + 1) % n) * m + (j + 1) % m;
    idx.push(a, b, a2, b, b2, a2);
  }
  return { positions: p, indices: idx };
}

function washer(R: number, r: number, h: number, n: number): PrimMesh {
  const p: number[] = []; const idx: number[] = [];
  // ring 0: outer bottom, 1: inner bottom, 2: outer top, 3: inner top
  for (const [rad, y] of [[R, 0], [r, 0], [R, h], [r, h]] as [number, number][]) {
    for (let i = 0; i < n; i++) { const a = i * 2 * Math.PI / n; p.push(rad * Math.cos(a), y, rad * Math.sin(a)); }
  }
  const O0 = 0, I0 = n, O1 = 2 * n, I1 = 3 * n;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    idx.push(O0 + i, I0 + i, O0 + j, O0 + j, I0 + i, I0 + j);   // bottom annulus
    idx.push(O1 + i, O1 + j, I1 + i, O1 + j, I1 + j, I1 + i);   // top annulus
    idx.push(O0 + i, O0 + j, O1 + i, O0 + j, O1 + j, O1 + i);   // outer wall
    idx.push(I0 + i, I1 + i, I0 + j, I0 + j, I1 + i, I1 + j);   // inner wall
  }
  return { positions: p, indices: idx };
}
