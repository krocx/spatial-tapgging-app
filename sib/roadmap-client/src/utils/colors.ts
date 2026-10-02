// colors.ts - SIB layer palette. Single source of truth for node styling.
import type { MindmapNodeType, MindmapNodeStatus } from '@spatial/shared';

export const NODE_COLORS: Record<MindmapNodeType, string> = {
  // Mirrors sib/portal/brand/tokens.css (literals: the PNG / SVG export draws them).
  tag: '#0A84FF',        // spatial layer   - --ax-blue
  perception: '#BF5AF2', // perception      - --ax-purple
  semantic: '#30D158',   // semantic        - --ax-green
  reasoning: '#FF9F0A',  // reasoning       - --ax-orange
  generic: '#8E8E93',    // generic         - --ax-grey
};

/**
 * Card FILL palette - darkened variants of NODE_COLORS tuned so WHITE text
 * passes WCAG AA (≥4.5:1) on every fill. Nodes are solid-filled (2026.4.45);
 * NODE_COLORS above stays the bright palette for edges, arrows, legends and
 * pickers.
 *
 * DOCTRINE: every ornament drawn INSIDE a card must be designed against these
 * dark fills (white/near-white strokes, or a light chip behind it). Never add
 * a dark-on-dark badge; never assume a white card again.
 */
export const NODE_FILL_COLORS: Record<MindmapNodeType, string> = {
  tag: '#0B5FC0',        // darkened --ax-blue
  perception: '#7A3BB0', // darkened --ax-purple
  semantic: '#1E8A3C',   // darkened --ax-green
  reasoning: '#A86300',  // darkened --ax-orange (white text passes here; #FF9F0A does not)
  generic: '#4A4A50',    // darkened --ax-grey
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
  planned: '#8E8E93',       // --ax-grey
  'in-progress': '#0A84FF', // --ax-blue
  done: '#30D158',          // --ax-green
  blocked: '#FF453A',       // --ax-red
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
