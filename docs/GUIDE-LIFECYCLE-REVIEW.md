# Guide lifecycle review - removal, data integrity, access

Proprietary & Confidential · Applied Materials. Status: **findings and
proposal for approval** (2026.4.50, backlog #1). Nothing in this note is
implemented yet.

## 1. What happens today

### The X on a Roadmap-home card
`DELETE /mindmap/:id` (`deleteMindmap`): the map, its version history and its
access record are removed. The guide in the Content Library is untouched.
The client confirm says "Delete *name* and its version history?" - correct,
but it does not say the guide survives, and it offers no undo.

Access: `assertAccess` passes for any **published** map, and every map made
by "Open in Designer" is published from birth. So any browser holding the
site key can delete any guide's designer map - there is no role check and no
owner check. The draft-key scheme is explicitly "pre-RBAC".

### Why the home shows the same guide many times
`POST /guides/:id/edit-map` already reuses a linked map (`guideSync.guideId`,
or node provenance for older maps). The duplicates in the screenshot are
**duplicate guides**, not duplicate maps: every Cortona import creates a new
guide with the same name ("Bee Assembly (V.04.04) …" × 9, two "Hydraulic
Press …", two "Drill Driver …"), and each guide gets its own map when opened.
Backlog #2 is therefore an import problem first: a re-import of the same
publication must offer "update the existing guide" (steps refreshed, id,
anchor, configuration, sharing, sessions kept) with "create a new guide" as
the explicit alternative - and the cards need the anchor and import date so
twins can be told apart.

### Deleting a guide (`DELETE /guides/:id`)
Cascade today: import log, steps, step images, the guide. **Not** cascaded:

| Left behind | Where | Effect |
|---|---|---|
| Validation tags + pass states of trained steps (`validationTagId`) | tag store, pass-state store | orphan tags, stale cone references |
| The designer map | mindmap store (`guideSync.guideId` → nothing) | an "[Guide] …" card that opens a procedure for a guide that no longer exists; "send to the floor" would create a new guide |
| Live sessions, sign-off sessions, events, observations | guide-session stores | records keep `guideId` + `guideName`; the UI shows them, deep links to the guide 404 (acceptable as history, must be handled) |
| Evidence files | `guide-session-evidence/<session>/` | kept; referenced by sessions (fine) |
| Usage log (K2) | oms-usage-log | kept; insights still count the runs (fine - history) |
| Portfolio use-cases (`guideIds`) | portfolio-usecases | readiness per use-case silently drops the guide; the use-case still lists the id |
| Scorecard evidence links | scorecard entries | links to a guide that is gone |
| Sealed world map / anchor data per guide | world map store | orphan (iOS deletes the world map separately on re-placement) |
| Hints, learnings per guide | hints store | orphan |

Who may delete: the route has **no role check** (any site-key caller: the
portal library row menu "Delete guide", the iOS app's swipe-delete, the XR
kit's key). `PATCH /guides/:id` (rename, publish, sharing) likewise. Only
`/guides/orphans` and `assembled-pose` are role-gated. Technicians cannot
*see* drafts or unshared guides (`guideVisibleTo`), but nothing stops a
technician's device from calling delete on a guide id it has seen.

Publish today is a boolean on PATCH with no precondition - which is backlog
#5 (no publish without a configuration) and belongs in the same gate.

## 2. Proposal

### 2.1 States, not deletion
A guide has a lifecycle; "remove" means different things at different times:

| State | Meaning | Who | Reversible |
|---|---|---|---|
| **draft** | authored, not visible to technicians | engineer+ | - |
| **published** | runnable; needs a chamber configuration (#5) | manager+ (or the author if engineer, policy choice) | unpublish |
| **retired** (new) | hidden from Operator and the library's default view, runs and evidence kept, map kept read-only; the use-case still references it as history | manager+ | restore |
| **deleted** | gone, with its cascade; only allowed when **no run has ever been recorded** against it (otherwise: retire) | owner | no |

The Roadmap home's X becomes "Remove from the Roadmap" (map only, guide
untouched, said so in the confirm) and never deletes a guide. A retired or
deleted guide's map is removed with it.

### 2.2 Cascade and integrity (server)
- `DELETE /guides/:id` refuses with 409 when sessions, live sessions or usage
  rows reference the guide ("12 runs recorded - retire it instead").
- When it proceeds it also removes: validation tags + pass states of the
  guide's steps, the linked map (+ versions + access), the guide's world map,
  hints and learnings keyed by the guide, the step-image files; and it
  **detaches** (never deletes) portfolio `guideIds` and scorecard evidence
  links, writing a note on the use-case ("guide removed on <date> by <who>").
- Retire sets `retiredAt/retiredBy`; every list that serves technicians or
  Operator filters retired out; the library shows a "Retired" filter;
  sessions and insights keep showing the name.
- One audit line per transition in the ops log (who, what, when), the same
  log the admin page already shows.
- Backups already cover the stores; add the daily check that no map's
  `guideSync.guideId` and no session's `guideId` points at a missing guide
  (reported on /admin/ops, not auto-fixed).

### 2.3 Access (UAM) for guides
Roles exist (technician · engineer · manager · owner); apply them per action:

| Action | technician | engineer | manager | owner |
|---|---|---|---|---|
| run (Operator / XR kit) | if published and shared | ✓ | ✓ | ✓ |
| create, author steps, edit map | - | ✓ | ✓ | ✓ |
| publish / unpublish | - | own guides (policy choice) | ✓ | ✓ |
| share / sharing list | - | own guides | ✓ | ✓ |
| retire / restore | - | - | ✓ | ✓ |
| delete (no runs) | - | - | - | ✓ |
| remove the designer map from the Roadmap | - | ✓ | ✓ | ✓ |

"Own" = `createdBy`/author email, already stored. The same table governs the
iOS app (swipe-delete hidden below manager), the portal row menu (actions
greyed with the reason) and the designer (the X shows "Remove from Roadmap"
only; "Delete guide" is not offered there). The draft-key scheme stays for
roadmaps that are not guides.

### 2.4 UX
- Library row menu: Unpublish · Retire · Delete (greyed with "12 runs
  recorded - retire instead" when applicable) · Open in Designer.
- Every destructive confirm says what goes and what stays, in words
  ("The guide, its 23 steps, images, cone training and its Roadmap map will be
  deleted. 0 runs are recorded. This cannot be undone.").
- Retire is the default suggestion; the toast offers Restore for 10 s.
- Roadmap home card: name, anchor, configuration, imported/created date,
  "linked to guide ✓ / guide missing ✗" so twins and orphans are visible;
  the X reads "Remove from Roadmap" and says the guide stays.
- Duplicate guides: the library groups same-name guides and offers "merge
  into the newest" (steps compared, sessions re-pointed) as a manager action.

### 2.5 Order of work
1. Server gates: role table, 409 on delete with runs, full cascade, retire
   state, audit lines, orphan check. (Data safety first; no UI change needed
   for it to protect data.)
2. Portal library menu + confirms; Roadmap home card and X wording.
3. iOS: hide delete below manager; retire visible to managers; Operator
   filters retired.
4. Import de-duplication ("update existing guide") - backlog #2.
5. Publish precondition (configuration) - backlog #5, same gate.

Open decisions for Karthik: may an engineer publish their own guide, or is
publish manager-only; is "retire" the right word on the floor (alternatives:
archive, withdraw); and whether a guide with runs may ever be deleted by an
owner with an explicit "I understand the runs will lose their guide" step.
