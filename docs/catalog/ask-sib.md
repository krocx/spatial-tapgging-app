---
id: ask-sib
name: Ask SIB - on every page, facts first
area: platform
status: beta
version: 2026.4.50
depends: [feature-catalogue, no-cloud-ai, poc-portfolio, device-readiness]
terms: [SIB, AI Ops Copilot, Adapter]
spec: catalog/README.md
api: |
  POST /ask - { question, page } → facts (live data, exact: POC status and counts, POCs by BU, use-cases at risk, decisions waiting on leadership, device readiness, a device's card, live numbers, the latest landscape, capability by category), catalogue sources, documents (explain pages, device profiles, fit, landscape), glossary, and an answer when a local model is configured; access follows the reader's keys (site key for live data, IP key for restricted documents) (browser · API key)
  GET /ask/config - whether generation is enabled + model name (browser · API key)
arch: |
  flowchart LR
    Q["POST /ask - question + page"] --> F["ask/facts.ts - recognised questions answered from live data, gated by the reader's keys"]
    Q --> RET["ask/ask-core.ts retrieve - keyword scoring over features + glossary"]
    Q --> D["ask/ask-docs.ts - explain pages, device profiles, fit, landscape"]
    F --> T{"ASK_LLM_URL set?"}
    RET --> T
    D --> T
    T -->|no| R1["Retrieval tier: ranked sources + definitions"]
    T -->|yes| CTX["buildAskContext - bounded, citable blocks"]
    CTX --> LLM["OpenAI-compatible /v1/chat/completions - llama.cpp llama-server OR Ollama, env-var choice"]
    LLM --> R2["Generation tier: answer citing feature ids"]
    LLM -.model down.-> R1
    R2 --> UI["Ask drawer on every surface (portal/ask.js, injected by brand.js) - facts as cards with links, sources as chips"]
    R1 --> UI
---
Ask a question on any SIB page and get an answer in three layers: facts first
(live data, answered exactly on the server: how many POCs are active and
which, POCs by business unit, use-cases at risk, decisions waiting on
leadership, a device's readiness or its card, the live numbers, the latest on
the landscape, which device categories deliver a capability), then the
documents (catalogue features as chips, explain pages, device profiles, fit
and landscape excerpts, dictionary terms), then - wherever an OpenAI-compatible
local model (llama.cpp or Ollama) is configured - a sentence written over
exactly that context. Every line links into the page that owns it. The drawer
rides beside the Compass on every surface (`/` focuses it, Esc closes) with
presets that change with the page. Access follows the reader: the site key
admits the live data, the same audience that can open the Portfolio; the IP
key admits the restricted documents; without them a fact says where the
answer lives and what unlocks it. No cloud AI; a down model degrades to the
facts and the docs, never to a failure.
