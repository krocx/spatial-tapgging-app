// ask/llm.ts — the one OpenAI-compatible chat call SIB makes (Ask SIB and,
// since C2, contextual hints). Runtime is an env-var decision: llama.cpp's
// llama-server, Ollama or any /v1/chat/completions endpoint.
//
//   ASK_LLM_URL    e.g. http://localhost:8080/v1
//   ASK_LLM_MODEL  model name the runtime expects
//   ASK_LLM_KEY    optional bearer token
//
// Callers always have a non-LLM fallback: this helper throws, it never hangs.

export interface LlmConfig { url: string; model: string; key?: string }

export function llmConfig(): LlmConfig | null {
  const url = process.env.ASK_LLM_URL?.trim();
  if (!url) return null;
  return {
    url: url.replace(/\/$/, ''),
    model: process.env.ASK_LLM_MODEL?.trim() || 'default',
    key: process.env.ASK_LLM_KEY?.trim(),
  };
}

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

/** One chat completion; resolves to the trimmed assistant text. */
export async function chatCompletion(messages: ChatMessage[], opts: { timeoutMs?: number; temperature?: number; maxTokens?: number } = {}): Promise<string> {
  const cfg = llmConfig();
  if (!cfg) throw new Error('LLM not configured (ASK_LLM_URL)');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 90_000);
  try {
    const resp = await fetch(`${cfg.url}/chat/completions`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', ...(cfg.key ? { Authorization: `Bearer ${cfg.key}` } : {}) },
      body: JSON.stringify({
        model: cfg.model, messages, temperature: opts.temperature ?? 0.2, stream: false,
        ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
      }),
    });
    if (!resp.ok) throw new Error(`LLM HTTP ${resp.status}`);
    const data = await resp.json() as { choices?: { message?: { content?: string } }[] };
    const answer = data.choices?.[0]?.message?.content?.trim();
    if (!answer) throw new Error('LLM returned no content');
    return answer;
  } finally {
    clearTimeout(timer);
  }
}
