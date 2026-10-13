# Guide lifecycle review - removal, data integrity, access

Proprietary & Confidential · Applied Materials. Status: **decided and the
server + portal stage implemented** (2026.4.50, backlog #1). Decisions
(Karthik, 2026-10-13): only a Manager (or Owner) publishes; the word is
**archive**, not retire; sessions and usage are live data, present by
default, deleted only by an Owner from their own pages; an Owner may delete a
guide that has runs, and the runs stay; deleted guides sit in a **30-day
trash** with restore. A separate "Admin" role for sessions management is on
the backlog (see §3).

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
| **archived** | hidden from Operator and the library's default view, unpublished; runs, evidence, usage, steps, placements and map kept | manager+ | restore |
| **deleted** | the guide, its steps, its cone-training tags and its Roadmap map move to the trash for 30 days; runs, evidence and the usage log stay in place; an Owner restores or deletes for good; expired items purge hourly | owner | for 30 days |

The Roadmap home's X is "Remove from the Roadmap" (map only, guide untouched,
said so in the confirm) and never deletes a guide. A deleted guide's map goes
to the trash with it and comes back on restore.

### 2.2 Cascade and integrity (server) - implemented
- `DELETE /guides/:id` (Owner) moves the guide, its steps, its cone-training
  tags and its linked map (+ versions + access) into `guide-trash` with
  `expiresAt = +30 days`, and tells the caller how many runs were kept. The
  confirm in the portal reads `GET /guides/:id/runs-count` first and says it
  in words. Step images and pass-state files stay on disk until purge.
- Restore puts everything back; purge (Owner, or the hourly scheduler after
  30 days) deletes the item and the files only it referenced.
- Portfolio `guideIds` and scorecard evidence links are left in place (ids);
  the integrity report lists what points at a missing guide and whether it
  is in the trash. Hints and the guide's world map are left for a later pass.
- Archive sets `archivedAt/archivedBy` and unpublishes; technicians never
  see archived guides; the library hides them unless "Show archived" is on.
- One audit line per transition in the ops log (who, what, when), the same
  log the admin page already shows.
- Backups already cover the stores; add the daily check that no map's
  `guideSync.guideId` and no session's `guideId` points at a missing guide
  (reported on /admin/ops, not auto-fixed).

### 2.3 Access (UAM) for guides - implemented on the server
Roles exist (technician · engineer · manager · owner); applied per action:

| Action | technician | engineer | manager | owner |
|---|---|---|---|---|
| run (Operator / XR kit) | if published and shared | ✓ | ✓ | ✓ |
| create, author steps, edit map | - | ✓ | ✓ | ✓ |
| publish / unpublish | - | - | ✓ | ✓ (publish also needs a chamber configuration) |
| share / sharing list | - | own guides | ✓ | ✓ |
| archive / restore | - | - | ✓ | ✓ |
| delete (to the trash; runs stay) | - | - | - | ✓ |
| delete sessions / usage (their own pages) | - | - | - | ✓ |
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
1. ✅ Server gates: role table, archive state, delete to the 30-day trash
   with restore and purge, publish needs Manager + configuration, session
   deletion Owner only, audit lines, integrity report.
2. ✅ Portal: row menu (Archive / Restore / Delete with the honest confirm),
   "Show archived", Admin › Guide trash card with Restore / Delete now and
   the integrity line; Roadmap home X reads "Remove from the Roadmap".
3. iOS: swipe-delete hidden below Owner, Archive for Managers, Operator
   filters archived (the server already hides them from technicians).
4. Import de-duplication ("update existing guide") - backlog #2.
5. Roadmap home cards: anchor, configuration, date, guide link state.

## 3. The Admin role (backlog)
Industry practice separates **data stewardship** (retention, deletion of
records, exports, audit) from **product ownership** (publishing, roles). SIB
today folds both into Owner, which is right for one PO and a small team; the
moment a second person must delete sessions without being able to change
roles or keys, an `admin` role (sessions, usage, trash, backups, audit; no
UAM or key changes) is the clean split. The gates above are written per
action (`requireRole('owner')` on each), so adding `admin` to the allowed
roles of the session and trash routes is a one-line change per route when
it is wanted - recommended at the next UAM pass, not now.
