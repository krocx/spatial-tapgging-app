// export.ts — client-side exports: SVG (vector), PNG (raster), JSON (schema).
// Pure DOM/canvas — no dependency on React or the store.

import type { Mindmap } from '@spatial/shared';
import { NODE_COLORS } from './colors.js';
import { NODE_W, NODE_H, nodeCenter, borderPoint } from './geometry.js';
import { edgePath, edgeMidpoint, edgeColorFor } from '../canvas/EdgeView.js';

export function buildSvg(map: Mindmap): string {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const pad = 60;
  const xs = map.nodes.map(n => n.x);
  const ys = map.nodes.map(n => n.y);
  const minX = (xs.length ? Math.min(...xs) : 0) - pad;
  const minY = (ys.length ? Math.min(...ys) : 0) - pad;
  const w = (xs.length ? Math.max(...xs) : 0) + NODE_W + pad - minX;
  const h = (ys.length ? Math.max(...ys) : 0) + NODE_H + pad - minY;

  const byId = new Map(map.nodes.map(n => [n.id, n]));
  const neutral = map.settings?.edgeColor === 'neutral';
  const curved = map.settings?.edgeStyle === 'curved';
  const edgeMarkup = map.edges.map(e => {
    const a = byId.get(e.from); const b = byId.get(e.to);
    if (!a || !b) return '';
    const p1 = borderPoint(a, nodeCenter(b));
    const p2 = borderPoint(b, nodeCenter(a));
    const color = edgeColorFor(a, neutral);
    const markerId = neutral ? 'rm-arrow' : `rm-arrow-${a.type}`;
    const marker = e.type === 'directed' ? ` marker-end="url(#${markerId})"` : '';
    const mid = edgeMidpoint(p1, p2, curved);
    const label = e.label
      ? `<text x="${mid.x}" y="${mid.y - 6}" text-anchor="middle" font-family="-apple-system, Helvetica, Arial, sans-serif" font-size="11" fill="#475569" stroke="#ffffff" stroke-width="3" paint-order="stroke">${esc(e.label)}</text>`
      : '';
    return `<path d="${edgePath(p1, p2, curved)}" fill="none" stroke="${color}" stroke-opacity="${neutral ? 1 : 0.75}" stroke-width="1.5"${marker}/>${label}`;
  }).join('\n');

  const nodeMarkup = map.nodes.map(n => {
    const color = NODE_COLORS[n.type] ?? NODE_COLORS.generic;
    const label = esc(n.text.length > 22 ? n.text.slice(0, 21) + '…' : n.text);
    return [
      `<g>`,
      `<rect x="${n.x}" y="${n.y}" width="${NODE_W}" height="${NODE_H}" rx="10" fill="#ffffff" stroke="${color}" stroke-width="2"/>`,
      `<rect x="${n.x}" y="${n.y}" width="6" height="${NODE_H}" rx="3" fill="${color}"/>`,
      `<text x="${n.x + NODE_W / 2}" y="${n.y + NODE_H / 2 + 5}" text-anchor="middle" font-family="-apple-system, Helvetica, Arial, sans-serif" font-size="13" fill="#1e293b">${label}</text>`,
      `</g>`,
    ].join('');
  }).join('\n');

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${w} ${h}" width="${w}" height="${h}">`,
    `<defs><marker id="rm-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#94a3b8"/></marker>${
      Object.entries(NODE_COLORS).map(([type, color]) =>
        `<marker id="rm-arrow-${type}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="${color}" fill-opacity="0.85"/></marker>`).join('')
    }</defs>`,
    `<rect x="${minX}" y="${minY}" width="${w}" height="${h}" fill="#f8fafc"/>`,
    `<title>${esc(map.name)}</title>`,
    edgeMarkup,
    nodeMarkup,
    `</svg>`,
  ].join('\n');
}

function download(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9-_]+/g, '-').replace(/^-+|-+$/g, '') || 'mindmap';
}

export function exportJson(map: Mindmap): void {
  download(`${safeName(map.name)}.json`, new Blob([JSON.stringify(map, null, 2)], { type: 'application/json' }));
}

export function exportSvg(map: Mindmap): void {
  download(`${safeName(map.name)}.svg`, new Blob([buildSvg(map)], { type: 'image/svg+xml' }));
}

export async function exportPng(map: Mindmap, scale = 2): Promise<void> {
  const svg = buildSvg(map);
  const svgUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('SVG rasterization failed'));
      img.src = svgUrl;
    });
    const canvas = document.createElement('canvas');
    canvas.width = img.width * scale;
    canvas.height = img.height * scale;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
    if (blob) download(`${safeName(map.name)}.png`, blob);
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}
