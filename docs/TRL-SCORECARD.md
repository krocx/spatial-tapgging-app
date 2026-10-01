# Technology Readiness scorecard

Proprietary & Confidential · Applied Materials

How the AR OMS programme scores its tracks, and what SIB does for it.
Status: built 2026-10-01 (`/scorecard`, `sib/src/scorecard/`, master workbook
`Master-TRL-Scorecard-FY27.xlsx` kept outside the repo).

## Two places, one direction of flow

**The master sheet** owns the decision. Five tracks (Hardware Fit, Spatial
Intelligence Training, Integrations, Content Pipeline CAD→AR, AR SDK
Exploration), five lenses each (L1 technology readiness 30 %, L2 SiB
readiness 25 %, L3 WMO process readiness 20 %, L4 automation impact 15 %,
L5 3D OMS dependency 10 %), scored 1 to 5 at the end of every FY27 quarter.
Gates on the weighted score: ADVANCE at 3.80, CONTINUE at 3.00, PARK at
2.50, CLOSE below. Vetoes override the average: L4 at 1 or 2 closes the
track; any lens at 1 parks it; any lens at 2 caps it at CONTINUE; a lens
at Low confidence counts as at most 3; fewer than five lenses scored gives
no recommendation. Every PARK names a re-entry trigger on the Parking Lot;
every score cites an Evidence Log reference.

**SIB** supplies L1 and L2 for the three tracks it has evidence for
(Hardware Fit, Content Pipeline, AR SDK). L3 to L5 need MEs, automation
owners and the 3D OMS team, people who will never log in to SIB, so they
stay with the track owner in the master sheet. SIB exports its block
(`/scorecard/export.xlsx`) in the master's column order; the owner pastes
it into the SIB Import sheet and carries it across. After each review the
owner records the master's verdict in SIB, so the team scoring criteria
sees "Content Pipeline: CONTINUE as of 1 Oct" next to their work.

## How a lens is scored in SIB

A lens is not scored directly. Each track lists criteria under L1 and L2
(`scorecard-core.ts`, the full rubric per criterion with the five level
texts), and anyone on the team scores a criterion 1 to 5 against those
texts, with a confidence (High: repeated on real decks, devices or shifts,
reproducible by someone else · Medium: more than once in a controlled
setting · Low: one run, a demo or hearsay) and evidence. Evidence is a link
to what SIB holds (an import log, a guide, a readiness snapshot, a session,
a model) or a URL or file reference; a 4 or 5 is refused without one, since
a score without evidence is an opinion. Hardware Fit criteria are scored
per device profile.

The lens score the criteria suggest is the lower of the rounded mean and
the lowest criterion plus one, so one bad criterion drags the lens but does
not alone decide it; the lens confidence is the lowest among its criteria.
The track owner (Engineer and above) confirms or overrides with a written
reason; the export carries the effective value and the reasoning.

The same five words as the master sheet apply. L1: 1 Concept, 2 Demo only,
3 Repeatable in a controlled setting, 4 Works in situ, 5 Proven in situ.
L2: 1 Does not exist, 2 Scoped, not started, 3 In build, 4 Shipped with
known gaps, 5 Shipped and reused.

## Criteria

**Content Pipeline CAD→AR.** L1: format coverage (publication variants import
without code changes), geometry fidelity (small and thin parts survive
reduction), animation fidelity (motions, hoses and flipbooks as the viewer
plays them), state fidelity (visibility and pose per step), units and pose
(right size and assembled pose without manual fixing), metadata (part
numbers, descriptions, text, views), scale and performance (largest deck,
time, memory, host), diagnosability (every failure explained from the saved
log). L2: import tool, variants and delivery, Designer preview, players.

**Hardware Fit** (per device). L1: delivery (opens from the QR with nothing
typed), legibility and field of view, overlay accuracy, input while hands
are busy, comfort and duration, environment (cleanroom, ESD, eyewear,
battery). L2: the XR kit or app on this device, readiness and profiles.

**AR SDK Exploration.** L1: anchoring and relocalisation (mm and seconds),
tracking under motion, device coverage. L2: SIB integration.

## Leadership view

`/scorecard` opens on it: every track as a card with the master verdict and
its date, L1 and L2 with confidence, the open gaps (criteria at 1 or 2),
how many criteria are scored and how much evidence is linked; the two
tracks scored only in the master sheet appear with that status so the
picture is complete. Above the cards: tracks, scores entered this quarter,
evidence linked, open gaps, verdicts recorded. The page carries no gates of
its own; the decision is the master sheet's.

## Cadence and roles

Anyone with portal access scores criteria; the evidence rule keeps that
safe. One owner per track confirms lenses, writes the conclusion on the
master sheet and records the verdict in SIB. Weekly during an assessment,
quarterly for the master review. Evidence beats opinion when entries
disagree; the latest entry per criterion is the current one and the history
is kept.

## Fiscal quarters

`quarterOf()` labels entries FY27-Q1 and so on with the fiscal year starting
in November (`FY_START_MONTH`); October 2026 is FY26-Q4. Change the constant
if the calendar differs.
