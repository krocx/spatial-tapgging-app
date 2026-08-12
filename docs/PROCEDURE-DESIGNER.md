# Procedure Designer — visual authoring for AR work instructions

Status: **approved, slice 1 in build**
Owner: Karthik
Related: [AR OMS section of the README](../README.md), `sib/src/routes/guides.ts`, `sib/roadmap-client/`

---

## 1. What this is

The Roadmap Mind-Mapper gains a second map type — a **procedure map** — whose nodes are
work-instruction steps and whose edges are the branch logic of a guide. A finished
procedure map compiles into an `ImportedGuide` and lands in the Guide Library as a
draft, ready for spatial placement on device.

It exists because authoring a branching procedure through the iOS step editor means
holding the whole graph in your head. A canvas makes the shape of a procedure visible
while you design it, which is exactly the argument for the ⬡ Graph view we already
added to the Guide Library — this is that view, made editable, and moved to the front
of the process.

---

## 2. The principle everything follows

> **The canvas owns the logic. The phone owns the place.**

A procedure has two halves: what the steps are and how they branch, versus where each
step physically sits on the equipment. A browser can author the first perfectly and the
second not at all.

This is not a new position. `sib/src/adapters/mindmap-sib-adapter.ts` already draws the
same line for anchors and tags, and says so in its header comment: it exports a draft
scaffold rather than writing into SIB stores, because "creating real anchors/tags
requires QR generation and spatial placement, which stays in the authoring apps."

The failure mode this guards against is someone designing a complete-looking procedure
and believing it is ready to run. Every lifecycle and validation decision below exists
to keep that from happening quietly.

---

## 3. Information architecture

Procedure maps are a **type chosen at creation**, living in the same tool as roadmap
maps and inheriting real-time collaboration, version history, comments and the
draft/publish workflow without modification. Roadmap maps are unaffected.

Two entry points, because two different people start here:

| Entry point | Who it serves |
|---|---|
| Roadmap tool → **New procedure map** | Someone designing a process from scratch, not yet tied to an asset |
| Guide Library → **Design visually** (new) | Someone who already knows the anchor and wants a guide for it |
| Guide Library → **Open in designer** (existing) | Someone revising a guide that already exists |

A procedure map carries an optional `anchorId`. Set at creation from the Guide Library
path, or chosen at send time from the roadmap path.

---

## 4. Object mapping

| Canvas | Guide | Notes |
|---|---|---|
| Node | `GuideStep` | one node, one step |
| Node `text` | `step.title` | short label on the card |
| Node `notes` | `step.text` | the instruction body |
| Inspector voice field | `step.ttsText` | optional |
| Inspector required toggle | `step.completionRequired` | defaults true |
| Edge `role: 'next'` | `nextOnSuccess` | green |
| Edge `role: 'failure'` | `nextOnFailure` | red |
| Edge `role: 'requires'` | `precondition` | amber, drawn **into** the gated step |
| Attached image | `mediaPath` | uploaded via existing step-image store |
| Attached model | `modelId` + transform | picked from the shared 3D library |
| — | `posX/posY/posZ`, `isPlaced` | **device only — never written from canvas** |

### Step numbering

Sequence numbers are **derived, displayed, and never typed.** They come from walking
the graph: the success spine first, then each failure branch in the order its fork
appears.

This is the same algorithm as the lane assignment in the Guide Library graph view
(`renderGuideGraph` in `sib/portal/index.html`). It must be **extracted into one shared
module** and used by all three consumers:

1. the designer, to number nodes,
2. the Guide Library graph, to lay out lanes,
3. the compiler, to emit `sequenceNumber`.

Three independent implementations of "what order are these steps in" is how you get a
discrepancy nobody can see. That algorithm already cost three debugging rounds when the
spine walk silently absorbed branch steps; it should exist exactly once.

---

## 5. Constraints the canvas must enforce

`GuideStep` allows **one** `nextOnSuccess` and **one** `nextOnFailure`. Therefore:

- a node may have at most one outgoing `next` edge;
- a node may have at most one outgoing `failure` edge;
- `requires` edges are unconstrained in number (a step may have several prerequisites,
  though only the first compiles to `precondition` until the model supports more — see
  §10).

Drawing a second edge of a constrained role must either replace the existing one with a
confirmation, or refuse with an inline reason. It must never silently accept both:
an ambiguous graph compiles to an arbitrary choice, which is the precise class of defect
this feature is meant to eliminate.

---

## 6. Lifecycle

```
Designed  ──▶  Placed  ──▶  Published
(canvas)      (iOS)        (iOS or portal)
```

Three states, surfaced identically in the canvas, the Guide Library and the iOS guide
list. Sending from the canvas always produces a **draft with every step unplaced**, and
the confirmation says so explicitly:

> 11 steps created as a draft.
> Next: open on iOS to place each step in AR, then publish.

**The canvas never publishes.** Publishing a procedure nobody has physically walked is
the one genuinely unsafe action available here, and it stays behind the device.

---

## 7. Pre-flight validation

The census strip reuses the counts already shown in the Guide Library graph header —
steps, next, on failure, requires, lanes — so the same numbers mean the same thing in
both places.

### Blocking (cannot send)

| Check | Reason |
|---|---|
| No start node | every procedure needs one entry point |
| Unreachable step | an operator could never arrive there |
| Step with empty instruction text | nothing to show on the panel |
| Two outgoing edges of the same constrained role | ambiguous compile |
| `requires` edge forming a cycle | the step can never become reachable |

### Warning (send permitted)

