# POC Portfolio - every BU, every use-case, where each stands

Proprietary & Confidential · Applied Materials.

`/portfolio` is the programme's portfolio instrument. The scorecard answers
"is the technology ready?" per track; the portfolio answers "where are we
with each business unit, and what do you need from me?" It is what the
steering committee reads weekly and leadership monthly.

## The object

A **use-case** is a programme a BU runs with us: the business question in
the BU's words, the process or chamber, the sponsor and the ME, the stage,
the health, and the chambers and guides in SIB it touches. Numbered
**POCs** sit under it. Each POC has a scope (what is in, what is out), a
**definition of done** - the scope completed as planned, measurable; there
is no pass or fail, every learning is a metric - the scorecard tracks it
should move, a next milestone with a date, and, when it closes, an **exit**:
next POC, move to pilot, or parked with the reason (technology, hardware or
software not available).

Status notes, bottlenecks and learnings are append-only: every entry carries
a name and a date, nothing is overwritten. A bottleneck has an owner, a
severity and a "needs leadership decision" flag; an open flag puts the
use-case first on the overview.

## Stages and gates

Use-case: Identified → Scoping → Agreed → Active → Pilot → Adopted, or
Parked. POC: Planned → In progress → Completed. Status cannot inflate:

- A POC starts only with its scope and definition of done written.
- A POC completes only with at least one learning, an exit, and - when it
  names scorecard tracks - a scorecard entry on one of them since it
  started. Parking needs the reason.
- Active means a POC is in progress; Pilot follows a completed POC whose
  exit is "move to pilot"; Agreed means a POC has scope and definition of
  done. Starting a POC moves an earlier-stage use-case to Active by itself;
  completing one with exit "pilot" moves it to Pilot.

**Health** (green · amber · red, with a reason for amber or red) is separate
from stage and set by a Manager: a POC can be in progress and in trouble.

## The two views

**Overview.** Strip: BUs engaged, use-cases by stage, POCs in progress and
completed, decisions waiting on leadership, stale records. Table: BU,
use-case, current POC with the POC dots, stage, health, next milestone,
decisions, last activity. Order: decisions waiting first, then health, then
the stalest. Filter by BU and stage. A record with no entry in seven days
(the steering cadence) is marked stale.

**One-pager.** Header with BU, stage, health, sponsor, ME, chambers. The
business question. The POC timeline; the selected POC's definition of done,
scope, next milestone, status history, bottlenecks and decisions, learnings.
A readiness block on the right, **read from SIB and never typed**: published
guides (the use-case's own plus every published guide on a linked chamber),
steps delivered per device form, runs, completed and evidenced runs (demo
placements counted apart), device verdicts and scorecard lenses for the
quarter, each linking to its source page. Print-friendly.

## Who writes what

| Role | May |
|---|---|
| Owner | everything |
| Manager | create and edit use-cases and POCs: stage, scope, definition of done, tracks, health, exits, milestones, links to chambers and guides |
| Engineer | status notes, learnings, bottlenecks and their resolution |
| Technician, admin key, bare API key | read only - a write needs a name |

## Exports

`GET /portfolio/export.xlsx`: Portfolio (one row per use-case), POCs, Status
log, Bottlenecks, Readiness (the live numbers at export time).
`GET /portfolio/export.pptx`: the overview as one table slide and one slide
per use-case in the one-pager layout (business question, POC table, latest
status, bottlenecks and decisions, readiness), white with the applied blue,
dated and marked confidential. PowerPoint needs the `pptxgenjs` package on
the server (`npm install`).

## Seed

On first use the store is seeded with the programme's use-cases so the page
never opens empty: MDP FD10 WI (POC-1 AR WI on glasses · POC-2 adaptive to the
technician · POC-3 contextual intelligence), ETCH Cathode 3D OMS (POC-1 manual
import and device readiness · POC-2 dynamic import from MES), ETCH ESC JSON +
CAD (the same two by that path). Store: `portfolio-usecases.json` in the data
directory.

## Where it is

Home-page door, Compass under Platform next to the Scorecard,
`sib/portal/portfolio.html`, `sib/src/routes/portfolio.ts`,
`sib/src/portfolio/portfolio-core.ts` (the gates and the order, pure, with
tests in `sib/test/portfolio.test.ts`). Positioning per
[POSITIONING.md](POSITIONING.md): sources not formats, Walks not audits,
readiness as ecosystem readiness.
