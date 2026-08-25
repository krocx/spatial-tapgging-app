---
id: auth-detection
name: Auth auto-detection
area: portal
status: shipped
version: baseline
depends: []
terms: [SIB]
spec: SERVER-REFERENCE.md
api: |
  GET /config — auth-mode booleans the portal adapts to (browser · public)
  POST /unlock — validate key, set 30-day HttpOnly cookie (browser · public)
arch: |
  sequenceDiagram
    participant P as Portal boot
    participant C as GET /config (no auth)
    participant M as middleware/auth.ts - apiKeyAuth
    P->>C: authRequired?
    alt authRequired true (SIB_API_KEY set)
      P->>P: Prompt once, store key, apiFetch adds X-API-Key
    else false (company network / local dev)
      P->>P: No prompt - frictionless
    end
    Note over M: Same build everywhere - no flags, the server decides
---
The portal asks /config whether the server enforces an API key and only prompts
when it does. On internet-facing deployments the content gate goes further:
every page and endpoint requires the key (browsers unlock once via /unlock,
which sets an HttpOnly cookie), and only /health, /unlock and a reduced /config
stay public. Local development stays frictionless; one codebase, no build flags.
