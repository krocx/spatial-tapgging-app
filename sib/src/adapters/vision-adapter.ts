// vision-adapter.ts — whiteboard/screenshot → mind-map graph extraction.
//
// Speaks the OpenAI-compatible chat-completions API so any LOCAL runtime
// works: Ollama (default, http://localhost:11434/v1), LM Studio, vLLM.
// The image is sent only to the configured endpoint — with the defaults,
// it never leaves the SIB host. No cloud fallback exists unless you
// deliberately point SIB_VISION_URL somewhere else.
//
// Config (env) — resolution order:
//   SIB_VISION_URL      explicit vision endpoint (Ollama, vLLM, LM Studio,
//                       a company gateway, Azure OpenAI …)
//   ASK_LLM_URL         fallback: the Ask SIB gateway, when it is multimodal
//   (neither)           NOT CONFIGURED — /mindmap/import-image/status says so
//                       and the client never starts a doomed upload
//   SIB_VISION_MODEL    default qwen2.5vl (Ollama) / ASK_LLM_MODEL on fallback
//   SIB_VISION_API_KEY  optional bearer (ASK_LLM_KEY on fallback)
//   SIB_VISION_TIMEOUT_MS  default 120000 (local VLMs are slow, esp. first call)
//
// Ollama is ONE option, not a requirement — anything that speaks the OpenAI
// chat-completions API with image_url content works. Whatever is configured,
// the photo goes only there.

import type { Mindmap, MindmapNode, MindmapEdge, MindmapLane } from '@spatial/shared';
import { sanitizeGraphArrays, sanitizeLanes } from '../models/mindmap.model.js';

const NODE_W = 160;
const NODE_H = 48;

export interface VisionExtractResult {
  name: string;
  nodes: MindmapNode[];
  edges: MindmapEdge[];
  lanes: MindmapLane[];
  warnings: string[];
  model: string;
}

export interface VisionConfig {
  configured: boolean;
  /** 'vision' = SIB_VISION_URL, 'ask' = ASK_LLM_URL fallback, 'none' */
  provider: 'vision' | 'ask' | 'none';
  url: string;
  model: string;
  apiKey?: string;
  timeoutMs: number;
}

/** Resolve the vision endpoint from env (see header). Exported for /status. */
export function visionConfig(env: NodeJS.ProcessEnv = process.env): VisionConfig {
  const timeoutMs = Number(env.SIB_VISION_TIMEOUT_MS ?? 120_000);
  const vurl = env.SIB_VISION_URL?.trim();
  if (vurl) {
    return { configured: true, provider: 'vision', url: vurl.replace(/\/+$/, ''),
      model: env.SIB_VISION_MODEL?.trim() || 'qwen2.5vl', apiKey: env.SIB_VISION_API_KEY?.trim() || undefined, timeoutMs };
  }
  const aurl = env.ASK_LLM_URL?.trim();
  if (aurl) {
    return { configured: true, provider: 'ask', url: aurl.replace(/\/+$/, ''),
      model: env.SIB_VISION_MODEL?.trim() || env.ASK_LLM_MODEL?.trim() || 'default',
      apiKey: env.SIB_VISION_API_KEY?.trim() || env.ASK_LLM_KEY?.trim() || undefined, timeoutMs };
  }
  return { configured: false, provider: 'none', url: '', model: '', timeoutMs };
}

/** Public, key-free summary for the client (never exposes the API key). */
export function visionStatus(env: NodeJS.ProcessEnv = process.env): { configured: boolean; provider: string; model: string; host: string } {
  const c = visionConfig(env);
  let host = '';
  try { host = c.url ? new URL(c.url).host : ''; } catch { host = ''; }
  return { configured: c.configured, provider: c.provider, model: c.model, host };
}

const SYSTEM_PROMPT = `You convert photos of whiteboards, sticky-note walls, and app screenshots into a mind-map graph. Respond with ONLY a JSON object, no prose, no markdown fences, following exactly this schema:
{
  "name": "short title for the map",
  "nodes": [{ "id": "n1", "text": "...", "x": 0-100, "y": 0-100, "type": "tag|perception|semantic|reasoning|generic", "status": "planned|in-progress|done|blocked" }],
  "edges": [{ "from": "n1", "to": "n2", "directed": true, "label": "optional" }],
  "lanes": [{ "name": "...", "orientation": "column|row", "start": 0-100, "end": 0-100 }]
}
Rules:
- One node per distinct box/sticky/bubble/phrase. Keep text short (max ~8 words), preserve the original wording.
- x/y are the item's center as PERCENT of image width/height — preserve the spatial arrangement faithfully.
- Edges only where a line/arrow visibly connects two items. "directed": true when there is an arrowhead.
- "type" only when obvious from color/context, else "generic". "status" only when marked (checkmark/done → done, cross → blocked), else omit.
- "lanes" only when the board clearly has column or row bands (e.g. Now/Next/Later); "start"/"end" are percent along the relevant axis.
- If the image contains no diagram at all, return {"name":"","nodes":[],"edges":[],"lanes":[]}.`;

