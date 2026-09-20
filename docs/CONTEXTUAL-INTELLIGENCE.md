# Contextual intelligence — the device is a sensor, SIB is the judge

Status: C1 shipped 2026-09-20 (observations + baselines). C2 (signals →
hints) and C3 (effectiveness loop + portal page) follow.

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

## C2 — Signals → hints (next)

A deviation from the step's baseline is the signal, not a fixed threshold:
dwell beyond `dwellSec.p90`, attention on target below `onTargetRatio.p10`
for longer than typical, wrong-part taps beyond `p90`, no `look-aligned` on a
step where most people align within the first N seconds. Each signal, with the
step text, part info and what worked for others on that step, goes to the
LLM adapter behind Ask SIB to phrase a hint; the hint rides the existing
consume-once queue (`GET /guide-sessions/live/:id/hints`) so every client
already knows how to show it. The iOS stall timer becomes one observation
among several rather than the trigger.

## C3 — Effectiveness loop + portal (after)

Every hint records whether the operator progressed within a window; hints
are ranked by effectiveness per step and the weaker phrasings retire. A
portal "Intelligence" page shows per-step heat — where people stall, look
away, tap the wrong part, fail validation — so authors fix the content, not
just the hints.
