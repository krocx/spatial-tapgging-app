---
id: poc-portfolio
name: POC Portfolio
area: platform
status: beta
version: 2026.4.46
depends: [trl-scorecard, device-readiness, uam]
terms: [SIB]
spec: POC-PORTFOLIO.md
api: |
  GET /portfolio/data - every use-case with its current POC, stage, health, decisions waiting, staleness, plus the overview summary (browser · API key)
  GET /portfolio/usecases/:id - one use-case with its POCs, status log, bottlenecks, learnings and the live readiness block read from SIB (browser · API key)
  POST /portfolio/usecases - create a use-case (portal · Manager+, signed in by name)
  PATCH /portfolio/usecases/:id - edit fields, links, health; stage changes are gated (portal · Manager+)
  POST /portfolio/usecases/:id/pocs - add a POC (portal · Manager+)
  PATCH /portfolio/usecases/:id/pocs/:pid - scope, definition of done, tracks, milestone, exit, stage; start needs scope + DoD, complete needs a learning, an exit and a scorecard entry (portal · Manager+)
  POST /portfolio/usecases/:id/pocs/:pid/status - a dated status note, append-only (portal · Engineer+)
  POST /portfolio/usecases/:id/pocs/:pid/learnings - a learning; every learning is a metric (portal · Engineer+)
  POST /portfolio/usecases/:id/pocs/:pid/bottlenecks - a bottleneck with owner, severity and the needs-leadership flag (portal · Engineer+)
  PATCH /portfolio/usecases/:id/pocs/:pid/bottlenecks/:bid - resolve a bottleneck (portal · Engineer+)
  GET /portfolio/export.xlsx - Portfolio · POCs · Status log · Bottlenecks · Readiness (browser · API key)
  GET /portfolio/export.pptx - overview slide + one slide per use-case for the steering pack (browser · API key)
wireframe: portal
arch: |
  flowchart LR
    M["Manager: use-case · POCs<br/>scope · definition of done · stage · health · exit"] --> S["portfolio-core: gates<br/>start needs scope + DoD · complete needs learning + exit + scorecard entry"]
    E["Engineer: status · bottlenecks · learnings<br/>append-only, named, dated"] --> S
    S --> O["/portfolio overview: decisions first, then health, then stalest"]
    S --> P["/portfolio#use-case: the one-pager"]
    R["guides · readiness · usage log · scorecard"] -.read live.-> P
    O --> X["export.xlsx · export.pptx - the steering pack"]
---
Every business unit, every use-case, where each stands. A use-case is a
programme a BU runs with us (the business question in its words, the sponsor,
the ME, the chambers and guides in SIB); numbered POCs sit under it, each with
a scope and a definition of done - the scope completed as planned, not
pass/fail - and an exit when it closes: next POC, pilot, or parked with the
reason. Status, bottlenecks and learnings are append-only and carry a name
and a date; bottlenecks have an owner and a "needs leadership" flag that puts
the use-case first on the overview. Readiness is never typed: published
guides, steps per device form, runs, evidenced runs, device verdicts and
scorecard lenses are read from SIB when the page opens. Stage changes are
gated so status cannot inflate, and records older than the weekly cadence
show as stale. Excel and PowerPoint exports are the steering-committee and
leadership packs.
