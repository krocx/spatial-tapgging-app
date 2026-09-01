// colors.ts — SIB layer palette. Single source of truth for node styling.
import type { MindmapNodeType, MindmapNodeStatus } from '@spatial/shared';

export const NODE_COLORS: Record<MindmapNodeType, string> = {
  tag: '#2f6fed',        // spatial layer — blue
  perception: '#8b5cf6', // perception layer — purple
  semantic: '#16a34a',   // semantic layer — green
  reasoning: '#f59e0b',  // reasoning layer — orange
  generic: '#64748b',    // generic — grey
};

/**
 * Card FILL palette — darkened variants of NODE_COLORS tuned so WHITE text
 * passes WCAG AA (≥4.5:1) on every fill. Nodes are solid-filled (2026.4.45);
 * NODE_COLORS above stays the bright palette for edges, arrows, legends and
 * pickers.
 *
 * DOCTRINE: every ornament drawn INSIDE a card must be designed against these
 * dark fills (white/near-white strokes, or a light chip behind it). Never add
 * a dark-on-dark badge; never assume a white card again.
 */
export const NODE_FILL_COLORS: Record<MindmapNodeType, string> = {
  tag: '#2557c9',        // darkened spatial blue
  perception: '#6d3fd6', // darkened perception purple
  semantic: '#15803d',   // darkened semantic green
  reasoning: '#b45309',  // darkened reasoning orange (white text passes here; #f59e0b does not)
  generic: '#475569',    // darkened grey
};

export const NODE_TYPE_LABELS: Record<MindmapNodeType, string> = {
  tag: 'Tag',
  perception: 'Perception',
  semantic: 'Semantic',
  reasoning: 'Reasoning',
  generic: 'Generic',
};

export const NODE_TYPES: MindmapNodeType[] = ['tag', 'perception', 'semantic', 'reasoning', 'generic'];

export const STATUS_COLORS: Record<MindmapNodeStatus, string> = {
  planned: '#94a3b8',
  'in-progress': '#2563eb',
  done: '#16a34a',
  blocked: '#dc2626',
};

export const STATUS_LABELS: Record<MindmapNodeStatus, string> = {
  planned: 'Planned',
  'in-progress': 'In progress',
  done: 'Done',
  blocked: 'Blocked',
};

export const NODE_STATUSES: MindmapNodeStatus[] = ['planned', 'in-progress', 'done', 'blocked'];

/** Stable peer-cursor color derived from the client id. */
export function peerColor(clientId: string): string {
  const palette = ['#e11d48', '#0891b2', '#7c3aed', '#ca8a04', '#059669', '#db2777', '#2563eb'];
  let h = 0;
  for (let i = 0; i < clientId.length; i++) h = (h * 31 + clientId.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}
