/**
 * Ask SIB routes — docs-grounded assistant over the Feature Catalogue.
 *
 * GET  /ask/config → { generation, model } — which tier this deployment runs.
 * POST /ask        → { question } →
 *   retrieval tier (always): ranked sources + glossary from ask-core.
 *   generation tier (ASK_LLM_URL set): answer from an OpenAI-compatible
 *   /v1/chat/completions endpoint over the SAME retrieved context. The
 *   protocol is the contract: llama.cpp's llama-server and Ollama both speak
 *   it, so which runtime serves the model is an env-var decision.
 *
 *     ASK_LLM_URL    e.g. http://localhost:8080/v1  (llama.cpp)
 *                         http://localhost:11434/v1 (Ollama)
 *     ASK_LLM_MODEL  model name the runtime expects
 *     ASK_LLM_KEY    optional bearer token
 *
 * Public (no API key): grounding is docs/catalog + glossary ONLY — no site
 * data flows through here. A small in-memory rate limit keeps it polite.
 * If the LLM call fails, the response degrades to the retrieval tier with
 * a note — the assistant never hard-fails because a model is down.
 */
import { Router } from 'express';
import { retrieve, buildAskContext, buildMessages } from '../ask/ask-core.js';
import { readCatalog } from './catalog.js';

const LLM_TIMEOUT_MS = 90_000;

// Naive per-IP rate limit: 12 questions/minute. Enough for humans, a wall
// for loops. In-memory on purpose — this is politeness, not security.
const askLog = new Map<string, number[]>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const times = (askLog.get(ip) ?? []).filter(t => now - t < 60_000);
  times.push(now);
  askLog.set(ip, times);
  return times.length > 12;
}

function llmConfig() {
  const url = process.env.ASK_LLM_URL?.trim();
  if (!url) return null;
  return {
    url: url.replace(/\/$/, ''),
    model: process.env.ASK_LLM_MODEL?.trim() || 'default',
    key: process.env.ASK_LLM_KEY?.trim(),
  };
}

const router = Router();

router.get('/config', (_req, res) => {
  const cfg = llmConfig();
  res.json({ generation: !!cfg, model: cfg?.model ?? null });
});

router.post('/', async (req, res) => {
  const question = String(req.body?.question ?? '').trim();
  if (!question) return res.status(400).json({ error: 'question is required' });
  if (question.length > 500) return res.status(400).json({ error: 'question too long (max 500 chars)' });
  if (rateLimited(req.ip ?? 'unknown')) {
    return res.status(429).json({ error: 'Too many questions — wait a minute.' });
  }

  const cat = readCatalog();
  if (!cat) return res.status(404).json({ error: 'Catalogue not available on this deployment' });

  const retrieval = retrieve(cat.data, question);
  const base = {
    question,
    sources: retrieval.sources,
    glossary: retrieval.glossary,
  };

  const cfg = llmConfig();
  if (!cfg || retrieval.sources.length === 0) {
    // Retrieval-only deployments — and questions that matched nothing get an
    // honest empty result rather than an LLM guessing with no context.
    return res.json({ ...base, tier: 'retrieval' });
  }

  try {
    const context = buildAskContext(cat.data, retrieval);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), LLM_TIMEOUT_MS);
    const resp = await fetch(`${cfg.url}/chat/completions`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(cfg.key ? { Authorization: `Bearer ${cfg.key}` } : {}),
      },
      body: JSON.stringify({
        model: cfg.model,
        messages: buildMessages(context, question),
        temperature: 0.2,
        stream: false,
      }),
    });
    clearTimeout(timer);
    if (!resp.ok) throw new Error(`LLM HTTP ${resp.status}`);
    const data = await resp.json() as { choices?: { message?: { content?: string } }[] };
    const answer = data.choices?.[0]?.message?.content?.trim();
    if (!answer) throw new Error('LLM returned no content');
    return res.json({ ...base, tier: 'generation', model: cfg.model, answer });
  } catch (err) {
    // Model down or misconfigured → the docs still answer.
    return res.json({
      ...base,
      tier: 'retrieval',
      note: `Assistant model unavailable (${err instanceof Error ? err.message : 'error'}) — showing best matches from the docs instead.`,
    });
  }
});

export default router;
