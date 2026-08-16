---
id: no-cloud-ai
name: No cloud AI dependency
area: platform
status: shipped
version: baseline
depends: [adapter-architecture]
terms: [Adapter, Perception Layer]
spec: ../README.md
---
Every intelligent feature is either local (on-device Vision, in-house SSIM, local
Ollama vision) or behind an interface we own. If a vendor disappears tomorrow, an
adapter changes — the platform doesn't.
