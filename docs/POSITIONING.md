# Positioning - how SIB is described, whoever writes the page

Proprietary & Confidential · Applied Materials.

The Feature Catalogue made the platform legible; the explain pages
(`/explain`) make it understandable to people who do not read code:
Manufacturing Engineers, Technical PMs, the leadership that sponsors the
work. Every one of those pages, and every description of a feature anywhere,
follows the three principles below. They are not marketing; they are the
difference between what SIB is today and what it is being built to become,
stated so that neither is overstated.

## 1. Sources, not formats

A work instruction has an origin system. SIB imports it today from the
formats the proof-of-concept exercised - a Cortona publication, an Excel
sheet, a JSON file - and the import step (units, rest pose, hidden parts,
labels) is what is under review right now. PDF is next in line for review.
The destination architecture is live pull from the source of record: MES
JSON, image URLs, 3D-model APIs, converted and adapted to AR automatically,
with no publish-and-import loop. Cortona is one lane among several and
never the spine of a drawing; it will not scale across the organisation and
was never meant to.

Say: "imported from its source (today: Cortona, Excel, JSON; next: PDF;
destination: live from MES)". Do not say: "the Cortona import pipeline".

## 2. Walks, not audits

The Gemba Audit product keeps its name. The capability it carries is a
**Walk**: a person performs a sequence of work at the right place and signs
it off, and spatial awareness proves the *where* (the chamber, the panel,
the tag in view). Auditors are one user of a Walk; a technician or an ME
with an assigned task is another. Position the capability by the task, not
by the audit.

Say: "a Walk - a sequence of work, placed, signed off". Do not say: "the
audit tool".

## 3. Readiness is ecosystem readiness

What leadership wants from one snapshot is how ready WMO business processes
are for spatial computing: the people (roles, training, who can score and
confirm), the processes (work instructions with a source of record, their
readiness per delivery form), our own validation (evidenced runs, accuracy
in millimetres, verdicts by a stated rule), and the integration with what
is arriving in parallel - automation (AMRs, cobots on gas-line and leak
checks, physical automation already being invested in) and AI as a
well-integrated part of the whole. AR glasses are one lane of that
transition, not its destination. Not every work instruction moves to
glasses; some move to a robot.

Pages stay true to what SIB does today, draw the horizon as horizon (named
integration points, no invented numbers), and never let a demo count as a
run.

## The lifecycle lanes

Source of record → import (or live pull) → Designer (colour, needs, hide,
order) → publish → readiness per delivery form → run (iPad · headset · small
glasses · spoken) → evidence → scorecard. Draw sources as parallel lanes
converging on the import step. Draw the live-pull lane as the destination,
labelled.

## The readiness dimensions (draft framework)

| Dimension | What SIB measures today | Horizon |
|---|---|---|
| People | roles in UAM, who scored and confirmed, training captured per tag | certification paths per role |
| Processes | guides with a source, steps delivered per device form, readiness matrix | work instructions pulled live from MES |
| Validation | evidenced runs, accuracy runs in mm, verdicts by rule, no demos counted | pilots on the floor with a stated bar |
| Integration | - | automation touchpoints (AMR, cobot) and AI, named as they land |

This table is a framework to gather feedback on, not a scorecard yet. It is
drawn on `/explain/readiness` exactly that way.

## Sensitivity

Pages that describe how SIB works inside - the data containers, the
perception layer - are IP-sensitive and open only with the IP key
(`canViewRestricted`), like the Architecture and the restricted Catalogue
entries. Pages that position (Lifecycle, Readiness) are open on the server.
Exact tunables (thresholds, blends, counts) stay out of every explain page;
the behaviour is described, the numbers live in the code and the specs.

## Where this applies

- `/explain/*` pages and `/containers`.
- Feature Catalogue descriptions (`docs/catalog/*.md`): the `description`
  follows these principles; the `status` stays honest.
- Decks, the platform story (`/platform`) and the roadmap narrative.
- Changelog entries, which read like the catalogue.