| Check | Reason |
|---|---|
| Step with no reference image | usable, but weaker in the field |
| Loop with no exit path | may be intentional retry, may be a mistake |
| Terminal node with no incoming edge | probably a stranded draft node |
| Step with no voice script | falls back to instruction text |

Warnings never block. Blocking errors list the offending node and select it on click.

---

## 8. Re-sync and provenance

Provenance is stamped as `node.metadata.guide = { guideId, stepId }`, mirroring the
existing `metadata.sib` convention in `mindmap-sib-adapter.ts`. Re-sending to a guide
that already exists shows a diff **before** any write:

> 3 steps changed · 1 added · 1 removed
> Placement preserved for 10 steps. 1 new step will need placing on device.

### What a canvas write may never touch

`posX`, `posY`, `posZ`, `isPlaced`, `positionSource`, and all session/evidence history.
Structural fields update; spatial truth is owned by whoever stood in front of the
machine. Without this guarantee nobody will risk re-syncing a procedure in use.

### Published guides

Re-sync to a **published** guide is **blocked**. The dialog explains that operators may
be mid-session and offers an explicit **Unpublish and update** action. A published guide
is one someone may be standing in front of right now; silently mutating it is not a
recoverable mistake.

Removed steps are soft-handled: a step whose node is deleted is reported in the diff and
deleted on apply, but a step referenced by an in-flight live session is reported as a
blocking conflict rather than removed.

---

## 9. Deliberate non-goals

- **No spatial placement in the browser.** Physically impossible; pretending otherwise
  is the core risk.
- **No publishing from the canvas.**
- **No manually typed sequence numbers.** Derived only.
- **No SIB semantic node types on procedure maps.** `tag`, `perception`, `semantic`,
  `reasoning` and `generic` are meaningful for ontology maps and pure noise on a work
  instruction. The procedure palette is: step, decision, terminal.
- **No auto-layout on import.** Node positions imported from an existing guide are laid
  out once by the shared algorithm and then owned by the author.

---

## 10. Known limitations

**Multiple preconditions.** `GuideStep.precondition` is a single step ID. The canvas
allows several `requires` edges into one node, but only the first compiles. Either the
canvas should constrain this to one, or `precondition` should become an array — the
latter is the better model and is deferred, not rejected.

**Re-sync versus in-flight sessions.** Live sessions hold step IDs in server memory
(`guide-session.sse.ts`). The published-guide block covers the common case, but a draft
guide can in principle be run and re-synced concurrently. Slice 1 does not address this;
it is tracked as an open risk.

---

## 11. Build phasing

### Slice 1 — thin vertical slice (in build)

Proves the whole path on real data before investing in the richer UI.

| Step | Scope |
|---|---|
| 1a | shared types: `MindmapEdge.role`, `Mindmap.kind`, guide provenance, export/validate contracts |
| 1b | pure compiler: procedure map → `ImportedGuide`, with derived sequencing and validation |
| 1c | server: `POST /mindmap/:id/procedure/validate`, `POST /mindmap/:id/procedure/export` |
| 1d | canvas: procedure map type, relationship picker on edge draw, coloured edges, send dialog |
| 1e | verification: compiler unit tests incl. the branch shapes from the graph fix, plus end-to-end curl |

### Slice 2 — authoring depth

Inspector fields (voice, required, image, model), pre-flight panel in the canvas,
step palette (decision, terminal), keyboard flow.

### Slice 2.5 — UX polish + preview (shipped 2026.4.42, from field feedback)

Driven by first non-developer use of the deployed designer ("teams are used to
Visio and Figma"):

- **Edge type switcher** — a selected connection's role (Next / On failure /
  Requires) is editable in the Inspector; drawing no longer commits you.
- **Role comprehension** — picker copy rewritten around *paths vs rules*
  (Next/On failure are travelled; Requires only gates), Enter defaults to Next,
  Requires visually demoted; census strip doubles as a colour legend with a
  ? explainer panel.
- **Auto-sizing nodes** — cards wrap titles up to 4 lines and grow; all
  geometry reads `nodeHeight()` (see geometry.ts), never the `NODE_H` constant.
- **Autosave fields** — Notes and Voice script commit on blur AND unmount
  (the unmount path was silently dropping text); Saved ✓ affordance.
- **Reference link per step** — `metadata.step.linkUrl` (http/https only)
  → compiler → `ImportedGuideStep.linkUrl` → `GuideStep.linkUrl` → "Reference"
  button on the iOS AR panel (opens in Safari; nothing stored server-side).
- **Preview mode** — client-side phone-frame walkthrough traversing the real
  edge graph (Complete/Failed), speech-synthesis voice, requires-gate
  redirects, canvas you-are-here highlight, branch-coverage exit summary.
  Traversal must stay semantically identical to the compiler and the iOS
  runtime; a divergence is a bug in one of the three.

### Slice 3 — round-trip

Open an existing guide into a map, diff dialog, published-guide guard UI,
`metadata.guide` reconciliation.

### Slice 4 — shared sequencing

Extract the lane/sequence algorithm into one module consumed by the designer, the
Guide Library graph and the compiler. Deliberately last, so the contract is proven by
three real callers before it is frozen.

---

## 12. Open questions

1. Should `precondition` become an array? (§10) Affects shared types, server, iOS
   runtime and the Guide Library graph.
2. Should a procedure map be able to target multiple anchors — the same procedure run
   against several assets — or stay one-to-one?
3. Does the draft-key model suffice for "who may send to the Guide Library", or does
   this need real permissions ahead of SSO/RBAC?
