# Business Readiness · Impact

Proprietary & Confidential · Applied Materials

The second half of the scorecard. Status: built 2026-10-20 (`/scorecard`
→ Business, `sib/src/scorecard/impact-core.ts`, routes under
`/scorecard/impact`, the "Business readiness" and "Needles" sheets of the
export). The first half is [TRL-SCORECARD.md](TRL-SCORECARD.md).

## Why two halves

The Technology scorecard answers two questions a programme must answer
before anything else: does it work (L1), and is SIB ready to carry it (L2).
It cannot answer the question that decides the budget: *is the business
moving*. A track can ADVANCE on technology and leave the floor exactly as it
was. The Business half exists so that every quarterly review reads both
answers side by side, and so that every POC in the portfolio is judged by the
needle it moved, not the demo it gave.

The two halves share one discipline. A number without a source is an
opinion, so every value names its report, export or study. Confidence is the
same three words (High: repeated on real work, reproducible; Medium: more
than once in a controlled setting; Low: once, a demo or hearsay). Levels are
1 to 5 with words, never a bare score. And the decision stays with the
master sheet; SIB shows the evidence and the direction.

The frame borrows from practice that leadership already trusts: the Department
of Defense's Manufacturing Readiness Levels, which put a staged readiness scale
beside TRL so that "it works" and "we can make it" are never confused
([MRL](https://en.wikipedia.org/wiki/Manufacturing_readiness_level),
[AcqNotes](https://acqnotes.com/acqnote/tasks/manufacturing-readiness-level));
lean's value-added-time ratio and spaghetti diagram for the strike zone;
first-pass yield and cost of poor quality for trust; and Kirkpatrick's levels
for upskilling, where level 3 - behaviour on the job - is what Time to
Contribution measures.

## Three pillars, fifteen needles

Each pillar asks one question a lead would ask, and answers it with a few
metrics that each carry a **baseline**, a **now**, a **target** and a
**previous quarter**. The scorecard calls them needles because that is how
they are drawn: a gauge from baseline to target, the needle where the quarter
stands, a grey ghost where last quarter stood.

**Productivity - do people become contributors sooner, and stay capable?**

| Needle | Unit | Better | Source | What it says |
|---|---|---|---|---|
| Time to contribution | days | lower | OJT record · SIB sign-off | OJT start date to first solo sign-off on a procedure in scope. The instruction is on the equipment and validated as they go, so day one is the real procedure with the system watching. Published AR cases report 35-85 % shorter training (vendor-reported). |
| Runs to proficiency | runs | lower | SIB, automatic | Per operator and guide, runs until a run completes within 1.2× the guide's median. A short curve means the guide teaches. |
| Help needed per run | hints | lower | SIB, automatic | Hints shown per completed run. Falling help with rising completion is upskilling made visible. |
| People ready | % | higher | OJT roster · SIB | Operators with a sign-off in the last 30 days over the rollout scope. Readiness is people, not licences (Prosci ADKAR: ability and reinforcement). |
| Change readiness | /5 | higher | pulse survey | A five-question ADKAR pulse each quarter. The leading indicator for everything else here. |

**Velocity - is the work faster, and is the technician in the strike zone?**

| Needle | Unit | Better | Source | What it says |
|---|---|---|---|---|
| Standard labour hours | h / unit | lower | MES | Actual hours per unit against the standard - the headline the business watches. Published AR cases: -25 % assembly time (Boeing wiring), -35 to -50 % technician time (Lockheed Martin), both vendor-reported. |
| Procedure cycle time | min | lower | SIB, automatic | Median completed run per guide; the platform's own stopwatch, which moves before the MES notices. |
| Time in the strike zone | % | higher | SIB, automatic | Share of a run spent at the work, from attention-on-target in the run's observations weighted by step time; a spaghetti-diagram study per quarter calibrates it. The strike zone is where value is added; instructions on the equipment remove the walk to the laptop, readings by camera remove the walk to write a value down. |
| Process improvements landed | count | higher | QMS | Work-instruction revisions whose change record cites a SIB finding. The platform should make the procedure better, not only faster. |
| Non-productive time | % | lower | MES / time study | The mirror of the strike zone, from the business's own clock. |

**Customer Trust - is the work right the first time, and do fewer problems reach the customer?**

| Needle | Unit | Better | Source | What it says |
|---|---|---|---|---|
| First-time right | % | higher | SIB, automatic | Validated steps that passed on the first attempt - presence, reading, label or barcode. Overrides and typed values count against it. This turns into fewer DMRs and NCs two quarters later. |
| Rework tasks | count | lower | QMS / MES | Rework orders attributed to the procedures in scope. |
| Rework hours | h | lower | QMS | The hours those orders cost; the business case is written in these hours. |
| DMRs caught at the step | % | higher | QMS | Discrepant-material reports with origin "in-process" over all DMRs. An early DMR is a cheap DMR (the 1-10-100 rule). |
| Field non-conformances | count | lower | QMS | NCs found at the customer, by root-cause procedure. Lags by one to two quarters. The number the customer feels; everything above serves it. |

Five of the fifteen fill themselves from the usage log every quarter (marked
*SIB, automatic*): cycle time, strike zone, first-time right, help per run,
runs to proficiency. Their confidence follows the sample - High at 20 or more
runs, Medium at 5, Low below. Demo runs never count. The other ten are entered
by the owner with their source, scope and confidence, exactly as L3 to L5 are
entered in the master sheet: those numbers live in MES, QMS and the OJT
records, with people who will not log in to SIB.

## The readiness rule

A needle's progress is how far *now* has moved from *baseline* toward
*target*, direction-aware, so a falling rework count and a rising first-time
right both read as progress. A pillar's progress is the weighted mean of its
needles (weights in `impact-core.ts`: the headline numbers - SLH, cycle time,
strike zone, first-time right, field NCs, time to contribution - count three;
supporting ones two or one). The pillar's level follows the bands:

| Level | Word | Progress to target |
|---|---|---|
| 1 | Baseline only | measured, under 5 % moved |
| 2 | Movement in a POC | 5-30 % |
| 3 | Movement in situ | 30-60 % |
| 4 | Repeated across chambers | 60-95 % |
| 5 | Business case proven | 95 % and beyond |

Three caps keep a good POC number from reading as a business case: a pillar
whose evidence is all Low confidence cannot be above Level 2; one with fewer
than half its needles measured cannot be above Level 3; Level 5 needs at least
one High-confidence needle. The programme's overall level is the **lowest**
pillar - a programme is as ready as its weakest promise - and its overall
progress is the mean of the three. All of this is printed on the page beside
the numbers, as the Technology half prints its gates.

## Every POC moves a needle

A POC in the [portfolio](POC-PORTFOLIO.md) already names the Technology tracks
it should move. It now also names its **needles**: which business metrics it
expects to move and by how much (the hypothesis, in the metric's unit), and
when it completes, what it measured. The scorecard's Business half lists every
claim beside its needle, and the "Every POC moves a needle" table reads the
programme the way a sponsor does: this use-case, this POC, this needle,
expected this, moved that. A POC with no needle claimed is a POC that has not
yet said why it matters; the completion gate in the portfolio should, in time,
ask for one the way it asks for a learning.

The outcome of a POC is therefore never pass or fail. It is a measured change
on a named needle, with its confidence - the same sentence whether the change
was large, small or in the wrong direction. A POC that moves first-time right
from 71 % to 84 % on one chamber takes Customer Trust from Level 1 to Level 2
("movement in a POC"); the same change held across three chambers for a
quarter takes it to Level 4; the field NC count falling two quarters later is
what proves the case.

## What leadership sees

`/scorecard` → **Business**. The programme's level and word; the three
pillar gauges (needle this quarter, ghost last quarter, the bands as
ticks); **Who moved the needle** - one bar per pillar, its progress split by
the POC that measured it, outlined where a POC has promised but not yet
measured, grey where the needle moved and no POC claims it; **Risks,
bottlenecks and support needed** - from the portfolio, every open
bottleneck, health flag and overdue milestone on a POC that claims a needle,
the ones needing a leadership decision first. Then one section per pillar:
its gauge and level, and its needles - baseline, last quarter, now, target,
a progress bar with last quarter's mark and a sparkline, confidence and
source, the POCs claiming it, Enter and Why. "Why" opens the needle's
definition, formula, why it moves the business and the practice it is
borrowed from, so no number on the page is a mystery. "What to enter next"
lists the gaps as chips. The Excel export carries two sheets, "Business
readiness" and "Needles", in front of the Technology block.

## Entering the numbers

Three ways, for three habits. **One needle:** Enter on its row - value,
baseline or target, source, scope, confidence. **One sitting:** "Enter this
quarter's numbers" (or a pillar's button) walks through the needles one at a
time with the what, how and why in view, baseline and target beside the
value, blank fields keeping what SIB has, nothing saved without a source.
**In Excel:** download the quarter's template - one row per needle with how
it is measured and the numbers SIB already holds, a second sheet explaining
every column - fill it with the MES, QMS and OJT exports open beside it, and
import it back; the file is checked as a whole before anything is saved, and
the reply says what went in. Automatic needles take only a baseline and a
target in all three.

## Sample data for review

An Owner can load a review sample - "[Sample] ETCH · 3D OMS to AR OMS":
one use-case, three POCs (the lid procedure in AR, completed with measured
changes; readings and labels, in progress; a glasses pilot, planned and
blocked), open bottlenecks including two that need a leadership decision,
and three quarters of numbers - and remove it as one. It shows the page as
it will look after a quarter of real use, and every sample number says so in
its source.

## Cadence and roles

Baselines and quarterly values: Engineer and above, signed in, source
required. Targets: Manager and above - a target is a commitment. POC claims:
Manager and above, on the portfolio. Automatic needles accept a baseline and
a target only; their value is the usage log's. Each save is a new record under
a name and a time, never edited. The quarterly review reads the Technology
and Business halves together; the Friday delta carries both.

## First quarter

To put the first needles on the board: enter the baselines from the last
full quarter before the platform (MES labour report, QMS rework and DMR
exports, HR start dates for the last cohort), set targets with the sponsor,
and let the five automatic needles fill from the runs already in the usage
log. Then open the portfolio and have each active POC claim its needles. The
first review will show most pillars at Level 1 or 2 with honest confidence,
which is the point: the needle has somewhere to go, and every quarter after
shows it going.
