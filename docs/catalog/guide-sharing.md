---
id: guide-sharing
name: Per-user guide sharing
area: guides
status: beta
version: 2026.4.42
depends: [uam, guide-lifecycle]
terms: []
spec: ../README.md#ar-work-instructions-ar-oms
api: |
  PATCH /guides/:id — sharedWith: technician emails; [] = everyone; validated against the allow-list (portal · Engineer+)
  GET /guides — technicians receive only guides shared with them or with everyone (any · API key)
  GET /guides/:id — 404 for technicians outside a guide's sharing list (any · API key)
  GET /uam/technicians — name + email picker for the Share dialog (portal · Engineer+)
arch: |
  flowchart LR
    E["Engineer - Guide Library 'Share' dialog"] -->|"PATCH sharedWith[]"| G[("guides store")]
    G --> V["guideVisibleTo(user, guide) - one predicate"]
    subgraph Reads["every guide read"]
      L["GET /guides list"]
      S["GET /guides/:id + /steps - 404 outside the list"]
    end
    V --> L
    V --> S
    T["Technician session (UAM token)"] --> V
    N["No list / empty list = visible to ALL technicians (backward compatible)"] -.-> V
---
Guides can be shared with specific technicians: an Engineer picks names from
the UAM allow-list in the Guide Library's Share dialog, and from then on only
those technicians see or run the guide — in the portal and (with the app
signed in) on device. One pure predicate gates the list, the single-guide
read and the steps read, so deep links can't bypass sharing, and exclusion
answers 404 rather than confirming existence. No list means visible to all
technicians, so existing guides behave exactly as before; Engineers,
Managers and Owners always see everything.
