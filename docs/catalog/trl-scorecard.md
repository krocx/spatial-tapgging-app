---
id: trl-scorecard
name: Technology Readiness scorecard
area: platform
status: beta
version: 2026.4.46
depends: [device-readiness, feature-catalogue]
terms: [SIB]
spec: TRL-SCORECARD.md
api: |
  GET /scorecard/data - tracks, criteria, latest scores, lens suggestions, overrides, master verdicts, leadership summary (browser · API key)
  POST /scorecard/entries - score a criterion 1-5 with confidence, comment and evidence links; a 4 or 5 needs evidence (browser · API key)
  POST /scorecard/lens - the track owner confirms or overrides a lens with a reason (portal · Engineer+)
  POST /scorecard/master - record the master sheet's verdict for a track and quarter (portal · Engineer+)
  GET /scorecard/export.xlsx - the SIB block for the master workbook: lenses, criteria, evidence (browser · API key)
wireframe: portal
arch: |
  flowchart LR
    T["team scores criteria 1-5<br/>confidence + evidence links"] --> S["scorecard-core: latest per criterion<br/>lens = min(round(mean), min + 1)"]
    S --> O["track owner confirms / overrides lens"]
    O --> X["export.xlsx - SIB Import · Criteria · Evidence"]
    X --> M["Master TRL workbook - L3-L5, weights, gates, vetoes, verdict"]
    M --> V["verdict recorded back in SIB - leadership view"]
    R["readiness matrix · import logs · sessions"] -.evidence.-> T
---
How the programme scores its tracks, and SIB's part in it. SIB scores L1
(does it work) and L2 (is SIB ready) for Content Pipeline, Hardware Fit and
AR SDK through criteria anyone on the team can score 1 to 5 with a
confidence and evidence that links to what SIB already holds; the lens the
criteria suggest is confirmed by the track owner and exported in the master
workbook's column order. L3 to L5, the weights, gates and vetoes stay in the
master sheet with the track owner, whose verdict is recorded back in SIB so
the leadership view shows every track's standing, open gaps and evidence
next to the criteria the team is scoring.
