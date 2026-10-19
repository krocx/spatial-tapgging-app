---
id: insights
name: Insights - the leadership view of how the guides are doing
area: portal
status: shipped
version: 2026.4.46
depends: [usage-log, contextual-intelligence, chamber-configs]
terms: [AR Work Instructions, Audit Logs]
spec: CONTEXTUAL-INTELLIGENCE.md#part-3---effectiveness-loop-portal-shipped
api: |
  GET /guide-sessions/insights - headline numbers with the previous period, runs per day, per-guide times and heat; ?days=7|30|90 ?configId= ?guideId= (portal · API key)
  GET /guide-sessions/insights/export.xlsx - the same window as a workbook for decks (portal · API key)
  GET /guide-sessions/intelligence/:guideId - the per-guide step heat and hint effectiveness the Insights heat strip links into (portal · API key)
wireframe: portal
arch: |
  flowchart LR
    UL[("usage log<br/>every run · every step visit")] --> INS["oms/insights.ts<br/>pure aggregation · tested"]
    OBS[("observations · hints")] --> INT["oms/intelligence.ts<br/>per-step heat · hint effectiveness"]
    INT --> INS
    INS --> PAGE["Portal › Analytics › Insights<br/>tiles with sparkline + delta · runs per day · hints that helped<br/>time per guide · heat strip → hottest step"]
    PAGE --> X["Save as image · Excel"]
    RD["readings (AROMS-354)<br/>first-time right · typed instead · measured values over runs"] -.->|planned| INS
flow: |
  flowchart LR
    L["Lead opens Insights"] --> W["Picks 7 / 30 / 90 days, a configuration, a guide"]
    W --> T["Reads the tiles: runs · completed · typical run · hints that helped · wrong parts"]
    T --> H["Finds the hot step on a guide's heat strip"]
    H --> I["Opens Intelligence for that step: why people struggle, which hints helped"]
    I --> D["Saves the view as an image for the deck"]
---
Insights is the page a lead reads on Monday: how the guides did this period
against the last, derived entirely from the same runs the Usage Log records -
no second source, no manual tally. Headline tiles (runs and people, completion
rate, typical and slowest-tenth run time, hints that helped, wrong parts per
run) each carry a sparkline and a delta against the previous window; runs per
day with completions; the hints-that-helped line; and a per-guide table with
times and the Intelligence heat strip per step, linking to the hottest step.
Seven, thirty or ninety days, filtered by configuration and guide; *Save as
image* for a deck, Excel for the numbers. The charts are the portal's own SVG
on the design system - no chart library. Readings join it next (AROMS-354):
first-time-right and typed-instead rates per step, and the measured values
themselves over runs, so a leak rate drifting towards its limit on one chamber
is seen before a run fails.
