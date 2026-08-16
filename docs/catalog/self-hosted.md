---
id: self-hosted
name: Self-hosted end to end
area: platform
status: shipped
version: baseline
depends: []
terms: [SIB]
spec: INTERNAL-SERVER-DEPLOY.md
---
The whole platform runs on infrastructure we control — Render or on-prem Windows
under NSSM — and no third party ever sees site data. Deployment is a single Docker
image with a build-time boot smoke test, plus the committed portal and roadmap
bundles.
