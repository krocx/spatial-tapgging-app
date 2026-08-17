---
id: auth-detection
name: Auth auto-detection
area: portal
status: shipped
version: baseline
depends: []
terms: [SIB]
spec: SERVER-REFERENCE.md
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
The portal asks /config whether the server enforces an API key and only prompts when
it does. Local development stays frictionless; production stays locked — one
codebase, no build flags.