/** Strip markdown fences / prose and parse the first JSON object found. */
export function parseVisionJson(text: string): Record<string, unknown> | null {
  const cleaned = text.replace(/```(?:json)?/gi, '').trim();
  const start = cleaned.indexOf('{');
  if (start === -1) return null;
  // Walk to the matching closing brace (models sometimes append trailing prose).
  let depth = 0;
  for (let i = start; i < cleaned.length; i++) {
    if (cleaned[i] === '{') depth++;
    else if (cleaned[i] === '}') {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(cleaned.slice(start, i + 1)) as Record<string, unknown>; }
        catch { return null; }
      }
    }
  }
  return null;
}

/**
 * Model JSON → sanitized graph. Percent coordinates are scaled onto a
 * 1600×1000 world canvas; nodes with unusable positions fall back to a grid.
 * Pure — unit-testable without any model.
 */
export function toGraph(raw: Record<string, unknown>): Omit<VisionExtractResult, 'model'> {
  const warnings: string[] = [];
  const now = Date.now();
  const W = 1600, H = 1000;

  const rawNodes = Array.isArray(raw.nodes) ? raw.nodes : [];
  const idMap = new Map<string, string>();
  let gridSlot = 0;

  const nodes: MindmapNode[] = rawNodes.flatMap((rn, i) => {
    const n = rn as Record<string, unknown>;
    const text = typeof n.text === 'string' ? n.text.trim() : '';
    if (!text) { warnings.push(`Skipped node ${i + 1}: empty text`); return []; }
    const id = `img-${i + 1}`;
    if (typeof n.id === 'string') idMap.set(n.id, id);

    const px = typeof n.x === 'number' && isFinite(n.x) ? Math.min(100, Math.max(0, n.x)) : null;
    const py = typeof n.y === 'number' && isFinite(n.y) ? Math.min(100, Math.max(0, n.y)) : null;
    let x: number, y: number;
    if (px !== null && py !== null) {
      x = (px / 100) * W - NODE_W / 2;
      y = (py / 100) * H - NODE_H / 2;
    } else {
      x = 60 + (gridSlot % 5) * (NODE_W + 60);
      y = 60 + Math.floor(gridSlot / 5) * (NODE_H + 40);
      gridSlot++;
    }

    return [{
      id, x: Math.round(x), y: Math.round(y), text,
      type: (['tag', 'perception', 'semantic', 'reasoning', 'generic'].includes(n.type as string)
        ? n.type : 'generic') as MindmapNode['type'],
      metadata: { source: 'image-import' },
      updatedAt: now,
      ...(['planned', 'in-progress', 'done', 'blocked'].includes(n.status as string)
        ? { status: n.status as MindmapNode['status'] } : {}),
    }];
  });
  if (gridSlot > 0) warnings.push(`${gridSlot} node(s) had no usable position — placed on a grid`);

  const rawEdges = Array.isArray(raw.edges) ? raw.edges : [];
  const edges: MindmapEdge[] = rawEdges.flatMap((re, i) => {
    const e = re as Record<string, unknown>;
    const from = idMap.get(e.from as string);
    const to = idMap.get(e.to as string);
    if (!from || !to || from === to) { warnings.push(`Skipped edge ${i + 1}: unresolved endpoints`); return []; }
    return [{
      id: `img-e-${i + 1}`, from, to,
      type: (e.directed === false ? 'undirected' : 'directed') as MindmapEdge['type'],
      updatedAt: now,
      ...(typeof e.label === 'string' && e.label.trim() ? { label: e.label.trim() } : {}),
    }];
  });

  const rawLanes = Array.isArray(raw.lanes) ? raw.lanes : [];
  const laneCandidates = rawLanes.flatMap((rl, i) => {
    const l = rl as Record<string, unknown>;
    const start = typeof l.start === 'number' ? Math.min(100, Math.max(0, l.start)) : null;
    const end = typeof l.end === 'number' ? Math.min(100, Math.max(0, l.end)) : null;
    if (start === null || end === null || end <= start || typeof l.name !== 'string') return [];
    const row = l.orientation === 'row';
    const axis = row ? H : W;
    return [{
      id: `img-lane-${i + 1}`,
      name: l.name.trim() || 'Lane',
      x: Math.round((start / 100) * axis),
      width: Math.round(((end - start) / 100) * axis),
      ...(row ? { orientation: 'row' as const } : {}),
    }];
  });
  const lanes = sanitizeLanes(laneCandidates) ?? [];

  // Final pass through the shared sanitizers (same rules as REST/WS).
  const clean = sanitizeGraphArrays(nodes, edges);
  if (clean.nodes.length === 0) warnings.push('No nodes could be extracted from this image');

  return {
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 120) : 'Imported from image',
    nodes: clean.nodes,
    edges: clean.edges,
    lanes,
    warnings,
  };
}

/** Call the local vision model. Throws with a helpful message when unreachable. */
export async function extractMindmapFromImage(imageBase64: string, mimeType: string): Promise<VisionExtractResult> {
  const cfg = visionConfig();
  if (!cfg.configured) {
    throw new Error('Whiteboard import is not set up on this server — set SIB_VISION_URL (or ASK_LLM_URL) to an OpenAI-compatible vision endpoint. See docs/INTERNAL-SERVER-DEPLOY.md.');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);

  let res: Response;
  try {
    res = await fetch(`${cfg.url}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Extract the mind-map from this image. JSON only.' },
              { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
            ],
          },
        ],
      }),
    });
  } catch (err) {
    throw new Error(
      `Vision model unreachable at ${cfg.url} (${cfg.provider === 'ask' ? 'ASK_LLM_URL fallback' : 'SIB_VISION_URL'}) — is the endpoint running? ` +
      `(Ollama: "ollama pull ${cfg.model}" then "ollama serve"; or point SIB_VISION_URL at any OpenAI-compatible vision endpoint.) ` +
      `Underlying error: ${(err as Error).message}`,
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Vision model error ${res.status} from ${cfg.url}: ${body.slice(0, 300)}`);
  }

  const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content ?? '';
  const parsed = parseVisionJson(content);
  if (!parsed) {
    throw new Error(`Vision model (${cfg.model}) did not return parseable JSON. Try a cleaner photo or a stronger model (SIB_VISION_MODEL).`);
  }
  return { ...toGraph(parsed), model: cfg.model };
}
