# Contextual intelligence — the device is a sensor, SIB is the judge

Status: C1 shipped 2026-09-20 (observations + baselines); C2 shipped
2026-09-21 (signals → hints). C3 (effectiveness loop + portal page) follows.

Proprietary & Confidential · Applied Materials.

## Why

Today's guidance is scripted: a fixed stall timer, moment-coach copy, an AI
adapter that fires on a retry count. That cannot grow with use and it cannot
move to glasses without being rewritten per device. The intent is guidance
that **organically evolves**: what "normal" looks like on a step is learned
from how people actually do it, deviations from that are the signal, and the
knowledge that phrases the hint is the same Ask-SIB knowledge the team already
uses. All of it lives in SIB, so any client — iPad, Unity, WebXR, glasses —
gets the same intelligence by sending the same observations.

## C1 — Observations (shipped)

### Contract

`POST /guide-sessions/live/:id/observations`

```json
{ "stepId": "…", "stepIndex": 3,
  "observations": [
    { "t": 0,   "attention": "target", "targetDistM": 0.9, "targetAngleDeg": 8, "viewAligned": false, "moving": false },
    { "t": 1,   "attention": "away",   "moving": true },
    { "t": 2.5, "interaction": "tap-wrong-part", "node": "cmp:BEARING" }
  ] }
```

| Field | Meaning |
|---|---|
| `t` | seconds since the step was entered |
| `attention` | what the view centre lands on: `target` (the step's part / pin), `assembly` (another part), `pin` (this step's pin), `panel`, `away` (some other overlay), `none` (nothing) |
| `targetDistM`, `targetAngleDeg` | camera → step target distance and aim error |
| `viewAligned` | look-from-here alignment, when the step carries a view |
| `moving` | device translating > 0.15 m/s |
| `interaction` | `tap-part`, `tap-wrong-part`, `replay`, `panel-open`, `panel-close`, `validate-attempt`, `realign`, `look-aligned`, `stall` |
| `node` | part name for tap-* interactions |

Never images, never free text, never identity beyond the live session. A
client samples at ~1 Hz and flushes every 5 s (and on step change / sign-off).
The iOS sampler is `observeTick` / `observeInteraction` in
`ARGuideSessionView`; a Unity or WebXR client posts the same JSON.

### What SIB does with it

- Rolls the batch into the usage record's visit (`OmsUsageStepEntry.observations`):
  attention seconds per class, on-target ratio, aligned seconds, taps (right /
  wrong part), replays, validation attempts, re-aligns, stalls, median
  distance, moving seconds. Durable, small, exportable.
- Appends the raw samples to `observations/<liveSessionId>.jsonl` under the
  data dir for later analysis (capped at 4 MB per session).
- Learns **baselines** per guide and step from *completed* visits —
  `GET /guide-sessions/baselines/:guideId`:

```json
{ "guideId": "…", "sessions": 37, "computedAt": "…",
  "steps": [ { "stepId": "…", "sessions": 35,
               "dwellSec": { "p50": 48, "p90": 110 },
               "onTargetRatio": { "p50": 0.71, "p10": 0.35 },
               "wrongPartTaps": { "p50": 0, "p90": 2 },
               "replays": { "p50": 1 },
               "validationFailRate": 0.08, "stallRate": 0.14 } ] }
```

Nothing is hard-coded: every number is a percentile of what real operators
did. With one session the baseline is that session; it sharpens as more
arrive. Cached for a minute.

## C2 — Signals → hints (shipped)

After every observation batch, SIB compares the *current visit* with the
step's baseline and queues a hint for each new deviation — once per visit,
through the same consume-once queue every client already polls
(`GET /guide-sessions/live/:id/hints`, `trigger: "signal"`).

| Signal | Fires when (this visit vs. baseline) |
|---|---|
| `dwell` | elapsed > `dwellSec.p90` (baseline needs ≥ 3 completed visits) |
| `attention-off` | ≥ 15 samples and `onTargetRatio` < baseline `p10` |
| `wrong-part` | wrong-part taps > baseline `wrongPartTaps.p90` (floor 2 without a baseline) |
| `look-away` | step has a view, ≥ 20 samples, never aligned, and past the median dwell |
| `validate-retry` | ≥ 3 validation attempts on the visit without a pass |

The thresholds are the baseline's own percentiles; the only constants are
floors that stop a two-session baseline from firing on noise. Each hint
carries `signal`, `evidence` ("on step 95 s; 90 % of 12 visits finished
within 60 s") and `via`.

Phrasing: a template that quotes the baseline and the step's part names is
the ground truth. When `ASK_LLM_URL` is set, the same facts (step text, part
names, signal, evidence, fallback) go to the model behind Ask SIB with an
8-second budget and a 160-character brief; anything slow, empty or
over-long falls back to the template. The client shows the reason per
signal ("Taking longer than usual here", "That's not the part for this
step") and opens the card for wrong-part / validate-retry, leaving
dwell-type hints as a quiet chip. Each fired hint is recorded on the visit
(`OmsUsageStepEntry.hints`) so C3 can score it by what happened next.

## C3 — Effectiveness loop + portal (after)

Every hint records whether the operator progressed within a window; hints
are ranked by effectiveness per step and the weaker phrasings retire. A
portal "Intelligence" page shows per-step heat — where people stall, look
away, tap the wrong part, fail validation — so authors fix the content, not
just the hints.
