---
id: ask-sib
name: Ask SIB — docs-grounded assistant
area: platform
status: beta
version: 2026.4.42
depends: [feature-catalogue, no-cloud-ai]
terms: [SIB, AI Ops Copilot, Adapter]
spec: catalog/README.md
arch: |
  flowchart LR
    Q["POST /ask - question"] --> RET["ask/ask-core.ts retrieve - keyword scoring over features + glossary"]
    RET --> T{"ASK_LLM_URL set?"}
    T -->|no| R1["Retrieval tier: ranked sources + definitions"]
    T -->|yes| CTX["buildAskContext - bounded, citable blocks"]
    CTX --> LLM["OpenAI-compatible /v1/chat/completions - llama.cpp llama-server OR Ollama, env-var choice"]
    LLM --> R2["Generation tier: answer citing feature ids"]
    LLM -.model down.-> R1
    R2 --> UI["Ask drawer on /catalog - sources are permalink chips"]
    R1 --> UI
---
Ask a question, get an answer grounded strictly in the Feature Catalogue and the
dictionary — with the features cited as clickable chips. Runs in two tiers: docs
search everywhere, and full generation wherever an OpenAI-compatible local model
endpoint (llama.cpp or Ollama) is configured. No site data flows through it and
no cloud AI is involved; a down model degrades to search, never to a hard failure.
