// mindmap-sib-adapter.ts — bridge between the Roadmap Mind-Mapper and the
// SIB ontology (anchors + tags).
//
// Import (read-only against SIB stores): anchors become `generic` nodes,
// their tags become `tag` nodes with an edge anchor → tag. Provenance is
// recorded in node.metadata.sib = { kind, id } so re-imports are idempotent
// and exports can round-trip.
//
// Export: produces a DRAFT JSON scaffold of SIB tag entities from tag-typed
// nodes. It deliberately does NOT write into the SIB stores — creating real
// anchors/tags requires QR generation and spatial placement, which stays in
// the authoring apps. The draft is for review / scripted ingestion.

import type { Mindmap, MindmapNode, MindmapEdge, Anchor, Tag } from '@spatial/shared';
import { anchorStore } from '../routes/anchors.js';
import { tagStore } from '../routes/tags.js';

interface SibProvenance { kind: 'anchor' | 'tag'; id: string; }

function sibRef(node: MindmapNode): SibProvenance | null {
  const sib = node.metadata?.sib as SibProvenance | undefined;
  return sib && typeof sib.id === 'string' && (sib.kind === 'anchor' || sib.kind === 'tag') ? sib : null;
}

export interface SibImportResult {
  nodes: MindmapNode[];
  edges: MindmapEdge[];
  addedNodes: number;
  addedEdges: number;
}

/**
 * Merge the SIB anchor/tag graph into a map's node/edge arrays (pure — caller
 * persists). Existing SIB-linked nodes are kept (and their positions
 * respected); only missing entities are added, laid out in columns to the
 * right of the current content.
 */
export function importSibGraph(map: Mindmap, anchorId?: string): SibImportResult {
  const anchors: Anchor[] = anchorId
    ? [anchorStore.findById(anchorId)].filter((a): a is Anchor => !!a)
    : anchorStore.findAll();
  const tags: Tag[] = tagStore.findAll().filter(t => anchors.some(a => a.id === t.anchorId));

  const nodes = [...map.nodes];
  const edges = [...map.edges];
  const now = Date.now();

  // Index existing SIB-linked nodes for idempotent re-import.
  const bySibId = new Map<string, MindmapNode>();
  for (const n of nodes) {
    const sib = sibRef(n);
    if (sib) bySibId.set(`${sib.kind}:${sib.id}`, n);
  }

  // Layout cursor: start right of everything already on the canvas.
  const NODE_W = 160, NODE_H = 48, GAP_X = 120, GAP_Y = 28;
  const startX = nodes.length ? Math.max(...nodes.map(n => n.x)) + NODE_W + GAP_X : 80;
  let anchorRowY = 80;

  let addedNodes = 0, addedEdges = 0;

  for (const anchor of anchors) {
    const anchorKey = `anchor:${anchor.id}`;
    let anchorNode = bySibId.get(anchorKey);
    if (!anchorNode) {
      anchorNode = {
        id: `sib-anchor-${anchor.id}`,
        x: startX,
        y: anchorRowY,
        text: anchor.assetId || 'Anchor',
        type: 'generic',
        metadata: { sib: { kind: 'anchor', id: anchor.id } },
        updatedAt: now,
      };
      nodes.push(anchorNode);
      bySibId.set(anchorKey, anchorNode);
      addedNodes++;
    }

    const anchorTags = tags.filter(t => t.anchorId === anchor.id);
    let tagY = anchorNode === undefined ? anchorRowY : anchorNode.y;
    for (const tag of anchorTags) {
      const tagKey = `tag:${tag.id}`;
      let tagNode = bySibId.get(tagKey);
      if (!tagNode) {
        tagNode = {
          id: `sib-tag-${tag.id}`,
          x: anchorNode.x + NODE_W + GAP_X,
          y: tagY,
          text: tag.label || 'Tag',
          type: 'tag',
          metadata: { sib: { kind: 'tag', id: tag.id }, sibTagType: tag.type },
          updatedAt: now,
        };
        nodes.push(tagNode);
        bySibId.set(tagKey, tagNode);
        addedNodes++;
        tagY += NODE_H + GAP_Y;
      }

      const edgeId = `sib-edge-${anchor.id}-${tag.id}`;
      if (!edges.some(e => e.id === edgeId || (e.from === anchorNode!.id && e.to === tagNode!.id))) {
        edges.push({ id: edgeId, from: anchorNode.id, to: tagNode.id, type: 'directed', updatedAt: now });
        addedEdges++;
      }
    }

    anchorRowY = Math.max(anchorRowY + NODE_H + GAP_Y * 2, tagY + GAP_Y);
  }

  return { nodes, edges, addedNodes, addedEdges };
}

export interface SibDraftExport {
  generatedAt: string;
  sourceMap: { id: string; name: string };
  note: string;
  /** Draft Tag entities from `tag`-typed nodes not already linked to SIB. */
  draftTags: Array<Partial<Tag> & { fromNodeId: string }>;
  /** Nodes already linked to live SIB entities (for traceability). */
  linked: Array<{ nodeId: string; kind: string; sibId: string }>;
}

/** Build the sib-json draft export payload (pure). */
export function buildSibDraft(map: Mindmap): SibDraftExport {
  const draftTags: SibDraftExport['draftTags'] = [];
  const linked: SibDraftExport['linked'] = [];

  for (const node of map.nodes) {
    const sib = sibRef(node);
    if (sib) {
      linked.push({ nodeId: node.id, kind: sib.kind, sibId: sib.id });
      continue;
    }
    if (node.type !== 'tag') continue;

    draftTags.push({
      fromNodeId: node.id,
      label: node.text,
      type: 'INSPECTION_POINT',
      expectedOutcome: '',
      metadata: {
        source: 'roadmap-mindmapper',
        mapId: map.id,
        ...(node.notes ? { notes: node.notes } : {}),
      },
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    sourceMap: { id: map.id, name: map.name },
    note: 'Draft scaffold — review and create via the SIB authoring flow (tags need an anchorId and spatial placement).',
    draftTags,
    linked,
  };
}
