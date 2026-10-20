---
id: business-readiness
name: Business Readiness · Impact - the second half of the scorecard
area: platform
status: shipped
version: 2026.4.50
depends: [trl-scorecard, usage-log, insights, poc-portfolio, uam]
terms: [AR Work Instructions, Audit Logs]
spec: BUSINESS-READINESS.md
api: |
  GET /scorecard/impact - the three pillars with every needle's baseline, last quarter, now and target, the readiness level per pillar and overall, the POC claims, what to enter next; ?quarter= (portal · API key)
  POST /scorecard/impact/entries - a baseline, a quarterly value or a target for a needle, with source, scope and confidence (portal · API key)
  PATCH /scorecard/impact/claims - a POC's claim on a needle: the change it expects, and the change it measured (portal · API key)
wireframe: portal
arch: |
  flowchart LR
    subgraph Sources
      UL[("usage log<br/>runs · steps · readings · validations · observations")]
      MES["MES / QMS / HR<br/>entered by the owner with its source"]
      PF["POC Portfolio<br/>each POC claims its needles"]
    end
    UL -->|"autoMetrics: cycle time · strike zone · first-time right · hints per run · runs to proficiency"| IC["impact-core.ts<br/>progress to target · pillar level (bands + evidence caps) · overall = lowest pillar"]
    MES --> IC
    PF --> IC
    IC --> PG["/scorecard → Business<br/>programme level · three gauges with last quarter's ghost · the needles · what to enter next · every POC moves a needle"]
    IC --> XL["export.xlsx<br/>Business readiness · Needles"]
    TRL["Technology half<br/>L1 does it work · L2 is SIB ready"] -.->|"read side by side"| PG
flow: |
  flowchart LR
    B["Owner enters the baselines from the last quarter before the platform (MES, QMS, HR)"] --> T["Sponsor sets the targets"]
    T --> A["SIB fills the five automatic needles from the runs"]
    A --> C["Each active POC claims the needles it will move, and by how much"]
    C --> R["Quarterly review: the Technology and Business halves side by side"]
    R --> N["A POC completes with the change it measured on its needle - that is the needle moving"]
---
The Technology scorecard says whether it works and whether SIB is ready; the
Business half says whether the business is moving. Three pillars - Productivity
(do people become contributors sooner, and stay capable), Velocity (is the
work faster, and is the technician in the strike zone) and Customer Trust (is
the work right the first time, and do fewer problems reach the customer) -
each a few needles with a baseline, a now, a target and last quarter's mark,
on the same evidence-and-confidence discipline as the lenses. Five needles
fill themselves from the usage log; ten are entered from MES, QMS and HR with
their source. A pillar's level is how far its needles have moved from baseline
toward target, capped by evidence and coverage so a good POC number is not
read as a business case; the programme is as ready as its weakest pillar. Every
POC in the portfolio claims the needles it moves and, when it completes,
records the change it measured. The frame borrows from the DoD's Manufacturing
Readiness Levels, lean's value-added-time ratio, first-pass yield and cost of
poor quality, and Kirkpatrick's levels for upskilling.
