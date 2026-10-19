---
id: readings-analytics
name: Readings in Intelligence and Insights - first-time right, typed instead, measured values over runs
area: portal
status: planned
version: 2026.4.50
depends: [spatial-readings, insights, contextual-intelligence]
terms: [Evidence Capture]
spec: SPATIAL-READINGS.md
wireframe: portal
flow: |
  flowchart LR
    R["Every reading on every run (usage log)"] --> Q["Process quality per step: read failed first time · typed instead"]
    R --> M["Measurement over runs per step: min · median · max with unit · sparkline over the period"]
    Q --> I["Intelligence: one more heat signal and two tiles on the step card"]
    M --> S["Insights: Reads first-time right · Typed instead tiles; a Measured values panel per guide and step"]
    S --> L["A leak rate creeping towards its limit on one chamber is seen before a run fails"]
---
Two different things hide in the readings the Usage Log already holds, and
they belong in different places. Process quality - how often the camera needed
a second try, how often a value was typed instead of read - is the same kind of
"where people struggle" the Intelligence heat strip shows, so it joins it as a
signal and two tiles per step, with the headline rates on Insights. Measurement
value is new: the numbers themselves - leak rate, torque, resistance - across
every run of a step, with the unit, as min, median, max and a sparkline over
the period, filterable by configuration and chamber the way Insights already
is. Labels and barcodes do not trend, so they appear only in the quality
signals. Proposed as AROMS-354; no code until approved.
