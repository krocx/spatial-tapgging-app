---
id: tag-groups
name: Tag groups
area: tags
status: shipped
version: baseline
depends: [check-ontology]
terms: [Tag]
spec: APP-FEATURES.md
wireframe: author
arch: |
  flowchart LR
    CRUD["POST / GET /tag-groups"] --> G[("TagGroup store: name + tag ids")]
    G --> PICK["Operator picks a group (TagGroupListView)"]
    PICK --> SUB["Validation runs only the group subset"]
    SUB --> VAL["POST /perception/validate-all scoped to group tags"]
    ADD["AddTagSheet assigns tags to groups at creation"] --> G
---
Named inspection sets validated as a unit — "pre-start checks", "changeover checks" —
so operators run the subset that matters for the job instead of every tag on the
anchor.
