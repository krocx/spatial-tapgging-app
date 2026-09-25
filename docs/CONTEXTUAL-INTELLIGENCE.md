# Contextual intelligence - the device is a sensor, SIB is the judge

Status: shipped in three parts - observations + baselines (2026-09-20),
signals → hints (2026-09-21), effectiveness loop + portal Intelligence page
(2026-09-21).

Proprietary & Confidential · Applied Materials.

## Why

Today's guidance is scripted: a fixed stall timer, moment-coach copy, an AI
adapter that fires on a retry count. That cannot grow with use and it cannot
move to glasses without being rewritten per device. The intent is guidance
that **organically evolves**: what "normal" looks like on a step is learned
from how people actually do it, deviations from that are the signal, and the
knowledge that phrases the hint is the same Ask-SIB knowledge the team already
uses. All of it lives in SIB, so any client - iPad, Unity, WebXR, glasses -
gets the same intelligence by sending the same observations.

## Part 1 - Observations (shipped)

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
- Learns **baselines** per guide and step from *completed* visits -
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

## Part 2 - Signals → hints (shipped)

After every observation batch, SIB compares the *current visit* with the
step's baseline and queues a hint for each new deviation - once per visit,
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
(`OmsUsageStepEntry.hints`) so Part 3 can score it by what happened next.

### Operator controls (UX, shipped 2026-09-21)

- **Spotlight.** The step's parts glow cyan (pulsing) with a leader line
  from the step pin to their centroid. "Show me" on a hint, or tapping the
  part chip, flashes the right parts three times while the rest of the
  assembly ghosts for 2.5 s. Replay is a labelled pill.
- **Mute.** The hint card's "…" menu and the ✨ top-bar control offer *Mute
  for this step* (clears when the step changes) and *Mute for this guide*
  (this session); Settings → Contextual hints is the device-wide switch.
  Human coach hints are never muted. Muted automatic hints are dropped on
  the device and reported as `hint:muted { hintId, scope }`; delivered ones
  as `hint:shown` - both land on the visit's hint record (`delivery`,
  `muteScope`) so Part 3 scores shown, muted and ignored separately. Observations
  keep streaming while muted.
- **Names.** Imported step nodes carry `label` (source object name → BOM
  description → part number) so hints, chips and the portal never show a raw
  node id.

## Part 3 - Effectiveness loop + portal (shipped)

`sib/src/oms/intelligence.ts`. Every automatic hint is scored by what happened
**after** it, from the raw samples Part 1 already keeps
(`observations/<session>.jsonl`, `t` relative to step entry) and the visit
outcome. The hint time inside the visit is `hint.ts − visit.enteredAt`.

| Signal | "Helped" means |
|---|---|
| dwell | the visit completed within max(30 s, step p50 dwell) of the hint |
| wrong-part | no `tap-wrong-part` sample after the hint (and something was observed after) |
| attention-off | on-target ratio after the hint > before |
| look-away | a `viewAligned` (or `look-aligned`) sample after the hint |
| validate-retry | the visit completed with a pass verdict |

Muted hints count separately. Scores roll up per (step, signal, phrasing
`via`) over the **last 50 visits** of the step, so a bad early phrasing can
recover.

### Retirement - the loop closes

`evaluateSignals` (Part 2) asks `retiredSignals(guideId, stepId)` before firing
and `preferredVia(...)` before phrasing:

- shown ≥ 5 and effectiveness < 0.3 → the signal is **retired** on that step;
- shown + muted ≥ 4 and mute rate ≥ 0.5 → retired (people said no);
- both `llm` and `template` phrasings with ≥ 5 shown and the LLM below the
  template → that step uses the template.

Nothing is configured; retirement lifts on its own when newer visits push the
score back over the line. Coach (human) hints are never scored or retired.

### `GET /guide-sessions/intelligence/:guideId`

Per step: completed visits, dwell p50/p90, and the rates that make the
**heat** score (0–100, weighted: left/failed 0.35, validation fail 0.2, wrong
part 0.15, stalled 0.15, attention off 0.1, never at viewpoint 0.05); the hint
table (signal × via: shown / helped / muted / effectiveness / retired +
reason); and author-facing **notes** generated from the numbers only when
there is enough behind them (≥ 3 visits with observations), e.g. "38 % of
visits tap a part that is not in this step - the part label or photo is not
distinguishing it." Header: runs seen, baseline confidence (none / low < 3
runs / medium < 10 / high), retired hints. Cached 60 s.

### Portal

AR Guides Sessions → **🧠 Intelligence**: guide picker (guides with runs),
heat strip per step (click → the step card), per-step rate tiles, hint
effectiveness table with 🔕 retired badges, and the fix notes. Read-only.

### Tests

`sib/test/intelligence.test.ts`: per-signal scoring, muted never helps,
retirement on low effectiveness and on mute rate, recovery when newer visits
help, heat/confidence, empty guide.
