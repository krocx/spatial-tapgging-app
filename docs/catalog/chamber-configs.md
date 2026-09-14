---
id: chamber-configs
name: Chamber Configurations (chamber types)
area: portal
status: shipped
version: 2026.4.45
depends: [anchor-directory, guide-library]
terms: [Anchor, Anchor Portal]
spec: CONNECTED-WORKER.md#chamber-configurations
api: |
  GET /chamber-configs — configuration catalog (app, portal · API key)
  POST /chamber-configs — create a configuration (portal, app · API key)
  PATCH /chamber-configs/:id — rename / edit (portal · API key)
  DELETE /chamber-configs/:id — only when no chamber references it (portal · API key)
  PATCH /anchors/:id — assign configuration (configId) or rename (portal, app · API key)
wireframe: portal
arch: |
  flowchart LR
    CFG[("chamber-configs.json<br/>Producer XP · Cfg A")] --- A1["Anchor (chamber) configId"]
    CFG --- A2["Anchor configId"]
    CFG --- A3["Anchor configId"]
    P["Portal › Admin › 🏭 Chamber Configs<br/>anchor cards: assign inline"] --> CFG
    GL["Guide Library grouped config → chamber<br/>⧉⧉ All N: copy guide to every chamber"] --> A1 & A2 & A3
    K["iOS kiosk: engineer picks configuration<br/>operator: Scan chamber QR resolves it"] --> CFG
    UL["usage-log session: configId · configCode"] --> CFG
---
A configuration is a chamber type; many physical chambers share it. Engineers
author against a configuration, technicians never pick one — the chamber QR
resolves it — and the Guide Library groups guides by configuration so one guide
can be copied to every chamber of that type in one click. Content still lives per
chamber (author on one, copy to the rest, place per chamber); the configuration
rides on every usage-log session so reports roll up by chamber type.
