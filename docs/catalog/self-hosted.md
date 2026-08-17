---
id: self-hosted
name: Self-hosted end to end
area: platform
status: shipped
version: baseline
depends: []
terms: [SIB]
spec: INTERNAL-SERVER-DEPLOY.md
arch: |
  flowchart LR
    subgraph Image["Docker image (repo-root context)"]
      B["Stage 1: npm ci + tsc + BOOT SMOKE TEST - /health hit inside the builder"]
      R["Stage 2: runtime - dist + portal + roadmap bundle + served docs"]
    end
    B --> R
    R --> REN["Render - disk mounted at /data, SIB_DATA_DIR"]
    R --> PREM["On-prem Windows - NSSM service, git pull + build ritual"]
    D[("JsonFileStore - plain JSON on OUR disk")] --- R
---
The whole platform runs on infrastructure we control — Render or on-prem Windows
under NSSM — and no third party ever sees site data. Deployment is a single Docker
image with a build-time boot smoke test, plus the committed portal and roadmap
bundles.
