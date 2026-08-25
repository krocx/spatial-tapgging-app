---
id: guide-lifecycle
name: Draft → placed → published lifecycle
area: guides
status: shipped
version: baseline
depends: [spatial-steps]
terms: [AR Work Instructions, Author Mode]
spec: PROCEDURE-DESIGNER.md
api: |
  POST /guides — create draft guide (app, portal · API key)
  GET /guides?anchorId= — guides for an anchor (app, portal · API key)
  PATCH /guides/:id — publish / unpublish / rename / move (portal · API key)
  POST /guides/:id/steps — append step (app, portal · API key)
  PATCH /guides/:id/steps/:stepId — edit step content + placement (app, portal · API key)
  DELETE /guides/:id — remove guide + steps + evidence (portal · admin key)
wireframe: arguides
arch: |
  flowchart LR
    NEW["Guide created (editor, import, or procedure export)"] --> DRAFT["draft - invisible to operators"]
    DRAFT --> PLACE["Each step placed in AR - isPlaced per step"]
    PLACE --> PUB["Publish via PATCH /guides/:id"]
    PUB --> OP["GuideListView shows published guides only"]
    MOVE["Move to another anchor"] -.clears placement.-> DRAFT
    RESYNC["Canvas re-sync"] -.updates content only.-> PUB
---
Guides are invisible to operators until every step is placed in AR and the guide is
explicitly published. Half-authored content can never leak onto the floor; moving a
guide to a new anchor automatically unpublishes it until it is re-placed.
